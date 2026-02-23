/**
 * Vanto CRM — Background Service Worker v3.0
 * MV3 compliant service worker.
 * OWNS: session storage, auth calls, Edge Function calls.
 * Popup and content script communicate via chrome.runtime.sendMessage.
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
    return session; // still valid
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
// payload must contain: name, phone (user-entered), whatsapp_id (WA internal), ...
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
    // Try phone_normalized first, then whatsapp_id
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

    // Fallback: try whatsapp_id
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

  return false;
});

console.log('[Vanto BG] Service worker started v3.0');
