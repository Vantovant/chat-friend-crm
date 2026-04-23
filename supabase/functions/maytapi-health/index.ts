/**
 * maytapi-health
 * Returns connection status of the admin's Maytapi WhatsApp number.
 * SECURITY: The actual phone number is ONLY returned to admins / super_admins.
 * Regular agents only see { connected, status } — never the administrator's number.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAYTAPI_BASE = "https://api.maytapi.com/api";

async function isAdminCaller(req: Request): Promise<{ authed: boolean; isAdmin: boolean }> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return { authed: false, isAdmin: false };

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const userClient = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user) return { authed: false, isAdmin: false };

  const svc = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: roleRow } = await svc
    .from("user_roles")
    .select("role")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  const role = roleRow?.role;
  return { authed: true, isAdmin: role === "admin" || role === "super_admin" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Require auth — block unauthenticated callers entirely
  const { authed, isAdmin } = await isAdminCaller(req);
  if (!authed) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const PRODUCT_ID = Deno.env.get("MAYTAPI_PRODUCT_ID")?.trim();
    const PHONE_ID = Deno.env.get("MAYTAPI_PHONE_ID")?.trim();
    const API_TOKEN = Deno.env.get("MAYTAPI_API_TOKEN")?.trim();

    if (!PRODUCT_ID || !PHONE_ID || !API_TOKEN) {
      return new Response(JSON.stringify({
        connected: false,
        reason: "Maytapi credentials not configured",
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    if (action === "groups") {
      // Group list is admin-only as well (it can reveal numbers / JIDs)
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: "forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const groupsRes = await fetch(
        `${MAYTAPI_BASE}/${PRODUCT_ID}/${PHONE_ID}/getGroups`,
        { headers: { "x-maytapi-key": API_TOKEN } }
      );
      const groupsData = await groupsRes.json();
      return new Response(JSON.stringify(groupsData), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const res = await fetch(
      `${MAYTAPI_BASE}/${PRODUCT_ID}/${PHONE_ID}/status`,
      { headers: { "x-maytapi-key": API_TOKEN } }
    );

    const data = await res.json();

    if (!res.ok) {
      return new Response(JSON.stringify({
        connected: false,
        reason: data.message || `API returned ${res.status}`,
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const statusData = data.status || data.data || data;
    const stateStr = statusData?.state?.state || "";
    const isConnected = statusData?.loggedIn === true || stateStr === "CONNECTED";

    // SECURITY: Only admins receive phone_id and number.
    const payload: Record<string, unknown> = {
      connected: isConnected,
      status: stateStr || (isConnected ? "connected" : "unknown"),
    };
    if (isAdmin) {
      payload.phone_id = PHONE_ID;
      payload.number = statusData?.number || null;
    }

    return new Response(JSON.stringify(payload), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("maytapi-health error:", err);
    return new Response(JSON.stringify({
      connected: false,
      reason: err instanceof Error ? err.message : "Unknown error",
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
