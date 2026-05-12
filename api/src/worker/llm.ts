// LLMProvider abstraction (design doc §6.2).
//
// Two implementations:
//   - DeepSeekProvider: production. Hits the OpenAI-compatible DeepSeek API
//     and uses function-calling to constrain plan output to a strict schema.
//   - MockLLMProvider: deterministic in-process implementation used by tests.
//     Always picks the cheapest available tool first, fills `input` with
//     the task prompt verbatim, and produces a trivial integration summary.
//
// Neither provider talks to the chain or the DB. The Worker is the only
// component that holds those concerns.

export interface ToolDescription {
  toolId: string; // uint as decimal string
  toolVersion: number;
  name: string;
  description?: string;
  priceWei: string; // wei as decimal string
  // Optional MCP-shape input schema; LLM uses this when generating function call args.
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

export interface PlanStep {
  toolId: string;
  toolVersion: number;
  input: unknown; // JSON-serialisable
  expectedPriceWei: string;
}

export interface Plan {
  steps: PlanStep[];
  rationale?: string;
}

export interface StepOutput {
  toolId: string;
  stepIdx: number;
  output: unknown;
}

export interface FinalDeliverable {
  text: string;
  payload?: unknown;
}

export interface ParentContext {
  prompt: string;
  resultText: string | null;
}

export interface GeneratePlanInput {
  taskPrompt: string;
  parentContext?: ParentContext[];
  availableTools: ToolDescription[];
  budgetWei: bigint;
  maxPerCallWei: bigint;
}

export interface IntegrateInput {
  taskPrompt: string;
  stepOutputs: StepOutput[];
}

export interface LLMProvider {
  generatePlan(input: GeneratePlanInput): Promise<Plan>;
  integrate(input: IntegrateInput): Promise<FinalDeliverable>;
}

// ── Mock provider ──────────────────────────────────────────────────────────

export interface MockLLMProviderOptions {
  /** Force fixed step count. Defaults to min(2, available tools). */
  stepCount?: number;
  /** If true, picks tools in order rather than by price ascending. */
  preserveOrder?: boolean;
}

export class MockLLMProvider implements LLMProvider {
  constructor(private readonly opts: MockLLMProviderOptions = {}) {}

  async generatePlan(input: GeneratePlanInput): Promise<Plan> {
    const sorted = this.opts.preserveOrder
      ? [...input.availableTools]
      : [...input.availableTools].sort((a, b) => {
          const ai = BigInt(a.priceWei);
          const bi = BigInt(b.priceWei);
          if (ai === bi) return 0;
          return ai < bi ? -1 : 1;
        });
    const want = this.opts.stepCount ?? Math.min(2, sorted.length);
    const steps: PlanStep[] = [];
    for (const t of sorted.slice(0, want)) {
      const price = BigInt(t.priceWei);
      // Hard refuse to exceed maxPerCall; surface it as an empty plan so the
      // Worker fails fast in validation.
      if (price > input.maxPerCallWei) continue;
      steps.push({
        toolId: t.toolId,
        toolVersion: t.toolVersion,
        input: { prompt: input.taskPrompt },
        expectedPriceWei: t.priceWei,
      });
    }
    return {
      steps,
      rationale: `mock plan: ${steps.length} step(s) cheapest-first`,
    };
  }

  async integrate(input: IntegrateInput): Promise<FinalDeliverable> {
    const lines = input.stepOutputs.map(
      (s) => `[step ${s.stepIdx} tool ${s.toolId}] ${JSON.stringify(s.output)}`,
    );
    return {
      text: `mock integration of "${input.taskPrompt}":\n${lines.join("\n")}`,
      payload: { stepCount: input.stepOutputs.length },
    };
  }
}

// ── DeepSeek provider ──────────────────────────────────────────────────────

export interface DeepSeekProviderOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string; // defaults to deepseek-chat
  fetchImpl?: typeof fetch;
}

interface DeepSeekToolCall {
  id?: string;
  type?: "function";
  function: { name: string; arguments: string };
}

interface DeepSeekMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: DeepSeekToolCall[];
  tool_call_id?: string;
}

interface DeepSeekChoice {
  index: number;
  message: DeepSeekMessage;
  finish_reason: string;
}

interface DeepSeekResponse {
  choices: DeepSeekChoice[];
}

