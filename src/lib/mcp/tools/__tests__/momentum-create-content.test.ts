// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from "vitest";
const invoke = vi.fn();
vi.mock("../../supabase", () => ({ notAuthenticated: { content: [{ type: "text", text: "no" }], isError: true }, supabaseForUser: () => ({ functions: { invoke } }) }));
vi.mock("@lovable.dev/mcp-js", () => ({ defineTool: (t: any) => t }));
import { z } from "zod";
import tool from "../momentum-create-content";
const ctx = (extra = {}) => ({ isAuthenticated: () => true, ...extra });
const H = "a".repeat(64);
const base = { kind: "nugget", title: "Nugget #4 The Water Pump", body: "🔥 exact\r\n\r\nwording  \n", source_number: 4 };
beforeEach(() => invoke.mockReset());
describe("momentum_create_content", () => {
  it("is not read-only, not destructive, idempotent", () => { expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true }); });
  it("refuses when unauthenticated, no gateway call", async () => { const r = await tool.handler({ ...base, dry_run: true }, { isAuthenticated: () => false }); expect(r.isError).toBe(true); expect(invoke).not.toHaveBeenCalled(); });
  it("dry run is the default, sends dry_run=true, and reports wrote_anything=false", async () => {
    invoke.mockResolvedValue({ data: { ok: true, created: false, dry_run: true, verdict: "new", payload_sha256: H }, error: null });
    const r = await tool.handler(base, ctx());
    expect(invoke.mock.calls[0][0]).toBe("momentum-admin");
    expect(invoke.mock.calls[0][1].body).toMatchObject({ action: "create_content", via: "mcp", dry_run: true, kind: "nugget", source_number: 4 });
    expect(r.structuredContent).toMatchObject({ verdict: "new", wrote_anything: false });
  });
  it("forwards the body byte-for-byte (no trimming or normalising)", async () => {
    invoke.mockResolvedValue({ data: { ok: true, created: false, dry_run: true, verdict: "new", payload_sha256: H }, error: null });
    await tool.handler(base, ctx());
    expect(invoke.mock.calls[0][1].body.body).toBe(base.body);
  });
  it("a real run without the exact confirm phrase or the hash is refused locally and says nothing was written", async () => {
    for (const a of [{ dry_run: false }, { dry_run: false, confirm: "yes", expected_sha256: H }, { dry_run: false, confirm: "create draft", expected_sha256: H }, { dry_run: false, confirm: "CREATE DRAFT" }]) {
      const r = await tool.handler({ ...base, ...a }, ctx()); expect(r.isError).toBe(true); expect(r.content[0].text).toContain("Nothing was written");
    }
    expect(invoke).not.toHaveBeenCalled();
  });
  it("a confirmed real run forwards confirm + hash and reports created", async () => {
    invoke.mockResolvedValue({ data: { ok: true, created: true, dry_run: false, item_id: "i1", status: "draft", payload_sha256: H }, error: null });
    const r = await tool.handler({ ...base, dry_run: false, confirm: "CREATE DRAFT", expected_sha256: H }, ctx());
    expect(invoke.mock.calls[0][1].body).toMatchObject({ dry_run: false, confirm: "CREATE DRAFT", expected_sha256: H });
    expect(r.structuredContent).toMatchObject({ created: true, status: "draft", wrote_anything: true });
  });
  it("an existing/conflicting item is reported, never an error that hides it, and nothing is written", async () => {
    invoke.mockResolvedValue({ data: { ok: true, created: false, verdict: "conflict", item_id: "i0", payload_sha256: H }, error: null });
    const r = await tool.handler({ ...base, dry_run: false, confirm: "CREATE DRAFT", expected_sha256: H }, ctx());
    expect(r.structuredContent).toMatchObject({ verdict: "conflict", wrote_anything: false });
  });
  it("gateway/RPC errors (e.g. payload_hash_mismatch) are surfaced and say nothing was written", async () => {
    invoke.mockResolvedValue({ data: { ok: false, error: "payload_hash_mismatch" }, error: null });
    const r = await tool.handler({ ...base, dry_run: false, confirm: "CREATE DRAFT", expected_sha256: H }, ctx());
    expect(r.isError).toBe(true); expect(r.content[0].text).toContain("payload_hash_mismatch"); expect(r.content[0].text).toContain("Nothing was written");
    invoke.mockResolvedValue({ data: null, error: { message: "network" } });
    const r2 = await tool.handler(base, ctx()); expect(r2.isError).toBe(true); expect(r2.content[0].text).toContain("Nothing was written");
  });
  it("the tool cannot approve, plan or schedule: it only ever calls the create_content action", async () => {
    invoke.mockResolvedValue({ data: { ok: true, created: false, verdict: "new", payload_sha256: H }, error: null });
    await tool.handler({ ...base, dry_run: true }, ctx());
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][1].body.action).toBe("create_content");
  });
  it("input schema: dry_run defaults true; rejects bad kind, empty body, oversize body, bad number, bad hash", () => {
    const s = z.object(tool.inputSchema);
    expect(s.safeParse(base).data.dry_run).toBe(true);
    expect(s.safeParse({ ...base, kind: "nugget_summary" }).success).toBe(false);
    expect(s.safeParse({ ...base, body: "" }).success).toBe(false);
    expect(s.safeParse({ ...base, body: "x".repeat(20001) }).success).toBe(false);
    expect(s.safeParse({ ...base, source_number: 100 }).success).toBe(false);
    expect(s.safeParse({ ...base, expected_sha256: "xyz" }).success).toBe(false);
  });
});
