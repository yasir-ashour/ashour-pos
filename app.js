/* ==========================================================================
   app.js — الجزء الأول
   ========================================================================== */

const CURRENCY = 'ل.س.ج';
const $ = id => document.getElementById(id);

// ===== Utilities =====
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
    return '$' + usd.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  }
  return `${fmt(n)} ل.س.ج`;
}
function fmtDual(sypAmount) {
  const usd = toNum(sypAmount) / toNum(state.exchangeRate || 15000);
  return `${fmt(sypAmount)} ل.س.ج (≈ $${usd.toFixed(2)})`;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"'\\]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#8217;','\\':'&#8726;'}[c]));
}
function normalizeArabic(str) {
  return String(str || '').toLowerCase().replace(/[أآإٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[\u064b-\u065f]/g, '');
}
function dayKey(ts) { const d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function nowStr() { return new Date().toLocaleString('ar-SY'); }
function debounce(fn, ms = 250) { let t = null; return function(...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); }; }

const warn = (title, text, icon = 'warning') => Swal.fire({ icon, title, text, confirmButtonColor: '#0F5C4E' });
const toast = (title, icon = 'success') => Swal.fire({ toast: true, position: 'top-end', icon, title, showConfirmButton: false, timer: 1600 });

const debouncedRenderPosProducts = debounce(() => renderPosProducts(), 180);
const debouncedPopulatePosClients = debounce(() => populatePosClients(), 180);
const debouncedRenderInvoicesTable = debounce(() => renderInvoicesTable(), 220);
const debouncedRenderProductsTable = debounce(() => renderProductsTable(), 220);
const debouncedRenderClientsGrid = debounce(() => renderClientsGrid(), 220);
const debouncedRenderCompaniesGrid = debounce(() => renderCompaniesGrid(), 220);
const debouncedRenderInventoryTable = debounce(() => renderInventoryTable(), 200);
const debouncedRenderStockMovements = debounce(() => renderStockMovements(), 200);

const DEFAULT_CATEGORIES = ['بسكويت', 'شيبس', 'عصائر ومشروبات', 'سكاكر وعلكة', 'قهوة', 'مواد غذائية'];

let state = {};
let isCheckoutSubmitting = false;
let currentDebtTab = 'take';
let pendingOrder = null; // { id, cartHash }
let currentInvoicePage = 1;
const INVOICES_PER_PAGE = 50;
let receiveStockDraft = {};

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
    stockMovements: [],
    tombstones: [],
    trash: [],
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

// ===== Tombstones (للحذف الآمن) =====
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

// ===== Trash =====
function addToTrash(col, record) {
  if (!state.trash) state.trash = [];
  state.trash.push({ col, ts: Date.now(), rec: record });
  if (state.trash.length > 2000) state.trash = state.trash.slice(-2000);
}
function removeFromTrash(col, id) {
  if (!state.trash) return;
  const idStr = String(id);
  state.trash = state.trash.filter(t => !(t.col === col && String(t.rec.id) === idStr));
}

// ===== Storage =====
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
  } catch (e) {}
  let h = 5381;
  for (let i = 0; i < txt.length; i++) h = ((h << 5) + h + txt.charCodeAt(i)) | 0;
  return 'f' + (h >>> 0).toString(16);
}

// ===== PIN =====
let enteredPin = '';
function pressPin(n) {
  const targetLen = state.pinLength || 4;
  if (enteredPin.length < 6) {
    enteredPin += n; updatePinDots();
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
  const errEl = $('pinError'); errEl.classList.add('hidden');
  if (state.pinLockUntil && Date.now() < state.pinLockUntil) {
    const secs = Math.ceil((state.pinLockUntil - Date.now()) / 1000);
    errEl.textContent = `محاولات كثيرة. انتظر ${secs} ثانية.`;
    errEl.classList.remove('hidden'); clearPin(); return;
  }
  const h = await hashPin(enteredPin, state.pinSalt);
  if (h === state.pinHash) {
    $('pinOverlay').classList.add('hidden');
    state.pinAttempts = 0; await saveToStorage(); clearPin(); resetAutoLock();
    setTimeout(() => { const q = $('quickEntryInput'); if (q) q.focus(); }, 200);
  } else {
    state.pinAttempts = toNum(state.pinAttempts) + 1;
    const dc = $('pinDots'); dc.classList.add('animate-shake');
    document.querySelectorAll('.pin-dot').forEach(d => d.classList.add('bg-rose-500', 'border-rose-500'));
    setTimeout(() => dc.classList.remove('animate-shake'), 400);
    if (state.pinAttempts >= 5) { state.pinLockUntil = Date.now() + 30000; state.pinAttempts = 0; errEl.textContent = 'قفل 30 ثانية.'; }
    else errEl.textContent = 'رمز PIN غير صحيح';
    errEl.classList.remove('hidden');
    setTimeout(() => clearPin(), 600);
    await saveToStorage();
  }
}
function lockApp() { $('pinOverlay').classList.remove('hidden'); clearPin(); $('pinError').classList.add('hidden'); }
let autoLockTimer = null, lastActivity = 0;
function resetAutoLock() {
  const now = Date.now();
  if (now - lastActivity < 1500) return;
  lastActivity = now;
  clearTimeout(autoLockTimer);
  autoLockTimer = setTimeout(() => { if ($('pinOverlay').classList.contains('hidden')) lockApp(); }, 300000);
}
['click', 'mousemove', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, resetAutoLock, { passive: true }));

function logAudit(type, details) {
  const entry = { ts: Date.now(), date: nowStr(), type, details, status: 'PIN ✓' };
  state.auditLog.unshift(entry);
  if (state.auditLog.length > 500) state.auditLog.length = 500;
  AshourDB.addAudit(entry);
}

// ===== Currency =====
async function toggleCurrency() {
  state.displayCurrency = state.displayCurrency === 'USD' ? 'SYP' : 'USD';
  const btn = $('currencyToggleBtn'), btnD = $('currencyToggleBtnDesktop');
  if (btn) btn.textContent = state.displayCurrency;
  if (btnD) btnD.textContent = state.displayCurrency;
  await saveToStorage(); renderAll();
  toast(`تم التبديل إلى ${state.displayCurrency === 'USD' ? 'الدولار' : 'الليرة السورية'}`, 'info');
}

// ===== Tabs =====
function switchTab(tabId) {
  document.querySelectorAll('.tab-view').forEach(el => { el.classList.add('hidden'); el.classList.remove('active'); });
  const view = $('view-' + tabId);
  if (view) { view.classList.remove('hidden'); setTimeout(() => view.classList.add('active'), 20); }
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('bg-white/20', 'active'));
  const btn = $('tab-' + tabId);
  if (btn) btn.classList.add('bg-white/20', 'active');

  if (tabId === 'settings') { loadStoreInfoToSettings(); refreshStorageStatus(); }
  if (tabId === 'reports') renderReports();
  if (tabId === 'purchases') renderPurchases();
  if (tabId === 'debts') switchDebtTab(currentDebtTab || 'take');
  if (tabId === 'clients') renderClientsGrid();
  if (tabId === 'companies') renderCompaniesGrid();
  if (tabId === 'orders') { renderOrders(); updateOrdersBadge(); }
  if (tabId === 'inventory') { switchInventorySubTab('products'); renderInventoryTable(); updateInventoryBadge(); }

  renderAll();
}

const MODAL_IDS = ['barcodeScannerModal', 'quickProductModal', 'directSaleModal', 'productModal', 'companyModal', 'companyProductModal', 'purchaseModal', 'personDebtModal', 'companyPaymentModal', 'receiptModal', 'clientModal', 'customPricesModal', 'orderModal', 'expenseModal', 'stockAdjustmentModal', 'receiveStockModal'];

