// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from "vitest";
const invoke = vi.fn();
vi.mock("../../supabase", () => ({ notAuthenticated: { content: [{ type: "text", text: "no" }], isError: true }, supabaseForUser: () => ({ functions: { invoke } }) }));
vi.mock("@lovable.dev/mcp-js", () => ({ defineTool: (t: any) => t }));
import { z } from "zod";
import tool, { clientLabel } from "../momentum-import-reference";
const ctx = (extra = {}) => ({ isAuthenticated: () => true, ...extra });
const items = [{ source_number: 4, title: "The Water Pump", lesson: "Early practice builds the conditions for progress." }];
beforeEach(() => invoke.mockReset());
describe("momentum_import_reference", () => {
  it("is not read-only, not destructive, idempotent", () => { expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true }); });
  it("refuses when unauthenticated, no gateway call", async () => { const r = await tool.handler({ items, dry_run: true }, { isAuthenticated: () => false }); expect(r.isError).toBe(true); expect(invoke).not.toHaveBeenCalled(); });
  it("dry run (default) sends dry_run=true and reports wrote_anything=false", async () => {
    invoke.mockResolvedValue({ data: { ok: true, created: 0, batch_sha256: "a".repeat(64), summary: { duplicate_source_number: 1 }, verdicts: [] }, error: null });
    const r = await tool.handler({ items }, ctx());
    expect(invoke.mock.calls[0][1].body).toMatchObject({ action: "import_reference", via: "mcp", dry_run: true });
    expect(r.structuredContent.wrote_anything).toBe(false);
  });
  it("real run without confirm phrase or sha is refused locally", async () => {
    for (const a of [{ items, dry_run: false }, { items, dry_run: false, confirm: "yes", expected_batch_sha256: "a".repeat(64) }, { items, dry_run: false, confirm: "IMPORT AS DRAFTS" }]) {
      const r = await tool.handler(a, ctx()); expect(r.isError).toBe(true);
    }
    expect(invoke).not.toHaveBeenCalled();
  });
  it("real run with confirm+sha forwards and reports created", async () => {
    invoke.mockResolvedValue({ data: { ok: true, created: 1, run_id: "r1", batch_sha256: "a".repeat(64), summary: { new: 1 }, verdicts: [] }, error: null });
    const r = await tool.handler({ items, dry_run: false, confirm: "IMPORT AS DRAFTS", expected_batch_sha256: "a".repeat(64) }, ctx());
    expect(invoke.mock.calls[0][1].body).toMatchObject({ dry_run: false, confirm: "IMPORT AS DRAFTS", expected_batch_sha256: "a".repeat(64) });
    expect(r.structuredContent).toMatchObject({ wrote_anything: true, created: 1, run_id: "r1" });
  });
  it("gateway error is surfaced and says nothing was written", async () => {
    invoke.mockResolvedValue({ data: { ok: false, error: "batch_sha_mismatch" }, error: null });
    const r = await tool.handler({ items, dry_run: false, confirm: "IMPORT AS DRAFTS", expected_batch_sha256: "b".repeat(64) }, ctx());
    expect(r.isError).toBe(true); expect(r.content[0].text).toContain("Nothing was written");
  });
  it("client label: uses clientInfo when exposed, else 'unidentified'", () => {
    expect(clientLabel({ clientInfo: { name: "claude-ai", version: "1.0" } })).toBe("claude-ai 1.0");
    expect(clientLabel({ claims: { client_id: "chatgpt" } })).toBe("chatgpt");
    expect(clientLabel({})).toBe("unidentified");
  });
  it("input schema rejects >25 items, bad numbers, oversized lessons", () => {
    const s = z.object(tool.inputSchema);
    expect(s.safeParse({ items: Array(26).fill(items[0]) }).success).toBe(false);
    expect(s.safeParse({ items: [{ ...items[0], source_number: 100 }] }).success).toBe(false);
    expect(s.safeParse({ items: [{ ...items[0], lesson: "x".repeat(2001) }] }).success).toBe(false);
    expect(s.safeParse({ items }).data.dry_run).toBe(true);
  });
});
