import { defineTool } from "@lovable.dev/mcp-js";
import { notAuthenticated, supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_my_brand_links",
  title: "Get my brand links",
  description:
    "Read-only. Returns the calling user's OWN website, shop link, Facebook Page link and connected Facebook Pages. Always use these for the user's links — never another account's. Empty values mean the user has not set them yet: ask them to fill in Settings → Facebook & Website instead of guessing.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_args, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);
    const { data: me } = await supabase.auth.getUser();
    const uid = me?.user?.id;
    if (!uid) return notAuthenticated;
    const [{ data: brand }, { data: pages }] = await Promise.all([
      supabase.from("user_brand_settings").select("brand_name,website_url,shop_url,facebook_page_url").eq("user_id", uid).maybeSingle(),
      supabase.from("facebook_page_connections").select("page_id,page_name").eq("user_id", uid).eq("status", "active"),
    ]);
    const result = {
      brand_name: brand?.brand_name ?? null,
      website_url: brand?.website_url ?? null,
      shop_url: brand?.shop_url ?? null,
      facebook_page_url: brand?.facebook_page_url ?? null,
      connected_pages: pages ?? [],
      not_set: ["website_url", "shop_url", "facebook_page_url"].filter((k) => !(brand as Record<string, unknown> | null)?.[k]),
    };
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
  },
});
