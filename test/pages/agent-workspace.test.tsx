import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import AgentWorkspacePage from "@/app/agents/[agentId]/page";
import { services } from "@/lib/mock-data";

// The workspace page is now a client component driven by API + SSE. Server-side
// render with mocked useParams ({}) lands on the idle/empty state; assertions
// reflect that contract. Behavior with a real loaded task is covered by an
// integration test (see test/pages/agents-workspace.test.tsx when added).
describe("/agents/[agentId] (Timeline workspace, empty state)", () => {
  const html = renderToStaticMarkup(<AgentWorkspacePage />);

  it("renders the AppShell header", () => {
    expect(html).toContain("AgentPay Passport");
  });

  it("uses the Agent execution workspace eyebrow", () => {
    expect(html).toContain("Agent execution workspace");
  });

  it("shows the Submit-your-first-task empty state when no task is loaded", () => {
    expect(html).toContain("Submit your first task");
  });

  it("links to the audit page from the nav", () => {
    expect(html).toContain('href="/tasks/task-mkt-042"');
  });

  it("lists marketplace tools in the side panel", () => {
    for (const service of services) {
      expect(html).toContain(service.name);
    }
  });
});
