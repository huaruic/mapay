import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import AgentsPage from "@/app/agents/page";

describe("/agents (Agents list)", () => {
  const html = renderToStaticMarkup(<AgentsPage />);

  it("renders both demo agents", () => {
    expect(html).toContain("Marketing Agent");
    expect(html).toContain("Research Agent");
  });

  it("renders the policy-bounded create form CTA", () => {
    expect(html).toContain("Create &amp; Fund on Monad");
  });

  it("links each agent card to its workspace", () => {
    expect(html).toContain('href="/agents/1"');
    expect(html).toContain('href="/agents/2"');
  });
});
