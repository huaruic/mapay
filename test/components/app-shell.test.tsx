import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { navItems } from "@/lib/mock-data";

describe("<AppShell>", () => {
  it("renders the brand wordmark", () => {
    render(
      <AppShell>
        <div>child-content</div>
      </AppShell>,
    );
    expect(screen.getByText("AgentPay Passport")).toBeInTheDocument();
    expect(screen.getByText(/Monad Testnet/)).toBeInTheDocument();
  });

  it("renders every nav item from mock-data", () => {
    render(
      <AppShell>
        <span>x</span>
      </AppShell>,
    );
    for (const item of navItems) {
      // Anchor (from mocked next/link) with the right href + label.
      const link = screen.getByRole("link", { name: item.label });
      expect(link).toHaveAttribute("href", item.href);
    }
  });

  it("renders the (mocked) ConnectButton", () => {
    render(
      <AppShell>
        <span>x</span>
      </AppShell>,
    );
    expect(screen.getByTestId("mock-connect-button")).toBeInTheDocument();
  });

  it("renders its children inside <main>", () => {
    render(
      <AppShell>
        <div data-testid="child-content">hi from child</div>
      </AppShell>,
    );
    expect(screen.getByTestId("child-content")).toHaveTextContent("hi from child");
  });
});

describe("<PageHeader>", () => {
  it("renders eyebrow, title, description, and the action node", () => {
    render(
      <PageHeader
        eyebrow="EYE"
        title="The Title"
        description="A description for the header."
        action={<button>CTA</button>}
      />,
    );
    expect(screen.getByText("EYE")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "The Title" }),
    ).toBeInTheDocument();
    expect(screen.getByText("A description for the header.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "CTA" })).toBeInTheDocument();
  });

  it("renders without an action when none is supplied", () => {
    render(<PageHeader eyebrow="X" title="Y" description="Z" />);
    expect(screen.getByRole("heading", { level: 1, name: "Y" })).toBeInTheDocument();
  });
});
