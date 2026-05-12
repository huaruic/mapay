"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { ArrowLeft, Loader2, ShieldCheck } from "lucide-react";
import { parseEther } from "viem";
import { useAccount, useSendTransaction, useWaitForTransactionReceipt } from "wagmi";
import { z } from "zod";
import { AppShell, PageHeader } from "@/components/app-shell";
import { SectionTitle, StatusPill } from "@/components/ui";
import { SubmitButton, TextArea, TextField } from "@/components/forms/text-field";
import { ApiError, prepareCreateAgent } from "@/lib/api-end-user";

// Why zod here even though @hookform/resolvers isn't installed: we run zod
// manually in `handleSubmit` so the same schema can be unit-tested standalone
// and so the API + UI share validation rules. Single source of truth on the
// frontend; backend re-validates everything.
const monAmount = z
  .string()
  .regex(/^\d+(\.\d{1,18})?$/, "请输入合法的 MON 数额（最多 18 位小数）")
  .refine((s) => {
    try {
      return parseEther(s) > BigInt(0);
    } catch {
      return false;
    }
  }, "数额必须 > 0");

export const createAgentSchema = z
  .object({
    name: z.string().trim().min(1, "必填").max(50, "≤ 50 字符"),
    goal: z.string().trim().min(1, "必填").max(500, "≤ 500 字符"),
    totalBudget: monAmount,
    maxPerCall: monAmount,
    dailySpendCap: monAmount,
  })
  .refine(
    (d) => parseEther(d.maxPerCall) <= parseEther(d.totalBudget),
    { message: "max-per-call 必须 ≤ total budget", path: ["maxPerCall"] },
  )
  .refine(
    (d) => parseEther(d.dailySpendCap) >= parseEther(d.maxPerCall),
    { message: "daily cap 必须 ≥ max-per-call", path: ["dailySpendCap"] },
  )
  .refine(
    (d) => parseEther(d.dailySpendCap) <= parseEther(d.totalBudget),
    { message: "daily cap 必须 ≤ total budget", path: ["dailySpendCap"] },
  );

export type CreateAgentForm = z.infer<typeof createAgentSchema>;

type Phase = "idle" | "preparing" | "awaiting-signature" | "confirming" | "done" | "error";

