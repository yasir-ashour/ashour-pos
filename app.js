/* ==========================================================================
   app.js — منطق النظام الكامل لمركز عاشور للتجارة
   ========================================================================== */

const CURRENCY = 'ل.س.ج';
const $ = id => document.getElementById(id);

function toNum(val) { const n = Number(val); return Number.isFinite(n) ? n : 0; }
function roundMoney(val) { return Math.round((toNum(val) + Number.EPSILON) * 100) / 100; }
function calcLineTotal(price, qty) { return roundMoney(toNum(price) * toNum(qty)); }
function sumList(arr, getter) { let t = 0; for (let i = 0; i < arr.length; i++) t = roundMoney(t + toNum(getter(arr[i]))); return t; }
function fmt(n) {
  const num = roundMoney(n); const parts = String(num).split('.');
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
  return String(s == null ? '' : s).replace(/[&<>"'\\]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '\\': '&#92;'
  }[c]));
}
function normalizeArabic(str) {
  return String(str || '').toLowerCase().replace(/[أآإٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[\u064b-\u065f]/g, '');
}
function dayKey(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function nowStr() { return new Date().toLocaleString('ar-SY'); }
function debounce(fn, ms = 220) {
  let t = null;
  return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
}

const warn = (title, text, icon = 'warning') => Swal.fire({ icon, title, text, confirmButtonColor: '#0F5C4E' });
const toast = (title, icon = 'success') => Swal.fire({ toast: true, position: 'top-end', icon, title, showConfirmButton: false, timer: 1600 });

const debouncedRenderPosProducts = debounce(() => renderPosProducts(), 160);
const debouncedPopulatePosClients = debounce(() => populatePosClients(), 160);
const debouncedRenderInvoicesTable = debounce(() => renderInvoicesTable(), 200);
const debouncedRenderProductsTable = debounce(() => renderProductsTable(), 200);
const debouncedRenderClientsGrid = debounce(() => renderClientsGrid(), 200);
const debouncedRenderCompaniesGrid = debounce(() => renderCompaniesGrid(), 200);
const debouncedRenderInventoryTable = debounce(() => renderInventoryTable(), 180);
const debouncedRenderStockMovements = debounce(() => renderStockMovements(), 180);

const DEFAULT_CATEGORIES = ['بسكويت', 'شيبس', 'عصائر ومشروبات', 'سكاكر وعلكة', 'قهوة', 'مواد غذائية'];

let state = {};
let isCheckoutSubmitting = false;
let currentDebtTab = 'take';
let pendingOrder = null;
let currentInvoicePage = 1;
const INVOICES_PER_PAGE = 50;
let receiveStockDraft = {};
let currentOrderItems = [];

function defaultState() {
  return {
    pinHash: null, pinSalt: null, pinLength: 4, pinAttempts: 0, pinLockUntil: 0,
    storeInfo: { name: 'مركز عاشور للتجارة', phone: '0991234567', address: 'أوتستراد درعا - قبل التاون سنتر - حي القدم - دمشق' },
    displayCurrency: 'SYP',
    exchangeRate: 15000,
    products: [],
    clients: [{ id: 'c1', name: 'زبون نقدي مباشر', type: 'retail', phone: '-', address: '-', openingDebt: 0, customPrices: {} }],
    invoices: [], expenses: [], payments: [], returns: [], directSales: [], noInvoiceItems: [],
    companies: [], purchases: [], companyPayments: [], personDebts: [],
    orders: [], stockMovements: [], tombstones: [], trash: [],
    auditLog: [{ ts: Date.now(), date: nowStr(), type: 'النظام', details: 'بدء تشغيل النظام', status: 'مكتمل' }],
    invoiceCounter: 1000,
    cart: [], selectedPosCategory: 'الكل', posPriceOverride: null,
    currentLedgerClientId: null, currentReceiptInv: null, activeCompanyId: null,
    customPricesEditing: null, lastUpdated: 0
  };
}

function addTombstone(col, id) {
  if (!state.tombstones) state.tombstones = [];
  const idStr = String(id);
  if (state.tombstones.some(t => t.col === col && String(t.id) === idStr)) return;
  state.tombstones.push({ col, id: idStr, ts: Date.now() });
  if (state.tombstones.length > 2000) state.tombstones = state.tombstones.slice(-2000);
}
function isDeleted(col, id) {
  const idStr = String(id);
  return (state.tombstones || []).some(t => t.col === col && String(t.id) === idStr);
}
function filterDeleted(col, arr) {
  if (!Array.isArray(arr)) return [];
  return arr.filter(item => item && !isDeleted(col, item.id));
}
function addToTrash(col, record) {
  if (!state.trash) state.trash = [];
  state.trash.push({ col, ts: Date.now(), rec: record });
  if (state.trash.length > 2000) state.trash = state.trash.slice(-2000);
}

async function saveToStorage() {
  const result = await AshourDB.save(state);
  if (!result.ok) {
    Swal.fire({ icon: 'error', title: 'فشل الحفظ المحلي!', html: `تعذّر حفظ البيانات.<br><small>${esc(result.errors.join(' | '))}</small>`, confirmButtonColor: '#d33' });
    return false;
  }
  if (window.FireSync && window.FireSync.currentUser && typeof window.FireSync.saveToCloud === 'function') {
    state.lastUpdated = Date.now();
    window.FireSync.saveToCloud(state).catch(() => {});
  }
  return true;
}

let backupTimer = null;
function startAutoBackup() {
  if (backupTimer) clearInterval(backupTimer);
  backupTimer = setInterval(async () => { if (state.products) await AshourDB.saveBackup(state); }, 5 * 60 * 1000);
}

async function loadFromStorage() {
  const result = await AshourDB.load();
  if (!result.ok && result.error) {
    await Swal.fire({ icon: 'error', title: 'تعذّر قراءة البيانات', text: 'لم يتغيّر شيء. أغلق التطبيق وأعد فتحه، وإن تكرر الأمر فاستعد من نسخة احتياطية.', allowOutsideClick: false, confirmButtonColor: '#d33' });
    throw new Error('load failed');
  }
  state = (result.ok && result.state) ? deepMerge(defaultState(), result.state) : defaultState();
  ['returns', 'directSales', 'noInvoiceItems', 'companies', 'payments', 'expenses', 'invoices', 'products', 'clients', 'purchases', 'companyPayments', 'personDebts', 'orders', 'stockMovements', 'tombstones', 'trash'].forEach(k => {
    if (!Array.isArray(state[k])) state[k] = [];
  });
  state.clients.forEach(c => { if (!c.customPrices || typeof c.customPrices !== 'object') c.customPrices = {}; });
  state.products.forEach(p => {
    if (typeof p.trackStock !== 'boolean') p.trackStock = false;
    if (typeof p.stock !== 'number') p.stock = 0;
    if (typeof p.minStock !== 'number') p.minStock = 5;
  });
  if (!state.invoiceCounter) state.invoiceCounter = 1000;
  if (!state.pinSalt) state.pinSalt = generateSalt();
  if (!state.pinHash) { state.pinHash = await hashPin('1234', state.pinSalt); state.pinLength = 4; }
  if (!state.pinLength) state.pinLength = 4;
  await saveToStorage();
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
  try { const arr = new Uint8Array(16); crypto.getRandomValues(arr); return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join(''); }
  catch (_) { return 'salt_' + Date.now() + '_' + Math.random().toString(36).slice(2); }
}
async function hashPin(pin, salt) {
  const txt = String(salt || '') + String(pin);
  try {
    if (window.crypto && crypto.subtle && crypto.subtle.digest) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
  } catch (_) {}
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
  const errEl = $('pinError'); if (errEl) errEl.classList.add('hidden');
  if (state.pinLockUntil && Date.now() < state.pinLockUntil) {
    const secs = Math.ceil((state.pinLockUntil - Date.now()) / 1000);
    if (errEl) { errEl.textContent = `محاولات كثيرة. انتظر ${secs} ثانية.`; errEl.classList.remove('hidden'); }
    clearPin(); return;
  }
  const h = await hashPin(enteredPin, state.pinSalt);
  if (h === state.pinHash) {
    const ov = $('pinOverlay'); if (ov) { ov.classList.add('hidden'); ov.style.display = 'none'; }
    state.pinAttempts = 0; await saveToStorage(); clearPin(); resetAutoLock();
    setTimeout(() => { const q = $('quickEntryInput'); if (q) q.focus(); }, 180);
  } else {
    state.pinAttempts = toNum(state.pinAttempts) + 1;
    const dc = $('pinDots'); if (dc) dc.classList.add('animate-shake');
    document.querySelectorAll('.pin-dot').forEach(d => d.classList.add('bg-rose-500', 'border-rose-500'));
    setTimeout(() => { if (dc) dc.classList.remove('animate-shake'); }, 400);
    if (errEl) {
      if (state.pinAttempts >= 5) { state.pinLockUntil = Date.now() + 30000; state.pinAttempts = 0; errEl.textContent = 'قفل 30 ثانية.'; }
      else errEl.textContent = 'رمز PIN غير صحيح';
      errEl.classList.remove('hidden');
    }
    setTimeout(() => clearPin(), 500);
    await saveToStorage();
  }
}
function lockApp() {
  const ov = $('pinOverlay');
  if (ov) { ov.classList.remove('hidden'); ov.style.display = 'flex'; }
  clearPin();
  if ($('pinError')) $('pinError').classList.add('hidden');
}
let autoLockTimer = null, lastActivity = 0;
function resetAutoLock() {
  const now = Date.now();
  if (now - lastActivity < 1500) return;
  lastActivity = now;
  clearTimeout(autoLockTimer);
  autoLockTimer = setTimeout(() => {
    const ov = $('pinOverlay');
    if (ov && ov.classList.contains('hidden')) lockApp();
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
  updateCurrencyButtons();
  await saveToStorage();
  renderAll();
  toast(`تم التبديل إلى ${state.displayCurrency === 'USD' ? 'الدولار' : 'الليرة السورية'}`, 'info');
}
function updateCurrencyButtons() {
  const label = state.displayCurrency;
  if ($('currencyToggleBtn')) $('currencyToggleBtn').textContent = label;
  if ($('currencyToggleBtnDesktop')) $('currencyToggleBtnDesktop').innerHTML = `<i class="fa-solid fa-coins"></i> <span>العملة: ${label}</span>`;
}

function switchTab(tabId) {
  document.querySelectorAll('.tab-view').forEach(el => { el.classList.add('hidden'); el.classList.remove('active'); });
  const view = $('view-' + tabId);
  if (view) { view.classList.remove('hidden'); setTimeout(() => view.classList.add('active'), 15); }

  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const dBtn = $('tab-' + tabId);
  if (dBtn) dBtn.classList.add('active');

  document.querySelectorAll('.m-tab-btn').forEach(el => {
    el.classList.remove('bg-ashour', 'text-white');
    el.classList.add('text-slate-700', 'hover:bg-slate-100');
  });
  const mBtn = $('m-tab-' + tabId);
  if (mBtn) {
    mBtn.classList.remove('text-slate-700', 'hover:bg-slate-100');
    mBtn.classList.add('bg-ashour', 'text-white');
  }

  if (tabId === 'pos') { populatePosClients(); updatePosPriceUI(); renderPosProducts(); renderCart(); }
  if (tabId === 'settings') { loadStoreInfoToSettings(); refreshStorageStatus(); }
  if (tabId === 'reports') { renderReports(); renderAuditLog(); }
  if (tabId === 'purchases') renderPurchases();
  if (tabId === 'invoices') renderInvoicesTable();
  if (tabId === 'products') renderProductsTable();
  if (tabId === 'expenses') renderExpensesTable();
  if (tabId === 'debts') switchDebtTab(currentDebtTab || 'take');
  if (tabId === 'clients') renderClientsGrid();
  if (tabId === 'companies') renderCompaniesGrid();
  if (tabId === 'orders') { renderOrders(); updateOrdersBadge(); }
  if (tabId === 'inventory') { switchInventorySubTab('products'); renderInventoryTable(); updateInventoryBadge(); }
}

function toggleDropdown(id) {
  const target = $(id);
  if (!target) return;
  const isHidden = target.classList.contains('hidden');
  ['clientDropdownList', 'invoiceStatusDropdownList', 'prodCatDropdownList', 'orderClientDropdownList'].forEach(dId => {
    const el = $(dId);
    if (el) el.classList.add('hidden');
  });
  if (isHidden) target.classList.remove('hidden');
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.relative')) {
    ['clientDropdownList', 'invoiceStatusDropdownList', 'prodCatDropdownList', 'orderClientDropdownList'].forEach(dId => {
      const el = $(dId);
      if (el) el.classList.add('hidden');
    });
  }
});

const MODAL_IDS = ['barcodeScannerModal', 'quickProductModal', 'directSaleModal', 'productModal', 'companyModal', 'companyProductModal', 'purchaseModal', 'personDebtModal', 'companyPaymentModal', 'receiptModal', 'clientModal', 'customPricesModal', 'orderModal', 'expenseModal', 'stockAdjustmentModal', 'receiveStockModal'];

window.addEventListener('popstate', () => {
  if ($('barcodeScannerModal') && !$('barcodeScannerModal').classList.contains('hidden')) { closeBarcodeScanner(); history.pushState(null, null, location.href); return; }
  const openMod = MODAL_IDS.find(id => $(id) && !$(id).classList.contains('hidden'));
  if (openMod) { closeModal(openMod); history.pushState(null, null, location.href); return; }
  const activeTab = document.querySelector('.nav-item.active');
  if (activeTab && activeTab.id !== 'tab-pos') { switchTab('pos'); history.pushState(null, null, location.href); return; }
  Swal.fire({ title: 'هل تريد الخروج من النظام؟', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6', confirmButtonText: 'نعم، خروج', cancelButtonText: 'إلغاء' })
    .then(result => { if (result.isConfirmed) history.back(); else history.pushState(null, null, location.href); });
});
history.pushState(null, null, location.href);

function allCategories() {
  const set = new Set(DEFAULT_CATEGORIES);
  filterDeleted('products', state.products).forEach(p => { if (p.category) set.add(p.category); });
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
function selectInvoiceStatus(val, label) {
  $('invoiceStatusFilter').value = val;
  $('selectedInvoiceStatusText').textContent = label;
  $('invoiceStatusDropdownList').classList.add('hidden');
  renderInvoicesTable();
}

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
  if (!filterDeleted('products', state.products).length) { warn('لا توجد منتجات', 'أضف منتجات أولاً', 'info'); return; }
  if (!client.customPrices || typeof client.customPrices !== 'object') client.customPrices = {};
  state.customPricesEditing = { clientId, draft: { ...client.customPrices } };
  $('customPricesClientName').textContent = client.name;
  $('cpSearchInput').value = '';
  renderCustomPricesList();
  openModal('customPricesModal');
  setTimeout(() => $('cpSearchInput')?.focus(), 100);
}
function renderCustomPricesList() {
  const editing = state.customPricesEditing; if (!editing) return;
  const q = normalizeArabic(($('cpSearchInput')?.value || '').trim());
  const list = filterDeleted('products', state.products).filter(p =>
    !q || normalizeArabic(p.name).includes(q) || normalizeArabic(p.sku).includes(q) || normalizeArabic(p.barcode).includes(q));
  const setCount = Object.values(editing.draft).filter(v => toNum(v) > 0).length;
  if ($('cpStats')) $('cpStats').textContent = `${setCount} سعر مفعّل`;
  if (!list.length) { $('customPricesList').innerHTML = `<div class="text-center py-10 text-slate-400 text-sm font-bold">لا توجد منتجات مطابقة</div>`; return; }
  $('customPricesList').innerHTML = list.map(p => {
    const currentCustom = toNum(editing.draft[p.id]) || 0;
    return `<div class="cp-row ${currentCustom > 0 ? 'is-set' : ''}">
      <div class="min-w-0">
        <div class="font-bold text-sm text-slate-800 truncate">${esc(p.name)}</div>
        <div class="text-[11px] text-slate-500 font-semibold num-tabular">تجزئة: ${fmt(p.retailPrice)} • جملة: ${fmt(p.wholesalePrice)} • كود: ${esc(p.sku || '-')}</div>
      </div>
      <div class="flex items-center gap-1">
        <input type="number" step="any" min="0" data-pid="${esc(p.id)}" value="${currentCustom > 0 ? currentCustom : ''}" placeholder="0" oninput="onCustomPriceInput(this)" class="w-24 border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
        <button type="button" onclick="clearCustomPriceField('${esc(p.id)}')" class="text-rose-500 hover:text-rose-700 w-8 h-8 flex items-center justify-center"><i class="fa-solid fa-xmark"></i></button>
      </div>
    </div>`;
  }).join('');
}
function onCustomPriceInput(el) {
  const editing = state.customPricesEditing; if (!editing) return;
  const pid = el.dataset.pid; const val = toNum(el.value);
  if (val > 0) editing.draft[pid] = roundMoney(val); else delete editing.draft[pid];
  const row = el.closest('.cp-row'); if (row) row.classList.toggle('is-set', val > 0);
  const setCount = Object.values(editing.draft).filter(v => toNum(v) > 0).length;
  if ($('cpStats')) $('cpStats').textContent = `${setCount} سعر مفعّل`;
}
function clearCustomPriceField(pid) { const e = state.customPricesEditing; if (!e) return; delete e.draft[pid]; renderCustomPricesList(); }
async function saveAllCustomPrices() {
  const editing = state.customPricesEditing; if (!editing) return;
  const { clientId, draft } = editing;
  const client = state.clients.find(c => c.id === clientId); if (!client) return;
  const prev = { ...(client.customPrices || {}) };
  client.customPrices = { ...draft };
  const activeCount = Object.values(draft).filter(v => toNum(v) > 0).length;
  logAudit('تحديث أسعار خاصة', `${client.name}: ${activeCount} سعر مفعّل`);
  const ok = await saveToStorage();
  if (!ok) { client.customPrices = prev; return; }
  state.customPricesEditing = null; closeModal('customPricesModal');
  if (state.currentLedgerClientId === clientId) renderClientSpecialPrices(clientId);
  if (getSelectedPosClient().id === clientId) { renderPosProducts(); renderCart(); }
  renderClientsGrid(); toast('تم حفظ الأسعار الخاصة');
}
async function clearAllCustomPrices() {
  const editing = state.customPricesEditing; if (!editing) return;
  const res = await Swal.fire({ title: 'مسح كل الأسعار الخاصة؟', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6', confirmButtonText: 'نعم، امسح', cancelButtonText: 'إلغاء' });
  if (!res.isConfirmed) return;
  editing.draft = {}; renderCustomPricesList(); toast('سيتم المسح عند الحفظ', 'info');
}

function initPOSCategories() {
  const cats = ['الكل', ...allCategories()];
  if (!cats.includes(state.selectedPosCategory)) state.selectedPosCategory = 'الكل';
  const bar = $('posCategoryFilter');
  if (bar) {
    bar.innerHTML = cats.map(cat => {
      const active = state.selectedPosCategory === cat;
      return `<button type="button" onclick="setPosCat('${esc(cat)}')" class="px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition ${active ? 'bg-slate-900 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}">${esc(cat)}</button>`;
    }).join('');
  }
}
function setPosCat(cat) { state.selectedPosCategory = cat; initPOSCategories(); renderPosProducts(); }

function getSelectedPosClient() {
  const id = $('posClientSelect')?.value || 'c1';
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
    const res = await Swal.fire({ title: `تبديل التسعيرة إلى (${nextLabel})؟`, text: 'هل تريد تحديث أسعار الأصناف الحالية في السلة إلى التسعيرة الجديدة؟', icon: 'question', showCancelButton: true, showDenyButton: true, confirmButtonColor: '#0F5C4E', denyButtonColor: '#475569', cancelButtonColor: '#d33', confirmButtonText: 'نعم، حدّث السلة', denyButtonText: 'بدّل الشارة فقط', cancelButtonText: 'إلغاء' });
    if (res.isDismissed) return;
    if (res.isConfirmed) {
      state.cart.forEach(item => {
        if (!item.isQuickOnly) {
          const p = state.products.find(x => x.id === item.productId);
          if (p) { const resolved = resolveProductPricing(p, client, next); if (resolved.price > 0) item.customPrice = resolved.price; }
        }
      });
    }
  }
  state.posPriceOverride = next; updatePosPriceUI(); renderPosProducts(); renderCart();
  toast(`التسعيرة الحالية: ${nextLabel}`);
}
function updatePosPriceUI() {
  const client = getSelectedPosClient();
  const customCount = client && client.customPrices ? Object.values(client.customPrices).filter(v => toNum(v) > 0).length : 0;
  const mode = getActivePriceType(); const isWholesale = mode === 'wholesale';
  const badge = $('posPriceTypeBadge'), invBadge = $('posInvoicePriceBadge');
  const baseLabel = isWholesale ? 'جملة (موزع)' : 'تجزئة (عادي)';
  if (badge) {
    badge.textContent = !state.posPriceOverride && customCount > 0 ? `${baseLabel} + خاص (${customCount})` : baseLabel;
    badge.className = isWholesale ? 'text-xs font-extrabold text-amber-700' : 'text-xs font-extrabold text-emerald-700';
  }
  if (invBadge) {
    invBadge.textContent = `تسعيرة: ${isWholesale ? 'جملة' : 'تجزئة'}${!state.posPriceOverride && customCount > 0 ? ' (خاص)' : ''}`;
  }
}
function populatePosClients() {
  const filter = ($('posClientSearch')?.value || '').trim().toLowerCase();
  const list = filterDeleted('clients', state.clients).filter(c => !filter || normalizeArabic(c.name).includes(normalizeArabic(filter)) || (c.phone || '').includes(filter));
  const dropdown = $('clientDropdownList'); if (!dropdown) return;
  dropdown.innerHTML = list.map(c => {
    const cCount = c.customPrices ? Object.values(c.customPrices).filter(v => toNum(v) > 0).length : 0;
    return `<div onclick="selectClient('${esc(c.id)}', '${esc(c.name)}')" class="p-2.5 hover:bg-emerald-50 cursor-pointer text-xs font-bold flex justify-between items-center num-tabular">
      <span>${esc(c.name)} ${cCount > 0 ? `<span class="text-[10px] bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded mr-1">${cCount} خاص</span>` : ''}</span>
      <span class="text-[11px] text-slate-500">دين: ${fmtCur(getClientDebt(c.id))}</span>
    </div>`;
  }).join('');
  if ($('posClientSelect') && !$('posClientSelect').value) {
    const c1 = state.clients.find(c => c.id === 'c1');
    if (c1) { $('posClientSelect').value = 'c1'; $('selectedClientText').textContent = c1.name; }
  }
}
function selectClient(id, label) {
  $('posClientSelect').value = id;
  $('selectedClientText').textContent = label;
  $('clientDropdownList').classList.add('hidden');
  state.posPriceOverride = null;
  onPosClientChange();
}
function toggleClientDropdown() { toggleDropdown('clientDropdownList'); populatePosClients(); }
function onPosClientChange() {
  const client = getSelectedPosClient();
  if (state.cart.length > 0) state.cart.forEach(item => { if (!item.isQuickOnly) delete item.customPrice; });
  updatePosPriceUI(); renderPosProducts(); renderCart();
  if (client && client.id !== 'c1') {
    const cCount = client.customPrices ? Object.values(client.customPrices).filter(v => toNum(v) > 0).length : 0;
    if (cCount > 0) toast(`تم تطبيق ${cCount} سعر خاص لـ ${client.name}`, 'info');
  }
}

function getStockStatus(product) {
  if (!product || !product.trackStock) return 'untracked';
  const stock = toNum(product.stock);
  const minStock = toNum(product.minStock) || 5;
  if (stock <= 0) return 'out';
  if (stock <= minStock) return 'low';
  return 'ok';
}
function renderPosProducts() {
  const grid = $('posProductsGrid'); if (!grid) return;
  const search = normalizeArabic(($('posSearch')?.value || '').trim());
  const client = getSelectedPosClient();
  const filtered = filterDeleted('products', state.products).filter(p => {
    const okCat = state.selectedPosCategory === 'الكل' || p.category === state.selectedPosCategory;
    return okCat && (!search || normalizeArabic(p.name).includes(search) || normalizeArabic(p.sku).includes(search) || normalizeArabic(p.barcode).includes(search));
  });
  if (!filtered.length) {
    grid.innerHTML = `<div class="col-span-full text-center py-12 bg-white rounded-2xl border border-dashed border-slate-300 text-slate-400 text-sm font-bold">لا توجد منتجات مطابقة</div>`;
    return;
  }
  grid.innerHTML = filtered.map(p => {
    const resolved = resolveProductPricing(p, client, state.posPriceOverride);
    const price = resolved.price;
    const stockStatus = getStockStatus(p);
    const stockBadge = stockStatus === 'untracked' ? '' :
      (stockStatus === 'out' ? `<span class="stock-badge out">نفد</span>` :
        stockStatus === 'low' ? `<span class="stock-badge low">${toNum(p.stock)}</span>` :
        `<span class="stock-badge ok">${toNum(p.stock)}</span>`);
    return `<div onclick="addToCart('${esc(p.id)}')" class="bg-white border ${resolved.isCustom ? 'border-purple-300' : 'border-slate-200'} hover:border-ashour cursor-pointer transition flex flex-col justify-between rounded-xl p-3 shadow-sm card-hover relative group">
      ${stockBadge}
      <div>
        <div class="flex items-center justify-between gap-1">
          <span class="text-[11px] text-ashour font-bold bg-ashour/10 px-2 py-0.5 rounded num-tabular">${esc(p.sku || '-')}</span>
          ${resolved.isCustom ? `<span class="text-[10px] bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded font-bold">خاص</span>` : ''}
        </div>
        <h4 class="font-bold text-sm text-slate-800 line-clamp-2 leading-snug mt-1.5">${esc(p.name)}</h4>
      </div>
      <div class="mt-2.5 flex items-center justify-between border-t border-slate-100 pt-2 num-tabular">
        <span class="text-sm font-extrabold ${price > 0 ? (resolved.isCustom ? 'text-purple-700' : 'text-ashour') : 'text-rose-500 text-xs'}">${price > 0 ? fmtCur(price) : 'حدد السعر'}</span>
        <span class="w-7 h-7 bg-ashour/10 text-ashour rounded-lg flex items-center justify-center group-hover:bg-ashour group-hover:text-white transition"><i class="fa-solid fa-plus text-xs"></i></span>
      </div>
    </div>`;
  }).join('');
}

function handleQuickEntry(ev) {
  if (ev.key !== 'Enter') return;
  const input = ev.target; const val = input.value.trim(); if (!val) return;
  let code = val, qty = 1;
  if (val.includes('*')) { const parts = val.split('*'); code = parts[0].trim(); qty = Math.max(1, parseInt(parts[1].trim(), 10) || 1); }
  const product = filterDeleted('products', state.products).find(p =>
    String(p.barcode || '').trim() === code || String(p.sku || '').trim() === code || normalizeArabic(p.name) === normalizeArabic(code));
  if (!product) {
    Swal.fire({ icon: 'question', title: 'رمز غير موجود', text: `لم يتم العثور على منتج بالرمز (${code}). هل تريد فتح صنف مؤقت؟`, showCancelButton: true, confirmButtonColor: '#4f46e5', cancelButtonColor: '#64748b', confirmButtonText: 'فتح صنف مؤقت', cancelButtonText: 'إغلاق' })
      .then(res => { if (res.isConfirmed) openQuickProductModal(code); });
    input.value = ''; input.focus(); return;
  }
  const client = getSelectedPosClient();
  const resolved = resolveProductPricing(product, client, state.posPriceOverride);
  if (!(resolved.price > 0)) {
    Swal.fire({ icon: 'info', title: 'السعر غير محدد', text: `حدّد سعر ${product.name} أولاً.`, confirmButtonColor: '#0F5C4E' })
      .then(() => openProductModal(product.id));
    return;
  }
  if (product.trackStock && toNum(product.stock) <= 0) {
    warn('نفد المخزون', `${product.name} غير متوفر حالياً.`, 'warning'); input.value = ''; input.focus(); return;
  }
  const existing = state.cart.find(i => i.productId === product.id && !i.isQuickOnly);
  if (existing) existing.qty = roundMoney(toNum(existing.qty) + qty);
  else state.cart.push({ productId: product.id, qty });
  renderCart(); input.value = ''; input.focus();
  toast(`تمت إضافة ${qty} × ${product.name}`);
}

function addToCart(productId) {
  const product = state.products.find(p => p.id === productId); if (!product) return;
  const client = getSelectedPosClient();
  const resolved = resolveProductPricing(product, client, state.posPriceOverride);
  if (!(resolved.price > 0)) {
    Swal.fire({ icon: 'info', title: 'السعر غير محدد', text: 'حدد السعر أولاً.', confirmButtonColor: '#0F5C4E' }).then(() => openProductModal(productId));
    return;
  }
  if (product.trackStock && toNum(product.stock) <= 0) { warn('نفد المخزون', `${product.name} غير متوفر حالياً.`, 'warning'); return; }
  const existing = state.cart.find(i => i.productId === productId && !i.isQuickOnly);
  if (existing) existing.qty = roundMoney(toNum(existing.qty) + 1);
  else state.cart.push({ productId, qty: 1 });
  renderCart();
}

function addQuickCookie(price) {
  const name = `علب بسكويت سعر ال ${price}`;
  const existing = state.cart.find(i => i.isQuickOnly && i.name === name && toNum(i.price) === price);
  if (existing) existing.qty = roundMoney(toNum(existing.qty) + 1);
  else state.cart.push({ isQuickOnly: true, quickId: 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5), name, price, qty: 1 });
  renderCart(); toast(`تمت إضافة ${name}`);
}

function setCartItemQtyDirect(key, rawVal) {
  const item = state.cart.find(i => (i.quickId || i.productId) === key); if (!item) return;
  const val = roundMoney(rawVal);
  if (val <= 0) state.cart = state.cart.filter(i => (i.quickId || i.productId) !== key);
  else item.qty = val;
  renderCart();
}
function updateCartQty(key, delta) {
  const item = state.cart.find(i => (i.quickId || i.productId) === key); if (!item) return;
  const newQty = roundMoney(toNum(item.qty) + toNum(delta));
  if (newQty <= 0) state.cart = state.cart.filter(i => (i.quickId || i.productId) !== key);
  else item.qty = newQty;
  renderCart();
}
function addQtyToLast(n) { if (!state.cart.length) return; const last = state.cart[state.cart.length - 1]; updateCartQty(last.quickId || last.productId, n); }
function multiplyLastQty(f) { if (!state.cart.length) return; state.cart[state.cart.length - 1].qty = roundMoney(toNum(state.cart[state.cart.length - 1].qty) * toNum(f)); renderCart(); }
function clearCart() {
  state.cart = []; state.posPriceOverride = null; pendingOrder = null;
  if ($('posDiscount')) $('posDiscount').value = '';
  if ($('posPaidAmount')) $('posPaidAmount').value = '';
  updatePosPriceUI(); renderPosProducts(); renderCart();
}
function getCartItemInfo(item) {
  const client = getSelectedPosClient();
  if (item.isQuickOnly) {
    const unitCost = item.cost != null ? toNum(item.cost) : null;
    return { key: item.quickId, productId: item.quickId, name: item.name, unitPrice: toNum(item.price), unitCost, isQuickOnly: true, isCustom: false };
  }
  const p = state.products.find(x => x.id === item.productId); if (!p) return null;
  const resolved = resolveProductPricing(p, client, state.posPriceOverride);
  const activePrice = item.customPrice != null && toNum(item.customPrice) > 0 ? toNum(item.customPrice) : resolved.price;
  return { key: p.id, productId: p.id, name: p.name, unitPrice: activePrice, unitCost: toNum(p.cost), isQuickOnly: false, isCustom: resolved.isCustom && !(item.customPrice != null && toNum(item.customPrice) > 0) };
}
function cartTotals() {
  let subtotal = 0, cost = 0;
  state.cart.forEach(item => {
    const info = getCartItemInfo(item); if (!info) return;
    subtotal = roundMoney(subtotal + calcLineTotal(info.unitPrice, item.qty));
    if (info.unitCost != null) cost = roundMoney(cost + calcLineTotal(info.unitCost, item.qty));
  });
  const discount = Math.max(0, Math.min(toNum($('posDiscount')?.value), subtotal));
  const total = roundMoney(subtotal - discount);
  const discountPct = subtotal > 0 ? roundMoney((discount / subtotal) * 100) : 0;
  return { subtotal, discount, total, cost, discountPct };
}
function renderCart() {
  const container = $('cartItemsList'); if (!container) return;
  const { subtotal, total, discount, discountPct } = cartTotals();
  if (!state.cart.length) {
    container.innerHTML = `<div class="text-center py-8 text-slate-400"><i class="fa-solid fa-basket-shopping text-2xl mb-1.5 opacity-40 block"></i><p class="text-xs font-bold">الفاتورة فارغة — اختر أصنافاً للبدء</p></div>`;
  } else {
    container.innerHTML = state.cart.map(item => {
      const info = getCartItemInfo(item); if (!info) return '';
      return `<div class="py-2 flex items-center justify-between gap-2 num-tabular">
        <div class="flex-grow min-w-0">
          <h5 class="font-bold text-xs text-slate-800 truncate">${esc(info.name)} ${info.isCustom ? '<span class="text-[10px] bg-purple-100 text-purple-800 px-1 rounded">خاص</span>' : ''}</h5>
          <span class="text-[11px] text-slate-500 font-semibold">${fmtCur(info.unitPrice)} × ${item.qty}</span>
        </div>
        <div class="flex items-center gap-1">
          <button type="button" onclick="updateCartQty('${esc(info.key)}', -1)" class="w-6 h-6 bg-slate-200 hover:bg-rose-500 hover:text-white rounded text-xs font-bold">−</button>
          <input type="number" min="0" step="any" value="${item.qty}" onchange="setCartItemQtyDirect('${esc(info.key)}', this.value)" class="w-12 text-center bg-slate-50 border border-slate-300 rounded text-xs font-bold py-0.5">
          <button type="button" onclick="updateCartQty('${esc(info.key)}', 1)" class="w-6 h-6 bg-slate-200 hover:bg-ashour hover:text-white rounded text-xs font-bold">+</button>
        </div>
        <div class="text-left font-extrabold text-xs text-ashour min-w-[82px]">${fmtCur(calcLineTotal(info.unitPrice, item.qty))}</div>
      </div>`;
    }).join('');
  }
  const warnBadge = $('discountWarningBadge');
  if (warnBadge) {
    const shouldWarn = discount >= 50 && discountPct >= 15;
    if (shouldWarn) { $('discountPctText').textContent = `${discountPct}%`; warnBadge.classList.remove('hidden'); }
    else { warnBadge.classList.add('hidden'); $('discountPctText').textContent = '0%'; }
  }
  if ($('cartSubtotal')) $('cartSubtotal').textContent = fmtDual(subtotal);
  if ($('cartTotal')) $('cartTotal').textContent = fmtDual(total);
  if ($('posPaidAmount')) $('posPaidAmount').placeholder = `الإجمالي: ${fmt(total)}`;
  updatePaymentSummaryPreview();
}
function setPaidExact() { const total = cartTotals().total; $('posPaidAmount').value = state.displayCurrency === 'USD' ? roundMoney(total / state.exchangeRate) : total; updatePaymentSummaryPreview(); }
function setCreditMode() { $('posPaidAmount').value = 0; updatePaymentSummaryPreview(); }
function setPaidAmount(amt) { $('posPaidAmount').value = state.displayCurrency === 'USD' ? roundMoney(amt / state.exchangeRate) : amt; updatePaymentSummaryPreview(); }
function updatePaymentSummaryPreview() {
  const { total } = cartTotals();
  const paidEl = $('posPaidAmount'); if (!paidEl) return;
  const raw = paidEl.value.trim();
  let paidEntered = raw === '' ? total : Math.max(0, toNum(raw));
  if (state.displayCurrency === 'USD' && raw !== '') paidEntered = paidEntered * state.exchangeRate;
  const labelEl = $('posBalanceLabel'), valEl = $('posBalanceValue');
  if (!labelEl || !valEl) return;
  if (paidEntered > total) {
    const change = roundMoney(paidEntered - total);
    labelEl.textContent = 'الباقي للزبون:'; valEl.textContent = fmtCur(change); valEl.className = 'text-emerald-700 font-extrabold';
  } else {
    const remaining = roundMoney(total - paidEntered);
    labelEl.textContent = 'المتبقي (دين):'; valEl.textContent = fmtCur(remaining); valEl.className = remaining > 0 ? 'text-rose-600 font-extrabold' : 'text-slate-700 font-extrabold';
  }
}
function repeatLastInvoice() {
  const client = getSelectedPosClient();
  const last = [...state.invoices].reverse().find(i => i.clientId === client.id && i.status === 'active');
  if (!last) return warn('لا توجد فواتير', 'لا توجد فواتير سابقة لهذا الزبون', 'info');
  state.cart = last.items
    .filter(it => it.isQuickOnly || state.products.some(p => p.id === it.productId))
    .map(it => it.isQuickOnly ? { isQuickOnly: true, quickId: 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5), name: it.name, price: toNum(it.price), qty: toNum(it.qty) } : { productId: it.productId, qty: toNum(it.qty) });
  renderCart(); toast('تم نسخ آخر فاتورة');
}

function addStockMovement(productId, type, qty, beforeStock, afterStock, note, refId) {
  const product = state.products.find(p => p.id === productId);
  if (!product) return null;
  const movement = {
    id: 'MV-' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    ts: Date.now(), date: nowStr(),
    productId, productName: product.name,
    type, qty: toNum(qty),
    beforeStock: toNum(beforeStock), afterStock: toNum(afterStock),
    note: note || '', refId: refId || ''
  };
  state.stockMovements.push(movement);
  if (state.stockMovements.length > 5000) state.stockMovements = state.stockMovements.slice(-5000);
  return movement;
}

function nextInvoiceNumber() {
  state.invoiceCounter = toNum(state.invoiceCounter || 1000) + 1;
  return 'INV-' + state.invoiceCounter;
}
function computeCartHash(cart) {
  return cart.map(i => `${i.productId || i.quickId}:${i.qty}`).sort().join('|');
}
async function checkoutPOS() {
  if (isCheckoutSubmitting) return;
  if (!state.cart.length) return warn('الفاتورة فارغة', 'أضف منتجات أولاً');
  const client = getSelectedPosClient();
  const { total, cost } = cartTotals();
  for (const item of state.cart) {
    const info = getCartItemInfo(item);
    if (!info) return warn('منتج محذوف', 'أزل المنتجات المحذوفة من السلة', 'error');
    if (!(info.unitPrice > 0)) return warn('سعر غير محدد', info.name, 'error');
  }
  const paidRaw = $('posPaidAmount').value.trim();
  let paidEntered = paidRaw === '' ? total : Math.max(0, toNum(paidRaw));
  if (state.displayCurrency === 'USD' && paidRaw !== '') paidEntered = paidEntered * state.exchangeRate;
  const changeGiven = paidEntered > total ? roundMoney(paidEntered - total) : 0;
  const paidRecorded = roundMoney(Math.min(paidEntered, total));
  const remaining = roundMoney(total - paidRecorded);
  if (remaining > 0 && client.id === 'c1') return warn('اختيار الزبون مطلوب', 'لتسجيل فاتورة آجلة أو جزئية، يرجى اختيار زبون مسجل بدلاً من الزبون النقدي المباشر.', 'warning');
  const saveBtn = $('checkoutSaveBtn');
  isCheckoutSubmitting = true; if (saveBtn) saveBtn.disabled = true;
  try {
    const items = state.cart.map(item => {
      const info = getCartItemInfo(item);
      return { productId: info.productId, name: info.name, qty: toNum(item.qty), price: info.unitPrice, cost: info.unitCost != null ? info.unitCost : 0, total: calcLineTotal(info.unitPrice, item.qty), isQuickOnly: info.isQuickOnly };
    });
    const paymentType = remaining > 0 ? (paidRecorded > 0 ? 'partial' : 'debt') : 'cash';
    const priceModeLabel = getActivePriceType() === 'wholesale' ? 'جملة' : 'تجزئة';
    const prevCounter = state.invoiceCounter;
    const inv = { id: nextInvoiceNumber(), ts: Date.now(), date: nowStr(), clientId: client.id, clientName: client.name, priceMode: priceModeLabel, paymentType, items, discount: roundMoney(total - sumList(items, x => x.total)) * -1 > 0 ? roundMoney(sumList(items, x => x.total) - total) : 0, total, paid: paidRecorded, remaining, changeGiven, profit: roundMoney(total - cost), status: 'active' };
    const previousInvoices = [...state.invoices];
    state.invoices.push(inv);
    const stockSnapshots = [];
    for (const item of state.cart) {
      if (item.isQuickOnly) continue;
      const p = state.products.find(x => x.id === item.productId);
      if (!p || !p.trackStock) continue;
      stockSnapshots.push({ productId: p.id, before: toNum(p.stock) });
      const before = toNum(p.stock);
      p.stock = roundMoney(before - toNum(item.qty));
      addStockMovement(p.id, 'sale', -toNum(item.qty), before, p.stock, `فاتورة ${inv.id}`, inv.id);
    }
    logAudit('بيع فاتورة', `فاتورة ${inv.id} للزبون ${client.name} (${priceModeLabel}) بمبلغ ${fmtCur(total)} — متبقى ${fmtCur(remaining)}`);
    const ok = await saveToStorage();
    if (!ok) {
      state.invoices = previousInvoices; state.invoiceCounter = prevCounter;
      stockSnapshots.forEach(s => { const p = state.products.find(x => x.id === s.productId); if (p) p.stock = s.before; });
      state.stockMovements = state.stockMovements.filter(m => m.refId !== inv.id);
      return;
    }
    if (pendingOrder) {
      const currentHash = computeCartHash(state.cart);
      if (currentHash === pendingOrder.cartHash) {
        const o = state.orders.find(x => x.id === pendingOrder.id);
        if (o && o.status === 'pending') { o.status = 'delivered'; o.deliveredAt = Date.now(); o.invoiceId = inv.id; await saveToStorage(); renderOrders(); updateOrdersBadge(); }
      }
      pendingOrder = null;
    }
    showReceiptModal(inv);
    state.cart = []; state.posPriceOverride = null;
    $('posPaidAmount').value = ''; $('posDiscount').value = '';
    updatePosPriceUI(); renderPosProducts(); renderCart();
    updateInventoryBadge();
    toast('تم حفظ الفاتورة');
  } finally {
    setTimeout(() => { isCheckoutSubmitting = false; if (saveBtn) saveBtn.disabled = false; }, 450);
  }
}

let html5QrCode = null;
let currentScanTarget = 'quickEntryInput';
function openBarcodeScanner(targetId = 'quickEntryInput') {
  currentScanTarget = targetId;
  const modal = $('barcodeScannerModal');
  modal.classList.remove('hidden'); modal.style.display = 'flex';
  html5QrCode = new Html5Qrcode("barcode-reader");
  html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 150 } },
    decodedText => handleBarcodeScanSuccess(decodedText), () => {}
  ).catch(() => { warn('خطأ', 'تعذر تشغيل الكاميرا. تأكد من إعطاء الإذن للمتصفح.', 'error'); closeBarcodeScanner(); });
}
async function handleBarcodeScanSuccess(decodedText) {
  if (html5QrCode) { try { await html5QrCode.stop(); await html5QrCode.clear(); } catch (_) {} html5QrCode = null; }
  const modal = $('barcodeScannerModal'); modal.classList.add('hidden'); modal.style.display = 'none';
  if (currentScanTarget === 'prodBarcodeInput') { $('prodBarcodeInput').value = decodedText; toast('تم قراءة الباركود بنجاح'); return; }
  const input = $('quickEntryInput'); input.value = decodedText; handleQuickEntry({ key: 'Enter', target: input });
}
async function closeBarcodeScanner() {
  if (html5QrCode) { try { await html5QrCode.stop(); await html5QrCode.clear(); } catch (_) {} html5QrCode = null; }
  const modal = $('barcodeScannerModal'); modal.classList.add('hidden'); modal.style.display = 'none';
}

