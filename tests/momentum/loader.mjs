// Node ESM resolve hook: maps the Deno-style imports used by the edge functions to local test stubs.
import { pathToFileURL } from "node:url";
import path from "node:path";
const here = path.dirname(new URL(import.meta.url).pathname);
const stub = (f) => ({ url: pathToFileURL(path.join(here, "stubs", f)).href, shortCircuit: true });
export async function resolve(spec, ctx, next) {
  if (spec.startsWith("https://esm.sh/@supabase/supabase-js") || spec === "npm:@supabase/supabase-js@2") return stub("supabase.mjs");
  if (spec.startsWith("npm:@supabase/supabase-js@2/cors")) return stub("cors.mjs");
  if (spec.endsWith("/require-admin-or-system.ts")) return stub(/\/(baseline-|bf-)/.test(ctx.parentURL || "") ? "admin_baseline.mjs" : "admin.mjs");
  if (spec.endsWith("/should-send-followup.ts")) return stub("should-send-followup.mjs");
  if (spec.endsWith("/group-invite.ts")) return stub("group-invite.mjs");
  if (spec.endsWith("/intent-links.ts")) return stub("intent-links.mjs");
  if (spec.endsWith("/ai-fallback.ts")) return stub("ai-fallback.mjs");
  if (spec.startsWith("https://esm.sh/") || spec.startsWith("npm:")) return stub("empty.mjs");
  return next(spec, ctx);
}
