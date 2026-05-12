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

// --- next/navigation --------------------------------------------------------
// Track F's client pages call useRouter / useSearchParams / useParams. In a
// non-app-router test environment those throw "invariant expected app router
// to be mounted". Stub with no-op values that match the read shape.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/",
  useParams: () => ({}),
  notFound: () => {
    throw new Error("notFound");
  },
  redirect: (_url: string) => {
    throw new Error("redirect:" + _url);
  },
}));

// --- wagmi ------------------------------------------------------------------
// Track F's client pages call useAccount / useSendTransaction etc. Stub with
// disconnected-state defaults so render tests assert "Connect Wallet" CTAs.
vi.mock("wagmi", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    useAccount: () => ({
      address: undefined,
      isConnected: false,
      status: "disconnected" as const,
    }),
    useSendTransaction: () => ({
      sendTransaction: vi.fn(),
      sendTransactionAsync: vi.fn(async () => "0x" as `0x${string}`),
      isPending: false,
      isSuccess: false,
      isError: false,
      data: undefined,
      error: null,
      reset: vi.fn(),
    }),
    useWaitForTransactionReceipt: () => ({
      data: undefined,
      isLoading: false,
      isSuccess: false,
    }),
    useChainId: () => 10143,
  };
});