function openDirectSaleModal() {
  $('dsName').value = ''; $('dsQty').value = '1'; $('dsPrice').value = ''; $('dsPaid').value = '';
  if ($('dsCost')) $('dsCost').value = '';
  updateDirectSaleCalc(); openModal('directSaleModal');
}
function updateDirectSaleCalc() {
  const qty = Math.max(1, parseInt($('dsQty').value, 10) || 1);
  const price = Math.max(0, toNum($('dsPrice').value));
  const total = calcLineTotal(price, qty);
  const paidRaw = $('dsPaid').value.trim();
  const paid = paidRaw === '' ? total : Math.max(0, toNum(paidRaw));
  const change = paid > total ? roundMoney(paid - total) : 0;
  const remaining = paid < total ? roundMoney(total - paid) : 0;
  const costRaw = $('dsCost') ? $('dsCost').value.trim() : '';
  const unitCost = costRaw === '' ? null : toNum(costRaw);
  const profit = unitCost != null ? roundMoney(total - calcLineTotal(unitCost, qty)) : 0;
  $('dsSummaryText').textContent = `الإجمالي: ${fmtCur(total)} • المدفوع: ${fmtCur(paid)} • الباقي: ${fmtCur(change)} • متبقي: ${fmtCur(remaining)} • الربح: ${unitCost != null ? fmtCur(profit) : 'غير محدد'}`;
}
async function saveDirectSale() {
  const name = $('dsName').value.trim();
  const qty = Math.max(1, parseInt($('dsQty').value, 10) || 1);
  let price = toNum($('dsPrice').value);
  if (!name) return warn('خطأ', 'أدخل اسم الصنف');
  if (price <= 0) return warn('خطأ', 'أدخل سعراً صحيحاً');
  if (state.displayCurrency === 'USD') price = price * state.exchangeRate;
  const total = calcLineTotal(price, qty);
  const paidRaw = $('dsPaid').value.trim();
  let paidEntered = paidRaw === '' ? total : Math.max(0, toNum(paidRaw));
  if (state.displayCurrency === 'USD' && paidRaw !== '') paidEntered = paidEntered * state.exchangeRate;
  if (paidEntered < total) return warn('الدفع ناقص', 'البيع السريع نقدي بالكامل. للبيع الآجل استخدم الكاشير مع اختيار زبون.', 'info');
  const costRaw = $('dsCost') ? $('dsCost').value.trim() : '';
  const unitCost = costRaw === '' ? null : toNum(costRaw);
  const profit = unitCost != null ? roundMoney(total - calcLineTotal(unitCost, qty)) : 0;
  const newSale = { id: 'QS-' + Date.now(), ts: Date.now(), date: nowStr(), name, price, qty, total, paid: total, remaining: 0, profit, cost: unitCost };
  state.directSales.push(newSale);
  logAudit('بيع سريع', `${qty} × ${name} بقيمة ${fmtCur(total)}`);
  const ok = await saveToStorage();
  if (!ok) { state.directSales.pop(); return; }
  closeModal('directSaleModal'); renderInvoicesTable(); toast(`تم تسجيل ${qty} × ${name}`);
}

