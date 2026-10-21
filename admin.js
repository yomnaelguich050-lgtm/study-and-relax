/* admin.js — page d'administration (commandes + produits).
 * ⚠ Ce contrôle d'accès n'est qu'un confort d'interface : la vraie protection
 * est assurée par RLS dans la base (voir supabase-*.sql).
 */
(function () {
  'use strict';

  var S = window.SereneShop;
  var UI = window.SiteUI;
  var h = UI.h;
  var PAGE_SIZE = 50;

  function $(id) { return document.getElementById(id); }

  var orders = new Map();   // id -> commande (ordre d'insertion = ordre d'affichage)
  var offset = 0;
  var loadingOrders = false;
  var products = [];
  var editingId = null;     // null = nouveau produit
  var savingProduct = false;

  /* ---------- Accès ---------- */
  async function init() {
    UI.renderHeader('siteHeader');
    var gateText = $('gateText'), gateLink = $('gateLink');

    if (!S.configured) {
      gateText.textContent = 'Supabase is not configured yet: fill in supabase-client.js (see SUPABASE.md).';
      return;
    }
    var user = null;
    try { user = await S.getUser(); } catch (e) { /* traité ci-dessous */ }
    if (!user) {
      gateText.textContent = 'Please sign in to access the administration area.';
      gateLink.textContent = 'Sign in';
      gateLink.href = 'login.html?next=admin';
      gateLink.classList.remove('hidden');
      return;
    }
    var admin = false;
    try { admin = await S.isAdmin(user); } catch (e) { /* non admin */ }
    if (!admin) {
      gateText.textContent = 'This area is reserved for the shop administrator. Your account is a customer account, so you cannot manage orders or products here.';
      gateLink.classList.remove('hidden');
      return;
    }

    $('gate').classList.add('hidden');
    $('adminContent').classList.remove('hidden');
    bindOrders();
    bindProducts();
    resetProductForm();
    loadOrders(true);
    loadProducts();
  }

  /* ---------- Commandes ---------- */
  function bindOrders() {
    $('refreshOrders').addEventListener('click', function () { loadOrders(true); });
    $('statusFilter').addEventListener('change', function () { loadOrders(true); });
    $('loadMoreOrders').addEventListener('click', function () { loadOrders(false); });
  }

  async function loadOrders(reset) {
    if (loadingOrders) return;
    loadingOrders = true;
    var status = $('ordersStatus');
    var more = $('loadMoreOrders');
    $('refreshOrders').disabled = true;
    more.disabled = true;
    UI.hideMessage($('ordersMessage'));
    if (reset) { orders.clear(); offset = 0; $('ordersList').textContent = ''; more.classList.add('hidden'); }
    status.textContent = 'Loading orders…';

    try {
      var rows = await S.adminListOrders({ status: $('statusFilter').value, offset: offset, limit: PAGE_SIZE });
      offset += rows.length;
      rows.forEach(function (o) { orders.set(o.id, o); });
      renderOrders();
      status.textContent = orders.size === 0 ? 'No orders match this filter.' : orders.size + ' order(s) shown.';
      more.classList.toggle('hidden', rows.length < PAGE_SIZE);
    } catch (err) {
      status.textContent = '';
      UI.showMessage($('ordersMessage'), 'error', 'Could not load orders: ' + err.message);
    } finally {
      loadingOrders = false;
      $('refreshOrders').disabled = false;
      more.disabled = false;
    }
  }

  function renderOrders() {
    var list = $('ordersList');
    var openIds = new Set();
    list.querySelectorAll('details[open]').forEach(function (d) { openIds.add(d.dataset.id); });
    list.textContent = '';
    orders.forEach(function (o) { list.append(orderRow(o, openIds.has(o.id))); });
  }

  function orderRow(o, isOpen) {
    var select = h('select', { class: 'field !w-auto', 'aria-label': 'Status of order ' + o.reference },
      Object.keys(UI.STATUS_LABELS).map(function (k) {
        var opt = h('option', { value: k, text: UI.STATUS_LABELS[k] });
        if (k === o.status) opt.selected = true;
        return opt;
      }));
    var feedback = h('div', { class: 'hidden' });
    var save = h('button', { type: 'button', class: 'btn-secondary text-sm', text: 'Save status' });
    var saving = false;

    save.addEventListener('click', async function () {
      if (saving) return;
      if (select.value === o.status) {
        return UI.showMessage(feedback, 'info', 'The status is unchanged.');
      }
      saving = true; save.disabled = true; select.disabled = true;
      save.textContent = 'Saving…';
      try {
        var updated = await S.adminUpdateOrderStatus(o.id, o.version, select.value);
        orders.set(o.id, updated);
        renderOrders();
        UI.showMessage($('ordersMessage'), 'success', 'Order ' + updated.reference + ' is now "' + UI.STATUS_LABELS[updated.status] + '".');
      } catch (err) {
        if (err.code === 'conflict') {
          // Quelqu'un d'autre a modifié la commande : on recharge sans écraser
          try {
            var fresh = await S.adminGetOrder(o.id);
            if (fresh) { orders.set(o.id, fresh); renderOrders(); }
          } catch (e2) { /* message ci-dessous suffit */ }
          UI.showMessage($('ordersMessage'), 'error',
            'Order ' + o.reference + ' was modified by someone else in the meantime. It has been reloaded; nothing was overwritten. Please check and try again.');
        } else {
          UI.showMessage(feedback, 'error', err.message);
          saving = false; save.disabled = false; select.disabled = false;
          save.textContent = 'Save status';
        }
      }
    });

    return h('details', { class: 'vintage-card rounded-2xl p-4', 'data-id': o.id, open: isOpen },
      h('summary', { class: 'cursor-pointer grid sm:grid-cols-5 gap-2 items-center font-sans text-sm' },
        h('span', { class: 'font-bold', text: o.reference }),
        h('span', { class: 'text-sepia-700', text: S.formatDate(o.created_at) }),
        h('span', { text: o.customer_name + (o.customer_email ? ' · ' + o.customer_email : '') }),
        h('span', { class: 'font-bold text-dustyrose-600', text: S.formatMoney(o.total_cents) }),
        h('span', {}, UI.statusBadge(o.status))),
      h('div', { class: 'mt-3 border-t border-sepia-700/15 pt-3 space-y-4' },
        UI.orderDetails(o),
        h('div', { class: 'flex flex-wrap items-center gap-3 font-sans text-sm border-t border-sepia-700/15 pt-3' },
          h('span', { class: 'font-bold', text: 'Change status:' }), select, save),
        feedback));
  }

  /* ---------- Produits ---------- */
  function bindProducts() {
    $('productForm').addEventListener('submit', onSaveProduct);
    $('newProduct').addEventListener('click', function () { resetProductForm(); $('pId').focus(); });
    $('cancelEdit').addEventListener('click', resetProductForm);
  }

  async function loadProducts() {
    $('productsStatus').textContent = 'Loading products…';
    try {
      products = await S.adminListProducts();
      renderProducts();
      $('productsStatus').textContent = products.length === 0 ? 'No product registered yet.' : '';
    } catch (err) {
      $('productsStatus').textContent = '';
      UI.showMessage($('productMessage'), 'error', 'Could not load products: ' + err.message);
    }
  }

  function renderProducts() {
    var list = $('productsList');
    list.textContent = '';
    products.forEach(function (p) {
      var img = S.safeImageUrl(p.image_url);
      var edit = h('button', { type: 'button', class: 'btn-secondary text-sm', text: 'Edit' });
      var del = h('button', { type: 'button', class: 'btn-secondary text-sm !text-dustyrose-800', text: 'Delete' });
      edit.addEventListener('click', function () { fillProductForm(p); });
      del.addEventListener('click', async function () {
        if (!window.confirm('Delete "' + p.name + '"? This cannot be undone. Past orders keep their own copy of the product.')) return;
        del.disabled = edit.disabled = true;
        try {
          await S.deleteProduct(p.id);
          if (editingId === p.id) resetProductForm();
          UI.showMessage($('productMessage'), 'success', 'Product "' + p.name + '" deleted.');
          await loadProducts();
        } catch (err) {
          del.disabled = edit.disabled = false;
          UI.showMessage($('productMessage'), 'error', err.message);
        }
      });
      list.append(h('div', { class: 'vintage-card rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3 font-sans text-sm' },
        h('div', { class: 'flex items-center gap-3 min-w-0' },
          img ? h('img', { src: img, alt: '', class: 'w-12 h-12 rounded-lg object-cover', loading: 'lazy' }) : null,
          h('div', { class: 'min-w-0' },
            h('p', { class: 'font-bold', text: p.name }),
            h('p', { class: 'text-xs text-sepia-700',
              text: p.id + ' · ' + p.category + ' · ' + S.formatMoney(p.price_cents) + (p.is_available ? '' : ' · hidden') }))),
        h('div', { class: 'flex gap-2' }, edit, del)));
    });
  }

  function resetProductForm() {
    editingId = null;
    $('productForm').reset();
    $('pId').readOnly = false;
    $('pAvailable').checked = true;
    $('formTitle').textContent = 'Add a product';
    $('saveProduct').textContent = 'Save product';
    UI.hideMessage($('productMessage'));
  }

  function fillProductForm(p) {
    editingId = p.id;
    $('pId').value = p.id;
    $('pId').readOnly = true;
    $('pName').value = p.name;
    $('pCategory').value = p.category;
    $('pPrice').value = (p.price_cents / 100).toFixed(2);
    $('pImage').value = p.image_url || '';
    $('pDescription').value = p.description || '';
    $('pFeatures').value = (p.features || []).join('\n');
    $('pAvailable').checked = !!p.is_available;
    $('formTitle').textContent = 'Edit product';
    $('saveProduct').textContent = 'Update product';
    UI.hideMessage($('productMessage'));
    $('productForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('pName').focus();
  }

  function readProductForm() {
    var id = $('pId').value.trim();
    var name = $('pName').value.trim();
    var priceNum = Number($('pPrice').value.replace(',', '.'));
    var image = $('pImage').value.trim();
    var features = $('pFeatures').value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean);

    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id) || id.length > 60) return { error: 'The identifier must use lowercase letters, digits and hyphens only.' };
    if (!name) return { error: 'Please enter a product name.' };
    if (!isFinite(priceNum) || priceNum <= 0 || priceNum > 1000000) return { error: 'Please enter a valid price greater than 0.' };
    if (image && !S.safeImageUrl(image)) return { error: 'The image must be an existing site file (e.g. images/tea.jpg) or a public HTTPS URL.' };
    if (features.length > 20) return { error: 'Please list at most 20 features.' };

    return {
      product: {
        id: id,
        name: name,
        category: $('pCategory').value,
        description: $('pDescription').value.trim(),
        price_cents: Math.round(priceNum * 100),
        image_url: image || null,
        features: features,
        is_available: $('pAvailable').checked
      }
    };
  }

  async function onSaveProduct(e) {
    e.preventDefault();
    if (savingProduct) return;
    var parsed = readProductForm();
    if (parsed.error) return UI.showMessage($('productMessage'), 'error', parsed.error);

    savingProduct = true;
    var btn = $('saveProduct');
    var label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      var wasNew = editingId === null;
      var saved = await S.saveProduct(parsed.product, wasNew);
      UI.showMessage($('productMessage'), 'success', 'Product "' + saved.name + '" ' + (wasNew ? 'added.' : 'updated.'));
      resetProductForm();
      UI.showMessage($('productMessage'), 'success', 'Product "' + saved.name + '" ' + (wasNew ? 'added.' : 'updated.'));
      await loadProducts();
    } catch (err) {
      UI.showMessage($('productMessage'), 'error', err.message);
      btn.textContent = label;
    } finally {
      savingProduct = false;
      btn.disabled = false;
    }
  }

  init();
})();
