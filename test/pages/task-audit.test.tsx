import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import TaskAuditPage from "@/app/tasks/[taskId]/page";
import { taskReceipts } from "@/lib/mock-data";

describe("/tasks/[taskId] (Public audit view)", () => {
  const html = renderToStaticMarkup(<TaskAuditPage />);

  it("renders the audit page header", () => {
    expect(html).toContain("task-mkt-042");
  });

  it("renders every receipt id in the events table", () => {
    for (const receipt of taskReceipts) {
      // Receipts contain '#' which gets HTML-encoded by renderToStaticMarkup.
      // Strip the leading '#' and assert the numeric id appears at least once.
      expect(html).toContain(receipt.receipt.slice(1));
    }
  });

  it("shows the TaskCompleted event line for reputation update", () => {
    expect(html).toContain("TaskCompleted");
  });

  it("links to the Monad explorer for tx column", () => {
    expect(html).toContain("testnet.monadexplorer.com");
  });
});
