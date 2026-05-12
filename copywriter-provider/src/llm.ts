// DeepSeek chat-completion client, self-contained for the copywriter tool.
//
// We deliberately do NOT depend on api/src/worker/llm.ts: that module is built
// around tool-use (function calling) for plan generation. Here we only need
// a single chat completion that returns a JSON object containing tweets +
// hashtags. Duplicating ~40 lines is much cheaper than dragging an unrelated
// abstraction across the package boundary.

import type { CopywriterInput, CopywriterOutput, Tone } from "./schema.js";
import { CopywriterOutputSchema } from "./schema.js";

const DEFAULT_BASE = "https://api.deepseek.com/v1";
const DEFAULT_MODEL = "deepseek-chat";

export interface DeepSeekClientOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  /** Override for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

interface DeepSeekMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface DeepSeekChoice {
  message?: { content?: string | null };
  finish_reason?: string;
}

interface DeepSeekResponse {
  choices?: DeepSeekChoice[];
}

export class DeepSeekError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "DeepSeekError";
  }
}

const TONE_HINT: Record<Tone, string> = {
  casual: "friendly, conversational, slightly informal",
  professional: "polished, authoritative, trustworthy",
  playful: "witty, fun, light-hearted, allowed to be a bit cheeky",
  hype: "high-energy, urgent, exclamation-friendly, FOMO-driving",
};

function buildSystemPrompt(): string {
  return [
    "You are an elite marketing copywriter for social media. Your only job",
    "is to write short, punchy tweets that fit the user's topic + tone.",
    "",
    "Rules:",
    "- Auto-detect the language of the topic. If the topic is primarily",
    "  Chinese, write the tweets in Chinese. Otherwise write in English.",
    "- Each tweet must be UNDER 140 characters (count characters, not bytes).",
    "- Generate exactly the requested number of tweets, no more, no less.",
    "- Also generate 3–6 relevant hashtags (no leading '#' required, the",
    "  client may add it). Hashtags share the language of the tweets.",
    "- Return ONLY a single JSON object, no prose, no markdown fences.",
    "- JSON shape: {\"tweets\":[\"...\",\"...\"],\"suggestedHashtags\":[\"...\"]}",
  ].join("\n");
}

function buildUserPrompt(input: CopywriterInput): string {
  return [
    `Topic: ${input.topic}`,
    `Tone: ${input.tone} (${TONE_HINT[input.tone]})`,
    `Count: ${input.count}`,
    "",
    "Return only the JSON object described in the system prompt.",
  ].join("\n");
}

/**
 * Strip ```json ... ``` fences or stray prose around a JSON object.
 * DeepSeek is usually obedient with `response_format: json_object` but we
 * keep this as belt-and-suspenders.
 */
function extractJson(text: string): string {
  const trimmed = text.trim();
  // Fast path: looks like raw JSON already.
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  // Try ```json fenced block.
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fence?.[1]) return fence[1].trim();
  // Last-ditch: first { ... last }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

export class DeepSeekCopywriter {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetch: typeof fetch;

  constructor(opts: DeepSeekClientOptions) {
    if (!opts.apiKey) {
      throw new Error("DeepSeekCopywriter: apiKey is required");
    }
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE;
    this.model = opts.model ?? DEFAULT_MODEL;
    this.fetch = opts.fetchImpl ?? fetch;
  }

  async generate(input: CopywriterInput): Promise<CopywriterOutput> {
    const body = {
      model: this.model,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: buildUserPrompt(input) },
      ] satisfies DeepSeekMessage[],
      // DeepSeek supports OpenAI-style response_format for guaranteed JSON.
      response_format: { type: "json_object" },
      temperature: 0.8,
    };

    let res: Response;
    try {
      res = await this.fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new DeepSeekError(
        "DEEPSEEK_NETWORK",
        `deepseek fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new DeepSeekError(
        "DEEPSEEK_HTTP_ERROR",
        `deepseek ${res.status}: ${errBody.slice(0, 300)}`,
        res.status,
      );
    }

    let parsed: DeepSeekResponse;
    try {
      parsed = (await res.json()) as DeepSeekResponse;
    } catch (err) {
      throw new DeepSeekError(
        "DEEPSEEK_BAD_JSON",
        `deepseek response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const content = parsed.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      throw new DeepSeekError(
        "DEEPSEEK_EMPTY",
        "deepseek returned no assistant content",
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(extractJson(content));
    } catch (err) {
      throw new DeepSeekError(
        "DEEPSEEK_NONJSON_BODY",
        `failed to parse JSON from deepseek content: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const validated = CopywriterOutputSchema.safeParse(payload);
    if (!validated.success) {
      throw new DeepSeekError(
        "DEEPSEEK_SCHEMA_INVALID",
        `deepseek output failed schema: ${validated.error.message}`,
      );
    }

    // Enforce the contract caller expects: exactly `count` tweets, each <140 chars.
    let tweets = validated.data.tweets.filter((t) => t.length <= 140);
    if (tweets.length < input.count) {
      // Don't silently pad; surface the discrepancy. The provider middleware
      // has already consumed the receipt by this point, so a 502 here is the
      // documented protocol-normal "paid + provider failed" path (§9.2).
      throw new DeepSeekError(
        "DEEPSEEK_INSUFFICIENT_TWEETS",
        `deepseek returned ${tweets.length} valid tweets, needed ${input.count}`,
      );
    }
    tweets = tweets.slice(0, input.count);

    return {
      tweets,
      suggestedHashtags: validated.data.suggestedHashtags,
    };
  }
}
