/**
 * Vanto CRM — Background Service Worker v4.0
 * MV3 compliant service worker.
 * OWNS: session storage, auth calls, Edge Function calls, group polling engine.
 */

'use strict';

var SUPABASE_URL      = 'https://nqyyvqcmcyggvlcswkio.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xeXl2cWNtY3lnZ3ZsY3N3a2lvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1NDYxMjYsImV4cCI6MjA4NzEyMjEyNn0.oK04GkXogHo9pohYd4A7XAV0-Q-qSu-uUiGWaj4ClM8';
var UPSERT_URL        = SUPABASE_URL + '/functions/v1/upsert-whatsapp-contact';

// ── Storage helpers ────────────────────────────────────────────────────────────
function getSession() {
  return new Promise(function(resolve) {
    chrome.storage.local.get(['vanto_token', 'vanto_email', 'vanto_refresh', 'vanto_expires_at'], function(r) {
      resolve({
        token:      r.vanto_token      || null,
        email:      r.vanto_email      || null,
        refresh:    r.vanto_refresh    || null,
        expires_at: r.vanto_expires_at || 0,
      });
    });
  });
}

function saveSession(token, email, refresh, expires_at) {
  return new Promise(function(resolve) {
    chrome.storage.local.set({
      vanto_token:      token,
      vanto_email:      email,
      vanto_refresh:    refresh || null,
      vanto_expires_at: expires_at || 0,
    }, resolve);
  });
}

function clearSession() {
  return new Promise(function(resolve) {
    chrome.storage.local.remove(['vanto_token', 'vanto_email', 'vanto_refresh', 'vanto_expires_at'], resolve);
  });
}

// ── Token refresh ──────────────────────────────────────────────────────────────
async function refreshTokenIfNeeded(session) {
  if (!session.token) return session;

  var now = Math.floor(Date.now() / 1000);
  if (session.expires_at && (session.expires_at - now) > 300) {
    return session;
  }

  if (!session.refresh) {
    console.warn('[Vanto BG] Token expired and no refresh token — clearing session');
    await clearSession();
    return { token: null, email: null, refresh: null, expires_at: 0 };
  }

  console.log('[Vanto BG] Refreshing token…');
  try {
    var res = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: {
        'apikey':       SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refresh_token: session.refresh }),
    });

    var data = await res.json();

    if (!res.ok || !data.access_token) {
      console.warn('[Vanto BG] Token refresh failed — clearing session');
      await clearSession();
      return { token: null, email: null, refresh: null, expires_at: 0 };
    }

    var newExpires = Math.floor(Date.now() / 1000) + (data.expires_in || 3600);
    await saveSession(data.access_token, session.email, data.refresh_token || session.refresh, newExpires);
    console.log('[Vanto BG] Token refreshed successfully');
    return {
      token:      data.access_token,
      email:      session.email,
      refresh:    data.refresh_token || session.refresh,
      expires_at: newExpires,
    };
  } catch (err) {
    console.error('[Vanto BG] Token refresh error:', err.message);
    return session;
  }
}

// ── Login ──────────────────────────────────────────────────────────────────────
async function handleLogin(email, password) {
  console.log('[Vanto BG] Login attempt for:', email);

  try {
    var controller = new AbortController();
    var timeout = setTimeout(function() { controller.abort(); }, 15000);

    var res = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'apikey':       SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: email, password: password }),
    });

    clearTimeout(timeout);
    var data = await res.json();

    if (!res.ok || !data.access_token) {
      var errMsg = data.error_description || data.msg || data.error || 'Invalid credentials';
      console.warn('[Vanto BG] Login failed:', errMsg);
      return { success: false, error: errMsg };
    }

    var userEmail = (data.user && data.user.email) || email;
    var expires   = Math.floor(Date.now() / 1000) + (data.expires_in || 3600);

    await saveSession(data.access_token, userEmail, data.refresh_token || null, expires);
    notifyWhatsAppTabs({ type: 'VANTO_TOKEN_UPDATED', token: data.access_token });

    console.log('[Vanto BG] Login success:', userEmail);
    return { success: true, email: userEmail, token: data.access_token };

  } catch (err) {
    var msg = err.name === 'AbortError'
      ? 'Request timed out — check your connection.'
      : 'Network error: ' + err.message;
    console.error('[Vanto BG] Login error:', err.message);
    return { success: false, error: msg };
  }
}

