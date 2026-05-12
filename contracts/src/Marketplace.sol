// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPassport} from "./interfaces/IPassport.sol";

/// @title Marketplace — AgentPay Passport's all-in-one main contract.
/// @notice Merges ToolRegistry + AgentRegistry + AgentWallet + PaymentEscrow.
///         Pull-payment model: `pay()` only credits an internal ledger; providers
///         withdraw with `withdrawProvider`. Receipts are atomically verified +
///         consumed by `verifyAndConsumeReceipt`, closing TOCTOU windows.
contract Marketplace is ReentrancyGuard {
    // ── Types ──────────────────────────────────────────────────────────────

    struct Tool {
        address provider;
        address payout;
        uint128 pricePerCall;
        uint64 version;
        bool enabled;
        bytes32 schemaHash;
        string endpoint;
        string name;
        string description;
    }

    struct Agent {
        address owner;
        address operator;
        uint128 balance;
        uint128 maxPerCall;
        uint128 dailySpendCap;
        uint128 dailySpent;
        uint64 dailyResetAt;
        uint128 totalBudget;
        uint128 totalSpent;
        uint16 reputation;
        bool active;
        // running tally for reputation averaging
        uint64 ratingCount;
        uint64 ratingSum; // sum of stars (1-5)
    }

    enum TaskStatus {
        None,
        Open,
        Completed,
        Cancelled
    }

    struct Task {
        uint256 agentId;
        bytes32 promptHash;
        bytes32 resultHash;
        uint32 stepCount;
        TaskStatus status;
        bool rated;
    }

    struct Receipt {
        bytes32 taskId;
        uint256 agentId;
        uint256 toolId;
        uint64 toolVersion;
        uint32 stepIdx;
        uint128 amount;
        bytes32 inputHash;
        uint64 timestamp;
        bool consumed;
    }

    // ── Storage ────────────────────────────────────────────────────────────

    IPassport public immutable passport;

    mapping(uint256 toolId => Tool) public tools;
    uint256 public nextToolId = 1;

    mapping(uint256 agentId => Agent) public agents;
    uint256 public nextAgentId = 1;

    mapping(bytes32 taskId => Task) public tasks;

    mapping(bytes32 receiptId => Receipt) public receipts;
    mapping(uint256 agentId => uint32) public agentStepCounter;

    mapping(address provider => uint256) public providerBalances;

    // ── Events ─────────────────────────────────────────────────────────────

    event ToolRegistered(uint256 indexed toolId, address indexed provider, uint128 price, uint64 version);
    event ToolUpdated(
        uint256 indexed toolId,
        uint128 newPrice,
        uint64 newVersion,
        bool enabled,
        bytes32 schemaHash
    );
    event ProviderWithdrawn(address indexed provider, uint256 amount);

    event AgentCreated(
        uint256 indexed agentId,
        address indexed owner,
        address indexed operator,
        uint128 maxPerCall,
        uint128 dailySpendCap
    );
    event AgentFunded(uint256 indexed agentId, uint128 amount);
    event AgentWithdrawn(uint256 indexed agentId, uint128 amount);
    event AgentOperatorChanged(uint256 indexed agentId, address indexed newOperator);
    event AgentDailySpendCapChanged(uint256 indexed agentId, uint128 newCap);

    event TaskStarted(bytes32 indexed taskId, uint256 indexed agentId, bytes32 promptHash);
    event ToolCallPaid(
        bytes32 indexed receiptId,
        bytes32 indexed taskId,
        uint256 indexed agentId,
        uint256 toolId,
        uint128 amount
    );
    event ReceiptConsumed(bytes32 indexed receiptId);
    event TaskCompleted(bytes32 indexed taskId, bytes32 resultHash);
    event TaskCancelled(bytes32 indexed taskId);
    event TaskRated(bytes32 indexed taskId, uint8 stars, uint16 newReputation);
    event ReputationUpdated(uint256 indexed agentId, uint16 newReputation);

    // ── Constructor ────────────────────────────────────────────────────────

    constructor(address passportAddr) {
        require(passportAddr != address(0), "zero passport");
        passport = IPassport(passportAddr);
    }

    // ── Provider: Tool management ──────────────────────────────────────────

    function registerTool(
        string calldata endpoint,
        bytes32 schemaHash,
        uint128 price,
        string calldata name,
        string calldata description,
        address payout
    ) external returns (uint256 toolId) {
        require(payout != address(0), "zero payout");
        require(bytes(endpoint).length > 0, "empty endpoint");

        toolId = nextToolId++;
        tools[toolId] = Tool({
            provider: msg.sender,
            payout: payout,
            pricePerCall: price,
            version: 1,
            enabled: true,
            schemaHash: schemaHash,
            endpoint: endpoint,
            name: name,
            description: description
        });
        emit ToolRegistered(toolId, msg.sender, price, 1);
    }

    function updateTool(
        uint256 toolId,
        uint128 newPrice,
        bool enabled,
        bytes32 newSchemaHash
    ) external {
        Tool storage t = tools[toolId];
        require(t.provider != address(0), "no tool");
        require(msg.sender == t.provider, "not provider");

        t.pricePerCall = newPrice;
        t.enabled = enabled;
        t.schemaHash = newSchemaHash;
        unchecked {
            t.version += 1;
        }
        emit ToolUpdated(toolId, newPrice, t.version, enabled, newSchemaHash);
    }

    /// @notice Pull-payment withdraw. CEI + nonReentrant.
    function withdrawProvider(uint256 amount) external nonReentrant {
        uint256 bal = providerBalances[msg.sender];
        require(amount <= bal, "insufficient balance");

        // Effects
        providerBalances[msg.sender] = bal - amount;

        // Interactions
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "transfer failed");

        emit ProviderWithdrawn(msg.sender, amount);
    }

    // ── End User (Agent owner) ─────────────────────────────────────────────

    function createAndFundAgent(
        uint128 maxPerCall,
        uint128 dailySpendCap,
        address operator,
        string calldata name,
        string calldata /* goal — kept off-chain in DB */
    ) external payable returns (uint256 agentId) {
        require(operator != address(0), "zero operator");
        require(maxPerCall > 0, "maxPerCall=0");
        require(maxPerCall <= dailySpendCap, "maxPerCall > dailyCap");
        require(uint256(dailySpendCap) <= msg.value, "dailyCap > deposit");

        agentId = nextAgentId++;
        Agent storage a = agents[agentId];
        a.owner = msg.sender;
        a.operator = operator;
        a.balance = uint128(msg.value);
        a.maxPerCall = maxPerCall;
        a.dailySpendCap = dailySpendCap;
        a.dailyResetAt = uint64(block.timestamp);
        a.totalBudget = uint128(msg.value);
        a.active = true;

        uint256 tokenId = passport.mint(msg.sender, agentId);
        // Best-effort name set (passport rejects empty string is fine — but here it accepts).
        try IPassportExtended(address(passport)).setAgentName(tokenId, name) {} catch {}

        emit AgentCreated(agentId, msg.sender, operator, maxPerCall, dailySpendCap);
    }

    function fundAgent(uint256 agentId) external payable {
        Agent storage a = agents[agentId];
        require(a.owner != address(0), "no agent");
        require(msg.sender == a.owner, "not owner");
        require(msg.value > 0, "no value");
        require(msg.value <= type(uint128).max, "overflow");

        a.balance += uint128(msg.value);
        a.totalBudget += uint128(msg.value);
        emit AgentFunded(agentId, uint128(msg.value));
    }

    function withdrawAgentBalance(uint256 agentId, uint128 amount) external nonReentrant {
        Agent storage a = agents[agentId];
        require(a.owner != address(0), "no agent");
        require(msg.sender == a.owner, "not owner");
        require(amount > 0 && amount <= a.balance, "bad amount");

        // Effects
        a.balance -= amount;

        // Interactions
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "transfer failed");

        emit AgentWithdrawn(agentId, amount);
    }

    function setAgentOperator(uint256 agentId, address newOperator) external {
        Agent storage a = agents[agentId];
        require(a.owner != address(0), "no agent");
        require(msg.sender == a.owner, "not owner");
        require(newOperator != address(0), "zero operator");
        a.operator = newOperator;
        emit AgentOperatorChanged(agentId, newOperator);
    }

    function setAgentDailySpendCap(uint256 agentId, uint128 newCap) external {
        Agent storage a = agents[agentId];
        require(a.owner != address(0), "no agent");
        require(msg.sender == a.owner, "not owner");
        require(newCap >= a.maxPerCall, "cap < maxPerCall");
        a.dailySpendCap = newCap;
        emit AgentDailySpendCapChanged(agentId, newCap);
    }

    function rateTask(bytes32 taskId, uint8 stars) external {
        Task storage t = tasks[taskId];
        require(t.status == TaskStatus.Completed, "task not completed");
        require(!t.rated, "already rated");
        require(stars >= 1 && stars <= 5, "stars out of range");

        Agent storage a = agents[t.agentId];
        require(msg.sender == a.owner, "not owner");

        t.rated = true;

        // Running average → 0..1000 scale (stars/5 * 1000 = stars * 200)
        a.ratingCount += 1;
        a.ratingSum += stars;
        uint256 avgScaled = (uint256(a.ratingSum) * 200) / uint256(a.ratingCount);
        if (avgScaled > 1000) avgScaled = 1000;
        uint16 newRep = uint16(avgScaled);
        a.reputation = newRep;

        uint256 tokenId = passport.tokenIdOf(t.agentId);
        passport.updateReputation(tokenId, newRep);
        passport.appendTask(tokenId, taskId);

        emit TaskRated(taskId, stars, newRep);
        emit ReputationUpdated(t.agentId, newRep);
    }

    // ── Operator: Task / payment flow ──────────────────────────────────────

    function startTask(uint256 agentId, bytes32 promptHash, bytes32 salt)
        external
        returns (bytes32 taskId)
    {
        Agent storage a = agents[agentId];
        require(a.owner != address(0), "no agent");
        require(a.active, "agent inactive");
        require(msg.sender == a.operator, "not operator");

        taskId = keccak256(abi.encode(agentId, promptHash, salt));
        require(tasks[taskId].status == TaskStatus.None, "task exists");

        tasks[taskId] = Task({
            agentId: agentId,
            promptHash: promptHash,
            resultHash: bytes32(0),
            stepCount: 0,
            status: TaskStatus.Open,
            rated: false
        });
        emit TaskStarted(taskId, agentId, promptHash);
    }

    function pay(
        bytes32 taskId,
        uint256 toolId,
        uint64 toolVersion,
        uint128 expectedPrice,
        bytes32 inputHash
    ) external returns (bytes32 receiptId, uint32 stepIdx) {
        Task storage t = tasks[taskId];
        require(t.status == TaskStatus.Open, "task not open");

        Agent storage a = agents[t.agentId];
        Tool storage tool = tools[toolId];
        require(tool.provider != address(0), "no tool");

        require(msg.sender == a.operator, "not operator");
        require(tool.enabled, "tool disabled");
        require(tool.version == toolVersion, "tool version mismatch");
        require(tool.pricePerCall == expectedPrice, "price mismatch");
        require(expectedPrice <= a.maxPerCall, "exceeds max per call");
        require(a.balance >= expectedPrice, "insufficient balance");

        // Rolling 24h daily cap reset
        if (block.timestamp >= uint256(a.dailyResetAt) + 1 days) {
            a.dailySpent = 0;
            a.dailyResetAt = uint64(block.timestamp);
        }
        require(uint256(a.dailySpent) + expectedPrice <= a.dailySpendCap, "daily cap exceeded");

        // Effects
        a.dailySpent += expectedPrice;
        a.balance -= expectedPrice;
        a.totalSpent += expectedPrice;
        providerBalances[tool.payout] += expectedPrice;

        unchecked {
            stepIdx = ++agentStepCounter[t.agentId];
        }
        receiptId = keccak256(
            abi.encode(
                taskId,
                t.agentId,
                toolId,
                toolVersion,
                stepIdx,
                expectedPrice,
                inputHash,
                block.chainid,
                address(this)
            )
        );
        receipts[receiptId] = Receipt({
            taskId: taskId,
            agentId: t.agentId,
            toolId: toolId,
            toolVersion: toolVersion,
            stepIdx: stepIdx,
            amount: expectedPrice,
            inputHash: inputHash,
            timestamp: uint64(block.timestamp),
            consumed: false
        });
        t.stepCount = stepIdx;

        emit ToolCallPaid(receiptId, taskId, t.agentId, toolId, expectedPrice);
    }

    function completeTask(bytes32 taskId, bytes32 resultHash) external {
        Task storage t = tasks[taskId];
        require(t.status == TaskStatus.Open, "task not open");
        Agent storage a = agents[t.agentId];
        require(msg.sender == a.operator, "not operator");

        t.resultHash = resultHash;
        t.status = TaskStatus.Completed;
        emit TaskCompleted(taskId, resultHash);
    }

    function cancelTask(bytes32 taskId) external {
        Task storage t = tasks[taskId];
        require(t.status == TaskStatus.Open, "task not open");
        Agent storage a = agents[t.agentId];
        require(msg.sender == a.operator || msg.sender == a.owner, "not authorised");
        t.status = TaskStatus.Cancelled;
        emit TaskCancelled(taskId);
    }

    // ── Provider middleware: atomic verify + consume ───────────────────────

    /// @notice Atomically validates a receipt and marks it consumed. Only the
    ///         tool's registered `provider` may call. Closes TOCTOU windows.
    function verifyAndConsumeReceipt(bytes32 receiptId, bytes32 expectedInputHash)
        external
        returns (bool ok)
    {
        Receipt storage r = receipts[receiptId];
        require(r.timestamp != 0, "no receipt");
        Tool storage tool = tools[r.toolId];
        require(msg.sender == tool.provider, "not provider");
        require(!r.consumed, "receipt already consumed");
        require(r.inputHash == expectedInputHash, "input hash mismatch");

        r.consumed = true;
        emit ReceiptConsumed(receiptId);
        return true;
    }

    // ── Views ──────────────────────────────────────────────────────────────

    function getTool(uint256 toolId) external view returns (Tool memory) {
        return tools[toolId];
    }

    function getAgent(uint256 agentId) external view returns (Agent memory) {
        return agents[agentId];
    }

    function getTask(bytes32 taskId) external view returns (Task memory) {
        return tasks[taskId];
    }

    function getReceipt(bytes32 receiptId) external view returns (Receipt memory) {
        return receipts[receiptId];
    }
}

/// @dev Local interface for the optional `setAgentName` extension on Passport.
///      Kept as a separate interface so Marketplace falls back gracefully if
///      a future Passport version drops the helper.
interface IPassportExtended {
    function setAgentName(uint256 tokenId, string calldata name) external;
}