function generateUniqueSku() {
  const existing = new Set(state.products.map(p => String(p.sku || '').trim()));
  let num = Math.max(200, 101 + state.products.length);
  while (existing.has(String(num))) num++;
  return String(num);
}
function setAutoGeneratedSku() { $('prodSkuInput').value = generateUniqueSku(); }
function renderProductsTable() {
  const body = $('productsTableBody'); if (!body) return;
  const search = normalizeArabic(($('prodSearch')?.value || '').trim());
  const cat = $('prodCategoryFilter')?.value || '';
  const list = filterDeleted('products', state.products).filter(p =>
    (!cat || p.category === cat) && (!search || normalizeArabic(p.name).includes(search) || normalizeArabic(p.sku).includes(search) || normalizeArabic(p.barcode).includes(search)));
  if ($('prodCountBadge')) $('prodCountBadge').textContent = fmt(list.length);
  body.innerHTML = list.map(p => {
    const status = getStockStatus(p);
    const stockCell = status === 'untracked' ? '<span class="text-slate-400">—</span>' :
      status === 'out' ? `<span class="bg-rose-100 text-rose-700 px-2 py-0.5 rounded text-[11px] font-bold">نفد (${toNum(p.stock)})</span>` :
      status === 'low' ? `<span class="bg-amber-100 text-amber-800 px-2 py-0.5 rounded text-[11px] font-bold">${toNum(p.stock)}</span>` :
      `<span class="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded text-[11px] font-bold">${toNum(p.stock)}</span>`;
    return `<tr class="hover:bg-slate-50 border-b border-slate-100">
      <td class="p-3 text-ashour font-bold">${esc(p.sku || '-')} <br><span class="text-[11px] text-slate-500 font-normal">${esc(p.barcode || '')}</span></td>
      <td class="p-3 font-bold text-slate-900">${esc(p.name)}</td>
      <td class="p-3"><span class="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-[11px]">${esc(p.category || '-')}</span></td>
      <td class="p-3 text-slate-600">${fmtCur(p.cost)}</td>
      <td class="p-3 text-emerald-800">${fmtCur(p.retailPrice)}</td>
      <td class="p-3 text-amber-800">${fmtCur(p.wholesalePrice)}</td>
      <td class="p-3">${stockCell}</td>
      <td class="p-3 text-center"><div class="flex justify-center gap-1">
        <button type="button" onclick="openProductModal('${esc(p.id)}')" class="bg-indigo-100 text-indigo-700 hover:bg-indigo-600 hover:text-white px-2.5 py-1 rounded transition text-xs font-bold"><i class="fa-solid fa-pen"></i></button>
        <button type="button" onclick="deleteProduct('${esc(p.id)}')" class="bg-rose-100 text-rose-700 hover:bg-rose-600 hover:text-white px-2.5 py-1 rounded transition text-xs font-bold"><i class="fa-solid fa-trash"></i></button>
      </div></td>
    </tr>`;
  }).join('') || `<tr><td colspan="8" class="p-6 text-center text-slate-400 text-sm">لا توجد منتجات</td></tr>`;
}
function openProductModal(prodId = null) {
  $('prodEditId').value = prodId || '';
  if (prodId) {
    const p = state.products.find(x => x.id === prodId); if (!p) return;
    $('productModalTitle').textContent = 'تعديل منتج';
    $('prodSkuInput').value = p.sku || '';
    $('prodBarcodeInput').value = p.barcode || '';
    $('prodNameInput').value = p.name || '';
    $('prodCatInput').value = p.category || '';
    $('prodCostInput').value = toNum(p.cost);
    $('prodRetailInput').value = toNum(p.retailPrice);
    $('prodWholesaleInput').value = toNum(p.wholesalePrice);
    $('prodTrackStock').checked = !!p.trackStock;
    $('prodStockInput').value = toNum(p.stock);
    $('prodMinStockInput').value = toNum(p.minStock) || 5;
  } else {
    $('productModalTitle').textContent = 'إضافة منتج جديد';
    $('prodSkuInput').value = generateUniqueSku();
    $('prodBarcodeInput').value = ''; $('prodNameInput').value = ''; $('prodCatInput').value = '';
    $('prodCostInput').value = ''; $('prodRetailInput').value = ''; $('prodWholesaleInput').value = '';
    $('prodTrackStock').checked = true; $('prodStockInput').value = '0'; $('prodMinStockInput').value = '5';
  }
  openModal('productModal');
}
async function saveProduct() {
  const editId = $('prodEditId').value;
  let sku = $('prodSkuInput').value.trim();
  const barcode = $('prodBarcodeInput').value.trim();
  const name = $('prodNameInput').value.trim();
  const category = $('prodCatInput').value.trim() || 'مواد غذائية';
  let cost = toNum($('prodCostInput').value);
  let retailPrice = toNum($('prodRetailInput').value);
  let wholesalePrice = toNum($('prodWholesaleInput').value);
  const trackStock = $('prodTrackStock').checked;
  let stock = toNum($('prodStockInput').value);
  const minStock = toNum($('prodMinStockInput').value) || 5;
  if (!name) return warn('خطأ', 'أدخل اسم المنتج');
  if (retailPrice <= 0 && wholesalePrice <= 0) return warn('خطأ', 'أدخل سعراً واحداً على الأقل');
  if (!sku) sku = generateUniqueSku();
  if (state.displayCurrency === 'USD') { cost = cost * state.exchangeRate; retailPrice = retailPrice * state.exchangeRate; wholesalePrice = wholesalePrice * state.exchangeRate; }
  const duplicate = state.products.find(p => p.sku === sku && p.id !== editId);
  if (duplicate) return warn('كود مكرر', `الكود ${sku} مستخدم للمنتج: ${duplicate.name}`, 'error');
  if (barcode) {
    const dupBarcode = state.products.find(p => p.barcode === barcode && p.id !== editId);
    if (dupBarcode) return warn('باركود مكرر', `الباركود ${barcode} مستخدم للمنتج: ${dupBarcode.name}`, 'error');
  }
  let previous = null;
  if (editId) {
    const p = state.products.find(x => x.id === editId); if (!p) return;
    previous = { ...p };
    const oldStock = toNum(p.stock);
    const wasTracked = !!p.trackStock;
    Object.assign(p, { sku, barcode, name, category, cost, retailPrice, wholesalePrice, trackStock, stock, minStock });
    if (trackStock && (!wasTracked || oldStock !== stock)) {
      addStockMovement(p.id, wasTracked ? 'adjustment' : 'initial', stock - (wasTracked ? oldStock : 0), wasTracked ? oldStock : 0, stock, wasTracked ? 'تعديل من شاشة المنتجات' : 'جرد افتتاحي', '');
    }
    logAudit('تعديل منتج', name);
  } else {
    const newProd = { id: Date.now().toString(), sku, barcode, name, category, cost, retailPrice, wholesalePrice, trackStock, stock, minStock };
    state.products.push(newProd);
    if (trackStock && stock !== 0) addStockMovement(newProd.id, 'initial', stock, 0, stock, 'جرد افتتاحي', '');
    logAudit('إضافة منتج', `${name} (كود: ${sku})`);
  }
  const ok = await saveToStorage();
  if (!ok) {
    if (editId && previous) { const p = state.products.find(x => x.id === editId); if (p) Object.assign(p, previous); }
    else state.products.pop();
    return;
  }
  closeModal('productModal'); refreshCategoryWidgets(); renderProductsTable(); renderPosProducts(); updateInventoryBadge();
  toast('تم الحفظ');
}
function deleteProduct(id) {
  Swal.fire({ title: 'حذف المنتج؟', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6', confirmButtonText: 'نعم', cancelButtonText: 'إلغاء' })
    .then(async res => {
      if (!res.isConfirmed) return;
      const removed = state.products.find(p => p.id === id);
      const removedFromCart = state.cart.filter(i => i.productId === id);
      state.products = state.products.filter(p => p.id !== id);
      state.cart = state.cart.filter(i => i.productId !== id);
      if (removed) { addTombstone('products', removed.id); addToTrash('products', removed); }
      logAudit('حذف منتج', removed ? removed.name : id);
      const ok = await saveToStorage();
      if (!ok) { if (removed) state.products.push(removed); state.cart.push(...removedFromCart); return; }
      renderProductsTable(); renderPosProducts(); renderCart(); updateInventoryBadge();
    });
}

function openQuickProductModal(prefillBarcode = '') {
  $('qpName').value = ''; $('qpPrice').value = ''; $('qpQty').value = '1'; $('qpBarcode').value = prefillBarcode || '';
  if ($('qpCost')) $('qpCost').value = '';
  openModal('quickProductModal');
}
function saveQuickProduct() {
  const name = $('qpName').value.trim();
  let price = toNum($('qpPrice').value);
  const qty = Math.max(1, parseInt($('qpQty').value, 10) || 1);
  const barcode = $('qpBarcode').value.trim();
  const costRaw = $('qpCost') ? $('qpCost').value.trim() : '';
  const unitCost = costRaw === '' ? null : toNum(costRaw);
  if (!name) return warn('خطأ', 'أدخل اسم المنتج');
  if (!(price > 0)) return warn('خطأ', 'أدخل سعراً صحيحاً');
  if (state.displayCurrency === 'USD') price = price * state.exchangeRate;
  const item = { isQuickOnly: true, quickId: 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5), name, price, qty, barcode };
  if (unitCost != null) item.cost = unitCost;
  state.cart.push(item);
  closeModal('quickProductModal'); renderCart(); toast(`تمت إضافة ${qty} × ${name}`);
}

function openClientModal(clientId = null) {
  $('clientEditId').value = clientId || '';
  if (clientId) {
    const c = state.clients.find(x => x.id === clientId); if (!c) return;
    $('clientModalTitle').textContent = 'تعديل بيانات الزبون';
    $('clientNameInput').value = c.name || '';
    $('clientPhoneInput').value = c.phone || '';
    $('clientAddressInput').value = c.address || '';
    $('clientOpeningInput').value = toNum(c.openingDebt);
    document.querySelectorAll('input[name="clientTypeRadio"]').forEach(r => { r.checked = r.value === (c.type || 'retail'); });
  } else {
    $('clientModalTitle').textContent = 'إضافة زبون جديد';
    $('clientNameInput').value = ''; $('clientPhoneInput').value = ''; $('clientAddressInput').value = ''; $('clientOpeningInput').value = '0';
    document.querySelectorAll('input[name="clientTypeRadio"]').forEach(r => { r.checked = r.value === 'retail'; });
  }
  openModal('clientModal');
}
async function saveClient() {
  const editId = $('clientEditId').value;
  const name = $('clientNameInput').value.trim();
  const phone = $('clientPhoneInput').value.trim() || '-';
  const address = $('clientAddressInput').value.trim() || '-';
  let openingDebt = toNum($('clientOpeningInput').value);
  const checkedRadio = document.querySelector('input[name="clientTypeRadio"]:checked');
  const type = checkedRadio ? checkedRadio.value : 'retail';
  if (!name) return warn('خطأ', 'أدخل اسم الزبون');
  if (state.displayCurrency === 'USD') openingDebt = openingDebt * state.exchangeRate;
  let previous = null;
  if (editId) {
    const c = state.clients.find(x => x.id === editId); if (!c) return;
    previous = { ...c, customPrices: { ...(c.customPrices || {}) } };
    Object.assign(c, { name, type, phone, address, openingDebt });
    logAudit('تعديل زبون', `${name} (رصيد افتتاحي: ${fmtCur(openingDebt)})`);
  } else {
    state.clients.push({ id: 'c_' + Date.now(), name, type, phone, address, openingDebt, customPrices: {} });
    logAudit('إضافة زبون', name);
  }
  const ok = await saveToStorage();
  if (!ok) { if (editId && previous) { const c = state.clients.find(x => x.id === editId); if (c) Object.assign(c, previous); } else state.clients.pop(); return; }
  closeModal('clientModal'); renderClientsGrid(); populatePosClients();
  if (editId && state.currentLedgerClientId === editId) openClientDetailPage(editId);
  toast('تم حفظ بيانات الزبون');
}
function renderClientsGrid() {
  const grid = $('clientsGrid'); if (!grid) return;
  const q = normalizeArabic(($('clientSearch')?.value || '').trim());
  const list = filterDeleted('clients', state.clients).filter(c => !q || normalizeArabic(c.name).includes(q) || (c.phone || '').includes(q));
  grid.innerHTML = list.map(c => {
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
        <div><span class="text-[11px] text-slate-500 font-bold block">الدين</span><span class="text-sm font-extrabold ${debt > 0 ? 'text-rose-600' : 'text-emerald-700'}">${fmtCur(debt)}</span></div>
        <span class="text-ashour font-bold text-xs">فتح الملف <i class="fa-solid fa-arrow-left"></i></span>
      </div>
    </div>`;
  }).join('') || `<div class="col-span-full text-center py-10 text-slate-400 text-sm font-bold">لا يوجد زبائن</div>`;
}
function renderClientSpecialPrices(clientId) {
  const container = $('clientSpecialPricesList'); if (!container) return;
  const c = state.clients.find(x => x.id === clientId);
  if (!c || !c.customPrices) { container.innerHTML = `<span class="text-slate-400">لا توجد أسعار خاصة محددة لهذا الزبون.</span>`; return; }
  const entries = Object.entries(c.customPrices).filter(([_, price]) => toNum(price) > 0);
  if (!entries.length) { container.innerHTML = `<span class="text-slate-400">لا توجد أسعار خاصة (يعتمد على تسعيرة الجملة أو التجزئة).</span>`; return; }
  container.innerHTML = entries.map(([prodId, price]) => {
    const prod = state.products.find(p => p.id === prodId);
    const prodName = prod ? prod.name : `منتج #${prodId}`;
    return `<div class="bg-purple-50 border border-purple-200 text-purple-900 rounded-xl px-3 py-1.5 flex items-center gap-2">
      <span>${esc(prodName)}: <b class="text-purple-700">${fmtCur(price)}</b></span>
      <button type="button" onclick="removeClientSpecialPrice('${esc(clientId)}', '${esc(prodId)}')" class="text-rose-500 hover:text-rose-700 text-xs"><i class="fa-solid fa-xmark"></i></button>
    </div>`;
  }).join('');
}
async function removeClientSpecialPrice(clientId, prodId) {
  const ok = await setClientSpecialPrice(clientId, prodId, 0);
  if (ok) { renderClientSpecialPrices(clientId); if (getSelectedPosClient().id === clientId) { renderPosProducts(); renderCart(); } renderClientsGrid(); toast('تمت إزالة السعر الخاص'); }
}
function openClientDetailPage(clientId) {
  state.currentLedgerClientId = clientId;
  const c = state.clients.find(x => x.id === clientId); if (!c) return;
  $('ledgerClientName').textContent = c.name;
  $('ledgerClientBadge').textContent = c.type === 'wholesale' ? 'موزع جملة' : 'زبون تجزئة';
  $('ledgerClientBadge').className = `text-xs font-bold px-2 py-0.5 rounded-full ${c.type === 'wholesale' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`;
  switchTab('client-detail'); renderClientSpecialPrices(clientId); renderLedgerSummary(clientId); switchLedgerSubTab('statement');
}
function renderLedgerSummary(clientId) {
  const c = state.clients.find(x => x.id === clientId); if (!c) return;
  const activeInvs = state.invoices.filter(i => i.clientId === clientId && i.status === 'active');
  const totalPurchases = sumList(activeInvs, i => i.total);
  const totalPaid = sumList(activeInvs, i => i.paid) + sumList(state.payments.filter(p => p.clientId === clientId), p => p.amount);
  const totalReturns = sumList(state.returns.filter(r => r.clientId === clientId), r => r.amount);
  const currentDebt = getClientDebt(clientId);
  $('ledgerSummaryCards').innerHTML = `
    <div class="bg-white border border-slate-200 rounded-xl p-3 shadow-sm"><span class="block text-xs text-slate-500">المشتريات</span><span class="text-sm font-extrabold text-slate-800">${fmtCur(totalPurchases)}</span></div>
    <div class="bg-white border border-slate-200 rounded-xl p-3 shadow-sm"><span class="block text-xs text-emerald-700">المدفوع</span><span class="text-sm font-extrabold text-emerald-700">${fmtCur(totalPaid)}</span></div>
    <div class="bg-white border border-slate-200 rounded-xl p-3 shadow-sm"><span class="block text-xs text-amber-700">المرتجعات</span><span class="text-sm font-extrabold text-amber-700">${fmtCur(totalReturns)}</span></div>
    <div class="bg-white border border-rose-200 rounded-xl p-3 shadow-sm"><span class="block text-xs text-rose-600">الدين الحالي</span><span class="text-sm font-extrabold text-rose-600">${fmtCur(currentDebt)}</span></div>`;
  const rows = [];
  if (toNum(c.openingDebt) > 0) rows.push({ id: 'op', type: 'opening', ts: 0, label: 'رصيد افتتاحي', debit: toNum(c.openingDebt), credit: 0 });
  activeInvs.forEach(i => rows.push({ id: i.id, type: 'invoice', ts: i.ts, label: `فاتورة ${i.id} — [${i.items.map(it => `${it.qty} × ${it.name} (${fmt(it.price)})`).join(' ، ')}]`, debit: i.total, credit: i.paid }));
  state.payments.filter(p => p.clientId === clientId).forEach(p => rows.push({ id: p.id, type: 'payment', ts: p.ts, label: p.amount < 0 ? `استرداد (${p.note || 'إلغاء'})` : 'تسديد دفعة', debit: 0, credit: p.amount }));
  state.returns.filter(r => r.clientId === clientId).forEach(r => rows.push({ id: r.id, type: 'return', ts: r.ts, label: `مرتجع: ${r.qty} × ${r.productName} بسعر ${fmtCur(r.unitPrice)}`, debit: 0, credit: r.amount }));
  rows.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  $('ledgerTableBody').innerHTML = rows.map(r => `
    <tr class="border-b border-slate-100 hover:bg-slate-50">
      <td class="p-3 text-slate-500 whitespace-nowrap">${r.ts ? new Date(r.ts).toLocaleString('ar-SY') : '—'}</td>
      <td class="p-3 text-slate-800">${esc(r.label)}</td>
      <td class="p-3 text-rose-600 whitespace-nowrap">${r.debit ? fmtCur(r.debit) : '—'}</td>
      <td class="p-3 text-emerald-700 whitespace-nowrap">${r.credit ? fmtCur(r.credit) : '—'}</td>
      <td class="p-3 text-center whitespace-nowrap">
        ${r.type === 'invoice' ? `<button type="button" onclick="viewPastInvoice('${esc(r.id)}')" class="bg-ashour text-white hover:bg-ashour-dark px-2 py-1 rounded text-xs font-bold"><i class="fa-solid fa-receipt"></i></button>` : ''}
        ${r.type === 'payment' ? `<button type="button" onclick="deletePayment('${r.id}')" class="text-rose-500 hover:text-rose-700 font-bold text-xs"><i class="fa-solid fa-trash"></i></button>` : ''}
        ${r.type !== 'invoice' && r.type !== 'payment' ? '—' : ''}
      </td>
    </tr>`).join('') || `<tr><td colspan="5" class="p-4 text-center text-slate-400">لا توجد معاملات</td></tr>`;
}
function shareClientStatementWhatsApp() {
  const clientId = state.currentLedgerClientId;
  const c = state.clients.find(x => x.id === clientId); if (!c) return;
  const debt = getClientDebt(clientId);
  const txt = `كشف حساب — ${state.storeInfo.name}\nالزبون: ${c.name}\nالدين الحالي: ${fmtCur(debt)}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(txt)}`, '_blank');
}
function switchLedgerSubTab(sub) {
  const isRet = sub === 'returns';
  $('ledgerStatementPanel').classList.toggle('hidden', isRet);
  $('ledgerReturnsPanel').classList.toggle('hidden', !isRet);
  $('ledgerTabStatementBtn').className = isRet ? 'px-4 py-2 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200' : 'px-4 py-2 rounded-xl bg-ashour text-white';
  $('ledgerTabReturnsBtn').className = isRet ? 'px-4 py-2 rounded-xl bg-amber-600 text-white' : 'px-4 py-2 rounded-xl bg-amber-100 text-amber-900 hover:bg-amber-200';
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
    if (ret.returnKey && map.has(ret.returnKey)) { map.get(ret.returnKey).returnedQty = roundMoney(map.get(ret.returnKey).returnedQty + toNum(ret.qty)); return; }
    for (const item of map.values()) { if (normalizeArabic(item.name) === normalizeArabic(ret.productName) && toNum(item.price) === toNum(ret.unitPrice)) { item.returnedQty = roundMoney(item.returnedQty + toNum(ret.qty)); break; } }
  });
  return [...map.values()].map(x => ({ ...x, remainingQty: Math.max(0, roundMoney(x.boughtQty - x.returnedQty)) }));
}
function renderClientReturnsTab(clientId) {
  const list = getClientReturnableSummary(clientId);
  const container = $('clientReturnableItemsList');
  if (!list.length) container.innerHTML = `<div class="text-center py-6 text-slate-400 text-sm font-bold bg-slate-50 rounded-xl border border-dashed">لا توجد أصناف مسجلة في فواتير هذا الزبون</div>`;
  else {
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
            <button type="button" onclick="adjustReturnQty('${esc(item.key)}', -1)" ${item.remainingQty <= 0 ? 'disabled' : ''} class="w-7 h-7 flex items-center justify-center bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 rounded font-bold">−</button>
            <input type="number" id="returnQty_${esc(item.key)}" min="1" max="${item.remainingQty}" value="${item.remainingQty > 0 ? 1 : 0}" ${item.remainingQty <= 0 ? 'disabled' : ''} class="w-10 text-center border-none focus:outline-none text-sm font-bold bg-transparent num-tabular">
            <button type="button" onclick="adjustReturnQty('${esc(item.key)}', 1)" ${item.remainingQty <= 0 ? 'disabled' : ''} class="w-7 h-7 flex items-center justify-center bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 rounded font-bold">+</button>
          </div>
          <button type="button" onclick="submitClientReturn('${esc(clientId)}', '${esc(item.name)}', ${item.price}, ${item.cost}, '${esc(item.key)}', '${esc(item.productId || '')}')" ${item.remainingQty <= 0 ? 'disabled' : ''} class="bg-ashour hover:bg-ashour-dark disabled:opacity-40 text-white px-3 py-1.5 rounded-md text-xs font-bold">تأكيد الإرجاع</button>
        </div>
      </div>`).join('');
  }
  const rets = state.returns.filter(r => r.clientId === clientId).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  $('clientReturnsHistoryList').innerHTML = rets.length
    ? rets.map(r => `<div class="flex justify-between items-center border-b border-slate-200 py-1"><span>${esc(r.date)} — ${fmt(r.qty)} × ${esc(r.productName)} (${fmtCur(r.unitPrice)})</span><span class="text-emerald-700 font-bold">خصم ${fmtCur(r.amount)}</span></div>`).join('')
    : `<div class="text-slate-400 text-sm">لا توجد مرتجعات.</div>`;
}
function adjustReturnQty(key, delta) {
  const input = $('returnQty_' + key); if (!input || input.disabled) return;
  let val = parseInt(input.value, 10) || 1; val += delta;
  const max = parseInt(input.max, 10) || 1;
  if (val > max) val = max; if (val < 1) val = 1;
  input.value = val;
}
async function submitClientReturn(clientId, productName, unitPrice, unitCost, key, productId) {
  const input = $('returnQty_' + key); const qty = parseInt(input.value, 10);
  if (!qty || qty <= 0) return warn('خطأ', 'أدخل كمية صحيحة');
  const max = parseInt(input.max, 10);
  if (qty > max) return warn('خطأ', 'الكمية تتجاوز المتاح للإرجاع');
  const client = state.clients.find(c => c.id === clientId);
  const amount = calcLineTotal(unitPrice, qty);
  const profitAdjustment = roundMoney((toNum(unitPrice) - toNum(unitCost)) * qty);
  const newReturn = { id: 'RET-' + Date.now(), ts: Date.now(), date: nowStr(), clientId, clientName: client.name, productName, qty, unitPrice, unitCost: toNum(unitCost), amount, profitAdjustment, returnKey: key, productId: productId || '' };
  state.returns.push(newReturn);
  const stockSnapshots = [];
  if (productId) {
    const p = state.products.find(x => x.id === productId);
    if (p && p.trackStock) {
      const before = toNum(p.stock);
      stockSnapshots.push({ productId: p.id, before });
      p.stock = roundMoney(before + qty);
      addStockMovement(p.id, 'return', qty, before, p.stock, `مرتجع من ${client.name}`, newReturn.id);
    }
  }
  logAudit('مرتجع', `إرجاع ${qty} × ${productName} بسعر ${fmtCur(unitPrice)} لـ ${client.name}`);
  const ok = await saveToStorage();
  if (!ok) {
    state.returns.pop();
    stockSnapshots.forEach(s => { const p = state.products.find(x => x.id === s.productId); if (p) p.stock = s.before; });
    state.stockMovements = state.stockMovements.filter(m => m.refId !== newReturn.id);
    return;
  }
  renderLedgerSummary(clientId); renderClientReturnsTab(clientId); updateInventoryBadge();
  toast(`تم إرجاع ${qty} ${productName} وخصم ${fmtCur(amount)}`);
}
async function recordDebtPayment() {
  const clientId = state.currentLedgerClientId;
  const c = state.clients.find(x => x.id === clientId); if (!c) return;
  let amount = toNum($('payDebtAmount').value);
  if (amount <= 0) return warn('تنبيه', 'أدخل مبلغاً صحيحاً');
  if (state.displayCurrency === 'USD') amount = amount * state.exchangeRate;
  const newPay = { id: 'PAY-' + Date.now(), ts: Date.now(), date: nowStr(), clientId, amount, note: '' };
  state.payments.push(newPay);
  logAudit('تسديد دين زبون', `${c.name}: ${fmtCur(amount)}`);
  const ok = await saveToStorage();
  if (!ok) { state.payments.pop(); return; }
  $('payDebtAmount').value = ''; renderLedgerSummary(clientId); switchLedgerSubTab('statement'); toast('تم تسجيل الدفعة');
}
function deletePayment(payId) {
  Swal.fire({ title: 'حذف الدفعة؟', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6', confirmButtonText: 'نعم', cancelButtonText: 'إلغاء' })
    .then(async res => {
      if (!res.isConfirmed) return;
      const removed = state.payments.find(p => p.id === payId);
      state.payments = state.payments.filter(p => p.id !== payId);
      if (removed) { addTombstone('payments', removed.id); addToTrash('payments', removed); }
      logAudit('حذف دفعة زبون', removed ? `${fmtCur(removed.amount)}` : payId);
      const ok = await saveToStorage();
      if (!ok) { if (removed) state.payments.push(removed); return; }
      renderLedgerSummary(state.currentLedgerClientId); switchLedgerSubTab('statement'); toast('تم الحذف');
    });
}

function getCompanyDebt(companyId) {
  const purchasesRemaining = sumList(state.purchases.filter(p => p.companyId === companyId && p.status === 'active'), p => p.remaining);
  const paymentsMade = sumList(state.companyPayments.filter(p => p.companyId === companyId), p => p.amount);
  return Math.max(0, roundMoney(purchasesRemaining - paymentsMade));
}
function renderCompaniesGrid() {
  const grid = $('companiesGrid'); if (!grid) return;
  const q = normalizeArabic(($('companySearch')?.value || '').trim());
  const list = filterDeleted('companies', state.companies).filter(comp => !q || normalizeArabic(comp.name).includes(q) || (comp.phone || '').includes(q));
  grid.innerHTML = list.map(comp => {
    const debt = getCompanyDebt(comp.id);
    return `<div onclick="openCompanyDetailPage('${esc(comp.id)}')" class="bg-white border border-slate-200 hover:border-ashour rounded-2xl p-4 shadow-sm space-y-3 cursor-pointer card-hover">
      <div>
        <h4 class="font-bold text-base text-slate-900 flex items-center gap-2"><i class="fa-solid fa-building text-ashour"></i> ${esc(comp.name)}</h4>
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
  const comp = state.companies.find(c => c.id === compId); if (!comp) return;
  $('companyDetailName').textContent = comp.name;
  $('companyDetailInfo').textContent = `هاتف: ${comp.phone || '-'} • عنوان: ${comp.address || '-'}`;
  $('compDetailDistributor').textContent = comp.distributorName || '-';
  $('compDetailCycle').textContent = comp.cycle || '-';
  $('compDetailDebt').textContent = fmtCur(getCompanyDebt(compId));
  renderCompanyProductsGrid(compId); switchTab('company-detail');
}
function renderCompanyProductsGrid(compId) {
  const comp = state.companies.find(c => c.id === compId); if (!comp) return;
  const prods = Array.isArray(comp.products) ? comp.products : [];
  $('companyProductsGrid').innerHTML = prods.map((pr, idx) => `
    <div class="border border-slate-200 rounded-2xl p-3 bg-slate-50/70 flex items-start justify-between gap-2">
      <div>
        <div class="font-bold text-sm text-slate-800 mb-1">${esc(pr.name)}</div>
        <div class="text-xs text-slate-600 font-semibold">سعر المستهلك: <span class="text-emerald-700 font-bold">${fmtCur(pr.consumerPrice)}</span></div>
        <div class="text-xs text-slate-600 font-semibold">الطرد: ${fmt(pr.piecesPerBox || 1)} علبة × ${fmtCur(pr.boxPrice || 0)}</div>
        <div class="text-xs text-slate-600 font-semibold">العلبة (شراء): <span class="font-bold">${fmtCur(pr.piecePrice || 0)}</span></div>
      </div>
      <button type="button" onclick="openCompanyProductEditModal(${idx})" class="bg-white border border-slate-300 text-indigo-600 hover:bg-indigo-50 w-8 h-8 rounded-lg flex items-center justify-center"><i class="fa-solid fa-pen"></i></button>
    </div>`).join('') || `<div class="col-span-full text-center py-6 text-slate-400 text-sm font-bold">لا توجد منتجات مسجلة لهذه الشركة</div>`;
}
function openCompanyProductEditModal(idx) {
  const comp = state.companies.find(c => c.id === state.activeCompanyId);
  if (!comp || !comp.products[idx]) return;
  const pr = comp.products[idx];
  $('cpEditIdx').value = idx;
  $('cpNameInput').value = pr.name || '';
  $('cpBoxPriceInput').value = pr.boxPrice || '';
  $('cpPiecesPerBoxInput').value = pr.piecesPerBox || 1;
  $('cpPiecePriceInput').value = pr.piecePrice || '';
  $('cpConsumerPriceInput').value = pr.consumerPrice || '';
  openModal('companyProductModal');
}
async function saveCompanyProductEdit() {
  const comp = state.companies.find(c => c.id === state.activeCompanyId); if (!comp) return;
  const idx = parseInt($('cpEditIdx').value, 10);
  const pr = comp.products[idx]; if (!pr) return;
  const oldData = { ...pr };
  pr.name = $('cpNameInput').value.trim();
  let boxPrice = toNum($('cpBoxPriceInput').value);
  pr.piecesPerBox = Math.max(1, toNum($('cpPiecesPerBoxInput').value) || 1);
  let enteredPiece = toNum($('cpPiecePriceInput').value);
  let consumerPrice = toNum($('cpConsumerPriceInput').value);
  if (state.displayCurrency === 'USD') { boxPrice = boxPrice * state.exchangeRate; enteredPiece = enteredPiece * state.exchangeRate; consumerPrice = consumerPrice * state.exchangeRate; }
  pr.boxPrice = boxPrice;
  pr.piecePrice = enteredPiece > 0 ? enteredPiece : (pr.boxPrice > 0 ? roundMoney(pr.boxPrice / pr.piecesPerBox) : 0);
  pr.consumerPrice = consumerPrice;
  if (!pr.name) return warn('خطأ', 'أدخل اسم المنتج');
  const ok = await saveToStorage();
  if (!ok) { Object.assign(pr, oldData); return; }
  closeModal('companyProductModal'); renderCompanyProductsGrid(state.activeCompanyId); toast('تم تعديل المنتج بنجاح');
}
async function addProductDirectlyToCompany() {
  const comp = state.companies.find(c => c.id === state.activeCompanyId); if (!comp) return;
  const { value: formValues } = await Swal.fire({
    title: 'إضافة منتج للشركة', html: `<input id="swal-p-name" class="swal2-input" placeholder="اسم المنتج">`,
    showCancelButton: true, confirmButtonColor: '#0F5C4E', confirmButtonText: 'إضافة', cancelButtonText: 'إلغاء',
    preConfirm: () => { const name = document.getElementById('swal-p-name').value.trim(); if (!name) { Swal.showValidationMessage('أدخل اسم المنتج'); return false; } return { name }; }
  });
  if (!formValues) return;
  if (!Array.isArray(comp.products)) comp.products = [];
  comp.products.push({ id: 'cp_' + Date.now(), name: formValues.name, boxPrice: 0, piecesPerBox: 1, piecePrice: 0, consumerPrice: 0 });
  const ok = await saveToStorage();
  if (!ok) { comp.products.pop(); return; }
  renderCompanyProductsGrid(state.activeCompanyId); toast('تمت الإضافة');
}
function openCompanyModal(id = null) {
  $('compEditId').value = id || '';
  if (id) {
    const comp = state.companies.find(x => x.id === id); if (!comp) return;
    $('compNameInput').value = comp.name || ''; $('compPhoneInput').value = comp.phone || '';
    $('compAddressInput').value = comp.address || ''; $('compDistributorInput').value = comp.distributorName || '';
    $('compCycleInput').value = comp.cycle || '';
  } else {
    $('compNameInput').value = ''; $('compPhoneInput').value = ''; $('compAddressInput').value = ''; $('compDistributorInput').value = ''; $('compCycleInput').value = '';
  }
  openModal('companyModal');
}
async function saveCompany() {
  const id = $('compEditId').value;
  const name = $('compNameInput').value.trim();
  const phone = $('compPhoneInput').value.trim() || '-';
  const address = $('compAddressInput').value.trim() || '-';
  const distributorName = $('compDistributorInput').value.trim() || '-';
  const cycle = $('compCycleInput').value.trim() || 'غير محدد';
  if (!name) return warn('خطأ', 'أدخل اسم الشركة');
  let previous = null;
  if (id) {
    const comp = state.companies.find(x => x.id === id); if (!comp) return;
    previous = { ...comp }; Object.assign(comp, { name, phone, address, distributorName, cycle });
    logAudit('تعديل شركة', name);
  } else {
    state.companies.push({ id: 'comp_' + Date.now(), name, phone, address, distributorName, cycle, products: [] });
    logAudit('إضافة شركة', name);
  }
  const ok = await saveToStorage();
  if (!ok) { if (id && previous) { const comp = state.companies.find(x => x.id === id); if (comp) Object.assign(comp, previous); } else state.companies.pop(); return; }
  closeModal('companyModal');
  if (id && state.activeCompanyId === id) openCompanyDetailPage(id); else renderCompaniesGrid();
  toast('تم الحفظ');
}

function generateSixDigitPurchaseCode() {
  const used = new Set(state.purchases.map(p => String(p.code || p.id || '').replace(/\D/g, '')));
  let code = '';
  for (let i = 0; i < 50; i++) { code = String(Math.floor(100000 + Math.random() * 900000)); if (!used.has(code)) return code; }
  return String(100000 + (state.purchases.length % 899999));
}
function populatePurchaseCompanySelect(selectedId = '') {
  const sel = $('purCompanySelect'); if (!sel) return;
  sel.innerHTML = `<option value="">-- اختر الشركة --</option>` + state.companies.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  if (selectedId) sel.value = selectedId;
  onPurchaseCompanyChange();
}
function onPurchaseCompanyChange() {
  const compId = $('purCompanySelect')?.value || '';
  const badge = $('purSelectedCompanyBadge'), infoEl = $('purCompanyDebtInfo');
  if (!compId) { if (badge) badge.innerHTML = `<i class="fa-solid fa-building"></i>`; if (infoEl) infoEl.classList.add('hidden'); return; }
  const comp = state.companies.find(c => c.id === compId);
  if (badge && comp) { const initial = comp.name.trim().charAt(0).toUpperCase() || 'ش'; badge.innerHTML = `<span class="font-bold text-sm">${esc(initial)}</span>`; }
  if (infoEl && comp) { const currentDebt = getCompanyDebt(comp.id); infoEl.textContent = `الشركة: ${comp.name} • الدين الحالي: ${fmtCur(currentDebt)}`; infoEl.classList.remove('hidden'); }
  updatePurchaseCalc();
}
async function quickAddCompanyForPurchase() {
  const { value: compName } = await Swal.fire({
    title: 'إضافة شركة جديدة', input: 'text', inputPlaceholder: 'أدخل اسم الشركة',
    showCancelButton: true, confirmButtonColor: '#0F5C4E', confirmButtonText: 'إضافة واختيار', cancelButtonText: 'إلغاء',
    inputValidator: v => !v || !v.trim() ? 'يرجى إدخال اسم الشركة' : null
  });
  if (!compName) return;
  const newComp = { id: 'comp_' + Date.now(), name: compName.trim(), phone: '-', address: '-', distributorName: '-', cycle: 'غير محدد', products: [] };
  state.companies.push(newComp); logAudit('إضافة شركة من المشتريات', newComp.name);
  const ok = await saveToStorage(); if (!ok) { state.companies.pop(); return; }
  renderCompaniesGrid(); populatePurchaseCompanySelect(newComp.id); toast(`تمت إضافة الشركة (${newComp.name})`);
}
function openPurchaseModal() {
  $('purPreviewCode').textContent = generateSixDigitPurchaseCode();
  populatePurchaseCompanySelect(state.activeCompanyId || '');
  $('purTotalAmount').value = ''; $('purPaidAmount').value = '';
  updatePurchaseCalc(); openModal('purchaseModal');
}
function updatePurchaseCalc() {
  let total = Math.max(0, toNum($('purTotalAmount')?.value));
  let paid = Math.max(0, toNum($('purPaidAmount')?.value));
  if (state.displayCurrency === 'USD') { total = total * state.exchangeRate; paid = paid * state.exchangeRate; }
  const remaining = roundMoney(Math.max(0, total - paid));
  const compId = $('purCompanySelect')?.value || '';
  const currentDebt = compId ? getCompanyDebt(compId) : 0;
  const afterDebt = roundMoney(currentDebt + remaining);
  const info = $('purDebtAfterInfo');
  if (info) info.textContent = `المتبقي (يُضاف إلى دين الشركة): ${fmtCur(remaining)} • دين الشركة بعد الفاتورة: ${fmtCur(afterDebt)}`;
}
async function savePurchase() {
  const companyId = $('purCompanySelect').value;
  let total = toNum($('purTotalAmount').value);
  const paidRaw = $('purPaidAmount').value.trim();
  let paid = paidRaw === '' ? 0 : Math.max(0, toNum(paidRaw));
  if (!companyId) return warn('خطأ', 'اختر الشركة أو أضف شركة جديدة');
  if (!(total > 0)) return warn('خطأ', 'أدخل سعر الفاتورة');
  if (state.displayCurrency === 'USD') { total = total * state.exchangeRate; paid = paid * state.exchangeRate; }
  const comp = state.companies.find(c => c.id === companyId);
  const code = $('purPreviewCode').textContent || generateSixDigitPurchaseCode();
  const remaining = roundMoney(Math.max(0, total - paid));
  const newPurchase = { id: code, code, ts: Date.now(), date: nowStr(), companyId, companyName: comp ? comp.name : 'شركة', total, paid, remaining, status: 'active' };
  state.purchases.push(newPurchase);
  logAudit('فاتورة شراء', `كود ${code} — ${comp ? comp.name : ''} بقيمة ${fmtCur(total)} (متبقي: ${fmtCur(remaining)})`);
  const ok = await saveToStorage();
  if (!ok) { state.purchases.pop(); return; }
  closeModal('purchaseModal'); renderPurchases(); renderCompaniesGrid();
  if (state.activeCompanyId === companyId) openCompanyDetailPage(companyId);
  toast('تم حفظ فاتورة الشراء');
}
function renderPurchases() {
  const body = $('purchasesTableBody'); if (!body) return;
  const selFilter = $('purchaseCompanyFilter');
  if (selFilter) {
    const prevVal = selFilter.value;
    selFilter.innerHTML = `<option value="">كل الشركات</option>` + state.companies.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    selFilter.value = prevVal;
  }
  const filterCompId = $('purchaseCompanyFilter')?.value || '';
  const fromDate = $('purchaseFromDate')?.value || '';
  const toDate = $('purchaseToDate')?.value || '';
  const list = [...state.purchases].filter(p => {
    if (p.status === 'cancelled') return false;
    if (filterCompId && p.companyId !== filterCompId) return false;
    if (fromDate || toDate) { if (!p.ts) return false; const k = dayKey(p.ts || 0); if (fromDate && k < fromDate) return false; if (toDate && k > toDate) return false; }
    return true;
  }).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const sumTotal = sumList(list, p => p.total);
  const sumPaid = sumList(list, p => p.paid);
  const sumRem = sumList(list, p => p.remaining);
  if ($('purchasesSummaryStrip')) {
    $('purchasesSummaryStrip').innerHTML = `
      <div class="bg-slate-50 border rounded-xl p-2.5"><span class="block text-xs text-slate-500">إجمالي المشتريات</span><span class="font-bold text-slate-800">${fmtCur(sumTotal)}</span></div>
      <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-2.5"><span class="block text-xs text-emerald-700">المدفوع</span><span class="font-bold text-emerald-800">${fmtCur(sumPaid)}</span></div>
      <div class="bg-rose-50 border border-rose-200 rounded-xl p-2.5"><span class="block text-xs text-rose-700">المتبقي (ديون الشركات)</span><span class="font-bold text-rose-700">${fmtCur(sumRem)}</span></div>`;
  }
  body.innerHTML = list.map(p => {
    const comp = state.companies.find(c => c.id === p.companyId) || { name: p.companyName || 'غير معروف' };
    return `<tr class="hover:bg-slate-50 border-b border-slate-100">
      <td class="p-3 font-bold text-ashour">${esc(p.code || p.id)}</td>
      <td class="p-3 text-slate-500 text-xs">${esc(p.date || '')}</td>
      <td class="p-3 font-bold text-slate-800">${esc(comp.name)}</td>
      <td class="p-3 font-bold">${fmtCur(p.total)}</td>
      <td class="p-3 text-emerald-700 font-bold">${fmtCur(p.paid)}</td>
      <td class="p-3 text-rose-600 font-bold">${fmtCur(p.remaining)}</td>
      <td class="p-3 text-center"><button type="button" onclick="deletePurchase('${esc(p.id)}')" class="bg-rose-100 text-rose-700 hover:bg-rose-600 hover:text-white px-2.5 py-1 rounded transition text-xs font-bold"><i class="fa-solid fa-trash"></i></button></td>
    </tr>`;
  }).join('') || `<tr><td colspan="7" class="p-6 text-center text-slate-400 text-sm">لا توجد فواتير شراء</td></tr>`;
}
function deletePurchase(id) {
  Swal.fire({ title: 'حذف فاتورة الشراء؟', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6', confirmButtonText: 'نعم', cancelButtonText: 'إلغاء' })
    .then(async res => {
      if (!res.isConfirmed) return;
      const idx = state.purchases.findIndex(p => p.id === id); if (idx === -1) return;
      const removed = state.purchases[idx];
      state.purchases.splice(idx, 1); addTombstone('purchases', removed.id); addToTrash('purchases', removed);
      logAudit('حذف فاتورة شراء', removed.code || id);
      const ok = await saveToStorage(); if (!ok) { state.purchases.splice(idx, 0, removed); return; }
      renderPurchases(); renderCompaniesGrid();
      if (state.activeCompanyId === removed.companyId) openCompanyDetailPage(removed.companyId);
      toast('تم حذف فاتورة الشراء');
    });
}
function openCompanyPaymentModal() { $('payCompanyAmount').value = ''; $('payCompanyNotes').value = ''; openModal('companyPaymentModal'); }
async function recordCompanyPayment() {
  const compId = state.activeCompanyId; const comp = state.companies.find(c => c.id === compId); if (!comp) return;
  let amount = toNum($('payCompanyAmount').value); const notes = $('payCompanyNotes').value.trim();
  if (amount <= 0) return warn('تنبيه', 'أدخل مبلغاً صحيحاً');
  if (state.displayCurrency === 'USD') amount = amount * state.exchangeRate;
  const newPay = { id: 'CPAY-' + Date.now(), ts: Date.now(), date: nowStr(), companyId: compId, amount, notes };
  state.companyPayments.push(newPay); logAudit('تسديد دين شركة', `${comp.name}: ${fmtCur(amount)}`);
  const ok = await saveToStorage(); if (!ok) { state.companyPayments.pop(); return; }
  closeModal('companyPaymentModal'); openCompanyDetailPage(compId); renderCompaniesGrid(); renderPurchases(); toast('تم تسجيل الدفعة');
}

function switchDebtTab(tab) {
  currentDebtTab = tab === 'give' ? 'give' : 'take';
  const isTake = currentDebtTab === 'take';
  $('debtTabTake').className = isTake ? 'px-5 py-2 rounded-xl text-xs font-bold bg-ashour text-white' : 'px-5 py-2 rounded-xl text-xs font-bold bg-slate-100 text-slate-700 hover:bg-slate-200';
  $('debtTabGive').className = !isTake ? 'px-5 py-2 rounded-xl text-xs font-bold bg-rose-600 text-white' : 'px-5 py-2 rounded-xl text-xs font-bold bg-slate-100 text-slate-700 hover:bg-slate-200';
  $('debtSummaryTake').classList.toggle('hidden', !isTake);
  $('debtSummaryGive').classList.toggle('hidden', isTake);
  $('debtAddBtnLabel').textContent = isTake ? 'لي' : 'له';
  $('debtTableHead').innerHTML = isTake
    ? `<tr><th class="p-3">الاسم</th><th class="p-3">الهاتف</th><th class="p-3">المبلغ (لي)</th><th class="p-3">ملاحظات</th><th class="p-3 text-center">إجراءات</th></tr>`
    : `<tr><th class="p-3">الاسم</th><th class="p-3">الهاتف</th><th class="p-3">المبلغ (له)</th><th class="p-3">ملاحظات</th><th class="p-3 text-center">إجراءات</th></tr>`;
  renderPersonDebts();
}
function renderPersonDebts() {
  const body = $('personDebtsTableBody'); if (!body) return;
  const list = filterDeleted('personDebts', state.personDebts || []);
  const takeList = list.filter(d => d.type === 'take');
  const giveList = list.filter(d => d.type === 'give');
  if ($('debtSumTake')) $('debtSumTake').textContent = fmtCur(sumList(takeList, d => d.amount));
  if ($('debtSumGive')) $('debtSumGive').textContent = fmtCur(sumList(giveList, d => d.amount));
  const activeList = currentDebtTab === 'take' ? takeList : giveList;
  body.innerHTML = activeList.map(d => `
    <tr class="hover:bg-slate-50 border-b border-slate-100">
      <td class="p-3 font-bold text-slate-800">${esc(d.name)}</td>
      <td class="p-3 text-slate-500 text-xs">${esc(d.phone || '-')}</td>
      <td class="p-3 font-bold ${d.type === 'take' ? 'text-emerald-700' : 'text-rose-600'}">${fmtCur(d.amount)}</td>
      <td class="p-3 text-slate-600 text-xs">${esc(d.notes || '-')}</td>
      <td class="p-3 text-center"><div class="flex justify-center gap-1">
        <button type="button" onclick="settlePersonDebt('${esc(d.id)}')" class="bg-emerald-100 text-emerald-700 hover:bg-emerald-600 hover:text-white px-2.5 py-1 rounded transition text-xs font-bold"><i class="fa-solid fa-check"></i> تسوية</button>
        <button type="button" onclick="deletePersonDebt('${esc(d.id)}')" class="bg-rose-100 text-rose-700 hover:bg-rose-600 hover:text-white px-2.5 py-1 rounded transition text-xs font-bold"><i class="fa-solid fa-trash"></i></button>
      </div></td>
    </tr>`).join('') || `<tr><td colspan="5" class="p-6 text-center text-slate-400 text-sm">لا توجد ديون مسجلة في هذا القسم</td></tr>`;
}
function openPersonDebtModal() {
  $('debtPersonName').value = ''; $('debtPersonPhone').value = ''; $('debtPersonAmount').value = ''; $('debtPersonNotes').value = '';
  document.querySelectorAll('input[name="debtTypeRadio"]').forEach(r => { r.checked = r.value === currentDebtTab; });
  openModal('personDebtModal');
}
async function savePersonDebt() {
  const name = $('debtPersonName').value.trim(); const phone = $('debtPersonPhone').value.trim() || '-';
  let amount = toNum($('debtPersonAmount').value); const notes = $('debtPersonNotes').value.trim();
  const checked = document.querySelector('input[name="debtTypeRadio"]:checked'); const type = checked ? checked.value : currentDebtTab;
  if (!name) return warn('خطأ', 'أدخل اسم الشخص');
  if (!(amount > 0)) return warn('خطأ', 'أدخل مبلغاً صحيحاً');
  if (state.displayCurrency === 'USD') amount = amount * state.exchangeRate;
  const newDebt = { id: 'PD-' + Date.now(), ts: Date.now(), date: nowStr(), name, phone, type, amount, notes };
  state.personDebts.push(newDebt); logAudit('إضافة دين شخصي', `${type === 'take' ? 'لي' : 'له'} — ${name}: ${fmtCur(amount)}`);
  const ok = await saveToStorage(); if (!ok) { state.personDebts.pop(); return; }
  closeModal('personDebtModal'); switchDebtTab(type); toast('تم حفظ الدين');
}
function settlePersonDebt(id) {
  const d = state.personDebts.find(x => x.id === id); if (!d) return;
  Swal.fire({ title: `تسوية دين (${d.name})؟`, text: `المبلغ: ${fmtCur(d.amount)}`, icon: 'question', showCancelButton: true, confirmButtonColor: '#0F5C4E', cancelButtonColor: '#64748b', confirmButtonText: 'نعم، تسوية', cancelButtonText: 'إلغاء' })
    .then(async res => {
      if (!res.isConfirmed) return;
      const idx = state.personDebts.findIndex(x => x.id === id);
      const removed = state.personDebts[idx]; state.personDebts.splice(idx, 1); addTombstone('personDebts', removed.id); addToTrash('personDebts', removed);
      logAudit('تسوية دين شخصي', `${d.name}: ${fmtCur(d.amount)}`);
      const ok = await saveToStorage(); if (!ok) { state.personDebts.splice(idx, 0, removed); return; }
      renderPersonDebts(); toast('تمت تسوية الدين');
    });
}
function deletePersonDebt(id) {
  Swal.fire({ title: 'حذف هذا الدين؟', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6', confirmButtonText: 'نعم', cancelButtonText: 'إلغاء' })
    .then(async res => {
      if (!res.isConfirmed) return;
      const idx = state.personDebts.findIndex(x => x.id === id); if (idx === -1) return;
      const removed = state.personDebts[idx]; state.personDebts.splice(idx, 1); addTombstone('personDebts', removed.id); addToTrash('personDebts', removed);
      logAudit('حذف دين شخصي', removed.name || id);
      const ok = await saveToStorage(); if (!ok) { state.personDebts.splice(idx, 0, removed); return; }
      renderPersonDebts(); toast('تم الحذف');
    });
}

function openExpenseModal() { $('expTitle').value = ''; $('expAmount').value = ''; $('expNotes').value = ''; openModal('expenseModal'); }
async function saveExpense() {
  const title = $('expTitle').value.trim(); let amount = toNum($('expAmount').value); const notes = $('expNotes').value.trim();
  if (!title) return warn('خطأ', 'أدخل بند المصروف');
  if (amount <= 0) return warn('خطأ', 'أدخل مبلغاً صحيحاً');
  if (state.displayCurrency === 'USD') amount = amount * state.exchangeRate;
  const newExp = { id: 'EXP-' + Date.now(), ts: Date.now(), date: nowStr(), title, amount, notes };
  state.expenses.push(newExp); logAudit('إضافة مصروف', `${title}: ${fmtCur(amount)}`);
  const ok = await saveToStorage(); if (!ok) { state.expenses.pop(); return; }
  closeModal('expenseModal'); renderExpensesTable(); toast('تم تسجيل المصروف');
}
function renderExpensesTable() {
  const body = $('expensesTableBody'); if (!body) return;
  const list = filterDeleted('expenses', state.expenses).slice().reverse();
  body.innerHTML = list.map(e => `<tr class="hover:bg-slate-50 border-b border-slate-100"><td class="p-3 text-slate-500 text-xs">${esc(e.date)}</td><td class="p-3 font-bold">${esc(e.title)}</td><td class="p-3 text-rose-600 font-bold">${fmtCur(e.amount)}</td><td class="p-3 text-slate-500 text-xs">${esc(e.notes || '-')}</td><td class="p-3 text-center"><button type="button" onclick="deleteExpense('${e.id}')" class="bg-rose-100 text-rose-700 hover:bg-rose-600 hover:text-white px-2.5 py-1 rounded transition text-xs font-bold"><i class="fa-solid fa-trash"></i></button></td></tr>`).join('') || `<tr><td colspan="5" class="p-6 text-center text-slate-400 text-sm">لا توجد مصاريف</td></tr>`;
}
function deleteExpense(id) {
  Swal.fire({ title: 'حذف المصروف؟', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6', confirmButtonText: 'نعم', cancelButtonText: 'إلغاء' })
    .then(async res => {
      if (!res.isConfirmed) return;
      const idx = state.expenses.findIndex(e => e.id === id); if (idx === -1) return;
      const removed = state.expenses[idx]; state.expenses.splice(idx, 1); addTombstone('expenses', removed.id); addToTrash('expenses', removed);
      logAudit('حذف مصروف', `${removed.title} (${fmtCur(removed.amount)})`);
      const ok = await saveToStorage(); if (!ok) { state.expenses.splice(idx, 0, removed); return; }
      renderExpensesTable();
    });
}

function renderInvoicesTable() {
  const body = $('invoicesTableBody'); if (!body) return;
  const q = normalizeArabic(($('invoiceSearchInput')?.value || '').trim());
  const statusFilter = $('invoiceStatusFilter')?.value || 'all';
  const fromDate = $('invoiceFromDate')?.value || '';
  const toDate = $('invoiceToDate')?.value || '';
  const combined = [
    ...state.invoices.map(i => ({ kind: 'invoice', id: i.id, ts: i.ts || 0, date: i.date || '', clientName: i.clientName || '', total: toNum(i.total), paid: toNum(i.paid), remaining: toNum(i.remaining), profit: i.status === 'active' ? toNum(i.profit) : 0, status: i.status, raw: i })),
    ...state.directSales.map(ds => ({ kind: 'direct', id: ds.id, ts: ds.ts || 0, date: ds.date || '', clientName: `بيع سريع: ${ds.name} (${ds.qty})`, total: toNum(ds.total), paid: toNum(ds.paid != null ? ds.paid : ds.total), remaining: toNum(ds.remaining || 0), profit: toNum(ds.profit || 0), status: 'active', raw: ds }))
  ];
  const filtered = combined.filter(row => {
    if (fromDate || toDate) { if (!row.ts) return false; const k = dayKey(row.ts); if (fromDate && k < fromDate) return false; if (toDate && k > toDate) return false; }
    if (statusFilter === 'cancelled' && row.status !== 'cancelled') return false;
    if (statusFilter === 'cash' && (row.status === 'cancelled' || row.remaining > 0)) return false;
    if (statusFilter === 'partial' && (row.status === 'cancelled' || !(row.remaining > 0 && row.paid > 0))) return false;
    if (statusFilter === 'debt' && (row.status === 'cancelled' || !(row.remaining > 0 && row.paid === 0))) return false;
    if (q) { const matchId = normalizeArabic(row.id).includes(q); const matchClient = normalizeArabic(row.clientName).includes(q); if (!matchId && !matchClient) return false; }
    return true;
  }).sort((a, b) => b.ts - a.ts);
  const activeRows = filtered.filter(r => r.status !== 'cancelled');
  if ($('invoicesSummaryStrip')) {
    $('invoicesSummaryStrip').innerHTML = `
      <div class="bg-slate-50 border rounded-xl p-2"><span class="block text-xs text-slate-500">المبيعات</span><span class="font-bold text-slate-800">${fmtCur(sumList(activeRows, r => r.total))}</span></div>
      <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-2"><span class="block text-xs text-emerald-700">المدفوع</span><span class="font-bold text-emerald-800">${fmtCur(sumList(activeRows, r => r.paid))}</span></div>
      <div class="bg-rose-50 border border-rose-200 rounded-xl p-2"><span class="block text-xs text-rose-700">الآجل</span><span class="font-bold text-rose-700">${fmtCur(sumList(activeRows, r => r.remaining))}</span></div>
      <div class="bg-indigo-50 border border-indigo-200 rounded-xl p-2"><span class="block text-xs text-indigo-700">الربح</span><span class="font-bold text-indigo-800">${fmtCur(sumList(activeRows, r => r.profit))}</span></div>`;
  }
  const totalPages = Math.max(1, Math.ceil(filtered.length / INVOICES_PER_PAGE));
  if (currentInvoicePage > totalPages) currentInvoicePage = totalPages;
  const pageRows = filtered.slice((currentInvoicePage - 1) * INVOICES_PER_PAGE, currentInvoicePage * INVOICES_PER_PAGE);
  body.innerHTML = pageRows.map(row => {
    const isCancelled = row.status === 'cancelled';
    const badge = isCancelled ? `<span class="bg-rose-100 text-rose-700 px-2 py-0.5 rounded text-[11px] font-bold">ملغاة</span>`
      : row.remaining > 0 ? `<span class="bg-amber-100 text-amber-800 px-2 py-0.5 rounded text-[11px] font-bold">آجل</span>`
      : `<span class="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded text-[11px] font-bold">نقدي</span>`;
    return `<tr class="hover:bg-slate-50 border-b border-slate-100 ${isCancelled ? 'opacity-60 line-through' : ''}">
      <td class="p-3 font-bold text-ashour">${esc(row.id)}</td>
      <td class="p-3 text-slate-500 text-xs">${esc(row.date)}</td>
      <td class="p-3 font-bold text-slate-800">${esc(row.clientName)}</td>
      <td class="p-3 font-bold">${fmtCur(row.total)}</td>
      <td class="p-3 text-emerald-700 font-bold">${fmtCur(row.paid)}</td>
      <td class="p-3 text-rose-600 font-bold">${fmtCur(row.remaining)}</td>
      <td class="p-3 text-indigo-700 font-bold">${fmtCur(row.profit)}</td>
      <td class="p-3">${badge}</td>
      <td class="p-3 text-center"><div class="flex justify-center gap-1">
        ${row.kind === 'invoice' ? `<button type="button" onclick="viewPastInvoice('${esc(row.id)}')" class="bg-ashour text-white hover:bg-ashour-dark px-2.5 py-1 rounded transition text-xs font-bold"><i class="fa-solid fa-eye"></i></button>` : ''}
        ${!isCancelled && row.kind === 'invoice' ? `<button type="button" onclick="cancelInvoice('${esc(row.id)}')" class="bg-rose-100 text-rose-700 hover:bg-rose-600 hover:text-white px-2.5 py-1 rounded transition text-xs font-bold"><i class="fa-solid fa-ban"></i></button>` : ''}
        ${row.kind === 'direct' ? `<button type="button" onclick="deleteDirectSale('${esc(row.id)}')" class="bg-rose-100 text-rose-700 hover:bg-rose-600 hover:text-white px-2.5 py-1 rounded transition text-xs font-bold"><i class="fa-solid fa-trash"></i></button>` : ''}
      </div></td>
    </tr>`;
  }).join('') || `<tr><td colspan="9" class="p-6 text-center text-slate-400 text-sm">لا توجد فواتير مطابقة</td></tr>`;
  if ($('invoicesPagination')) {
    $('invoicesPagination').innerHTML = `<span>صفحة ${currentInvoicePage} من ${totalPages} (${filtered.length} عملية)</span>
      <div class="flex gap-1"><button type="button" onclick="changeInvoicePage(${currentInvoicePage - 1})" ${currentInvoicePage <= 1 ? 'disabled' : ''} class="px-3 py-1 rounded bg-white border disabled:opacity-40">السابق</button>
      <button type="button" onclick="changeInvoicePage(${currentInvoicePage + 1})" ${currentInvoicePage >= totalPages ? 'disabled' : ''} class="px-3 py-1 rounded bg-white border disabled:opacity-40">التالي</button></div>`;
  }
}
function changeInvoicePage(page) { const totalPages = Math.max(1, Math.ceil(state.invoices.length / INVOICES_PER_PAGE)); currentInvoicePage = Math.max(1, Math.min(totalPages, page)); renderInvoicesTable(); }
function viewPastInvoice(invId) { const inv = state.invoices.find(i => i.id === invId); if (!inv) return warn('تنبيه', 'الفاتورة غير موجودة', 'error'); showReceiptModal(inv); }
function cancelInvoice(invId) {
  const inv = state.invoices.find(i => i.id === invId); if (!inv || inv.status === 'cancelled') return;
  Swal.fire({ title: `إلغاء الفاتورة ${inv.id}؟`, text: 'سيتم إرجاع الكميات للمخزون وإلغاء الدين المترتب على الفاتورة.', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#64748b', confirmButtonText: 'نعم، إلغاء الفاتورة', cancelButtonText: 'تراجع' })
    .then(async res => {
      if (!res.isConfirmed) return;
      const prevStatus = inv.status, prevCancelledAt = inv.cancelledAt;
      const stockSnapshots = [];
      inv.items.forEach(it => {
        if (it.isQuickOnly || !it.productId) return;
        const p = state.products.find(x => x.id === it.productId);
        if (p && p.trackStock) { const before = toNum(p.stock); stockSnapshots.push({ productId: p.id, before }); p.stock = roundMoney(before + toNum(it.qty)); addStockMovement(p.id, 'return', toNum(it.qty), before, p.stock, `إلغاء فاتورة ${inv.id}`, inv.id); }
      });
      inv.status = 'cancelled'; inv.cancelledAt = Date.now();
      logAudit('إلغاء فاتورة', `فاتورة ${inv.id} (${inv.clientName})`);
      const ok = await saveToStorage();
      if (!ok) { inv.status = prevStatus; delete inv.cancelledAt; stockSnapshots.forEach(s => { const p = state.products.find(x => x.id === s.productId); if (p) p.stock = s.before; }); state.stockMovements = state.stockMovements.filter(m => !(m.refId === inv.id && m.type === 'return')); return; }
      renderInvoicesTable(); if (state.currentLedgerClientId === inv.clientId) renderLedgerSummary(inv.clientId);
      updateInventoryBadge(); toast('تم إلغاء الفاتورة');
    });
}
function deleteDirectSale(id) {
  Swal.fire({ title: 'حذف عملية البيع السريع؟', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6', confirmButtonText: 'نعم', cancelButtonText: 'إلغاء' })
    .then(async res => {
      if (!res.isConfirmed) return;
      const idx = state.directSales.findIndex(ds => ds.id === id); if (idx === -1) return;
      const removed = state.directSales[idx]; state.directSales.splice(idx, 1); addTombstone('directSales', removed.id); addToTrash('directSales', removed);
      logAudit('حذف بيع سريع', removed.name || id);
      const ok = await saveToStorage(); if (!ok) { state.directSales.splice(idx, 0, removed); return; }
      renderInvoicesTable(); toast('تم الحذف');
    });
}

function showReceiptModal(inv) {
  state.currentReceiptInv = inv;
  $('recStoreName').textContent = state.storeInfo.name;
  $('recStorePhone').textContent = state.storeInfo.phone ? `هاتف: ${state.storeInfo.phone}` : '';
  $('recStoreAddress').textContent = state.storeInfo.address ? `${state.storeInfo.address}` : '';
  $('recNum').textContent = inv.id;
  $('recDate').textContent = inv.date;
  $('recClient').textContent = inv.clientName;
  $('recPriceMode').textContent = inv.priceMode || 'تجزئة';
  $('recItemsBody').innerHTML = inv.items.map(it => `<tr><td class="py-1">${esc(it.name)}</td><td class="py-1 text-center">${it.qty}</td><td class="py-1 text-left">${fmt(it.price)}</td><td class="py-1 text-left">${fmt(it.total)}</td></tr>`).join('');
  if (toNum(inv.discount) > 0) { $('recDiscountRow').classList.remove('hidden'); $('recDiscount').textContent = fmtCur(inv.discount); } else $('recDiscountRow').classList.add('hidden');
  $('recTotal').textContent = fmtCur(inv.total);
  $('recPaid').textContent = fmtCur(inv.paid);
  if (toNum(inv.remaining) > 0) { $('recRemainingRow').classList.remove('hidden'); $('recRemaining').textContent = fmtCur(inv.remaining); } else $('recRemainingRow').classList.add('hidden');
  if (toNum(inv.changeGiven) > 0) { $('recChangeRow').classList.remove('hidden'); $('recChange').textContent = fmtCur(inv.changeGiven); } else $('recChangeRow').classList.add('hidden');
  const totalDebt = getClientDebt(inv.clientId);
  if (totalDebt > 0 || inv.clientId !== 'c1') { $('recTotalDebtRow').classList.remove('hidden'); $('recTotalClientDebt').textContent = fmtCur(totalDebt); } else $('recTotalDebtRow').classList.add('hidden');
  openModal('receiptModal');
}
async function generateReceiptImageBlob() {
  const el = $('printableReceipt');
  if (!el || typeof html2canvas === 'undefined') throw new Error('تعذر توليد الصورة');
  const prevOverflow = el.style.overflow, prevHeight = el.style.height, prevMax = el.style.maxHeight;
  el.style.overflow = 'visible'; el.style.height = 'auto'; el.style.maxHeight = 'none';
  try {
    const canvas = await html2canvas(el, { scale: 3, backgroundColor: '#ffffff', useCORS: true, logging: false, windowWidth: el.scrollWidth, windowHeight: el.scrollHeight });
    return await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  } finally { el.style.overflow = prevOverflow; el.style.height = prevHeight; el.style.maxHeight = prevMax; }
}
async function saveReceiptAsImage() {
  try {
    const blob = await generateReceiptImageBlob(); if (!blob) return warn('تنبيه', 'تعذر إنشاء صورة الفاتورة', 'error');
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = `فاتورة_${state.currentReceiptInv ? state.currentReceiptInv.id : Date.now()}.png`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('تم حفظ صورة الفاتورة');
  } catch (err) { warn('تنبيه', err.message, 'error'); }
}
async function shareReceiptImage() {
  try {
    const blob = await generateReceiptImageBlob(); if (!blob) return warn('تنبيه', 'تعذر إنشاء صورة الفاتورة', 'error');
    const fileName = `فاتورة_${state.currentReceiptInv ? state.currentReceiptInv.id : Date.now()}.png`;
    const file = new File([blob], fileName, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ title: fileName, files: [file] }); }
    else { saveReceiptAsImage(); }
  } catch (err) { if (err && err.name !== 'AbortError') warn('تنبيه', 'تعذر المشاركة المباشرة', 'error'); }
}
function shareReceiptWhatsApp() {
  const inv = state.currentReceiptInv; if (!inv) return;
  const lines = [`*${state.storeInfo.name}*`, `فاتورة رقم: ${inv.id}`, `التاريخ: ${inv.date}`, `الزبون: ${inv.clientName}`, '------------------------', ...inv.items.map(it => `${it.qty} × ${it.name} = ${fmtCur(it.total)}`), '------------------------', `المجموع: *${fmtCur(inv.total)}*`, `المدفوع: ${fmtCur(inv.paid)}`];
  if (toNum(inv.remaining) > 0) lines.push(`المتبقي: *${fmtCur(inv.remaining)}*`);
  const debt = getClientDebt(inv.clientId); if (debt > 0) lines.push(`إجمالي الدين الحالي: *${fmtCur(debt)}*`);
  window.open(`https://wa.me/?text=${encodeURIComponent(lines.join('\n'))}`, '_blank');
}

function setReportRange(days) {
  const to = new Date(), from = new Date();
  if (days > 0) from.setDate(to.getDate() - days);
  if ($('repFrom')) $('repFrom').value = dayKey(from.getTime());
  if ($('repTo')) $('repTo').value = dayKey(to.getTime());
  renderReports();
}
function renderReports() {
  const cards = $('reportCards'); if (!cards) return;
  const fromVal = $('repFrom')?.value || '', toVal = $('repTo')?.value || '';
  const inRange = ts => { if (!fromVal && !toVal) return true; if (!ts) return false; const k = dayKey(ts); if (fromVal && k < fromVal) return false; if (toVal && k > toVal) return false; return true; };
  const invs = state.invoices.filter(i => i.status === 'active' && inRange(i.ts));
  const ds = state.directSales.filter(d => inRange(d.ts));
  const exps = filterDeleted('expenses', state.expenses).filter(e => inRange(e.ts));
  const rets = state.returns.filter(r => inRange(r.ts));
  const sales = roundMoney(sumList(invs, i => i.total) + sumList(ds, d => d.total) - sumList(rets, r => r.amount));
  const profit = roundMoney(sumList(invs, i => i.profit) + sumList(ds, d => d.profit || 0) - sumList(rets, r => r.profitAdjustment || 0));
  const expSum = sumList(exps, e => e.amount);
  const net = roundMoney(profit - expSum);
  cards.innerHTML = `
    <div class="bg-white border rounded-xl p-2.5"><span class="block text-xs text-slate-500">صافي المبيعات</span><span class="font-bold text-ashour">${fmtCur(sales)}</span></div>
    <div class="bg-white border rounded-xl p-2.5"><span class="block text-xs text-slate-500">مجمل الربح</span><span class="font-bold text-indigo-700">${fmtCur(profit)}</span></div>
    <div class="bg-white border rounded-xl p-2.5"><span class="block text-xs text-slate-500">المصاريف</span><span class="font-bold text-rose-600">${fmtCur(expSum)}</span></div>
    <div class="bg-white border rounded-xl p-2.5"><span class="block text-xs text-slate-500">صافي الربح</span><span class="font-bold ${net >= 0 ? 'text-emerald-700' : 'text-rose-700'}">${fmtCur(net)}</span></div>`;
  const counts = {};
  invs.forEach(i => i.items.forEach(it => { const k = it.name || it.productId; counts[k] = roundMoney((counts[k] || 0) + toNum(it.qty)); }));
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if ($('topProductsBody')) $('topProductsBody').innerHTML = top.map(([name, q]) => `<tr><td class="p-2.5">${esc(name)}</td><td class="p-2.5 text-left font-bold text-ashour">${fmt(q)}</td></tr>`).join('') || `<tr><td class="p-4 text-center text-slate-400">لا توجد بيانات</td></tr>`;
}
function exportReportCSV() {
  const rows = [['النوع', 'الرقم/الكود', 'التاريخ', 'البيان', 'الإجمالي', 'المدفوع', 'المتبقي', 'الربح']];
  state.invoices.filter(i => i.status === 'active').forEach(i => rows.push(['فاتورة', i.id, i.date, i.clientName, i.total, i.paid, i.remaining, i.profit]));
  state.directSales.forEach(d => rows.push(['بيع سريع', d.id, d.date, d.name, d.total, d.paid != null ? d.paid : d.total, d.remaining || 0, d.profit || 0]));
  const csv = rows.map(r => r.map(v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ashour_report.csv';
  document.body.appendChild(a); a.click(); a.remove();
}
async function renderAuditLog() {
  const body = $('auditLogBody'); if (!body) return;
  let list = await AshourDB.getAudit(100);
  if (!list || !list.length) list = state.auditLog || [];
  body.innerHTML = list.slice(0, 100).map(e => `<tr><td class="p-2 text-slate-400 whitespace-nowrap">${esc(e.date || '')}</td><td class="p-2 font-bold text-slate-700">${esc(e.type || '')}</td><td class="p-2 text-slate-600">${esc(e.details || '')}</td></tr>`).join('') || `<tr><td colspan="3" class="p-4 text-center text-slate-400">لا يوجد سجل</td></tr>`;
}

function loadStoreInfoToSettings() {
  if ($('setStoreName')) $('setStoreName').value = state.storeInfo.name;
  if ($('setStorePhone')) $('setStorePhone').value = state.storeInfo.phone;
  if ($('setStoreAddress')) $('setStoreAddress').value = state.storeInfo.address;
  if ($('setRate')) $('setRate').value = toNum(state.exchangeRate || 15000);
}
async function saveStoreSettings() {
  const name = $('setStoreName').value.trim(); const phone = $('setStorePhone').value.trim(); const address = $('setStoreAddress').value.trim();
  if (!name) return warn('خطأ', 'أدخل اسم المركز');
  const prev = { ...state.storeInfo };
  state.storeInfo = { name, phone, address };
  logAudit('تعديل بيانات المتجر', name);
  const ok = await saveToStorage(); if (!ok) { state.storeInfo = prev; return; }
  applyStoreBrandUI(); toast('تم حفظ بيانات المتجر');
}
function applyStoreBrandUI() {
  const n = state.storeInfo?.name || 'مركز عاشور للتجارة';
  if ($('headerStoreName')) $('headerStoreName').textContent = n;
  if ($('mobileStoreName')) $('mobileStoreName').textContent = n;
  if ($('introStoreSubtitle')) $('introStoreSubtitle').textContent = n;
  document.title = `نظام الفواتير - ${n}`;
}
async function saveExchangeRate() {
  const rate = toNum($('setRate').value);
  if (!(rate > 0)) return warn('خطأ', 'أدخل سعر صرف صحيحاً');
  state.exchangeRate = rate; logAudit('تعديل سعر الصرف', `1$ = ${fmt(rate)} ل.س`);
  const ok = await saveToStorage(); if (!ok) return;
  renderAll(); toast('تم حفظ سعر الصرف');
}
async function changePinCode() {
  const oldPin = $('oldPinInput').value.trim(), newPin = $('newPinInput').value.trim();
  if (!/^\d{4,6}$/.test(newPin)) return warn('تنبيه', 'يجب أن يكون الرمز الجديد من 4 إلى 6 أرقام');
  if (await hashPin(oldPin, state.pinSalt) !== state.pinHash) return warn('خطأ', 'الرمز الحالي غير صحيح', 'error');
  state.pinSalt = generateSalt(); state.pinHash = await hashPin(newPin, state.pinSalt); state.pinLength = newPin.length;
  logAudit('تغيير رمز PIN', 'تم تغيير رمز PIN بنجاح');
  const ok = await saveToStorage(); if (!ok) return;
  $('oldPinInput').value = ''; $('newPinInput').value = ''; toast('تم تغيير رمز PIN بنجاح');
}
function exportDataBackup() {
  const snapshot = JSON.parse(JSON.stringify(state));
  delete snapshot.pinHash; delete snapshot.pinSalt; delete snapshot.pinAttempts; delete snapshot.pinLockUntil;
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `Ashour_Backup_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  logAudit('تصدير نسخة احتياطية', a.download); toast('تم تصدير النسخة الاحتياطية');
}
async function importDataBackup(ev) {
  const file = ev.target.files[0]; if (!file) return;
  try {
    const incoming = JSON.parse(await file.text());
    if (!Array.isArray(incoming.products)) throw new Error('ملف غير صالح');
    const res = await Swal.fire({ title: 'استعادة نسخة احتياطية؟', text: 'سيتم استبدال البيانات الحالية على هذا الجهاز.', icon: 'warning', showCancelButton: true, confirmButtonColor: '#0F5C4E', cancelButtonColor: '#d33', confirmButtonText: 'نعم، استعادة', cancelButtonText: 'إلغاء' });
    if (!res.isConfirmed) return;
    const keepPin = state.pinHash, keepSalt = state.pinSalt, keepLen = state.pinLength;
    state = Object.assign(defaultState(), incoming);
    ['returns', 'directSales', 'noInvoiceItems', 'companies', 'payments', 'expenses', 'invoices', 'purchases', 'companyPayments', 'personDebts', 'orders', 'stockMovements', 'tombstones', 'trash'].forEach(k => { if (!Array.isArray(state[k])) state[k] = []; });
    state.pinHash = keepPin; state.pinSalt = keepSalt; state.pinLength = keepLen || 4;
    await saveToStorage(); logAudit('استعادة نسخة احتياطية', file.name);
    toast('تمت استعادة النسخة الاحتياطية'); setTimeout(() => location.reload(), 600);
  } catch (e) { warn('خطأ', 'تعذّر قراءة الملف: ' + e.message, 'error'); }
  finally { ev.target.value = ''; }
}
async function refreshStorageStatus() {
  const box = $('storageStatus'); if (!box) return;
  const s = await AshourDB.getStatus();
  const estText = s.estimate ? `المساحة المستخدمة: <b>${fmt(Math.round(s.estimate.usage / 1024))} KB</b>` : '';
  const lsSize = s.localStorageSize ? ` (${fmt(Math.round(s.localStorageSize / 1024))} KB)` : '';
  box.innerHTML = `<div>IndexedDB: <b>${esc(s.indexedDB)}</b></div><div>localStorage: <b>${esc(s.localStorage)}${lsSize}</b></div>${estText ? `<div>${estText}</div>` : ''}`;
}
async function testStorageCapacity() {
  const res = await AshourDB.testCapacity();
  if (res.ok) Swal.fire({ icon: 'success', title: 'اختبار الذاكرة ناجح', text: `تمت كتابة وقراءة ${res.sizeKB} KB خلال ${res.ms} ms.`, confirmButtonColor: '#0F5C4E' });
  else warn('فشل اختبار الذاكرة', res.error || 'تعذر التخزين', 'error');
}
function openTrash() {
  const items = state.trash || [];
  if (!items.length) return warn('السلة فارغة', 'لا توجد عناصر محذوفة محفوظة', 'info');
  const html = items.slice(-25).reverse().map((t, idx) => {
    const r = t.rec || {};
    const label = r.name || r.title || r.id || t.col;
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px;border-bottom:1px solid #eee;font-size:12px;"><span><b>[${esc(t.col)}]</b> ${esc(label)}</span><button type="button" onclick="restoreTrashByIdx(${items.length - 1 - idx})" style="background:#0F5C4E;color:#fff;border:none;padding:3px 8px;border-radius:6px;cursor:pointer;font-weight:bold;">استعادة</button></div>`;
  }).join('');
  Swal.fire({ title: 'سلة المحذوفات (آخر 25)', html: `<div style="max-height:300px;overflow-y:auto;text-align:right;">${html}</div>`, confirmButtonText: 'إغلاق', confirmButtonColor: '#334155' });
}
window.restoreTrashByIdx = async function (idx) {
  const entry = state.trash[idx]; if (!entry) return;
  const { col, rec } = entry;
  state.tombstones = (state.tombstones || []).filter(t => !(t.col === col && String(t.id) === String(rec.id)));
  if (Array.isArray(state[col]) && !state[col].some(x => x.id === rec.id)) state[col].push(rec);
  state.trash.splice(idx, 1);
  await saveToStorage(); renderAll(); Swal.close(); toast('تمت الاستعادة');
};

function openModal(id) { const el = $(id); if (el) { el.classList.remove('hidden'); el.style.display = 'flex'; } }
function closeModal(id) { const el = $(id); if (el) { el.classList.add('hidden'); el.style.display = 'none'; } }

function renderAll() {
  applyStoreBrandUI(); updateCurrencyButtons(); refreshCategoryWidgets();
  populatePosClients(); updatePosPriceUI(); renderPosProducts(); renderCart();
  renderInvoicesTable(); renderPurchases(); renderProductsTable();
  renderInventoryTable(); renderStockMovements(); updateInventoryBadge();
  renderClientsGrid(); renderCompaniesGrid(); renderPersonDebts();
  renderExpensesTable(); renderOrders(); updateOrdersBadge();
}

function renderOrders() {
  const grid = $('ordersGrid'); if (!grid) return;
  const active = filterDeleted('orders', state.orders || []).filter(o => o.status === 'pending');
  active.sort((a, b) => (a.dueTs || 0) - (b.dueTs || 0));
  if (!active.length) { grid.innerHTML = `<div class="col-span-full text-center py-10 text-slate-400 text-sm font-bold bg-white rounded-2xl border border-dashed">لا توجد طلبات معلقة</div>`; return; }
  grid.innerHTML = active.map(o => {
    const client = state.clients.find(c => c.id === o.clientId) || { name: o.clientName || 'زبون نقدي مباشر' };
    const dueStr = o.dueDate ? `${esc(o.dueDate)} ${o.dueTime ? '— ' + esc(o.dueTime) : ''}` : 'غير محدد';
    const itemsPreview = (o.items || []).map(it => `${it.qty} × ${it.name}`).join('، ');
    return `<div class="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-col justify-between gap-3">
      <div>
        <div class="flex justify-between items-start"><span class="font-bold text-sm text-slate-900">${esc(client.name)}</span><span class="text-[11px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded">${esc(dueStr)}</span></div>
        <p class="text-xs text-slate-600 mt-1.5 font-semibold">${esc(itemsPreview || 'بدون أصناف')}</p>
        ${o.notes ? `<p class="text-xs text-slate-400 mt-1 italic">${esc(o.notes)}</p>` : ''}
      </div>
      <div class="flex gap-1.5 pt-2 border-t border-slate-100 text-xs font-bold">
        <button type="button" onclick="deliverOrderToCart('${esc(o.id)}')" class="flex-1 bg-ashour hover:bg-ashour-dark text-white py-2 rounded-lg"><i class="fa-solid fa-cash-register"></i> تسليم</button>
        <button type="button" onclick="editOrder('${esc(o.id)}')" class="bg-indigo-100 text-indigo-700 hover:bg-indigo-600 hover:text-white px-2.5 py-2 rounded-lg"><i class="fa-solid fa-pen"></i></button>
        <button type="button" onclick="deleteOrder('${esc(o.id)}')" class="bg-rose-100 text-rose-700 hover:bg-rose-600 hover:text-white px-2.5 py-2 rounded-lg"><i class="fa-solid fa-trash"></i></button>
      </div>
    </div>`;
  }).join('');
}
function updateOrdersBadge() {
  const count = filterDeleted('orders', state.orders || []).filter(o => o.status === 'pending').length;
  const badge = $('ordersBadge');
  if (badge) { badge.textContent = count; badge.classList.toggle('hidden', count === 0); }
}
function openOrderModal(orderId = null) {
  $('orderEditId').value = orderId || '';
  if (orderId) {
    const o = state.orders.find(x => x.id === orderId); if (!o) return;
    $('orderClientSelect').value = o.clientId || 'c1';
    const c = state.clients.find(x => x.id === o.clientId); $('orderSelectedClientText').textContent = c ? c.name : 'زبون نقدي مباشر';
    $('orderDueDate').value = o.dueDate || ''; $('orderDueTime').value = o.dueTime || ''; $('orderNotes').value = o.notes || '';
    currentOrderItems = (o.items || []).map(it => ({ productId: it.productId || '', name: it.name || '', qty: toNum(it.qty) || 1 }));
  } else {
    const c1 = state.clients.find(c => c.id === 'c1') || state.clients[0];
    $('orderClientSelect').value = c1 ? c1.id : 'c1'; $('orderSelectedClientText').textContent = c1 ? c1.name : 'زبون نقدي مباشر';
    $('orderDueDate').value = dayKey(Date.now()); $('orderDueTime').value = '12:00'; $('orderNotes').value = '';
    currentOrderItems = [{ productId: '', name: '', qty: 1 }];
  }
  renderOrderItemsList(); openModal('orderModal');
}
function toggleOrderClientDropdown() {
  const list = $('orderClientDropdownList'); if (!list) return;
  const isHidden = list.classList.contains('hidden');
  list.innerHTML = filterDeleted('clients', state.clients).map(c => `<div onclick="selectOrderClient('${esc(c.id)}', '${esc(c.name)}')" class="p-2 hover:bg-emerald-50 cursor-pointer text-xs font-bold">${esc(c.name)}</div>`).join('');
  list.classList.toggle('hidden', !isHidden);
}
function selectOrderClient(id, label) { $('orderClientSelect').value = id; $('orderSelectedClientText').textContent = label; $('orderClientDropdownList').classList.add('hidden'); }
function addOrderItem() { currentOrderItems.push({ productId: '', name: '', qty: 1 }); renderOrderItemsList(); }
function removeOrderItem(idx) { currentOrderItems.splice(idx, 1); renderOrderItemsList(); }
function renderOrderItemsList() {
  const container = $('orderItemsList'); if (!container) return;
  const prods = filterDeleted('products', state.products);
  container.innerHTML = currentOrderItems.map((it, idx) => `
    <div class="flex gap-1.5 items-center bg-slate-50 p-1.5 rounded-lg border">
      <select onchange="onOrderItemProdChange(${idx}, this.value)" class="flex-grow bg-white border rounded px-2 py-1.5 text-xs font-bold">
        <option value="">-- اختر منتجاً --</option>
        ${prods.map(p => `<option value="${esc(p.id)}" ${p.id === it.productId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
      </select>
      <input type="number" min="1" value="${it.qty}" onchange="currentOrderItems[${idx}].qty = Math.max(1, parseInt(this.value, 10) || 1)" class="w-16 bg-white border rounded px-2 py-1.5 text-xs font-bold text-center">
      <button type="button" onclick="removeOrderItem(${idx})" class="text-rose-500 hover:text-rose-700 px-1.5"><i class="fa-solid fa-xmark"></i></button>
    </div>`).join('') || `<div class="text-xs text-slate-400 text-center py-2">أضف صنفاً واحداً على الأقل</div>`;
}
function onOrderItemProdChange(idx, prodId) { const p = state.products.find(x => x.id === prodId); currentOrderItems[idx].productId = prodId; currentOrderItems[idx].name = p ? p.name : ''; }
async function saveOrder() {
  const orderId = $('orderEditId').value; const clientId = $('orderClientSelect').value || 'c1';
  const c = state.clients.find(x => x.id === clientId); const dueDate = $('orderDueDate').value || '';
  const dueTime = $('orderDueTime').value || ''; const notes = $('orderNotes').value.trim();
  const validItems = currentOrderItems.filter(it => it.productId || it.name).map(it => { const p = state.products.find(x => x.id === it.productId); return { productId: it.productId, name: p ? p.name : it.name, qty: Math.max(1, toNum(it.qty) || 1) }; });
  if (!validItems.length) return warn('تنبيه', 'أضف صنفاً واحداً على الأقل للطلب');
  let dueTs = 0; if (dueDate) { const d = new Date(`${dueDate}T${dueTime || '00:00'}`); if (!isNaN(d.getTime())) dueTs = d.getTime(); }
  if (orderId) {
    const o = state.orders.find(x => x.id === orderId); if (!o) return;
    Object.assign(o, { clientId, clientName: c ? c.name : 'زبون نقدي مباشر', dueDate, dueTime, dueTs, items: validItems, notes });
    logAudit('تعديل طلب', `طلب ${o.id} — ${c ? c.name : ''}`);
  } else {
    state.orders.push({ id: 'ORD-' + Date.now(), ts: Date.now(), date: nowStr(), clientId, clientName: c ? c.name : 'زبون نقدي مباشر', dueDate, dueTime, dueTs, items: validItems, notes, status: 'pending' });
    logAudit('إضافة طلب جديد', `${c ? c.name : ''}`);
  }
  const ok = await saveToStorage(); if (!ok) return;
  closeModal('orderModal'); renderOrders(); updateOrdersBadge(); toast('تم حفظ الطلب');
}
function editOrder(orderId) { openOrderModal(orderId); }
function deleteOrder(orderId) {
  Swal.fire({ title: 'حذف هذا الطلب؟', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6', confirmButtonText: 'نعم', cancelButtonText: 'إلغاء' })
    .then(async res => {
      if (!res.isConfirmed) return;
      const idx = state.orders.findIndex(o => o.id === orderId); if (idx === -1) return;
      const removed = state.orders[idx]; state.orders.splice(idx, 1); addTombstone('orders', removed.id); addToTrash('orders', removed);
      logAudit('حذف طلب', removed.id);
      const ok = await saveToStorage(); if (!ok) { state.orders.splice(idx, 0, removed); return; }
      renderOrders(); updateOrdersBadge(); toast('تم حذف الطلب');
    });
}
function deliverOrderToCart(orderId) {
  const o = state.orders.find(x => x.id === orderId); if (!o) return;
  switchTab('pos');
  const client = state.clients.find(c => c.id === o.clientId) || state.clients[0];
  if (client) selectClient(client.id, client.name);
  const newCart = [];
  o.items.forEach(it => {
    const prod = state.products.find(p => p.id === it.productId);
    if (prod) newCart.push({ productId: prod.id, qty: toNum(it.qty) });
    else newCart.push({ isQuickOnly: true, quickId: 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5), name: it.name, price: 0, qty: toNum(it.qty) });
  });
  state.cart = newCart; renderCart();
  pendingOrder = { id: o.id, cartHash: computeCartHash(newCart) };
  toast(`تم نقل طلب ${o.clientName} إلى الكاشير`);
}
async function addCartToOrders() {
  if (!state.cart.length) return warn('السلة فارغة', 'أضف منتجات أولاً');
  const client = getSelectedPosClient();
  const items = state.cart.map(item => { const info = getCartItemInfo(item); return { productId: info.isQuickOnly ? '' : info.productId, name: info.name, qty: toNum(item.qty) }; });
  state.orders.push({ id: 'ORD-' + Date.now(), ts: Date.now(), date: nowStr(), clientId: client.id, clientName: client.name, dueDate: dayKey(Date.now()), dueTime: '12:00', dueTs: Date.now(), items, notes: 'طلب من الكاشير', status: 'pending' });
  logAudit('إضافة طلب من الكاشير', `${client.name}`);
  const ok = await saveToStorage(); if (!ok) return;
  clearCart(); updateOrdersBadge(); toast('تم حفظ السلة كطلب');
}

function switchInventorySubTab(sub) {
  const isMov = sub === 'movements';
  $('inventoryProductsPanel').classList.toggle('hidden', isMov);
  $('inventoryMovementsPanel').classList.toggle('hidden', !isMov);
  $('invSubTabProducts').className = !isMov ? 'flex-1 px-4 py-2 rounded-xl bg-ashour text-white font-bold text-xs' : 'flex-1 px-4 py-2 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 font-bold text-xs';
  $('invSubTabMovements').className = isMov ? 'flex-1 px-4 py-2 rounded-xl bg-ashour text-white font-bold text-xs' : 'flex-1 px-4 py-2 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 font-bold text-xs';
  if (isMov) renderStockMovements(); else renderInventoryTable();
}
function updateInventoryBadge() {
  const tracked = filterDeleted('products', state.products).filter(p => p.trackStock);
  const alerts = tracked.filter(p => { const s = getStockStatus(p); return s === 'low' || s === 'out'; }).length;
  const badge = $('inventoryBadge');
  if (badge) { badge.textContent = alerts; badge.classList.toggle('hidden', alerts === 0); }
}
function renderInventorySummary() {
  const sumEl = $('inventorySummary'); if (!sumEl) return;
  const tracked = filterDeleted('products', state.products).filter(p => p.trackStock);
  const lowCount = tracked.filter(p => getStockStatus(p) === 'low').length;
  const outCount = tracked.filter(p => getStockStatus(p) === 'out').length;
  const totalValue = sumList(tracked, p => calcLineTotal(p.cost, p.stock));
  sumEl.innerHTML = `
    <div class="bg-white border rounded-xl p-2.5 shadow-sm"><span class="block text-xs text-slate-500">منتجات مُتتبعة</span><span class="font-bold text-slate-800">${fmt(tracked.length)}</span></div>
    <div class="bg-white border border-amber-200 rounded-xl p-2.5 shadow-sm"><span class="block text-xs text-amber-700">مخزون منخفض</span><span class="font-bold text-amber-800">${fmt(lowCount)}</span></div>
    <div class="bg-white border border-rose-200 rounded-xl p-2.5 shadow-sm"><span class="block text-xs text-rose-700">نفد المخزون</span><span class="font-bold text-rose-700">${fmt(outCount)}</span></div>
    <div class="bg-white border border-indigo-200 rounded-xl p-2.5 shadow-sm col-span-2 md:col-span-2"><span class="block text-xs text-indigo-700">قيمة المخزون (بالتكلفة)</span><span class="font-bold text-indigo-800">${fmtCur(totalValue)}</span></div>`;
}
function renderInventoryTable() {
  renderInventorySummary();
  const body = $('inventoryTableBody'); if (!body) return;
  const q = normalizeArabic(($('invSearch')?.value || '').trim());
  const filter = $('invFilter')?.value || 'all';
  const tracked = filterDeleted('products', state.products).filter(p => p.trackStock);
  const filtered = tracked.filter(p => {
    const status = getStockStatus(p);
    if (filter !== 'all' && status !== filter) return false;
    return !q || normalizeArabic(p.name).includes(q) || normalizeArabic(p.sku).includes(q) || normalizeArabic(p.barcode).includes(q);
  });
  if ($('invCountBadge')) $('invCountBadge').textContent = fmt(filtered.length);
  body.innerHTML = filtered.map(p => {
    const status = getStockStatus(p);
    const badge = status === 'out' ? `<span class="bg-rose-100 text-rose-700 px-2 py-0.5 rounded text-[11px] font-bold">نفد</span>`
      : status === 'low' ? `<span class="bg-amber-100 text-amber-800 px-2 py-0.5 rounded text-[11px] font-bold">منخفض</span>`
      : `<span class="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded text-[11px] font-bold">متوفر</span>`;
    return `<tr class="hover:bg-slate-50 border-b border-slate-100">
      <td class="p-3 text-ashour font-bold">${esc(p.sku || '-')}</td>
      <td class="p-3 font-bold text-slate-900">${esc(p.name)}</td>
      <td class="p-3 text-center font-bold">${fmt(p.stock)}</td>
      <td class="p-3 text-center text-slate-500">${fmt(p.minStock || 5)}</td>
      <td class="p-3 text-center">${badge}</td>
      <td class="p-3 text-indigo-700 font-bold">${fmtCur(calcLineTotal(p.cost, p.stock))}</td>
      <td class="p-3 text-center"><button type="button" onclick="openStockAdjustmentModal('${esc(p.id)}')" class="bg-indigo-100 text-indigo-700 hover:bg-indigo-600 hover:text-white px-2.5 py-1 rounded transition text-xs font-bold"><i class="fa-solid fa-sliders"></i> تسوية</button></td>
    </tr>`;
  }).join('') || `<tr><td colspan="7" class="p-6 text-center text-slate-400 text-sm">لا توجد منتجات مطابقة</td></tr>`;
}
function openStockAdjustmentModal(preselectProductId = '') {
  const tracked = filterDeleted('products', state.products).filter(p => p.trackStock);
  const sel = $('saProductSelect'); if (!sel) return;
  sel.innerHTML = tracked.map(p => `<option value="${esc(p.id)}">${esc(p.name)} (المخزون: ${fmt(p.stock)})</option>`).join('');
  if (preselectProductId && tracked.some(p => p.id === preselectProductId)) sel.value = preselectProductId;
  $('saType').value = 'adjustment'; $('saQty').value = ''; $('saNote').value = '';
  updateStockAdjustmentPreview(); openModal('stockAdjustmentModal');
}
function updateStockAdjustmentPreview() {
  const prodId = $('saProductSelect')?.value; const p = state.products.find(x => x.id === prodId);
  if (!p) { if ($('saCurrentStock')) $('saCurrentStock').textContent = 'اختر منتجاً'; if ($('saAfterStock')) $('saAfterStock').textContent = 'بعد التسوية: —'; return; }
  const current = toNum(p.stock); const qty = toNum($('saQty')?.value);
  if ($('saCurrentStock')) $('saCurrentStock').textContent = `المخزون الحالي: ${fmt(current)} • الحد الأدنى: ${fmt(p.minStock || 5)}`;
  if ($('saAfterStock')) $('saAfterStock').textContent = `بعد التسوية: ${fmt(roundMoney(current + qty))}`;
}
async function saveStockAdjustment() {
  const prodId = $('saProductSelect').value; const type = $('saType').value;
  const qty = toNum($('saQty').value); const note = $('saNote').value.trim();
  const p = state.products.find(x => x.id === prodId); if (!p) return warn('خطأ', 'اختر منتجاً');
  if (qty === 0) return warn('تنبيه', 'أدخل كمية غير صفرية');
  const before = toNum(p.stock); p.stock = roundMoney(before + qty);
  const mv = addStockMovement(p.id, type, qty, before, p.stock, note || 'تسوية يدوية', '');
  logAudit('تسوية مخزون', `${p.name}: ${qty > 0 ? '+' : ''}${fmt(qty)} (من ${fmt(before)} إلى ${fmt(p.stock)})`);
  const ok = await saveToStorage();
  if (!ok) { p.stock = before; if (mv) state.stockMovements = state.stockMovements.filter(m => m.id !== mv.id); return; }
  closeModal('stockAdjustmentModal'); renderInventoryTable(); renderProductsTable(); renderPosProducts(); updateInventoryBadge();
  toast('تم حفظ التسوية');
}
function openReceiveStockModal() {
  receiveStockDraft = {};
  if ($('rsSearch')) $('rsSearch').value = '';
  renderReceiveStockList(); openModal('receiveStockModal');
}
function renderReceiveStockList() {
  const container = $('rsProductsList'); if (!container) return;
  const q = normalizeArabic(($('rsSearch')?.value || '').trim());
  const list = filterDeleted('products', state.products).filter(p => p.trackStock && (!q || normalizeArabic(p.name).includes(q) || normalizeArabic(p.sku).includes(q)));
  container.innerHTML = list.map(p => {
    const val = receiveStockDraft[p.id] || '';
    return `<div class="flex items-center justify-between gap-2 p-2 bg-slate-50 rounded-lg border">
      <div class="min-w-0"><div class="text-xs font-bold text-slate-800 truncate">${esc(p.name)}</div><div class="text-[11px] text-slate-500">المخزون الحالي: ${fmt(p.stock)}</div></div>
      <input type="number" min="0" step="any" value="${val}" onchange="receiveStockDraft['${esc(p.id)}'] = this.value" placeholder="كمية مستلمة" class="w-28 bg-white border rounded-lg px-2 py-1 text-xs font-bold text-center">
    </div>`;
  }).join('') || `<div class="text-xs text-slate-400 text-center py-6">لا توجد منتجات مُتتبعة مطابقة</div>`;
}
async function saveReceiveStock() {
  const entries = Object.entries(receiveStockDraft).filter(([_, v]) => toNum(v) > 0);
  if (!entries.length) return warn('تنبيه', 'أدخل كمية مستلمة لمنتج واحد على الأقل');
  const snapshots = [], addedMovements = [];
  for (const [prodId, qtyRaw] of entries) {
    const p = state.products.find(x => x.id === prodId); if (!p) continue;
    const qty = roundMoney(toNum(qtyRaw)); const before = toNum(p.stock);
    snapshots.push({ productId: p.id, before }); p.stock = roundMoney(before + qty);
    const mv = addStockMovement(p.id, 'purchase', qty, before, p.stock, 'استلام بضاعة', '');
    if (mv) addedMovements.push(mv.id);
    logAudit('استلام بضاعة', `${p.name}: +${fmt(qty)} (المخزون الآن: ${fmt(p.stock)})`);
  }
  const ok = await saveToStorage();
  if (!ok) { snapshots.forEach(s => { const p = state.products.find(x => x.id === s.productId); if (p) p.stock = s.before; }); state.stockMovements = state.stockMovements.filter(m => !addedMovements.includes(m.id)); return; }
  closeModal('receiveStockModal'); renderInventoryTable(); renderProductsTable(); renderPosProducts(); updateInventoryBadge();
  toast(`تم استلام بضاعة لـ ${entries.length} منتج`);
}
function renderStockMovements() {
  const listEl = $('stockMovementsList'); if (!listEl) return;
  const q = normalizeArabic(($('mvSearch')?.value || '').trim());
  const typeFilter = $('mvTypeFilter')?.value || 'all';
  const list = [...(state.stockMovements || [])].filter(m => {
    if (typeFilter !== 'all' && m.type !== typeFilter) return false;
    return !q || normalizeArabic(m.productName).includes(q) || normalizeArabic(m.note).includes(q);
  }).sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 200);
  if ($('mvCountBadge')) $('mvCountBadge').textContent = fmt(list.length);
  const typeLabels = { sale: ['بيع', 'bg-rose-100 text-rose-800'], return: ['مرتجع', 'bg-emerald-100 text-emerald-800'], purchase: ['شراء', 'bg-blue-100 text-blue-800'], adjustment: ['تسوية', 'bg-purple-100 text-purple-800'], initial: ['افتتاحي', 'bg-amber-100 text-amber-800'] };
  listEl.innerHTML = list.map(m => {
    const [label, badgeClass] = typeLabels[m.type] || [m.type, 'bg-slate-100 text-slate-700'];
    const qtySign = toNum(m.qty) > 0 ? `+${fmt(m.qty)}` : fmt(m.qty);
    return `<tr class="border-b border-slate-100 hover:bg-slate-50">
      <td class="p-2.5 text-xs text-slate-500 whitespace-nowrap">${esc(m.date || '')}</td>
      <td class="p-2.5 font-bold text-slate-800">${esc(m.productName || '')}</td>
      <td class="p-2.5"><span class="px-2 py-0.5 rounded text-[11px] font-bold ${badgeClass}">${label}</span></td>
      <td class="p-2.5 text-center font-bold ${toNum(m.qty) > 0 ? 'text-emerald-700' : 'text-rose-600'}">${qtySign}</td>
      <td class="p-2.5 text-center text-xs text-slate-600">${fmt(m.beforeStock)} ← <b>${fmt(m.afterStock)}</b></td>
      <td class="p-2.5 text-xs text-slate-500">${esc(m.note || '-')}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="6" class="p-6 text-center text-slate-400 text-sm">لا توجد حركات مخزون</td></tr>`;
}

document.addEventListener('DOMContentLoaded', async () => {
  try { await loadFromStorage(); } catch (_) { return; }
  setReportRange(0); renderAll();
  const ov = $('pinOverlay');
  if (ov) { ov.classList.remove('hidden'); ov.style.display = 'flex'; }
  if (window.FireSync && typeof window.FireSync.init === 'function') window.FireSync.init();
});

document.addEventListener('keydown', e => {
  if (e.key === 'F2') { e.preventDefault(); openDirectSaleModal(); }
  if (e.key === 'F4') { e.preventDefault(); checkoutPOS(); }
  if (e.key === 'Escape') {
    if ($('barcodeScannerModal') && !$('barcodeScannerModal').classList.contains('hidden')) { closeBarcodeScanner(); return; }
    MODAL_IDS.forEach(id => closeModal(id));
  }
});