// ── Logout ─────────────────────────────────────────────────────────────────────
async function handleLogout() {
  console.log('[Vanto BG] Logout');
  await clearSession();
  notifyWhatsAppTabs({ type: 'VANTO_TOKEN_CLEARED' });
  return { success: true };
}

// ── Save contact via upsert-whatsapp-contact Edge Function ────────────────────
async function handleSaveContact(payload) {
  var session = await getSession();
  session = await refreshTokenIfNeeded(session);

  if (!session.token) {
    console.warn('[Vanto BG] Save contact — not authenticated');
    return { success: false, error: 'not_logged_in' };
  }

  console.log('[Vanto BG] Saving contact:', payload.phone || payload.whatsapp_id, payload.name);

  try {
    var controller = new AbortController();
    var timeout = setTimeout(function() { controller.abort(); }, 20000);

    var res = await fetch(UPSERT_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': 'Bearer ' + session.token,
        'Content-Type':  'application/json',
        'apikey':        SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(payload),
    });

    clearTimeout(timeout);
    var text = await res.text();

    if (!res.ok) {
      var errData = {};
      try { errData = JSON.parse(text); } catch(e) {}

      if (res.status === 401) {
        await clearSession();
        notifyWhatsAppTabs({ type: 'VANTO_TOKEN_CLEARED' });
        return { success: false, error: 'token_expired' };
      }

      var errMsg = errData.error || text || 'Save failed [' + res.status + ']';
      console.error('[Vanto BG] Save error:', res.status, errMsg);
      return { success: false, error: errMsg };
    }

    var data = text ? JSON.parse(text) : {};
    console.log('[Vanto BG] Contact saved:', data.contact && data.contact.id);
    return { success: true, contact: data.contact || null };

  } catch (err) {
    var msg = err.name === 'AbortError' ? 'network_timeout' : err.message;
    console.error('[Vanto BG] Save contact error:', msg);
    return { success: false, error: msg };
  }
}

