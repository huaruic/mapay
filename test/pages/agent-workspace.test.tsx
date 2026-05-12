import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import AgentWorkspacePage from "@/app/agents/[agentId]/page";
import { deliverables, timeline } from "@/lib/mock-data";

describe("/agents/[agentId] (Timeline workspace)", () => {
  const html = renderToStaticMarkup(<AgentWorkspacePage />);

  it("shows the active-task heading", () => {
    expect(html).toContain("正在执行任务");
  });

  it("renders every timeline step label", () => {
    for (const step of timeline) {
      expect(html).toContain(step.label);
    }
  });

  it("renders every deliverable card", () => {
    for (const item of deliverables) {
      expect(html).toContain(item.title);
    }
  });

  it("links into the audit page", () => {
    expect(html).toContain('href="/tasks/task-mkt-042"');
  });
});