export default function NewAgentPage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const {
    sendTransactionAsync,
  } = useSendTransaction();
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingAgentId, setPendingAgentId] = useState<string | null>(null);

  // Block until receipt for visual feedback. Track D will replace the
  // post-receipt navigation with a chain-event read once the watcher is live.
  const { isLoading: waitingReceipt, isSuccess: receiptOk } =
    useWaitForTransactionReceipt({ hash: txHash });

  if (receiptOk && phase !== "done") {
    setPhase("done");
    // 后端在创建前无法预测链上 agentId（合约 nextAgentId 才是 source of truth），
    // expectedAgentId 多半是 null。跳到列表页让用户看到新 agent；watcher 会几秒内
    // 同步进 DB/缓存。要精确跳详情页，需要解析 receipt 里的 AgentCreated event。
    if (pendingAgentId) {
      router.push(`/agents/${pendingAgentId}`);
    } else {
      router.push("/agents");
    }
  }

  const {
    register,
    handleSubmit,
    formState: { errors: rhfErrors },
    setError,
  } = useForm<CreateAgentForm>({
    defaultValues: {
      name: "Marketing Agent",
      goal: "生成 3 条带配图的 SaaS 发布推文",
      totalBudget: "0.5",
      maxPerCall: "0.15",
      dailySpendCap: "0.3",
    },
  });

  async function onSubmit(values: CreateAgentForm) {
    setErrorMessage(null);
    // Manual zod validation step (no @hookform/resolvers in deps).
    const parsed = createAgentSchema.safeParse(values);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const path = issue.path[0] as keyof CreateAgentForm | undefined;
        if (path) setError(path, { message: issue.message });
      }
      return;
    }

    if (!isConnected || !address) {
      setErrorMessage("请先连接钱包");
      return;
    }

    try {
      setPhase("preparing");
      const prepared = await prepareCreateAgent(parsed.data);
      setPendingAgentId(prepared.expectedAgentId ?? null);

      setPhase("awaiting-signature");
      const hash = await sendTransactionAsync({
        to: prepared.calldata.to,
        data: prepared.calldata.data,
        value: BigInt(prepared.calldata.value),
      });
      setTxHash(hash);
      setPhase("confirming");
    } catch (err) {
      console.error(err);
      setPhase("error");
      if (err instanceof ApiError) {
        setErrorMessage(`API error: ${err.status}`);
      } else if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage("未知错误");
      }
    }
  }

  const submitting =
    phase === "preparing" ||
    phase === "awaiting-signature" ||
    phase === "confirming" ||
    waitingReceipt;

  return (
    <AppShell>
      <PageHeader
        eyebrow="Create buyer agent"
        title="启动一个带预算与单次上限的 Buyer Agent."
        description="填写 name、goal 和 policy 参数。提交后由合约同时完成创建与充值——之后所有 tool 调用都在合约预算守门下进行，LLM 无法越界。"
        action={<StatusPill>One-shot tx</StatusPill>}
      />

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <form
          className="panel-flat grid gap-4 p-5"
          onSubmit={handleSubmit(onSubmit)}
          noValidate
        >
          <SectionTitle label="Agent identity" title="Policy-Bounded Wallet" />

          <TextField
            label="Agent name"
            placeholder="Marketing Agent"
            maxLength={50}
            {...register("name")}
            error={rhfErrors.name?.message}
          />

          <TextArea
            label="Goal"
            placeholder="生成 3 条带配图的 SaaS 发布推文"
            rows={4}
            maxLength={500}
            {...register("goal")}
            error={rhfErrors.goal?.message}
          />

          <div className="grid gap-4 md:grid-cols-3">
            <TextField
              label="Total budget (MON)"
              placeholder="0.5"
              inputMode="decimal"
              {...register("totalBudget")}
              error={rhfErrors.totalBudget?.message}
              hint="一次性预存进协议的总预算"
            />
            <TextField
              label="Max per call (MON)"
              placeholder="0.15"
              inputMode="decimal"
              {...register("maxPerCall")}
              error={rhfErrors.maxPerCall?.message}
              hint="单次 tool 调用上限"
            />
            <TextField
              label="Daily spend cap (MON)"
              placeholder="0.3"
              inputMode="decimal"
              {...register("dailySpendCap")}
              error={rhfErrors.dailySpendCap?.message}
              hint="每日累计上限"
            />
          </div>

          <div className="rounded-[6px] border border-[var(--line)] bg-white p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck size={16} className="text-[var(--green-dark)]" />
              Protocol enforced
            </div>
            <p className="text-sm leading-6 text-[var(--muted)]">
              合约 `pay()` 内置 require()，拒绝超过 balance / max-per-call / daily cap 的请求。LLM 只能计划，越界由协议层兜底。
            </p>
          </div>

          {errorMessage ? (
            <div className="rounded-[6px] border border-red-300 bg-red-50 p-3 text-sm text-red-700" role="alert">
              {errorMessage}
            </div>
          ) : null}

          <div className="flex items-center gap-3">
            {!isConnected ? (
              <span className="text-sm text-[var(--muted)]">
                请先在右上角连接钱包后再 Create &amp; Fund.
              </span>
            ) : (
              <SubmitButton disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 animate-spin" size={16} />
                    {phase === "preparing"
                      ? "Preparing calldata…"
                      : phase === "awaiting-signature"
                        ? "Waiting for wallet…"
                        : "Confirming on Monad…"}
                  </>
                ) : (
                  "Create & Fund on Monad"
                )}
              </SubmitButton>
            )}
            <Link
              href="/agents"
              className="inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--foreground)]"
            >
              <ArrowLeft size={14} /> 返回 agents
            </Link>
          </div>
        </form>

        <aside className="panel-flat p-5">
          <SectionTitle label="What happens next" title="One signature, full setup" />
          <ol className="space-y-3 text-sm leading-6 text-[var(--muted)]">
            <li>
              <span className="mono mr-2 inline-flex h-5 min-w-5 items-center justify-center rounded-[6px] border border-[var(--line)] bg-white text-[10px]">1</span>
              后端为这个 agent 生成一个 burner operator 地址，并打包 `createAndFundAgent` calldata。
            </li>
            <li>
              <span className="mono mr-2 inline-flex h-5 min-w-5 items-center justify-center rounded-[6px] border border-[var(--line)] bg-white text-[10px]">2</span>
              你的钱包签一笔合并的 tx：mint Passport NFT + 把 total budget 转入合约。
            </li>
            <li>
              <span className="mono mr-2 inline-flex h-5 min-w-5 items-center justify-center rounded-[6px] border border-[var(--line)] bg-white text-[10px]">3</span>
              tx 上链后跳到 agent workspace，可以立即提交第一个 task。
            </li>
          </ol>
        </aside>
      </section>
    </AppShell>
  );
}
