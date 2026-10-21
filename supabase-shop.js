/* supabase-shop.js — accès Supabase : auth, catalogue, commandes, administration.
 * Dépend de supabase-client.js (window.sbClient). Expose window.SereneShop.
 */
(function () {
  'use strict';

  var sb = window.sbClient;
  var configured = !!window.SERENE_SUPABASE_CONFIGURED && !!sb;

  /* ---------- Erreurs lisibles ---------- */
  function ShopError(message, code) {
    this.name = 'ShopError';
    this.message = message;
    this.code = code || 'error';
  }
  ShopError.prototype = Object.create(Error.prototype);

  var CODE_MESSAGES = {
    not_configured: 'Supabase is not configured yet. Fill in supabase-client.js (see SUPABASE.md).',
    not_authenticated: 'Please sign in to continue.',
    invalid_attempt: 'The order attempt is invalid. Please try again.',
    invalid_items: 'Your basket contains an invalid item or quantity.',
    product_unavailable: 'One of the products is no longer available. Please review your basket.',
    price_changed: 'Prices changed since you opened your basket. Please review the updated total.',
    invalid_shipping: 'Please check your delivery details (name, phone, address, city).',
    invalid_payment: 'Please choose a valid payment method.',
    network: 'Network problem: could not reach the server. Your basket is safe, please try again.',
    invalid_credentials: 'Incorrect e-mail or password.',
    email_not_confirmed: 'Please confirm your e-mail address first (check your inbox and spam folder).',
    user_already_exists: 'An account already exists with this e-mail. Try signing in instead.',
    weak_password: 'This password is too weak. Use at least 8 characters.',
    rate_limited: 'Too many attempts. Please wait a little before trying again.',
    permission: 'You do not have permission to do this.',
    duplicate: 'An item with this identifier already exists.',
    conflict: 'This item was modified by someone else. It has been reloaded; please review and try again.'
  };

  function translateError(err) {
    if (err instanceof ShopError) return err;
    var raw = (err && err.message) || String(err);
    var c = err && err.code;
    var key = null;

    if (CODE_MESSAGES[raw]) key = raw;
    else if (/failed to fetch|networkerror|load failed|network request failed/i.test(raw)) key = 'network';
    else if (c === 'invalid_credentials' || /invalid login credentials/i.test(raw)) key = 'invalid_credentials';
    else if (c === 'email_not_confirmed' || /email not confirmed/i.test(raw)) key = 'email_not_confirmed';
    else if (c === 'user_already_exists' || /already registered/i.test(raw)) key = 'user_already_exists';
    else if (c === 'weak_password') key = 'weak_password';
    else if (c === 'over_email_send_rate_limit' || c === 'over_request_rate_limit' || (err && err.status === 429)) key = 'rate_limited';
    else if (c === '42501' || /row-level security|permission denied/i.test(raw)) key = 'permission';
    else if (c === '23505') key = 'duplicate';

    if (key) return new ShopError(CODE_MESSAGES[key], key);
    return new ShopError('Something went wrong: ' + raw, 'error');
  }

  function requireClient() {
    if (!configured) throw new ShopError(CODE_MESSAGES.not_configured, 'not_configured');
  }

  async function run(fn) {
    requireClient();
    try {
      return await fn();
    } catch (e) {
      throw translateError(e);
    }
  }

  function unwrap(res) {
    if (res.error) throw res.error;
    return res.data;
  }

  /* ---------- Utilitaires ---------- */
  function formatMoney(cents) {
    return (Number(cents || 0) / 100).toFixed(2) + ' TND';
  }

  function formatDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  // URL du site (localhost ou Vercel) dans le dossier courant
  function siteUrl(path) {
    return location.origin + location.pathname.replace(/[^/]*$/, '') + path;
  }

  var IMAGE_RE = /^(https:\/\/[^\s]+|[a-z0-9_./-]+\.(png|jpe?g|webp|gif|svg|avif))$/i;
  function safeImageUrl(url) {
    return url && IMAGE_RE.test(url) ? url : '';
  }

  function destinationFor(next) {
    if (next === 'checkout') return 'index.html#checkout';
    if (next === 'admin') return 'admin.html';
    return 'compte.html';
  }

  /* ---------- Authentification ---------- */
  var adminCache = { uid: null, value: false };

  async function getSession() {
    if (!configured) return null;
    return run(async function () {
      var data = unwrap(await sb.auth.getSession());
      return data.session;
    });
  }

  // Vérifie l'utilisateur auprès du serveur Auth (pas seulement le jeton local)
  async function getUser() {
    if (!configured) return null;
    var session = await getSession();
    if (!session) return null;
    var res = await sb.auth.getUser();
    if (res.error || !res.data || !res.data.user) return null;
    return res.data.user;
  }

  async function isAdmin(user) {
    if (!configured || !user) return false;
    if (adminCache.uid === user.id) return adminCache.value;
    var res = await sb.from('user_roles').select('role').eq('user_id', user.id).maybeSingle();
    var value = !res.error && !!res.data && res.data.role === 'admin';
    adminCache = { uid: user.id, value: value };
    return value;
  }

  async function signUp(opts) {
    return run(async function () {
      var redirect = siteUrl('login.html' + (opts.next ? '?next=' + encodeURIComponent(opts.next) : ''));
      var data = unwrap(await sb.auth.signUp({
        email: opts.email,
        password: opts.password,
        options: {
          data: { first_name: opts.firstName, last_name: opts.lastName },
          emailRedirectTo: redirect
        }
      }));
      // Adresse déjà inscrite : Supabase renvoie un utilisateur sans identités
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        throw new ShopError(CODE_MESSAGES.user_already_exists, 'user_already_exists');
      }
      return data; // data.session est null tant que l'e-mail n'est pas confirmé
    });
  }

  async function signIn(email, password) {
    return run(async function () {
      unwrap(await sb.auth.signInWithPassword({ email: email, password: password }));
      var user = await getUser();
      if (!user) throw new ShopError(CODE_MESSAGES.invalid_credentials, 'invalid_credentials');
      adminCache = { uid: null, value: false };
      return user;
    });
  }

  async function signOut() {
    adminCache = { uid: null, value: false };
    if (!configured) return;
    await sb.auth.signOut();
  }

  async function resendConfirmation(email, next) {
    return run(async function () {
      unwrap(await sb.auth.resend({
        type: 'signup',
        email: email,
        options: { emailRedirectTo: siteUrl('login.html' + (next ? '?next=' + encodeURIComponent(next) : '')) }
      }));
    });
  }

  // Met à jour les liens de navigation marqués data-nav="account|admin|logout"
  async function refreshNav() {
    var user = null, admin = false;
    try {
      user = await getUser();
      admin = await isAdmin(user);
    } catch (e) { /* navigation toujours utilisable */ }

    document.querySelectorAll('[data-nav="account"]').forEach(function (a) {
      a.textContent = user ? 'My account' : 'Sign in';
      a.setAttribute('href', user ? 'compte.html' : 'login.html');
    });
    document.querySelectorAll('[data-nav="admin"]').forEach(function (a) {
      a.classList.toggle('hidden', !admin);
    });
    document.querySelectorAll('[data-nav="logout"]').forEach(function (b) {
      b.classList.toggle('hidden', !user);
      if (!b.dataset.bound) {
        b.dataset.bound = '1';
        b.addEventListener('click', async function () {
          await signOut();
          location.href = 'index.html';
        });
      }
    });
  }

  if (configured) {
    // Pas d'appel Supabase directement dans le callback : on le décale
    sb.auth.onAuthStateChange(function () {
      setTimeout(refreshNav, 0);
    });
  }

  /* ---------- Catalogue ---------- */
  var PRODUCT_COLS = 'id,name,category,description,price_cents,image_url,features,is_available,created_at';

  function listProducts() {
    return run(async function () {
      return unwrap(await sb.from('products').select(PRODUCT_COLS)
        .eq('is_available', true).order('created_at', { ascending: true }).order('id'));
    });
  }

  function adminListProducts() {
    return run(async function () {
      return unwrap(await sb.from('products').select(PRODUCT_COLS)
        .order('created_at', { ascending: true }).order('id'));
    });
  }

  function saveProduct(product, isNew) {
    return run(async function () {
      if (isNew) {
        return unwrap(await sb.from('products').insert(product).select(PRODUCT_COLS).single());
      }
      var id = product.id;
      var changes = Object.assign({}, product);
      delete changes.id;
      var rows = unwrap(await sb.from('products').update(changes).eq('id', id).select(PRODUCT_COLS));
      if (!rows || rows.length === 0) throw new ShopError('Product not found or not allowed.', 'permission');
      return rows[0];
    });
  }

  function deleteProduct(id) {
    return run(async function () {
      var rows = unwrap(await sb.from('products').delete().eq('id', id).select('id'));
      if (!rows || rows.length === 0) throw new ShopError('Product not found or not allowed.', 'permission');
    });
  }

  /* ---------- Commandes (client) ---------- */
  function createDemoOrder(o) {
    return run(async function () {
      return unwrap(await sb.rpc('create_demo_order', {
        p_attempt_id: o.attemptId,
        p_items: o.items,
        p_shipping: o.shipping,
        p_payment_method: o.paymentMethod,
        p_expected_total_cents: o.expectedTotalCents
      }));
    });
  }

  // 100 dernières commandes de l'utilisateur (filtre explicite : un admin ne voit ici que les siennes)
  function listMyOrders(userId) {
    return run(async function () {
      return unwrap(await sb.from('orders').select('*').eq('user_id', userId)
        .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(100));
    });
  }

  function getMyOrder(userId, orderId) {
    return run(async function () {
      return unwrap(await sb.from('orders').select('*').eq('user_id', userId).eq('id', orderId).maybeSingle());
    });
  }

  /* ---------- Commandes (admin) ---------- */
  function adminListOrders(opts) {
    return run(async function () {
      var offset = opts.offset || 0, limit = opts.limit || 50;
      var q = sb.from('orders').select('*')
        .order('created_at', { ascending: false }).order('id', { ascending: false })
        .range(offset, offset + limit - 1);
      if (opts.status) q = q.eq('status', opts.status);
      return unwrap(await q);
    });
  }

  function adminGetOrder(id) {
    return run(async function () {
      return unwrap(await sb.from('orders').select('*').eq('id', id).maybeSingle());
    });
  }

  // Ne réussit que si la version n'a pas changé depuis le chargement
  function adminUpdateOrderStatus(id, version, status) {
    return run(async function () {
      var rows = unwrap(await sb.from('orders').update({ status: status })
        .eq('id', id).eq('version', version).select('*'));
      if (!rows || rows.length === 0) throw new ShopError(CODE_MESSAGES.conflict, 'conflict');
      return rows[0];
    });
  }

  window.SereneShop = {
    configured: configured,
    ShopError: ShopError,
    translateError: translateError,
    formatMoney: formatMoney,
    formatDate: formatDate,
    siteUrl: siteUrl,
    safeImageUrl: safeImageUrl,
    destinationFor: destinationFor,
    getSession: getSession,
    getUser: getUser,
    isAdmin: isAdmin,
    signUp: signUp,
    signIn: signIn,
    signOut: signOut,
    resendConfirmation: resendConfirmation,
    refreshNav: refreshNav,
    listProducts: listProducts,
    adminListProducts: adminListProducts,
    saveProduct: saveProduct,
    deleteProduct: deleteProduct,
    createDemoOrder: createDemoOrder,
    listMyOrders: listMyOrders,
    getMyOrder: getMyOrder,
    adminListOrders: adminListOrders,
    adminGetOrder: adminGetOrder,
    adminUpdateOrderStatus: adminUpdateOrderStatus
  };
})();
