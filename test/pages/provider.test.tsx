import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ProviderPage from "@/app/provider/page";
import { services } from "@/lib/mock-data";

describe("/provider (Provider console)", () => {
  const html = renderToStaticMarkup(<ProviderPage />);

  it("renders the Register Tool CTA", () => {
    expect(html).toContain("Register Tool");
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
});