// ── Load team members (profiles) ───────────────────────────────────────────────
async function handleLoadTeamMembers() {
  var session = await getSession();
  session = await refreshTokenIfNeeded(session);

  if (!session.token) return { success: false, error: 'not_logged_in' };

  try {
    var url = SUPABASE_URL + '/rest/v1/profiles?select=id,full_name,email&order=full_name.asc';
    var res = await fetch(url, {
      headers: {
        'apikey':        SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + session.token,
        'Content-Type':  'application/json',
      },
    });

    if (!res.ok) return { success: false, error: 'Load failed [' + res.status + ']' };

    var rows = await res.json();
    return { success: true, members: rows || [] };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── Load contact by phone_normalized or whatsapp_id ────────────────────────────
async function handleLoadContact(phone) {
  var session = await getSession();
  session = await refreshTokenIfNeeded(session);

  if (!session.token) return { success: false, error: 'not_logged_in' };

  try {
    var digits = (phone || '').replace(/\D/g, '');
    var url = SUPABASE_URL + '/rest/v1/contacts?phone_normalized=eq.' + encodeURIComponent(digits) + '&limit=1';
    var res = await fetch(url, {
      headers: {
        'apikey':        SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + session.token,
        'Content-Type':  'application/json',
      },
    });

    if (!res.ok) {
      if (res.status === 401) {
        await clearSession();
        notifyWhatsAppTabs({ type: 'VANTO_TOKEN_CLEARED' });
        return { success: false, error: 'token_expired' };
      }
      return { success: false, error: 'Load failed [' + res.status + ']' };
    }

    var rows = await res.json();
    if (rows && rows.length > 0) {
      return { success: true, contact: rows[0] };
    }

    var url2 = SUPABASE_URL + '/rest/v1/contacts?whatsapp_id=eq.' + encodeURIComponent(digits) + '&limit=1';
    var res2 = await fetch(url2, {
      headers: {
        'apikey':        SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + session.token,
        'Content-Type':  'application/json',
      },
    });
    var rows2 = res2.ok ? await res2.json() : [];
    return { success: true, contact: rows2 && rows2.length > 0 ? rows2[0] : null };

  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── Upsert WhatsApp Group ─────────────────────────────────────────────────────
async function handleUpsertGroup(groupName) {
  var session = await getSession();
  session = await refreshTokenIfNeeded(session);

  if (!session.token) return { success: false, error: 'not_logged_in' };

  try {
    // Get user id from token (decode JWT payload)
    var payload = JSON.parse(atob(session.token.split('.')[1]));
    var userId = payload.sub;

    var url = SUPABASE_URL + '/rest/v1/whatsapp_groups';
    var res = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey':        SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + session.token,
        'Content-Type':  'application/json',
        'Prefer':        'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        user_id: userId,
        group_name: groupName,
      }),
    });

    if (!res.ok) {
      var errText = await res.text();
      console.warn('[Vanto BG] Group upsert failed:', res.status, errText);
      return { success: false, error: errText };
    }

    console.log('[Vanto BG] Group upserted:', groupName);
    return { success: true };
  } catch (err) {
    console.error('[Vanto BG] Group upsert error:', err.message);
    return { success: false, error: err.message };
  }
}

// ── Polling Engine: fetch due posts ────────────────────────────────────────────
async function pollDuePosts() {
  var session = await getSession();
  session = await refreshTokenIfNeeded(session);

  if (!session.token) {
    console.log('[Vanto BG] Poll skipped — not authenticated');
    return;
  }

  try {
    var now = new Date().toISOString();
    var url = SUPABASE_URL + '/rest/v1/scheduled_group_posts?status=eq.pending&scheduled_at=lte.' + encodeURIComponent(now) + '&order=scheduled_at.asc&limit=5';
    var res = await fetch(url, {
      headers: {
        'apikey':        SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + session.token,
        'Content-Type':  'application/json',
      },
    });

    if (!res.ok) {
      console.warn('[Vanto BG] Poll fetch failed:', res.status);
      return;
    }

    var posts = await res.json();
    if (!posts || posts.length === 0) return;

    console.log('[Vanto BG] Due posts found:', posts.length);

    // Send each post to content.js for execution
    for (var i = 0; i < posts.length; i++) {
      await executeGroupPost(posts[i], session.token);
    }
  } catch (err) {
    console.error('[Vanto BG] Poll error:', err.message);
  }
}

async function executeGroupPost(post, token) {
  console.log('[Vanto BG] Executing post to group:', post.target_group_name);

  try {
    // Find a WhatsApp Web tab
    var tabs = await new Promise(function(resolve) {
      chrome.tabs.query({ url: 'https://web.whatsapp.com/*' }, function(t) { resolve(t || []); });
    });

    if (tabs.length === 0) {
      console.warn('[Vanto BG] No WhatsApp Web tab found — marking failed');
      await updatePostStatus(post.id, 'failed', token);
      return;
    }

    // Send execute command to content script
    var response = await new Promise(function(resolve) {
      chrome.tabs.sendMessage(tabs[0].id, {
        type: 'VANTO_EXECUTE_GROUP_POST',
        groupName: post.target_group_name,
        messageContent: post.message_content,
        postId: post.id,
      }, function(resp) {
        if (chrome.runtime.lastError) {
          console.warn('[Vanto BG] Content script error:', chrome.runtime.lastError.message);
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(resp || { success: false, error: 'No response' });
        }
      });
    });

    if (response && response.success) {
      console.log('[Vanto BG] Post sent successfully:', post.id);
      await updatePostStatus(post.id, 'sent', token);
    } else {
      console.warn('[Vanto BG] Post execution failed:', response && response.error);
      await updatePostStatus(post.id, 'failed', token);
    }
  } catch (err) {
    console.error('[Vanto BG] Execute error:', err.message);
    await updatePostStatus(post.id, 'failed', token);
  }
}

