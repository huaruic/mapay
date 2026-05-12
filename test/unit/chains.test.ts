import { describe, expect, it } from "vitest";
import { monadTestnet } from "@/lib/chains";

describe("monadTestnet chain definition", () => {
  it("uses Monad Testnet chain id 10143", () => {
    expect(monadTestnet.id).toBe(10143);
  });

  it("uses MON as native currency symbol with 18 decimals", () => {
    expect(monadTestnet.nativeCurrency.symbol).toBe("MON");
    expect(monadTestnet.nativeCurrency.decimals).toBe(18);
  });

  it("points default RPC at rpc.testnet.monad.xyz", () => {
    const rpc = monadTestnet.rpcUrls.default.http;
    expect(rpc.length).toBeGreaterThan(0);
    expect(rpc.some((url) => url.includes("rpc.testnet.monad.xyz"))).toBe(true);
  });

  it("declares the canonical Multicall3 address", () => {
    expect(monadTestnet.contracts?.multicall3?.address).toBe(
      "0xcA11bde05977b3631167028862bE2a173976CA11",
    );
  });

  it("is marked as a testnet", () => {
    expect(monadTestnet.testnet).toBe(true);
  });

  it("exposes a Monad block explorer", () => {
    expect(monadTestnet.blockExplorers?.default?.url).toContain("monadexplorer.com");
  });
});
