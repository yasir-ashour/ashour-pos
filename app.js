/* ==========================================================================
   app.js — الكود الكامل والموحد لنظام مركز عاشور (الكاشير + المخزون + الطلبات + الأوفلاين)
   ========================================================================== */

const CURRENCY = 'ل.س.ج';
const $ = id => document.getElementById(id);

function toNum(val) {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}
function roundMoney(val) {
  return Math.round((toNum(val) + Number.EPSILON) * 100) / 100;
}
function calcLineTotal(price, qty) {
  return roundMoney(toNum(price) * toNum(qty));
}
function sumList(arr, getter) {
  let t = 0;
  for (let i = 0; i < arr.length; i++) t = roundMoney(t + toNum(getter(arr[i])));
  return t;
}
function fromDisplayAmount(val) {
  const n = toNum(val);
  return state.displayCurrency === 'USD' ? roundMoney(n * toNum(state.exchangeRate || 15000)) : roundMoney(n);
}
function toDisplayInputValue(sypVal) {
  const n = toNum(sypVal);
  return state.displayCurrency === 'USD' ? roundMoney(n / toNum(state.exchangeRate || 15000)) : roundMoney(n);
}
function fmt(n) {
  const num = roundMoney(n);
  const parts = String(num).split('.');
  const intFormatted = Number(parts[0]).toLocaleString('en-US');
  return parts.length > 1 ? `${intFormatted}.${parts[1]}` : intFormatted;
}
function fmtCur(n) {
  if (state.displayCurrency === 'USD') {
    const usd = toNum(n) / toNum(state.exchangeRate || 15000);
    return '$' + usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return `${fmt(n)} ل.س.ج`;
}
function fmtDual(sypAmount) {
  const usd = toNum(sypAmount) / toNum(state.exchangeRate || 15000);
  return `${fmt(sypAmount)} ل.س.ج (≈ $${usd.toFixed(2)})`;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function normalizeArabic(str) {
  return String(str || '').toLowerCase().replace(/[أآإٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[\u064b-\u065f]/g, '');
}
function dayKey(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function nowStr() {
  return new Date().toLocaleString('ar-SY');
}

function debounce(fn, ms = 220) {
  let t = null;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

const warn = (title, text, icon = 'warning') => Swal.fire({ icon, title, text, confirmButtonColor: '#0F5C4E' });
const toast = (title, icon = 'success') => Swal.fire({ toast: true, position: 'top-end', icon, title, showConfirmButton: false, timer: 1600 });

const debouncedRenderPosProducts   = debounce(() => renderPosProducts(), 160);
const debouncedPopulatePosClients  = debounce(() => populatePosClients(), 160);
const debouncedRenderInvoicesTable = debounce(() => renderInvoicesTable(), 200);
const debouncedRenderProductsTable = debounce(() => renderProductsTable(), 200);
const debouncedRenderInventory     = debounce(() => renderInventory(), 200);
const debouncedRenderClientsGrid   = debounce(() => renderClientsGrid(), 200);
const debouncedRenderCompaniesGrid = debounce(() => renderCompaniesGrid(), 200);

const DEFAULT_CATEGORIES = ['بسكويت', 'شيبس', 'عصائر ومشروبات', 'سكاكر وعلكة', 'قهوة', 'مواد غذائية'];

let state = {};
let isCheckoutSubmitting = false;
let currentDebtTab = 'take';

function defaultState() {
  return {
    pinHash: null, pinSalt: null, pinLength: 4, pinAttempts: 0, pinLockUntil: 0,
    storeInfo: { name: 'مركز عاشور للتجارة', phone: '0991234567', address: 'السوق المركزي - صالة الجملة' },
    displayCurrency: 'SYP',
    exchangeRate: 15000,
    products: [],
    clients: [
      { id: 'c1', name: 'زبون نقدي مباشر', type: 'retail', phone: '-', address: '-', openingDebt: 0, customPrices: {} }
    ],
    invoices: [], expenses: [], payments: [], returns: [], directSales: [], noInvoiceItems: [],
    companies: [], purchases: [], companyPayments: [], personDebts: [],
    orders: [],
    auditLog: [{ ts: Date.now(), date: nowStr(), type: 'النظام', details: 'بدء تشغيل النظام', status: 'مكتمل' }],
    invoiceCounter: 1000,
    cart: [],
    selectedPosCategory: 'الكل',
    posPriceOverride: null,
    currentLedgerClientId: null,
    currentReceiptInv: null,
    activeCompanyId: null,
    customPricesEditing: null,
    lastUpdated: 0
  };
}

async function saveToStorage() {
  state.lastUpdated = Date.now();
  const result = await AshourDB.save(state);
  if (!result.ok) {
    Swal.fire({
      icon: 'error',
      title: 'فشل الحفظ المحلي!',
      html: `تعذّر حفظ البيانات.<br><small>${esc(result.errors.join(' | '))}</small>`,
      confirmButtonColor: '#d33'
    });
    return false;
  }
  if (window.FireSync && window.FireSync.currentUser && typeof window.FireSync.saveToCloud === 'function') {
    window.FireSync.saveToCloud(state).catch(() => {});
  }
  return true;
}

let backupTimer = null;
function startAutoBackup() {
  if (backupTimer) clearInterval(backupTimer);
  backupTimer = setInterval(async () => {
    if (state && Array.isArray(state.products)) await AshourDB.saveBackup(state);
  }, 5 * 60 * 1000);
}

async function loadFromStorage() {
  const result = await AshourDB.load();
  if (result.ok && result.state) state = deepMerge(defaultState(), result.state);
  else state = defaultState();

  ['returns', 'directSales', 'noInvoiceItems', 'companies', 'payments', 'expenses', 'invoices', 'products', 'clients', 'purchases', 'companyPayments', 'personDebts', 'orders'].forEach(k => {
    if (!Array.isArray(state[k])) state[k] = [];
  });

  state.clients.forEach(c => {
    if (!c.customPrices || typeof c.customPrices !== 'object') c.customPrices = {};
  });

  state.products.forEach(p => {
    if (p.stock == null || !Number.isFinite(Number(p.stock))) p.stock = 0;
  });

  if (!state.invoiceCounter) state.invoiceCounter = 1000;
  if (!state.pinSalt) state.pinSalt = generateSalt();
  if (!state.pinHash) {
    state.pinHash = await hashPin('1234', state.pinSalt);
    state.pinLength = 4;
  }
  if (!state.pinLength) state.pinLength = 4;
  await AshourDB.save(state);
  startAutoBackup();
}

function deepMerge(target, source) {
  const out = Array.isArray(target) ? [...target] : { ...target };
  if (!source || typeof source !== 'object') return out;
  Object.keys(source).forEach(k => {
    const sv = source[k], tv = out[k];
    if (sv && typeof sv === 'object' && !Array.isArray(sv) && tv && typeof tv === 'object' && !Array.isArray(tv)) out[k] = deepMerge(tv, sv);
    else out[k] = sv;
  });
  return out;
}

function generateSalt() {
  try {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (_) {
    return 'salt_' + Date.now() + '_' + Math.random().toString(36).slice(2);
  }
}

async function hashPin(pin, salt) {
  const txt = String(salt || '') + String(pin);
  try {
    if (window.crypto && crypto.subtle && crypto.subtle.digest) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
  } catch (e) {}
  let h = 5381;
  for (let i = 0; i < txt.length; i++) h = ((h << 5) + h + txt.charCodeAt(i)) | 0;
  return 'f' + (h >>> 0).toString(16);
}

let enteredPin = '';
function pressPin(n) {
  const targetLen = state.pinLength || 4;
  if (enteredPin.length < 6) {
    enteredPin += n;
    updatePinDots();
    if (enteredPin.length === targetLen) submitPin();
  }
}
function clearPin() { enteredPin = ''; updatePinDots(); }
function updatePinDots() {
  document.querySelectorAll('.pin-dot').forEach((d, i) => {
    d.classList.toggle('bg-ashour', i < enteredPin.length);
    d.classList.remove('bg-rose-500', 'border-rose-500');
  });
}

async function submitPin() {
  const errEl = $('pinError');
  errEl.classList.add('hidden');
  if (state.pinLockUntil && Date.now() < state.pinLockUntil) {
    const secs = Math.ceil((state.pinLockUntil - Date.now()) / 1000);
    errEl.textContent = `محاولات كثيرة. انتظر ${secs} ثانية.`;
    errEl.classList.remove('hidden');
    clearPin();
    return;
  }
  const h = await hashPin(enteredPin, state.pinSalt);
  if (h === state.pinHash) {
    $('pinOverlay').classList.add('hidden');
    state.pinAttempts = 0;
    await saveToStorage();
    clearPin();
    resetAutoLock();
    setTimeout(() => { const q = $('quickEntryInput'); if (q) q.focus(); }, 200);
  } else {
    state.pinAttempts = toNum(state.pinAttempts) + 1;
    const dotsContainer = $('pinDots');
    dotsContainer.classList.add('animate-shake');
    document.querySelectorAll('.pin-dot').forEach(d => d.classList.add('bg-rose-500', 'border-rose-500'));
    setTimeout(() => dotsContainer.classList.remove('animate-shake'), 400);
    if (state.pinAttempts >= 5) {
      state.pinLockUntil = Date.now() + 30000;
      state.pinAttempts = 0;
      errEl.textContent = 'قفل 30 ثانية.';
    } else errEl.textContent = 'رمز PIN غير صحيح';
    errEl.classList.remove('hidden');
    setTimeout(() => clearPin(), 600);
    await saveToStorage();
  }
}

function lockApp() {
  $('pinOverlay').classList.remove('hidden');
  clearPin();
  $('pinError').classList.add('hidden');
}
let autoLockTimer = null, lastActivity = 0;
function resetAutoLock() {
  const now = Date.now();
  if (now - lastActivity < 1500) return;
  lastActivity = now;
  clearTimeout(autoLockTimer);
  autoLockTimer = setTimeout(() => {
    if ($('pinOverlay').classList.contains('hidden')) lockApp();
  }, 300000);
}
['click', 'mousemove', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, resetAutoLock, { passive: true }));

function logAudit(type, details) {
  const entry = { ts: Date.now(), date: nowStr(), type, details, status: 'PIN ✓' };
  state.auditLog.unshift(entry);
  if (state.auditLog.length > 500) state.auditLog.length = 500;
  AshourDB.addAudit(entry);
}

async function toggleCurrency() {
  state.displayCurrency = state.displayCurrency === 'USD' ? 'SYP' : 'USD';
  const btn = $('currencyToggleBtn');
  const btnD = $('currencyToggleBtnDesktop');
  if (btn) btn.textContent = state.displayCurrency;
  if (btnD) btnD.textContent = state.displayCurrency;
  await saveToStorage();
  renderAll();
  toast(`تم التبديل إلى ${state.displayCurrency === 'USD' ? 'الدولار' : 'الليرة السورية'}`, 'info');
}

function closeAllDropdowns() {
  document.querySelectorAll('.dropdown-panel').forEach(el => el.classList.add('hidden'));
}
function toggleDropdown(id) {
  const target = $(id);
  if (!target) return;
  const wasHidden = target.classList.contains('hidden');
  closeAllDropdowns();
  if (wasHidden) target.classList.remove('hidden');
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.relative')) {
    closeAllDropdowns();
  }
});

function switchTab(tabId) {
  closeAllDropdowns();
  document.querySelectorAll('.tab-view').forEach(el => { el.classList.add('hidden'); el.classList.remove('active'); });
  const view = $('view-' + tabId);
  if (view) { view.classList.remove('hidden'); setTimeout(() => view.classList.add('active'), 15); }
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('bg-white/20', 'active'));
  const btn = $('tab-' + tabId);
  if (btn) btn.classList.add('bg-white/20', 'active');

  if (tabId === 'settings') { loadStoreInfoToSettings(); refreshStorageStatus(); if (window.FireSync) window.FireSync._updateLoginUI(window.FireSync.currentUser); }
  if (tabId === 'reports') renderReports();
  if (tabId === 'purchases') renderPurchases();
  if (tabId === 'inventory') renderInventory();
  if (tabId === 'debts') switchDebtTab(currentDebtTab || 'take');
  if (tabId === 'clients') renderClientsGrid();
  if (tabId === 'companies') renderCompaniesGrid();
  if (tabId === 'orders') { renderOrders(); updateOrdersBadge(); }

  renderAll();
}

const MODAL_IDS = ['barcodeScannerModal', 'quickProductModal', 'directSaleModal', 'productModal', 'companyModal', 'companyProductModal', 'purchaseModal', 'personDebtModal', 'companyPaymentModal', 'receiptModal', 'clientModal', 'customPricesModal', 'orderModal', 'expenseModal'];

window.addEventListener('popstate', () => {
  if ($('barcodeScannerModal') && !$('barcodeScannerModal').classList.contains('hidden')) { closeBarcodeScanner(); history.pushState(null, null, location.href); return; }
  const openMod = MODAL_IDS.find(id => $(id) && !$(id).classList.contains('hidden'));
  if (openMod) { closeModal(openMod); history.pushState(null, null, location.href); return; }
  const activeTab = document.querySelector('.tab-btn.active');
  if (activeTab && activeTab.id !== 'tab-pos') { switchTab('pos'); history.pushState(null, null, location.href); return; }
  Swal.fire({
    title: 'هل تريد الخروج من النظام؟', text: 'سيتم إغلاق التطبيق.', icon: 'warning',
    showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6',
    confirmButtonText: 'نعم، خروج', cancelButtonText: 'إلغاء'
  }).then(result => {
    if (result.isConfirmed) history.back();
    else history.pushState(null, null, location.href);
  });
});
history.pushState(null, null, location.href);

function allCategories() {
  const set = new Set(DEFAULT_CATEGORIES);
  state.products.forEach(p => { if (p.category) set.add(p.category); });
  return [...set];
}
function refreshCategoryWidgets() {
  const cats = allCategories();
  if ($('categoryList')) $('categoryList').innerHTML = cats.map(c => `<option value="${esc(c)}"></option>`).join('');
  if ($('prodCatDropdownList')) {
    $('prodCatDropdownList').innerHTML = `<div onclick="selectProdCat('')" class="p-2.5 hover:bg-slate-100 cursor-pointer text-xs font-bold">جميع الفئات</div>` +
      cats.map(c => `<div onclick="selectProdCat('${esc(c)}')" class="p-2.5 hover:bg-slate-100 cursor-pointer text-xs font-bold">${esc(c)}</div>`).join('');
  }
  initPOSCategories();
}
function selectProdCat(cat) {
  $('prodCategoryFilter').value = cat;
  $('selectedProdCatText').textContent = cat || 'جميع الفئات';
  $('prodCatDropdownList').classList.add('hidden');
  renderProductsTable();
}
function toggleProdCatDropdown() { toggleDropdown('prodCatDropdownList'); }

function selectInvoiceStatus(val, label) {
  $('invoiceStatusFilter').value = val;
  $('selectedInvoiceStatusText').textContent = label;
  $('invoiceStatusDropdownList').classList.add('hidden');
  renderInvoicesTable();
}

/* ==========================================================================
   المخزون (Inventory)
   ========================================================================== */
function adjustProductStockDelta(productId, delta) {
  const p = state.products.find(x => x.id === productId);
  if (!p) return;
  const next = Math.max(0, roundMoney(toNum(p.stock) + toNum(delta)));
  setProductStockExact(productId, next);
}

async function setProductStockExact(productId, newStockVal) {
  const p = state.products.find(x => x.id === productId);
  if (!p) return;
  const cleanStock = Math.max(0, roundMoney(newStockVal));
  const prev = toNum(p.stock);
  if (cleanStock === prev) return;
  p.stock = cleanStock;
  logAudit('تعديل مخزون', `${p.name}: من ${fmt(prev)} إلى ${fmt(cleanStock)}`);
  const ok = await saveToStorage();
  if (!ok) { p.stock = prev; return; }
  renderInventory();
  renderProductsTable();
  renderPosProducts();
  updateLowStockBadge();
  toast(`تم تحديث مخزون ${p.name} إلى ${fmt(cleanStock)}`);
}

function updateLowStockBadge() {
  const lowCount = state.products.filter(p => toNum(p.stock) < 10).length;
  const badge = $('lowStockBadge');
  if (!badge) return;
  if (lowCount > 0) {
    badge.textContent = lowCount;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function renderInventory() {
  updateLowStockBadge();
  const q = normalizeArabic(($('invSearchInput')?.value || '').trim());
  const statusFilter = $('invStatusFilter')?.value || 'all';

  const totalProducts = state.products.length;
  const lowProducts = state.products.filter(p => toNum(p.stock) < 10).length;
  const outProducts = state.products.filter(p => toNum(p.stock) <= 0).length;
  const stockCostValue = sumList(state.products, p => calcLineTotal(p.cost, p.stock));

  if ($('inventorySummaryCards')) {
    $('inventorySummaryCards').innerHTML = `
      <div class="bg-slate-50 border rounded-xl p-2.5"><span class="block text-xs text-slate-500">إجمالي الأصناف</span><span class="font-bold text-slate-800">${fmt(totalProducts)}</span></div>
      <div class="bg-amber-50 border border-amber-200 rounded-xl p-2.5"><span class="block text-xs text-amber-700">منخفض (أقل من 10)</span><span class="font-bold text-amber-800">${fmt(lowProducts)}</span></div>
      <div class="bg-rose-50 border border-rose-200 rounded-xl p-2.5"><span class="block text-xs text-rose-700">نافذ (0)</span><span class="font-bold text-rose-700">${fmt(outProducts)}</span></div>
      <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-2.5"><span class="block text-xs text-emerald-700">قيمة المخزون (شراء)</span><span class="font-bold text-emerald-800">${fmtCur(stockCostValue)}</span></div>`;
  }

  const list = state.products.filter(p => {
    const s = toNum(p.stock);
    if (statusFilter === 'low' && !(s < 10)) return false;
    if (statusFilter === 'out' && !(s <= 0)) return false;
    if (statusFilter === 'available' && !(s >= 10)) return false;
    if (q && !(normalizeArabic(p.name).includes(q) || normalizeArabic(p.sku).includes(q) || normalizeArabic(p.barcode).includes(q))) return false;
    return true;
  });

  const tbody = $('inventoryTableBody');
  if (!tbody) return;

  tbody.innerHTML = list.map(p => {
    const s = toNum(p.stock);
    const val = calcLineTotal(p.cost, s);
    let badgeHtml = `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800">متوفر</span>`;
    if (s <= 0) badgeHtml = `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-rose-100 text-rose-700">نافذ</span>`;
    else if (s < 10) badgeHtml = `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-800">منخفض</span>`;

    return `<tr class="hover:bg-slate-50 border-b border-slate-100">
      <td class="p-3 font-bold text-ashour">${esc(p.sku || '-')}</td>
      <td class="p-3 font-bold text-slate-800">${esc(p.name)}</td>
      <td class="p-3"><span class="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-[11px]">${esc(p.category || '-')}</span></td>
      <td class="p-3 font-bold ${s <= 0 ? 'text-rose-600' : (s < 10 ? 'text-amber-700' : 'text-emerald-800')}">${fmt(s)}</td>
      <td class="p-3 text-slate-700">${fmtCur(val)}</td>
      <td class="p-3">${badgeHtml}</td>
      <td class="p-3 text-center">
        <div class="inline-flex items-center gap-1 bg-slate-100 p-1 rounded-xl border">
          <button type="button" onclick="adjustProductStockDelta('${esc(p.id)}', -1)" class="w-7 h-7 bg-white hover:bg-rose-500 hover:text-white rounded-lg text-xs font-bold shadow-sm transition">−</button>
          <input type="number" step="any" min="0" value="${s}" onchange="setProductStockExact('${esc(p.id)}', this.value)" class="w-16 text-center bg-white border border-slate-300 rounded-lg text-xs font-bold py-1">
          <button type="button" onclick="adjustProductStockDelta('${esc(p.id)}', 1)" class="w-7 h-7 bg-white hover:bg-ashour hover:text-white rounded-lg text-xs font-bold shadow-sm transition">+</button>
          <button type="button" onclick="adjustProductStockDelta('${esc(p.id)}', 10)" class="bg-emerald-100 hover:bg-emerald-600 hover:text-white text-emerald-800 px-2 py-1 rounded-lg text-[11px] font-bold transition">+10</button>
        </div>
      </td>
    </tr>`;
  }).join('') || `<tr><td colspan="7" class="p-6 text-center text-slate-400 text-sm">لا توجد أصناف مطابقة</td></tr>`;
}

/* ==========================================================================
   الديون والزبائن والأسعار الخاصة
   ========================================================================== */
function getClientDebt(clientId) {
  const c = state.clients.find(x => x.id === clientId);
  if (!c) return 0;
  const rawBalance = roundMoney(
    toNum(c.openingDebt) +
    sumList(state.invoices.filter(i => i.clientId === clientId && i.status === 'active'), i => i.remaining) -
    sumList(state.payments.filter(p => p.clientId === clientId), p => p.amount) -
    sumList(state.returns.filter(r => r.clientId === clientId), r => r.amount)
  );
  return Math.max(0, rawBalance);
}

function getClientCustomPrice(client, productId) {
  if (!client || !client.customPrices || typeof client.customPrices !== 'object') return 0;
  const p = toNum(client.customPrices[productId]);
  return p > 0 ? roundMoney(p) : 0;
}

function resolveProductPricing(product, client, overrideMode = null) {
  if (!product) return { price: 0, label: 'تجزئة', isCustom: false };
  const customPrice = getClientCustomPrice(client, product.id);
  if (!overrideMode && customPrice > 0) return { price: customPrice, label: 'سعر خاص', isCustom: true };
  const mode = overrideMode || (client && client.type === 'wholesale' ? 'wholesale' : 'retail');
  if (mode === 'wholesale') return { price: toNum(product.wholesalePrice), label: 'جملة', isCustom: false };
  return { price: toNum(product.retailPrice), label: 'تجزئة', isCustom: false };
}

async function setClientSpecialPrice(clientId, productId, price) {
  const client = state.clients.find(c => c.id === clientId);
  const prod = state.products.find(p => p.id === productId);
  if (!client) return false;
  if (!client.customPrices || typeof client.customPrices !== 'object') client.customPrices = {};
  const cleanPrice = roundMoney(price);
  if (cleanPrice > 0) client.customPrices[productId] = cleanPrice;
  else delete client.customPrices[productId];
  logAudit('تسعير خاص لزبون', `${client.name} — ${prod ? prod.name : productId}: ${cleanPrice > 0 ? fmtCur(cleanPrice) : 'إلغاء التخصيص'}`);
  return await saveToStorage();
}

function openCustomPricesModal(clientId) {
  const client = state.clients.find(c => c.id === clientId);
  if (!client) { warn('تنبيه', 'الزبون غير موجود', 'error'); return; }
  if (!state.products.length) { warn('لا توجد منتجات', 'أضف منتجات أولاً لتحديد أسعار خاصة لها', 'info'); return; }
  if (!client.customPrices || typeof client.customPrices !== 'object') client.customPrices = {};

  state.customPricesEditing = { clientId, draft: { ...client.customPrices } };
  $('customPricesClientName').textContent = client.name;
  $('cpSearchInput').value = '';
  renderCustomPricesList();
  openModal('customPricesModal');
  setTimeout(() => $('cpSearchInput')?.focus(), 100);
}

function renderCustomPricesList() {
  const editing = state.customPricesEditing;
  if (!editing) return;
  const q = normalizeArabic(($('cpSearchInput')?.value || '').trim());
  const list = state.products.filter(p =>
    !q || normalizeArabic(p.name).includes(q) ||
    normalizeArabic(p.sku).includes(q) ||
    normalizeArabic(p.barcode).includes(q)
  );

  const setCount = Object.values(editing.draft).filter(v => toNum(v) > 0).length;
  const statsEl = $('cpStats');
  if (statsEl) statsEl.textContent = `${setCount} سعر مفعّل`;

  if (!list.length) {
    $('customPricesList').innerHTML = `<div class="text-center py-10 text-slate-400 text-sm font-bold">لا توجد منتجات مطابقة</div>`;
    return;
  }

  $('customPricesList').innerHTML = list.map(p => {
    const currentCustom = toNum(editing.draft[p.id]) || 0;
    const retail = toNum(p.retailPrice);
    const wholesale = toNum(p.wholesalePrice);
    return `<div class="cp-row ${currentCustom > 0 ? 'is-set' : ''}">
      <div class="min-w-0">
        <div class="font-bold text-sm text-slate-800 truncate">${esc(p.name)}</div>
        <div class="text-[11px] text-slate-500 font-semibold num-tabular">
          تجزئة: ${fmt(retail)} • جملة: ${fmt(wholesale)} • كود: ${esc(p.sku || '-')}
        </div>
      </div>
      <div class="flex items-center gap-1">
        <input type="number" step="any" min="0" data-pid="${esc(p.id)}" value="${currentCustom > 0 ? toDisplayInputValue(currentCustom) : ''}" placeholder="0" oninput="onCustomPriceInput(this)" class="w-24 border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
        <button type="button" onclick="clearCustomPriceField('${esc(p.id)}')" class="text-rose-500 hover:text-rose-700 w-8 h-8 flex items-center justify-center" title="مسح"><i class="fa-solid fa-xmark"></i></button>
      </div>
    </div>`;
  }).join('');
}

function onCustomPriceInput(el) {
  const editing = state.customPricesEditing;
  if (!editing) return;
  const pid = el.dataset.pid;
  const val = fromDisplayAmount(el.value);
  if (val > 0) editing.draft[pid] = roundMoney(val);
  else delete editing.draft[pid];
  const row = el.closest('.cp-row');
  if (row) row.classList.toggle('is-set', val > 0);
  const setCount = Object.values(editing.draft).filter(v => toNum(v) > 0).length;
  const stats = $('cpStats');
  if (stats) stats.textContent = `${setCount} سعر مفعّل`;
}

function clearCustomPriceField(pid) {
  const editing = state.customPricesEditing;
  if (!editing) return;
  delete editing.draft[pid];
  renderCustomPricesList();
}

async function saveAllCustomPrices() {
  const editing = state.customPricesEditing;
  if (!editing) return;
  const { clientId, draft } = editing;
  const client = state.clients.find(c => c.id === clientId);
  if (!client) return;

  const prev = { ...(client.customPrices || {}) };
  client.customPrices = { ...draft };

  const activeCount = Object.values(draft).filter(v => toNum(v) > 0).length;
  logAudit('تحديث أسعار خاصة', `${client.name}: ${activeCount} سعر مفعّل`);

  const ok = await saveToStorage();
  if (!ok) { client.customPrices = prev; return; }

  state.customPricesEditing = null;
  closeModal('customPricesModal');

  if (state.currentLedgerClientId === clientId) renderClientSpecialPrices(clientId);
  if (getSelectedPosClient().id === clientId) { renderPosProducts(); renderCart(); }
  renderClientsGrid();
  toast('تم حفظ الأسعار الخاصة');
}

async function clearAllCustomPrices() {
  const editing = state.customPricesEditing;
  if (!editing) return;
  const res = await Swal.fire({
    title: 'مسح كل الأسعار الخاصة؟',
    text: 'سيتم إلغاء جميع الأسعار الخاصة لهذا الزبون عند الحفظ.',
    icon: 'warning', showCancelButton: true,
    confirmButtonColor: '#d33', cancelButtonColor: '#3085d6',
    confirmButtonText: 'نعم، امسح', cancelButtonText: 'إلغاء'
  });
  if (!res.isConfirmed) return;
  editing.draft = {};
  renderCustomPricesList();
  toast('سيتم المسح عند الحفظ', 'info');
}

/* ==========================================================================
   الكاشير والسلة والدفع
   ========================================================================== */
function initPOSCategories() {
  const cats = ['الكل', ...allCategories()];
  if (!cats.includes(state.selectedPosCategory)) state.selectedPosCategory = 'الكل';
  const sidebar = $('posCategorySidebar');
  if (sidebar) {
    sidebar.innerHTML = cats.map(cat => {
      const active = state.selectedPosCategory === cat;
      const count = cat === 'الكل' ? state.products.length : state.products.filter(p => p.category === cat).length;
      return `<button onclick="setPosCat('${esc(cat)}')" class="w-full text-right px-2.5 py-2 rounded-lg transition flex items-center justify-between ${active ? 'bg-ashour text-white shadow-sm' : 'bg-slate-50 text-slate-700 hover:bg-slate-100'}"><span>${esc(cat)}</span><span class="text-[11px] num-tabular ${active ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'} px-1.5 py-0.5 rounded-full font-bold">${count}</span></button>`;
    }).join('');
  }
  const mobileBar = $('posCategoryFilter');
  if (mobileBar) {
    mobileBar.innerHTML = cats.map(cat => `<button onclick="setPosCat('${esc(cat)}')" class="px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition ${state.selectedPosCategory === cat ? 'bg-ashour text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}">${esc(cat)}</button>`).join('');
  }
}
function setPosCat(cat) {
  state.selectedPosCategory = cat;
  initPOSCategories();
  renderPosProducts();
}

function getSelectedPosClient() {
  const id = $('posClientSelect').value || (state.clients[0] ? state.clients[0].id : 'c1');
  return state.clients.find(c => c.id === id) || state.clients[0] || { id: 'c1', name: 'زبون نقدي مباشر', type: 'retail', customPrices: {} };
}
function getActivePriceType() {
  if (state.posPriceOverride === 'wholesale' || state.posPriceOverride === 'retail') return state.posPriceOverride;
  const client = getSelectedPosClient();
  return client.type === 'wholesale' ? 'wholesale' : 'retail';
}

async function togglePosPriceMode() {
  const current = getActivePriceType();
  const next = current === 'wholesale' ? 'retail' : 'wholesale';
  const nextLabel = next === 'wholesale' ? 'جملة' : 'تجزئة';
  const client = getSelectedPosClient();

  if (state.cart.length > 0) {
    const res = await Swal.fire({
      title: `تبديل التسعيرة إلى (${nextLabel})؟`,
      text: 'هل تريد تحديث أسعار الأصناف الحالية في السلة إلى التسعيرة الجديدة؟',
      icon: 'question', showCancelButton: true, showDenyButton: true,
      confirmButtonColor: '#0F5C4E', denyButtonColor: '#475569', cancelButtonColor: '#d33',
      confirmButtonText: 'نعم، حدّث السلة', denyButtonText: 'بدّل الشارة فقط', cancelButtonText: 'إلغاء'
    });
    if (res.isDismissed) return;
    if (res.isConfirmed) {
      state.cart.forEach(item => {
        if (!item.isQuickOnly) {
          const p = state.products.find(x => x.id === item.productId);
          if (p) {
            const resolved = resolveProductPricing(p, client, next);
            if (resolved.price > 0) item.customPrice = resolved.price;
          }
        }
      });
    }
  }

  state.posPriceOverride = next;
  updatePosPriceUI();
  renderPosProducts();
  renderCart();
  toast(`التسعيرة الحالية: ${nextLabel}`);
}

function updatePosPriceUI() {
  const client = getSelectedPosClient();
  const customCount = client && client.customPrices ? Object.values(client.customPrices).filter(v => toNum(v) > 0).length : 0;
  const mode = getActivePriceType();
  const isWholesale = mode === 'wholesale';
  const badge = $('posPriceTypeBadge');
  const invBadge = $('posInvoicePriceBadge');

  const baseLabel = isWholesale ? 'جملة (موزع)' : 'تجزئة (عادي)';
  if (badge) {
    badge.textContent = !state.posPriceOverride && customCount > 0 ? `${baseLabel} + خاص (${customCount})` : baseLabel;
    badge.className = isWholesale
      ? 'inline-block bg-amber-100 text-amber-800 text-xs px-2 py-0.5 rounded font-bold mt-1'
      : 'inline-block bg-emerald-100 text-emerald-800 text-xs px-2 py-0.5 rounded font-bold mt-1';
  }
  if (invBadge) {
    invBadge.textContent = `تسعيرة: ${isWholesale ? 'جملة' : 'تجزئة'}${!state.posPriceOverride && customCount > 0 ? ' (أسعار خاصة)' : ''}`;
    invBadge.className = isWholesale
      ? 'text-[11px] px-2 py-0.5 rounded-full font-bold bg-amber-400 text-slate-950'
      : 'text-[11px] px-2 py-0.5 rounded-full font-bold bg-emerald-500/25 text-white border border-white/20';
  }
}

function populatePosClients() {
  const filter = ($('posClientSearch')?.value || '').trim().toLowerCase();
  const list = state.clients.filter(c => !filter || normalizeArabic(c.name).includes(normalizeArabic(filter)) || (c.phone || '').includes(filter));
  const dropdown = $('clientDropdownList');
  if (!dropdown) return;
  dropdown.innerHTML = list.map(c => {
    const cCount = c.customPrices ? Object.values(c.customPrices).filter(v => toNum(v) > 0).length : 0;
    return `<div onclick="selectClient('${esc(c.id)}', '${esc(c.name)}')" class="p-2.5 hover:bg-emerald-50 cursor-pointer text-xs font-bold flex justify-between items-center num-tabular">
      <span>${esc(c.name)} ${cCount > 0 ? `<span class="text-[10px] bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded mr-1">${cCount} خاص</span>` : ''}</span>
      <span class="text-[11px] text-slate-500">دين: ${fmtCur(getClientDebt(c.id))}</span>
    </div>`;
  }).join('');
  if (list.length && !$('posClientSelect').value) selectClient(list[0].id, list[0].name);
}
function selectClient(id, label) {
  $('posClientSelect').value = id;
  $('selectedClientText').textContent = label;
  $('clientDropdownList').classList.add('hidden');
  state.posPriceOverride = null;
  onPosClientChange();
}
function toggleClientDropdown() {
  populatePosClients();
  toggleDropdown('clientDropdownList');
}
function onPosClientChange() {
  const client = getSelectedPosClient();
  if (state.cart.length > 0) {
    state.cart.forEach(item => { if (!item.isQuickOnly) delete item.customPrice; });
  }
  updatePosPriceUI();
  renderPosProducts();
  renderCart();
  if (client && client.id !== 'c1') {
    const cCount = client.customPrices ? Object.values(client.customPrices).filter(v => toNum(v) > 0).length : 0;
    if (cCount > 0) toast(`تم تطبيق ${cCount} سعر خاص لـ ${client.name}`, 'info');
  }
}

function renderPosProducts() {
  const search = normalizeArabic(($('posSearch')?.value || '').trim());
  const client = getSelectedPosClient();
  const filtered = state.products.filter(p => {
    const okCat = state.selectedPosCategory === 'الكل' || p.category === state.selectedPosCategory;
    return okCat && (!search || normalizeArabic(p.name).includes(search) || normalizeArabic(p.sku).includes(search) || normalizeArabic(p.barcode).includes(search));
  });
  if (!filtered.length) {
    $('posProductsGrid').innerHTML = `<div class="col-span-full text-center py-10 text-slate-400 text-sm font-bold">لا توجد منتجات مطابقة</div>`;
    return;
  }
  $('posProductsGrid').innerHTML = filtered.map(p => {
    const resolved = resolveProductPricing(p, client, state.posPriceOverride);
    const price = resolved.price;
    const stockVal = toNum(p.stock);
    return `<div onclick="addToCart('${esc(p.id)}')" class="bg-white border ${resolved.isCustom ? 'border-purple-300 ring-1 ring-purple-200' : 'border-slate-200'} hover:border-ashour cursor-pointer transition flex flex-col justify-between rounded-xl p-2.5 shadow-sm card-hover relative group">
      <div>
        <div class="flex items-center justify-between gap-1">
          <span class="text-[11px] text-ashour font-bold bg-ashour/10 px-1.5 py-0.5 rounded w-fit num-tabular">${esc(p.sku || '-')}</span>
          <span class="text-[10px] px-1.5 py-0.5 rounded font-bold num-tabular ${stockVal <= 0 ? 'bg-rose-100 text-rose-700' : (stockVal < 10 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600')}">مخزون: ${fmt(stockVal)}</span>
        </div>
        <h4 class="font-bold text-sm text-slate-800 line-clamp-2 leading-tight mt-1">${esc(p.name)}</h4>
      </div>
      <div class="mt-2 flex items-end justify-between border-t border-slate-100 pt-1.5 num-tabular">
        <span class="text-sm ${price > 0 ? (resolved.isCustom ? 'text-purple-700 font-bold' : 'text-ashour font-bold') : 'text-rose-500 font-bold text-xs'}">${price > 0 ? fmtCur(price) : 'حدد السعر'}</span>
        <div class="w-6 h-6 bg-ashour/10 text-ashour rounded-md flex items-center justify-center group-hover:bg-ashour group-hover:text-white transition"><i class="fa-solid fa-plus text-xs"></i></div>
      </div>
    </div>`;
  }).join('');
}

function handleQuickEntry(ev) {
  if (ev.key !== 'Enter') return;
  const input = ev.target;
  const val = input.value.trim();
  if (!val) return;
  let code = val, qty = 1;
  if (val.includes('*')) {
    const parts = val.split('*');
    code = parts[0].trim();
    qty = Math.max(1, parseInt(parts[1].trim(), 10) || 1);
  }
  const product = state.products.find(p =>
    String(p.barcode || '').trim() === code ||
    String(p.sku || '').trim() === code ||
    normalizeArabic(p.name) === normalizeArabic(code)
  );
  if (!product) {
    Swal.fire({
      icon: 'question', title: 'رمز غير موجود',
      text: `لم يتم العثور على منتج بالرمز (${code}). هل تريد فتح منتج سريع؟`,
      showCancelButton: true, confirmButtonColor: '#4f46e5', cancelButtonColor: '#64748b',
      confirmButtonText: 'فتح منتج سريع', cancelButtonText: 'إغلاق'
    }).then(res => { if (res.isConfirmed) openQuickProductModal(code); });
    input.value = ''; input.focus();
    return;
  }
  const client = getSelectedPosClient();
  const resolved = resolveProductPricing(product, client, state.posPriceOverride);
  if (!(resolved.price > 0)) {
    Swal.fire({ icon: 'info', title: 'السعر غير محدد', text: `حدّد سعر ${product.name} أولاً.`, confirmButtonColor: '#0F5C4E' })
      .then(() => openProductModal(product.id));
    return;
  }
  const existing = state.cart.find(i => i.productId === product.id && !i.isQuickOnly);
  if (existing) existing.qty = roundMoney(toNum(existing.qty) + qty);
  else state.cart.push({ productId: product.id, qty });

  renderCart();
  input.value = '';
  input.focus();
  toast(`تمت إضافة ${qty} × ${product.name}`);
}

function addToCart(productId) {
  const product = state.products.find(p => p.id === productId);
  if (!product) return;
  const client = getSelectedPosClient();
  const resolved = resolveProductPricing(product, client, state.posPriceOverride);
  if (!(resolved.price > 0)) {
    Swal.fire({ icon: 'info', title: 'السعر غير محدد', text: 'حدد السعر أولاً.', confirmButtonColor: '#0F5C4E' })
      .then(() => openProductModal(productId));
    return;
  }
  const existing = state.cart.find(i => i.productId === productId && !i.isQuickOnly);
  if (existing) existing.qty = roundMoney(toNum(existing.qty) + 1);
  else state.cart.push({ productId, qty: 1 });
  renderCart();
}

function addQuickCookie(price) {
  const name = `علب بسكويت سعر ال ${price}`;
  const existing = state.cart.find(i => i.isQuickOnly && i.name === name && toNum(i.price) === price);
  if (existing) {
    existing.qty = roundMoney(toNum(existing.qty) + 1);
  } else {
    state.cart.push({
      isQuickOnly: true,
      quickId: 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
      name,
      price,
      qty: 1
    });
  }
  renderCart();
  toast(`تمت إضافة ${name}`);
}

function setCartItemQtyDirect(key, rawVal) {
  const item = state.cart.find(i => (i.quickId || i.productId) === key);
  if (!item) return;
  const val = roundMoney(rawVal);
  if (val <= 0) state.cart = state.cart.filter(i => (i.quickId || i.productId) !== key);
  else item.qty = val;
  renderCart();
}
function updateCartQty(key, delta) {
  const item = state.cart.find(i => (i.quickId || i.productId) === key);
  if (!item) return;
  const newQty = roundMoney(toNum(item.qty) + toNum(delta));
  if (newQty <= 0) state.cart = state.cart.filter(i => (i.quickId || i.productId) !== key);
  else item.qty = newQty;
  renderCart();
}
function addQtyToLast(n) {
  if (!state.cart.length) return;
  const last = state.cart[state.cart.length - 1];
  updateCartQty(last.quickId || last.productId, n);
}
function multiplyLastQty(f) {
  if (!state.cart.length) return;
  state.cart[state.cart.length - 1].qty = roundMoney(toNum(state.cart[state.cart.length - 1].qty) * toNum(f));
  renderCart();
}
function clearCart() {
  state.cart = [];
  state.posPriceOverride = null;
  $('posDiscount').value = '';
  $('posPaidAmount').value = '';
  updatePosPriceUI();
  renderPosProducts();
  renderCart();
}

function getCartItemInfo(item) {
  const client = getSelectedPosClient();
  if (item.isQuickOnly) {
    return { key: item.quickId, productId: item.quickId, name: item.name, unitPrice: toNum(item.price), unitCost: 0, isQuickOnly: true, isCustom: false };
  }
  const p = state.products.find(x => x.id === item.productId);
  if (!p) return null;
  const resolved = resolveProductPricing(p, client, state.posPriceOverride);
  const activePrice = item.customPrice != null && toNum(item.customPrice) > 0 ? toNum(item.customPrice) : resolved.price;
  return {
    key: p.id, productId: p.id, name: p.name,
    unitPrice: activePrice, unitCost: toNum(p.cost),
    isQuickOnly: false,
    isCustom: resolved.isCustom && !(item.customPrice != null && toNum(item.customPrice) > 0)
  };
}

function cartTotals() {
  let subtotal = 0, cost = 0;
  state.cart.forEach(item => {
    const info = getCartItemInfo(item);
    if (!info) return;
    subtotal = roundMoney(subtotal + calcLineTotal(info.unitPrice, item.qty));
    cost = roundMoney(cost + calcLineTotal(info.unitCost, item.qty));
  });
  const rawDiscount = fromDisplayAmount($('posDiscount')?.value);
  const discount = Math.max(0, Math.min(rawDiscount, subtotal));
  const total = roundMoney(subtotal - discount);
  const discountPct = subtotal > 0 ? roundMoney((discount / subtotal) * 100) : 0;
  return { subtotal, discount, total, cost, discountPct };
}

function renderCart() {
  const container = $('cartItemsList');
  const { subtotal, total, discount, discountPct } = cartTotals();

  if (!state.cart.length) {
    container.innerHTML = `<div class="text-center py-10 text-slate-400"><i class="fa-solid fa-basket-shopping text-3xl mb-2 opacity-40"></i><p class="text-xs font-bold">السلة فارغة.</p></div>`;
  } else {
    container.innerHTML = state.cart.map(item => {
      const info = getCartItemInfo(item);
      if (!info) return '';
      return `<div class="py-2 flex items-center justify-between gap-2 num-tabular">
        <div class="flex-grow min-w-0">
          <h5 class="font-bold text-xs text-slate-800 truncate">${esc(info.name)} ${info.isCustom ? '<span class="text-[10px] bg-purple-100 text-purple-800 px-1 rounded">خاص</span>' : ''}</h5>
          <span class="text-[11px] text-slate-500 font-semibold">${fmtCur(info.unitPrice)} × ${item.qty}</span>
        </div>
        <div class="flex items-center gap-1">
          <button onclick="updateCartQty('${esc(info.key)}', -1)" class="w-6 h-6 bg-slate-200 hover:bg-rose-500 hover:text-white rounded text-xs font-bold">−</button>
          <input type="number" min="0" step="any" value="${item.qty}" onchange="setCartItemQtyDirect('${esc(info.key)}', this.value)" class="w-12 text-center bg-slate-50 border border-slate-300 rounded text-xs font-bold py-0.5">
          <button onclick="updateCartQty('${esc(info.key)}', 1)" class="w-6 h-6 bg-slate-200 hover:bg-ashour hover:text-white rounded text-xs font-bold">+</button>
        </div>
        <div class="text-left font-bold text-xs text-ashour min-w-[82px]">${fmtCur(calcLineTotal(info.unitPrice, item.qty))}</div>
      </div>`;
    }).join('');
  }

  const warnBadge = $('discountWarningBadge');
  if (warnBadge) {
    const shouldWarn = discount >= 50 && discountPct >= 15;
    if (shouldWarn) {
      $('discountPctText').textContent = `${discountPct}%`;
      warnBadge.classList.remove('hidden');
    } else {
      warnBadge.classList.add('hidden');
      $('discountPctText').textContent = '0%';
    }
  }

  $('cartSubtotal').textContent = fmtDual(subtotal);
  $('cartTotal').textContent = fmtDual(total);
  $('posPaidAmount').placeholder = `الإجمالي: ${fmt(toDisplayInputValue(total))}`;
  updatePaymentSummaryPreview();
}

function setPaidExact() {
  const total = cartTotals().total;
  $('posPaidAmount').value = toDisplayInputValue(total);
  updatePaymentSummaryPreview();
}
function setCreditMode() { $('posPaidAmount').value = 0; updatePaymentSummaryPreview(); }
function setPaidAmount(amt) {
  $('posPaidAmount').value = toDisplayInputValue(amt);
  updatePaymentSummaryPreview();
}

function updatePaymentSummaryPreview() {
  const { total } = cartTotals();
  const raw = $('posPaidAmount').value.trim();
  const paidEntered = raw === '' ? total : Math.max(0, fromDisplayAmount(raw));
  const labelEl = $('posBalanceLabel');
  const valEl = $('posBalanceValue');
  if (!labelEl || !valEl) return;

  if (paidEntered > total) {
    const change = roundMoney(paidEntered - total);
    labelEl.textContent = 'الباقي للزبون:';
    valEl.textContent = fmtCur(change);
    valEl.className = 'text-emerald-700 font-bold';
  } else {
    const remaining = roundMoney(total - paidEntered);
    labelEl.textContent = 'المتبقي (دين):';
    valEl.textContent = fmtCur(remaining);
    valEl.className = remaining > 0 ? 'text-rose-600 font-bold' : 'text-slate-700 font-bold';
  }
}

function repeatLastInvoice() {
  const client = getSelectedPosClient();
  const sortedInvs = [...state.invoices].filter(i => i.clientId === client.id && i.status === 'active').sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const last = sortedInvs[0];
  if (!last) return warn('لا توجد فواتير', 'لا توجد فواتير سابقة لهذا الزبون', 'info');
  state.cart = last.items
    .filter(it => it.isQuickOnly || state.products.some(p => p.id === it.productId))
    .map(it => it.isQuickOnly
      ? { isQuickOnly: true, quickId: 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5), name: it.name, price: toNum(it.price), qty: toNum(it.qty) }
      : { productId: it.productId, qty: toNum(it.qty) });
  renderCart();
  toast('تم نسخ آخر فاتورة');
}

function nextInvoiceNumber() {
  state.invoiceCounter = toNum(state.invoiceCounter || 1000) + 1;
  return 'INV-' + state.invoiceCounter;
}

async function checkoutPOS() {
  if (isCheckoutSubmitting) return;
  if (!state.cart.length) return warn('السلة فارغة', 'أضف منتجات أولاً');

  const client = getSelectedPosClient();
  const { total, discount, cost } = cartTotals();

  for (const item of state.cart) {
    const info = getCartItemInfo(item);
    if (!info) return warn('منتج محذوف', 'أزل المنتجات المحذوفة من السلة', 'error');
    if (!(info.unitPrice > 0)) return warn('سعر غير محدد', info.name, 'error');
  }

  const paidRaw = $('posPaidAmount').value.trim();
  const paidEntered = paidRaw === '' ? total : Math.max(0, fromDisplayAmount(paidRaw));

  const changeGiven = paidEntered > total ? roundMoney(paidEntered - total) : 0;
  const paidRecorded = roundMoney(Math.min(paidEntered, total));
  const remaining = roundMoney(total - paidRecorded);

  if (remaining > 0 && client.id === 'c1') {
    return warn('اختيار الزبون مطلوب', 'لتسجيل فاتورة آجلة أو جزئية، يرجى اختيار زبون مسجل بدلاً من الزبون النقدي المباشر.', 'warning');
  }

  const saveBtn = $('checkoutSaveBtn');
  isCheckoutSubmitting = true;
  if (saveBtn) saveBtn.disabled = true;

  try {
    const items = state.cart.map(item => {
      const info = getCartItemInfo(item);
      return {
        productId: info.productId, name: info.name, qty: toNum(item.qty),
        price: info.unitPrice, cost: info.unitCost,
        total: calcLineTotal(info.unitPrice, item.qty),
        isQuickOnly: info.isQuickOnly
      };
    });

    const paymentType = remaining > 0 ? (paidRecorded > 0 ? 'partial' : 'debt') : 'cash';
    const priceModeLabel = getActivePriceType() === 'wholesale' ? 'جملة' : 'تجزئة';

    const prevCounter = state.invoiceCounter;
    const prevStockMap = new Map(state.products.map(p => [p.id, toNum(p.stock)]));

    items.forEach(it => {
      if (!it.isQuickOnly) {
        const prod = state.products.find(p => p.id === it.productId);
        if (prod) prod.stock = Math.max(0, roundMoney(toNum(prod.stock) - toNum(it.qty)));
      }
    });

    const inv = {
      id: nextInvoiceNumber(),
      ts: Date.now(), date: nowStr(),
      clientId: client.id, clientName: client.name,
      priceMode: priceModeLabel, paymentType,
      items, discount, total,
      paid: paidRecorded, remaining, changeGiven,
      profit: roundMoney(total - cost), status: 'active'
    };

    const previousInvoices = [...state.invoices];
    state.invoices.push(inv);
    logAudit('بيع فاتورة', `فاتورة ${inv.id} للزبون ${client.name} (${priceModeLabel}) بمبلغ ${fmtCur(total)} — متبقي ${fmtCur(remaining)}`);

    const ok = await saveToStorage();
    if (!ok) {
      state.invoices = previousInvoices;
      state.invoiceCounter = prevCounter;
      state.products.forEach(p => { if (prevStockMap.has(p.id)) p.stock = prevStockMap.get(p.id); });
      return;
    }

    showReceiptModal(inv);
    state.cart = [];
    state.posPriceOverride = null;
    $('posPaidAmount').value = '';
    $('posDiscount').value = '';
    updatePosPriceUI();
    renderAll();
    toast('تم حفظ الفاتورة');
  } finally {
    setTimeout(() => { isCheckoutSubmitting = false; if (saveBtn) saveBtn.disabled = false; }, 400);
  }
}

/* ==========================================================================
   الباركود والبيع السريع والمنتج السريع
   ========================================================================== */
let html5QrCode = null;
let currentScanTarget = 'quickEntryInput';

async function openBarcodeScanner(targetId = 'quickEntryInput') {
  currentScanTarget = targetId;
  await closeBarcodeScanner();
  const modal = $('barcodeScannerModal');
  modal.classList.remove('hidden');
  modal.style.display = 'flex';

  try {
    html5QrCode = new Html5Qrcode("barcode-reader");
    await html5QrCode.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 250, height: 150 } },
      decodedText => handleBarcodeScanSuccess(decodedText),
      () => {}
    );
  } catch (_) {
    warn('خطأ', 'تعذر تشغيل الكاميرا. تأكد من إعطاء الإذن للمتصفح.', 'error');
    await closeBarcodeScanner();
  }
}

