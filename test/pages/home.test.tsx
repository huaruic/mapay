import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Home from "@/app/page";
import { services } from "@/lib/mock-data";

describe("/ (Home)", () => {
  const html = renderToStaticMarkup(<Home />);

  it("renders the headline", () => {
    expect(html).toContain("Agents discover, pay, invoke, and remember.");
  });

  it("lists every service from mock-data", () => {
    for (const service of services) {
      expect(html).toContain(service.name);
    }
  });

  it("links to the provider flow", () => {
    expect(html).toContain('href="/provider"');
  });

  it("links to the agents (end-user) flow", () => {
    expect(html).toContain('href="/agents"');
  });

  it("CTA into the demo agent workspace is wired", () => {
    expect(html).toContain('href="/agents/1"');
    expect(html).toContain("Open execution workspace");
  });
});
