import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("../../supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../supabase")>();
  return {
    ...actual,
    supabaseForUser: () => ({ rpc: async () => ({ data: true }) }),
  };
});

import { ALLOWED_GROUPS } from "../../supabase";
import queueGroupPost from "../queue-group-post";

const originalGroups = [
  "APLGO", "APLGO | Health and Biz", "APLGO | Health and Biz KZN",
  "APLGO | Health and Biz Global Distributors", "APLGO | Health and Biz E&W Cape",
  "APLGO| Health and Biz North West", "APLGO 4 SHO", "Ascension Bloemfontein",
  "90 day Challenge and FB Campaign", "Botswana APLGO Presentations", "New Day New Life",
];

describe("approved WhatsApp groups", () => {
  it("preserves the original 11 and adds only Duplication Movement as number 12", () => {
    expect(ALLOWED_GROUPS).toEqual([...originalGroups, "Duplication Movement"]);
    const bridge = readFileSync("supabase/functions/mcp-bridge/index.ts", "utf8");
    const block = bridge.match(/const ALLOWED_GROUPS = \[([\s\S]*?)\]/)?.[1] ?? "";
    expect([...block.matchAll(/'([^']+)'/g)].map((m) => m[1])).toEqual(ALLOWED_GROUPS);
  });

  it("accepts the exact group name past the queue allowlist without creating a post", async () => {
    const ctx = { isAuthenticated: () => true } as Parameters<typeof queueGroupPost.handler>[1];
    const result = await queueGroupPost.handler({
      group_name: "Duplication Movement", message_content: "not sent",
      scheduled_at: "invalid", image_url: undefined,
    }, ctx);
    expect(result).toMatchObject({ isError: true, content: [{ text: "scheduled_at must be an ISO timestamp" }] });
  });
});