import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Auth check — must be a logged-in super_admin
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check super_admin role
    const { data: roleData } = await userClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    if (!roleData || roleData.role !== 'super_admin') {
      return new Response(JSON.stringify({ error: 'Forbidden: Super Admin only' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { email } = await req.json();
    if (!email || typeof email !== 'string') {
      return new Response(JSON.stringify({ error: 'Email is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Check if invitation already pending for this email
    const { data: existing } = await adminClient
      .from('invitations')
      .select('id, status')
      .eq('email', email.toLowerCase().trim())
      .eq('status', 'pending')
      .maybeSingle();

    if (existing) {
      return new Response(JSON.stringify({ error: 'An active invitation already exists for this email.' }), {
        status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create invitation record
    const { data: invite, error: inviteError } = await adminClient
      .from('invitations')
      .insert({
        email: email.toLowerCase().trim(),
        invited_by: user.id,
        status: 'pending',
      })
      .select()
      .single();

    if (inviteError || !invite) {
      console.error('Invite insert error:', inviteError);
      return new Response(JSON.stringify({ error: 'Failed to create invitation.' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Send invite email via Supabase Auth Admin API
    const { error: inviteEmailError } = await adminClient.auth.admin.inviteUserByEmail(
      email.toLowerCase().trim(),
      {
        redirectTo: `${req.headers.get('origin') ?? 'https://chat-friend-crm.lovable.app'}/accept-invite?token=${invite.token}`,
        data: { invitation_token: invite.token },
      }
    );

    if (inviteEmailError) {
      console.error('Auth invite error:', inviteEmailError);
      // Rollback the invitation record
      await adminClient.from('invitations').delete().eq('id', invite.id);
      return new Response(JSON.stringify({ error: inviteEmailError.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, email }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('Unexpected error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