const DEFAULT_BASE = "https://api.deepseek.com/v1";

export class DeepSeekProvider implements LLMProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetch: typeof fetch;

  constructor(opts: DeepSeekProviderOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE;
    this.model = opts.model ?? "deepseek-chat";
    this.fetch = opts.fetchImpl ?? fetch;
  }

  async generatePlan(input: GeneratePlanInput): Promise<Plan> {
    const tools = input.availableTools.map((t) => ({
      type: "function" as const,
      function: {
        name: `tool_${t.toolId}`,
        description: `${t.name} — ${t.description ?? ""} (price ${t.priceWei} wei)`,
        parameters: t.inputSchema ?? {
          type: "object",
          properties: {
            prompt: { type: "string" },
          },
          required: ["prompt"],
        },
      },
    }));

    const sysParts: string[] = [
      "You are a Buyer Agent planning open-loop multi-step tool calls.",
      "Output exactly one assistant message containing a sequence of tool_calls representing the plan, then stop.",
      `Budget: ${input.budgetWei.toString()} wei. Max per call: ${input.maxPerCallWei.toString()} wei.`,
      "Cheaper tools preferred. Do not exceed max-per-call. Do not exceed total budget.",
    ];
    if (input.parentContext?.length) {
      sysParts.push("Prior tasks for context (most recent last):");
      for (const p of input.parentContext) {
        sysParts.push(
          `- prompt: ${p.prompt}\n  result: ${p.resultText ?? "<none>"}`,
        );
      }
    }

    const messages: DeepSeekMessage[] = [
      { role: "system", content: sysParts.join("\n") },
      { role: "user", content: input.taskPrompt },
    ];

    const res = await this.callChat({ messages, tools, toolChoice: "auto" });
    const msg = res.choices[0]?.message;
    if (!msg || !msg.tool_calls?.length) {
      return { steps: [], rationale: "deepseek: no tool calls returned" };
    }

    const steps: PlanStep[] = [];
    for (const tc of msg.tool_calls) {
      const name = tc.function.name;
      const m = /^tool_(.+)$/.exec(name);
      if (!m) continue;
      const toolId = m[1] as string;
      const t = input.availableTools.find((x) => x.toolId === toolId);
      if (!t) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(tc.function.arguments);
      } catch {
        parsed = { prompt: input.taskPrompt };
      }
      steps.push({
        toolId: t.toolId,
        toolVersion: t.toolVersion,
        input: parsed,
        expectedPriceWei: t.priceWei,
      });
    }
    return { steps };
  }

  async integrate(input: IntegrateInput): Promise<FinalDeliverable> {
    const summaryParts = input.stepOutputs.map(
      (s) =>
        `Step ${s.stepIdx} (tool ${s.toolId}): ${JSON.stringify(s.output)}`,
    );
    const messages: DeepSeekMessage[] = [
      {
        role: "system",
        content:
          "You produced these tool outputs for the user task. Combine them into a single coherent final deliverable as plain text.",
      },
      {
        role: "user",
        content: `Task: ${input.taskPrompt}\n\nTool outputs:\n${summaryParts.join("\n")}`,
      },
    ];
    const res = await this.callChat({ messages });
    const text = res.choices[0]?.message?.content ?? "";
    return { text, payload: { steps: input.stepOutputs.length } };
  }

  private async callChat(args: {
    messages: DeepSeekMessage[];
    tools?: unknown[];
    toolChoice?: "auto" | "none";
  }): Promise<DeepSeekResponse> {
    const body = {
      model: this.model,
      messages: args.messages,
      ...(args.tools ? { tools: args.tools, tool_choice: args.toolChoice ?? "auto" } : {}),
    };
    const res = await this.fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`deepseek ${res.status}: ${text}`);
    }
    return (await res.json()) as DeepSeekResponse;
  }
}

/** Factory: builds DeepSeekProvider when env vars are present, else MockLLMProvider. */
export function makeLLMProvider(env: NodeJS.ProcessEnv = process.env): LLMProvider {
  if (env.DEEPSEEK_API_KEY) {
    return new DeepSeekProvider({
      apiKey: env.DEEPSEEK_API_KEY,
      baseUrl: env.DEEPSEEK_BASE_URL,
    });
  }
  return new MockLLMProvider();
}
