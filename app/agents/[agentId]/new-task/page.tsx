"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { ArrowLeft, Loader2 } from "lucide-react";
import { z } from "zod";
import { AppShell, PageHeader } from "@/components/app-shell";
import { SectionTitle, StatusPill } from "@/components/ui";
import { SubmitButton, TextArea } from "@/components/forms/text-field";
import {
  ApiError,
  getAgent,
  getTask,
  submitTask,
  type AgentDetail,
  type TaskSnapshot,
} from "@/lib/api-end-user";

export const newTaskSchema = z.object({
  prompt: z.string().trim().min(1, "请输入任务描述").max(2000, "≤ 2000 字符"),
});

type FormValues = z.infer<typeof newTaskSchema>;

export default function NewTaskPage() {
  const router = useRouter();
  const params = useParams<{ agentId: string }>();
  const searchParams = useSearchParams();
  const agentId = params?.agentId ?? "";
  const parentTaskId = searchParams?.get("parent") ?? null;

  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [parentTask, setParentTask] = useState<TaskSnapshot | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Build a smart default prompt when re-running off a parent task.
  const initialPrompt = parentTaskId
    ? `基于上一轮 (Task ${parentTaskId.slice(0, 8)}) 的产物，请...`
    : "";

  const {
    register,
    handleSubmit,
    formState: { errors: rhfErrors },
    setError,
    setValue,
  } = useForm<FormValues>({ defaultValues: { prompt: initialPrompt } });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const a = await getAgent(agentId);
        if (!cancelled) setAgent(a);
      } catch {
        // Non-fatal — page still works for submitting; show null state.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  useEffect(() => {
    if (!parentTaskId) return;
    let cancelled = false;
    (async () => {
      try {
        const p = await getTask(parentTaskId);
        if (!cancelled) {
          setParentTask(p);
          // Refresh the prefill once we know more about the parent.
          setValue(
            "prompt",
            `基于上一轮的产物（Task ${parentTaskId.slice(0, 8)} · ${p.prompt.slice(0, 60)}），请...`,
          );
        }
      } catch {
        // Best-effort prefill — leave the boilerplate.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [parentTaskId, setValue]);

  async function onSubmit(values: FormValues) {
    setErrorMessage(null);
    const parsed = newTaskSchema.safeParse(values);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const path = issue.path[0] as keyof FormValues | undefined;
        if (path) setError(path, { message: issue.message });
      }
      return;
    }
    try {
      setSubmitting(true);
      const { taskId } = await submitTask(agentId, {
        prompt: parsed.data.prompt,
        parentTaskId: parentTaskId ?? undefined,
      });
      // Redirect to workspace — Timeline picks up via SSE on mount.
      router.push(`/agents/${agentId}?task=${taskId}`);
    } catch (err) {
      console.error(err);
      if (err instanceof ApiError) {
        setErrorMessage(`API error: ${err.status}`);
      } else if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage("未知错误");
      }
      setSubmitting(false);
    }
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow="Submit task"
        title="给 Buyer Agent 一份新的工作单."
        description={
          parentTaskId
            ? "基于上一轮 task 产物的延伸调整——agent 会沿用历史 plan 上下文重新执行。"
            : "提交后 agent 自主执行，无需任何中间签名。完成前你只是旁观。"
        }
        action={<StatusPill>fire-and-forget</StatusPill>}
      />

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <form
          className="panel-flat grid gap-4 p-5"
          onSubmit={handleSubmit(onSubmit)}
          noValidate
        >
          <SectionTitle label="Prompt" title="任务描述" />
          <TextArea
            label="Task prompt"
            placeholder="例如：生成 3 条带配图的 SaaS 发布推文"
            rows={8}
            maxLength={2000}
            {...register("prompt")}
            error={rhfErrors.prompt?.message}
          />

          {parentTask ? (
            <div className="rounded-[6px] border border-[var(--line)] bg-white p-3 text-sm text-[var(--muted)]">
              <div className="mb-1 font-semibold text-[var(--foreground)]">
                Parent task · {parentTaskId?.slice(0, 8)}
              </div>
              <p className="leading-6">{parentTask.prompt}</p>
            </div>
          ) : null}

          {errorMessage ? (
            <div className="rounded-[6px] border border-red-300 bg-red-50 p-3 text-sm text-red-700" role="alert">
              {errorMessage}
            </div>
          ) : null}

          <div className="flex items-center gap-3">
            <SubmitButton disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 animate-spin" size={16} />
                  Submitting…
                </>
              ) : (
                "Submit task"
              )}
            </SubmitButton>
            <Link
              href={`/agents/${agentId}`}
              className="inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--foreground)]"
            >
              <ArrowLeft size={14} /> 返回 workspace
            </Link>
          </div>
        </form>

        <aside className="panel-flat p-5">
          <SectionTitle label="Agent state" title="预算与历史" />
          {agent ? (
            <div className="grid gap-3 text-sm">
              <div className="flex items-center justify-between border-b border-[var(--line)] pb-2">
                <span className="text-[var(--muted)]">Name</span>
                <span className="font-semibold">{agent.name}</span>
              </div>
              <div className="flex items-center justify-between border-b border-[var(--line)] pb-2">
                <span className="text-[var(--muted)]">Balance</span>
                <span className="mono font-semibold">{agent.balance} MON</span>
              </div>
              <div className="flex items-center justify-between border-b border-[var(--line)] pb-2">
                <span className="text-[var(--muted)]">Max per call</span>
                <span className="mono font-semibold">{agent.maxPerCall} MON</span>
              </div>
              <div className="flex items-center justify-between border-b border-[var(--line)] pb-2">
                <span className="text-[var(--muted)]">Daily cap</span>
                <span className="mono font-semibold">{agent.dailySpendCap} MON</span>
              </div>
              <div className="flex items-center justify-between border-b border-[var(--line)] pb-2">
                <span className="text-[var(--muted)]">Tasks completed</span>
                <span className="mono font-semibold">{agent.tasks}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--muted)]">Reputation</span>
                <span className="mono font-semibold">{agent.reputation}</span>
              </div>
            </div>
          ) : (
            <div className="text-sm text-[var(--muted)]">Loading agent state…</div>
          )}
        </aside>
      </section>
    </AppShell>
  );
}
