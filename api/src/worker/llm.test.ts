// Determinism tests for MockLLMProvider. The DeepSeek path is exercised end-
// to-end behind a real env key — not in CI — but we test its plan-parsing
// behaviour against a fetch-stub here.

import { describe, expect, test, vi } from "vitest";
import {
  DeepSeekProvider,
  MockLLMProvider,
  type ToolDescription,
} from "./llm.js";

const TOOLS: ToolDescription[] = [
  {
    toolId: "1",
    toolVersion: 1,
    name: "expensive",
    priceWei: "100",
  },
  {
    toolId: "2",
    toolVersion: 1,
    name: "cheap",
    priceWei: "50",
  },
  {
    toolId: "3",
    toolVersion: 2,
    name: "medium",
    priceWei: "75",
  },
];

describe("MockLLMProvider", () => {
  test("picks cheapest tools first", async () => {
    const llm = new MockLLMProvider();
    const plan = await llm.generatePlan({
      taskPrompt: "write a tweet",
      availableTools: TOOLS,
      budgetWei: 1000n,
      maxPerCallWei: 1000n,
    });
    expect(plan.steps.length).toBe(2);
    expect(plan.steps[0]?.toolId).toBe("2"); // 50 wei
    expect(plan.steps[1]?.toolId).toBe("3"); // 75 wei
  });

  test("drops tools that exceed maxPerCall", async () => {
    const llm = new MockLLMProvider({ stepCount: 3 });
    const plan = await llm.generatePlan({
      taskPrompt: "tweet",
      availableTools: TOOLS,
      budgetWei: 10_000n,
      maxPerCallWei: 60n,
    });
    // only the "cheap" tool fits — 50 wei
    expect(plan.steps.length).toBe(1);
    expect(plan.steps[0]?.toolId).toBe("2");
  });

  test("integrate returns deterministic concatenated text", async () => {
    const llm = new MockLLMProvider();
    const r = await llm.integrate({
      taskPrompt: "x",
      stepOutputs: [
        { toolId: "2", stepIdx: 1, output: { ok: 1 } },
        { toolId: "3", stepIdx: 2, output: { ok: 2 } },
      ],
    });
    expect(r.text).toContain("mock integration");
    expect(r.text).toContain("step 1 tool 2");
    expect(r.text).toContain("step 2 tool 3");
  });
});

describe("DeepSeekProvider (with fetch stub)", () => {
  test("parses tool_calls back into PlanSteps", async () => {
    const fakeFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              index: 0,
              finish_reason: "tool_calls",
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "1",
                    type: "function",
                    function: {
                      name: "tool_2",
                      arguments: JSON.stringify({ prompt: "tweet" }),
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const llm = new DeepSeekProvider({
      apiKey: "test",
      fetchImpl: fakeFetch as unknown as typeof fetch,
    });
    const plan = await llm.generatePlan({
      taskPrompt: "tweet",
      availableTools: TOOLS,
      budgetWei: 10_000n,
      maxPerCallWei: 10_000n,
    });
    expect(plan.steps.length).toBe(1);
    expect(plan.steps[0]?.toolId).toBe("2");
    expect((plan.steps[0]?.input as { prompt: string }).prompt).toBe("tweet");
  });

  test("returns empty plan when assistant emits no tool_calls", async () => {
    const fakeFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: "no" },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const llm = new DeepSeekProvider({
      apiKey: "test",
      fetchImpl: fakeFetch as unknown as typeof fetch,
    });
    const plan = await llm.generatePlan({
      taskPrompt: "x",
      availableTools: TOOLS,
      budgetWei: 1000n,
      maxPerCallWei: 1000n,
    });
    expect(plan.steps.length).toBe(0);
  });
});