window.addEventListener('popstate', () => {
  if ($('barcodeScannerModal') && !$('barcodeScannerModal').classList.contains('hidden')) { closeBarcodeScanner(); history.pushState(null, null, location.href); return; }
  const openMod = MODAL_IDS.find(id => $(id) && !$(id).classList.contains('hidden'));
  if (openMod) { closeModal(openMod); history.pushState(null, null, location.href); return; }
  const activeTab = document.querySelector('.tab-btn.active');
  if (activeTab && activeTab.id !== 'tab-pos') { switchTab('pos'); history.pushState(null, null, location.href); return; }
  Swal.fire({ title: 'هل تريد الخروج من النظام؟', text: 'سيتم إغلاق التطبيق.', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6', confirmButtonText: 'نعم، خروج', cancelButtonText: 'إلغاء' })
    .then(result => { if (result.isConfirmed) history.back(); else history.pushState(null, null, location.href); });
});
history.pushState(null, null, location.href);

// ===== Categories =====
function allCategories() {
  const set = new Set(DEFAULT_CATEGORIES);
  filterDeleted('products', state.products).forEach(p => { if (p.category) set.add(p.category); });
  return [...set];
}
function refreshCategoryWidgets() {
  const cats = allCategories();
  $('categoryList').innerHTML = cats.map(c => `<option value="${esc(c)}"></option>`).join('');
  $('prodCatDropdownList').innerHTML = `<div onclick="selectProdCat('')" class="p-2.5 hover:bg-slate-100 cursor-pointer text-xs font-bold">جميع الفئات</div>` + cats.map(c => `<div onclick="selectProdCat('${esc(c)}')" class="p-2.5 hover:bg-slate-100 cursor-pointer text-xs font-bold">${esc(c)}</div>`).join('');
  initPOSCategories();
}
function selectProdCat(cat) {
  $('prodCategoryFilter').value = cat;
  $('selectedProdCatText').textContent = cat || 'جميع الفئات';
  $('prodCatDropdownList').classList.add('hidden');
  renderProductsTable();
}
function toggleProdCatDropdown() { $('prodCatDropdownList').classList.toggle('hidden'); }
function selectInvoiceStatus(val, label) {
  $('invoiceStatusFilter').value = val;
  $('selectedInvoiceStatusText').textContent = label;
  $('invoiceStatusDropdownList').classList.add('hidden');
  renderInvoicesTable();
}

// ===== Client debt =====
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

// ===== Custom prices =====
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
  renderCustomPricesList(); openModal('customPricesModal');
  setTimeout(() => $('cpSearchInput')?.focus(), 100);
}
function renderCustomPricesList() {
  const editing = state.customPricesEditing; if (!editing) return;
  const q = normalizeArabic(($('cpSearchInput')?.value || '').trim());
  const list = filterDeleted('products', state.products).filter(p =>
    !q || normalizeArabic(p.name).includes(q) || normalizeArabic(p.sku).includes(q) || normalizeArabic(p.barcode).includes(q));
  const setCount = Object.values(editing.draft).filter(v => toNum(v) > 0).length;
  const statsEl = $('cpStats'); if (statsEl) statsEl.textContent = `${setCount} سعر مفعّل`;
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
  const stats = $('cpStats'); if (stats) stats.textContent = `${setCount} سعر مفعّل`;
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

// ===== POS categories =====
function initPOSCategories() {
  const cats = ['الكل', ...allCategories()];
  if (!cats.includes(state.selectedPosCategory)) state.selectedPosCategory = 'الكل';
  const sidebar = $('posCategorySidebar');
  if (sidebar) {
    sidebar.innerHTML = cats.map(cat => {
      const active = state.selectedPosCategory === cat;
      const count = cat === 'الكل' ? filterDeleted('products', state.products).length : filterDeleted('products', state.products).filter(p => p.category === cat).length;
      return `<button onclick="setPosCat('${esc(cat)}')" class="w-full text-right px-2.5 py-2 rounded-lg transition flex items-center justify-between ${active ? 'bg-ashour text-white shadow-sm' : 'bg-slate-50 text-slate-700 hover:bg-slate-100'}"><span>${esc(cat)}</span><span class="text-[11px] num-tabular ${active ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'} px-1.5 py-0.5 rounded-full font-bold">${count}</span></button>`;
    }).join('');
  }
  const mobileBar = $('posCategoryFilter');
  if (mobileBar) {
    mobileBar.innerHTML = cats.map(cat => `<button onclick="setPosCat('${esc(cat)}')" class="px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition ${state.selectedPosCategory === cat ? 'bg-ashour text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}">${esc(cat)}</button>`).join('');
  }
}
function setPosCat(cat) { state.selectedPosCategory = cat; initPOSCategories(); renderPosProducts(); }

// ===== POS client =====
function getSelectedPosClient() {
  const id = $('posClientSelect').value || 'c1';
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
    badge.className = isWholesale ? 'inline-block bg-amber-100 text-amber-800 text-xs px-2 py-0.5 rounded font-bold mt-1' : 'inline-block bg-emerald-100 text-emerald-800 text-xs px-2 py-0.5 rounded font-bold mt-1';
  }
  if (invBadge) {
    invBadge.textContent = `تسعيرة: ${isWholesale ? 'جملة' : 'تجزئة'}${!state.posPriceOverride && customCount > 0 ? ' (أسعار خاصة)' : ''}`;
    invBadge.className = isWholesale ? 'text-[11px] px-2 py-0.5 rounded-full font-bold bg-amber-400 text-slate-950' : 'text-[11px] px-2 py-0.5 rounded-full font-bold bg-emerald-500/25 text-white border border-white/20';
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
  // ✅ إصلاح: الافتراضي دائماً هو الزبون النقدي، وليس أول زبون في القائمة
  if (!$('posClientSelect').value) {
    const c1 = state.clients.find(c => c.id === 'c1');
    if (c1) { $('posClientSelect').value = 'c1'; $('selectedClientText').textContent = c1.name; }
  }
}
function selectClient(id, label) {
  $('posClientSelect').value = id; $('selectedClientText').textContent = label;
  $('clientDropdownList').classList.add('hidden');
  state.posPriceOverride = null;
  onPosClientChange();
}
function toggleClientDropdown() { $('clientDropdownList').classList.toggle('hidden'); populatePosClients(); }
function onPosClientChange() {
  const client = getSelectedPosClient();
  if (state.cart.length > 0) state.cart.forEach(item => { if (!item.isQuickOnly) delete item.customPrice; });
  updatePosPriceUI(); renderPosProducts(); renderCart();
  if (client && client.id !== 'c1') {
    const cCount = client.customPrices ? Object.values(client.customPrices).filter(v => toNum(v) > 0).length : 0;
    if (cCount > 0) toast(`تم تطبيق ${cCount} سعر خاص لـ ${client.name}`, 'info');
  }
}

// ===== POS products =====
function getStockStatus(product) {
  if (!product || !product.trackStock) return 'untracked';
  const stock = toNum(product.stock);
  const minStock = toNum(product.minStock) || 5;
  if (stock <= 0) return 'out';
  if (stock <= minStock) return 'low';
  return 'ok';
}
function renderPosProducts() {
  const search = normalizeArabic(($('posSearch')?.value || '').trim());
  const client = getSelectedPosClient();
  const filtered = filterDeleted('products', state.products).filter(p => {
    const okCat = state.selectedPosCategory === 'الكل' || p.category === state.selectedPosCategory;
    return okCat && (!search || normalizeArabic(p.name).includes(search) || normalizeArabic(p.sku).includes(search) || normalizeArabic(p.barcode).includes(search));
  });
  if (!filtered.length) { $('posProductsGrid').innerHTML = `<div class="col-span-full text-center py-10 text-slate-400 text-sm font-bold">لا توجد منتجات مطابقة</div>`; return; }
  $('posProductsGrid').innerHTML = filtered.map(p => {
    const resolved = resolveProductPricing(p, client, state.posPriceOverride);
    const price = resolved.price;
    const stockStatus = getStockStatus(p);
    const stockBadge = stockStatus === 'untracked' ? '' : (stockStatus === 'out' ? `<span class="stock-badge out"><i class="fa-solid fa-ban"></i> نفد</span>` : stockStatus === 'low' ? `<span class="stock-badge low"><i class="fa-solid fa-triangle-exclamation"></i> ${toNum(p.stock)}</span>` : `<span class="stock-badge ok"><i class="fa-solid fa-check"></i> ${toNum(p.stock)}</span>`);
    return `<div onclick="addToCart('${esc(p.id)}')" class="bg-white border ${resolved.isCustom ? 'border-purple-300 ring-1 ring-purple-200' : 'border-slate-200'} hover:border-ashour cursor-pointer transition flex flex-col justify-between rounded-xl p-2.5 shadow-sm card-hover relative group">
      ${stockBadge}
      <div>
        <div class="flex items-center justify-between gap-1">
          <span class="text-[11px] text-ashour font-bold bg-ashour/10 px-1.5 py-0.5 rounded w-fit num-tabular">${esc(p.sku || '-')}</span>
          ${resolved.isCustom ? `<span class="text-[10px] bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded font-bold">سعر خاص</span>` : ''}
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
  const input = ev.target; const val = input.value.trim(); if (!val) return;
  let code = val, qty = 1;
  if (val.includes('*')) { const parts = val.split('*'); code = parts[0].trim(); qty = Math.max(1, parseInt(parts[1].trim(), 10) || 1); }
  const product = filterDeleted('products', state.products).find(p =>
    String(p.barcode || '').trim() === code || String(p.sku || '').trim() === code || normalizeArabic(p.name) === normalizeArabic(code));
  if (!product) {
    Swal.fire({ icon: 'question', title: 'رمز غير موجود', text: `لم يتم العثور على منتج بالرمز (${code}). هل تريد فتح منتج سريع؟`, showCancelButton: true, confirmButtonColor: '#4f46e5', cancelButtonColor: '#64748b', confirmButtonText: 'فتح منتج سريع', cancelButtonText: 'إغلاق' })
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
  else state.cart.push({ isQuickOnly: true, quickId: 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2,5), name, price, qty: 1 });
  renderCart(); toast(`تمت إضافة ${name}`);
}

// ===== Cart =====
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
  $('posDiscount').value = ''; $('posPaidAmount').value = '';
  updatePosPriceUI(); renderPosProducts(); renderCart();
}
function getCartItemInfo(item) {
  const client = getSelectedPosClient();
  if (item.isQuickOnly) {
    const unitCost = item.cost != null ? toNum(item.cost) : null;
    return { key: item.quickId, productId: item.quickId, name: item.name, unitPrice: toNum(item.price), unitCost: unitCost, isQuickOnly: true, isCustom: false };
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
  const container = $('cartItemsList');
  const { subtotal, total, discount, discountPct } = cartTotals();
  if (!state.cart.length) {
    container.innerHTML = `<div class="text-center py-10 text-slate-400"><i class="fa-solid fa-basket-shopping text-3xl mb-2 opacity-40"></i><p class="text-xs font-bold">السلة فارغة.</p></div>`;
  } else {
    container.innerHTML = state.cart.map(item => {
      const info = getCartItemInfo(item); if (!info) return '';
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
    if (shouldWarn) { $('discountPctText').textContent = `${discountPct}%`; warnBadge.classList.remove('hidden'); }
    else { warnBadge.classList.add('hidden'); $('discountPctText').textContent = '0%'; }
  }
  $('cartSubtotal').textContent = fmtDual(subtotal);
  $('cartTotal').textContent = fmtDual(total);
  $('posPaidAmount').placeholder = `الإجمالي: ${fmt(total)}`;
  updatePaymentSummaryPreview();
}
function setPaidExact() { const total = cartTotals().total; $('posPaidAmount').value = state.displayCurrency === 'USD' ? roundMoney(total / state.exchangeRate) : total; updatePaymentSummaryPreview(); }
function setCreditMode() { $('posPaidAmount').value = 0; updatePaymentSummaryPreview(); }
function setPaidAmount(amt) { $('posPaidAmount').value = state.displayCurrency === 'USD' ? roundMoney(amt / state.exchangeRate) : amt; updatePaymentSummaryPreview(); }
function updatePaymentSummaryPreview() {
  const { total } = cartTotals();
  const raw = $('posPaidAmount').value.trim();
  let paidEntered = raw === '' ? total : Math.max(0, toNum(raw));
  if (state.displayCurrency === 'USD' && raw !== '') paidEntered = paidEntered * state.exchangeRate;
  const labelEl = $('posBalanceLabel'), valEl = $('posBalanceValue');
  if (!labelEl || !valEl) return;
  if (paidEntered > total) {
    const change = roundMoney(paidEntered - total);
    labelEl.textContent = 'الباقي للزبون:'; valEl.textContent = fmtCur(change); valEl.className = 'text-emerald-700 font-bold';
  } else {
    const remaining = roundMoney(total - paidEntered);
    labelEl.textContent = 'المتبقي (دين):'; valEl.textContent = fmtCur(remaining); valEl.className = remaining > 0 ? 'text-rose-600 font-bold' : 'text-slate-700 font-bold';
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

// ===== Stock helpers =====
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
function adjustStock(productId, delta, type, note, refId) {
  const product = state.products.find(p => p.id === productId);
  if (!product || !product.trackStock) return false;
  const before = toNum(product.stock);
  const after = roundMoney(before + toNum(delta));
  product.stock = after;
  addStockMovement(productId, type, delta, before, after, note, refId);
  return true;
}

// ===== Checkout =====
function nextInvoiceNumber() {
  state.invoiceCounter = toNum(state.invoiceCounter || 1000) + 1;
  return 'INV-' + state.invoiceCounter;
}
function computeCartHash(cart) {
  return cart.map(i => `${i.productId || i.quickId}:${i.qty}`).sort().join('|');
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
    const inv = { id: nextInvoiceNumber(), ts: Date.now(), date: nowStr(), clientId: client.id, clientName: client.name, priceMode: priceModeLabel, paymentType, items, discount, total, paid: paidRecorded, remaining, changeGiven, profit: roundMoney(total - cost), status: 'active' };

    const previousInvoices = [...state.invoices];
    state.invoices.push(inv);

    // خصم المخزون
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

    // ✅ إغلاق الطلب المرتبط فقط إذا لم تتغيّر السلة
    if (pendingOrder) {
      const currentHash = computeCartHash(state.cart);
      if (currentHash === pendingOrder.cartHash) {
        const o = state.orders.find(x => x.id === pendingOrder.id);
        if (o && o.status === 'pending') { o.status = 'delivered'; o.deliveredAt = Date.now(); o.invoiceId = inv.id; await saveToStorage(); renderOrders(); updateOrdersBadge(); }
      } else {
        toast('تم حفظ الفاتورة لكن الطلب لم يُغلق (تغيّرت السلة)', 'info');
      }
      pendingOrder = null;
    }

    showReceiptModal(inv);
    state.cart = []; state.posPriceOverride = null;
    $('posPaidAmount').value = ''; $('posDiscount').value = '';
    updatePosPriceUI(); renderPosProducts(); renderCart();
    updateInventoryBadge(); renderAll();
    toast('تم حفظ الفاتورة');
  } finally {
    setTimeout(() => { isCheckoutSubmitting = false; if (saveBtn) saveBtn.disabled = false; }, 500);
  }
}

// ===== Barcode =====
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

// ===== Direct sale =====
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
  closeModal('directSaleModal'); renderAll(); toast(`تم تسجيل ${qty} × ${name}`);
}

// ===== Products =====
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
  const list = filterDeleted('products', state.products).filter(p =>
    (!cat || p.category === cat) && (!search || normalizeArabic(p.name).includes(search) || normalizeArabic(p.sku).includes(search) || normalizeArabic(p.barcode).includes(search)));
  if ($('prodCountBadge')) $('prodCountBadge').textContent = fmt(list.length);
  $('productsTableBody').innerHTML = list.map(p => {
    const status = getStockStatus(p);
    const stockCell = status === 'untracked' ? '<span class="text-slate-400">—</span>' :
      status === 'out' ? `<span class="bg-rose-100 text-rose-700 px-2 py-0.5 rounded text-[11px] font-bold">نفد (${toNum(p.stock)})</span>` :
      status === 'low' ? `<span class="bg-amber-100 text-amber-800 px-2 py-0.5 rounded text-[11px] font-bold">${toNum(p.stock)} ⚠️</span>` :
      `<span class="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded text-[11px] font-bold">${toNum(p.stock)}</span>`;
    return `<tr class="hover:bg-slate-50 border-b border-slate-100">
      <td class="p-3 text-ashour font-bold">${esc(p.sku || '-')} <br><span class="text-[11px] text-slate-500 font-normal">${esc(p.barcode || '')}</span></td>
      <td class="p-3 font-bold text-indigo-700">${esc(p.name)}</td>
      <td class="p-3"><span class="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-[11px]">${esc(p.category || '-')}</span></td>
      <td class="p-3 text-slate-600">${fmtCur(p.cost)}</td>
      <td class="p-3 text-emerald-800">${fmtCur(p.retailPrice)}</td>
      <td class="p-3 text-amber-800">${fmtCur(p.wholesalePrice)}</td>
      <td class="p-3">${stockCell}</td>
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
  closeModal('productModal'); refreshCategoryWidgets(); renderAll(); updateInventoryBadge();
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
      renderAll(); updateInventoryBadge();
    });
}

// ===== Quick product =====
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
// ===== Clients =====
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
  const q = normalizeArabic(($('clientSearch')?.value || '').trim());
  const list = filterDeleted('clients', state.clients).filter(c => !q || normalizeArabic(c.name).includes(q) || (c.phone || '').includes(q));
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
      <button type="button" onclick="removeClientSpecialPrice('${esc(clientId)}', '${esc(prodId)}')" title="إزالة" class="text-rose-500 hover:text-rose-700 text-xs"><i class="fa-solid fa-xmark"></i></button>
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
      <td class="p-3 text-emerald-700 whitespace-nowrap">${r.credit ? fmtCur(r.credit) : '—'}</td>
      <td class="p-3 text-center whitespace-nowrap">
        ${r.type === 'invoice' ? `<button onclick="viewPastInvoice('${esc(r.id)}')" class="bg-ashour text-white hover:bg-ashour-dark px-2 py-1 rounded text-xs font-bold"><i class="fa-solid fa-receipt"></i></button>` : ''}
        ${r.type === 'payment' ? `<button onclick="deletePayment('${r.id}')" class="text-rose-500 hover:text-rose-700 font-bold text-xs"><i class="fa-solid fa-trash"></i></button>` : ''}
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
            <button type="button" onclick="adjustReturnQty('${esc(item.key)}', -1)" ${item.remainingQty <= 0 ? 'disabled' : ''} class="w-7 h-7 flex items-center justify-center bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 rounded font-bold transition">−</button>
            <input type="number" id="returnQty_${esc(item.key)}" min="1" max="${item.remainingQty}" value="${item.remainingQty > 0 ? 1 : 0}" ${item.remainingQty <= 0 ? 'disabled' : ''} class="w-10 text-center border-none focus:outline-none text-sm font-bold bg-transparent num-tabular">
            <button type="button" onclick="adjustReturnQty('${esc(item.key)}', 1)" ${item.remainingQty <= 0 ? 'disabled' : ''} class="w-7 h-7 flex items-center justify-center bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 rounded font-bold transition">+</button>
          </div>
          <button onclick="submitClientReturn('${esc(clientId)}', '${esc(item.name)}', ${item.price}, ${item.cost}, '${esc(item.key)}', '${esc(item.productId || '')}')" ${item.remainingQty <= 0 ? 'disabled' : ''} class="bg-ashour hover:bg-ashour-dark disabled:opacity-40 text-white px-3 py-1.5 rounded-md text-xs font-bold transition">تأكيد الإرجاع</button>
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
  // إعادة الكمية إلى المخزون
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
  renderLedgerSummary(clientId); renderClientReturnsTab(clientId); renderReports(); updateInventoryBadge();
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

// ===== Companies =====
function getCompanyDebt(companyId) {
  const purchasesRemaining = sumList(state.purchases.filter(p => p.companyId === companyId && p.status === 'active'), p => p.remaining);
  const paymentsMade = sumList(state.companyPayments.filter(p => p.companyId === companyId), p => p.amount);
  return Math.max(0, roundMoney(purchasesRemaining - paymentsMade));
}
function renderCompaniesGrid() {
  const q = normalizeArabic(($('companySearch')?.value || '').trim());
  const list = filterDeleted('companies', state.companies).filter(comp => !q || normalizeArabic(comp.name).includes(q) || (comp.phone || '').includes(q));
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
      <button onclick="openCompanyProductEditModal(${idx})" class="bg-white border border-slate-300 text-indigo-600 hover:bg-indigo-50 w-8 h-8 rounded-lg flex items-center justify-center shadow-sm transition"><i class="fa-solid fa-pen"></i></button>
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

// ===== Purchases =====
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
  $('purchasesTableBody').innerHTML = list.map(p => {
    const comp = state.companies.find(c => c.id === p.companyId) || { name: p.companyName || 'غير معروف' };
    return `<tr class="hover:bg-slate-50 border-b border-slate-100">
      <td class="p-3 text-slate-800 font-bold">${esc(String(p.code || p.id).slice(0, 6))}</td>
      <td class="p-3 text-slate-500 whitespace-nowrap">${esc(p.date)}</td>
      <td class="p-3 text-slate-800 font-bold">${esc(comp.name)}</td>
      <td class="p-3 text-slate-800">${fmtCur(p.total)}</td>
      <td class="p-3 text-emerald-700">${fmtCur(p.paid)}</td>
      <td class="p-3 text-rose-600 font-bold">${fmtCur(p.remaining)}</td>
      <td class="p-3 text-center"><button onclick="deletePurchase('${esc(p.id)}')" class="text-rose-500 hover:text-rose-700"><i class="fa-solid fa-trash"></i></button></td>
    </tr>`;
  }).join('') || `<tr><td colspan="7" class="p-6 text-center text-slate-400 text-sm">لا توجد مشتريات مسجلة</td></tr>`;
}
function deletePurchase(id) {
  Swal.fire({ title: 'حذف فاتورة الشراء؟', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6', confirmButtonText: 'نعم', cancelButtonText: 'إلغاء' })
    .then(async res => {
      if (!res.isConfirmed) return;
      const removed = state.purchases.find(p => p.id === id);
      state.purchases = state.purchases.filter(p => p.id !== id);
      if (removed) { addTombstone('purchases', removed.id); addToTrash('purchases', removed); }
      logAudit('حذف فاتورة شراء', removed ? `كود ${removed.code || removed.id}` : id);
      const ok = await saveToStorage();
      if (!ok) { if (removed) state.purchases.push(removed); return; }
      renderPurchases(); renderCompaniesGrid(); toast('تم الحذف');
    });
}
function openCompanyPaymentModal() { $('payCompanyAmount').value = ''; $('payCompanyNotes').value = ''; openModal('companyPaymentModal'); }
async function recordCompanyPayment() {
  let amount = toNum($('payCompanyAmount').value);
  const notes = $('payCompanyNotes').value.trim();
  if (!(amount > 0)) return warn('خطأ', 'أدخل مبلغاً صحيحاً');
  if (state.displayCurrency === 'USD') amount = amount * state.exchangeRate;
  const comp = state.companies.find(c => c.id === state.activeCompanyId);
  const newPayment = { id: 'CPAY-' + Date.now(), ts: Date.now(), date: nowStr(), companyId: state.activeCompanyId, amount, notes };
  state.companyPayments.push(newPayment);
  logAudit('تسديد لشركة', `${comp ? comp.name : ''} — مبلغ ${fmtCur(amount)}`);
  const ok = await saveToStorage();
  if (!ok) { state.companyPayments.pop(); return; }
  closeModal('companyPaymentModal'); openCompanyDetailPage(state.activeCompanyId); toast('تم تسجيل الدفعة');
}

// ===== Person Debts =====
function switchDebtTab(type) {
  currentDebtTab = type === 'give' ? 'give' : 'take';
  const isTake = currentDebtTab === 'take';
  const takeBtn = $('debtTabTake'), giveBtn = $('debtTabGive');
  if (takeBtn) takeBtn.className = isTake ? 'px-5 py-2 rounded-xl text-sm font-bold transition bg-emerald-600 text-white' : 'px-5 py-2 rounded-xl text-sm font-bold transition bg-slate-100 text-slate-700 hover:bg-slate-200';
  if (giveBtn) giveBtn.className = !isTake ? 'px-5 py-2 rounded-xl text-sm font-bold transition bg-rose-600 text-white' : 'px-5 py-2 rounded-xl text-sm font-bold transition bg-slate-100 text-slate-700 hover:bg-slate-200';
  const head = $('debtTableHead'); if (head) head.className = isTake ? 'bg-emerald-700 text-white font-bold' : 'bg-rose-700 text-white font-bold';
  const addLabel = $('debtAddBtnLabel'); if (addLabel) addLabel.textContent = isTake ? 'لي' : 'له';
  $('debtSummaryTake')?.classList.toggle('hidden', !isTake);
  $('debtSummaryGive')?.classList.toggle('hidden', isTake);
  renderPersonDebts();
}
function renderPersonDebts() {
  const type = currentDebtTab || 'take';
  const isTake = type === 'take';
  const list = state.personDebts.filter(d => (d.type || 'take') === type);
  const totalTake = sumList(state.personDebts.filter(d => d.type === 'take'), d => d.amount);
  const totalGive = sumList(state.personDebts.filter(d => d.type === 'give'), d => d.amount);
  if ($('debtSumTake')) $('debtSumTake').textContent = fmtCur(totalTake);
  if ($('debtSumGive')) $('debtSumGive').textContent = fmtCur(totalGive);
  $('personDebtsTableBody').innerHTML = list.map(d => `
    <tr class="hover:bg-slate-50 border-b border-slate-100">
      <td class="p-3 font-bold text-slate-800">${esc(d.name)}</td>
      <td class="p-3 text-slate-600">${esc(d.phone || '-')}</td>
      <td class="p-3 font-bold ${isTake ? 'text-emerald-700' : 'text-rose-600'}">${fmtCur(d.amount)}</td>
      <td class="p-3 text-slate-500">${esc(d.notes || '-')}</td>
      <td class="p-3 text-center"><button onclick="deletePersonDebt('${esc(d.id)}')" class="text-rose-500 hover:text-rose-700"><i class="fa-solid fa-trash"></i></button></td>
    </tr>`).join('') || `<tr><td colspan="5" class="p-6 text-center text-slate-400 text-sm">لا توجد ديون مسجلة في هذا التبويب</td></tr>`;
}
function openPersonDebtModal(type) {
  $('debtPersonName').value = ''; $('debtPersonPhone').value = ''; $('debtPersonAmount').value = ''; $('debtPersonNotes').value = '';
  const val = type || currentDebtTab || 'take';
  document.querySelectorAll('input[name="debtTypeRadio"]').forEach(r => { r.checked = r.value === val; });
  openModal('personDebtModal');
}
async function savePersonDebt() {
  const name = $('debtPersonName').value.trim();
  const phone = $('debtPersonPhone').value.trim();
  const typeEl = document.querySelector('input[name="debtTypeRadio"]:checked');
  const type = typeEl ? typeEl.value : 'take';
  let amount = toNum($('debtPersonAmount').value);
  const notes = $('debtPersonNotes').value.trim();
  if (!name) return warn('خطأ', 'أدخل اسم الشخص');
  if (!(amount > 0)) return warn('خطأ', 'أدخل مبلغاً صحيحاً');
  if (state.displayCurrency === 'USD') amount = amount * state.exchangeRate;
  const newDebt = { id: 'DEBT-' + Date.now(), ts: Date.now(), name, phone, type, amount, notes };
  state.personDebts.push(newDebt);
  logAudit('دين شخصي', `${name} - ${fmtCur(amount)} (${type === 'take' ? 'لي' : 'له'})`);
  const ok = await saveToStorage();
  if (!ok) { state.personDebts.pop(); return; }
  closeModal('personDebtModal'); currentDebtTab = type; switchDebtTab(type); toast('تم الحفظ');
}
function deletePersonDebt(id) {
  Swal.fire({ title: 'حذف الدين؟', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6', confirmButtonText: 'نعم', cancelButtonText: 'إلغاء' })
    .then(async res => {
      if (!res.isConfirmed) return;
      const removed = state.personDebts.find(d => d.id === id);
      state.personDebts = state.personDebts.filter(d => d.id !== id);
      if (removed) { addTombstone('personDebts', removed.id); addToTrash('personDebts', removed); }
      logAudit('حذف دين شخصي', removed ? removed.name : id);
      const ok = await saveToStorage();
      if (!ok) { if (removed) state.personDebts.push(removed); return; }
      renderPersonDebts(); toast('تم الحذف');
    });
}

// ===== Invoices =====
function renderInvoicesTable() {
  const query = normalizeArabic(($('invoiceSearchInput')?.value || '').trim());
  const statusFilter = $('invoiceStatusFilter')?.value || 'all';
  const fromDate = $('invoiceFromDate')?.value || '';
  const toDate = $('invoiceToDate')?.value || '';

  const invRows = state.invoices.map(inv => {
    const payKind = inv.status === 'cancelled' ? 'cancelled' : (toNum(inv.remaining) > 0 ? (toNum(inv.paid) > 0 ? 'partial' : 'debt') : 'cash');
    return { kind: 'invoice', id: inv.id, ts: inv.ts || 0, date: inv.date, clientName: inv.clientName, total: toNum(inv.total), paid: toNum(inv.paid), remaining: toNum(inv.remaining), profit: toNum(inv.profit), status: inv.status, filterCategory: payKind };
  });
  const directRows = state.directSales.map(ds => ({
    kind: 'direct', id: ds.id, ts: ds.ts || 0, date: ds.date, clientName: `بيع سريع (${ds.qty} × ${ds.name})`,
    total: toNum(ds.total), paid: toNum(ds.paid != null ? ds.paid : ds.total), remaining: toNum(ds.remaining || 0), profit: toNum(ds.profit), status: 'direct', filterCategory: 'cash'
  }));

  const allList = [...invRows, ...directRows].filter(row => {
    if (statusFilter !== 'all' && row.filterCategory !== statusFilter) return false;
    if (fromDate || toDate) { if (!row.ts) return false; const k = dayKey(row.ts || 0); if (fromDate && k < fromDate) return false; if (toDate && k > toDate) return false; }
    if (query && !(normalizeArabic(row.id).includes(query) || normalizeArabic(row.clientName).includes(query))) return false;
    return true;
  }).sort((a, b) => b.ts - a.ts);

  const activeSalesRows = allList.filter(r => r.status !== 'cancelled');
  const totalSales = sumList(activeSalesRows, r => r.total);
  const filteredReturns = state.returns.filter(r => {
    if (!r.ts) return false; const k = dayKey(r.ts);
    if (fromDate && k < fromDate) return false; if (toDate && k > toDate) return false;
    return true;
  });
  const returnsProfitDeduction = sumList(filteredReturns, r => r.profitAdjustment);
  const totalProfit = roundMoney(sumList(activeSalesRows, r => r.profit) - returnsProfitDeduction);
  const totalRemaining = sumList(activeSalesRows, r => r.remaining);

  if ($('invoicesSummaryStrip')) {
    $('invoicesSummaryStrip').innerHTML = `
      <div class="bg-slate-50 border rounded-xl p-2"><span class="block text-xs text-slate-500">عدد السجلات</span><span class="font-bold text-slate-800">${fmt(allList.length)}</span></div>
      <div class="bg-blue-50 border border-blue-200 rounded-xl p-2"><span class="block text-xs text-blue-700">إجمالي المبيعات</span><span class="font-bold text-blue-900">${fmtCur(totalSales)}</span></div>
      <div class="bg-indigo-50 border border-indigo-200 rounded-xl p-2"><span class="block text-xs text-indigo-700">الربح</span><span class="font-bold text-indigo-900">${fmtCur(totalProfit)}</span></div>
      <div class="bg-rose-50 border border-rose-200 rounded-xl p-2"><span class="block text-xs text-rose-700">المتبقي (ديون)</span><span class="font-bold text-rose-700">${fmtCur(totalRemaining)}</span></div>`;
  }

  // ✅ Pagination
  const totalPages = Math.max(1, Math.ceil(allList.length / INVOICES_PER_PAGE));
  if (currentInvoicePage > totalPages) currentInvoicePage = totalPages;
  const start = (currentInvoicePage - 1) * INVOICES_PER_PAGE;
  const list = allList.slice(start, start + INVOICES_PER_PAGE);

  $('invoicesTableBody').innerHTML = list.map(row => {
    if (row.kind === 'direct') {
      return `<tr class="hover:bg-amber-50/40 border-b border-slate-100 bg-amber-50/20">
        <td class="p-3 text-amber-700 font-bold">${esc(row.id)}</td>
        <td class="p-3 text-slate-500 whitespace-nowrap">${esc(row.date)}</td>
        <td class="p-3 text-slate-800">${esc(row.clientName)}</td>
        <td class="p-3 text-slate-800">${fmtCur(row.total)}</td>
        <td class="p-3 text-emerald-700">${fmtCur(row.paid)}</td>
        <td class="p-3 text-rose-600">${fmtCur(row.remaining)}</td>
        <td class="p-3 text-indigo-700">${fmtCur(row.profit)}</td>
        <td class="p-3"><span class="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-800">بيع سريع</span></td>
        <td class="p-3 text-center whitespace-nowrap"><button onclick="deleteDirectSale('${esc(row.id)}')" class="text-rose-600 hover:underline font-bold"><i class="fa-solid fa-trash"></i></button></td>
      </tr>`;
    }
    const cancelled = row.status === 'cancelled';
    const statusLabel = cancelled ? 'ملغاة' : (row.filterCategory === 'debt' ? 'آجل / دين' : (row.filterCategory === 'partial' ? 'جزئي' : 'مدفوع'));
    const statusClass = cancelled ? 'bg-rose-100 text-rose-700' : (row.filterCategory === 'debt' ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-800');
    return `<tr class="hover:bg-slate-50 border-b border-slate-100 ${cancelled ? 'opacity-60' : ''}">
      <td class="p-3 text-ashour font-bold">${esc(row.id)}</td>
      <td class="p-3 text-slate-500 whitespace-nowrap">${esc(row.date)}</td>
      <td class="p-3 text-slate-800">${esc(row.clientName)}</td>
      <td class="p-3 text-slate-800 ${cancelled ? 'line-through' : ''}">${fmtCur(row.total)}</td>
      <td class="p-3 text-emerald-700">${fmtCur(row.paid)}</td>
      <td class="p-3 text-rose-600">${fmtCur(row.remaining)}</td>
      <td class="p-3 text-indigo-700">${cancelled ? '—' : fmtCur(row.profit)}</td>
      <td class="p-3"><span class="px-2 py-0.5 rounded text-[11px] font-bold ${statusClass}">${statusLabel}</span></td>
      <td class="p-3 text-center whitespace-nowrap">
        <button onclick="viewPastInvoice('${esc(row.id)}')" class="text-ashour hover:underline font-bold ml-2"><i class="fa-solid fa-eye"></i></button>
        ${cancelled ? '' : `<button onclick="cancelInvoice('${esc(row.id)}')" class="text-rose-600 hover:underline font-bold"><i class="fa-solid fa-ban"></i></button>`}
      </td>
    </tr>`;
  }).join('') || `<tr><td colspan="9" class="p-6 text-center text-slate-400 text-sm">لا توجد سجلات مطابقة</td></tr>`;

  // أزرار الترقيم
  if ($('invoicesPagination')) {
    $('invoicesPagination').innerHTML = `
      <button onclick="changeInvoicePage(-1)" ${currentInvoicePage <= 1 ? 'disabled' : ''} class="px-3 py-1.5 bg-white border rounded-lg font-bold disabled:opacity-50">السابق</button>
      <span>صفحة ${currentInvoicePage} من ${totalPages} — عرض ${list.length} من ${allList.length}</span>
      <button onclick="changeInvoicePage(1)" ${currentInvoicePage >= totalPages ? 'disabled' : ''} class="px-3 py-1.5 bg-white border rounded-lg font-bold disabled:opacity-50">التالي</button>`;
  }
}
function changeInvoicePage(delta) {
  currentInvoicePage = Math.max(1, currentInvoicePage + delta);
  renderInvoicesTable();
}
function deleteDirectSale(id) {
  Swal.fire({ title: 'حذف سجل البيع السريع؟', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6', confirmButtonText: 'نعم', cancelButtonText: 'إلغاء' })
    .then(async res => {
      if (!res.isConfirmed) return;
      const removed = state.directSales.find(d => d.id === id);
      state.directSales = state.directSales.filter(d => d.id !== id);
      if (removed) { addTombstone('directSales', removed.id); addToTrash('directSales', removed); }
      logAudit('حذف بيع سريع', removed ? `${removed.name} (${fmtCur(removed.total)})` : id);
      const ok = await saveToStorage();
      if (!ok) { if (removed) state.directSales.push(removed); return; }
      renderAll(); toast('تم الحذف');
    });
}
function viewPastInvoice(id) {
  const inv = state.invoices.find(i => i.id === id);
  if (inv) showReceiptModal(inv);
}
function cancelInvoice(id) {
  const inv = state.invoices.find(i => i.id === id);
  if (!inv || inv.status === 'cancelled') return;
  const paidAmount = toNum(inv.paid);
  Swal.fire({
    title: 'إلغاء الفاتورة؟',
    html: paidAmount > 0 ? `الفاتورة ${inv.id} تحتوي على مبلغ مدفوع <b>(${fmtCur(paidAmount)})</b>.<br><br>سيُسجَّل هذا المبلغ كـ<b>استرداد</b> للزبون تلقائياً.` : `سيتم إلغاء الفاتورة ${inv.id}.`,
    icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6', confirmButtonText: 'نعم، إلغاء', cancelButtonText: 'تراجع'
  }).then(async res => {
    if (!res.isConfirmed) return;
    const prevStatus = inv.status, prevCancelledAt = inv.cancelledAt;
    const prevPayments = [...state.payments];
    const stockSnapshots = [];
    inv.status = 'cancelled'; inv.cancelledAt = Date.now();
    let refundNote = '';
    if (paidAmount > 0) {
      state.payments.push({ id: 'REFUND-' + Date.now(), ts: Date.now(), date: nowStr(), clientId: inv.clientId, amount: -paidAmount, note: `استرداد فاتورة ملغاة ${inv.id}` });
      refundNote = ` — استرداد ${fmtCur(paidAmount)}`;
    }
    // إعادة المخزون
    inv.items.forEach(it => {
      if (!it.productId || it.isQuickOnly) return;
      const p = state.products.find(x => x.id === it.productId);
      if (p && p.trackStock) {
        const before = toNum(p.stock);
        stockSnapshots.push({ productId: p.id, before });
        p.stock = roundMoney(before + toNum(it.qty));
        addStockMovement(p.id, 'return', toNum(it.qty), before, p.stock, `إلغاء فاتورة ${inv.id}`, inv.id);
      }
    });
    logAudit('إلغاء فاتورة', `${inv.id} (${inv.clientName} — ${fmtCur(inv.total)})${refundNote}`);
    const ok = await saveToStorage();
    if (!ok) {
      inv.status = prevStatus; if (prevCancelledAt) inv.cancelledAt = prevCancelledAt; else delete inv.cancelledAt;
      state.payments = prevPayments;
      stockSnapshots.forEach(s => { const p = state.products.find(x => x.id === s.productId); if (p) p.stock = s.before; });
      state.stockMovements = state.stockMovements.filter(m => m.refId !== inv.id);
      return;
    }
    renderAll(); updateInventoryBadge(); toast('أُلغيت الفاتورة');
  });
}

// ===== Expenses =====
function openExpenseModal() { $('expTitle').value = ''; $('expAmount').value = ''; $('expNotes').value = ''; openModal('expenseModal'); }
async function saveExpense() {
  const title = $('expTitle').value.trim();
  let amount = toNum($('expAmount').value);
  const notes = $('expNotes').value.trim() || '-';
  if (!title || !(amount > 0)) return warn('خطأ', 'أدخل البند والمبلغ');
  if (state.displayCurrency === 'USD') amount = amount * state.exchangeRate;
  const newExp = { id: 'EXP-' + Date.now(), ts: Date.now(), date: nowStr(), title, amount, notes };
  state.expenses.push(newExp);
  logAudit('مصروف', `${title} ${fmtCur(amount)}`);
  const ok = await saveToStorage();
  if (!ok) { state.expenses.pop(); return; }
  closeModal('expenseModal'); renderAll(); toast('تم التسجيل');
}
function deleteExpense(id) {
  Swal.fire({ title: 'حذف المصروف؟', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6', confirmButtonText: 'نعم', cancelButtonText: 'إلغاء' })
    .then(async res => {
      if (!res.isConfirmed) return;
      const removed = state.expenses.find(e => e.id === id);
      state.expenses = state.expenses.filter(e => e.id !== id);
      if (removed) { addTombstone('expenses', removed.id); addToTrash('expenses', removed); }
      logAudit('حذف مصروف', removed ? `${removed.title} ${fmtCur(removed.amount)}` : id);
      const ok = await saveToStorage();
      if (!ok) { if (removed) state.expenses.push(removed); return; }
      renderAll();
    });
}
function renderExpensesTable() {
  const list = [...state.expenses].sort((a, b) => (b.ts || 0) - (a.ts || 0));
  $('expensesTableBody').innerHTML = list.map(e => `<tr class="hover:bg-slate-50 border-b border-slate-100"><td class="p-3 text-slate-500 whitespace-nowrap">${esc(e.date)}</td><td class="p-3 font-bold text-slate-800">${esc(e.title)}</td><td class="p-3 text-purple-700 font-bold">${fmtCur(e.amount)}</td><td class="p-3 text-slate-600">${esc(e.notes)}</td><td class="p-3 text-center"><button onclick="deleteExpense('${esc(e.id)}')" class="bg-rose-100 text-rose-600 hover:bg-rose-600 hover:text-white px-2.5 py-1 rounded transition text-xs font-bold"><i class="fa-solid fa-trash"></i></button></td></tr>`).join('') || `<tr><td colspan="5" class="p-6 text-center text-slate-400 text-sm">لا توجد مصاريف</td></tr>`;
}

// ===== Reports =====
let lastReport = null;
function setReportRange(days) {
  const to = new Date(), from = new Date();
  if (days > 0) from.setDate(from.getDate() - days + 1);
  $('repFrom').value = dayKey(from.getTime()); $('repTo').value = dayKey(to.getTime());
  renderReports();
}
function renderReports() {
  if (!$('repFrom').value) setReportRange(0);
  const from = $('repFrom').value, to = $('repTo').value;
  const inRange = ts => { if (!ts) return false; const k = dayKey(ts); return k >= from && k <= to; };
  const invs = state.invoices.filter(i => i.status === 'active' && inRange(i.ts));
  const dsList = state.directSales.filter(d => inRange(d.ts));
  const exps = state.expenses.filter(e => inRange(e.ts));
  const rets = state.returns.filter(r => inRange(r.ts));
  const returnsTotal = sumList(rets, r => r.amount);
  const returnsProfitDed = sumList(rets, r => r.profitAdjustment);
  const sales = roundMoney(sumList(invs, i => i.total) + sumList(dsList, d => d.total) - returnsTotal);
  const profit = roundMoney(sumList(invs, i => i.profit) + sumList(dsList, d => d.profit) - returnsProfitDed);
  const expTotal = sumList(exps, e => e.amount);
  const card = (label, value, color) => `<div class="bg-${color}-50 border border-${color}-200 rounded-xl p-3"><span class="block text-xs text-${color}-700">${label}</span><span class="text-sm font-bold text-${color}-900">${value}</span></div>`;
  $('reportCards').innerHTML =
    card('الفواتير + بيع سريع', `${fmt(invs.length)} + ${fmt(dsList.length)}`, 'emerald') +
    card('صافي المبيعات', fmtCur(sales), 'blue') +
    card('إجمالي الربح', fmtCur(profit), 'indigo') +
    card('المصاريف', fmtCur(expTotal), 'purple');
  const map = {};
  invs.forEach(i => i.items.forEach(it => {
    const k = normalizeArabic(it.name);
    if (!map[k]) map[k] = { name: it.name, qty: 0, rev: 0 };
    map[k].qty = roundMoney(map[k].qty + toNum(it.qty)); map[k].rev = roundMoney(map[k].rev + toNum(it.total));
  }));
  dsList.forEach(d => {
    const k = normalizeArabic(d.name);
    if (!map[k]) map[k] = { name: d.name, qty: 0, rev: 0 };
    map[k].qty = roundMoney(map[k].qty + toNum(d.qty)); map[k].rev = roundMoney(map[k].rev + toNum(d.total));
  });
  rets.forEach(r => {
    const k = normalizeArabic(r.productName);
    if (map[k]) { map[k].qty = Math.max(0, roundMoney(map[k].qty - toNum(r.qty))); map[k].rev = Math.max(0, roundMoney(map[k].rev - toNum(r.amount))); }
  });
  const top = Object.values(map).sort((a, b) => b.qty - a.qty).slice(0, 10);
  $('topProductsBody').innerHTML = top.map(t => `<tr class="border-b border-slate-100"><td class="p-2.5 text-slate-800">${esc(t.name)}</td><td class="p-2.5 text-ashour font-bold">${fmt(t.qty)}</td><td class="p-2.5 text-slate-700">${fmtCur(t.rev)}</td></tr>`).join('') || `<tr><td colspan="3" class="p-4 text-center text-slate-400">لا بيانات</td></tr>`;
  lastReport = { from, to, sales, profit, expTotal, net: roundMoney(profit - expTotal), count: invs.length + dsList.length, top };
}
function exportReportCSV() {
  if (!lastReport) renderReports();
  const r = lastReport;
  const lines = [['العملة', CURRENCY], ['تقرير', `${r.from} إلى ${r.to}`], ['عدد العمليات', r.count], ['المبيعات', r.sales], ['إجمالي الربح', r.profit], ['المصاريف', r.expTotal], ['الصافي', r.net], [], ['الصنف', 'الكمية', 'الإيراد']];
  r.top.forEach(t => lines.push([t.name, t.qty, t.rev]));
  const csv = '\uFEFF' + lines.map(row => row.map(c => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `report_${r.from}_${r.to}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
}
function renderAuditLog() {
  $('auditLogBody').innerHTML = state.auditLog.slice(0, 80).map(l => `<tr class="border-b border-slate-100"><td class="p-2 text-slate-400 whitespace-nowrap">${esc(l.date)}</td><td class="p-2 font-bold text-ashour">${esc(l.type)}</td><td class="p-2 text-slate-800">${esc(l.details)}</td><td class="p-2 text-emerald-700 font-bold whitespace-nowrap">${esc(l.status || '')}</td></tr>`).join('') || `<tr><td colspan="4" class="p-4 text-center text-slate-400">لا حركات</td></tr>`;
}

// ===== Settings =====
function loadStoreInfoToSettings() {
  $('setStoreName').value = state.storeInfo.name || '';
  $('setStorePhone').value = state.storeInfo.phone || '';
  $('setStoreAddress').value = state.storeInfo.address || '';
  $('headerStoreName').textContent = state.storeInfo.name || 'مركز عاشور للتجارة';
  const r = $('setRate'); if (r) r.value = toNum(state.exchangeRate) || 15000;
}
async function saveStoreSettings() {
  const prev = { ...state.storeInfo };
  state.storeInfo = { name: $('setStoreName').value.trim() || 'مركز عاشور للتجارة', phone: $('setStorePhone').value.trim(), address: $('setStoreAddress').value.trim() };
  logAudit('تعديل الإعدادات', 'تحديث بيانات المتجر');
  const ok = await saveToStorage();
  if (!ok) { state.storeInfo = prev; return; }
  loadStoreInfoToSettings(); toast('حُفظت البيانات');
}
async function saveExchangeRate() {
  const v = toNum($('setRate').value);
  if (!(v > 0)) return warn('خطأ', 'أدخل سعر صرف صحيحاً');
  const prev = state.exchangeRate;
  state.exchangeRate = v;
  logAudit('تعديل سعر الصرف', `1$ = ${fmt(v)} ل.س`);
  if (!(await saveToStorage())) { state.exchangeRate = prev; return; }
  renderAll(); toast('تم حفظ سعر الصرف');
}
async function changePinCode() {
  const oldPin = $('oldPinInput').value, newPin = $('newPinInput').value;
  if (!newPin || newPin.length < 4 || newPin.length > 6 || !/^\d+$/.test(newPin)) return warn('خطأ', 'الرمز من 4 إلى 6 أرقام');
  if (await hashPin(oldPin, state.pinSalt) !== state.pinHash) return warn('خطأ', 'الرمز الحالي غير صحيح', 'error');
  const prevHash = state.pinHash, prevLen = state.pinLength;
  state.pinHash = await hashPin(newPin, state.pinSalt); state.pinLength = newPin.length;
  logAudit('تغيير PIN', 'تم تغيير رمز الحماية');
  const ok = await saveToStorage();
  if (!ok) { state.pinHash = prevHash; state.pinLength = prevLen; return; }
  $('oldPinInput').value = ''; $('newPinInput').value = ''; toast('تم تغيير PIN');
  rebuildPinDots();
}
function rebuildPinDots() {
  const el = $('pinDots'); if (!el) return;
  el.innerHTML = Array.from({ length: state.pinLength || 4 }, () => '<div class="w-3.5 h-3.5 rounded-full border-2 border-ashour pin-dot transition"></div>').join('');
}
async function refreshStorageStatus() {
  const el = $('storageStatus'); if (!el) return;
  const status = await AshourDB.getStatus();
  let html = `<div class="flex justify-between"><span>IndexedDB:</span><span class="${status.indexedDB.includes('✓') ? 'text-emerald-700' : 'text-rose-600'}">${status.indexedDB}</span></div>`;
  html += `<div class="flex justify-between"><span>localStorage:</span><span class="${status.localStorage.includes('✓') ? 'text-emerald-700' : 'text-amber-600'}">${status.localStorage}</span></div>`;
  if (status.localStorageSize > 0) html += `<div class="flex justify-between"><span>حجم البيانات:</span><span>${(status.localStorageSize / 1024).toFixed(1)} KB</span></div>`;
  if (status.estimate) html += `<div class="flex justify-between"><span>المساحة المتاحة:</span><span>${(status.estimate.quota / (1024 * 1024)).toFixed(1)} MB</span></div>`;
  el.innerHTML = html;
}
async function testStorageCapacity() {
  Swal.fire({ title: 'جارٍ الاختبار...', text: 'يتم الآن اختبار قوة الذاكرة.', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } });
  const res = await AshourDB.testCapacity();
  if (res.ok) Swal.fire({ icon: 'success', title: 'الذاكرة قوية!', html: `نجح الاختبار.<br>الحجم: <b>${res.sizeKB} KB</b><br>الزمن: <b>${res.ms} ms</b>`, confirmButtonColor: '#0F5C4E' });
  else Swal.fire({ icon: 'error', title: 'فشل الاختبار', text: res.error || 'الذاكرة ممتلئة.', confirmButtonColor: '#d33' });
  refreshStorageStatus();
}
async function exportDataBackup() {
  const snapshot = JSON.parse(JSON.stringify(state));
  delete snapshot.pinHash; delete snapshot.pinAttempts; delete snapshot.pinLockUntil; delete snapshot.customPricesEditing;
  const a = document.createElement('a');
  a.href = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(snapshot, null, 2));
  a.download = `Ashour_Backup_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove(); toast('تم تصدير النسخة');
}
function importDataBackup(ev) {
  const file = ev.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const incoming = JSON.parse(e.target.result);
      if (!Array.isArray(incoming.products) || !Array.isArray(incoming.clients)) throw new Error('bad');
      Swal.fire({ title: 'استعادة البيانات؟', text: 'ستُستبدل البيانات الحالية.', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6', confirmButtonText: 'نعم', cancelButtonText: 'إلغاء' })
        .then(async res => {
          if (!res.isConfirmed) return;
          const keepPin = state.pinHash, keepLen = state.pinLength, keepSalt = state.pinSalt;
          state = Object.assign(defaultState(), incoming);
          ['returns', 'directSales', 'noInvoiceItems', 'companies', 'payments', 'expenses', 'invoices', 'purchases', 'companyPayments', 'personDebts', 'orders', 'stockMovements', 'tombstones'].forEach(k => { if (!Array.isArray(state[k])) state[k] = []; });
          state.clients.forEach(c => { if (!c.customPrices || typeof c.customPrices !== 'object') c.customPrices = {}; });
          state.pinHash = keepPin; state.pinLength = keepLen || 4; state.pinSalt = keepSalt || state.pinSalt;
          state.cart = []; state.customPricesEditing = null;
          const maxInvNum = Math.max(1000, ...state.invoices.map(i => parseInt(String(i.id).replace(/\D/g, ''), 10) || 0));
          state.invoiceCounter = Math.max(maxInvNum, toNum(state.invoiceCounter));
          const ok = await saveToStorage(); if (!ok) return;
          refreshCategoryWidgets(); initPOSCategories(); renderAll(); updateInventoryBadge();
          Swal.fire({ icon: 'success', title: 'تمت الاستعادة', confirmButtonColor: '#0F5C4E' });
        });
    } catch (_) { warn('ملف غير صالح', 'النسخة تالفة.', 'error'); }
    finally { ev.target.value = ''; }
  };
  reader.readAsText(file);
}

// ===== Receipt =====
function normalizePhoneForWA(raw) {
  if (!raw || raw === '-') return null;
  let p = String(raw).replace(/\D/g, ''); if (!p) return null;
  if (p.startsWith('00')) p = p.slice(2);
  if (p.startsWith('0')) p = '963' + p.slice(1);
  return p.length >= 8 ? p : null;
}
function showReceiptModal(inv) {
  state.currentReceiptInv = inv;
  const client = state.clients.find(c => c.id === inv.clientId) || { id: null };
  const totalDebt = client.id ? getClientDebt(client.id) : 0;
  const hasDebt = totalDebt > 0 || toNum(inv.remaining) > 0;
  const change = toNum(inv.changeGiven);

  $('recStoreName').textContent = state.storeInfo.name || 'مركز عاشور للتجارة';
  $('recStorePhone').textContent = `هاتف: ${state.storeInfo.phone || '-'}`;
  $('recStoreAddress').textContent = `العنوان: ${state.storeInfo.address || '-'}`;
  $('recNum').textContent = '#' + inv.id;
  $('recDate').textContent = inv.date;
  $('recClient').textContent = inv.clientName;
  $('recPriceMode').textContent = inv.priceMode || 'تجزئة';

  $('recItemsBody').innerHTML = inv.items.map(i => `<tr class="border-b border-slate-200"><td class="py-1 font-bold">${esc(i.name)}</td><td class="py-1 text-center">${fmt(i.qty)}</td><td class="py-1 text-left">${fmt(i.price)}</td><td class="py-1 text-left font-bold">${fmt(i.total)}</td></tr>`).join('');

  if (toNum(inv.discount) > 0) { $('recDiscountRow').classList.remove('hidden'); $('recDiscount').textContent = fmtCur(inv.discount); }
  else $('recDiscountRow').classList.add('hidden');

  $('recTotal').textContent = fmtCur(inv.total);
  $('recPaidRow').classList.toggle('hidden', !hasDebt && change <= 0);
  $('recRemainingRow').classList.toggle('hidden', !hasDebt);
  $('recTotalDebtRow').classList.toggle('hidden', !hasDebt);
  $('recChangeRow').classList.toggle('hidden', !(change > 0));

  if (hasDebt || change > 0) $('recPaid').textContent = fmtCur(inv.paid);
  if (hasDebt) { $('recRemaining').textContent = fmtCur(inv.remaining); $('recTotalClientDebt').textContent = fmtCur(totalDebt); }
  if (change > 0) $('recChange').textContent = fmtCur(change);

  // علامة "فاتورة ملغاة"
  const old = $('recCancelled'); if (old) old.remove();
  if (inv.status === 'cancelled') {
    const d = document.createElement('div');
    d.id = 'recCancelled'; d.className = 'text-center font-bold text-rose-700 border-2 border-rose-600 rounded-lg py-1 my-2';
    d.textContent = 'فاتورة ملغاة';
    $('recNum').closest('.space-y-1').before(d);
  }

  openModal('receiptModal');
}
function shareReceiptWhatsApp() {
  const inv = state.currentReceiptInv; if (!inv) return;
  const lines = [`*${state.storeInfo.name || 'مركز عاشور للتجارة'}*`, `رقم الفاتورة: #${inv.id}`, `التاريخ: ${inv.date}`, `الزبون: ${inv.clientName}`, `التسعيرة: ${inv.priceMode || 'تجزئة'}`, `--------------------`,
    ...inv.items.map(i => `• ${i.name} (${fmt(i.qty)} × ${fmt(i.price)}) = ${fmtCur(i.total)}`), `--------------------`,
    ...(toNum(inv.discount) > 0 ? [`الخصم: ${fmtCur(inv.discount)}`] : []),
    `الإجمالي: *${fmtCur(inv.total)}*`, `المدفوع: ${fmtCur(inv.paid)}`,
    ...(toNum(inv.remaining) > 0 ? [`المتبقي: *${fmtCur(inv.remaining)}*`] : []),
    ...(toNum(inv.changeGiven) > 0 ? [`الباقي للزبون: ${fmtCur(inv.changeGiven)}`] : [])];
  const text = lines.join('\n');
  const client = state.clients.find(c => c.id === inv.clientId);
  const phone = client ? normalizePhoneForWA(client.phone) : null;
  window.open(phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
}
async function generateReceiptCanvas() {
  if (typeof html2canvas === 'undefined') throw new Error('html2canvas غير محملة');
  const el = $('printableReceipt'); if (!el) throw new Error('عنصر الفاتورة غير موجود');
  const origOverflow = el.style.overflow, origHeight = el.style.height, origMaxHeight = el.style.maxHeight;
  el.style.overflow = 'visible'; el.style.height = 'auto'; el.style.maxHeight = 'none';
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  try {
    return await html2canvas(el, { scale: 3, backgroundColor: '#ffffff', useCORS: true, allowTaint: true, logging: false, windowWidth: el.scrollWidth, windowHeight: el.scrollHeight });
  } finally {
    el.style.overflow = origOverflow; el.style.height = origHeight; el.style.maxHeight = origMaxHeight;
  }
}
async function saveReceiptAsImage() {
  try {
    toast('جاري التجهيز...', 'info');
    const canvas = await generateReceiptCanvas();
    const link = document.createElement('a');
    const invId = state.currentReceiptInv ? state.currentReceiptInv.id : Date.now();
    link.download = `فاتورة_${invId}.png`; link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link); link.click(); link.remove(); toast('تم حفظ الفاتورة');
  } catch (_) { warn('تنبيه', 'تعذر إنشاء الصورة، استخدم الطباعة.', 'error'); }
}
async function shareReceiptImage() {
  try {
    toast('جاري التجهيز للمشاركة...', 'info');
    const canvas = await generateReceiptCanvas();
    const invId = state.currentReceiptInv ? state.currentReceiptInv.id : Date.now();
    canvas.toBlob(async blob => {
      if (!blob) return saveReceiptAsImage();
      const file = new File([blob], `فاتورة_${invId}.png`, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ title: `فاتورة ${invId}`, text: `فاتورة من ${state.storeInfo.name}`, files: [file] }); }
        catch (shareError) { if (shareError.name !== 'AbortError') saveReceiptAsImage(); }
      } else saveReceiptAsImage();
    }, 'image/png');
  } catch (_) { saveReceiptAsImage(); }
}

// ===== Modals =====
function openModal(id) { const el = $(id); if (!el) return; el.classList.remove('hidden'); el.style.display = 'flex'; }
function closeModal(id) { const el = $(id); if (!el) return; if (id === 'customPricesModal') state.customPricesEditing = null; el.classList.add('hidden'); el.style.display = 'none'; }

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { MODAL_IDS.forEach(id => { const el = $(id); if (el && !el.classList.contains('hidden')) closeModal(id); }); return; }
  if (e.key === 'F2') { e.preventDefault(); if (!$('pinOverlay').classList.contains('hidden')) return; openDirectSaleModal(); }
  if (e.key === 'F3') { e.preventDefault(); if (!$('pinOverlay').classList.contains('hidden')) return; switchTab('pos'); const s = $('posSearch'); if (s) s.focus(); }
  if (e.key === 'F4') { e.preventDefault(); if (!$('pinOverlay').classList.contains('hidden')) return; if (!$('view-pos').classList.contains('hidden')) checkoutPOS(); }
  if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName || '')) { e.preventDefault(); const q = $('quickEntryInput'); if (q) q.focus(); }
});

// ===== Orders =====
let currentOrderItems = [];
function openOrderModal(orderId = null) {
  $('orderEditId').value = orderId || ''; currentOrderItems = [];
  if (orderId) {
    const order = state.orders.find(o => o.id === orderId); if (!order) return;
    $('orderClientSelect').value = order.clientId;
    $('orderSelectedClientText').textContent = order.clientName;
    $('orderDueDate').value = order.dueDate || '';
    $('orderDueTime').value = order.dueTime || '';
    $('orderNotes').value = order.notes || '';
    currentOrderItems = JSON.parse(JSON.stringify(order.items || []));
  } else {
    $('orderClientSelect').value = ''; $('orderSelectedClientText').textContent = 'اختر الزبون';
    $('orderDueDate').value = dayKey(Date.now()); $('orderDueTime').value = ''; $('orderNotes').value = '';
  }
  renderOrderItemsList(); populateOrderClients(); openModal('orderModal');
}
function populateOrderClients() {
  const dropdown = $('orderClientDropdownList'); if (!dropdown) return;
  dropdown.innerHTML = filterDeleted('clients', state.clients).map(c =>
    `<div onclick="selectOrderClient('${esc(c.id)}', '${esc(c.name)}')" class="p-2.5 hover:bg-emerald-50 cursor-pointer text-xs font-bold flex justify-between items-center">
      <span>${esc(c.name)}</span><span class="text-[10px] text-slate-500">${esc(c.phone || '-')}</span>
    </div>`).join('');
}
function toggleOrderClientDropdown() { $('orderClientDropdownList').classList.toggle('hidden'); populateOrderClients(); }
function selectOrderClient(id, name) { $('orderClientSelect').value = id; $('orderSelectedClientText').textContent = name; $('orderClientDropdownList').classList.add('hidden'); }
function addOrderItem() { currentOrderItems.push({ name: '', qty: 1, price: 0 }); renderOrderItemsList(); }
function renderOrderItemsList() {
  const container = $('orderItemsList'); if (!container) return;
  container.innerHTML = currentOrderItems.map((item, idx) => `
    <div class="grid grid-cols-12 gap-1 items-center bg-slate-50 p-1.5 rounded-lg">
      <input type="text" placeholder="الصنف" value="${esc(item.name)}" oninput="updateOrderItem(${idx}, 'name', this.value)" class="col-span-5 bg-white border rounded p-1.5 text-xs">
      <input type="number" placeholder="كمية" value="${item.qty}" min="1" oninput="updateOrderItem(${idx}, 'qty', this.value)" class="col-span-2 bg-white border rounded p-1.5 text-xs text-center">
      <input type="number" placeholder="سعر" value="${item.price}" min="0" oninput="updateOrderItem(${idx}, 'price', this.value)" class="col-span-3 bg-white border rounded p-1.5 text-xs text-center">
      <button onclick="removeOrderItem(${idx})" class="col-span-2 bg-rose-100 text-rose-700 hover:bg-rose-200 rounded p-1.5 text-xs font-bold"><i class="fa-solid fa-trash"></i></button>
    </div>`).join('') || '<div class="text-xs text-slate-400 text-center py-2">لا توجد أصناف</div>';
}
function updateOrderItem(idx, field, value) {
  if (!currentOrderItems[idx]) return;
  if (field === 'qty') currentOrderItems[idx][field] = Math.max(1, toNum(value) || 1);
  else if (field === 'price') currentOrderItems[idx][field] = Math.max(0, toNum(value) || 0);
  else currentOrderItems[idx][field] = value;
}
function removeOrderItem(idx) { currentOrderItems.splice(idx, 1); renderOrderItemsList(); }
async function saveOrder() {
  const clientId = $('orderClientSelect').value;
  if (!clientId) return warn('خطأ', 'اختر الزبون');
  const items = currentOrderItems.filter(it => it.name && it.name.trim());
  if (!items.length) return warn('خطأ', 'أضف صنفاً واحداً على الأقل');
  const client = state.clients.find(c => c.id === clientId);
  const dueDate = $('orderDueDate').value, dueTime = $('orderDueTime').value;
  const notes = $('orderNotes').value.trim();
  const total = sumList(items, it => calcLineTotal(it.price, it.qty));
  const editId = $('orderEditId').value;
  if (editId) {
    const order = state.orders.find(o => o.id === editId); if (!order) return;
    Object.assign(order, { clientId, clientName: client.name, items, total, dueDate, dueTime, notes });
    logAudit('تعديل طلب', `${client.name} - ${items.length} صنف`);
  } else {
    state.orders.push({ id: 'ORD-' + Date.now(), clientId, clientName: client.name, clientPhone: client.phone || '', items, total, notes, dueDate, dueTime, status: 'pending', createdAt: Date.now(), deliveredAt: null });
    logAudit('طلب جديد', `${client.name} - ${items.length} صنف - ${dueDate} ${dueTime}`);
  }
  const ok = await saveToStorage(); if (!ok) return;
  closeModal('orderModal'); renderOrders(); updateOrdersBadge(); toast('تم حفظ الطلب');
}
function updateOrdersBadge() {
  if (!Array.isArray(state.orders)) state.orders = [];
  const pending = state.orders.filter(o => o.status === 'pending').length;
  const badge = $('ordersBadge'); if (!badge) return;
  if (pending > 0) { badge.textContent = pending; badge.classList.remove('hidden'); } else badge.classList.add('hidden');
}
function renderOrders() {
  const grid = $('ordersGrid'); if (!grid) return;
  if (!Array.isArray(state.orders)) state.orders = [];
  const pending = state.orders.filter(o => o.status === 'pending').sort((a, b) => {
    const dateA = (a.dueDate || '9999-12-31') + ' ' + (a.dueTime || '23:59');
    const dateB = (b.dueDate || '9999-12-31') + ' ' + (b.dueTime || '23:59');
    return dateA.localeCompare(dateB);
  });
  if (!pending.length) { grid.innerHTML = `<div class="col-span-full text-center py-10 text-slate-400 text-sm font-bold bg-white rounded-2xl border border-dashed"><i class="fa-solid fa-clipboard-check text-4xl opacity-30 mb-2 block"></i>لا توجد طلبات قيد التنفيذ</div>`; return; }
  const now = new Date();
  grid.innerHTML = pending.map((order, idx) => {
    let dueStatus = 'future', dueStatusLabel = 'مجدول';
    if (order.dueDate) {
      const dueStr = order.dueDate + (order.dueTime ? 'T' + order.dueTime : 'T23:59');
      const due = new Date(dueStr); const diffMs = due - now; const diffHours = diffMs / (1000 * 60 * 60);
      if (diffMs < 0) { dueStatus = 'overdue'; dueStatusLabel = 'متأخر'; }
      else if (diffHours < 2) { dueStatus = 'soon'; dueStatusLabel = 'قريباً جداً'; }
    }
    const borderColor = { overdue: 'border-rose-400 bg-rose-50', soon: 'border-amber-400 bg-amber-50', future: 'border-slate-200 bg-white' }[dueStatus];
    const badgeColor = { overdue: 'bg-rose-600 text-white', soon: 'bg-amber-500 text-white', future: 'bg-emerald-600 text-white' }[dueStatus];
    return `<div class="rounded-2xl border-2 ${borderColor} p-4 shadow-sm flex flex-col gap-2">
      <div class="flex items-start justify-between gap-2">
        <div>
          <div class="flex items-center gap-1.5 mb-1">
            ${idx === 0 ? '<span class="text-[10px] bg-ashour text-white px-2 py-0.5 rounded-full font-bold">التالي</span>' : ''}
            <span class="text-[10px] ${badgeColor} px-2 py-0.5 rounded-full font-bold">${dueStatusLabel}</span>
          </div>
          <h4 class="font-bold text-lg text-slate-800">${esc(order.clientName)}</h4>
          ${order.dueDate ? `<p class="text-xs text-slate-600 font-semibold num-tabular"><i class="fa-solid fa-clock"></i> ${esc(order.dueDate)}${order.dueTime ? ' — الساعة ' + esc(order.dueTime) : ''}</p>` : ''}
        </div>
        <div class="text-left"><div class="text-xs text-slate-500 font-bold">الإجمالي</div><div class="text-base font-bold text-ashour num-tabular">${fmtCur(order.total)}</div></div>
      </div>
      <div class="bg-white border border-slate-200 rounded-lg p-2 text-xs font-semibold max-h-32 overflow-y-auto">
        ${order.items.map(it => `<div class="flex justify-between py-0.5"><span>${esc(it.name)}</span><span class="num-tabular">${fmt(it.qty)} × ${fmtCur(it.price)}</span></div>`).join('')}
      </div>
      ${order.notes ? `<p class="text-xs text-slate-600 italic">📝 ${esc(order.notes)}</p>` : ''}
      <div class="flex gap-1.5 flex-wrap">
        <button onclick="deliverOrder('${esc(order.id)}')" class="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-lg font-bold text-xs"><i class="fa-solid fa-check"></i> تم التوصيل</button>
        <button onclick="convertOrderToInvoice('${esc(order.id)}')" class="flex-1 bg-ashour hover:bg-ashour-dark text-white py-2 rounded-lg font-bold text-xs"><i class="fa-solid fa-cash-register"></i> تحويل لفاتورة</button>
        <button onclick="openOrderModal('${esc(order.id)}')" class="bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-2 rounded-lg text-xs font-bold"><i class="fa-solid fa-pen"></i></button>
        <button onclick="cancelOrder('${esc(order.id)}')" class="bg-rose-100 hover:bg-rose-200 text-rose-700 px-2.5 py-2 rounded-lg text-xs font-bold"><i class="fa-solid fa-xmark"></i></button>
      </div>
    </div>`;
  }).join('');
}
async function deliverOrder(orderId) {
  const order = state.orders.find(o => o.id === orderId); if (!order) return;
  const res = await Swal.fire({ title: 'تم التوصيل؟', text: `سيتم تحويل الطلب إلى "تم التسليم".`, icon: 'question', showCancelButton: true, confirmButtonColor: '#10b981', cancelButtonColor: '#64748b', confirmButtonText: 'نعم، تم التوصيل', cancelButtonText: 'إلغاء' });
  if (!res.isConfirmed) return;
  const prevStatus = order.status, prevDeliveredAt = order.deliveredAt;
  order.status = 'delivered'; order.deliveredAt = Date.now();
  logAudit('تسليم طلب', `${order.clientName} - ${fmtCur(order.total)}`);
  const ok = await saveToStorage();
  if (!ok) { order.status = prevStatus; order.deliveredAt = prevDeliveredAt; return; }
  renderOrders(); updateOrdersBadge(); toast('تم تسليم الطلب');
}
async function cancelOrder(orderId) {
  const order = state.orders.find(o => o.id === orderId); if (!order) return;
  const res = await Swal.fire({ title: 'إلغاء الطلب؟', text: 'سيتم حذف الطلب نهائياً.', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#64748b', confirmButtonText: 'نعم، إلغاء', cancelButtonText: 'تراجع' });
  if (!res.isConfirmed) return;
  const removed = { ...order };
  state.orders = state.orders.filter(o => o.id !== orderId);
  addTombstone('orders', order.id); addToTrash('orders', removed);
  logAudit('إلغاء طلب', `${order.clientName} - ${fmtCur(order.total)}`);
  const ok = await saveToStorage();
  if (!ok) { state.orders.push(removed); return; }
  renderOrders(); updateOrdersBadge(); toast('تم إلغاء الطلب');
}
function addCartToOrders() {
  if (!state.cart.length) return warn('السلة فارغة', 'أضف منتجات أولاً');
  const client = getSelectedPosClient();
  if (!client || client.id === 'c1') return warn('اختر الزبون', 'اختر اسم الزبون من القائمة لإضافة الطلب', 'info');
  Swal.fire({
    title: 'موعد الاستلام',
    html: `<input id="oDate" type="date" class="swal2-input" value="${dayKey(Date.now())}"><input id="oTime" type="time" class="swal2-input">`,
    showCancelButton: true, confirmButtonText: 'إضافة وطباعة', cancelButtonText: 'إلغاء', confirmButtonColor: '#0F5C4E',
    preConfirm: () => ({ d: $('oDate').value, t: $('oTime').value })
  }).then(async r => {
    if (!r.isConfirmed) return;
    const v = r.value;
    const items = state.cart.map(it => {
      const i = getCartItemInfo(it);
      return i ? { name: i.name, qty: toNum(it.qty), price: i.unitPrice } : null;
    }).filter(Boolean);
    const { total, discount } = cartTotals();
    const order = { id: 'ORD-' + Date.now(), clientId: client.id, clientName: client.name, clientPhone: client.phone || '', items, total, notes: '', dueDate: v.d, dueTime: v.t, status: 'pending', createdAt: Date.now(), deliveredAt: null };
    state.orders.push(order);
    logAudit('طلب جديد', `${client.name} - ${items.length} صنف - ${v.d} ${v.t}`);
    if (!(await saveToStorage())) { state.orders.pop(); return; }
    clearCart(); updateOrdersBadge(); renderOrders();
    showReceiptModal({ id: order.id, ts: order.createdAt, date: nowStr(), clientId: client.id, clientName: client.name, priceMode: `طلب — الاستلام ${v.d} ${v.t || ''}`.trim(), items: items.map(i => ({ ...i, total: calcLineTotal(i.price, i.qty) })), discount, total, paid: 0, remaining: 0, changeGiven: 0 });
    toast('أُضيف الطلب إلى القائمة');
  });
}
async function convertOrderToInvoice(orderId) {
  const order = state.orders.find(o => o.id === orderId); if (!order) return;
  if (state.cart.length) {
    const r = await Swal.fire({ icon: 'question', title: 'استبدال السلة؟', text: 'ستُستبدل السلة الحالية بأصناف الطلب.', showCancelButton: true, confirmButtonText: 'نعم', cancelButtonText: 'إلغاء', confirmButtonColor: '#0F5C4E' });
    if (!r.isConfirmed) return;
  }
  state.cart = order.items.map(it => {
    const p = state.products.find(x => normalizeArabic(x.name) === normalizeArabic(it.name));
    if (p) return { productId: p.id, qty: toNum(it.qty) };
    return { isQuickOnly: true, quickId: 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5), name: it.name, price: toNum(it.price), qty: toNum(it.qty) };
  });
  const client = state.clients.find(c => c.id === order.clientId);
  if (client) { $('posClientSelect').value = client.id; $('selectedClientText').textContent = client.name; }
  state.posPriceOverride = null;
  // ✅ نحفظ hash السلة للتحقق من عدم تغيّرها عند الحفظ
  pendingOrder = { id: order.id, cartHash: computeCartHash(state.cart) };
  switchTab('pos'); renderCart();
  toast('أكمل الفاتورة واضغط حفظ، وسيُغلق الطلب بعدها', 'info');
}

// ===== Inventory =====
function updateInventoryBadge() {
  const badge = $('inventoryBadge'); if (!badge) return;
  const lowOrOut = filterDeleted('products', state.products).filter(p => {
    if (!p.trackStock) return false;
    const status = getStockStatus(p);
    return status === 'low' || status === 'out';
  }).length;
  if (lowOrOut > 0) { badge.textContent = lowOrOut; badge.classList.remove('hidden'); } else badge.classList.add('hidden');
}
function switchInventorySubTab(tab) {
  const isProducts = tab === 'products';
  $('inventoryProductsPanel').classList.toggle('hidden', !isProducts);
  $('inventoryMovementsPanel').classList.toggle('hidden', isProducts);
  $('invSubTabProducts').className = isProducts ? 'flex-1 px-4 py-2 rounded-xl bg-ashour text-white font-bold text-sm transition' : 'flex-1 px-4 py-2 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 font-bold text-sm transition';
  $('invSubTabMovements').className = !isProducts ? 'flex-1 px-4 py-2 rounded-xl bg-ashour text-white font-bold text-sm transition' : 'flex-1 px-4 py-2 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 font-bold text-sm transition';
  if (isProducts) renderInventoryTable(); else renderStockMovements();
}
function renderInventoryTable() {
  const search = normalizeArabic(($('invSearch')?.value || '').trim());
  const filter = $('invFilter')?.value || 'all';
  const all = filterDeleted('products', state.products).filter(p => p.trackStock);
  const trackedValue = sumList(all, p => toNum(p.stock) * toNum(p.cost));
  const countOk = all.filter(p => getStockStatus(p) === 'ok').length;
  const countLow = all.filter(p => getStockStatus(p) === 'low').length;
  const countOut = all.filter(p => getStockStatus(p) === 'out').length;
  const totalUnits = sumList(all, p => toNum(p.stock));
  if ($('inventorySummary')) {
    $('inventorySummary').innerHTML = `
      <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-3"><span class="block text-xs text-emerald-700">متوفر</span><span class="font-bold text-emerald-900">${countOk}</span></div>
      <div class="bg-amber-50 border border-amber-200 rounded-xl p-3"><span class="block text-xs text-amber-700">منخفض</span><span class="font-bold text-amber-900">${countLow}</span></div>
      <div class="bg-rose-50 border border-rose-200 rounded-xl p-3"><span class="block text-xs text-rose-700">نفد</span><span class="font-bold text-rose-900">${countOut}</span></div>
      <div class="bg-blue-50 border border-blue-200 rounded-xl p-3"><span class="block text-xs text-blue-700">إجمالي الوحدات</span><span class="font-bold text-blue-900">${fmt(totalUnits)}</span></div>
      <div class="bg-indigo-50 border border-indigo-200 rounded-xl p-3"><span class="block text-xs text-indigo-700">قيمة المخزون</span><span class="font-bold text-indigo-900">${fmtCur(trackedValue)}</span></div>`;
  }
  const list = all.filter(p => {
    if (search && !(normalizeArabic(p.name).includes(search) || normalizeArabic(p.sku).includes(search) || normalizeArabic(p.barcode).includes(search))) return false;
    const status = getStockStatus(p);
    if (filter === 'ok' && status !== 'ok') return false;
    if (filter === 'low' && status !== 'low') return false;
    if (filter === 'out' && status !== 'out') return false;
    return true;
  }).sort((a, b) => {
    const order = { out: 0, low: 1, ok: 2 };
    return (order[getStockStatus(a)] || 9) - (order[getStockStatus(b)] || 9);
  });
  if ($('invCountBadge')) $('invCountBadge').textContent = list.length;
  $('inventoryTableBody').innerHTML = list.map(p => {
    const status = getStockStatus(p);
    const stockBadge = status === 'out' ? `<span class="bg-rose-100 text-rose-700 px-2 py-1 rounded text-xs font-bold"><i class="fa-solid fa-ban"></i> نفد</span>` :
      status === 'low' ? `<span class="bg-amber-100 text-amber-800 px-2 py-1 rounded text-xs font-bold"><i class="fa-solid fa-triangle-exclamation"></i> منخفض</span>` :
      `<span class="bg-emerald-100 text-emerald-800 px-2 py-1 rounded text-xs font-bold"><i class="fa-solid fa-check"></i> متوفر</span>`;
    return `<tr class="hover:bg-slate-50 border-b border-slate-100">
      <td class="p-3 text-ashour font-bold">${esc(p.sku || '-')}</td>
      <td class="p-3 font-bold text-indigo-700">${esc(p.name)}</td>
      <td class="p-3 text-center font-bold ${toNum(p.stock) <= 0 ? 'text-rose-600' : toNum(p.stock) <= toNum(p.minStock) ? 'text-amber-700' : 'text-emerald-700'}">${fmt(p.stock)}</td>
      <td class="p-3 text-center text-slate-600">${fmt(p.minStock)}</td>
      <td class="p-3 text-center">${stockBadge}</td>
      <td class="p-3 text-slate-800">${fmtCur(toNum(p.stock) * toNum(p.cost))}</td>
      <td class="p-3 text-center"><button onclick="openStockAdjustmentModal('${esc(p.id)}')" class="bg-indigo-100 text-indigo-700 hover:bg-indigo-600 hover:text-white px-2.5 py-1 rounded transition text-xs font-bold"><i class="fa-solid fa-sliders"></i> تسوية</button></td>
    </tr>`;
  }).join('') || `<tr><td colspan="7" class="p-6 text-center text-slate-400 text-sm">لا توجد منتجات مطابقة (تأكد من تفعيل "تتبع المخزون" في إعدادات المنتج)</td></tr>`;
}
function openStockAdjustmentModal(preselectId = null) {
  const sel = $('saProductSelect');
  const tracked = filterDeleted('products', state.products).filter(p => p.trackStock);
  if (!tracked.length) return warn('لا توجد منتجات متتبعة', 'فعّل "تتبع المخزون" في أحد المنتجات أولاً.', 'info');
  sel.innerHTML = `<option value="">-- اختر منتج --</option>` + tracked.map(p => `<option value="${esc(p.id)}">${esc(p.name)} (${fmt(p.stock)})</option>`).join('');
  if (preselectId) sel.value = preselectId;
  $('saType').value = 'adjustment'; $('saQty').value = ''; $('saNote').value = '';
  updateStockAdjustmentPreview(); openModal('stockAdjustmentModal');
}
function updateStockAdjustmentPreview() {
  const pid = $('saProductSelect')?.value;
  const current = $('saCurrentStock'), after = $('saAfterStock');
  if (!pid) { if (current) current.textContent = 'اختر منتجاً'; if (after) after.textContent = 'بعد التسوية: —'; return; }
  const p = state.products.find(x => x.id === pid); if (!p) return;
  if (current) current.textContent = `المخزون الحالي: ${fmt(p.stock)} • الحد الأدنى: ${fmt(p.minStock)}`;
  const delta = toNum($('saQty')?.value);
  const newStock = roundMoney(toNum(p.stock) + delta);
  if (after) after.textContent = `بعد التسوية: ${fmt(newStock)} ${newStock < 0 ? '⚠️ (سالب)' : ''}`;
}
async function saveStockAdjustment() {
  const pid = $('saProductSelect').value;
  const type = $('saType').value;
  const qty = toNum($('saQty').value);
  const note = $('saNote').value.trim();
  if (!pid) return warn('خطأ', 'اختر منتجاً');
  if (qty === 0) return warn('خطأ', 'أدخل كمية مختلفة عن صفر');
  const p = state.products.find(x => x.id === pid); if (!p) return;
  const before = toNum(p.stock);
  const after = roundMoney(before + qty);
  if (after < 0) return warn('خطأ', 'الكمية بعد التسوية لا يمكن أن تكون سالبة', 'error');
  const prevStock = p.stock;
  p.stock = after;
  addStockMovement(p.id, type, qty, before, after, note || `${type === 'adjustment' ? 'تسوية يدوية' : type === 'purchase' ? 'استلام من مورد' : type === 'return' ? 'مرتجع' : 'جرد افتتاحي'}`, '');
  logAudit('تسوية مخزون', `${p.name}: ${fmt(before)} → ${fmt(after)} (${qty > 0 ? '+' : ''}${fmt(qty)})`);
  const ok = await saveToStorage();
  if (!ok) { p.stock = prevStock; state.stockMovements.pop(); return; }
  closeModal('stockAdjustmentModal'); renderInventoryTable(); updateInventoryBadge(); renderProductsTable(); renderPosProducts();
  toast('تم حفظ التسوية');
}
function openReceiveStockModal() {
  receiveStockDraft = {};
  $('rsSearch').value = '';
  renderReceiveStockList();
  openModal('receiveStockModal');
}
function renderReceiveStockList() {
  const search = normalizeArabic(($('rsSearch')?.value || '').trim());
  const tracked = filterDeleted('products', state.products).filter(p => p.trackStock);
  const list = tracked.filter(p => !search || normalizeArabic(p.name).includes(search) || normalizeArabic(p.sku).includes(search));
  const box = $('rsProductsList'); if (!box) return;
  if (!list.length) { box.innerHTML = `<div class="text-center py-6 text-slate-400 text-sm font-bold">لا توجد منتجات مطابقة</div>`; return; }
  box.innerHTML = list.map(p => {
    const draftQty = receiveStockDraft[p.id] || 0;
    return `<div class="flex items-center justify-between gap-2 p-2 border-b border-slate-100">
      <div class="min-w-0 flex-1">
        <div class="font-bold text-sm text-slate-800 truncate">${esc(p.name)}</div>
        <div class="text-xs text-slate-500 font-semibold num-tabular">حالي: ${fmt(p.stock)} • كود: ${esc(p.sku || '-')}</div>
      </div>
      <div class="flex items-center gap-1">
        <input type="number" step="any" min="0" value="${draftQty || ''}" placeholder="0" oninput="updateReceiveStockDraft('${esc(p.id)}', this.value)" class="w-20 bg-slate-50 border border-slate-300 rounded-lg px-2 py-1 text-sm font-bold text-center">
        <span class="text-xs font-bold text-slate-500">+</span>
      </div>
    </div>`;
  }).join('');
}
function updateReceiveStockDraft(pid, val) {
  const v = toNum(val);
  if (v > 0) receiveStockDraft[pid] = v; else delete receiveStockDraft[pid];
}
async function saveReceiveStock() {
  const entries = Object.entries(receiveStockDraft).filter(([_, qty]) => qty > 0);
  if (!entries.length) return warn('خطأ', 'أدخل كمية لصنف واحد على الأقل');
  const note = await Swal.fire({ title: 'ملاحظات الاستلام', input: 'text', inputPlaceholder: 'اسم المورد أو رقم الفاتورة (اختياري)', showCancelButton: true, confirmButtonText: 'حفظ', cancelButtonText: 'إلغاء', confirmButtonColor: '#10b981' });
  if (!note.isConfirmed) return;
  const noteText = note.value || 'استلام بضاعة';
  const snapshot = entries.map(([pid, qty]) => {
    const p = state.products.find(x => x.id === pid);
    return p ? { p, before: toNum(p.stock) } : null;
  }).filter(Boolean);
  snapshot.forEach(({ p }) => {
    const before = toNum(p.stock);
    const qty = receiveStockDraft[p.id];
    p.stock = roundMoney(before + qty);
    addStockMovement(p.id, 'purchase', qty, before, p.stock, noteText, '');
  });
  logAudit('استلام بضاعة', `${entries.length} صنف — ${noteText}`);
  const ok = await saveToStorage();
  if (!ok) { snapshot.forEach(s => { s.p.stock = s.before; }); state.stockMovements.splice(-snapshot.length); return; }
  closeModal('receiveStockModal'); receiveStockDraft = {};
  renderInventoryTable(); updateInventoryBadge(); renderProductsTable(); renderPosProducts();
  toast(`تم استلام ${entries.length} صنف`);
}
function renderStockMovements() {
  const search = normalizeArabic(($('mvSearch')?.value || '').trim());
  const typeFilter = $('mvTypeFilter')?.value || 'all';
  let list = [...state.stockMovements].sort((a, b) => (b.ts || 0) - (a.ts || 0));
  if (typeFilter !== 'all') list = list.filter(m => m.type === typeFilter);
  if (search) list = list.filter(m => normalizeArabic(m.productName).includes(search));
  list = list.slice(0, 500);
  if ($('mvCountBadge')) $('mvCountBadge').textContent = list.length;
  const typeLabels = { sale: 'بيع', return: 'مرتجع', purchase: 'شراء', adjustment: 'تسوية', initial: 'افتتاحي' };
  const typeClass = { sale: 'bg-rose-100 text-rose-700', return: 'bg-emerald-100 text-emerald-700', purchase: 'bg-blue-100 text-blue-700', adjustment: 'bg-amber-100 text-amber-800', initial: 'bg-slate-100 text-slate-700' };
  $('stockMovementsList').innerHTML = list.map(m => `
    <tr class="hover:bg-slate-50 border-b border-slate-100">
      <td class="p-2.5 text-slate-500 whitespace-nowrap text-xs">${new Date(m.ts).toLocaleString('ar-SY')}</td>
      <td class="p-2.5 font-bold text-slate-800">${esc(m.productName)}</td>
      <td class="p-2.5"><span class="px-2 py-0.5 rounded text-[11px] font-bold ${typeClass[m.type] || 'bg-slate-100 text-slate-700'}">${typeLabels[m.type] || m.type}</span></td>
      <td class="p-2.5 text-center font-bold ${toNum(m.qty) > 0 ? 'text-emerald-700' : 'text-rose-600'}">${toNum(m.qty) > 0 ? '+' : ''}${fmt(m.qty)}</td>
      <td class="p-2.5 text-center text-xs text-slate-600">${fmt(m.beforeStock)} → ${fmt(m.afterStock)}</td>
      <td class="p-2.5 text-slate-600 text-xs">${esc(m.note || '-')}</td>
    </tr>`).join('') || `<tr><td colspan="6" class="p-6 text-center text-slate-400 text-sm">لا توجد حركات مخزون</td></tr>`;
}

// ===== Trash =====
const colName = { products: 'منتج', clients: 'زبون', companies: 'شركة', payments: 'دفعة زبون', companyPayments: 'دفعة شركة', purchases: 'فاتورة شراء', expenses: 'مصروف', personDebts: 'دين شخصي', directSales: 'بيع سريع', orders: 'طلب', returns: 'مرتجع' };
const recLabel = r => r.name || r.title || r.clientName || r.companyName || r.id;
function openTrash() {
  const list = (state.trash || []).map((t, i) => ({ t, i })).reverse().slice(0, 60);
  if (!list.length) return warn('سلة المحذوفات فارغة', 'لا توجد سجلات محذوفة.', 'info');
  Swal.fire({
    title: 'سلة المحذوفات', width: 600, showConfirmButton: false, showCloseButton: true,
    html: '<div style="max-height:55vh;overflow:auto;text-align:right">' + list.map(({ t, i }) => {
      const amt = t.rec.total != null ? t.rec.total : t.rec.amount;
      return `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px;border-bottom:1px solid #eee">
        <span style="font-size:13px"><b>${esc(colName[t.col] || t.col)}</b> — ${esc(recLabel(t.rec))}${amt != null ? ' (' + fmt(amt) + ')' : ''}</span>
        <button onclick="restoreTrash(${i})" style="background:#0F5C4E;color:#fff;border-radius:8px;padding:4px 10px;font-weight:700">استعادة</button></div>`;
    }).join('') + '</div>'
  });
}
async function restoreTrash(i) {
  const t = (state.trash || [])[i]; if (!t) return;
  if (!Array.isArray(state[t.col])) state[t.col] = [];
  if (!state[t.col].some(x => String(x.id) === String(t.rec.id))) {
    state[t.col].push(t.rec);
    // إزالة الـ tombstone
    state.tombstones = (state.tombstones || []).filter(tb => !(tb.col === t.col && String(tb.id) === String(t.rec.id)));
  }
  state.trash.splice(i, 1);
  if (!(await saveToStorage())) return;
  refreshCategoryWidgets(); renderAll(); updateInventoryBadge();
  Swal.close(); toast('تمت الاستعادة');
}

// ===== Factory reset (نهائي وآمن: يشمل تسجيل الخروج من Firebase) =====
async function factoryReset() {
  const res = await Swal.fire({
    title: 'تصفير النظام؟', text: 'سيتم حذف جميع البيانات نهائياً وتسجيل الخروج. لا يمكن التراجع!',
    icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6',
    confirmButtonText: 'نعم، امسح كل شيء', cancelButtonText: 'إلغاء',
    input: 'text', inputPlaceholder: 'اكتب كلمة DELETE للتأكيد',
    preConfirm: v => v === 'DELETE' ? true : Swal.showValidationMessage('اكتب DELETE بالأحرف الكبيرة')
  });
  if (!res.isConfirmed) return;
  try {
    if (window.firebaseAuth && window.firebaseSignOut) await window.firebaseSignOut(window.firebaseAuth);
  } catch (_) {}
  localStorage.clear();
  if (window.indexedDB) indexedDB.deleteDatabase('ashour_pos_db');
  Swal.fire('تم التصفير', 'سيتم إعادة تحميل الصفحة الآن لتبدأ من جديد.', 'success').then(() => location.reload());
}

// ===== Cookie products (مرة واحدة فقط) =====
async function ensureCookieProducts() {
  const flag = 'ashour_cookies_done_v2';
  if (localStorage.getItem(flag)) return;
  const cookies = [
    { sku: 'CK200', name: 'علب بسكويت سعر ال 200', category: 'بسكويت', retailPrice: 200, wholesalePrice: 180, cost: 150 },
    { sku: 'CK300', name: 'علب بسكويت سعر ال 300', category: 'بسكويت', retailPrice: 300, wholesalePrice: 280, cost: 220 },
    { sku: 'CK500', name: 'علب بسكويت سعر ال 500', category: 'بسكويت', retailPrice: 500, wholesalePrice: 470, cost: 400 }
  ];
  let changed = false;
  for (const c of cookies) {
    if (!state.products.find(p => p.sku === c.sku)) {
      state.products.push({ id: 'cookie_' + c.sku, sku: c.sku, barcode: '', name: c.name, category: c.category, cost: c.cost, retailPrice: c.retailPrice, wholesalePrice: c.wholesalePrice, trackStock: false, stock: 0, minStock: 5 });
      changed = true;
    }
  }
  if (changed) { await saveToStorage(); refreshCategoryWidgets(); }
  localStorage.setItem(flag, '1');
}
function addCookieProduct(price) {
  const sku = 'CK' + price;
  const product = state.products.find(p => p.sku === sku);
  if (product) addToCart(product.id); else addQuickCookie(price);
}

// ===== Render All =====
function renderAll(opts = {}) {
  const skip = Array.isArray(opts.skip) ? opts.skip : [];
  const should = n => !skip.includes(n);
  if (should('pos')) { populatePosClients(); updatePosPriceUI(); renderPosProducts(); renderCart(); }
  if (should('invoices')) renderInvoicesTable();
  if (should('products')) renderProductsTable();
  if (should('clients')) renderClientsGrid();
  if (should('companies')) renderCompaniesGrid();
  if (should('expenses')) renderExpensesTable();
  if (should('audit')) renderAuditLog();
  if (should('purchases')) renderPurchases();
  if (should('debts')) renderPersonDebts();
  if (should('orders')) { renderOrders(); updateOrdersBadge(); }
  if (should('inventory')) { updateInventoryBadge(); if (!$('view-inventory')?.classList.contains('hidden')) { renderInventoryTable(); if (!$('inventoryMovementsPanel')?.classList.contains('hidden')) renderStockMovements(); } }
  if (state.currentLedgerClientId && !$('view-client-detail').classList.contains('hidden')) renderClientSpecialPrices(state.currentLedgerClientId);
  if (!$('view-reports').classList.contains('hidden')) renderReports();
}

// ===== PIN Banner =====
async function ensurePinChangedBanner() {
  if ((await hashPin('1234', state.pinSalt)) !== state.pinHash) return;
  const banner = $('pinDefaultBanner'); if (banner) banner.classList.remove('hidden');
}

// ===== Init =====
window.addEventListener('DOMContentLoaded', async function () {
  await loadFromStorage();
  refreshCategoryWidgets();
  initPOSCategories();
  loadStoreInfoToSettings();
  rebuildPinDots();
  ensurePinChangedBanner();
  await ensureCookieProducts();
  renderAll();
  switchDebtTab(currentDebtTab || 'take');
  if ($('currencyToggleBtn')) $('currencyToggleBtn').textContent = state.displayCurrency;
  if ($('currencyToggleBtnDesktop')) $('currencyToggleBtnDesktop').textContent = state.displayCurrency;
  if (window.FireSync && typeof window.FireSync.init === 'function') window.FireSync.init();
  setTimeout(() => { const q = $('quickEntryInput'); if (q) q.focus(); }, 300);
});
