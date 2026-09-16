# Vanto CRM Task Roadmap

- [x] Add `list_group_messages` MCP tool (`src/lib/mcp/tools/list-group-messages.ts`)
- [x] Register tool in `src/lib/mcp/index.ts` and update instructions
- [x] Verify `maytapi_messages` RLS SELECT policy covers super_admin
- [x] Extract MCP manifest and deploy `mcp` edge function
- [x] Publish app so Claude connector picks up the new tool
- [x] Facebook Page write tools: `fb_outbound_posts` table, `fb-create-post` edge function, `create_fb_post` + `list_fb_posts` MCP tools (Get Well Africa page only)