async function updatePostStatus(postId, status, token) {
  try {
    var url = SUPABASE_URL + '/rest/v1/scheduled_group_posts?id=eq.' + postId;
    await fetch(url, {
      method: 'PATCH',
      headers: {
        'apikey':        SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + token,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ status: status }),
    });
    console.log('[Vanto BG] Post status updated:', postId, '->', status);
  } catch (err) {
    console.error('[Vanto BG] Status update error:', err.message);
  }
}

// ── Chrome Alarms: poll every 1 minute ─────────────────────────────────────────
chrome.alarms.create('vanto-group-poll', { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener(function(alarm) {
  if (alarm.name === 'vanto-group-poll') {
    pollDuePosts();
  }
});

// ── Notify WhatsApp tabs ────────────────────────────────────────────────────────
function notifyWhatsAppTabs(message) {
  try {
    chrome.tabs.query({ url: 'https://web.whatsapp.com/*' }, function(tabs) {
      if (!tabs || !tabs.length) return;
      tabs.forEach(function(tab) {
        chrome.tabs.sendMessage(tab.id, message, function() {
          void chrome.runtime.lastError;
        });
      });
    });
  } catch (e) {
    console.warn('[Vanto BG] notifyWhatsAppTabs error:', e.message);
  }
}

// ── Password reset ─────────────────────────────────────────────────────────────
async function handleResetPassword(email) {
  console.log('[Vanto BG] Password reset for:', email);
  try {
    var res = await fetch(SUPABASE_URL + '/auth/v1/recover', {
      method: 'POST',
      headers: {
        'apikey':       SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: email,
        gotrue_meta_security: {},
      }),
    });
    if (!res.ok) {
      var data = await res.json();
      return { success: false, error: data.msg || data.error_description || 'Reset failed' };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── Message router ─────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (!msg || !msg.type) return false;

  console.log('[Vanto BG] Message received:', msg.type);

  if (msg.type === 'VANTO_GET_SESSION') {
    getSession().then(function(session) {
      refreshTokenIfNeeded(session).then(function(refreshed) {
        sendResponse({ token: refreshed.token, email: refreshed.email });
      });
    });
    return true;
  }

  if (msg.type === 'VANTO_LOGIN') {
    handleLogin(msg.email, msg.password).then(sendResponse);
    return true;
  }

  if (msg.type === 'VANTO_LOGOUT') {
    handleLogout().then(sendResponse);
    return true;
  }

  if (msg.type === 'VANTO_SAVE_CONTACT') {
    handleSaveContact(msg.payload).then(sendResponse);
    return true;
  }

  if (msg.type === 'VANTO_LOAD_CONTACT') {
    handleLoadContact(msg.phone).then(sendResponse);
    return true;
  }

  if (msg.type === 'VANTO_LOAD_TEAM') {
    handleLoadTeamMembers().then(sendResponse);
    return true;
  }

  if (msg.type === 'VANTO_RESET_PASSWORD') {
    handleResetPassword(msg.email).then(sendResponse);
    return true;
  }

  if (msg.type === 'VANTO_UPSERT_GROUP') {
    handleUpsertGroup(msg.groupName).then(sendResponse);
    return true;
  }

  if (msg.type === 'VANTO_POST_RESULT') {
    // Content script reports execution result — handled inline in executeGroupPost
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

console.log('[Vanto BG] Service worker started v4.0 (with Group Campaigns)');
