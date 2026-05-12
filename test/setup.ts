import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// RTL doesn't auto-cleanup under Vitest 4 — without this, every render() leaks
// a DOM tree into the next test and getByRole returns multiple matches.
afterEach(() => {
  cleanup();
});

// --- next/link --------------------------------------------------------------
// In tests we don't need router prefetch / client-nav behavior — a plain <a>
// is enough for assertions about hrefs and link text.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => React.createElement("a", { href, ...rest }, children),
}));

// --- @rainbow-me/rainbowkit -------------------------------------------------
// ConnectButton needs a live WagmiProvider with a valid WalletConnect
// projectId. In test-env we stub it out so AppShell / page render tests don't
// have to spin up the full provider tree.
vi.mock("@rainbow-me/rainbowkit", () => ({
  ConnectButton: () =>
    React.createElement(
      "button",
      { type: "button", "data-testid": "mock-connect-button" },
      "Connect Wallet",
    ),
}));
