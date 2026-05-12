import { describe, expect, it } from "vitest";
import {
  agents,
  deliverables,
  navItems,
  services,
  stats,
  taskReceipts,
  timeline,
} from "@/lib/mock-data";

describe("services mock", () => {
  it("has exactly 3 entries", () => {
    expect(services).toHaveLength(3);
  });

  it("every service has the shape consumed by pages (id, name, price, manifest, schema, icon)", () => {
    for (const service of services) {
      expect(typeof service.id).toBe("string");
      expect(service.id.length).toBeGreaterThan(0);
      expect(typeof service.name).toBe("string");
      expect(service.price).toMatch(/MON$/);
      expect(typeof service.manifest).toBe("string");
      expect(service.manifest.startsWith("mcp://")).toBe(true);
      expect(typeof service.schema).toBe("string");
      expect(typeof service.description).toBe("string");
      // icon must be a renderable component (function/object reference from lucide).
      expect(["function", "object"]).toContain(typeof service.icon);
    }
  });

  it("includes the headline services referenced across pages", () => {
    const names = services.map((s) => s.name);
    expect(names).toContain("Copywriter Agent");
    expect(names).toContain("Image Generator");
    expect(names).toContain("Premium Copy Pro");
  });
});

describe("agents mock", () => {
  it("has at least the two demo agents", () => {
    expect(agents.length).toBeGreaterThanOrEqual(2);
  });

  it("Marketing Agent and Research Agent both exist", () => {
    const names = agents.map((a) => a.name);
    expect(names).toContain("Marketing Agent");
    expect(names).toContain("Research Agent");
  });

  it("each agent has the fields the workspace + list pages read", () => {
    for (const agent of agents) {
      expect(typeof agent.id).toBe("string");
      expect(typeof agent.name).toBe("string");
      expect(typeof agent.goal).toBe("string");
      expect(agent.balance).toMatch(/MON$/);
      expect(agent.maxPerCall).toMatch(/MON$/);
      expect(typeof agent.reputation).toBe("number");
      expect(typeof agent.tasks).toBe("number");
      expect(typeof agent.owner).toBe("string");
      expect(typeof agent.status).toBe("string");
    }
  });
});

describe("taskReceipts mock", () => {
  it("has 3 receipts matching the audit page Metric", () => {
    expect(taskReceipts).toHaveLength(3);
  });

  it("each receipt carries the columns the audit table renders", () => {
    for (const receipt of taskReceipts) {
      expect(receipt.receipt).toMatch(/^#\d+$/);
      expect(typeof receipt.service).toBe("string");
      expect(receipt.amount).toMatch(/MON$/);
      expect(receipt.callId.startsWith("0x")).toBe(true);
      expect(receipt.inputHash.startsWith("0x")).toBe(true);
      expect(receipt.tx.startsWith("0x")).toBe(true);
    }
  });
});

describe("timeline mock", () => {
  it("has at least one step in each of the canonical states", () => {
    const states = new Set(timeline.map((step) => step.state));
    expect(states.has("done")).toBe(true);
    expect(states.has("active")).toBe(true);
    expect(states.has("pending")).toBe(true);
  });

  it("only uses the documented state values", () => {
    const allowed = new Set(["done", "active", "pending"]);
    for (const step of timeline) {
      expect(allowed.has(step.state)).toBe(true);
    }
  });

  it("steps have label, detail, and icon", () => {
    for (const step of timeline) {
      expect(typeof step.label).toBe("string");
      expect(typeof step.detail).toBe("string");
      expect(["function", "object"]).toContain(typeof step.icon);
    }
  });
});

describe("nav + landing stats + deliverables", () => {
  it("navItems point at the live routes used by the demo", () => {
    const hrefs = navItems.map((item) => item.href);
    expect(hrefs).toEqual(expect.arrayContaining(["/", "/provider", "/agents"]));
    // Audit nav must deep-link the canonical demo task id.
    expect(hrefs.some((h) => h.startsWith("/tasks/"))).toBe(true);
  });

  it("stats has 4 cards for the landing grid", () => {
    expect(stats).toHaveLength(4);
    for (const stat of stats) {
      expect(typeof stat.label).toBe("string");
      expect(typeof stat.value).toBe("string");
    }
  });

  it("deliverables has 3 tweet cards", () => {
    expect(deliverables).toHaveLength(3);
    for (const item of deliverables) {
      expect(typeof item.title).toBe("string");
      expect(typeof item.copy).toBe("string");
    }
  });
});
