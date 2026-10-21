/* script.js — panier, checkout et interfaces de la boutique (index.html).
 * Le panier reste local (localStorage : id produit -> quantité). Catalogue, authentification
 * et commandes passent par SereneShop (supabase-shop.js). Aucune gestion de compte locale.
 */
(function () {
  'use strict';

  var S = window.SereneShop;
  var CART_KEY = 'serene_cart_v1';
  var ATTEMPT_KEY = 'serene_order_attempt_v1';
  // Doit rester identique aux constantes de supabase-orders.sql (la base fait foi)
  var FREE_SHIPPING_CENTS = 10000;
  var SHIPPING_CENTS = 700;
  var MAX_QTY = 20;

  var catalog = [];
  var catalogLoaded = false;
  var cart = loadCart();
  var submitting = false;

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function money(c) { return S ? S.formatMoney(c) : (c / 100).toFixed(2) + ' TND'; }

  /* ---------- Panier local ---------- */
  function loadCart() {
    try {
      var raw = JSON.parse(localStorage.getItem(CART_KEY) || '{}');
      var out = {};
      Object.keys(raw).forEach(function (id) {
        var n = Math.floor(Number(raw[id]));
        if (n >= 1) out[id] = Math.min(n, MAX_QTY);
      });
      return out;
    } catch (e) { return {}; }
  }

  function saveCart() {
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) { /* stockage indisponible */ }
  }

  function findProduct(id) {
    for (var i = 0; i < catalog.length; i++) if (catalog[i].id === id) return catalog[i];
    return null;
  }

  function cartLines() {
    return Object.keys(cart).map(function (id) {
      return { id: id, qty: cart[id], product: findProduct(id) };
    });
  }

  function totals() {
    var sub = 0;
    cartLines().forEach(function (l) { if (l.product) sub += l.product.price_cents * l.qty; });
    var ship = sub === 0 ? 0 : (sub >= FREE_SHIPPING_CENTS ? 0 : SHIPPING_CENTS);
    return { sub: sub, ship: ship, total: sub + ship };
  }

  function hasUnavailable() {
    return cartLines().some(function (l) { return !l.product; });
  }

  function addToCart(id) {
    cart[id] = Math.min((cart[id] || 0) + 1, MAX_QTY);
    saveCart();
    renderCart();
  }

  function changeQty(id, delta) {
    var n = (cart[id] || 0) + delta;
    if (n <= 0) delete cart[id]; else cart[id] = Math.min(n, MAX_QTY);
    saveCart();
    renderCart();
  }

  function removeFromCart(id) {
    delete cart[id];
    saveCart();
    renderCart();
  }

  /* ---------- Affichage boutique / panier ---------- */
  function showShopStatus(kind, text) {
    var box = $('shopStatus');
    if (!box) return;
    if (!text) { box.className = 'hidden'; box.textContent = ''; return; }
    box.className = 'text-xs rounded-xl p-3 border ' + (kind === 'error'
      ? 'bg-dustyrose-100 text-dustyrose-800 border-dustyrose-300'
      : 'bg-parchment-dark text-sepia-800 border-sepia-700/20');
    box.textContent = text;
  }

  function renderShop() {
    var host = $('shopProducts');
    if (!host) return;
    host.textContent = '';
    if (catalogLoaded && catalog.length === 0) {
      host.append(el('p', 'italic text-xs text-sepia-700', 'No products are available right now.'));
      return;
    }
    catalog.forEach(function (p) {
      var row = el('div', 'p-3.5 vintage-card rounded-2xl flex items-center justify-between gap-3 text-xs');
      var info = el('div');
      info.append(el('p', 'font-bold text-sepia-900 text-sm', p.name));
      info.append(el('p', 'text-sepia-700', p.description));
      info.append(el('span', 'font-bold text-dustyrose-600', money(p.price_cents)));
      var btn = el('button', 'bg-sage-600 hover:bg-sage-800 text-white font-semibold px-3 py-1.5 rounded-lg transition-all shrink-0', '+ Add');
      btn.type = 'button';
      btn.dataset.action = 'add';
      btn.dataset.id = p.id;
      btn.setAttribute('aria-label', 'Add ' + p.name + ' to basket');
      row.append(info, btn);
      host.append(row);
    });
  }

  function renderCart() {
    var list = $('cartItemsList');
    if (!list) return;
    var lines = cartLines();
    var count = lines.reduce(function (n, l) { return n + l.qty; }, 0);
    $('cartBadge').textContent = String(count);

    list.textContent = '';
    if (lines.length === 0) {
      list.append(el('p', 'italic text-sepia-700', 'Your basket is currently empty.'));
    }
    lines.forEach(function (l) {
      var row = el('div', 'bg-parchment-dark p-2 rounded-lg space-y-1');
      var top = el('div', 'flex justify-between items-center gap-2');
      var name = l.product ? l.product.name : 'Unavailable product (' + l.id + ')';
      top.append(el('span', 'font-semibold', name));
      var rm = el('button', 'text-red-700 font-bold hover:text-red-900', '✕');
      rm.type = 'button'; rm.dataset.action = 'remove'; rm.dataset.id = l.id;
      rm.setAttribute('aria-label', 'Remove ' + name);
      top.append(rm);
      row.append(top);

      if (l.product) {
        var bottom = el('div', 'flex justify-between items-center');
        var qty = el('div', 'flex items-center gap-2');
        var minus = el('button', 'w-6 h-6 rounded-full border border-sepia-700/30 font-bold', '−');
        minus.type = 'button'; minus.dataset.action = 'dec'; minus.dataset.id = l.id;
        minus.setAttribute('aria-label', 'Decrease quantity of ' + name);
        var plus = el('button', 'w-6 h-6 rounded-full border border-sepia-700/30 font-bold', '+');
        plus.type = 'button'; plus.dataset.action = 'inc'; plus.dataset.id = l.id;
        plus.setAttribute('aria-label', 'Increase quantity of ' + name);
        plus.disabled = l.qty >= MAX_QTY;
        qty.append(minus, el('span', 'w-5 text-center font-bold', String(l.qty)), plus);
        bottom.append(qty, el('strong', 'text-dustyrose-600', money(l.product.price_cents * l.qty)));
        row.append(bottom);
      } else if (catalogLoaded) {
        row.append(el('p', 'text-dustyrose-800', 'This product is no longer sold. Please remove it.'));
      }
      list.append(row);
    });

    var t = totals();
    $('cartSubtotal').textContent = money(t.sub);
    $('cartShipping').textContent = t.sub === 0 ? '—' : (t.ship === 0 ? 'Free' : money(t.ship));
    $('cartTotalDisplay').textContent = money(t.total);

    var blocked = lines.length === 0 || !catalogLoaded || hasUnavailable();
    $('btnCheckout').disabled = blocked;
    $('btnCheckout').classList.toggle('opacity-50', blocked);
  }

  async function loadCatalog() {
    if (!S || !S.configured) {
      catalogLoaded = false;
      showShopStatus('info', 'The shop is not connected to its database yet (Supabase is not configured). Products will appear once supabase-client.js is filled in.');
      renderShop(); renderCart();
      return;
    }
    try {
      catalog = await S.listProducts();
      catalogLoaded = true;
      showShopStatus('', '');
    } catch (e) {
      catalogLoaded = false;
      showShopStatus('error', e.message);
    }
    renderShop(); renderCart();
  }

  /* ---------- Modales ---------- */
  function openStoreModal() {
    $('cartModal').classList.remove('hidden');
  }

  function toggleCartModal() {
    $('cartModal').classList.toggle('hidden');
  }

  function openSubscriptionModal() { $('subscriptionModal').classList.remove('hidden'); }
  function closeSubscriptionModal() { $('subscriptionModal').classList.add('hidden'); }

  /* ---------- Checkout ---------- */
  function showCartView() {
    $('cartView').classList.remove('hidden');
    $('checkoutForm').classList.add('hidden');
    $('btnCheckout').classList.remove('hidden');
    renderCart();
  }

  async function startCheckout() {
    if ($('btnCheckout').disabled) return;
    if (!S || !S.configured) {
      showShopStatus('error', 'Checkout is unavailable: Supabase is not configured.');
      return;
    }
    var user = await S.getUser();
    if (!user) {
      location.href = 'login.html?next=checkout';
      return;
    }
    var meta = user.user_metadata || {};
    var nameField = $('coFullName');
    if (!nameField.value) nameField.value = [meta.first_name, meta.last_name].filter(Boolean).join(' ');
    $('checkoutMessage').className = 'hidden';
    $('cartView').classList.add('hidden');
    $('btnCheckout').classList.add('hidden');
    $('checkoutForm').classList.remove('hidden');
    nameField.focus();
  }

  function checkoutMessage(kind, text) {
    var box = $('checkoutMessage');
    box.className = 'rounded-xl border p-3 ' + (kind === 'error'
      ? 'bg-dustyrose-100 text-dustyrose-800 border-dustyrose-300'
      : 'bg-parchment-dark text-sepia-800 border-sepia-700/20');
    box.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    box.textContent = text;
  }

  // Même identifiant tant que la commande (contenu + livraison) est identique : pas de doublon après une coupure réseau
  function attemptIdFor(signature) {
    try {
      var saved = JSON.parse(localStorage.getItem(ATTEMPT_KEY) || 'null');
      if (saved && saved.sig === signature && saved.id) return saved.id;
    } catch (e) { /* ignore */ }
    var id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 3 | 8)).toString(16);
      });
    try { localStorage.setItem(ATTEMPT_KEY, JSON.stringify({ sig: signature, id: id })); } catch (e) { /* ignore */ }
    return id;
  }

  function clearAttempt() {
    try { localStorage.removeItem(ATTEMPT_KEY); } catch (e) { /* ignore */ }
  }

  async function submitOrder(ev) {
    ev.preventDefault();
    if (submitting) return;
    var form = ev.currentTarget;
    if (!form.reportValidity()) return;

    var btn = $('btnPlaceOrder');
    submitting = true;
    btn.disabled = true;
    btn.textContent = 'Placing your order…';
    checkoutMessage('info', 'Sending your order…');

    try {
      var user = await S.getUser();
      if (!user) { location.href = 'login.html?next=checkout'; return; }

      var items = Object.keys(cart).map(function (id) { return { id: id, quantity: cart[id] }; });
      var shipping = {
        full_name: $('coFullName').value.trim(),
        phone: $('coPhone').value.trim(),
        address: $('coAddress').value.trim(),
        city: $('coCity').value.trim(),
        postal_code: $('coPostal').value.trim()
      };
      var payment = $('coPayment').value;
      var expected = totals().total;
      var attemptId = attemptIdFor(JSON.stringify([user.id, items, shipping, payment, expected]));

      var order = await S.createDemoOrder({
        attemptId: attemptId, items: items, shipping: shipping,
        paymentMethod: payment, expectedTotalCents: expected
      });

      // Succès confirmé par la base : on peut vider le panier
      cart = {};
      saveCart();
      clearAttempt();
      location.href = 'compte.html?order=' + encodeURIComponent(order.id) + '&new=1';
    } catch (e) {
      checkoutMessage('error', e.message || 'The order could not be placed. Your basket was kept.');
      if (e.code === 'price_changed' || e.code === 'product_unavailable') {
        clearAttempt();
        await loadCatalog();
        showCartView();
        showShopStatus('error', e.message);
      } else if (e.code === 'not_authenticated') {
        location.href = 'login.html?next=checkout';
      }
    } finally {
      submitting = false;
      btn.disabled = false;
      btn.textContent = 'Place demo order';
    }
  }

  /* ---------- Branchements ---------- */
  function bind() {
    $('cartOverlay').addEventListener('click', toggleCartModal);
    $('cartClose').addEventListener('click', toggleCartModal);
    $('btnCheckout').addEventListener('click', startCheckout);
    $('btnBackToCart').addEventListener('click', showCartView);
    $('checkoutForm').addEventListener('submit', submitOrder);

    function handle(e) {
      var b = e.target.closest('[data-action]');
      if (!b) return;
      var id = b.dataset.id;
      if (b.dataset.action === 'add') addToCart(id);
      else if (b.dataset.action === 'inc') changeQty(id, 1);
      else if (b.dataset.action === 'dec') changeQty(id, -1);
      else if (b.dataset.action === 'remove') removeFromCart(id);
    }
    $('shopProducts').addEventListener('click', handle);
    $('cartItemsList').addEventListener('click', handle);

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      $('cartModal').classList.add('hidden');
      closeSubscriptionModal();
    });
  }

  // Fonctions appelées par les attributs onclick existants de index.html
  window.toggleCartModal = toggleCartModal;
  window.openStoreModal = openStoreModal;
  window.openSubscriptionModal = openSubscriptionModal;
  window.closeSubscriptionModal = closeSubscriptionModal;

  async function init() {
    bind();
    renderCart();
    if (S) S.refreshNav();
    await loadCatalog();
    if (location.hash === '#checkout') {
      openStoreModal();
      startCheckout();
    }
  }

  init();
})();
