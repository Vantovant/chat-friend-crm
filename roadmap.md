# Vanto CRM Task Roadmap

- [ ] Add `list_group_messages` MCP tool (`src/lib/mcp/tools/list-group-messages.ts`)
- [ ] Register tool in `src/lib/mcp/index.ts` and update instructions
- [ ] Verify `maytapi_messages` RLS SELECT policy covers super_admin
- [ ] Extract MCP manifest and deploy `mcp` edge function
- [ ] Publish app so Claude connector picks up the new tool
