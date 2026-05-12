import { beforeAll, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ProviderPage from "@/app/provider/page";
import { services } from "@/lib/mock-data";

describe("/provider (Provider console)", () => {
  let html = "";
  let htmlRegistered = "";

  beforeAll(async () => {
    html = renderToStaticMarkup(
      await ProviderPage({ searchParams: Promise.resolve({}) }),
    );
    htmlRegistered = renderToStaticMarkup(
      await ProviderPage({ searchParams: Promise.resolve({ registered: "1" }) }),
    );
  });

  it("renders the Register Tool CTA", () => {
    expect(html).toContain("Register Tool");
  });

  it("links the Register Tool CTA to /provider/tools/new", () => {
    expect(html).toContain('href="/provider/tools/new"');
  });

  it("renders every service row in the tools table", () => {
    for (const service of services) {
      expect(html).toContain(service.name);
      expect(html).toContain(service.manifest);
    }
  });

  it("renders the on-chain register form button", () => {
    expect(html).toContain("Register on-chain");
  });

  it("does not show the registered banner without ?registered=1", () => {
    expect(html).not.toContain("Tool registered on Monad");
  });

  it("shows the registered banner with ?registered=1", () => {
    expect(htmlRegistered).toContain("Tool registered on Monad");
  });
});
