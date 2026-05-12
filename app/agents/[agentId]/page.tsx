"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  Bot,
  Coins,
  Copy,
  ExternalLink,
  FileCheck2,
  Image as ImageIcon,
  Plus,
  Star,
} from "lucide-react";
import { useSendTransaction } from "wagmi";
import { AppShell, PageHeader } from "@/components/app-shell";
import { SectionTitle, StatusPill } from "@/components/ui";
import {
  ApiError,
  getAgent,
  getTask,
  prepareRateTask,
  type AgentDetail,
  type TaskSnapshot,
} from "@/lib/api-end-user";
import { subscribeTaskEvents, type TaskStreamEvent } from "@/lib/sse";
import { services } from "@/lib/mock-data";

// Render order + icon mapping for events streamed from the backend. Keys must
// stay in sync with api/src/routes/tasks.ts DEMO_EVENT_SEQUENCE.
const EVENT_LABELS: Record<string, { label: string; icon: typeof BadgeCheck }> = {
  "plan.generated": { label: "Generate open-loop plan", icon: Bot },
  "tool.discovered": { label: "Discover marketplace tools", icon: BadgeCheck },
  "tool.call.started": { label: "Invoke tool", icon: Coins },
  "payment.confirmed": { label: "Payment confirmed", icon: Coins },
  "tool.call.completed": { label: "Tool output received", icon: BadgeCheck },
  "tool.call.failed": { label: "Tool call failed", icon: FileCheck2 },
  "integration.started": { label: "Synthesize deliverable", icon: FileCheck2 },
  "task.completed": { label: "Task complete", icon: BadgeCheck },
  "task.failed": { label: "Task failed", icon: FileCheck2 },
};

const PRIMARY_BTN_CLASS =
  "inline-flex items-center justify-center rounded-[6px] bg-[var(--graphite)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60";
const SECONDARY_BTN_CLASS =
  "inline-flex items-center justify-center rounded-[6px] border border-[var(--line)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--graphite)]";

type DeliverableShape = {
  kind?: string;
  items?: Array<{ title: string; copy: string; time?: string; tag?: string }>;
};

