// Vanto CRM — Background Service Worker v7.0.0 (MVP)
// Responsibilities (MVP only):
//   - Session management (login / logout / refresh / reset password)
//   - Save contact to CRM
//   - Load team members for Assign To dropdown
//   - Notify open WhatsApp tabs when session changes
//
// Removed in v7.0.0:
//   - Scheduled group post polling (chrome.alarms)
//   - executeGroupPost / heartbeats
//   - Bulk WhatsApp name sync
//   - Programmatic content-script injection (manifest content_scripts is enough)
//   - Group upsert from extension (managed in web app)

const SUPABASE_URL = 'https://nqyyvqcmcyggvlcswkio.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xeXl2cWNtY3lnZ3ZsY3N3a2lvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1NDYxMjYsImV4cCI6MjA4NzEyMjEyNn0.oK04GkXogHo9pohYd4A7XAV0-Q-qSu-uUiGWaj4ClM8';
const DASHBOARD_URL = 'https://chat.onlinecourseformlm.com';

function log(...args) { console.log('[Vanto BG v7]', ...args); }
function logError(...args) { console.error('[Vanto BG v7]', ...args); }

// ---------- Session ----------
const KEYS = {
  token: 'vanto_token',
  email: 'vanto_email',
  refresh: 'vanto_refresh',
  expiresAt: 'vanto_expires_at'
};

function getSession() {
  return new Promise((resolve) => {
    chrome.storage.local.get(Object.values(KEYS), (r) => {
      resolve({
        token: r[KEYS.token] || null,
        email: r[KEYS.email] || null,
        refresh: r[KEYS.refresh] || null,
        expiresAt: r[KEYS.expiresAt] || null
      });
    });
  });
}

function saveSession(data) {
  return new Promise((resolve) => {
    chrome.storage.local.set({
      [KEYS.token]: data.access_token,
      [KEYS.email]: data.user?.email,
      [KEYS.refresh]: data.refresh_token,
      [KEYS.expiresAt]: Date.now() + (data.expires_in * 1000)
    }, resolve);
  });
}

function clearSession() {
  return new Promise((resolve) => chrome.storage.local.remove(Object.values(KEYS), resolve));
}

async function refreshTokenIfNeeded() {
  const session = await getSession();
  if (!session.token) return null;
  // Refresh if expiring within 60s
  if (session.expiresAt && Date.now() < session.expiresAt - 60000) return session.token;
  if (!session.refresh) return session.token;
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
      body: JSON.stringify({ refresh_token: session.refresh })
    });
    if (!response.ok) {
      logError('Refresh failed', await response.text());
      await clearSession();
      await notifyTabsOfLogout();
      return null;
    }
    const data = await response.json();
    await saveSession(data);
    return data.access_token;
  } catch (e) {
    logError('Refresh error', e);
    return session.token;
  }
}

async function notifyTabsOfLogout() {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
    for (const tab of tabs) {
      try { await chrome.tabs.sendMessage(tab.id, { type: 'VANTO_TOKEN_CLEARED' }); } catch (_) {}
    }
  } catch (_) {}
}

async function notifyTabsOfLogin(token, email) {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'VANTO_SESSION_UPDATE', token, email });
      } catch (_) {}
    }
  } catch (_) {}
}

// ---------- Auth handlers ----------
async function handleLogin(email, password) {
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
      body: JSON.stringify({ email, password })
    });
    const data = await response.json();
    if (!response.ok) {
      return { success: false, error: data.error_description || data.error || 'Login failed' };
    }
    await saveSession(data);
    await notifyTabsOfLogin(data.access_token, data.user?.email);
    return { success: true, email: data.user?.email };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function handleLogout() {
  await clearSession();
  await notifyTabsOfLogout();
  return { success: true };
}

async function handleResetPassword(email) {
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
      body: JSON.stringify({ email })
    });
    if (!response.ok) {
      const data = await response.json();
      return { success: false, error: data.error_description || 'Reset failed' };
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ---------- Contact + team ----------
async function handleSaveContact(payload, token) {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/upsert-whatsapp-contact`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const error = await response.text();
      return { success: false, error };
    }
    const data = await response.json();
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function handleLoadTeamMembers(token) {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?select=id,full_name,email&order=full_name`,
      { headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_ANON_KEY } }
    );
    if (!response.ok) return { success: false, error: await response.text() };
    const data = await response.json();
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ---------- Message router ----------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    let result;
    switch (message.type) {
      case 'VANTO_GET_SESSION': {
        const session = await getSession();
        if (session.token) {
          const token = await refreshTokenIfNeeded();
          result = { token, email: session.email };
        } else {
          result = { token: null, email: null };
        }
        break;
      }
      case 'VANTO_LOGIN':
        result = await handleLogin(message.email, message.password);
        break;
      case 'VANTO_LOGOUT':
        result = await handleLogout();
        break;
      case 'VANTO_RESET_PASSWORD':
        result = await handleResetPassword(message.email);
        break;
      case 'VANTO_SAVE_CONTACT': {
        const t = await refreshTokenIfNeeded();
        result = t ? await handleSaveContact(message.payload, t) : { success: false, error: 'Not authenticated' };
        break;
      }
      case 'VANTO_LOAD_TEAM': {
        const t = await refreshTokenIfNeeded();
        result = t ? await handleLoadTeamMembers(t) : { success: false, error: 'Not authenticated' };
        break;
      }
      default:
        result = { success: false, error: 'Unknown message type' };
    }
    sendResponse(result);
  })();
  return true;
});

log('Service worker started (MVP). Dashboard:', DASHBOARD_URL);
