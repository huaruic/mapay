import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import AgentsPage from "@/app/agents/page";

// Stub next/navigation hooks that the client page imports (it doesn't actually
// use them at top-level, but we keep the mock in case future changes pull them
// in via the AppShell). useSearchParams is the one that matters when search
// params are read; we leave it minimal.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

describe("/agents (Agents list)", () => {
  beforeEach(() => {
    // Default: no agents (empty state) — controlled per-test.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : String(input);
        if (url.includes("/aggregate-stats")) {
          return new Response(
            JSON.stringify({
              agents: 0,
              totalBalance: "0",
              completedTasks: 0,
              highestReputation: 0,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.endsWith("/api/agents")) {
          return new Response(JSON.stringify({ agents: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({}), { status: 404 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the empty-state CTA when no agents", async () => {
    render(<AgentsPage />);
    await waitFor(() =>
      expect(screen.getByText(/Create your first agent/i)).toBeInTheDocument(),
    );
    const cta = screen.getByRole("link", { name: /Create & Fund on Monad/i });
    expect(cta).toHaveAttribute("href", "/agents/new");
  });

  it("header CTA links to /agents/new", async () => {
    render(<AgentsPage />);
    const headerCta = await screen.findByRole("link", {
      name: /^Create & Fund$/i,
    });
    expect(headerCta).toHaveAttribute("href", "/agents/new");
  });

  it("renders agents returned by the API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : String(input);
        if (url.includes("/aggregate-stats")) {
          return new Response(
            JSON.stringify({
              agents: 2,
              totalBalance: "0.5",
              completedTasks: 3,
              highestReputation: 51,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.endsWith("/api/agents")) {
          return new Response(
            JSON.stringify({
              agents: [
                {
                  id: "1",
                  name: "Marketing Agent",
                  goal: "tweets",
                  owner: "0xowner",
                  operator: "0xop",
                  totalBudget: "0.5",
                  balance: "0.4",
                  maxPerCall: "0.15",
                  dailySpendCap: "0.3",
                  reputation: 51,
                  tasks: 3,
                  status: "Ready",
                  currentTaskId: null,
                  chainAgentId: null,
                },
                {
                  id: "2",
                  name: "Research Agent",
                  goal: "research",
                  owner: "0xowner",
                  operator: "0xop2",
                  totalBudget: "0.1",
                  balance: "0.1",
                  maxPerCall: "0.05",
                  dailySpendCap: "0.08",
                  reputation: 47,
                  tasks: 0,
                  status: "Needs funding",
                  currentTaskId: null,
                  chainAgentId: null,
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({}), { status: 404 });
      }),
    );
    render(<AgentsPage />);
    expect(await screen.findByText("Marketing Agent")).toBeInTheDocument();
    expect(screen.getByText("Research Agent")).toBeInTheDocument();
    const links = screen.getAllByRole("link");
    expect(links.some((l) => l.getAttribute("href") === "/agents/1")).toBe(true);
    expect(links.some((l) => l.getAttribute("href") === "/agents/2")).toBe(true);
  });
});