async function handleBarcodeScanSuccess(decodedText) {
  await closeBarcodeScanner();
  if (currentScanTarget === 'prodBarcodeInput') {
    $('prodBarcodeInput').value = decodedText;
    toast('تم قراءة الباركود بنجاح');
    return;
  }
  const input = $('quickEntryInput');
  input.value = decodedText;
  handleQuickEntry({ key: 'Enter', target: input });
}

async function closeBarcodeScanner() {
  if (html5QrCode) {
    try { await html5QrCode.stop(); } catch (_) {}
    try { await html5QrCode.clear(); } catch (_) {}
    html5QrCode = null;
  }
  const modal = $('barcodeScannerModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
}

function openDirectSaleModal() {
  $('dsName').value = '';
  $('dsQty').value = '1';
  $('dsPrice').value = '';
  $('dsPaid').value = '';
  updateDirectSaleCalc();
  openModal('directSaleModal');
}

function updateDirectSaleCalc() {
  const qty = Math.max(1, parseInt($('dsQty').value, 10) || 1);
  const price = Math.max(0, fromDisplayAmount($('dsPrice').value));
  const total = calcLineTotal(price, qty);
  const paidRaw = $('dsPaid').value.trim();
  const paid = paidRaw === '' ? total : Math.max(0, fromDisplayAmount(paidRaw));
  const change = paid > total ? roundMoney(paid - total) : 0;
  const remaining = paid < total ? roundMoney(total - paid) : 0;
  $('dsSummaryText').textContent = `الإجمالي: ${fmtCur(total)} • المدفوع: ${fmtCur(paid)} • الباقي: ${fmtCur(change)} • متبقي: ${fmtCur(remaining)}`;
}

async function saveDirectSale() {
  const name = $('dsName').value.trim();
  const qty = Math.max(1, parseInt($('dsQty').value, 10) || 1);
  const price = fromDisplayAmount($('dsPrice').value);
  if (!name) return warn('خطأ', 'أدخل اسم الصنف');
  if (price <= 0) return warn('خطأ', 'أدخل سعراً صحيحاً');

  const total = calcLineTotal(price, qty);
  const paidRaw = $('dsPaid').value.trim();
  const paidEntered = paidRaw === '' ? total : Math.max(0, fromDisplayAmount(paidRaw));

  const paidRecorded = roundMoney(Math.min(paidEntered, total));
  const remaining = roundMoney(total - paidRecorded);

  const newSale = {
    id: 'QS-' + Date.now(), ts: Date.now(), date: nowStr(),
    name, price, qty, total,
    paid: paidRecorded, remaining, profit: paidRecorded
  };
  state.directSales.push(newSale);
  logAudit('بيع سريع', `${qty} × ${name} بقيمة ${fmtCur(total)}`);
  const ok = await saveToStorage();
  if (!ok) { state.directSales.pop(); return; }
  closeModal('directSaleModal');
  renderAll();
  toast(`تم تسجيل ${qty} × ${name}`);
}

/* ==========================================================================
   المنتجات
   ========================================================================== */
function generateUniqueSku() {
  const existing = new Set(state.products.map(p => String(p.sku || '').trim()));
  let num = Math.max(200, 101 + state.products.length);
  while (existing.has(String(num))) num++;
  return String(num);
}
function setAutoGeneratedSku() { $('prodSkuInput').value = generateUniqueSku(); }

function renderProductsTable() {
  const search = normalizeArabic(($('prodSearch')?.value || '').trim());
  const cat = $('prodCategoryFilter')?.value || '';
  const list = state.products.filter(p =>
    (!cat || p.category === cat) &&
    (!search || normalizeArabic(p.name).includes(search) || normalizeArabic(p.sku).includes(search) || normalizeArabic(p.barcode).includes(search))
  );
  if ($('prodCountBadge')) $('prodCountBadge').textContent = fmt(list.length);
  $('productsTableBody').innerHTML = list.map(p => {
    const s = toNum(p.stock);
    return `
    <tr class="hover:bg-slate-50 border-b border-slate-100">
      <td class="p-3 text-ashour font-bold">${esc(p.sku || '-')} <br><span class="text-[11px] text-slate-500 font-normal">${esc(p.barcode || '')}</span></td>
      <td class="p-3 font-bold text-indigo-700">${esc(p.name)}</td>
      <td class="p-3"><span class="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-[11px]">${esc(p.category || '-')}</span></td>
      <td class="p-3 font-bold ${s <= 0 ? 'text-rose-600' : (s < 10 ? 'text-amber-700' : 'text-slate-800')}">${fmt(s)}</td>
      <td class="p-3 text-slate-600">${fmtCur(p.cost)}</td>
      <td class="p-3 text-emerald-800">${fmtCur(p.retailPrice)}</td>
      <td class="p-3 text-amber-800">${fmtCur(p.wholesalePrice)}</td>
      <td class="p-3 text-center"><div class="flex justify-center gap-1">
        <button onclick="openProductModal('${esc(p.id)}')" class="bg-indigo-100 text-indigo-700 hover:bg-indigo-600 hover:text-white px-2.5 py-1 rounded transition text-xs font-bold"><i class="fa-solid fa-pen"></i></button>
        <button onclick="deleteProduct('${esc(p.id)}')" class="bg-rose-100 text-rose-700 hover:bg-rose-600 hover:text-white px-2.5 py-1 rounded transition text-xs font-bold"><i class="fa-solid fa-trash"></i></button>
      </div></td>
    </tr>`;
  }).join('') || `<tr><td colspan="8" class="p-6 text-center text-slate-400 text-sm">لا توجد منتجات</td></tr>`;
}

function openProductModal(prodId = null) {
  $('prodEditId').value = prodId || '';
  if (prodId) {
    const p = state.products.find(x => x.id === prodId);
    if (!p) return;
    $('productModalTitle').textContent = 'تعديل منتج';
    $('prodSkuInput').value = p.sku || '';
    $('prodBarcodeInput').value = p.barcode || '';
    $('prodNameInput').value = p.name || '';
    $('prodCatInput').value = p.category || '';
    $('prodStockInput').value = toNum(p.stock);
    $('prodCostInput').value = toDisplayInputValue(p.cost);
    $('prodRetailInput').value = toDisplayInputValue(p.retailPrice);
    $('prodWholesaleInput').value = toDisplayInputValue(p.wholesalePrice);
  } else {
    $('productModalTitle').textContent = 'إضافة منتج جديد';
    $('prodSkuInput').value = generateUniqueSku();
    $('prodBarcodeInput').value = '';
    $('prodNameInput').value = '';
    $('prodCatInput').value = '';
    $('prodStockInput').value = '0';
    $('prodCostInput').value = '';
    $('prodRetailInput').value = '';
    $('prodWholesaleInput').value = '';
  }
  openModal('productModal');
}

async function saveProduct() {
  const editId = $('prodEditId').value;
  let sku = $('prodSkuInput').value.trim();
  const barcode = $('prodBarcodeInput').value.trim();
  const name = $('prodNameInput').value.trim();
  const category = $('prodCatInput').value.trim() || 'مواد غذائية';
  const stock = Math.max(0, roundMoney(toNum($('prodStockInput').value)));
  const cost = fromDisplayAmount($('prodCostInput').value);
  const retailPrice = fromDisplayAmount($('prodRetailInput').value);
  const wholesalePrice = fromDisplayAmount($('prodWholesaleInput').value);

  if (!name) return warn('خطأ', 'أدخل اسم المنتج');
  if (retailPrice <= 0 && wholesalePrice <= 0) return warn('خطأ', 'أدخل سعراً واحداً على الأقل');
  if (!sku) sku = generateUniqueSku();

  const duplicate = state.products.find(p => p.sku === sku && p.id !== editId);
  if (duplicate) return warn('كود مكرر', `الكود ${sku} مستخدم للمنتج: ${duplicate.name}`, 'error');
  if (barcode) {
    const dupBarcode = state.products.find(p => p.barcode === barcode && p.id !== editId);
    if (dupBarcode) return warn('باركود مكرر', `الباركود ${barcode} مستخدم للمنتج: ${dupBarcode.name}`, 'error');
  }

  let previous = null;
  if (editId) {
    const p = state.products.find(x => x.id === editId);
    if (!p) return;
    previous = { ...p };
    Object.assign(p, { sku, barcode, name, category, stock, cost, retailPrice, wholesalePrice });
    logAudit('تعديل منتج', name);
  } else {
    state.products.push({ id: Date.now().toString(), sku, barcode, name, category, stock, cost, retailPrice, wholesalePrice });
    logAudit('إضافة منتج', `${name} (كود: ${sku})`);
  }

  const ok = await saveToStorage();
  if (!ok) {
    if (editId && previous) { const p = state.products.find(x => x.id === editId); if (p) Object.assign(p, previous); }
    else state.products.pop();
    return;
  }
  closeModal('productModal');
  refreshCategoryWidgets();
  renderAll();
  toast('تم الحفظ');
}

function deleteProduct(id) {
  Swal.fire({ title: 'حذف المنتج؟', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6', confirmButtonText: 'نعم', cancelButtonText: 'إلغاء' }).then(async res => {
    if (!res.isConfirmed) return;
    const removed = state.products.find(p => p.id === id);
    const removedFromCart = state.cart.filter(i => i.productId === id);
    state.products = state.products.filter(p => p.id !== id);
    state.cart = state.cart.filter(i => i.productId !== id);
    logAudit('حذف منتج', removed ? removed.name : id);
    const ok = await saveToStorage();
    if (!ok) { if (removed) state.products.push(removed); state.cart.push(...removedFromCart); return; }
    renderAll();
  });
}

function openQuickProductModal(prefillBarcode = '') {
  $('qpName').value = '';
  $('qpPrice').value = '';
  $('qpQty').value = '1';
  $('qpBarcode').value = prefillBarcode || '';
  openModal('quickProductModal');
}
function saveQuickProduct() {
  const name = $('qpName').value.trim();
  const price = fromDisplayAmount($('qpPrice').value);
  const qty = Math.max(1, parseInt($('qpQty').value, 10) || 1);
  const barcode = $('qpBarcode').value.trim();
  if (!name) return warn('خطأ', 'أدخل اسم المنتج');
  if (!(price > 0)) return warn('خطأ', 'أدخل سعراً صحيحاً');

  state.cart.push({
    isQuickOnly: true,
    quickId: 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
    name, price, qty, barcode
  });
  closeModal('quickProductModal');
  renderCart();
  toast(`تمت إضافة ${qty} × ${name}`);
}

/* ==========================================================================
   الزبائن وكشف الحساب والمرتجعات
   ========================================================================== */
function openClientModal(clientId = null) {
  $('clientEditId').value = clientId || '';
  if (clientId) {
    const c = state.clients.find(x => x.id === clientId);
    if (!c) return;
    $('clientModalTitle').textContent = 'تعديل بيانات الزبون';
    $('clientNameInput').value = c.name || '';
    $('clientPhoneInput').value = c.phone || '';
    $('clientAddressInput').value = c.address || '';
    $('clientOpeningInput').value = toDisplayInputValue(c.openingDebt);
    const radios = document.querySelectorAll('input[name="clientTypeRadio"]');
    radios.forEach(r => { r.checked = r.value === (c.type || 'retail'); });
  } else {
    $('clientModalTitle').textContent = 'إضافة زبون جديد';
    $('clientNameInput').value = '';
    $('clientPhoneInput').value = '';
    $('clientAddressInput').value = '';
    $('clientOpeningInput').value = '0';
    const radios = document.querySelectorAll('input[name="clientTypeRadio"]');
    radios.forEach(r => { r.checked = r.value === 'retail'; });
  }
  openModal('clientModal');
}

async function saveClient() {
  const editId = $('clientEditId').value;
  const name = $('clientNameInput').value.trim();
  const phone = $('clientPhoneInput').value.trim() || '-';
  const address = $('clientAddressInput').value.trim() || '-';
  const openingDebt = fromDisplayAmount($('clientOpeningInput').value);
  const checkedRadio = document.querySelector('input[name="clientTypeRadio"]:checked');
  const type = checkedRadio ? checkedRadio.value : 'retail';
  if (!name) return warn('خطأ', 'أدخل اسم الزبون');

  let previous = null;
  if (editId) {
    const c = state.clients.find(x => x.id === editId);
    if (!c) return;
    previous = { ...c, customPrices: { ...(c.customPrices || {}) } };
    Object.assign(c, { name, type, phone, address, openingDebt });
    logAudit('تعديل زبون', `${name} (رصيد افتتاحي: ${fmtCur(openingDebt)})`);
  } else {
    state.clients.push({ id: 'c_' + Date.now(), name, type, phone, address, openingDebt, customPrices: {} });
    logAudit('إضافة زبون', name);
  }

  const ok = await saveToStorage();
  if (!ok) {
    if (editId && previous) { const c = state.clients.find(x => x.id === editId); if (c) Object.assign(c, previous); }
    else state.clients.pop();
    return;
  }

  closeModal('clientModal');
  renderClientsGrid();
  populatePosClients();
  if (editId && state.currentLedgerClientId === editId) openClientDetailPage(editId);
  toast('تم حفظ بيانات الزبون');
}

function renderClientsGrid() {
  const q = normalizeArabic(($('clientSearch')?.value || '').trim());
  const list = state.clients.filter(c => !q || normalizeArabic(c.name).includes(q) || (c.phone || '').includes(q));
  $('clientsGrid').innerHTML = list.map(c => {
    const debt = getClientDebt(c.id);
    const invCount = state.invoices.filter(i => i.clientId === c.id && i.status === 'active').length;
    const customCount = c.customPrices ? Object.values(c.customPrices).filter(v => toNum(v) > 0).length : 0;
    return `<div onclick="openClientDetailPage('${esc(c.id)}')" class="bg-white border border-slate-200 hover:border-ashour rounded-2xl p-4 shadow-sm space-y-3 flex flex-col justify-between card-hover cursor-pointer">
      <div>
        <div class="flex items-center justify-between gap-1">
          <div class="flex items-center gap-1">
            <span class="text-[11px] font-bold px-2 py-0.5 rounded ${c.type === 'wholesale' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}">${c.type === 'wholesale' ? 'موزع جملة' : 'عميل تجزئة'}</span>
            ${customCount > 0 ? `<span class="text-[10px] font-bold px-2 py-0.5 rounded bg-purple-100 text-purple-800">${customCount} سعر خاص</span>` : ''}
          </div>
          <span class="text-xs text-slate-400 font-bold"><i class="fa-solid fa-phone text-[10px]"></i> ${esc(c.phone || '-')}</span>
        </div>
        <h4 class="font-bold text-base text-slate-800 mt-2">${esc(c.name)}</h4>
        <p class="text-xs text-slate-500 font-semibold">${esc(c.address || '-')} • ${fmt(invCount)} فاتورة</p>
      </div>
      <div class="border-t border-slate-100 pt-3 flex items-center justify-between gap-2">
        <div><span class="text-[11px] text-slate-500 font-bold block">الدين</span><span class="text-sm font-bold ${debt > 0 ? 'text-rose-600' : 'text-emerald-700'}">${fmtCur(debt)}</span></div>
        <span class="text-ashour font-bold text-xs">فتح الملف <i class="fa-solid fa-arrow-left"></i></span>
      </div>
    </div>`;
  }).join('') || `<div class="col-span-full text-center py-10 text-slate-400 text-sm font-bold">لا يوجد زبائن</div>`;
}

function renderClientSpecialPrices(clientId) {
  const container = $('clientSpecialPricesList');
  if (!container) return;
  const c = state.clients.find(x => x.id === clientId);
  if (!c || !c.customPrices) {
    container.innerHTML = `<span class="text-slate-400">لا توجد أسعار خاصة محددة لهذا الزبون.</span>`;
    return;
  }
  const entries = Object.entries(c.customPrices).filter(([_, price]) => toNum(price) > 0);
  if (!entries.length) {
    container.innerHTML = `<span class="text-slate-400">لا توجد أسعار خاصة (يعتمد على تسعيرة الجملة أو التجزئة).</span>`;
    return;
  }
  container.innerHTML = entries.map(([prodId, price]) => {
    const prod = state.products.find(p => p.id === prodId);
    const prodName = prod ? prod.name : `منتج #${prodId}`;
    return `<div class="bg-purple-50 border border-purple-200 text-purple-900 rounded-xl px-3 py-1.5 flex items-center gap-2">
      <span>${esc(prodName)}: <b class="text-purple-700">${fmtCur(price)}</b></span>
      <button type="button" onclick="removeClientSpecialPrice('${esc(clientId)}', '${esc(prodId)}')" title="إزالة السعر الخاص" class="text-rose-500 hover:text-rose-700 text-xs"><i class="fa-solid fa-xmark"></i></button>
    </div>`;
  }).join('');
}

async function removeClientSpecialPrice(clientId, prodId) {
  const ok = await setClientSpecialPrice(clientId, prodId, 0);
  if (ok) {
    renderClientSpecialPrices(clientId);
    if (getSelectedPosClient().id === clientId) { renderPosProducts(); renderCart(); }
    renderClientsGrid();
    toast('تمت إزالة السعر الخاص');
  }
}

function openClientDetailPage(clientId) {
  state.currentLedgerClientId = clientId;
  const c = state.clients.find(x => x.id === clientId);
  if (!c) return;
  $('ledgerClientName').textContent = c.name;
  $('ledgerClientBadge').textContent = c.type === 'wholesale' ? 'موزع جملة' : 'زبون تجزئة';
  $('ledgerClientBadge').className = `text-xs font-bold px-2 py-0.5 rounded-full ${c.type === 'wholesale' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`;

  switchTab('client-detail');
  renderClientSpecialPrices(clientId);
  renderLedgerSummary(clientId);
  switchLedgerSubTab('statement');
}

function renderLedgerSummary(clientId) {
  const c = state.clients.find(x => x.id === clientId);
  if (!c) return;
  const activeInvs = state.invoices.filter(i => i.clientId === clientId && i.status === 'active');
  const totalPurchases = sumList(activeInvs, i => i.total);
  const totalPaid = sumList(activeInvs, i => i.paid) + sumList(state.payments.filter(p => p.clientId === clientId), p => p.amount);
  const totalReturns = sumList(state.returns.filter(r => r.clientId === clientId), r => r.amount);
  const currentDebt = getClientDebt(clientId);

  $('ledgerSummaryCards').innerHTML = `
    <div class="bg-white border border-slate-200 rounded-xl p-3 shadow-sm"><span class="block text-xs text-slate-500">المشتريات</span><span class="text-sm font-bold text-slate-800">${fmtCur(totalPurchases)}</span></div>
    <div class="bg-white border border-slate-200 rounded-xl p-3 shadow-sm"><span class="block text-xs text-emerald-700">المدفوع</span><span class="text-sm font-bold text-emerald-700">${fmtCur(totalPaid)}</span></div>
    <div class="bg-white border border-slate-200 rounded-xl p-3 shadow-sm"><span class="block text-xs text-amber-700">المرتجعات</span><span class="text-sm font-bold text-amber-700">${fmtCur(totalReturns)}</span></div>
    <div class="bg-white border border-rose-200 rounded-xl p-3 shadow-sm"><span class="block text-xs text-rose-600">الدين الحالي</span><span class="text-sm font-bold text-rose-600">${fmtCur(currentDebt)}</span></div>`;

  const rows = [];
  if (toNum(c.openingDebt) > 0) rows.push({ id: 'op', type: 'opening', ts: 0, label: 'رصيد افتتاحي', debit: toNum(c.openingDebt), credit: 0 });
  activeInvs.forEach(i => rows.push({ id: i.id, type: 'invoice', ts: i.ts, label: `فاتورة ${i.id} — [${i.items.map(it => `${it.qty} × ${it.name} (${fmt(it.price)})`).join(' ، ')}]`, debit: i.total, credit: i.paid }));
  state.payments.filter(p => p.clientId === clientId).forEach(p => rows.push({ id: p.id, type: 'payment', ts: p.ts, label: p.amount < 0 ? `استرداد (${p.note || 'إلغاء'})` : 'تسديد دفعة', debit: 0, credit: p.amount }));
  state.returns.filter(r => r.clientId === clientId).forEach(r => rows.push({ id: r.id, type: 'return', ts: r.ts, label: `مرتجع: ${r.qty} × ${r.productName} بسعر ${fmtCur(r.unitPrice)}`, debit: 0, credit: r.amount }));

  rows.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  $('ledgerTableBody').innerHTML = rows.map(r => `
    <tr class="border-b border-slate-100 hover:bg-slate-50">
      <td class="p-3 text-slate-500 whitespace-nowrap">${r.ts ? new Date(r.ts).toLocaleString('ar-SY') : '—'}</td>
      <td class="p-3 text-slate-800">${esc(r.label)}</td>
      <td class="p-3 text-rose-600 whitespace-nowrap">${r.debit ? fmtCur(r.debit) : '—'}</td>
      <td class="p-3 text-emerald-700 whitespace-nowrap">${r.credit ? fmtCur(r.credit) : (r.credit < 0 ? `(${fmtCur(-r.credit)})` : '—')}</td>
      <td class="p-3 text-center whitespace-nowrap">
        ${r.type === 'invoice' ? `<button onclick="viewPastInvoice('${esc(r.id)}')" class="bg-ashour text-white hover:bg-ashour-dark px-2 py-1 rounded text-xs font-bold transition"><i class="fa-solid fa-receipt"></i></button>` : ''}
        ${r.type === 'payment' ? `<button onclick="deletePayment('${r.id}')" class="text-rose-500 hover:text-rose-700 font-bold text-xs"><i class="fa-solid fa-trash"></i></button>` : ''}
        ${r.type !== 'invoice' && r.type !== 'payment' ? '—' : ''}
      </td>
    </tr>`).join('') || `<tr><td colspan="5" class="p-4 text-center text-slate-400">لا توجد معاملات</td></tr>`;
}

function shareClientStatementWhatsApp() {
  const clientId = state.currentLedgerClientId;
  const c = state.clients.find(x => x.id === clientId);
  if (!c) return;
  const debt = getClientDebt(clientId);
  const txt = `كشف حساب — ${state.storeInfo.name}\nالزبون: ${c.name}\nالدين الحالي: ${fmtCur(debt)}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(txt)}`, '_blank');
}

