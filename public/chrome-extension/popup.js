/**
 * Vanto CRM — Popup UI Script v2.0
 * MV3 compliant: NO inline scripts. All logic here.
 * Auth is owned by background.js service worker.
 * Popup only handles UI and delegates actions via chrome.runtime.sendMessage.
 */

'use strict';

// ── DOM refs ──────────────────────────────────────────────────────────────────
var viewLogin    = document.getElementById('view-login');
var viewLoggedin = document.getElementById('view-loggedin');
var emailInput   = document.getElementById('input-email');
var passInput    = document.getElementById('input-password');
var loginBtn     = document.getElementById('btn-login');
var logoutBtn    = document.getElementById('btn-logout');
var errorEl      = document.getElementById('login-error');
var displayEmail = document.getElementById('display-email');

// ── UI helpers ─────────────────────────────────────────────────────────────────
function showError(msg) {
  errorEl.textContent   = msg;
  errorEl.style.display = 'block';
}

function clearError() {
  errorEl.textContent   = '';
  errorEl.style.display = 'none';
}

function setLoginBtnState(loading) {
  loginBtn.disabled    = loading;
  loginBtn.textContent = loading ? 'Logging in…' : 'Log in';
}

function showLoggedInView(email) {
  viewLogin.style.display    = 'none';
  viewLoggedin.style.display = 'flex';
  displayEmail.textContent   = email || '—';
}

function showLoginView() {
  viewLoggedin.style.display = 'none';
  viewLogin.style.display    = 'flex';
  setLoginBtnState(false);
  passInput.value = '';
}

// ── On load: ask background for session state ──────────────────────────────────
console.log('[Vanto Popup] Initialising');

chrome.runtime.sendMessage({ type: 'VANTO_GET_SESSION' }, function(response) {
  // Swallow connection errors (background may be sleeping on first open)
  if (chrome.runtime.lastError) {
    console.warn('[Vanto Popup] Background not ready:', chrome.runtime.lastError.message);
    return;
  }
  console.log('[Vanto Popup] Session state:', response);
  if (response && response.token) {
    showLoggedInView(response.email);
  }
  // else: login view is already visible by CSS default
});

// ── Login handler ──────────────────────────────────────────────────────────────
function doLogin() {
  console.log('[Vanto Popup] Login clicked');
  clearError();

  var email    = (emailInput.value || '').trim();
  var password = passInput.value || '';

  if (!email || !password) {
    showError('Please enter email and password.');
    return;
  }

  setLoginBtnState(true);

  // Delegate auth entirely to background service worker
  chrome.runtime.sendMessage(
    { type: 'VANTO_LOGIN', email: email, password: password },
    function(response) {
      if (chrome.runtime.lastError) {
        console.error('[Vanto Popup] Runtime error:', chrome.runtime.lastError.message);
        showError('Extension error — try reloading.');
        setLoginBtnState(false);
        return;
      }

      console.log('[Vanto Popup] Login response:', response);

      if (response && response.success) {
        console.log('[Vanto Popup] Login success:', response.email);
        showLoggedInView(response.email);
      } else {
        var msg = (response && response.error) || 'Login failed — check credentials.';
        console.warn('[Vanto Popup] Login failed:', msg);
        showError(msg);
        setLoginBtnState(false);
      }
    }
  );
}

// ── Logout handler ─────────────────────────────────────────────────────────────
function doLogout() {
  chrome.runtime.sendMessage({ type: 'VANTO_LOGOUT' }, function() {
    if (chrome.runtime.lastError) {
      console.warn('[Vanto Popup] Logout runtime error:', chrome.runtime.lastError.message);
    }
    showLoginView();
  });
}

// ── Event listeners (attached after DOM ready) ─────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  loginBtn.addEventListener('click', doLogin);

  emailInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') doLogin();
  });
  passInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') doLogin();
  });

  logoutBtn.addEventListener('click', doLogout);
});

// Also attach immediately in case DOMContentLoaded already fired
if (document.readyState !== 'loading') {
  loginBtn.addEventListener('click', doLogin);
  emailInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') doLogin();
  });
  passInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') doLogin();
  });
  logoutBtn.addEventListener('click', doLogout);
}
