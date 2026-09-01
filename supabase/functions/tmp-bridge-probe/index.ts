// TEMPORARY read-only probe — invokes mcp-bridge read actions with the shared token.
// Deleted immediately after verification.
Deno.serve(async () => {
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/mcp-bridge`
  const token = Deno.env.get('MCP_BRIDGE_TOKEN')!
  const out: Record<string, unknown> = {}
  for (const action of ['get_group_overview', 'get_group_welcome_status']) {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-mcp-token': token,
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({ action }),
    })
    out[action] = { status: r.status, body: await r.json().catch(() => null) }
  }
  return new Response(JSON.stringify(out, null, 2), { headers: { 'Content-Type': 'application/json' } })
})