function switchLedgerSubTab(sub) {
  const isRet = sub === 'returns';
  $('ledgerStatementPanel').classList.toggle('hidden', isRet);
  $('ledgerReturnsPanel').classList.toggle('hidden', !isRet);
  $('ledgerTabStatementBtn').className = isRet ? 'px-4 py-2 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 transition' : 'px-4 py-2 rounded-xl bg-ashour text-white transition';
  $('ledgerTabReturnsBtn').className = isRet ? 'px-4 py-2 rounded-xl bg-amber-600 text-white transition' : 'px-4 py-2 rounded-xl bg-amber-100 text-amber-900 hover:bg-amber-200 transition';
  if (isRet && state.currentLedgerClientId) renderClientReturnsTab(state.currentLedgerClientId);
}

function getClientReturnableSummary(clientId) {
  const map = new Map();
  state.invoices.filter(i => i.clientId === clientId && i.status === 'active').forEach(inv => {
    inv.items.forEach(it => {
      const key = (it.productId || 'name:' + normalizeArabic(it.name)) + '||' + toNum(it.price);
      const liveProd = state.products.find(p => p.id === it.productId);
      const unitCost = it.cost != null ? toNum(it.cost) : (liveProd ? toNum(liveProd.cost) : 0);
      if (!map.has(key)) map.set(key, { key, productId: it.productId, name: it.name, price: toNum(it.price), cost: unitCost, boughtQty: 0, returnedQty: 0 });
      map.get(key).boughtQty = roundMoney(map.get(key).boughtQty + toNum(it.qty));
    });
  });
  state.returns.filter(r => r.clientId === clientId).forEach(ret => {
    if (ret.returnKey && map.has(ret.returnKey)) {
      map.get(ret.returnKey).returnedQty = roundMoney(map.get(ret.returnKey).returnedQty + toNum(ret.qty));
      return;
    }
    for (const item of map.values()) {
      if (normalizeArabic(item.name) === normalizeArabic(ret.productName) && toNum(item.price) === toNum(ret.unitPrice)) {
        item.returnedQty = roundMoney(map.get(item.key)?.returnedQty + toNum(ret.qty));
        break;
      }
    }
  });
  return [...map.values()].map(x => ({ ...x, remainingQty: Math.max(0, roundMoney(x.boughtQty - x.returnedQty)) }));
}

