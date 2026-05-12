# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Current State

This repository is **pre-implementation**. The only file is `agentpay-passport-prd.md` — a product requirements document. There is no code, no build system, no test suite, and the directory is not a git repository yet.

Before writing code, **read `agentpay-passport-prd.md` end-to-end**. It is the authoritative product spec and every implementation decision must be traceable to it. When in doubt about scope or behavior, quote the PRD section rather than inventing requirements.

## Product Snapshot (for fast orientation)

**AgentPay Passport** is an on-chain paid-AI-service marketplace where autonomous AI agents discover, pay for, and use AI services from each other. Built for the Monad Blitz @Shanghai V2 hackathon, **chain = Monad**, native token = MON.

Three modules form the system; treat them as a unit, not independent features:

1. **Paid Tools Marketplace** — Providers register AI services as paid tools (endpoint, I/O schema, price-per-call, payout address). All listings are visible to all Buyer Agents; no centralized gatekeeper, no content review.
2. **Policy-Bounded Agent Wallet** — End Users create Buyer Agents with a total budget and a max-per-call cap. **These limits are enforced at the protocol layer, not by the LLM** — even a prompt-injected agent cannot exceed them.
3. **Reputation Passport** — Each completed task accrues on-chain reputation to the Buyer Agent, held as an NFT-form asset that future marketplaces can read.

Two human user roles: **Provider** (registers tools, withdraws revenue) and **End User** (creates/funds Buyer Agents, submits tasks, rates outcomes). Buyer Agent is a software agent the End User creates — it is not a third user role.

## Non-Negotiable Product Constraints

These are easy to violate accidentally during implementation. Hold the line:

- **No human-in-the-loop during agent execution.** After the End User clicks "Start Task," the Buyer Agent runs to completion autonomously. No per-step confirmations, no OAuth prompts, no signature requests mid-task. The only human signatures are agent-creation/funding, withdrawal, and rating.
- **Budget enforcement is protocol-level, not agent-level.** The wallet contract must reject overspend; the LLM/agent layer must not be the only line of defense.
- **Provider ↔ End User anonymity.** They interact only through the protocol. Do not build features that surface identities to each other.
- **Open-loop planning only for MVP.** Buyer Agent generates a full plan up front and executes it; **no adaptive replanning based on intermediate results**.
- **MCP-compatible tool schemas + x402-style payment gate.** Tools follow MCP schema conventions; the only addition is an on-chain payment step before invocation. Do not invent a custom tool-description format.
- **Marketplace shows the full tool list — no search, no filters, no sort for MVP.**
- **Single chain (Monad).** No cross-chain bridges, no multi-chain abstractions.
- **No dispute resolution, no refunds, no KYC, no content moderation.** Rating is the only signal; low rating ≠ refund. If a feature implies any of these, it is out of scope.

## MVP Acceptance Targets (from PRD §9)

- **Provider flow:** wallet login → fill service form → set price → on-chain register → see "Active" status in ≤ 10 minutes from first visit. Withdrawal works end-to-end.
- **End User flow:** wallet login → create agent → set budget → submit task → see integrated deliverable in ≤ 5 minutes from first visit, with no input between "submit" and "view result."
- **On-chain auditability:** any third party can reconstruct a task's full payment + invocation history from a block explorer.
- **Reputation as standalone asset:** the Passport is an independent on-chain asset, readable by other marketplaces.

## Tech-Stack Decision Status

The PRD intentionally does not prescribe implementation details. When the first technical choice is made (smart-contract language/framework, frontend stack, agent runtime, indexer), record it in this section and link to the rationale — don't let the stack drift implicitly across files.

Open decisions as of repo init:
- Smart contract language and framework
- Wallet/auth library
- Frontend framework and component library
- Buyer Agent runtime (LLM provider, planning loop implementation)
- Marketplace indexer / data layer

## Workflow Notes

- This is a hackathon project. Bias toward shippable end-to-end vertical slices over horizontal completeness. A working Provider register → Buyer Agent discover → pay → invoke → settle loop on testnet beats polished isolated modules.
- Once code lands, replace this section with real commands (build, test, deploy, run a single test). Do not leave invented commands here.
- `git init` has not been run. Initialize the repo before the first commit; choose between a monorepo (contracts + frontend + agent in one tree) or split repos before the structure ossifies.