export default function AgentWorkspacePage() {
  const params = useParams<{ agentId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const agentId = params?.agentId ?? "";

  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [task, setTask] = useState<TaskSnapshot | null>(null);
  const [events, setEvents] = useState<TaskStreamEvent[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rating, setRating] = useState<{
    pending: boolean;
    error: string | null;
  }>({ pending: false, error: null });

  const { sendTransactionAsync } = useSendTransaction();

  // Fetch agent.
  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    (async () => {
      try {
        const a = await getAgent(agentId);
        if (!cancelled) setAgent(a);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          setLoadError("请先连接钱包登录.");
        } else if (err instanceof ApiError && err.status === 404) {
          setLoadError("Agent 不存在或无权访问.");
        } else {
          setLoadError(
            err instanceof Error ? err.message : "Failed to load agent",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  // Determine which task to subscribe to. Priority:
  //   1. ?task=<id> query param (set after submitTask)
  //   2. agent.currentTaskId from backend
  const targetTaskId = useMemo(() => {
    return search?.get("task") ?? agent?.currentTaskId ?? null;
  }, [search, agent?.currentTaskId]);

  // Initial task snapshot fetch.
  useEffect(() => {
    if (!targetTaskId) {
      setTask(null);
      setEvents([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const t = await getTask(targetTaskId);
        if (cancelled) return;
        setTask(t);
        setEvents(
          t.events.map((e) => ({
            seq: e.seq,
            taskId: e.taskId,
            type: e.type,
            ...(e.payload ?? {}),
          })),
        );
      } catch {
        // Non-fatal: SSE subscription will populate.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [targetTaskId]);

  // SSE subscription. Re-runs whenever targetTaskId changes.
  useEffect(() => {
    if (!targetTaskId) return;
    const sub = subscribeTaskEvents(targetTaskId, {
      onEvent: (evt) => {
        setEvents((prev) => {
          // De-dupe on seq in case the initial snapshot already included this
          // event (race between the GET and the first SSE flush).
          if (prev.some((p) => p.seq === evt.seq)) return prev;
          return [...prev, evt].sort((a, b) => a.seq - b.seq);
        });
        if (evt.type === "task.completed" || evt.type === "task.failed") {
          // Re-fetch task snapshot so deliverable + status are populated.
          getTask(targetTaskId)
            .then((t) => setTask(t))
            .catch(() => {});
          getAgent(agentId)
            .then((a) => setAgent(a))
            .catch(() => {});
        }
      },
    });
    return () => sub.close();
  }, [targetTaskId, agentId]);

  // Find the last "active" event (the most recent one before task.completed).
  const taskCompleted = events.some((e) => e.type === "task.completed");
  const taskFailed = events.some((e) => e.type === "task.failed");

  const handleRate = useCallback(async () => {
    if (!task) return;
    setRating({ pending: true, error: null });
    try {
      const prepared = await prepareRateTask(task.id, 5);
      await sendTransactionAsync({
        to: prepared.calldata.to,
        data: prepared.calldata.data,
        value: BigInt(prepared.calldata.value),
      });
      setRating({ pending: false, error: null });
    } catch (err) {
      setRating({
        pending: false,
        error: err instanceof Error ? err.message : "rate failed",
      });
    }
  }, [task, sendTransactionAsync]);

  const handleAdjust = useCallback(() => {
    if (!task) return;
    router.push(`/agents/${agentId}/new-task?parent=${task.id}`);
  }, [router, agentId, task]);

  const deliverable = (task?.deliverable as DeliverableShape | null) ?? null;

  return (
    <AppShell>
      <PageHeader
        eyebrow="Agent execution workspace"
        title={
          agent
            ? `${agent.name} ${taskCompleted ? "已完成" : "正在执行任务"}`
            : "Agent workspace"
        }
        description="Open-loop plan 已生成；每次 tool 调用前先写入 PaymentReceipt，wrapper 验证 receipt 后才执行真实 AI 服务。"
        action={
          <StatusPill>
            {taskCompleted ? "Run complete" : task ? "Autonomous run" : "Idle"}
          </StatusPill>
        }
      />

      {loadError ? (
        <div className="panel-flat p-6 text-sm text-[var(--muted)]" role="alert">
          {loadError}
        </div>
      ) : (
        <section className="grid gap-6 xl:grid-cols-[0.8fr_1.15fr_1fr]">
          <aside className="panel-flat p-5">
            <SectionTitle label="Policy wallet" title="Agent state" />
            <div className="receipt-grid mb-5 rounded-[6px] border border-[var(--line)] bg-white p-4">
              <div className="mono text-xs text-[var(--muted)]">Passport NFT</div>
              <div className="mt-8 text-4xl font-semibold">#{agent?.id ?? agentId}</div>
              <div className="mt-2 text-sm text-[var(--muted)]">{agent?.owner ?? "—"}</div>
            </div>
            <div className="grid gap-3">
              {[
                ["Balance", agent ? `${agent.balance} MON` : "—"],
                ["Max per call", agent ? `${agent.maxPerCall} MON` : "—"],
                ["Daily cap", agent ? `${agent.dailySpendCap} MON` : "—"],
                ["Reputation", agent ? String(agent.reputation) : "—"],
                ["Task history", agent ? `${agent.tasks} tasks` : "—"],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-center justify-between border-b border-[var(--line)] pb-3"
                >
                  <span className="text-sm text-[var(--muted)]">{label}</span>
                  <span className="mono font-semibold">{value}</span>
                </div>
              ))}
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button className={SECONDARY_BTN_CLASS} type="button">
                Deposit
              </button>
              <button className={SECONDARY_BTN_CLASS} type="button">
                Withdraw
              </button>
            </div>
          </aside>

          <section className="panel-flat p-5">
            <SectionTitle
              label="Task"
              title={task?.prompt ?? "Submit your first task"}
            />
            {!task ? (
              <div className="grid gap-3 rounded-[6px] border border-dashed border-[var(--line)] bg-white p-6 text-center text-sm text-[var(--muted)]">
                <p>
                  此 agent 还没有任务历史。Submit task 后会出现实时 Timeline 与最终交付物。
                </p>
                <div>
                  <Link
                    href={`/agents/${agentId}/new-task`}
                    className={PRIMARY_BTN_CLASS}
                  >
                    <Plus className="mr-2" size={16} />
                    Submit your first task
                  </Link>
                </div>
              </div>
            ) : (
              <>
                <div className="mb-5 rounded-[6px] border border-[var(--line)] bg-white p-4">
                  <div className="text-sm text-[var(--muted)]">Submitted prompt</div>
                  <p className="mt-2 leading-7">{task.prompt}</p>
                </div>

                <div className="space-y-3" data-testid="timeline">
                  {events.length === 0 ? (
                    <div className="text-sm text-[var(--muted)]">
                      等待 worker 启动…
                    </div>
                  ) : (
                    events.map((event, index) => {
                      const meta = EVENT_LABELS[event.type] ?? {
                        label: event.type,
                        icon: BadgeCheck,
                      };
                      const Icon = meta.icon;
                      const isLast = index === events.length - 1;
                      const active =
                        isLast && !taskCompleted && !taskFailed;
                      return (
                        <div
                          key={event.seq}
                          className="grid grid-cols-[auto_1fr] gap-3"
                          data-event-type={event.type}
                        >
                          <div className="flex flex-col items-center">
                            <div
                              className={`grid h-10 w-10 place-items-center rounded-[6px] border ${active ? "border-[var(--green)] bg-[rgba(40,214,127,0.12)] text-[var(--green-dark)]" : "border-[var(--line)] bg-white text-[var(--muted)]"}`}
                            >
                              <Icon size={18} />
                            </div>
                            {!isLast ? (
                              <div className="h-8 w-px bg-[var(--line)]" />
                            ) : null}
                          </div>
                          <div className="rounded-[6px] border border-[var(--line)] bg-white p-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="font-semibold">{meta.label}</div>
                              <span className="mono text-xs text-[var(--muted)]">
                                #{event.seq}
                              </span>
                            </div>
                            <div className="mono mt-1 text-xs text-[var(--muted)]">
                              {event.type}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </section>

          <section className="grid gap-6">
            <div className="panel-flat p-5">
              <SectionTitle label="Marketplace" title="完整 tool list" />
              <div className="space-y-3">
                {/* TODO(track-d): replace with GET /api/marketplace/tools — for
                    workspace context the seeded list is sufficient. */}
                {services.map((service) => {
                  const Icon = service.icon;
                  return (
                    <div
                      key={service.id}
                      className="rounded-[6px] border border-[var(--line)] bg-white p-3"
                    >
                      <div className="flex items-start gap-3">
                        <div className="grid h-9 w-9 place-items-center rounded-[6px] bg-[var(--background)] text-[var(--green-dark)]">
                          <Icon size={17} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-semibold">{service.name}</div>
                            <div className="mono text-xs">{service.price}</div>
                          </div>
                          <div className="mono mt-1 text-xs text-[var(--muted)]">
                            {service.schema}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="panel-flat p-5">
              <SectionTitle label="Deliverable" title="最终产物" />
              {taskCompleted && deliverable?.items ? (
                <div className="grid gap-3">
                  {deliverable.items.map((item, index) => (
                    <div
                      key={item.title}
                      className="rounded-[6px] border border-[var(--line)] bg-white p-4"
                    >
                      <div className="mb-3 flex items-center justify-between">
                        <span className="mono text-xs text-[var(--muted)]">
                          {item.title}
                        </span>
                        {item.time ? (
                          <span className="mono text-xs text-[var(--green-dark)]">
                            {item.time}
                          </span>
                        ) : null}
                      </div>
                      <div className="mb-3 h-20 rounded-[6px] border border-[var(--line)] bg-[linear-gradient(135deg,#121612,#1f3f31_55%,#16c8d2)] p-3 text-white">
                        <div className="mono text-xs">
                          image_url_{index + 1}.webp
                        </div>
                      </div>
                      <p className="text-sm leading-6">{item.copy}</p>
                      <div className="mt-3 flex items-center justify-between">
                        {item.tag ? (
                          <span className="mono text-xs text-[var(--muted)]">
                            {item.tag}
                          </span>
                        ) : (
                          <span />
                        )}
                        <button
                          className="rounded-[6px] border border-[var(--line)] p-2 text-[var(--muted)] hover:text-[var(--foreground)]"
                          aria-label="Copy tweet"
                          type="button"
                          onClick={() =>
                            typeof navigator !== "undefined" &&
                            navigator.clipboard?.writeText(item.copy)
                          }
                        >
                          <Copy size={15} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-[6px] border border-dashed border-[var(--line)] bg-white p-4 text-sm text-[var(--muted)]">
                  {task
                    ? "等待 task.completed 事件以呈现最终产物."
                    : "尚未提交任务."}
                </div>
              )}

              {taskCompleted ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={PRIMARY_BTN_CLASS}
                    onClick={handleRate}
                    disabled={rating.pending}
                  >
                    <Star className="mr-2" size={16} />
                    {rating.pending ? "Submitting rating…" : "Rate 5 stars"}
                  </button>
                  <button
                    type="button"
                    className={SECONDARY_BTN_CLASS}
                    onClick={handleAdjust}
                  >
                    <ImageIcon className="mr-2" size={15} />
                    调整
                  </button>
                  {task ? (
                    <Link
                      href={`/tasks/${task.id}`}
                      className={SECONDARY_BTN_CLASS}
                    >
                      Audit receipts
                      <ExternalLink className="ml-2" size={15} />
                    </Link>
                  ) : null}
                </div>
              ) : null}
              {rating.error ? (
                <div className="mt-3 text-xs text-red-600" role="alert">
                  {rating.error}
                </div>
              ) : null}
            </div>
          </section>
        </section>
      )}
    </AppShell>
  );
}