function renderClientReturnsTab(clientId) {
  const list = getClientReturnableSummary(clientId);
  const container = $('clientReturnableItemsList');
  if (!list.length) {
    container.innerHTML = `<div class="text-center py-6 text-slate-400 text-sm font-bold bg-slate-50 rounded-xl border border-dashed">لا توجد أصناف مسجلة في فواتير هذا الزبون</div>`;
  } else {
    container.innerHTML = list.map(item => `
      <div class="bg-white border border-slate-200 rounded-xl p-3 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <div class="font-bold text-sm text-slate-800">${esc(item.name)}</div>
          <div class="text-xs text-slate-600 font-semibold mt-1">
            سعر الفاتورة: <span class="text-ashour font-bold">${fmtCur(item.price)}</span> •
            المشتراة: <span class="font-bold">${fmt(item.boughtQty)}</span> •
            المرتجع سابقاً: <span class="font-bold">${fmt(item.returnedQty)}</span> •
            المتاح: <span class="text-emerald-700 font-bold">${fmt(item.remainingQty)}</span>
          </div>
        </div>
        <div class="flex items-center gap-2 bg-slate-50 p-1.5 rounded-lg border border-slate-200">
          <span class="text-xs font-bold text-slate-600">كمية الإرجاع:</span>
          <div class="flex items-center gap-1 bg-white border border-slate-300 rounded-md p-0.5">
            <button type="button" onclick="adjustReturnQty('${esc(item.key)}', -1)" ${item.remainingQty <= 0 ? 'disabled' : ''} class="w-7 h-7 flex items-center justify-center bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 rounded font-bold transition">−</button>
            <input type="number" id="returnQty_${esc(item.key)}" min="1" max="${item.remainingQty}" value="${item.remainingQty > 0 ? 1 : 0}" ${item.remainingQty <= 0 ? 'disabled' : ''} class="w-10 text-center border-none focus:outline-none focus:ring-0 text-sm font-bold bg-transparent num-tabular">
            <button type="button" onclick="adjustReturnQty('${esc(item.key)}', 1)" ${item.remainingQty <= 0 ? 'disabled' : ''} class="w-7 h-7 flex items-center justify-center bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 rounded font-bold transition">+</button>
          </div>
          <button onclick="submitClientReturn('${esc(clientId)}', '${esc(item.name)}', ${item.price}, ${item.cost}, '${esc(item.key)}')" ${item.remainingQty <= 0 ? 'disabled' : ''} class="bg-ashour hover:bg-ashour-dark disabled:opacity-40 text-white px-3 py-1.5 rounded-md text-xs font-bold transition">تأكيد الإرجاع</button>
        </div>
      </div>`).join('');
  }

  const rets = state.returns.filter(r => r.clientId === clientId).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  $('clientReturnsHistoryList').innerHTML = rets.length
    ? rets.map(r => `<div class="flex justify-between items-center border-b border-slate-200 py-1"><span>${esc(r.date)} — ${fmt(r.qty)} × ${esc(r.productName)} (${fmtCur(r.unitPrice)})</span><span class="text-emerald-700 font-bold">خصم ${fmtCur(r.amount)}</span></div>`).join('')
    : `<div class="text-slate-400 text-sm">لا توجد مرتجعات.</div>`;
}

