// Unit-level test of DeepSeekCopywriter: mock fetch, assert correct request
// shape, parsing, schema validation, and error handling. The on-chain
// middleware is bypassed here — see integration.test.ts for the full handler.

import { describe, expect, test, vi } from "vitest";
import { DeepSeekCopywriter, DeepSeekError } from "../src/llm.js";

function makeFetch(
  responseBody: object,
  init: { status?: number; ok?: boolean } = {},
): typeof fetch {
  const status = init.status ?? 200;
  return vi.fn(async () => {
    return new Response(JSON.stringify(responseBody), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

function deepseekShaped(content: string) {
  return {
    choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
  };
}

describe("DeepSeekCopywriter", () => {
  test("happy path: parses tweets + hashtags, returns exactly count", async () => {
    const fakeFetch = makeFetch(
      deepseekShaped(
        JSON.stringify({
          tweets: [
            "Tweet one about test topic, short and snappy",
            "Tweet two, equally tight and punchy for engagement",
            "Tweet three — the cherry on top, under 140 chars",
          ],
          suggestedHashtags: ["test", "ai", "agentpay"],
        }),
      ),
    );
    const client = new DeepSeekCopywriter({
      apiKey: "sk-fake",
      fetchImpl: fakeFetch,
    });
    const out = await client.generate({
      topic: "AI agents that pay for tools onchain",
      tone: "playful",
      count: 3,
    });

    expect(out.tweets).toHaveLength(3);
    for (const t of out.tweets) {
      expect(t.length).toBeLessThanOrEqual(140);
    }
    expect(out.suggestedHashtags.length).toBeGreaterThan(0);
    expect(fakeFetch).toHaveBeenCalledOnce();

    // Verify we hit the correct DeepSeek endpoint with model + auth.
    const [url, init] = (fakeFetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toMatch(/api\.deepseek\.com\/v1\/chat\/completions$/);
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer sk-fake",
    );
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("deepseek-chat");
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  test("trims content fenced with ```json``` (defensive)", async () => {
    const fakeFetch = makeFetch(
      deepseekShaped(
        "```json\n" +
          JSON.stringify({
            tweets: ["a short tweet", "another short tweet"],
            suggestedHashtags: ["t1"],
          }) +
          "\n```",
      ),
    );
    const client = new DeepSeekCopywriter({
      apiKey: "x",
      fetchImpl: fakeFetch,
    });
    const out = await client.generate({
      topic: "x",
      tone: "casual",
      count: 2,
    });
    expect(out.tweets).toHaveLength(2);
  });

  test("HTTP 502 from DeepSeek → throws DeepSeekError with code", async () => {
    const fakeFetch = makeFetch({ error: "down" }, { status: 502 });
    const client = new DeepSeekCopywriter({
      apiKey: "x",
      fetchImpl: fakeFetch,
    });
    await expect(
      client.generate({ topic: "x", tone: "casual", count: 1 }),
    ).rejects.toMatchObject({
      name: "DeepSeekError",
      code: "DEEPSEEK_HTTP_ERROR",
      status: 502,
    });
  });

  test("non-JSON content → DEEPSEEK_NONJSON_BODY", async () => {
    const fakeFetch = makeFetch(deepseekShaped("I am not JSON, sorry."));
    const client = new DeepSeekCopywriter({
      apiKey: "x",
      fetchImpl: fakeFetch,
    });
    await expect(
      client.generate({ topic: "x", tone: "casual", count: 1 }),
    ).rejects.toBeInstanceOf(DeepSeekError);
  });

  test("schema-invalid payload → DEEPSEEK_SCHEMA_INVALID", async () => {
    const fakeFetch = makeFetch(
      deepseekShaped(JSON.stringify({ tweets: "not-an-array" })),
    );
    const client = new DeepSeekCopywriter({
      apiKey: "x",
      fetchImpl: fakeFetch,
    });
    await expect(
      client.generate({ topic: "x", tone: "casual", count: 1 }),
    ).rejects.toMatchObject({
      code: "DEEPSEEK_SCHEMA_INVALID",
    });
  });

  test("fewer tweets than count → DEEPSEEK_INSUFFICIENT_TWEETS", async () => {
    const fakeFetch = makeFetch(
      deepseekShaped(
        JSON.stringify({
          tweets: ["only one"],
          suggestedHashtags: ["x"],
        }),
      ),
    );
    const client = new DeepSeekCopywriter({
      apiKey: "x",
      fetchImpl: fakeFetch,
    });
    await expect(
      client.generate({ topic: "x", tone: "casual", count: 3 }),
    ).rejects.toMatchObject({
      code: "DEEPSEEK_INSUFFICIENT_TWEETS",
    });
  });

  test("over-long tweets are filtered out, then count check applies", async () => {
    const oversize = "x".repeat(200);
    const fakeFetch = makeFetch(
      deepseekShaped(
        JSON.stringify({
          tweets: ["ok one", oversize, "ok two", "ok three"],
          suggestedHashtags: ["h"],
        }),
      ),
    );
    const client = new DeepSeekCopywriter({
      apiKey: "x",
      fetchImpl: fakeFetch,
    });
    const out = await client.generate({
      topic: "x",
      tone: "casual",
      count: 3,
    });
    expect(out.tweets).toEqual(["ok one", "ok two", "ok three"]);
  });
});
