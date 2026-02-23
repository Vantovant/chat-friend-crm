/**
 * Vanto CRM — Popup UI Script v2.1
 * MV3 compliant: NO inline scripts. All logic here.
 * Auth is owned by background.js service worker.
 * Popup only handles UI and delegates actions via chrome.runtime.sendMessage.
 */

'use strict';

// ── DOM refs ──────────────────────────────────────────────────────────────────
var viewLogin    = document.getElementById('view-login');
var viewLoggedin = document.getElementById('view-loggedin');
var viewForgot   = document.getElementById('view-forgot');
var emailInput   = document.getElementById('input-email');
var passInput    = document.getElementById('input-password');
var loginBtn     = document.getElementById('btn-login');
var logoutBtn    = document.getElementById('btn-logout');
var errorEl      = document.getElementById('login-error');
var displayEmail = document.getElementById('display-email');

// Forgot password refs
var forgotBtn       = document.getElementById('btn-forgot');
var backLoginBtn    = document.getElementById('btn-back-login');
var forgotEmailInput = document.getElementById('input-forgot-email');
var sendResetBtn    = document.getElementById('btn-send-reset');
var forgotError     = document.getElementById('forgot-error');
var forgotSuccess   = document.getElementById('forgot-success');

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
  viewForgot.style.display   = 'none';
  viewLoggedin.style.display = 'flex';
  displayEmail.textContent   = email || '—';
}

function showLoginView() {
  viewLoggedin.style.display = 'none';
  viewForgot.style.display   = 'none';
  viewLogin.style.display    = 'flex';
  setLoginBtnState(false);
  passInput.value = '';
}

function showForgotView() {
  viewLogin.style.display    = 'none';
  viewLoggedin.style.display = 'none';
  viewForgot.style.display   = 'flex';
  forgotError.style.display  = 'none';
  forgotSuccess.style.display = 'none';
  // Pre-fill email from login form
  if (emailInput.value) {
    forgotEmailInput.value = emailInput.value;
  }
}

// ── On load: ask background for session state ──────────────────────────────────
console.log('[Vanto Popup] Initialising');

chrome.runtime.sendMessage({ type: 'VANTO_GET_SESSION' }, function(response) {
  if (chrome.runtime.lastError) {
    console.warn('[Vanto Popup] Background not ready:', chrome.runtime.lastError.message);
    return;
  }
  console.log('[Vanto Popup] Session state:', response);
  if (response && response.token) {
    showLoggedInView(response.email);
  }
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

// ── Forgot password handler ────────────────────────────────────────────────────
function doSendReset() {
  var email = (forgotEmailInput.value || '').trim();
  if (!email) {
    forgotError.textContent   = 'Please enter your email.';
    forgotError.style.display = 'block';
    return;
  }

  forgotError.style.display   = 'none';
  forgotSuccess.style.display = 'none';
  sendResetBtn.disabled       = true;
  sendResetBtn.textContent    = 'Sending…';

  chrome.runtime.sendMessage(
    { type: 'VANTO_RESET_PASSWORD', email: email },
    function(response) {
      sendResetBtn.disabled    = false;
      sendResetBtn.textContent = 'Send Reset Link';

      if (chrome.runtime.lastError) {
        forgotError.textContent   = 'Extension error — try again.';
        forgotError.style.display = 'block';
        return;
      }

      if (response && response.success) {
        forgotSuccess.style.display = 'block';
        forgotError.style.display   = 'none';
      } else {
        forgotError.textContent   = (response && response.error) || 'Failed to send reset link.';
        forgotError.style.display = 'block';
      }
    }
  );
}

// ── Event listeners ────────────────────────────────────────────────────────────
function attachListeners() {
  loginBtn.addEventListener('click', doLogin);
  logoutBtn.addEventListener('click', doLogout);

  emailInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') doLogin();
  });
  passInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') doLogin();
  });

  forgotBtn.addEventListener('click', showForgotView);
  backLoginBtn.addEventListener('click', showLoginView);
  sendResetBtn.addEventListener('click', doSendReset);
  forgotEmailInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') doSendReset();
  });
}

document.addEventListener('DOMContentLoaded', attachListeners);
if (document.readyState !== 'loading') {
  attachListeners();
}