function adjustReturnQty(key, delta) {
  const input = $('returnQty_' + key);
  if (!input || input.disabled) return;
  let val = parseInt(input.value, 10) || 1;
  val += delta;
  const max = parseInt(input.max, 10) || 1;
  if (val > max) val = max;
  if (val < 1) val = 1;
  input.value = val;
}

async function submitClientReturn(clientId, productName, unitPrice, unitCost, key) {
  const input = $('returnQty_' + key);
  const qty = parseInt(input.value, 10);
  if (!qty || qty <= 0) return warn('خطأ', 'أدخل كمية صحيحة');
  const max = parseInt(input.max, 10);
  if (qty > max) return warn('خطأ', 'الكمية تتجاوز المتاح للإرجاع');

  const client = state.clients.find(c => c.id === clientId);
  const amount = calcLineTotal(unitPrice, qty);
  const profitAdjustment = roundMoney((toNum(unitPrice) - toNum(unitCost)) * qty);
  const newReturn = {
    id: 'RET-' + Date.now(), ts: Date.now(), date: nowStr(),
    clientId, clientName: client.name,
    productName, qty, unitPrice,
    unitCost: toNum(unitCost), amount, profitAdjustment,
    returnKey: key
  };

  const matchedProd = state.products.find(p => normalizeArabic(p.name) === normalizeArabic(productName));
  const prevStock = matchedProd ? toNum(matchedProd.stock) : 0;
  if (matchedProd) matchedProd.stock = roundMoney(toNum(matchedProd.stock) + qty);

  state.returns.push(newReturn);
  logAudit('مرتجع', `إرجاع ${qty} × ${productName} بسعر ${fmtCur(unitPrice)} لـ ${client.name}`);
  const ok = await saveToStorage();
  if (!ok) {
    state.returns.pop();
    if (matchedProd) matchedProd.stock = prevStock;
    return;
  }

  renderLedgerSummary(clientId);
  renderClientReturnsTab(clientId);
  renderReports();
  updateLowStockBadge();
  toast(`تم إرجاع ${qty} ${productName} وخصم ${fmtCur(amount)}`);
}

async function recordDebtPayment() {
  const clientId = state.currentLedgerClientId;
  const c = state.clients.find(x => x.id === clientId);
  if (!c) return;
  const amount = fromDisplayAmount($('payDebtAmount').value);
  if (amount <= 0) return warn('تنبيه', 'أدخل مبلغاً صحيحاً');

  const newPay = { id: 'PAY-' + Date.now(), ts: Date.now(), date: nowStr(), clientId, amount, note: '' };
  state.payments.push(newPay);
  logAudit('تسديد دين زبون', `${c.name}: ${fmtCur(amount)}`);
  const ok = await saveToStorage();
  if (!ok) { state.payments.pop(); return; }

  $('payDebtAmount').value = '';
  renderLedgerSummary(clientId);
  switchLedgerSubTab('statement');
  toast('تم تسجيل الدفعة');
}

function deletePayment(payId) {
  Swal.fire({ title: 'حذف الدفعة؟', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6', confirmButtonText: 'نعم', cancelButtonText: 'إلغاء' }).then(async res => {
    if (!res.isConfirmed) return;
    const removed = state.payments.find(p => p.id === payId);
    state.payments = state.payments.filter(p => p.id !== payId);
    logAudit('حذف دفعة زبون', removed ? `${fmtCur(removed.amount)}` : payId);
    const ok = await saveToStorage();
    if (!ok) { if (removed) state.payments.push(removed); return; }
    renderLedgerSummary(state.currentLedgerClientId);
    switchLedgerSubTab('statement');
    toast('تم الحذف');
  });
}

/* ==========================================================================
   الشركات والمشتريات وديون الأشخاص
   ========================================================================== */
function getCompanyDebt(companyId) {
  const purchasesRemaining = sumList(state.purchases.filter(p => p.companyId === companyId && p.status === 'active'), p => p.remaining);
  const paymentsMade = sumList(state.companyPayments.filter(p => p.companyId === companyId), p => p.amount);
  return Math.max(0, roundMoney(purchasesRemaining - paymentsMade));
}

function renderCompaniesGrid() {
  const q = normalizeArabic(($('companySearch')?.value || '').trim());
  const list = state.companies.filter(comp => !q || normalizeArabic(comp.name).includes(q) || (comp.phone || '').includes(q));
  $('companiesGrid').innerHTML = list.map(comp => {
    const debt = getCompanyDebt(comp.id);
    return `<div onclick="openCompanyDetailPage('${esc(comp.id)}')" class="bg-white border border-slate-200 hover:border-ashour rounded-2xl p-4 shadow-sm space-y-3 cursor-pointer card-hover">
      <div>
        <h4 class="font-bold text-base text-ashour flex items-center gap-2"><i class="fa-solid fa-building text-ashour-gold"></i> ${esc(comp.name)}</h4>
        <p class="text-xs text-slate-500 font-semibold mt-1"><i class="fa-solid fa-user-tie"></i> ${esc(comp.distributorName || '-')} • <i class="fa-solid fa-phone"></i> ${esc(comp.phone || '-')}</p>
      </div>
      <div class="flex justify-between items-center text-sm font-bold border-t border-slate-100 pt-2">
        <span class="text-slate-600">الدين: <b class="${debt > 0 ? 'text-rose-600' : 'text-emerald-700'}">${fmtCur(debt)}</b></span>
        <span class="text-ashour text-xs">فتح الصفحة <i class="fa-solid fa-arrow-left"></i></span>
      </div>
    </div>`;
  }).join('') || `<div class="col-span-full text-center py-10 text-slate-400 text-sm font-bold">لا توجد شركات</div>`;
}

function openCompanyDetailPage(compId) {
  state.activeCompanyId = compId;
  const comp = state.companies.find(c => c.id === compId);
  if (!comp) return;
  $('companyDetailName').textContent = comp.name;
  $('companyDetailInfo').textContent = `هاتف: ${comp.phone || '-'} • عنوان: ${comp.address || '-'}`;
  $('compDetailDistributor').textContent = comp.distributorName || '-';
  $('compDetailCycle').textContent = comp.cycle || '-';
  $('compDetailDebt').textContent = fmtCur(getCompanyDebt(compId));
  renderCompanyProductsGrid(compId);
  switchTab('company-detail');
}

function renderCompanyProductsGrid(compId) {
  const comp = state.companies.find(c => c.id === compId);
  if (!comp) return;
  const prods = Array.isArray(comp.products) ? comp.products : [];
  $('companyProductsGrid').innerHTML = prods.map((pr, idx) => `
    <div class="border border-slate-200 rounded-2xl p-3 bg-slate-50/70 flex items-start justify-between gap-2">
      <div>
        <div class="font-bold text-sm text-slate-800 mb-1">${esc(pr.name)}</div>
        <div class="text-xs text-slate-600 font-semibold">سعر المستهلك: <span class="text-emerald-700 font-bold">${fmtCur(pr.consumerPrice)}</span></div>
        <div class="text-xs text-slate-600 font-semibold">الطرد: ${fmt(pr.piecesPerBox || 1)} علبة × ${fmtCur(pr.boxPrice || 0)}</div>
        <div class="text-xs text-slate-600 font-semibold">العلبة (شراء): <span class="font-bold">${fmtCur(pr.piecePrice || 0)}</span></div>
      </div>
      <button onclick="openCompanyProductEditModal(${idx})" class="bg-white border border-slate-300 text-indigo-600 hover:bg-indigo-50 w-8 h-8 rounded-lg flex items-center justify-center shadow-sm transition"><i class="fa-solid fa-pen"></i></button>
    </div>
  `).join('') || `<div class="col-span-full text-center py-6 text-slate-400 text-sm font-bold">لا توجد منتجات مسجلة لهذه الشركة</div>`;
}

function openCompanyProductEditModal(idx) {
  const comp = state.companies.find(c => c.id === state.activeCompanyId);
  if (!comp || !comp.products[idx]) return;
  const pr = comp.products[idx];
  $('cpEditIdx').value = idx;
  $('cpNameInput').value = pr.name || '';
  $('cpBoxPriceInput').value = toDisplayInputValue(pr.boxPrice || 0);
  $('cpPiecesPerBoxInput').value = pr.piecesPerBox || 1;
  $('cpPiecePriceInput').value = toDisplayInputValue(pr.piecePrice || 0);
  $('cpConsumerPriceInput').value = toDisplayInputValue(pr.consumerPrice || 0);
  openModal('companyProductModal');
}

async function saveCompanyProductEdit() {
  const comp = state.companies.find(c => c.id === state.activeCompanyId);
  if (!comp) return;
  const idx = parseInt($('cpEditIdx').value, 10);
  const pr = comp.products[idx];
  if (!pr) return;

  const oldData = { ...pr };
  pr.name = $('cpNameInput').value.trim();
  const boxPrice = fromDisplayAmount($('cpBoxPriceInput').value);
  pr.piecesPerBox = Math.max(1, toNum($('cpPiecesPerBoxInput').value) || 1);
  const enteredPiece = fromDisplayAmount($('cpPiecePriceInput').value);
  const consumerPrice = fromDisplayAmount($('cpConsumerPriceInput').value);

  pr.boxPrice = boxPrice;
  pr.piecePrice = enteredPiece > 0 ? enteredPiece : (pr.boxPrice > 0 ? roundMoney(pr.boxPrice / pr.piecesPerBox) : 0);
  pr.consumerPrice = consumerPrice;

  const linkedProd = state.products.find(p => normalizeArabic(p.name) === normalizeArabic(oldData.name) || p.id === pr.linkedProductId);
  const oldLinked = linkedProd ? { ...linkedProd } : null;
  if (linkedProd) {
    linkedProd.name = pr.name;
    linkedProd.cost = pr.piecePrice;
    if (consumerPrice > 0) linkedProd.retailPrice = consumerPrice;
  }

  logAudit('تعديل منتج شركة', `${comp.name}: ${pr.name}`);
  const ok = await saveToStorage();
  if (!ok) {
    Object.assign(pr, oldData);
    if (linkedProd && oldLinked) Object.assign(linkedProd, oldLinked);
    return;
  }

  closeModal('companyProductModal');
  renderCompanyProductsGrid(comp.id);
  renderAll();
  toast('تم حفظ التعديلات');
}

function openCompanyModal(compId = null) {
  $('compEditId').value = compId || '';
  if (compId) {
    const comp = state.companies.find(c => c.id === compId);
    if (!comp) return;
    $('companyModalTitle').textContent = 'تعديل بيانات الشركة';
    $('compNameInput').value = comp.name || '';
    $('compPhoneInput').value = comp.phone || '';
    $('compAddressInput').value = comp.address || '';
    $('compDistributorInput').value = comp.distributorName || '';
    $('compCycleInput').value = comp.cycle || '';
  } else {
    $('companyModalTitle').textContent = 'إضافة شركة جديدة';
    $('compNameInput').value = '';
    $('compPhoneInput').value = '';
    $('compAddressInput').value = '';
    $('compDistributorInput').value = '';
    $('compCycleInput').value = '';
  }
  openModal('companyModal');
}

async function saveCompany() {
  const editId = $('compEditId').value;
  const name = $('compNameInput').value.trim();
  const phone = $('compPhoneInput').value.trim() || '-';
  const address = $('compAddressInput').value.trim() || '-';
  const distributorName = $('compDistributorInput').value.trim() || '-';
  const cycle = $('compCycleInput').value.trim() || '-';
  if (!name) return warn('خطأ', 'أدخل اسم الشركة');

  let previous = null;
  if (editId) {
    const comp = state.companies.find(c => c.id === editId);
    if (!comp) return;
    previous = { ...comp };
    Object.assign(comp, { name, phone, address, distributorName, cycle });
    logAudit('تعديل شركة', name);
  } else {
    state.companies.push({ id: 'comp_' + Date.now(), name, phone, address, distributorName, cycle, products: [] });
    logAudit('إضافة شركة', name);
  }

  const ok = await saveToStorage();
  if (!ok) {
    if (editId && previous) { const comp = state.companies.find(c => c.id === editId); if (comp) Object.assign(comp, previous); }
    else state.companies.pop();
    return;
  }

  closeModal('companyModal');
  renderCompaniesGrid();
  if (editId && state.activeCompanyId === editId) openCompanyDetailPage(editId);
  toast('تم حفظ بيانات الشركة');
}

