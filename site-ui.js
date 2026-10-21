/* site-ui.js — petits utilitaires d'interface partagés par les pages compte/admin.
 * Dépend de supabase-shop.js. Tout contenu dynamique passe par textContent (jamais innerHTML).
 */
(function () {
  'use strict';

  var S = window.SereneShop;

  var STATUS_LABELS = { new: 'New', preparing: 'In preparation', completed: 'Completed', cancelled: 'Cancelled' };
  var STATUS_STYLES = {
    new: 'bg-softgold/20 text-sepia-800 border-softgold/50',
    preparing: 'bg-sage-100 text-sage-800 border-sage-600/30',
    completed: 'bg-sage-300/50 text-sage-800 border-sage-600/40',
    cancelled: 'bg-dustyrose-100 text-dustyrose-800 border-dustyrose-300'
  };
  var PAYMENT_LABELS = {
    cash_on_delivery_demo: 'Cash on delivery (demo)',
    card_demo: 'Card (demo — no card data collected)'
  };

  // Création d'éléments DOM sans innerHTML
  function h(tag, props) {
    var el = document.createElement(tag);
    var p = props || {};
    Object.keys(p).forEach(function (k) {
      var v = p[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.indexOf('on') === 0 && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var kids = [].concat(arguments[i]);
      kids.forEach(function (c) {
        if (c === null || c === undefined || c === false) return;
        el.append(c);
      });
    }
    return el;
  }

  function renderHeader(target) {
    var host = typeof target === 'string' ? document.getElementById(target) : target;
    if (!host) return;
    host.className = 'sticky top-0 z-40 bg-parchment/90 backdrop-blur-md border-b border-sepia-700/10 shadow-sm';
    host.innerHTML =
      '<div class="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between gap-3 font-sans">' +
      '<a href="index.html" class="font-cinzel font-bold text-xl tracking-wider text-sepia-900">Serene Mind</a>' +
      '<nav class="flex items-center gap-4 text-sm text-sepia-800" aria-label="Main">' +
      '<a href="index.html" class="hover:underline">Home</a>' +
      '<a data-nav="account" href="login.html" class="hover:underline">Sign in</a>' +
      '<a data-nav="admin" href="admin.html" class="hidden font-bold text-dustyrose-600 hover:underline">Admin</a>' +
      '<button data-nav="logout" type="button" class="hidden hover:underline">Sign out</button>' +
      '</nav></div>';
    S.refreshNav();
  }

  function showMessage(el, kind, text) {
    if (!el) return;
    var styles = {
      error: 'bg-dustyrose-100 text-dustyrose-800 border-dustyrose-300',
      success: 'bg-sage-100 text-sage-800 border-sage-600/30',
      info: 'bg-parchment-dark text-sepia-800 border-sepia-700/20'
    };
    el.className = 'rounded-xl border p-3 text-sm font-sans ' + (styles[kind] || styles.info);
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    el.textContent = text;
  }

  function hideMessage(el) {
    if (el) { el.className = 'hidden'; el.textContent = ''; }
  }

  function statusBadge(status) {
    return h('span', {
      class: 'inline-block rounded-full border px-2.5 py-0.5 text-xs font-bold ' + (STATUS_STYLES[status] || ''),
      text: STATUS_LABELS[status] || status
    });
  }

  // Détail d'une commande (produits, frais, livraison, paiement simulé)
  function orderDetails(o) {
    var items = Array.isArray(o.items) ? o.items : [];
    var ship = o.shipping || {};
    var th = function (t, right) {
      return h('th', { class: 'py-1 pr-2 text-xs uppercase tracking-wide text-sepia-700' + (right ? ' text-right' : ''), text: t });
    };
    var table = h('table', { class: 'w-full text-left text-sm' },
      h('thead', {}, h('tr', {}, th('Product'), th('Qty'), th('Unit price'), th('Total', true))),
      h('tbody', {}, items.map(function (i) {
        return h('tr', { class: 'border-t border-sepia-700/10' },
          h('td', { class: 'py-1 pr-2', text: i.name }),
          h('td', { class: 'py-1 pr-2', text: String(i.quantity) }),
          h('td', { class: 'py-1 pr-2', text: S.formatMoney(i.unit_price_cents) }),
          h('td', { class: 'py-1 text-right', text: S.formatMoney(i.line_total_cents) }));
      })));
    var line = function (label, value, strong) {
      return h('div', { class: 'flex justify-between' + (strong ? ' font-bold text-sepia-900' : '') },
        h('span', { text: label }), h('span', { text: value }));
    };
    return h('div', { class: 'space-y-3 text-sm text-sepia-800 font-sans' },
      table,
      h('div', { class: 'space-y-1 border-t border-sepia-700/15 pt-2' },
        line('Subtotal', S.formatMoney(o.subtotal_cents)),
        line('Delivery', o.shipping_cents === 0 ? 'Free' : S.formatMoney(o.shipping_cents)),
        line('Total', S.formatMoney(o.total_cents), true)),
      h('div', { class: 'border-t border-sepia-700/15 pt-2' },
        h('p', { class: 'font-bold text-sepia-900', text: 'Delivery details' }),
        h('p', { text: ship.full_name || '' }),
        h('p', { text: ship.address || '' }),
        h('p', { text: [ship.postal_code, ship.city].filter(Boolean).join(' ') }),
        h('p', { text: 'Phone: ' + (ship.phone || '') })),
      h('p', { class: 'border-t border-sepia-700/15 pt-2' },
        h('span', { class: 'font-bold text-sepia-900', text: 'Payment (simulated): ' }),
        PAYMENT_LABELS[o.payment_method] || o.payment_method));
  }

  window.SiteUI = {
    h: h,
    renderHeader: renderHeader,
    showMessage: showMessage,
    hideMessage: hideMessage,
    statusBadge: statusBadge,
    orderDetails: orderDetails,
    STATUS_LABELS: STATUS_LABELS
  };
})();
