/* auth-pages.js — logique de signup.html, login.html, verification.html et compte.html.
 * Authentification entièrement déléguée à Supabase Auth (aucun compte ni mot de passe local).
 */
(function () {
  'use strict';

  var S = window.SereneShop;
  var UI = window.SiteUI;
  var page = document.body.dataset.page;
  var params = new URLSearchParams(location.search);
  var next = params.get('next') || '';
  if (['checkout', 'admin'].indexOf(next) === -1) next = '';

  function $(id) { return document.getElementById(id); }
  function withNext(path) { return path + (next ? '?next=' + encodeURIComponent(next) : ''); }

  var msg = $('formMessage') || $('pageMessage');

  function notConfigured() {
    if (!S.configured) {
      UI.showMessage(msg, 'error', 'Supabase is not configured yet: fill in supabase-client.js (see SUPABASE.md).');
      document.querySelectorAll('form button[type="submit"], #resendBtn').forEach(function (b) { b.disabled = true; });
      return true;
    }
    return false;
  }

  function busy(btn, on, label) {
    btn.disabled = on;
    if (label) btn.textContent = label;
  }

  /* ---------- signup.html ---------- */
  function initSignup() {
    $('loginLink').href = withNext('login.html');
    if (notConfigured()) return;
    var busyFlag = false;

    $('signupForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      if (busyFlag) return;
      var first = $('firstName').value.trim();
      var last = $('lastName').value.trim();
      var email = $('email').value.trim();
      var pw = $('password').value;

      if (!first || !last) return UI.showMessage(msg, 'error', 'Please enter your first and last name.');
      if (!/^\S+@\S+\.\S+$/.test(email)) return UI.showMessage(msg, 'error', 'Please enter a valid e-mail address.');
      if (pw.length < 8) return UI.showMessage(msg, 'error', 'The password must contain at least 8 characters.');
      if (pw !== $('password2').value) return UI.showMessage(msg, 'error', 'The two passwords do not match.');

      busyFlag = true;
      busy($('submitBtn'), true, 'Creating your account…');
      UI.hideMessage(msg);
      try {
        var data = await S.signUp({ email: email, password: pw, firstName: first, lastName: last, next: next });
        if (data.session) {
          // Confirmation d'e-mail désactivée côté Supabase : le compte est déjà actif
          location.href = S.destinationFor(next);
        } else {
          location.href = withNext('verification.html' + '') +
            (next ? '&' : '?') + 'email=' + encodeURIComponent(email);
        }
      } catch (err) {
        UI.showMessage(msg, 'error', err.message);
        busyFlag = false;
        busy($('submitBtn'), false, 'Create account');
      }
    });
  }

  /* ---------- login.html ---------- */
  async function initLogin() {
    $('signupLink').href = withNext('signup.html');
    if (params.get('next') === 'checkout') {
      $('loginIntro').textContent = 'Sign in to complete your order. Your basket is kept.';
    }
    if (notConfigured()) return;

    // Arrivée depuis le lien de confirmation (session créée par supabase-js) ou déjà connecté
    try {
      var existing = await S.getUser();
      if (existing) { location.href = S.destinationFor(next); return; }
    } catch (e) { /* on affiche le formulaire */ }

    var busyFlag = false;
    $('loginForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      if (busyFlag) return;
      var email = $('email').value.trim();
      var pw = $('password').value;
      if (!email || !pw) return UI.showMessage(msg, 'error', 'Please enter your e-mail and password.');

      busyFlag = true;
      busy($('submitBtn'), true, 'Signing in…');
      UI.hideMessage(msg);
      try {
        await S.signIn(email, pw);
        location.href = S.destinationFor(next);
      } catch (err) {
        UI.showMessage(msg, 'error', err.message);
        busyFlag = false;
        busy($('submitBtn'), false, 'Sign in');
      }
    });
  }

  /* ---------- verification.html ---------- */
  async function initVerification() {
    var email = params.get('email') || '';
    $('emailShown').textContent = email || 'your address';
    $('loginLink').href = withNext('login.html');
    $('signupLink').href = withNext('signup.html');
    if (notConfigured()) return;

    var cooling = false;
    $('resendBtn').addEventListener('click', async function () {
      if (cooling) return;
      if (!email) return UI.showMessage(msg, 'error', 'We do not know which address to use. Please start again from the sign-up page.');
      cooling = true;
      var btn = $('resendBtn');
      btn.disabled = true;
      UI.hideMessage(msg);
      try {
        await S.resendConfirmation(email, next);
        UI.showMessage(msg, 'success', 'We asked for a new e-mail to be sent. It may take a few minutes to arrive.');
      } catch (err) {
        UI.showMessage(msg, 'error', err.message);
      }
      var left = 60;
      var timer = setInterval(function () {
        left--;
        btn.textContent = left > 0 ? 'Send again in ' + left + 's' : 'Send the e-mail again';
        if (left <= 0) { clearInterval(timer); btn.disabled = false; cooling = false; }
      }, 1000);
    });
  }

  /* ---------- compte.html ---------- */
  async function initAccount() {
    if (notConfigured()) { $('ordersStatus').textContent = ''; return; }

    var user;
    try { user = await S.getUser(); } catch (e) { user = null; }
    if (!user) {
      location.href = 'login.html?next=account';
      return;
    }
    var meta = user.user_metadata || {};
    $('accName').textContent = [meta.first_name, meta.last_name].filter(Boolean).join(' ') || '—';
    $('accEmail').textContent = user.email || '—';

    var focusId = params.get('order');
    var isNew = params.get('new') === '1';
    var status = $('ordersStatus');
    var list = $('ordersList');

    try {
      var orders = await S.listMyOrders(user.id);
      if (focusId && !orders.some(function (o) { return o.id === focusId; })) {
        var one = await S.getMyOrder(user.id, focusId);
        if (one) orders.unshift(one);
      }

      if (isNew && focusId) {
        var o = orders.filter(function (x) { return x.id === focusId; })[0];
        if (o) {
          UI.showMessage($('pageMessage'), 'success',
            'Thank you! Your demo order ' + o.reference + ' has been recorded (total ' + S.formatMoney(o.total_cents) +
            '). No payment was taken.');
        }
      }

      if (orders.length === 0) {
        status.textContent = 'You have not placed any order yet.';
        return;
      }
      status.textContent = '';
      if (orders.length >= 100) {
        var note = $('ordersNote');
        note.classList.remove('hidden');
        note.textContent = 'Only your 100 most recent orders are shown.';
      }

      orders.forEach(function (o) {
        var det = UI.h('details', { class: 'vintage-card rounded-2xl p-4', open: o.id === focusId },
          UI.h('summary', { class: 'cursor-pointer flex flex-wrap items-center justify-between gap-2 font-sans text-sm' },
            UI.h('span', { class: 'font-bold', text: o.reference }),
            UI.h('span', { class: 'text-sepia-700', text: S.formatDate(o.created_at) }),
            UI.h('span', { class: 'font-bold text-dustyrose-600', text: S.formatMoney(o.total_cents) }),
            UI.statusBadge(o.status)),
          UI.h('div', { class: 'mt-3 border-t border-sepia-700/15 pt-3' }, UI.orderDetails(o)));
        list.append(det);
      });
    } catch (err) {
      status.textContent = '';
      UI.showMessage($('pageMessage'), 'error', 'Could not load your orders: ' + err.message);
    }
  }

  UI.renderHeader('siteHeader');
  if (page === 'signup') initSignup();
  else if (page === 'login') initLogin();
  else if (page === 'verification') initVerification();
  else if (page === 'compte') initAccount();
})();