function addProductDirectlyToCompany() {
  const compId = state.activeCompanyId;
  const comp = state.companies.find(c => c.id === compId);
  if (!comp) return;
  Swal.fire({
    title: 'إضافة منتج إلى ' + comp.name,
    html: `
      <input id="swal-p-name" class="swal2-input" placeholder="اسم المنتج">
      <input id="swal-p-box-price" type="number" step="any" class="swal2-input" placeholder="سعر الطرد (اختياري)">
      <input id="swal-p-pieces" type="number" class="swal2-input" placeholder="عدد العلب في الطرد" value="1">
      <input id="swal-p-piece-price" type="number" step="any" class="swal2-input" placeholder="سعر العلبة (شراء)">
      <input id="swal-p-consumer" type="number" step="any" class="swal2-input" placeholder="سعر التجزئة">
      <input id="swal-p-wholesale" type="number" step="any" class="swal2-input" placeholder="سعر الجملة (اختياري)">
    `,
    focusConfirm: false, showCancelButton: true,
    confirmButtonText: 'إضافة وربط', cancelButtonText: 'إلغاء',
    preConfirm: () => {
      const name = $('swal-p-name').value.trim();
      const boxPrice = fromDisplayAmount($('swal-p-box-price').value);
      const piecesPerBox = Math.max(1, toNum($('swal-p-pieces').value) || 1);
      const piecePriceInput = fromDisplayAmount($('swal-p-piece-price').value);
      const consumerPrice = fromDisplayAmount($('swal-p-consumer').value);
      const wholesalePrice = fromDisplayAmount($('swal-p-wholesale').value);
      const piecePrice = piecePriceInput > 0 ? piecePriceInput : (boxPrice > 0 ? roundMoney(boxPrice / piecesPerBox) : 0);
      if (!name) return Swal.showValidationMessage('أدخل اسم المنتج');
      if (consumerPrice <= 0 && wholesalePrice <= 0) return Swal.showValidationMessage('أدخل سعر البيع');
      return { name, boxPrice, piecesPerBox, piecePrice, consumerPrice, wholesalePrice };
    }
  }).then(async res => {
    if (!res.isConfirmed) return;
    const d = res.value;
    const newProdId = (Date.now() + 1).toString();
    const newMainProd = {
      id: newProdId, sku: generateUniqueSku(), barcode: '', name: d.name,
      category: 'مواد غذائية', stock: 0, cost: d.piecePrice,
      retailPrice: d.consumerPrice || d.wholesalePrice,
      wholesalePrice: d.wholesalePrice || d.consumerPrice
    };
    comp.products.push({
      id: 'cp_' + Date.now(), name: d.name,
      boxPrice: d.boxPrice, piecesPerBox: d.piecesPerBox,
      piecePrice: d.piecePrice, consumerPrice: d.consumerPrice,
      linkedProductId: newProdId
    });
    state.products.push(newMainProd);
    logAudit('إضافة منتج لشركة', `${d.name} → ${comp.name}`);
    const ok = await saveToStorage();
    if (!ok) { comp.products.pop(); state.products.pop(); return; }
    renderCompanyProductsGrid(compId);
    renderAll();
    toast('تمت إضافة المنتج وربطه بالنظام');
  });
}

function openCompanyPaymentModal() {
  const comp = state.companies.find(c => c.id === state.activeCompanyId);
  if (!comp) return;
  $('payCompanyAmount').value = '';
  $('payCompanyNotes').value = '';
  openModal('companyPaymentModal');
}

async function recordCompanyPayment() {
  const compId = state.activeCompanyId;
  const comp = state.companies.find(c => c.id === compId);
  if (!comp) return;
  const amount = fromDisplayAmount($('payCompanyAmount').value);
  const notes = $('payCompanyNotes').value.trim();
  if (amount <= 0) return warn('تنبيه', 'أدخل مبلغاً صحيحاً');

  const newPay = { id: 'CPAY-' + Date.now(), ts: Date.now(), date: nowStr(), companyId: compId, amount, notes };
  state.companyPayments.push(newPay);
  logAudit('تسديد دين شركة', `${comp.name}: ${fmtCur(amount)}`);
  const ok = await saveToStorage();
  if (!ok) { state.companyPayments.pop(); return; }

  closeModal('companyPaymentModal');
  openCompanyDetailPage(compId);
  toast('تم تسجيل الدفعة للشركة');
}

function generatePurchaseCode() {
  const used = new Set(state.purchases.map(p => String(p.id)));
  let code = '';
  do {
    code = String(Math.floor(100000 + Math.random() * 900000));
  } while (used.has(code));
  return code;
}

function openPurchaseModal(preselectCompanyId = null) {
  if (!state.companies.length) {
    Swal.fire({
      title: 'لا توجد شركات بعد',
      text: 'هل تريد إضافة شركة أولاً؟',
      icon: 'info', showCancelButton: true,
      confirmButtonColor: '#0F5C4E', cancelButtonColor: '#64748b',
      confirmButtonText: 'نعم، إضافة شركة', cancelButtonText: 'إلغاء'
    }).then(r => { if (r.isConfirmed) openCompanyModal(); });
    return;
  }

  $('purPreviewCode').textContent = generatePurchaseCode();
  const sel = $('purCompanySelect');
  sel.innerHTML = state.companies.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');

  if (preselectCompanyId && state.companies.some(c => c.id === preselectCompanyId)) sel.value = preselectCompanyId;
  else if (state.activeCompanyId && state.companies.some(c => c.id === state.activeCompanyId)) sel.value = state.activeCompanyId;

  $('purTotalAmount').value = '';
  $('purPaidAmount').value = '';
  onPurchaseCompanyChange();
  updatePurchaseCalc();
  openModal('purchaseModal');
}

function onPurchaseCompanyChange() {
  const compId = $('purCompanySelect').value;
  const comp = state.companies.find(c => c.id === compId);
  const infoEl = $('purCompanyDebtInfo');
  const badgeEl = $('purSelectedCompanyBadge');
  if (!comp || !infoEl) return;

  if (badgeEl) badgeEl.innerHTML = `<i class="fa-solid fa-building"></i>`;
  const debt = getCompanyDebt(compId);
  infoEl.classList.remove('hidden');
  infoEl.textContent = `الموزع: ${comp.distributorName || '-'} • هاتف: ${comp.phone || '-'} • الدين الحالي للشركة: ${fmtCur(debt)}`;
}

async function quickAddCompanyForPurchase() {
  const { value: name } = await Swal.fire({
    title: 'إضافة شركة سريعة',
    input: 'text',
    inputPlaceholder: 'اسم الشركة',
    showCancelButton: true,
    confirmButtonColor: '#0F5C4E',
    confirmButtonText: 'إضافة',
    cancelButtonText: 'إلغاء'
  });
  if (!name || !name.trim()) return;
  const newComp = { id: 'comp_' + Date.now(), name: name.trim(), phone: '-', address: '-', distributorName: '-', cycle: '-', products: [] };
  state.companies.push(newComp);
  logAudit('إضافة شركة سريعة', newComp.name);
  const ok = await saveToStorage();
  if (!ok) { state.companies.pop(); return; }
  openPurchaseModal(newComp.id);
  toast('تمت إضافة الشركة');
}

function updatePurchaseCalc() {
  const total = Math.max(0, fromDisplayAmount($('purTotalAmount').value));
  const paidRaw = $('purPaidAmount').value.trim();
  const paidEntered = paidRaw === '' ? total : Math.max(0, fromDisplayAmount(paidRaw));
  const remaining = Math.max(0, roundMoney(total - paidEntered));
  const infoEl = $('purDebtAfterInfo');
  if (!infoEl) return;

  infoEl.textContent = `المتبقي (يُضاف إلى دين الشركة): ${fmtCur(remaining)}`;
  infoEl.className = remaining > 0
    ? 'text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200 rounded-xl p-2.5'
    : 'text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl p-2.5';
}

async function savePurchase() {
  const compId = $('purCompanySelect').value;
  const comp = state.companies.find(c => c.id === compId);
  if (!comp) return warn('خطأ', 'اختر الشركة');

  const total = fromDisplayAmount($('purTotalAmount').value);
  if (!(total > 0)) return warn('خطأ', 'أدخل سعر الفاتورة');

  const paidRaw = $('purPaidAmount').value.trim();
  const paidEntered = paidRaw === '' ? total : Math.max(0, fromDisplayAmount(paidRaw));
  const paidRecorded = roundMoney(Math.min(paidEntered, total));
  const remaining = Math.max(0, roundMoney(total - paidRecorded));

  const pur = {
    id: generatePurchaseCode(),
    ts: Date.now(), date: nowStr(),
    companyId: comp.id, companyName: comp.name,
    total, paid: paidRecorded, remaining, status: 'active'
  };

  state.purchases.push(pur);
  logAudit('فاتورة شراء', `فاتورة شراء #${pur.id} من ${comp.name} بقيمة ${fmtCur(total)} — مدفوع ${fmtCur(paidRecorded)} — متبقي ${fmtCur(remaining)}`);

  const ok = await saveToStorage();
  if (!ok) { state.purchases.pop(); return; }

  closeModal('purchaseModal');
  renderPurchases();
  renderCompaniesGrid();
  if (state.activeCompanyId === comp.id) $('compDetailDebt').textContent = fmtCur(getCompanyDebt(comp.id));
  toast('تم تسجيل فاتورة الشراء');
}

function renderPurchases() {
  const sel = $('purchaseCompanyFilter');
  const currentFilter = sel ? sel.value : '';
  if (sel) {
    sel.innerHTML = `<option value="">كل الشركات</option>` + state.companies.map(c =>
      `<option value="${esc(c.id)}" ${c.id === currentFilter ? 'selected' : ''}>${esc(c.name)}</option>`
    ).join('');
  }

  const fromVal = $('purchaseFromDate')?.value;
  const toVal = $('purchaseToDate')?.value;
  const fromTs = fromVal ? new Date(fromVal + 'T00:00:00').getTime() : -Infinity;
  const toTs = toVal ? new Date(toVal + 'T23:59:59').getTime() : Infinity;

  const list = state.purchases
    .filter(p => p.status === 'active')
    .filter(p => (!currentFilter || p.companyId === currentFilter) && p.ts >= fromTs && p.ts <= toTs)
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));

  const sumTotal = sumList(list, p => p.total);
  const sumPaid = sumList(list, p => p.paid);
  const sumRem = currentFilter ? getCompanyDebt(currentFilter) : sumList(list, p => p.remaining);

  if ($('purchasesSummaryStrip')) {
    $('purchasesSummaryStrip').innerHTML = `
      <div class="bg-slate-50 border rounded-xl p-2"><span class="block text-xs text-slate-500">إجمالي المشتريات</span><span class="font-bold text-slate-800">${fmtCur(sumTotal)}</span></div>
      <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-2"><span class="block text-xs text-emerald-700">المدفوع</span><span class="font-bold text-emerald-800">${fmtCur(sumPaid)}</span></div>
      <div class="bg-rose-50 border border-rose-200 rounded-xl p-2"><span class="block text-xs text-rose-700">${currentFilter ? 'دين الشركة الحالي' : 'المتبقي'}</span><span class="font-bold text-rose-700">${fmtCur(sumRem)}</span></div>`;
  }

  $('purchasesTableBody').innerHTML = list.map(p => `
    <tr class="hover:bg-slate-50 border-b border-slate-100">
      <td class="p-3 font-bold text-ashour">${esc(p.id)}</td>
      <td class="p-3 text-slate-500 text-xs">${esc(p.date || new Date(p.ts).toLocaleString('ar-SY'))}</td>
      <td class="p-3 font-bold text-slate-800">${esc(p.companyName || '-')}</td>
      <td class="p-3 font-bold text-slate-800">${fmtCur(p.total)}</td>
      <td class="p-3 text-emerald-700 font-bold">${fmtCur(p.paid)}</td>
      <td class="p-3 font-bold ${p.remaining > 0 ? 'text-rose-600' : 'text-slate-500'}">${fmtCur(p.remaining)}</td>
      <td class="p-3 text-center">
        <button onclick="deletePurchase('${esc(p.id)}')" title="حذف فاتورة الشراء" class="bg-rose-100 text-rose-700 hover:bg-rose-600 hover:text-white px-2.5 py-1 rounded text-xs font-bold transition"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>`).join('') || `<tr><td colspan="7" class="p-6 text-center text-slate-400 text-sm">لا توجد فواتير شراء</td></tr>`;
}

function deletePurchase(purId) {
  Swal.fire({
    title: 'حذف فاتورة الشراء؟',
    text: 'سيتم إلغاء الفاتورة وتحديث دين الشركة.',
    icon: 'warning', showCancelButton: true,
    confirmButtonColor: '#d33', cancelButtonColor: '#3085d6',
    confirmButtonText: 'نعم، حذف', cancelButtonText: 'إلغاء'
  }).then(async res => {
    if (!res.isConfirmed) return;
    const pur = state.purchases.find(p => p.id === purId);
    if (!pur) return;
    const prevStatus = pur.status;
    pur.status = 'cancelled';
    logAudit('حذف فاتورة شراء', `فاتورة شراء #${pur.id} (${pur.companyName})`);
    const ok = await saveToStorage();
    if (!ok) { pur.status = prevStatus; return; }
    renderPurchases();
    renderCompaniesGrid();
    toast('تم حذف فاتورة الشراء');
  });
}

function switchDebtTab(type) {
  currentDebtTab = type === 'give' ? 'give' : 'take';
  const isTake = currentDebtTab === 'take';

  $('debtTabTake').className = isTake
    ? 'px-5 py-2 rounded-xl text-sm font-bold transition bg-emerald-600 text-white'
    : 'px-5 py-2 rounded-xl text-sm font-bold transition bg-slate-100 text-slate-700 hover:bg-slate-200';
  $('debtTabGive').className = !isTake
    ? 'px-5 py-2 rounded-xl text-sm font-bold transition bg-rose-600 text-white'
    : 'px-5 py-2 rounded-xl text-sm font-bold transition bg-slate-100 text-slate-700 hover:bg-slate-200';

  $('debtSummaryTake').classList.toggle('hidden', !isTake);
  $('debtSummaryGive').classList.toggle('hidden', isTake);
  $('debtAddBtnLabel').textContent = isTake ? 'لي' : 'له';

  $('debtTableHead').className = isTake
    ? 'bg-emerald-700 text-white font-bold'
    : 'bg-rose-700 text-white font-bold';

  renderPersonDebts();
}

function openPersonDebtModal() {
  $('debtPersonName').value = '';
  $('debtPersonPhone').value = '';
  $('debtPersonAmount').value = '';
  $('debtPersonNotes').value = '';
  const radios = document.querySelectorAll('input[name="debtTypeRadio"]');
  radios.forEach(r => { r.checked = r.value === currentDebtTab; });
  openModal('personDebtModal');
}

async function savePersonDebt() {
  const name = $('debtPersonName').value.trim();
  const phone = $('debtPersonPhone').value.trim() || '-';
  const amount = fromDisplayAmount($('debtPersonAmount').value);
  const notes = $('debtPersonNotes').value.trim() || '-';
  const checked = document.querySelector('input[name="debtTypeRadio"]:checked');
  const type = checked ? checked.value : currentDebtTab;

  if (!name) return warn('خطأ', 'أدخل اسم الشخص');
  if (!(amount > 0)) return warn('خطأ', 'أدخل مبلغاً صحيحاً');

  const item = { id: 'PD-' + Date.now(), ts: Date.now(), date: nowStr(), name, phone, type, amount, notes };
  state.personDebts.push(item);
  logAudit('دين شخصي', `${type === 'take' ? 'لي' : 'له'} — ${name}: ${fmtCur(amount)}`);
  const ok = await saveToStorage();
  if (!ok) { state.personDebts.pop(); return; }

  closeModal('personDebtModal');
  switchDebtTab(type);
  toast('تم حفظ الدين');
}

function renderPersonDebts() {
  const takeList = state.personDebts.filter(d => d.type === 'take');
  const giveList = state.personDebts.filter(d => d.type === 'give');
  $('debtSumTake').textContent = fmtCur(sumList(takeList, d => d.amount));
  $('debtSumGive').textContent = fmtCur(sumList(giveList, d => d.amount));

  const list = (currentDebtTab === 'take' ? takeList : giveList).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  $('personDebtsTableBody').innerHTML = list.map(d => `
    <tr class="hover:bg-slate-50 border-b border-slate-100">
      <td class="p-3 font-bold text-slate-800">${esc(d.name)}</td>
      <td class="p-3 text-slate-600">${esc(d.phone || '-')}</td>
      <td class="p-3 font-bold ${d.type === 'take' ? 'text-emerald-700' : 'text-rose-600'}">${fmtCur(d.amount)}</td>
      <td class="p-3 text-slate-600">${esc(d.notes || '-')}</td>
      <td class="p-3 text-center">
        <button onclick="deletePersonDebt('${esc(d.id)}')" class="bg-rose-100 text-rose-700 hover:bg-rose-600 hover:text-white px-2.5 py-1 rounded text-xs font-bold transition"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>`).join('') || `<tr><td colspan="5" class="p-6 text-center text-slate-400 text-sm">لا توجد سجلات</td></tr>`;
}

function deletePersonDebt(id) {
  Swal.fire({
    title: 'حذف السجل؟', icon: 'warning', showCancelButton: true,
    confirmButtonColor: '#d33', cancelButtonColor: '#3085d6',
    confirmButtonText: 'نعم، حذف', cancelButtonText: 'إلغاء'
  }).then(async res => {
    if (!res.isConfirmed) return;
    const removed = state.personDebts.find(d => d.id === id);
    state.personDebts = state.personDebts.filter(d => d.id !== id);
    logAudit('حذف دين شخصي', removed ? `${removed.name} (${fmtCur(removed.amount)})` : id);
    const ok = await saveToStorage();
    if (!ok) { if (removed) state.personDebts.push(removed); return; }
    renderPersonDebts();
    toast('تم الحذف');
  });
}

/* ==========================================================================
   الطلبات المجدولة
   ========================================================================== */
