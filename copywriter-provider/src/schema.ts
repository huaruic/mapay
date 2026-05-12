// Zod schemas for the copywriter tool I/O. These are the runtime guard rails;
// the same shape should round-trip into the on-chain Tool.schemaHash (the
// IPFS-stored MCP descriptor's inputSchema/outputSchema).

import { z } from "zod";

export const TONES = ["casual", "professional", "playful", "hype"] as const;
export type Tone = (typeof TONES)[number];

/** Outer envelope every AgentPay request uses (see §9). */
export const InvokeRequestSchema = z.object({
  input: z.object({
    topic: z.string().min(1).max(500),
    tone: z.enum(TONES),
    // The marketplace tool advertises this as a small integer; cap at 5 to
    // keep DeepSeek latency + spend bounded.
    count: z.number().int().min(1).max(5),
  }),
});
export type InvokeRequest = z.infer<typeof InvokeRequestSchema>;
export type CopywriterInput = InvokeRequest["input"];

export const CopywriterOutputSchema = z.object({
  tweets: z.array(z.string().min(1).max(280)),
  suggestedHashtags: z.array(z.string().min(1).max(40)),
});
export type CopywriterOutput = z.infer<typeof CopywriterOutputSchema>;

export const InvokeResponseSchema = z.object({
  output: CopywriterOutputSchema,
});
export type InvokeResponse = z.infer<typeof InvokeResponseSchema>;
