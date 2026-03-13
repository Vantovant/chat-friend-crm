/**
 * Vanto CRM — Background Service Worker v5.0
 * MV3 compliant service worker.
 * OWNS: session storage, auth calls, Edge Function calls, group polling engine, heartbeat.
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

// ── Upsert WhatsApp Group (with group_jid) ────────────────────────────────────
async function handleUpsertGroup(groupName, groupJid) {
  var session = await getSession();
  session = await refreshTokenIfNeeded(session);

  if (!session.token) return { success: false, error: 'not_logged_in' };

  try {
    var payload = JSON.parse(atob(session.token.split('.')[1]));
    var userId = payload.sub;

    var body = {
      user_id: userId,
      group_name: groupName,
    };
    if (groupJid) body.group_jid = groupJid;

    var url = SUPABASE_URL + '/rest/v1/whatsapp_groups';
    var res = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey':        SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + session.token,
        'Content-Type':  'application/json',
        'Prefer':        'resolution=merge-duplicates',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      var errText = await res.text();
      console.warn('[Vanto BG] Group upsert failed:', res.status, errText);
      return { success: false, error: errText };
    }

    console.log('[Vanto BG] Group upserted:', groupName, groupJid ? '(JID: ' + groupJid + ')' : '');
    return { success: true };
  } catch (err) {
    console.error('[Vanto BG] Group upsert error:', err.message);
    return { success: false, error: err.message };
  }
}

// ── Heartbeat: report extension health ─────────────────────────────────────────
async function sendHeartbeat(options) {
  var opts = options || {};
  var session = await getSession();
  session = await refreshTokenIfNeeded(session);

  if (!session.token) {
    return { success: false, error: 'not_authenticated' };
  }

  try {
    var heartbeatData = JSON.stringify({
      last_seen: new Date().toISOString(),
      whatsapp_ready: !!opts.whatsappReady,
      source: opts.source || 'background',
      tab_count: typeof opts.tabCount === 'number' ? opts.tabCount : null,
      content_script_active: !!opts.contentScriptActive,
    });

    // Upsert into integration_settings (explicit conflict target is required)
    var url = SUPABASE_URL + '/rest/v1/integration_settings?on_conflict=key';
    var res = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey':        SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + session.token,
        'Content-Type':  'application/json',
        'Prefer':        'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        key: 'chrome_extension_heartbeat',
        value: heartbeatData,
      }),
    });

    if (!res.ok) {
      var errText = await res.text();
      console.warn('[Vanto BG] Heartbeat upsert failed:', res.status, errText);
      return { success: false, error: 'upsert_failed_' + res.status };
    }

    return { success: true };
  } catch (err) {
    console.warn('[Vanto BG] Heartbeat error:', err.message);
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

  // Check if WhatsApp Web tab exists
  var tabs = await new Promise(function(resolve) {
    chrome.tabs.query({ url: 'https://web.whatsapp.com/*' }, function(t) { resolve(t || []); });
  });

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

    if (tabs.length === 0) {
      console.warn('[Vanto BG] No WhatsApp Web tab found — marking all as failed');
      for (var i = 0; i < posts.length; i++) {
        await updatePostStatus(posts[i].id, 'failed', session.token, 'No WhatsApp Web tab open. Please open web.whatsapp.com and keep it active.', 'no_tab');
      }
      return;
    }

    var bestTab = pickBestTab(tabs);
    var targetTabId = bestTab.id;
    console.log('[Vanto BG] Using tab:', targetTabId, 'active:', bestTab.active, 'discarded:', bestTab.discarded);

    for (var j = 0; j < posts.length; j++) {
      await executeGroupPost(posts[j], session.token, targetTabId);
    }
  } catch (err) {
    console.error('[Vanto BG] Poll error:', err.message);
  }
}

// ── Ping content script to verify it's alive ──────────────────────────────────
function pingContentScript(tabId) {
  return new Promise(function(resolve) {
    var timeout = setTimeout(function() { resolve(false); }, 3000);
    try {
      chrome.tabs.sendMessage(tabId, { type: 'VANTO_PING' }, function(resp) {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) {
          console.log('[Vanto BG] Ping failed for tab', tabId, ':', chrome.runtime.lastError.message);
          resolve(false);
          return;
        }
        resolve(!!(resp && resp.pong));
      });
    } catch (e) {
      clearTimeout(timeout);
      resolve(false);
    }
  });
}

// ── Inject content script programmatically ─────────────────────────────────────
async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js'],
    });
    await chrome.scripting.insertCSS({
      target: { tabId: tabId },
      files: ['sidebar.css'],
    });
    console.log('[Vanto BG] Content script injected into tab', tabId);
    // Wait for script to initialize
    await new Promise(function(r) { setTimeout(r, 2000); });
    return true;
  } catch (err) {
    console.error('[Vanto BG] Script injection failed:', err.message);
    return false;
  }
}

// ── Pick best WhatsApp tab (prefer active/focused) ─────────────────────────────
function pickBestTab(tabs) {
  if (!tabs || tabs.length === 0) return null;
  // Prefer active tab
  for (var i = 0; i < tabs.length; i++) {
    if (tabs[i].active) return tabs[i];
  }
  // Prefer non-discarded
  for (var j = 0; j < tabs.length; j++) {
    if (!tabs[j].discarded) return tabs[j];
  }
  return tabs[0];
}

async function executeGroupPost(post, token, tabId) {
  console.log('[Vanto BG] Executing post to group:', post.target_group_name);

  try {
    // Step 1: Ping content script to verify it's alive
    var alive = await pingContentScript(tabId);
    console.log('[Vanto BG] Content script ping result:', alive, 'tab:', tabId);

    if (!alive) {
      // Step 2: Try programmatic injection
      console.log('[Vanto BG] Content script not responding — attempting injection');
      var injected = await injectContentScript(tabId);
      if (injected) {
        alive = await pingContentScript(tabId);
        console.log('[Vanto BG] Post-injection ping result:', alive);
      }

      if (!alive) {
        // Step 3: Try other WhatsApp tabs
        var allTabs = await new Promise(function(resolve) {
          chrome.tabs.query({ url: 'https://web.whatsapp.com/*' }, function(t) { resolve(t || []); });
        });
        for (var t = 0; t < allTabs.length; t++) {
          if (allTabs[t].id !== tabId) {
            alive = await pingContentScript(allTabs[t].id);
            if (alive) {
              tabId = allTabs[t].id;
              console.log('[Vanto BG] Switched to responsive tab:', tabId);
              break;
            }
            // Try injecting into this tab too
            var injected2 = await injectContentScript(allTabs[t].id);
            if (injected2) {
              alive = await pingContentScript(allTabs[t].id);
              if (alive) {
                tabId = allTabs[t].id;
                console.log('[Vanto BG] Injected + switched to tab:', tabId);
                break;
              }
            }
          }
        }
      }

      if (!alive) {
        var failReason = 'Content script unreachable on all ' + (allTabs ? allTabs.length : 1) + ' WhatsApp tab(s). ' +
          'Ensure WhatsApp Web is fully loaded and not in a background/sleeping tab. ' +
          'Try refreshing the WhatsApp Web page.';
        await updatePostStatus(post.id, 'failed', token, failReason, 'content_unreachable');
        return;
      }
    }

    // Step 4: Send the actual execution command with generous timeout
    var response = await new Promise(function(resolve) {
      var timeoutId = setTimeout(function() {
        resolve({ success: false, error: 'Execution timeout (45s) — content script was alive but did not finish in time', stage: 'execution_timeout' });
      }, 45000);

      chrome.tabs.sendMessage(tabId, {
        type: 'VANTO_EXECUTE_GROUP_POST',
        groupName: post.target_group_name,
        messageContent: post.message_content,
        postId: post.id,
      }, function(resp) {
        clearTimeout(timeoutId);
        if (chrome.runtime.lastError) {
          console.warn('[Vanto BG] Execute message error:', chrome.runtime.lastError.message);
          resolve({ success: false, error: 'Tab communication error: ' + chrome.runtime.lastError.message, stage: 'messaging' });
        } else {
          resolve(resp || { success: false, error: 'No response from content script after command', stage: 'no_response' });
        }
      });
    });

    if (response && response.success) {
      console.log('[Vanto BG] Post sent successfully:', post.id);
      await updatePostStatus(post.id, 'sent', token, null, null);
    } else {
      var reason = (response && response.error) || 'Unknown execution error';
      var stage = (response && response.stage) || 'unknown';
      console.warn('[Vanto BG] Post execution failed:', reason, 'stage:', stage);
      await updatePostStatus(post.id, 'failed', token, reason, stage);
    }
  } catch (err) {
    console.error('[Vanto BG] Execute error:', err.message);
    await updatePostStatus(post.id, 'failed', token, err.message, 'poll');
  }
}

async function updatePostStatus(postId, status, token, failureReason, failureStage) {
  try {
    var url = SUPABASE_URL + '/rest/v1/scheduled_group_posts?id=eq.' + postId;
    var body = { status: status };

    if (status === 'failed') {
      var fullReason = failureStage ? '[' + failureStage + '] ' + (failureReason || 'Unknown') : (failureReason || 'Unknown');
      body.failure_reason = fullReason;
      body.last_attempt_at = new Date().toISOString();
      // Increment attempt_count via a read-then-write (simple approach)
    }

    if (status === 'sent') {
      body.failure_reason = null;
    }

    await fetch(url, {
      method: 'PATCH',
      headers: {
        'apikey':        SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + token,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(body),
    });
    console.log('[Vanto BG] Post status updated:', postId, '->', status, failureReason ? '(' + failureReason + ')' : '');
  } catch (err) {
    console.error('[Vanto BG] Status update error:', err.message);
  }
}

// ── Chrome Alarms: poll every 1 minute, heartbeat every 1 minute ───────────────
function ensureBackgroundAlarms() {
  chrome.alarms.create('vanto-group-poll', { periodInMinutes: 1 });
  chrome.alarms.create('vanto-heartbeat', { periodInMinutes: 1 });
}

ensureBackgroundAlarms();

chrome.runtime.onInstalled.addListener(function() {
  ensureBackgroundAlarms();
  sendIndependentHeartbeat('on_installed');
});

chrome.runtime.onStartup.addListener(function() {
  ensureBackgroundAlarms();
  sendIndependentHeartbeat('on_startup');
});

chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
  if (changeInfo.status !== 'complete') return;
  if (!tab || !tab.url || tab.url.indexOf('https://web.whatsapp.com/') !== 0) return;
  sendIndependentHeartbeat('tab_updated');
});

// Send initial heartbeat on startup
sendIndependentHeartbeat('service_worker_boot');

chrome.alarms.onAlarm.addListener(function(alarm) {
  if (alarm.name === 'vanto-group-poll') {
    pollDuePosts();
  }
  if (alarm.name === 'vanto-heartbeat') {
    sendIndependentHeartbeat('alarm');
  }
});

// ── Independent heartbeat (decoupled from polling) ─────────────────────────────
async function sendIndependentHeartbeat(source) {
  // Check if WhatsApp Web tab exists
  var tabs = await new Promise(function(resolve) {
    chrome.tabs.query({ url: 'https://web.whatsapp.com/*' }, function(t) { resolve(t || []); });
  });

  var result = await sendHeartbeat({
    whatsappReady: tabs.length > 0,
    source: source || 'background',
    tabCount: tabs.length,
    contentScriptActive: false,
  });

  if (result && result.success) {
    console.log('[Vanto BG] Heartbeat sent (source:', source || 'background', 'tabs:', tabs.length, ')');
  } else {
    console.log('[Vanto BG] Heartbeat skipped/failed (source:', source || 'background', 'reason:', result && result.error, ')');
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
    handleUpsertGroup(msg.groupName, msg.groupJid || null).then(sendResponse);
    return true;
  }

  if (msg.type === 'VANTO_HEARTBEAT_PING') {
    var senderUrl = sender && sender.tab && sender.tab.url ? sender.tab.url : '';
    var isWhatsAppSender = senderUrl.indexOf('https://web.whatsapp.com/') === 0;

    if (!isWhatsAppSender) {
      sendResponse({ success: false, error: 'invalid_sender' });
      return false;
    }

    sendHeartbeat({
      whatsappReady: !!msg.whatsappReady,
      source: msg.source || 'content_script',
      tabCount: 1,
      contentScriptActive: true,
    }).then(function(result) {
      sendResponse({ success: !!(result && result.success), error: result && result.error ? result.error : null });
    });
    return true;
  }

  if (msg.type === 'VANTO_POST_RESULT') {
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

console.log('[Vanto BG] Service worker started v5.0 (with diagnostics + heartbeat)');