function updateOrdersBadge() {
  const pendingCount = (state.orders || []).filter(o => o.status === 'pending').length;
  const badge = $('ordersBadge');
  if (!badge) return;
  if (pendingCount > 0) {
    badge.textContent = pendingCount;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function openOrderModal(orderId = null) {
  $('orderEditId').value = orderId || '';
  $('orderItemsList').innerHTML = '';

  if (orderId) {
    const o = state.orders.find(x => x.id === orderId);
    if (!o) return;
    $('orderClientSelect').value = o.clientId;
    const c = state.clients.find(x => x.id === o.clientId);
    $('orderSelectedClientText').textContent = c ? c.name : 'اختر الزبون';
    $('orderDueDate').value = o.dueDate || '';
    $('orderDueTime').value = o.dueTime || '';
    $('orderNotes').value = o.notes || '';
    (o.items || []).forEach(it => addOrderItem(it.productId, it.qty));
  } else {
    $('orderClientSelect').value = '';
    $('orderSelectedClientText').textContent = 'اختر الزبون';
    const tomorrow = new Date(Date.now() + 86400000);
    $('orderDueDate').value = tomorrow.toISOString().split('T')[0];
    $('orderDueTime').value = '10:00';
    $('orderNotes').value = '';
    addOrderItem();
  }
  openModal('orderModal');
}

function toggleOrderClientDropdown() {
  const list = state.clients;
  const dropdown = $('orderClientDropdownList');
  if (!dropdown) return;
  dropdown.innerHTML = list.map(c => `
    <div onclick="selectOrderClient('${esc(c.id)}', '${esc(c.name)}')" class="p-2.5 hover:bg-emerald-50 cursor-pointer text-xs font-bold flex justify-between items-center">
      <span>${esc(c.name)}</span>
      <span class="text-[11px] text-slate-400">${c.type === 'wholesale' ? 'جملة' : 'تجزئة'}</span>
    </div>`).join('');
  toggleDropdown('orderClientDropdownList');
}

function selectOrderClient(id, name) {
  $('orderClientSelect').value = id;
  $('orderSelectedClientText').textContent = name;
  $('orderClientDropdownList').classList.add('hidden');
}

function addOrderItem(productId = '', qty = 1) {
  const row = document.createElement('div');
  row.className = 'flex gap-2 items-center bg-slate-50 p-2 rounded-xl border border-slate-200';
  const options = `<option value="">اختر المنتج</option>` + state.products.map(p =>
    `<option value="${esc(p.id)}" ${p.id === productId ? 'selected' : ''}>${esc(p.name)} (${fmt(p.retailPrice)})</option>`
  ).join('');
  row.innerHTML = `
    <select class="order-item-prod flex-grow text-xs">${options}</select>
    <input type="number" min="1" value="${qty}" class="order-item-qty w-16 text-center bg-white border border-slate-300 rounded-lg text-xs font-bold py-1.5">
    <button type="button" onclick="this.parentElement.remove()" class="text-rose-500 hover:text-rose-700 px-2 font-bold text-sm">&times;</button>`;
  $('orderItemsList').appendChild(row);
}

async function saveOrder() {
  const editId = $('orderEditId').value;
  const clientId = $('orderClientSelect').value;
  if (!clientId) return warn('خطأ', 'اختر الزبون');
  const client = state.clients.find(c => c.id === clientId);
  if (!client) return warn('خطأ', 'الزبون غير موجود');

  const dueDate = $('orderDueDate').value;
  const dueTime = $('orderDueTime').value;
  if (!dueDate) return warn('خطأ', 'حدد تاريخ الاستلام');

  const itemRows = [...document.querySelectorAll('#orderItemsList > div')];
  const items = [];
  for (const r of itemRows) {
    const prodId = r.querySelector('.order-item-prod').value;
    const qty = Math.max(1, parseInt(r.querySelector('.order-item-qty').value, 10) || 1);
    if (!prodId) continue;
    const p = state.products.find(x => x.id === prodId);
    if (!p) continue;
    items.push({ productId: p.id, name: p.name, qty, price: toNum(p.retailPrice) });
  }
  if (!items.length) return warn('خطأ', 'أضف صنفاً واحداً على الأقل');

  const dueTs = new Date(`${dueDate}T${dueTime || '12:00'}:00`).getTime();
  const notes = $('orderNotes').value.trim();

  if (editId) {
    const o = state.orders.find(x => x.id === editId);
    if (!o) return;
    Object.assign(o, { clientId, clientName: client.name, dueDate, dueTime, dueTs, items, notes });
    logAudit('تعديل طلب', `طلب #${o.id} للزبون ${client.name}`);
  } else {
    const newOrder = {
      id: 'ORD-' + Date.now().toString().slice(-6),
      ts: Date.now(), date: nowStr(),
      clientId, clientName: client.name,
      dueDate, dueTime, dueTs, items, notes,
      status: 'pending'
    };
    state.orders.push(newOrder);
    logAudit('طلب جديد', `طلب #${newOrder.id} للزبون ${client.name}`);
  }

  const ok = await saveToStorage();
  if (!ok) return;

  closeModal('orderModal');
  renderOrders();
  updateOrdersBadge();
  toast('تم حفظ الطلب');
}

function renderOrders() {
  updateOrdersBadge();
  const grid = $('ordersGrid');
  if (!grid) return;

  const list = [...state.orders]
    .filter(o => o.status === 'pending')
    .sort((a, b) => (a.dueTs || 0) - (b.dueTs || 0));

  if (!list.length) {
    grid.innerHTML = `<div class="col-span-full text-center py-10 text-slate-400 text-sm font-bold bg-white rounded-2xl border border-dashed">لا توجد طلبات قيد التنفيذ</div>`;
    return;
  }

  grid.innerHTML = list.map(o => {
    const totalVal = sumList(o.items || [], it => calcLineTotal(it.price, it.qty));
    const isUrgent = o.dueTs && (o.dueTs - Date.now() < 86400000);
    return `<div class="bg-white border ${isUrgent ? 'border-amber-400' : 'border-slate-200'} rounded-2xl p-4 shadow-sm space-y-3 flex flex-col justify-between card-hover">
      <div>
        <div class="flex justify-between items-start gap-2">
          <div>
            <span class="text-[11px] font-bold bg-ashour/10 text-ashour px-2 py-0.5 rounded">${esc(o.id)}</span>
            <h4 class="font-bold text-base text-slate-800 mt-1">${esc(o.clientName)}</h4>
          </div>
          <span class="text-xs font-bold px-2 py-1 rounded-lg num-tabular ${isUrgent ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700'}">
            <i class="fa-regular fa-clock"></i> ${esc(o.dueDate)} ${esc(o.dueTime || '')}
          </span>
        </div>
        <div class="mt-2.5 bg-slate-50 border border-slate-100 rounded-xl p-2 space-y-1 text-xs font-semibold num-tabular">
          ${(o.items || []).map(it => `<div class="flex justify-between"><span>${fmt(it.qty)} × ${esc(it.name)}</span><span class="font-bold text-slate-700">${fmtCur(calcLineTotal(it.price, it.qty))}</span></div>`).join('')}
        </div>
        ${o.notes ? `<p class="text-xs text-slate-500 mt-2 font-semibold"><i class="fa-regular fa-note-sticky"></i> ${esc(o.notes)}</p>` : ''}
      </div>
      <div class="border-t border-slate-100 pt-3 flex items-center justify-between gap-2 num-tabular">
        <span class="text-sm font-bold text-ashour">${fmtCur(totalVal)}</span>
        <div class="flex gap-1.5">
          <button onclick="convertOrderToInvoice('${esc(o.id)}')" class="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition"><i class="fa-solid fa-cash-register"></i> فاتورة</button>
          <button onclick="deleteOrder('${esc(o.id)}')" class="bg-rose-100 hover:bg-rose-600 text-rose-700 hover:text-white px-2.5 py-1.5 rounded-lg text-xs font-bold transition"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
    </div>`;
  }).join('');
}

async function convertOrderToInvoice(orderId) {
  const o = state.orders.find(x => x.id === orderId);
  if (!o) return;
  const client = state.clients.find(c => c.id === o.clientId);
  if (client) selectClient(client.id, client.name);

  state.cart = (o.items || [])
    .filter(it => state.products.some(p => p.id === it.productId))
    .map(it => ({ productId: it.productId, qty: toNum(it.qty) }));

  o.status = 'delivered';
  logAudit('تحويل طلب لفاتورة', `طلب #${o.id} → الكاشير`);
  await saveToStorage();
  renderOrders();
  renderCart();
  switchTab('pos');
  toast('تم نقل الطلب إلى الكاشير');
}

function deleteOrder(orderId) {
  Swal.fire({
    title: 'حذف الطلب؟', icon: 'warning', showCancelButton: true,
    confirmButtonColor: '#d33', cancelButtonColor: '#3085d6',
    confirmButtonText: 'نعم، حذف', cancelButtonText: 'إلغاء'
  }).then(async res => {
    if (!res.isConfirmed) return;
    const removed = state.orders.find(o => o.id === orderId);
    state.orders = state.orders.filter(o => o.id !== orderId);
    logAudit('حذف طلب', removed ? `طلب #${removed.id}` : orderId);
    const ok = await saveToStorage();
    if (!ok) { if (removed) state.orders.push(removed); return; }
    renderOrders();
    toast('تم حذف الطلب');
  });
}

/* ==========================================================================
   المبيعات وإلغاء الفواتير والفاتورة والطباعة والمشاركة
   ========================================================================== */
function renderInvoicesTable() {
  const q = normalizeArabic(($('invoiceSearchInput')?.value || '').trim());
  const statusFilter = $('invoiceStatusFilter')?.value || 'all';
  const fromVal = $('invoiceFromDate')?.value;
  const toVal = $('invoiceToDate')?.value;
  const fromTs = fromVal ? new Date(fromVal + 'T00:00:00').getTime() : -Infinity;
  const toTs = toVal ? new Date(toVal + 'T23:59:59').getTime() : Infinity;

  const combined = [
    ...state.invoices.map(i => ({ ...i, isDirect: false })),
    ...state.directSales.map(ds => ({
      id: ds.id, ts: ds.ts, date: ds.date || new Date(ds.ts).toLocaleString('ar-SY'),
      clientId: 'c1', clientName: `بيع سريع (${ds.name})`,
      items: [{ name: ds.name, qty: ds.qty, price: ds.price, total: ds.total, isQuickOnly: true }],
      total: ds.total, paid: ds.paid, remaining: ds.remaining || 0,
      profit: ds.profit, status: 'active', isDirect: true
    }))
  ];

  const list = combined
    .filter(r => r.ts >= fromTs && r.ts <= toTs)
    .filter(r => {
      if (statusFilter === 'cancelled') return r.status === 'cancelled';
      if (r.status === 'cancelled') return false;
      if (statusFilter === 'cash') return toNum(r.remaining) <= 0;
      if (statusFilter === 'partial') return toNum(r.paid) > 0 && toNum(r.remaining) > 0;
      if (statusFilter === 'debt') return toNum(r.paid) <= 0 && toNum(r.remaining) > 0;
      return true;
    })
    .filter(r => !q || normalizeArabic(r.id).includes(q) || normalizeArabic(r.clientName).includes(q))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));

  const activeOnly = list.filter(r => r.status === 'active');
  const returnsInRange = state.returns.filter(r => r.ts >= fromTs && r.ts <= toTs);
  const returnsSum = sumList(returnsInRange, r => r.amount);
  const returnsProfitSum = sumList(returnsInRange, r => r.profitAdjustment || 0);

  const sumTotal = roundMoney(sumList(activeOnly, r => r.total) - returnsSum);
  const sumPaid = roundMoney(sumList(activeOnly, r => r.paid) - returnsSum);
  const sumRem = Math.max(0, roundMoney(sumList(activeOnly, r => r.remaining) - returnsSum));
  const sumProfit = roundMoney(sumList(activeOnly, r => r.profit) - returnsProfitSum);

  if ($('invoicesSummaryStrip')) {
    $('invoicesSummaryStrip').innerHTML = `
      <div class="bg-slate-50 border rounded-xl p-2"><span class="block text-xs text-slate-500">صافي المبيعات</span><span class="font-bold text-slate-800">${fmtCur(sumTotal)}</span></div>
      <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-2"><span class="block text-xs text-emerald-700">المحصل</span><span class="font-bold text-emerald-800">${fmtCur(sumPaid)}</span></div>
      <div class="bg-rose-50 border border-rose-200 rounded-xl p-2"><span class="block text-xs text-rose-700">المتبقي</span><span class="font-bold text-rose-700">${fmtCur(sumRem)}</span></div>
      <div class="bg-indigo-50 border border-indigo-200 rounded-xl p-2"><span class="block text-xs text-indigo-700">صافي الربح</span><span class="font-bold text-indigo-800">${fmtCur(sumProfit)}</span></div>`;
  }

  $('invoicesTableBody').innerHTML = list.map(r => {
    const isCancelled = r.status === 'cancelled';
    const badge = isCancelled
      ? `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-rose-100 text-rose-700">ملغاة</span>`
      : (toNum(r.remaining) > 0
        ? `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-800">${toNum(r.paid) > 0 ? 'جزئي' : 'آجل'}</span>`
        : `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800">نقدي</span>`);

    return `<tr class="${isCancelled ? 'bg-rose-50/40 text-slate-400' : 'hover:bg-slate-50'} border-b border-slate-100">
      <td class="p-3 font-bold">${esc(r.id)}</td>
      <td class="p-3 text-xs">${esc(r.date)}</td>
      <td class="p-3 font-bold text-slate-800">${esc(r.clientName)}</td>
      <td class="p-3 font-bold">${fmtCur(r.total)}</td>
      <td class="p-3 text-emerald-700 font-bold">${fmtCur(r.paid)}</td>
      <td class="p-3 font-bold ${toNum(r.remaining) > 0 ? 'text-rose-600' : 'text-slate-500'}">${fmtCur(r.remaining)}</td>
      <td class="p-3 font-bold text-indigo-700">${fmtCur(r.profit)}</td>
      <td class="p-3">${badge}</td>
      <td class="p-3 text-center whitespace-nowrap">
        <button onclick="viewPastInvoice('${esc(r.id)}')" class="bg-ashour text-white hover:bg-ashour-dark px-2.5 py-1 rounded text-xs font-bold transition"><i class="fa-solid fa-eye"></i></button>
        ${!isCancelled && !r.isDirect ? `<button onclick="cancelInvoice('${esc(r.id)}')" class="bg-rose-100 text-rose-700 hover:bg-rose-600 hover:text-white px-2.5 py-1 rounded text-xs font-bold transition"><i class="fa-solid fa-ban"></i></button>` : ''}
      </td>
    </tr>`;
  }).join('') || `<tr><td colspan="9" class="p-6 text-center text-slate-400 text-sm">لا توجد عمليات مطابقة</td></tr>`;
}

function viewPastInvoice(invId) {
  const inv = state.invoices.find(i => i.id === invId);
  if (inv) { showReceiptModal(inv); return; }
  const ds = state.directSales.find(x => x.id === invId);
  if (ds) {
    showReceiptModal({
      id: ds.id, ts: ds.ts, date: ds.date || new Date(ds.ts).toLocaleString('ar-SY'),
      clientId: 'c1', clientName: `بيع سريع (${ds.name})`, priceMode: 'نقدي',
      items: [{ name: ds.name, qty: ds.qty, price: ds.price, total: ds.total }],
      discount: 0, total: ds.total, paid: ds.paid, remaining: ds.remaining || 0, changeGiven: 0
    });
  }
}

function cancelInvoice(invId) {
  Swal.fire({
    title: 'إلغاء الفاتورة؟',
    text: 'سيتم إرجاع الكميات للمخزون وإبطال الفاتورة.',
    icon: 'warning', showCancelButton: true,
    confirmButtonColor: '#d33', cancelButtonColor: '#3085d6',
    confirmButtonText: 'نعم، إلغاء', cancelButtonText: 'تراجع'
  }).then(async res => {
    if (!res.isConfirmed) return;
    const inv = state.invoices.find(i => i.id === invId);
    if (!inv || inv.status === 'cancelled') return;

    const prevStatus = inv.status;
    const prevStockMap = new Map(state.products.map(p => [p.id, toNum(p.stock)]));

    (inv.items || []).forEach(it => {
      if (!it.isQuickOnly) {
        const prod = state.products.find(p => p.id === it.productId);
        if (prod) prod.stock = roundMoney(toNum(prod.stock) + toNum(it.qty));
      }
    });

    inv.status = 'cancelled';
    logAudit('إلغاء فاتورة', `إلغاء ${inv.id} (${inv.clientName})`);

    const ok = await saveToStorage();
    if (!ok) {
      inv.status = prevStatus;
      state.products.forEach(p => { if (prevStockMap.has(p.id)) p.stock = prevStockMap.get(p.id); });
      return;
    }

    renderAll();
    toast('تم إلغاء الفاتورة');
  });
}

function showReceiptModal(inv) {
  state.currentReceiptInv = inv;
  $('recStoreName').textContent = state.storeInfo.name;
  $('recStorePhone').textContent = state.storeInfo.phone;
  $('recStoreAddress').textContent = state.storeInfo.address;
  $('recNum').textContent = inv.id;
  $('recDate').textContent = inv.date || new Date(inv.ts).toLocaleString('ar-SY');
  $('recClient').textContent = inv.clientName;
  $('recPriceMode').textContent = inv.priceMode || 'تجزئة';

  $('recItemsBody').innerHTML = (inv.items || []).map(it =>
    `<tr class="border-b border-slate-200 border-dashed"><td class="py-1">${esc(it.name)}</td><td class="py-1 text-center">${it.qty}</td><td class="py-1 text-left">${fmt(it.price)}</td><td class="py-1 text-left">${fmt(it.total)}</td></tr>`
  ).join('');

  if (toNum(inv.discount) > 0) {
    $('recDiscountRow').classList.remove('hidden');
    $('recDiscount').textContent = fmtCur(inv.discount);
  } else {
    $('recDiscountRow').classList.add('hidden');
  }

  $('recTotal').textContent = fmtCur(inv.total);
  $('recPaid').textContent = fmtCur(inv.paid);
  $('recRemaining').textContent = fmtCur(inv.remaining || 0);

  if (toNum(inv.changeGiven) > 0) {
    $('recChangeRow').classList.remove('hidden');
    $('recChange').textContent = fmtCur(inv.changeGiven);
  } else {
    $('recChangeRow').classList.add('hidden');
  }

  const totalDebt = inv.clientId && inv.clientId !== 'c1' ? getClientDebt(inv.clientId) : toNum(inv.remaining);
  $('recTotalClientDebt').textContent = fmtCur(totalDebt);
  openModal('receiptModal');
}

async function captureReceiptCanvas() {
  const el = $('printableReceipt');
  if (!el || typeof html2canvas === 'undefined') return null;
  return await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
}

async function saveReceiptAsImage() {
  const canvas = await captureReceiptCanvas();
  if (!canvas) return warn('تنبيه', 'تعذر التقاط صورة الفاتورة', 'error');
  const link = document.createElement('a');
  link.download = `${state.currentReceiptInv?.id || 'receipt'}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
  toast('تم حفظ صورة الفاتورة');
}

async function shareReceiptImage() {
  const canvas = await captureReceiptCanvas();
  if (!canvas) return warn('تنبيه', 'تعذر التقاط صورة الفاتورة', 'error');
  canvas.toBlob(async (blob) => {
    if (!blob) return;
    const file = new File([blob], `${state.currentReceiptInv?.id || 'receipt'}.png`, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: `فاتورة ${state.currentReceiptInv?.id || ''}` });
        return;
      } catch (_) {}
    }
    saveReceiptAsImage();
  }, 'image/png');
}

function shareReceiptWhatsApp() {
  const inv = state.currentReceiptInv;
  if (!inv) return;
  const itemsText = (inv.items || []).map(i => `• ${i.qty} × ${i.name} = ${fmtCur(i.total)}`).join('\n');
  const txt = `*${state.storeInfo.name}*\nفاتورة رقم: *${inv.id}*\nالزبون: ${inv.clientName}\n${itemsText}\n──────────────\nالإجمالي: *${fmtCur(inv.total)}*\nالمدفوع: ${fmtCur(inv.paid)}\nالمتبقي: ${fmtCur(inv.remaining || 0)}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(txt)}`, '_blank');
}

/* ==========================================================================
   المصاريف والتقارير
   ========================================================================== */
function openExpenseModal() {
  $('expTitle').value = '';
  $('expAmount').value = '';
  $('expNotes').value = '';
  openModal('expenseModal');
}

async function saveExpense() {
  const title = $('expTitle').value.trim();
  const amount = fromDisplayAmount($('expAmount').value);
  const notes = $('expNotes').value.trim() || '-';
  if (!title) return warn('خطأ', 'أدخل بند المصروف');
  if (!(amount > 0)) return warn('خطأ', 'أدخل مبلغاً صحيحاً');

  const item = { id: 'EXP-' + Date.now(), ts: Date.now(), date: nowStr(), title, amount, notes };
  state.expenses.push(item);
  logAudit('مصروف', `${title}: ${fmtCur(amount)}`);
  const ok = await saveToStorage();
  if (!ok) { state.expenses.pop(); return; }

  closeModal('expenseModal');
  renderExpensesTable();
  renderReports();
  toast('تم تسجيل المصروف');
}

function renderExpensesTable() {
  const list = [...state.expenses].sort((a, b) => (b.ts || 0) - (a.ts || 0));
  $('expensesTableBody').innerHTML = list.map(e => `
    <tr class="hover:bg-slate-50 border-b border-slate-100">
      <td class="p-3 text-slate-500 text-xs">${esc(e.date)}</td>
      <td class="p-3 font-bold text-slate-800">${esc(e.title)}</td>
      <td class="p-3 font-bold text-rose-600">${fmtCur(e.amount)}</td>
      <td class="p-3 text-slate-600">${esc(e.notes || '-')}</td>
      <td class="p-3 text-center">
        <button onclick="deleteExpense('${esc(e.id)}')" class="bg-rose-100 text-rose-700 hover:bg-rose-600 hover:text-white px-2.5 py-1 rounded text-xs font-bold transition"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>`).join('') || `<tr><td colspan="5" class="p-6 text-center text-slate-400 text-sm">لا توجد مصاريف</td></tr>`;
}

function deleteExpense(id) {
  Swal.fire({
    title: 'حذف المصروف؟', icon: 'warning', showCancelButton: true,
    confirmButtonColor: '#d33', cancelButtonColor: '#3085d6',
    confirmButtonText: 'نعم، حذف', cancelButtonText: 'إلغاء'
  }).then(async res => {
    if (!res.isConfirmed) return;
    const removed = state.expenses.find(e => e.id === id);
    state.expenses = state.expenses.filter(e => e.id !== id);
    logAudit('حذف مصروف', removed ? `${removed.title} (${fmtCur(removed.amount)})` : id);
    const ok = await saveToStorage();
    if (!ok) { if (removed) state.expenses.push(removed); return; }
    renderExpensesTable();
    renderReports();
    toast('تم الحذف');
  });
}

function setReportRange(days) {
  const today = new Date();
  const toStr = dayKey(today.getTime());
  const fromDate = new Date(today.getTime() - days * 86400000);
  $('repFrom').value = dayKey(fromDate.getTime());
  $('repTo').value = toStr;
  renderReports();
}

function renderReports() {
  if ($('repFrom') && !$('repFrom').value) { setReportRange(30); return; }
  const fromVal = $('repFrom')?.value;
  const toVal = $('repTo')?.value;
  const fromTs = fromVal ? new Date(fromVal + 'T00:00:00').getTime() : -Infinity;
  const toTs = toVal ? new Date(toVal + 'T23:59:59').getTime() : Infinity;

  const invs = state.invoices.filter(i => i.status === 'active' && i.ts >= fromTs && i.ts <= toTs);
  const ds = state.directSales.filter(d => d.ts >= fromTs && d.ts <= toTs);
  const rets = state.returns.filter(r => r.ts >= fromTs && r.ts <= toTs);
  const exps = state.expenses.filter(e => e.ts >= fromTs && e.ts <= toTs);

  const grossSales = roundMoney(sumList(invs, i => i.total) + sumList(ds, d => d.total));
  const returnsTotal = sumList(rets, r => r.amount);
  const sales = roundMoney(grossSales - returnsTotal);

  const grossProfit = roundMoney(sumList(invs, i => i.profit) + sumList(ds, d => d.profit));
  const returnsProfitAdj = sumList(rets, r => r.profitAdjustment || 0);
  const expensesSum = sumList(exps, e => e.amount);
  const netProfit = roundMoney(grossProfit - returnsProfitAdj - expensesSum);

  $('reportCards').innerHTML = `
    <div class="bg-white border rounded-xl p-3 shadow-sm"><span class="block text-xs text-slate-500">صافي المبيعات</span><span class="text-sm font-bold text-ashour">${fmtCur(sales)}</span></div>
    <div class="bg-white border rounded-xl p-3 shadow-sm"><span class="block text-xs text-amber-700">المرتجعات</span><span class="text-sm font-bold text-amber-700">${fmtCur(returnsTotal)}</span></div>
    <div class="bg-white border rounded-xl p-3 shadow-sm"><span class="block text-xs text-rose-600">المصاريف</span><span class="text-sm font-bold text-rose-600">${fmtCur(expensesSum)}</span></div>
    <div class="bg-white border rounded-xl p-3 shadow-sm"><span class="block text-xs text-emerald-700">صافي الربح</span><span class="text-sm font-bold ${netProfit >= 0 ? 'text-emerald-700' : 'text-rose-600'}">${fmtCur(netProfit)}</span></div>`;

  const topMap = new Map();
  invs.forEach(i => (i.items || []).forEach(it => {
    const k = normalizeArabic(it.name);
    const prev = topMap.get(k) || { name: it.name, qty: 0, total: 0 };
    prev.qty = roundMoney(prev.qty + toNum(it.qty));
    prev.total = roundMoney(prev.total + toNum(it.total));
    topMap.set(k, prev);
  }));
  const topList = [...topMap.values()].sort((a, b) => b.total - a.total).slice(0, 10);
  $('topProductsBody').innerHTML = topList.map((x, idx) => `
    <tr><td class="p-2.5 text-slate-400 font-bold">#${idx + 1}</td><td class="p-2.5 font-bold">${esc(x.name)}</td><td class="p-2.5 text-slate-600">${fmt(x.qty)}</td><td class="p-2.5 text-left font-bold text-ashour">${fmtCur(x.total)}</td></tr>`
  ).join('') || `<tr><td colspan="4" class="p-4 text-center text-slate-400">لا توجد بيانات</td></tr>`;

  $('auditLogBody').innerHTML = (state.auditLog || []).slice(0, 50).map(a => `
    <tr><td class="p-2 text-slate-400 whitespace-nowrap">${esc(a.date)}</td><td class="p-2 font-bold text-ashour whitespace-nowrap">${esc(a.type)}</td><td class="p-2 text-slate-700">${esc(a.details)}</td></tr>`
  ).join('') || `<tr><td colspan="3" class="p-4 text-center text-slate-400">لا توجد سجلات</td></tr>`;
}

function exportReportCSV() {
  const rows = [['الرقم', 'التاريخ', 'الزبون', 'الإجمالي', 'المدفوع', 'المتبقي', 'الربح', 'الحالة']];
  state.invoices.forEach(i => {
    rows.push([i.id, i.date, i.clientName, i.total, i.paid, i.remaining, i.profit, i.status]);
  });
  const csv = '\uFEFF' + rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `ashour_report_${dayKey(Date.now())}.csv`;
  link.click();
  toast('تم تصدير تقرير CSV');
}

/* ==========================================================================
   الإعدادات، النسخ الاحتياطي والاستيراد، الذاكرة، التصفير
   ========================================================================== */
function loadStoreInfoToSettings() {
  if ($('setStoreName')) $('setStoreName').value = state.storeInfo.name || '';
  if ($('setStorePhone')) $('setStorePhone').value = state.storeInfo.phone || '';
  if ($('setStoreAddress')) $('setStoreAddress').value = state.storeInfo.address || '';
}

async function saveStoreSettings() {
  state.storeInfo.name = $('setStoreName').value.trim() || 'مركز عاشور للتجارة';
  state.storeInfo.phone = $('setStorePhone').value.trim() || '-';
  state.storeInfo.address = $('setStoreAddress').value.trim() || '-';
  if ($('headerStoreName')) $('headerStoreName').textContent = state.storeInfo.name;
  logAudit('تحديث بيانات المتجر', state.storeInfo.name);
  await saveToStorage();
  toast('تم حفظ بيانات المتجر');
}

async function changePinCode() {
  const oldPin = $('oldPinInput').value.trim();
  const newPin = $('newPinInput').value.trim();
  if (!oldPin || !newPin) return warn('تنبيه', 'أدخل الرمز الحالي والرمز الجديد');
  if (!/^\d{4,6}$/.test(newPin)) return warn('تنبيه', 'يجب أن يتكون رمز PIN من 4 إلى 6 أرقام');
  const oldHash = await hashPin(oldPin, state.pinSalt);
  if (oldHash !== state.pinHash) return warn('خطأ', 'الرمز الحالي غير صحيح', 'error');

  state.pinSalt = generateSalt();
  state.pinHash = await hashPin(newPin, state.pinSalt);
  state.pinLength = newPin.length;
  $('oldPinInput').value = '';
  $('newPinInput').value = '';
  logAudit('تغيير رمز PIN', 'تم تحديث رمز الدخول');
  await saveToStorage();
  toast('تم تغيير رمز PIN بنجاح');
}

function exportDataBackup() {
  const payload = JSON.stringify(state, null, 2);
  const blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
  const fileName = `ashour_backup_${dayKey(Date.now())}.json`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  logAudit('تصدير نسخة احتياطية', fileName);
  toast('تم تصدير النسخة الاحتياطية');
}

function triggerImportBackup() {
  const input = $('importBackupFile');
  if (!input) return;
  input.value = '';
  input.click();
}

function importDataBackup(event) {
  const file = event && event.target && event.target.files && event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      const parsed = JSON.parse(String(ev.target.result || ''));
      if (!parsed || typeof parsed !== 'object' || (!Array.isArray(parsed.products) && !Array.isArray(parsed.invoices))) {
        return warn('ملف غير صالح', 'الملف المختار ليس نسخة احتياطية صحيحة لنظام مركز عاشور.', 'error');
      }

      const res = await Swal.fire({
        title: 'استعادة النسخة الاحتياطية؟',
        text: 'سيتم استبدال البيانات الحالية بالبيانات الموجودة في الملف.',
        icon: 'warning', showCancelButton: true,
        confirmButtonColor: '#0F5C4E', cancelButtonColor: '#d33',
        confirmButtonText: 'نعم، استعادة', cancelButtonText: 'إلغاء'
      });
      if (!res.isConfirmed) return;

      const pinSalt = state.pinSalt;
      const pinHash = state.pinHash;
      const pinLength = state.pinLength;

      state = deepMerge(defaultState(), parsed);
      if (!state.pinHash) {
        state.pinSalt = pinSalt || generateSalt();
        state.pinHash = pinHash || await hashPin('1234', state.pinSalt);
        state.pinLength = pinLength || 4;
      }
      state.lastUpdated = Date.now();
      logAudit('استعادة نسخة احتياطية', file.name);

      await saveToStorage();
      refreshCategoryWidgets();
      populatePosClients();
      renderAll();
      toast('تمت استعادة النسخة الاحتياطية بنجاح');
    } catch (_) {
      warn('خطأ في قراءة الملف', 'تعذر قراءة الملف المختار. تأكد أنه ملف نسخة احتياطية سليم.', 'error');
    } finally {
      if (event && event.target) event.target.value = '';
    }
  };
  reader.readAsText(file);
}

async function refreshStorageStatus() {
  const box = $('storageStatus');
  if (!box || !window.AshourDB) return;
  const st = await AshourDB.getStatus();
  const kb = Math.round((st.localStorageSize || 0) / 1024);
  let html = `<div>IndexedDB: <span class="text-emerald-700">${esc(st.indexedDB)}</span></div>`;
  html += `<div>localStorage: <span class="text-slate-700">${esc(st.localStorage)} (${kb} KB)</span></div>`;
  if (st.estimate) {
    html += `<div>المساحة المستخدمة: <span class="text-ashour">${Math.round(st.estimate.usage / 1024)} KB</span> (${st.estimate.percent}%)</div>`;
  }
  box.innerHTML = html;
}

async function testStorageCapacity() {
  if (!window.AshourDB) return;
  const res = await AshourDB.testCapacity();
  Swal.fire({
    icon: res.ok ? 'success' : 'error',
    title: res.ok ? 'اختبار الذاكرة ناجح' : 'فشل اختبار الذاكرة',
    html: `الحجم المختبر: <b>${res.sizeKB} KB</b><br>الزمن: <b>${res.ms} ms</b><br>IndexedDB: <b>${res.okIDB ? '✓' : '✗'}</b> • localStorage: <b>${res.okLS ? '✓' : '✗'}</b>${res.error ? `<br><small class="text-rose-600">${esc(res.error)}</small>` : ''}`,
    confirmButtonColor: '#0F5C4E'
  });
}

function factoryReset() {
  Swal.fire({
    title: 'تصفير النظام بالكامل؟',
    html: 'سيتم مسح جميع الفواتير والمنتجات والزبائن والمشتريات والمصاريف محلياً.<br><small class="text-slate-500">ملاحظة: إذا كنت مسجلاً الدخول بـ Google، راجع المزامنة السحابية حتى لا تعود البيانات القديمة من السحابة.</small>',
    icon: 'warning', showCancelButton: true,
    confirmButtonColor: '#d33', cancelButtonColor: '#64748b',
    confirmButtonText: 'نعم، مسح الكل', cancelButtonText: 'إلغاء'
  }).then(async res => {
    if (!res.isConfirmed) return;
    const salt = generateSalt();
    const hash = await hashPin('1234', salt);
    state = defaultState();
    state.pinSalt = salt;
    state.pinHash = hash;
    state.pinLength = 4;
    state.lastUpdated = Date.now();
    await AshourDB.wipeAll();
    await AshourDB.save(state);
    refreshCategoryWidgets();
    populatePosClients();
    renderAll();
    toast('تم تصفير النظام بنجاح');
  });
}

/* ==========================================================================
   النوافذ المنبثقة وتهيئة النظام
   ========================================================================== */
function openModal(id) {
  const el = $(id);
  if (!el) return;
  el.classList.remove('hidden');
  el.style.display = 'flex';
}
function closeModal(id) {
  const el = $(id);
  if (!el) return;
  el.classList.add('hidden');
  el.style.display = 'none';
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeAllDropdowns();
    if ($('barcodeScannerModal') && !$('barcodeScannerModal').classList.contains('hidden')) { closeBarcodeScanner(); return; }
    const openMod = MODAL_IDS.find(id => $(id) && !$(id).classList.contains('hidden'));
    if (openMod) closeModal(openMod);
  }
  if (e.key === 'F2') {
    e.preventDefault();
    switchTab('pos');
    setTimeout(() => $('quickEntryInput')?.focus(), 100);
  }
  if (e.key === 'F4') {
    e.preventDefault();
    openDirectSaleModal();
  }
});

function renderAll() {
  if ($('headerStoreName')) $('headerStoreName').textContent = state.storeInfo.name || 'مركز عاشور';
  const cBtn = $('currencyToggleBtn');
  const cBtnD = $('currencyToggleBtnDesktop');
  if (cBtn) cBtn.textContent = state.displayCurrency || 'SYP';
  if (cBtnD) cBtnD.textContent = state.displayCurrency || 'SYP';

  updateLowStockBadge();
  updateOrdersBadge();
  updatePosPriceUI();
  renderPosProducts();
  renderCart();
  renderInventory();
  renderInvoicesTable();
  renderPurchases();
  renderProductsTable();
  renderClientsGrid();
  renderCompaniesGrid();
  renderPersonDebts();
  renderExpensesTable();
  renderOrders();
  if (state.currentLedgerClientId) {
    renderLedgerSummary(state.currentLedgerClientId);
    renderClientSpecialPrices(state.currentLedgerClientId);
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  await loadFromStorage();
  refreshCategoryWidgets();
  populatePosClients();
  renderAll();
  if (window.FireSync && typeof window.FireSync._updateLoginUI === 'function') {
    window.FireSync._updateLoginUI(window.FireSync.currentUser);
  }
});
