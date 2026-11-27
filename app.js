/* ==========================================================================
   app.js — نظام مركز عاشور المحدّث
   الجزء 1/2
   ========================================================================== */

const CURRENCY = 'ل.س.ج';
const $ = id => document.getElementById(id);

/* ---------- أدوات مساعدة ---------- */
function toNum(val) { const n = Number(val); return Number.isFinite(n) ? n : 0; }
function roundMoney(val) { return Math.round((toNum(val) + Number.EPSILON) * 100) / 100; }
function calcLineTotal(price, qty) { return roundMoney(toNum(price) * toNum(qty)); }
function sumList(arr, getter) {
  let t = 0; for (let i = 0; i < arr.length; i++) t = roundMoney(t + toNum(getter(arr[i]))); return t;
}
function getRate() { const r = toNum(state.exchangeRate); return r > 0 ? r : 15000; }
function sypToUsd(sypVal) { return roundMoney(toNum(sypVal) / getRate()); }
function usdToSyp(usdVal) { return roundMoney(toNum(usdVal) * getRate()); }
function fmt(n) {
  const num = roundMoney(n); const parts = String(num).split('.');
  const intFormatted = Number(parts[0]).toLocaleString('en-US');
  return parts.length > 1 ? `${intFormatted}.${parts[1]}` : intFormatted;
}
function fmtCur(sypAmount) {
  if (state.displayCurrency === 'USD') {
    const usd = toNum(sypAmount) / getRate();
    return '$' + usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return `${fmt(sypAmount)} ل.س.ج`;
}
function fmtDual(sypAmount) {
  const usd = toNum(sypAmount) / getRate();
  return `${fmt(sypAmount)} ل.س.ج (≈ $${usd.toFixed(2)})`;
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function normalizeArabic(str) { return String(str || '').toLowerCase().replace(/[أآإٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[\u064b-\u065f]/g, ''); }
function nowStr() { return new Date().toLocaleString('ar-SY'); }
function dayKey(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function debounce(fn, ms = 200) {
  let t = null;
  return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
}

/* ---------- نظام الصوت ---------- */
let audioCtx = null;
function playSound(type = 'success') {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    if (type === 'success') {
      [880, 1320].forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.frequency.value = freq; osc.type = 'sine';
        gain.gain.setValueAtTime(0, now + i * 0.08);
        gain.gain.linearRampToValueAtTime(0.25, now + i * 0.08 + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.16);
        osc.start(now + i * 0.08); osc.stop(now + i * 0.08 + 0.16);
      });
    } else if (type === 'error') {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.frequency.value = 200; osc.type = 'sawtooth';
      gain.gain.setValueAtTime(0.22, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.start(now); osc.stop(now + 0.3);
    } else if (type === 'scan') {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.frequency.value = 1500; osc.type = 'square';
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.start(now); osc.stop(now + 0.08);
    } else if (type === 'add') {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.frequency.value = 660; osc.type = 'triangle';
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.start(now); osc.stop(now + 0.12);
    }
  } catch (_) {}
}
window.playSound = playSound;

/* ---------- SweetAlert wrappers ---------- */
const warn = (title, text, icon = 'warning') => Swal.fire({ icon, title, text, confirmButtonColor: '#0F5C4E' });
const toast = (title, icon = 'success') => Swal.fire({ toast: true, position: 'top-end', icon, title, showConfirmButton: false, timer: 1600 });

const debouncedRenderPosProducts   = debounce(() => renderPosProducts(), 150);
const debouncedPopulatePosClients  = debounce(() => populatePosClients(), 150);
const debouncedRenderInvoicesTable = debounce(() => renderInvoicesTable(), 180);
const debouncedRenderProductsTable = debounce(() => renderProductsTable(), 180);
const debouncedRenderInventory     = debounce(() => renderInventory(), 180);
const debouncedRenderClientsGrid   = debounce(() => renderClientsGrid(), 180);
const debouncedRenderCompaniesGrid = debounce(() => renderCompaniesGrid(), 180);

const DEFAULT_CATEGORIES = ['بسكويت', 'شيبس', 'عصائر ومشروبات', 'سكاكر وعلكة', 'قهوة', 'مواد غذائية'];

let state = {};
let isCheckoutSubmitting = false;
let currentDebtTab = 'take';
let isInitialEmptyStart = false;

function defaultState() {
  return {
    pinHash: null, pinSalt: null, pinLength: 4, pinAttempts: 0, pinLockUntil: 0,
    pinChangedByUser: false,
    storeInfo: { name: 'مركز عاشور للتجارة', phone: '0991234567', address: 'السوق المركزي - صالة الجملة' },
    displayCurrency: 'SYP',
    exchangeRate: 15000,
    printerWidth: 80,
    darkMode: false,
    products: [],
    clients: [
      { id: 'c1', name: 'زبون نقدي مباشر', type: 'retail', phone: '-', address: '-', openingDebt: 0, customPrices: {}, creditLimit: 0 }
    ],
    invoices: [], expenses: [], payments: [], returns: [], directSales: [], noInvoiceItems: [],
    companies: [], purchases: [], companyPayments: [], personDebts: [],
    orders: [], dailyCloses: [],
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

/* ---------- حفظ / تحميل ---------- */
async function saveToStorage(options = { touchTime: true }) {
  if (options && options.touchTime !== false) state.lastUpdated = Date.now();
  const result = await AshourDB.save(state);
  if (!result.ok) {
    Swal.fire({ icon: 'error', title: 'فشل الحفظ المحلي!', html: `تعذّر حفظ البيانات.<br><small>${esc(result.errors.join(' | '))}</small>`, confirmButtonColor: '#d33' });
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
  if (result.ok && result.state) {
    state = deepMerge(defaultState(), result.state);
    isInitialEmptyStart = false;
  } else {
    state = defaultState();
    isInitialEmptyStart = true;
  }
  ['returns', 'directSales', 'noInvoiceItems', 'companies', 'payments', 'expenses', 'invoices', 'products', 'clients', 'purchases', 'companyPayments', 'personDebts', 'orders', 'dailyCloses'].forEach(k => {
    if (!Array.isArray(state[k])) state[k] = [];
  });
  state.clients.forEach(c => {
    if (!c.customPrices || typeof c.customPrices !== 'object') c.customPrices = {};
    if (typeof c.creditLimit === 'undefined') c.creditLimit = 0;
  });
  state.products.forEach(p => {
    if (p.stock == null || !Number.isFinite(Number(p.stock))) p.stock = 0;
    if (p.lowStockThreshold == null) p.lowStockThreshold = 10;
  });
  if (!state.invoiceCounter) state.invoiceCounter = 1000;
  if (!toNum(state.exchangeRate) || toNum(state.exchangeRate) <= 0) state.exchangeRate = 15000;
  if (!state.printerWidth) state.printerWidth = 80;
  if (typeof state.darkMode === 'undefined') state.darkMode = false;
  if (!state.pinSalt) state.pinSalt = generateSalt();
  if (!state.pinHash) {
    state.pinHash = await hashPin('1234', state.pinSalt);
    state.pinLength = 4;
  }
  if (!state.pinLength) state.pinLength = 4;
  await AshourDB.save(state);
  applyTheme(state.darkMode);
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

/* ---------- PIN ---------- */
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
    playSound('error');
    return;
  }
  const h = await hashPin(enteredPin, state.pinSalt);
  if (h === state.pinHash) {
    $('pinOverlay').classList.add('hidden');
    state.pinAttempts = 0;
    await saveToStorage({ touchTime: false });
    clearPin();
    resetAutoLock();
    // إجبار تغيير PIN عند أول استخدام (أو إذا كان ما زال افتراضياً)
    if (!state.pinChangedByUser) {
      isInitialEmptyStart = false;
      setTimeout(() => {
        Swal.fire({
          icon: 'warning',
          title: 'تغيير رمز PIN مطلوب',
          html: 'لأمان حسابك، يجب تغيير الرمز الافتراضي (1234) إلى رمز خاص بك الآن.<br><small class="text-slate-500">لن يمكنك استخدام النظام قبل التغيير.</small>',
          allowOutsideClick: false,
          allowEscapeKey: false,
          showCancelButton: false,
          confirmButtonColor: '#0F5C4E',
          confirmButtonText: 'الذهاب لتغيير الرمز'
        }).then(() => {
          switchTab('settings');
          setTimeout(() => {
            const newPin = $('newPinInput');
            if (newPin) newPin.focus();
            Swal.fire({ icon: 'info', title: 'خطوة أخيرة', text: 'أدخل الرمز الحالي 1234 ثم اختر رقماً جديداً.' });
          }, 300);
        });
      }, 200);
    }
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
    playSound('error');
    setTimeout(() => clearPin(), 600);
    await saveToStorage({ touchTime: false });
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
  autoLockTimer = setTimeout(() => { if ($('pinOverlay').classList.contains('hidden')) lockApp(); }, 300000);
}
['click', 'mousemove', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, resetAutoLock, { passive: true }));

function logAudit(type, details) {
  const entry = { ts: Date.now(), date: nowStr(), type, details, status: 'PIN ✓' };
  state.auditLog.unshift(entry);
  if (state.auditLog.length > 500) state.auditLog.length = 500;
  AshourDB.addAudit(entry);
}

/* ---------- عملة + وضع ليلي + قائمة الجوال ---------- */
async function toggleCurrency() {
  state.displayCurrency = state.displayCurrency === 'USD' ? 'SYP' : 'USD';
  const label = state.displayCurrency === 'USD' ? 'USD' : 'ل.س.ج';
  const btn = $('currencyToggleBtn'); const btnD = $('currencyToggleBtnDesktop');
  if (btn) btn.textContent = label;
  if (btnD) btnD.textContent = label;
  await saveToStorage();
  renderAll();
  toast(`تم التبديل إلى ${state.displayCurrency === 'USD' ? 'الدولار ($)' : 'الليرة السورية (ل.س.ج)'}`, 'info');
}

function applyTheme(isDark) {
  document.documentElement.classList.toggle('dark', !!isDark);
}
async function toggleDarkMode() {
  state.darkMode = !state.darkMode;
  applyTheme(state.darkMode);
  await saveToStorage();
  toast(state.darkMode ? 'الوضع الليلي مفعّل' : 'الوضع النهاري مفعّل', 'info');
}

function openMobileMenu() { const p = $('mobileMenuPanel'); if (p) p.classList.add('open'); }
function closeMobileMenu() { const p = $('mobileMenuPanel'); if (p) p.classList.remove('open'); }
window.openMobileMenu = openMobileMenu;
window.closeMobileMenu = closeMobileMenu;

/* ---------- Dropdowns & Tabs ---------- */
function closeAllDropdowns() { document.querySelectorAll('.dropdown-panel').forEach(el => el.classList.add('hidden')); }
function toggleDropdown(id) {
  const target = $(id); if (!target) return;
  const wasHidden = target.classList.contains('hidden');
  closeAllDropdowns();
  if (wasHidden) target.classList.remove('hidden');
}
document.addEventListener('click', (e) => { if (!e.target.closest('.relative')) closeAllDropdowns(); });

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

const MODAL_IDS = ['barcodeScannerModal', 'quickProductModal', 'directSaleModal', 'productModal', 'companyModal', 'companyProductModal', 'purchaseModal', 'personDebtModal', 'companyPaymentModal', 'receiptModal', 'clientModal', 'customPricesModal', 'expenseModal', 'dailyCloseModal'];

window.addEventListener('popstate', () => {
  if ($('barcodeScannerModal') && !$('barcodeScannerModal').classList.contains('hidden')) { closeBarcodeScanner(); history.pushState(null, null, location.href); return; }
  const openMod = MODAL_IDS.find(id => $(id) && !$(id).classList.contains('hidden'));
  if (openMod) { closeModal(openMod); history.pushState(null, null, location.href); return; }
  const activeTab = document.querySelector('.tab-btn.active');
  if (activeTab && activeTab.id !== 'tab-pos') { switchTab('pos'); history.pushState(null, null, location.href); return; }
});
history.pushState(null, null, location.href);

function openModal(id) {
  const el = $(id); if (!el) return;
  el.classList.remove('hidden'); el.style.display = 'flex';
}
function closeModal(id) {
  const el = $(id); if (!el) return;
  el.classList.add('hidden'); el.style.display = 'none';
}

function allCategories() {
  const set = new Set(DEFAULT_CATEGORIES);
  state.products.forEach(p => { if (p.category) set.add(p.category); });
  return [...set];
}
function refreshCategoryWidgets() {
  const cats = allCategories();
  if ($('categoryList')) $('categoryList').innerHTML = cats.map(c => `<option value="${esc(c)}"></option>`).join('');
  if ($('prodCatDropdownList')) {
    $('prodCatDropdownList').innerHTML = `<div data-cat="" class="prod-cat-opt p-2.5 hover:bg-slate-100 cursor-pointer text-xs font-bold">جميع الفئات</div>` +
      cats.map(c => `<div data-cat="${esc(c)}" class="prod-cat-opt p-2.5 hover:bg-slate-100 cursor-pointer text-xs font-bold">${esc(c)}</div>`).join('');
    $('prodCatDropdownList').querySelectorAll('.prod-cat-opt').forEach(el => {
      el.addEventListener('click', () => selectProdCat(el.dataset.cat));
    });
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

/* ---------- المخزون ---------- */
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
  renderInventory(); renderProductsTable(); renderPosProducts(); updateLowStockBadge();
  playSound('success');
  toast(`تم تحديث مخزون ${p.name} إلى ${fmt(cleanStock)}`);
}

function isLowStock(p) { const t = p.lowStockThreshold != null ? toNum(p.lowStockThreshold) : 10; return toNum(p.stock) <= t; }

function updateLowStockBadge() {
  const lowCount = state.products.filter(isLowStock).length;
  const badge = $('lowStockBadge');
  if (!badge) return;
  if (lowCount > 0) { badge.textContent = lowCount; badge.classList.remove('hidden'); }
  else badge.classList.add('hidden');
}

function renderInventory() {
  updateLowStockBadge();
  const q = normalizeArabic(($('invSearchInput')?.value || '').trim());
  const statusFilter = $('invStatusFilter')?.value || 'all';
  const totalProducts = state.products.length;
  const lowProducts = state.products.filter(isLowStock).length;
  const outProducts = state.products.filter(p => toNum(p.stock) <= 0).length;
  const stockCostValue = sumList(state.products, p => calcLineTotal(p.cost, p.stock));

  if ($('inventorySummaryCards')) {
    $('inventorySummaryCards').innerHTML = `
      <div class="bg-slate-50 border rounded-xl p-2.5"><span class="block text-xs text-slate-500">إجمالي الأصناف</span><span class="font-bold text-slate-800">${fmt(totalProducts)}</span></div>
      <div class="bg-amber-50 border border-amber-200 rounded-xl p-2.5"><span class="block text-xs text-amber-700">منخفض</span><span class="font-bold text-amber-800">${fmt(lowProducts)}</span></div>
      <div class="bg-rose-50 border border-rose-200 rounded-xl p-2.5"><span class="block text-xs text-rose-700">نافذ (0)</span><span class="font-bold text-rose-700">${fmt(outProducts)}</span></div>
      <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-2.5"><span class="block text-xs text-emerald-700">قيمة المخزون (شراء)</span><span class="font-bold text-emerald-800">${fmtCur(stockCostValue)}</span></div>`;
  }

  const list = state.products.filter(p => {
    const s = toNum(p.stock);
    if (statusFilter === 'low' && !isLowStock(p)) return false;
    if (statusFilter === 'out' && !(s <= 0)) return false;
    if (statusFilter === 'available' && isLowStock(p)) return false;
    if (q && !(normalizeArabic(p.name).includes(q) || normalizeArabic(p.sku).includes(q) || normalizeArabic(p.barcode).includes(q))) return false;
    return true;
  });

  const tbody = $('inventoryTableBody');
  if (!tbody) return;
  tbody.innerHTML = list.map(p => {
    const s = toNum(p.stock);
    const th = p.lowStockThreshold != null ? toNum(p.lowStockThreshold) : 10;
    const val = calcLineTotal(p.cost, s);
    let badgeHtml = `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800">متوفر</span>`;
    if (s <= 0) badgeHtml = `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-rose-100 text-rose-700">نافذ</span>`;
    else if (s <= th) badgeHtml = `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-800">منخفض</span>`;

    return `<tr class="hover:bg-slate-50 border-b border-slate-100">
      <td class="p-3 font-bold text-ashour">${esc(p.sku || '-')}</td>
      <td class="p-3 font-bold text-slate-800">${esc(p.name)}</td>
      <td class="p-3"><span class="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-[11px]">${esc(p.category || '-')}</span></td>
      <td class="p-3 font-bold ${s <= 0 ? 'text-rose-600' : (s <= th ? 'text-amber-700' : 'text-emerald-800')}">${fmt(s)}</td>
      <td class="p-3 text-amber-700 font-bold">${fmt(th)}</td>
      <td class="p-3 text-slate-700">${fmtCur(val)}</td>
      <td class="p-3">${badgeHtml}</td>
      <td class="p-3 text-center">
        <div class="inline-flex items-center gap-1 bg-slate-100 p-1 rounded-xl border">
          <button type="button" onclick="adjustProductStockDelta('${esc(p.id)}', -1)" class="w-8 h-8 bg-white hover:bg-rose-500 hover:text-white rounded-lg text-xs font-bold shadow-sm transition">−</button>
          <input type="number" step="any" min="0" value="${s}" onchange="setProductStockExact('${esc(p.id)}', this.value)" class="w-16 text-center bg-white border border-slate-300 rounded-lg text-xs font-bold py-1">
          <button type="button" onclick="adjustProductStockDelta('${esc(p.id)}', 1)" class="w-8 h-8 bg-white hover:bg-ashour hover:text-white rounded-lg text-xs font-bold shadow-sm transition">+</button>
          <button type="button" onclick="adjustProductStockDelta('${esc(p.id)}', 10)" class="bg-emerald-100 hover:bg-emerald-600 hover:text-white text-emerald-800 px-2 py-1 rounded-lg text-[11px] font-bold transition">+10</button>
        </div>
      </td>
    </tr>`;
  }).join('') || `<tr><td colspan="8" class="p-6 text-center text-slate-400 text-sm">لا توجد أصناف مطابقة</td></tr>`;
}

/* ---------- ديون الزبائن والأسعار ---------- */
function getClientRawBalance(clientId) {
  const c = state.clients.find(x => x.id === clientId);
  if (!c) return 0;
  return roundMoney(
    toNum(c.openingDebt) +
    sumList(state.invoices.filter(i => i.clientId === clientId && i.status === 'active'), i => i.remaining) -
    sumList(state.payments.filter(p => p.clientId === clientId), p => p.amount) -
    sumList(state.returns.filter(r => r.clientId === clientId), r => r.amount)
  );
}
function getClientDebt(clientId) { return Math.max(0, getClientRawBalance(clientId)); }
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
  logAudit('تسعير خاص لزبون', `${client.name} — ${prod ? prod.name : productId}: ${cleanPrice > 0 ? fmtCur(cleanPrice) : 'إلغاء'}`);
  return await saveToStorage();
}

function openCustomPricesModal(clientId) {
  const client = state.clients.find(c => c.id === clientId);
  if (!client) { warn('تنبيه', 'الزبون غير موجود', 'error'); return; }
  if (!state.products.length) { warn('لا توجد منتجات', 'أضف منتجات أولاً', 'info'); return; }
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
  const list = state.products.filter(p => !q || normalizeArabic(p.name).includes(q) || normalizeArabic(p.sku).includes(q) || normalizeArabic(p.barcode).includes(q));
  const setCount = Object.values(editing.draft).filter(v => toNum(v) > 0).length;
  const statsEl = $('cpStats');
  if (statsEl) statsEl.textContent = `${setCount} سعر مفعّل`;
  if (!list.length) {
    $('customPricesList').innerHTML = `<div class="text-center py-10 text-slate-400 text-sm font-bold">لا توجد منتجات مطابقة</div>`;
    return;
  }
  $('customPricesList').innerHTML = list.map(p => {
    const currentCustom = toNum(editing.draft[p.id]) || 0;
    const displayVal = currentCustom > 0 ? (state.displayCurrency === 'USD' ? sypToUsd(currentCustom) : currentCustom) : '';
    return `<div class="cp-row ${currentCustom > 0 ? 'is-set' : ''}">
      <div class="min-w-0">
        <div class="font-bold text-sm text-slate-800 truncate">${esc(p.name)}</div>
        <div class="text-[11px] text-slate-500 font-semibold num-tabular">تجزئة: ${fmtCur(p.retailPrice)} • جملة: ${fmtCur(p.wholesalePrice)}</div>
      </div>
      <div class="flex items-center gap-1">
        <input type="number" step="any" min="0" data-pid="${esc(p.id)}" value="${displayVal}" placeholder="0" oninput="onCustomPriceInput(this)" class="w-24 border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
        <button type="button" onclick="clearCustomPriceField('${esc(p.id)}')" class="text-rose-500 hover:text-rose-700 w-8 h-8 flex items-center justify-center"><i class="fa-solid fa-xmark"></i></button>
      </div>
    </div>`;
  }).join('');
}

function onCustomPriceInput(el) {
  const editing = state.customPricesEditing;
  if (!editing) return;
  const pid = el.dataset.pid;
  const raw = toNum(el.value);
  const val = state.displayCurrency === 'USD' ? usdToSyp(raw) : roundMoney(raw);
  if (val > 0) editing.draft[pid] = val; else delete editing.draft[pid];
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
  playSound('success');
  toast('تم حفظ الأسعار الخاصة');
}

async function clearAllCustomPrices() {
  const editing = state.customPricesEditing;
  if (!editing) return;
  const res = await Swal.fire({
    title: 'مسح كل الأسعار الخاصة؟', text: 'سيتم إلغاء جميع الأسعار الخاصة لهذا الزبون عند الحفظ.',
    icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6',
    confirmButtonText: 'نعم، امسح', cancelButtonText: 'إلغاء'
  });
  if (!res.isConfirmed) return;
  editing.draft = {};
  renderCustomPricesList();
  toast('سيتم المسح عند الحفظ', 'info');
}

/* ---------- الكاشير والسلة ---------- */
function initPOSCategories() {
  const cats = ['الكل', ...allCategories()];
  if (!cats.includes(state.selectedPosCategory)) state.selectedPosCategory = 'الكل';
  const renderCatButtons = (container, isSidebar) => {
    if (!container) return;
    container.innerHTML = cats.map(cat => {
      const active = state.selectedPosCategory === cat;
      const count = cat === 'الكل' ? state.products.length : state.products.filter(p => p.category === cat).length;
      if (isSidebar) {
        return `<button type="button" data-cat="${esc(cat)}" class="pos-cat-btn w-full text-right px-2.5 py-2 rounded-lg transition flex items-center justify-between ${active ? 'bg-ashour text-white shadow-sm' : 'bg-slate-50 text-slate-700 hover:bg-slate-100'}"><span>${esc(cat)}</span><span class="text-[11px] num-tabular ${active ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'} px-1.5 py-0.5 rounded-full font-bold">${count}</span></button>`;
      }
      return `<button type="button" data-cat="${esc(cat)}" class="pos-cat-btn px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition ${active ? 'bg-ashour text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}">${esc(cat)}</button>`;
    }).join('');
    container.querySelectorAll('.pos-cat-btn').forEach(btn => {
      btn.addEventListener('click', () => setPosCat(btn.dataset.cat));
    });
  };
  renderCatButtons($('posCategorySidebar'), true);
  renderCatButtons($('posCategoryFilter'), false);
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
    badge.className = isWholesale ? 'inline-block bg-amber-100 text-amber-800 text-xs px-2 py-0.5 rounded font-bold mt-1' : 'inline-block bg-emerald-100 text-emerald-800 text-xs px-2 py-0.5 rounded font-bold mt-1';
  }
  if (invBadge) {
    invBadge.textContent = `تسعيرة: ${isWholesale ? 'جملة' : 'تجزئة'}${!state.posPriceOverride && customCount > 0 ? ' (أسعار خاصة)' : ''}`;
    invBadge.className = isWholesale ? 'text-[11px] px-2 py-0.5 rounded-full font-bold bg-amber-400 text-slate-950' : 'text-[11px] px-2 py-0.5 rounded-full font-bold bg-emerald-500/25 text-white border border-white/20';
  }
}

function populatePosClients() {
  const filter = ($('posClientSearch')?.value || '').trim();
  const list = state.clients.filter(c => !filter || normalizeArabic(c.name).includes(normalizeArabic(filter)) || (c.phone || '').includes(filter));
  const dropdown = $('clientDropdownList');
  if (!dropdown) return;
  dropdown.innerHTML = list.map(c => {
    const cCount = c.customPrices ? Object.values(c.customPrices).filter(v => toNum(v) > 0).length : 0;
    return `<div data-cid="${esc(c.id)}" class="pos-client-opt p-2.5 hover:bg-emerald-50 cursor-pointer text-xs font-bold flex justify-between items-center num-tabular">
      <span>${esc(c.name)} ${cCount > 0 ? `<span class="text-[10px] bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded mr-1">${cCount} خاص</span>` : ''}</span>
      <span class="text-[11px] text-slate-500">دين: ${fmtCur(getClientDebt(c.id))}</span>
    </div>`;
  }).join('');
  dropdown.querySelectorAll('.pos-client-opt').forEach(el => {
    el.addEventListener('click', () => selectClientById(el.dataset.cid));
  });
  if (list.length && !$('posClientSelect').value) selectClientById(list[0].id, true);
}
function selectClientById(id, silent = false) {
  const c = state.clients.find(x => x.id === id) || state.clients[0];
  if (!c) return;
  $('posClientSelect').value = c.id;
  $('selectedClientText').textContent = c.name;
  $('clientDropdownList').classList.add('hidden');
  state.posPriceOverride = null;
  onPosClientChange(silent);
}
function toggleClientDropdown() { populatePosClients(); toggleDropdown('clientDropdownList'); }
function onPosClientChange(silent = false) {
  const client = getSelectedPosClient();
  if (state.cart.length > 0) {
    state.cart.forEach(item => { if (!item.isQuickOnly) delete item.customPrice; });
  }
  updatePosPriceUI();
  renderPosProducts();
  renderCart();
  if (!silent && client && client.id !== 'c1') {
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
    const th = p.lowStockThreshold != null ? toNum(p.lowStockThreshold) : 10;
    const stockBadge = stockVal <= 0 ? 'bg-rose-100 text-rose-700' : (stockVal <= th ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600');
    return `<div onclick="addToCart('${esc(p.id)}', this)" class="bg-white border ${resolved.isCustom ? 'border-purple-300 ring-1 ring-purple-200' : 'border-slate-200'} hover:border-ashour cursor-pointer transition flex flex-col justify-between rounded-xl p-2.5 shadow-sm card-hover relative group">
      <div>
        <div class="flex items-center justify-between gap-1">
          <span class="text-[11px] text-ashour font-bold bg-ashour/10 px-1.5 py-0.5 rounded w-fit num-tabular">${esc(p.sku || '-')}</span>
          <span class="text-[10px] px-1.5 py-0.5 rounded font-bold num-tabular ${stockBadge}">مخزون: ${fmt(stockVal)}</span>
        </div>
        <h4 class="font-bold text-sm text-slate-800 line-clamp-2 leading-tight mt-1">${esc(p.name)}</h4>
      </div>
      <div class="mt-2 flex items-end justify-between border-t border-slate-100 pt-1.5 num-tabular">
        <span class="text-sm ${price > 0 ? (resolved.isCustom ? 'text-purple-700 font-bold' : 'text-ashour font-bold') : 'text-rose-500 font-bold text-xs'}">${price > 0 ? fmtCur(price) : 'حدد السعر'}</span>
        <div class="w-7 h-7 bg-ashour/10 text-ashour rounded-md flex items-center justify-center group-hover:bg-ashour group-hover:text-white transition"><i class="fa-solid fa-plus text-xs"></i></div>
      </div>
    </div>`;
  }).join('');
}

function showFloatPlus(cardEl) {
  if (!cardEl) return;
  const span = document.createElement('span');
  span.className = 'float-plus';
  span.textContent = '+1';
  cardEl.style.position = 'relative';
  cardEl.appendChild(span);
  setTimeout(() => span.remove(), 750);
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
    String(p.barcode || '').trim() === code || String(p.sku || '').trim() === code || normalizeArabic(p.name) === normalizeArabic(code)
  );
  if (!product) {
    playSound('error');
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
    playSound('error');
    Swal.fire({ icon: 'info', title: 'السعر غير محدد', text: `حدّد سعر ${product.name} أولاً.`, confirmButtonColor: '#0F5C4E' })
      .then(() => openProductModal(product.id));
    return;
  }
  const existing = state.cart.find(i => i.productId === product.id && !i.isQuickOnly);
  if (existing) existing.qty = roundMoney(toNum(existing.qty) + qty);
  else state.cart.push({ productId: product.id, qty });
  renderCart();
  playSound('scan');
  input.value = '';
  input.focus();
  toast(`تمت إضافة ${qty} × ${product.name}`);
}

function addToCart(productId, cardEl = null) {
  const product = state.products.find(p => p.id === productId);
  if (!product) return;
  const client = getSelectedPosClient();
  const resolved = resolveProductPricing(product, client, state.posPriceOverride);
  if (!(resolved.price > 0)) {
    playSound('error');
    Swal.fire({ icon: 'info', title: 'السعر غير محدد', text: 'حدد السعر أولاً.', confirmButtonColor: '#0F5C4E' })
      .then(() => openProductModal(productId));
    return;
  }
  const existing = state.cart.find(i => i.productId === productId && !i.isQuickOnly);
  if (existing) existing.qty = roundMoney(toNum(existing.qty) + 1);
  else state.cart.push({ productId, qty: 1 });

  playSound('add');
  showFloatPlus(cardEl);
  if (cardEl) { cardEl.classList.add('product-flash'); setTimeout(() => cardEl.classList.remove('product-flash'), 600); }
  renderCart(true);
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
  const rawDiscount = toNum($('posDiscount')?.value);
  const discountSyp = state.displayCurrency === 'USD' ? usdToSyp(rawDiscount) : roundMoney(rawDiscount);
  const discount = Math.max(0, Math.min(discountSyp, subtotal));
  const total = roundMoney(subtotal - discount);
  const discountPct = subtotal > 0 ? roundMoney((discount / subtotal) * 100) : 0;
  return { subtotal, discount, total, cost, discountPct };
}

function renderCart(animateLast = false) {
  const container = $('cartItemsList');
  const { subtotal, total, discount, discountPct } = cartTotals();
  if (!state.cart.length) {
    container.innerHTML = `<div class="text-center py-10 text-slate-400"><i class="fa-solid fa-basket-shopping text-3xl mb-2 opacity-40"></i><p class="text-xs font-bold">السلة فارغة.</p></div>`;
  } else {
    container.innerHTML = state.cart.map((item, idx) => {
      const info = getCartItemInfo(item);
      if (!info) return '';
      const isLast = idx === state.cart.length - 1 && animateLast;
      return `<div class="py-2 flex items-center justify-between gap-2 num-tabular ${isLast ? 'cart-item-new' : ''}">
        <div class="flex-grow min-w-0">
          <h5 class="font-bold text-xs text-slate-800 truncate">${esc(info.name)} ${info.isCustom ? '<span class="text-[10px] bg-purple-100 text-purple-800 px-1 rounded">خاص</span>' : ''}</h5>
          <span class="text-[11px] text-slate-500 font-semibold">${fmtCur(info.unitPrice)} × ${item.qty}</span>
        </div>
        <div class="flex items-center gap-1">
          <button onclick="updateCartQty('${esc(info.key)}', -1)" class="w-7 h-7 bg-slate-200 hover:bg-rose-500 hover:text-white rounded text-xs font-bold">−</button>
          <input type="number" min="0" step="any" value="${item.qty}" onchange="setCartItemQtyDirect('${esc(info.key)}', this.value)" class="w-12 text-center bg-slate-50 border border-slate-300 rounded text-xs font-bold py-0.5">
          <button onclick="updateCartQty('${esc(info.key)}', 1)" class="w-7 h-7 bg-slate-200 hover:bg-ashour hover:text-white rounded text-xs font-bold">+</button>
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
  $('posPaidAmount').placeholder = state.displayCurrency === 'USD' ? `الإجمالي: $${sypToUsd(total).toFixed(2)}` : `الإجمالي: ${fmt(total)} ل.س.ج`;
  updatePaymentSummaryPreview();
}

function setPaidExact() { $('posPaidAmount').value = ''; updatePaymentSummaryPreview(); }
function setCreditMode() { $('posPaidAmount').value = 0; updatePaymentSummaryPreview(); }
function parseEnteredSyp(rawStr, fallbackSyp) {
  const trimmed = String(rawStr || '').trim();
  if (trimmed === '') return fallbackSyp;
  const val = Math.max(0, toNum(trimmed));
  return state.displayCurrency === 'USD' ? usdToSyp(val) : roundMoney(val);
}
function updatePaymentSummaryPreview() {
  const { total } = cartTotals();
  const paidEntered = parseEnteredSyp($('posPaidAmount').value, total);
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
    if (!info.isQuickOnly) {
      const prod = state.products.find(p => p.id === info.productId);
      if (prod && toNum(prod.stock) < toNum(item.qty)) {
        const cont = await Swal.fire({
          icon: 'warning', title: 'كمية غير كافية',
          text: `${prod.name}: المتوفر ${fmt(prod.stock)} والمطلوب ${fmt(item.qty)}. هل تريد البيع بالسالب (دين مخزون)؟`,
          showCancelButton: true, confirmButtonColor: '#d97706', cancelButtonColor: '#64748b',
          confirmButtonText: 'متابعة البيع', cancelButtonText: 'إلغاء'
        });
        if (!cont.isConfirmed) return;
      }
    }
  }

  const paidEntered = parseEnteredSyp($('posPaidAmount').value, total);
  const changeGiven = paidEntered > total ? roundMoney(paidEntered - total) : 0;
  const paidRecorded = roundMoney(Math.min(paidEntered, total));
  const remaining = roundMoney(total - paidRecorded);

  if (remaining > 0 && client.id === 'c1') {
    return warn('اختيار الزبون مطلوب', 'لتسجيل فاتورة آجلة أو جزئية، يرجى اختيار زبون مسجل بدلاً من الزبون النقدي المباشر.', 'warning');
  }
  if (remaining > 0 && toNum(client.creditLimit) > 0) {
    const currentDebt = getClientDebt(client.id);
    const newDebt = roundMoney(currentDebt + remaining);
    if (newDebt > toNum(client.creditLimit)) {
      const cont = await Swal.fire({
        icon: 'warning', title: 'تجاوز الحد الائتماني',
        html: `الحد: <b>${fmtCur(client.creditLimit)}</b><br>الدين الحالي: <b>${fmtCur(currentDebt)}</b><br>بعد الفاتورة: <b class="text-rose-600">${fmtCur(newDebt)}</b>`,
        showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#64748b',
        confirmButtonText: 'متابعة على مسؤوليتي', cancelButtonText: 'إلغاء'
      });
      if (!cont.isConfirmed) return;
    }
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
        if (prod) prod.stock = roundMoney(toNum(prod.stock) - toNum(it.qty));
      }
    });

    const inv = {
      id: nextInvoiceNumber(),
      ts: Date.now(), date: nowStr(),
      clientId: client.id, clientName: client.name,
      priceMode: priceModeLabel, paymentType,
      items, discount, total,
      paid: paidRecorded, remaining, changeGiven,
      profit: roundMoney(total - cost), status: 'active',
      exchangeRate: getRate(),
      exchangeRateUsd: sypToUsd(total)
    };

    const previousInvoices = [...state.invoices];
    state.invoices.push(inv);
    logAudit('بيع فاتورة', `فاتورة ${inv.id} للزبون ${client.name} (${priceModeLabel}) بمبلغ ${fmtCur(total)} — متبقٍ ${fmtCur(remaining)}`);

    const ok = await saveToStorage();
    if (!ok) {
      state.invoices = previousInvoices;
      state.invoiceCounter = prevCounter;
      state.products.forEach(p => { if (prevStockMap.has(p.id)) p.stock = prevStockMap.get(p.id); });
      playSound('error');
      return;
    }

    playSound('success');
    showReceiptModal(inv);
    clearCart();
    renderAll();
    toast('تم حفظ الفاتورة');
  } finally {
    setTimeout(() => { isCheckoutSubmitting = false; if (saveBtn) saveBtn.disabled = false; }, 350);
  }
}

async function addCartToOrdersAndPrint() {
  if (!state.cart.length) return warn('السلة فارغة', 'أضف منتجات إلى السلة أولاً');
  const currentClient = getSelectedPosClient();
  const { value: formVals } = await Swal.fire({
    title: 'إضافة إلى قائمة الطلبات وطباعة فاتورة',
    html: `
      <div class="text-right space-y-2 text-sm font-bold">
        <label class="block">الزبون:</label>
        <select id="swal-ord-client" class="swal2-select w-full m-0">
          ${state.clients.map(c => `<option value="${esc(c.id)}" ${c.id === currentClient.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>
        <label class="block pt-1">تاريخ الاستلام:</label>
        <input id="swal-ord-date" type="date" class="swal2-input w-full m-0" value="${new Date(Date.now() + 86400000).toISOString().split('T')[0]}">
        <label class="block pt-1">ملاحظات الطلب:</label>
        <input id="swal-ord-notes" type="text" class="swal2-input w-full m-0" placeholder="ملاحظات إضافية (اختياري)">
      </div>
    `,
    focusConfirm: false, showCancelButton: true, confirmButtonColor: '#d97706', cancelButtonColor: '#64748b',
    confirmButtonText: 'حفظ الطلب وطباعة', cancelButtonText: 'إلغاء',
    preConfirm: () => {
      const clientId = $('swal-ord-client').value;
      const dueDate = $('swal-ord-date').value;
      const notes = $('swal-ord-notes').value.trim();
      if (!clientId) return Swal.showValidationMessage('اختر الزبون');
      if (!dueDate) return Swal.showValidationMessage('حدد تاريخ الاستلام');
      return { clientId, dueDate, notes };
    }
  });
  if (!formVals) return;
  const client = state.clients.find(c => c.id === formVals.clientId) || currentClient;
  const { subtotal, discount, total } = cartTotals();
  const items = state.cart.map(item => {
    const info = getCartItemInfo(item);
    return { productId: info.productId, name: info.name, qty: toNum(item.qty), price: info.unitPrice, total: calcLineTotal(info.unitPrice, item.qty), isQuickOnly: info.isQuickOnly };
  });
  const orderObj = {
    id: 'ORD-' + Date.now().toString().slice(-6), ts: Date.now(), date: nowStr(),
    clientId: client.id, clientName: client.name, dueDate: formVals.dueDate, dueTime: '',
    dueTs: new Date(formVals.dueDate + 'T12:00:00').getTime(),
    items, discount, subtotal, total, notes: formVals.notes || '-', status: 'pending'
  };
  state.orders.push(orderObj);
  logAudit('إضافة طلب من الكاشير', `طلب ${orderObj.id} للزبون ${client.name} بقيمة ${fmtCur(total)}`);
  const ok = await saveToStorage();
  if (!ok) { state.orders.pop(); return; }
  updateOrdersBadge(); renderOrders();
  playSound('success');
  showReceiptModal({
    id: orderObj.id, ts: orderObj.ts, date: orderObj.date, clientId: client.id, clientName: client.name,
    priceMode: 'طلب محجوز', items, discount, total, paid: 0, remaining: total, changeGiven: 0
  });
  toast('تمت إضافة الطلب وفتح الفاتورة');
}

function renderOrders() {
  updateOrdersBadge();
  const grid = $('ordersGrid');
  if (!grid) return;
  const list = [...state.orders].filter(o => o.status === 'pending').sort((a, b) => (a.dueTs || 0) - (b.dueTs || 0));
  if (!list.length) {
    grid.innerHTML = `<div class="col-span-full text-center py-10 text-slate-400 text-sm font-bold bg-white rounded-2xl border border-dashed">لا توجد طلبات قيد التنفيذ</div>`;
    return;
  }
  grid.innerHTML = list.map(o => {
    const totalVal = o.total != null ? toNum(o.total) : sumList(o.items || [], it => calcLineTotal(it.price, it.qty));
    return `<div class="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3 flex flex-col justify-between card-hover">
      <div>
        <div class="flex justify-between items-start gap-2">
          <div>
            <span class="text-[11px] font-bold bg-ashour/10 text-ashour px-2 py-0.5 rounded">${esc(o.id)}</span>
            <h4 class="font-bold text-base text-slate-800 mt-1">${esc(o.clientName)}</h4>
          </div>
          <span class="text-xs font-bold px-2 py-1 rounded-lg bg-slate-100 text-slate-700 num-tabular"><i class="fa-regular fa-calendar"></i> ${esc(o.dueDate)}</span>
        </div>
        <div class="mt-2.5 bg-slate-50 border border-slate-100 rounded-xl p-2 space-y-1 text-xs font-semibold num-tabular">
          ${(o.items || []).map(it => `<div class="flex justify-between"><span>${fmt(it.qty)} × ${esc(it.name)}</span><span class="font-bold text-slate-700">${fmtCur(calcLineTotal(it.price, it.qty))}</span></div>`).join('')}
        </div>
        ${o.notes && o.notes !== '-' ? `<p class="text-xs text-slate-500 mt-2 font-semibold"><i class="fa-regular fa-note-sticky"></i> ${esc(o.notes)}</p>` : ''}
      </div>
      <div class="border-t border-slate-100 pt-3 flex items-center justify-between gap-2 num-tabular">
        <span class="text-sm font-bold text-ashour">${fmtCur(totalVal)}</span>
        <div class="flex gap-1.5">
          <button onclick="loadOrderToPOS('${esc(o.id)}')" class="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition"><i class="fa-solid fa-cash-register"></i> للكاشير</button>
          <button onclick="deleteOrder('${esc(o.id)}')" class="bg-rose-100 hover:bg-rose-600 text-rose-700 hover:text-white px-2.5 py-1.5 rounded-lg text-xs font-bold transition"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
    </div>`;
  }).join('');
}

async function loadOrderToPOS(orderId) {
  const o = state.orders.find(x => x.id === orderId);
  if (!o) return;
  if (state.cart.length > 0) {
    const res = await Swal.fire({
      title: 'استبدال السلة الحالية؟', text: 'يوجد أصناف حالياً في سلة الكاشير. هل تريد استبدالها بأصناف الطلب؟',
      icon: 'question', showCancelButton: true, confirmButtonColor: '#0F5C4E', cancelButtonColor: '#64748b',
      confirmButtonText: 'نعم، استبدل', cancelButtonText: 'إلغاء'
    });
    if (!res.isConfirmed) return;
  }
  if (o.clientId && state.clients.some(c => c.id === o.clientId)) selectClientById(o.clientId, true);
  state.cart = (o.items || []).map(it => it.isQuickOnly
    ? { isQuickOnly: true, quickId: 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5), name: it.name, price: toNum(it.price), qty: toNum(it.qty) }
    : { productId: it.productId, qty: toNum(it.qty), customPrice: toNum(it.price) }
  );
  renderCart();
  switchTab('pos');
  toast('تم تحميل الطلب في الكاشير');
}

function deleteOrder(orderId) {
  Swal.fire({ title: 'حذف الطلب؟', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6', confirmButtonText: 'نعم، حذف', cancelButtonText: 'إلغاء' }).then(async res => {
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

function updateOrdersBadge() {
  const pendingCount = (state.orders || []).filter(o => o.status === 'pending').length;
  const badge = $('ordersBadge');
  if (!badge) return;
  if (pendingCount > 0) { badge.textContent = pendingCount; badge.classList.remove('hidden'); }
  else badge.classList.add('hidden');
}
/* ==========================================================================
   app.js — الجزء 2/2
   ========================================================================== */

/* ---------- الباركود ---------- */
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
  playSound('scan');
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
  if (modal) { modal.classList.add('hidden'); modal.style.display = 'none'; }
}

/* ---------- البيع السريع ---------- */
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
  const priceRaw = Math.max(0, toNum($('dsPrice').value));
  const priceSyp = state.displayCurrency === 'USD' ? usdToSyp(priceRaw) : roundMoney(priceRaw);
  const total = calcLineTotal(priceSyp, qty);
  const paidEntered = parseEnteredSyp($('dsPaid').value, total);
  const change = paidEntered > total ? roundMoney(paidEntered - total) : 0;
  const remaining = paidEntered < total ? roundMoney(total - paidEntered) : 0;
  $('dsSummaryText').textContent = `الإجمالي: ${fmtCur(total)} • المدفوع: ${fmtCur(paidEntered)} • الباقي: ${fmtCur(change)} • متبقي: ${fmtCur(remaining)}`;
}

async function saveDirectSale() {
  const name = $('dsName').value.trim();
  const qty = Math.max(1, parseInt($('dsQty').value, 10) || 1);
  const priceRaw = toNum($('dsPrice').value);
  const price = state.displayCurrency === 'USD' ? usdToSyp(priceRaw) : roundMoney(priceRaw);
  if (!name) return warn('خطأ', 'أدخل اسم الصنف');
  if (price <= 0) return warn('خطأ', 'أدخل سعراً صحيحاً');

  const total = calcLineTotal(price, qty);
  const paidEntered = parseEnteredSyp($('dsPaid').value, total);
  const paidRecorded = roundMoney(Math.min(paidEntered, total));
  const remaining = roundMoney(total - paidRecorded);

  const newSale = {
    id: 'QS-' + Date.now(), ts: Date.now(), date: nowStr(),
    name, price, qty, total,
    paid: paidRecorded, remaining, profit: paidRecorded,
    exchangeRate: getRate()
  };
  state.directSales.push(newSale);
  logAudit('بيع سريع', `${qty} × ${name} بقيمة ${fmtCur(total)}`);
  const ok = await saveToStorage();
  if (!ok) { state.directSales.pop(); return; }
  closeModal('directSaleModal');
  playSound('success');
  renderAll();
  toast(`تم تسجيل ${qty} × ${name}`);
}

/* ---------- المنتجات ---------- */
function generateUniqueSku() {
  const existing = new Set(state.products.map(p => String(p.sku || '').trim()));
  let num = Math.max(200, 101 + state.products.length);
  while (existing.has(String(num))) num++;
  return String(num);
}
function setAutoGeneratedSku() { $('prodSkuInput').value = generateUniqueSku(); }

function updateProductCurrencyUI(cur) {
  $('prodInputCurrency').value = cur;
  $('prodCurrencyLabel').textContent = cur === 'USD' ? 'USD ($)' : 'ل.س.ج';
  const unitText = cur === 'USD' ? '(USD $)' : '(ل.س.ج)';
  document.querySelectorAll('.prod-cur-unit').forEach(el => { el.textContent = unitText; });
}

function toggleProductInputCurrency() {
  const current = $('prodInputCurrency').value || 'SYP';
  const next = current === 'SYP' ? 'USD' : 'SYP';
  const costVal = toNum($('prodCostInput').value);
  const retailVal = toNum($('prodRetailInput').value);
  const wholesaleVal = toNum($('prodWholesaleInput').value);
  const convertField = (val) => { if (!val) return ''; return next === 'USD' ? sypToUsd(val) : usdToSyp(val); };
  if ($('prodCostInput').value.trim() !== '') $('prodCostInput').value = convertField(costVal);
  if ($('prodRetailInput').value.trim() !== '') $('prodRetailInput').value = convertField(retailVal);
  if ($('prodWholesaleInput').value.trim() !== '') $('prodWholesaleInput').value = convertField(wholesaleVal);
  updateProductCurrencyUI(next);
}

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
    const th = p.lowStockThreshold != null ? toNum(p.lowStockThreshold) : 10;
    return `
    <tr class="hover:bg-slate-50 border-b border-slate-100">
      <td class="p-3 text-ashour font-bold">${esc(p.sku || '-')} <br><span class="text-[11px] text-slate-500 font-normal">${esc(p.barcode || '')}</span></td>
      <td class="p-3 font-bold text-indigo-700">${esc(p.name)}</td>
      <td class="p-3"><span class="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-[11px]">${esc(p.category || '-')}</span></td>
      <td class="p-3 font-bold ${s <= 0 ? 'text-rose-600' : (s <= th ? 'text-amber-700' : 'text-slate-800')}">${fmt(s)}</td>
      <td class="p-3 text-amber-700 font-bold">${fmt(th)}</td>
      <td class="p-3 text-slate-600">${fmtCur(p.cost)}</td>
      <td class="p-3 text-emerald-800">${fmtCur(p.retailPrice)}</td>
      <td class="p-3 text-amber-800">${fmtCur(p.wholesalePrice)}</td>
      <td class="p-3 text-center"><div class="flex justify-center gap-1">
        <button onclick="openProductModal('${esc(p.id)}')" class="bg-indigo-100 text-indigo-700 hover:bg-indigo-600 hover:text-white px-2.5 py-1 rounded transition text-xs font-bold"><i class="fa-solid fa-pen"></i></button>
        <button onclick="deleteProduct('${esc(p.id)}')" class="bg-rose-100 text-rose-700 hover:bg-rose-600 hover:text-white px-2.5 py-1 rounded transition text-xs font-bold"><i class="fa-solid fa-trash"></i></button>
      </div></td>
    </tr>`;
  }).join('') || `<tr><td colspan="9" class="p-6 text-center text-slate-400 text-sm">لا توجد منتجات</td></tr>`;
}

function openProductModal(prodId = null) {
  $('prodEditId').value = prodId || '';
  updateProductCurrencyUI('SYP');
  if (prodId) {
    const p = state.products.find(x => x.id === prodId);
    if (!p) return;
    $('productModalTitle').textContent = 'تعديل منتج';
    $('prodSkuInput').value = p.sku || '';
    $('prodBarcodeInput').value = p.barcode || '';
    $('prodNameInput').value = p.name || '';
    $('prodCatInput').value = p.category || '';
    $('prodStockInput').value = toNum(p.stock);
    $('prodThresholdInput').value = p.lowStockThreshold != null ? p.lowStockThreshold : 10;
    $('prodCostInput').value = toNum(p.cost) || '';
    $('prodRetailInput').value = toNum(p.retailPrice) || '';
    $('prodWholesaleInput').value = toNum(p.wholesalePrice) || '';
  } else {
    $('productModalTitle').textContent = 'إضافة منتج جديد';
    $('prodSkuInput').value = generateUniqueSku();
    $('prodBarcodeInput').value = '';
    $('prodNameInput').value = '';
    $('prodCatInput').value = '';
    $('prodStockInput').value = '0';
    $('prodThresholdInput').value = '10';
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
  const lowStockThreshold = Math.max(0, Math.round(toNum($('prodThresholdInput').value)));
  const inputCur = $('prodInputCurrency').value || 'SYP';

  const toSyp = (v) => {
    const num = Math.max(0, toNum(v));
    return inputCur === 'USD' ? usdToSyp(num) : roundMoney(num);
  };

  const cost = toSyp($('prodCostInput').value);
  const retailPrice = toSyp($('prodRetailInput').value);
  const wholesalePrice = toSyp($('prodWholesaleInput').value);

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
    Object.assign(p, { sku, barcode, name, category, stock, cost, retailPrice, wholesalePrice, lowStockThreshold });
    logAudit('تعديل منتج', name);
  } else {
    state.products.push({ id: Date.now().toString(), sku, barcode, name, category, stock, cost, retailPrice, wholesalePrice, lowStockThreshold });
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
  playSound('success');
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
  const priceRaw = toNum($('qpPrice').value);
  const price = state.displayCurrency === 'USD' ? usdToSyp(priceRaw) : roundMoney(priceRaw);
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
  playSound('add');
  renderCart(true);
  toast(`تمت إضافة ${qty} × ${name}`);
}

/* ---------- استيراد CSV ---------- */
function triggerImportCSV() { const inp = $('importCSVFile'); if (!inp) return; inp.value = ''; inp.click(); }

async function importProductsCSV(ev) {
  const file = ev.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const text = e.target.result;
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) return warn('ملف فارغ', 'الملف لا يحتوي على بيانات', 'error');

      // الأعمدة المتوقعة: name,sku,barcode,category,stock,cost,retailPrice,wholesalePrice,lowStockThreshold
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      let added = 0, skipped = 0;
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
        if (cols.length < 3) { skipped++; continue; }
        const name = cols[headers.indexOf('name') >= 0 ? headers.indexOf('name') : 0];
        if (!name) { skipped++; continue; }
        const skuIdx = headers.indexOf('sku');
        const bcIdx = headers.indexOf('barcode');
        const catIdx = headers.indexOf('category');
        const stockIdx = headers.indexOf('stock');
        const costIdx = headers.indexOf('cost');
        const retIdx = headers.indexOf('retailprice');
        const whlIdx = headers.indexOf('wholesaleprice');
        const thIdx = headers.indexOf('lowstockthreshold');

        const sku = skuIdx >= 0 && cols[skuIdx] ? cols[skuIdx] : generateUniqueSku();
        if (state.products.some(p => p.sku === sku)) { skipped++; continue; }

        state.products.push({
          id: 'csv_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
          sku, barcode: bcIdx >= 0 ? (cols[bcIdx] || '') : '',
          name, category: catIdx >= 0 ? (cols[catIdx] || 'مواد غذائية') : 'مواد غذائية',
          stock: stockIdx >= 0 ? roundMoney(toNum(cols[stockIdx])) : 0,
          cost: costIdx >= 0 ? roundMoney(toNum(cols[costIdx])) : 0,
          retailPrice: retIdx >= 0 ? roundMoney(toNum(cols[retIdx])) : 0,
          wholesalePrice: whlIdx >= 0 ? roundMoney(toNum(cols[whlIdx])) : 0,
          lowStockThreshold: thIdx >= 0 ? Math.max(0, Math.round(toNum(cols[thIdx]))) : 10
        });
        added++;
      }
      await saveToStorage();
      refreshCategoryWidgets();
      renderAll();
      playSound('success');
      Swal.fire({ icon: 'success', title: 'تم الاستيراد', html: `تمت إضافة <b>${added}</b> منتج<br>تم تجاهل <b>${skipped}</b> سطر`, confirmButtonColor: '#0F5C4E' });
    } catch (err) {
      warn('خطأ في القراءة', err.message, 'error');
    }
  };
  reader.readAsText(file);
}

/* ---------- بيانات تجريبية ---------- */
async function loadDemoData() {
  const res = await Swal.fire({
    title: 'تحميل بيانات تجريبية؟',
    text: 'سيتم إضافة 8 منتجات جاهزة للتجربة. تأكد من عدم وجود بيانات حقيقية.',
    icon: 'question', showCancelButton: true, confirmButtonColor: '#7c3aed', cancelButtonColor: '#64748b',
    confirmButtonText: 'نعم، حمّل', cancelButtonText: 'إلغاء'
  });
  if (!res.isConfirmed) return;
  const demos = [
    { name: 'بسكويت شاي 100غ', category: 'بسكويت', cost: 500, retailPrice: 750, wholesalePrice: 650, stock: 50, lowStockThreshold: 10 },
    { name: 'شيبس كبير', category: 'شيبس', cost: 800, retailPrice: 1200, wholesalePrice: 1000, stock: 30, lowStockThreshold: 5 },
    { name: 'عصير برتقال 1L', category: 'عصائر ومشروبات', cost: 1500, retailPrice: 2000, wholesalePrice: 1800, stock: 20, lowStockThreshold: 8 },
    { name: 'علكة نعناع', category: 'سكاكر وعلكة', cost: 300, retailPrice: 500, wholesalePrice: 400, stock: 100, lowStockThreshold: 20 },
    { name: 'قهوة عربية 250غ', category: 'قهوة', cost: 3000, retailPrice: 4500, wholesalePrice: 4000, stock: 15, lowStockThreshold: 5 },
    { name: 'أرز مصري 1كغ', category: 'مواد غذائية', cost: 2000, retailPrice: 2800, wholesalePrice: 2500, stock: 40, lowStockThreshold: 10 },
    { name: 'سكر أبيض 1كغ', category: 'مواد غذائية', cost: 1800, retailPrice: 2500, wholesalePrice: 2200, stock: 35, lowStockThreshold: 10 },
    { name: 'ماء معدني 1.5L', category: 'عصائر ومشروبات', cost: 400, retailPrice: 600, wholesalePrice: 500, stock: 60, lowStockThreshold: 15 }
  ];
  demos.forEach((d, i) => state.products.push({ ...d, id: 'demo_' + Date.now() + '_' + i, sku: generateUniqueSku(), barcode: '' }));
  await saveToStorage();
  refreshCategoryWidgets();
  renderAll();
  playSound('success');
  toast('تم تحميل البيانات التجريبية');
}

/* ---------- الزبائن ---------- */
function openClientModal(clientId = null) {
  $('clientEditId').value = clientId || '';
  if (clientId) {
    const c = state.clients.find(x => x.id === clientId);
    if (!c) return;
    $('clientModalTitle').textContent = 'تعديل بيانات الزبون';
    $('clientNameInput').value = c.name || '';
    $('clientPhoneInput').value = c.phone || '';
    $('clientAddressInput').value = c.address || '';
    $('clientOpeningInput').value = toNum(c.openingDebt) || 0;
    $('clientCreditLimitInput').value = toNum(c.creditLimit) || 0;
    const radios = document.querySelectorAll('input[name="clientTypeRadio"]');
    radios.forEach(r => { r.checked = r.value === (c.type || 'retail'); });
  } else {
    $('clientModalTitle').textContent = 'إضافة زبون جديد';
    $('clientNameInput').value = '';
    $('clientPhoneInput').value = '';
    $('clientAddressInput').value = '';
    $('clientOpeningInput').value = '0';
    $('clientCreditLimitInput').value = '0';
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
  const openingDebt = roundMoney(toNum($('clientOpeningInput').value));
  const creditLimit = roundMoney(toNum($('clientCreditLimitInput').value));
  const checkedRadio = document.querySelector('input[name="clientTypeRadio"]:checked');
  const type = checkedRadio ? checkedRadio.value : 'retail';
  if (!name) return warn('خطأ', 'أدخل اسم الزبون');

  let previous = null;
  if (editId) {
    const c = state.clients.find(x => x.id === editId);
    if (!c) return;
    previous = { ...c, customPrices: { ...(c.customPrices || {}) } };
    Object.assign(c, { name, type, phone, address, openingDebt, creditLimit });
    logAudit('تعديل زبون', `${name} (حد ائتماني: ${fmtCur(creditLimit)})`);
  } else {
    state.clients.push({ id: 'c_' + Date.now(), name, type, phone, address, openingDebt, creditLimit, customPrices: {} });
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
  playSound('success');
  toast('تم حفظ بيانات الزبون');
}

function renderClientsGrid() {
  const q = normalizeArabic(($('clientSearch')?.value || '').trim());
  const list = state.clients.filter(c => !q || normalizeArabic(c.name).includes(q) || (c.phone || '').includes(q));
  $('clientsGrid').innerHTML = list.map(c => {
    const rawBal = getClientRawBalance(c.id);
    const invCount = state.invoices.filter(i => i.clientId === c.id && i.status === 'active').length;
    const customCount = c.customPrices ? Object.values(c.customPrices).filter(v => toNum(v) > 0).length : 0;
    const limitWarn = toNum(c.creditLimit) > 0 && rawBal > toNum(c.creditLimit);
    const balHtml = rawBal < 0
      ? `<span class="text-sm font-bold text-indigo-700">دائن له: ${fmtCur(-rawBal)}</span>`
      : `<span class="text-sm font-bold ${limitWarn ? 'text-rose-700 animate-pulse' : (rawBal > 0 ? 'text-rose-600' : 'text-emerald-700')}">${fmtCur(rawBal)}</span>`;
    return `<div onclick="openClientDetailPage('${esc(c.id)}')" class="bg-white border ${limitWarn ? 'border-rose-300' : 'border-slate-200'} hover:border-ashour rounded-2xl p-4 shadow-sm space-y-3 flex flex-col justify-between card-hover cursor-pointer">
      <div>
        <div class="flex items-center justify-between gap-1">
          <div class="flex items-center gap-1 flex-wrap">
            <span class="text-[11px] font-bold px-2 py-0.5 rounded ${c.type === 'wholesale' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}">${c.type === 'wholesale' ? 'موزع جملة' : 'عميل تجزئة'}</span>
            ${customCount > 0 ? `<span class="text-[10px] font-bold px-2 py-0.5 rounded bg-purple-100 text-purple-800">${customCount} خاص</span>` : ''}
            ${limitWarn ? `<span class="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-100 text-rose-800">تجاوز الحد</span>` : ''}
          </div>
          <span class="text-xs text-slate-400 font-bold"><i class="fa-solid fa-phone text-[10px]"></i> ${esc(c.phone || '-')}</span>
        </div>
        <h4 class="font-bold text-base text-slate-800 mt-2">${esc(c.name)}</h4>
        <p class="text-xs text-slate-500 font-semibold">${esc(c.address || '-')} • ${fmt(invCount)} فاتورة</p>
      </div>
      <div class="border-t border-slate-100 pt-3 flex items-center justify-between gap-2">
        <div><span class="text-[11px] text-slate-500 font-bold block">الرصيد</span>${balHtml}</div>
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
    container.innerHTML = `<span class="text-slate-400">لا توجد أسعار خاصة.</span>`;
    return;
  }
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
  const rawBal = getClientRawBalance(clientId);

  const balCard = rawBal < 0
    ? `<span class="text-sm font-bold text-indigo-700">دائن له: ${fmtCur(-rawBal)}</span>`
    : `<span class="text-sm font-bold ${rawBal > 0 ? 'text-rose-600' : 'text-emerald-700'}">${fmtCur(rawBal)}</span>`;

  $('ledgerSummaryCards').innerHTML = `
    <div class="bg-white border border-slate-200 rounded-xl p-3 shadow-sm"><span class="block text-xs text-slate-500">المشتريات</span><span class="text-sm font-bold text-slate-800">${fmtCur(totalPurchases)}</span></div>
    <div class="bg-white border border-slate-200 rounded-xl p-3 shadow-sm"><span class="block text-xs text-emerald-700">المدفوع</span><span class="text-sm font-bold text-emerald-700">${fmtCur(totalPaid)}</span></div>
    <div class="bg-white border border-slate-200 rounded-xl p-3 shadow-sm"><span class="block text-xs text-amber-700">المرتجعات</span><span class="text-sm font-bold text-amber-700">${fmtCur(totalReturns)}</span></div>
    <div class="bg-white border border-rose-200 rounded-xl p-3 shadow-sm"><span class="block text-xs text-rose-600">الرصيد الحالي</span>${balCard}</div>`;

  const rows = [];
  if (toNum(c.openingDebt) > 0) rows.push({ id: 'op', type: 'opening', ts: 0, label: 'رصيد افتتاحي', debit: toNum(c.openingDebt), credit: 0 });
  activeInvs.forEach(i => rows.push({ id: i.id, type: 'invoice', ts: i.ts, label: `فاتورة ${i.id} — [${i.items.map(it => `${it.qty} × ${it.name} (${fmt(it.price)})`).join(' ، ')}]`, debit: i.total, credit: i.paid }));
  state.payments.filter(p => p.clientId === clientId).forEach(p => rows.push({ id: p.id, type: 'payment', ts: p.ts, label: 'تسديد دفعة', debit: 0, credit: p.amount }));
  state.returns.filter(r => r.clientId === clientId).forEach(r => rows.push({ id: r.id, type: 'return', ts: r.ts, label: `مرتجع: ${r.qty} × ${r.productName} بسعر ${fmtCur(r.unitPrice)}`, debit: 0, credit: r.amount }));

  rows.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  $('ledgerTableBody').innerHTML = rows.map(r => `
    <tr class="border-b border-slate-100 hover:bg-slate-50">
      <td class="p-3 text-slate-500 whitespace-nowrap">${r.ts ? new Date(r.ts).toLocaleString('ar-SY') : '—'}</td>
      <td class="p-3 text-slate-800">${esc(r.label)}</td>
      <td class="p-3 text-rose-600 whitespace-nowrap">${r.debit ? fmtCur(r.debit) : '—'}</td>
      <td class="p-3 text-emerald-700 whitespace-nowrap">${r.credit ? fmtCur(r.credit) : '—'}</td>
      <td class="p-3 text-center whitespace-nowrap">
        ${r.type === 'invoice' ? `<button onclick="viewPastInvoice('${esc(r.id)}')" class="bg-ashour text-white hover:bg-ashour-dark px-2 py-1 rounded text-xs font-bold transition"><i class="fa-solid fa-receipt"></i></button>` : ''}
        ${r.type === 'payment' ? `<button onclick="deletePayment('${esc(r.id)}')" class="text-rose-500 hover:text-rose-700 font-bold text-xs"><i class="fa-solid fa-trash"></i></button>` : ''}
        ${r.type !== 'invoice' && r.type !== 'payment' ? '—' : ''}
      </td>
    </tr>`).join('') || `<tr><td colspan="5" class="p-4 text-center text-slate-400">لا توجد معاملات</td></tr>`;
}

function shareClientStatementWhatsApp() {
  const clientId = state.currentLedgerClientId;
  const c = state.clients.find(x => x.id === clientId);
  if (!c) return;
  const rawBal = getClientRawBalance(clientId);
  const balTxt = rawBal < 0 ? `دائن له: ${fmtCur(-rawBal)}` : `الدين الحالي: ${fmtCur(rawBal)}`;
  const txt = `كشف حساب — ${state.storeInfo.name}\nالزبون: ${c.name}\n${balTxt}`;
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
        item.returnedQty = roundMoney(item.returnedQty + toNum(ret.qty));
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
    container.innerHTML = list.map((item, idx) => `
      <div class="bg-white border border-slate-200 rounded-xl p-3 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3" data-ret-idx="${idx}">
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
            <button type="button" onclick="adjustReturnQty(${idx}, -1)" ${item.remainingQty <= 0 ? 'disabled' : ''} class="w-7 h-7 flex items-center justify-center bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 rounded font-bold transition">−</button>
            <input type="number" id="returnQty_${idx}" min="1" max="${item.remainingQty}" value="${item.remainingQty > 0 ? 1 : 0}" ${item.remainingQty <= 0 ? 'disabled' : ''} class="w-10 text-center border-none focus:outline-none focus:ring-0 text-sm font-bold bg-transparent num-tabular">
            <button type="button" onclick="adjustReturnQty(${idx}, 1)" ${item.remainingQty <= 0 ? 'disabled' : ''} class="w-7 h-7 flex items-center justify-center bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 rounded font-bold transition">+</button>
          </div>
          <button type="button" onclick="submitClientReturnByIdx('${esc(clientId)}', ${idx})" ${item.remainingQty <= 0 ? 'disabled' : ''} class="bg-ashour hover:bg-ashour-dark disabled:opacity-40 text-white px-3 py-1.5 rounded-md text-xs font-bold transition">تأكيد الإرجاع</button>
        </div>
      </div>`).join('');
  }

  const rets = state.returns.filter(r => r.clientId === clientId).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  $('clientReturnsHistoryList').innerHTML = rets.length
    ? rets.map(r => `<div class="flex justify-between items-center border-b border-slate-200 py-1"><span>${esc(r.date)} — ${fmt(r.qty)} × ${esc(r.productName)} (${fmtCur(r.unitPrice)})</span><span class="text-emerald-700 font-bold">خصم ${fmtCur(r.amount)}</span></div>`).join('')
    : `<div class="text-slate-400 text-sm">لا توجد مرتجعات.</div>`;
}

function adjustReturnQty(idx, delta) {
  const input = $('returnQty_' + idx);
  if (!input || input.disabled) return;
  let val = parseInt(input.value, 10) || 1;
  val += delta;
  const max = parseInt(input.max, 10) || 1;
  if (val > max) val = max;
  if (val < 1) val = 1;
  input.value = val;
}

async function submitClientReturnByIdx(clientId, idx) {
  const list = getClientReturnableSummary(clientId);
  const item = list[idx];
  if (!item) return;
  const input = $('returnQty_' + idx);
  const qty = parseInt(input.value, 10);
  if (!qty || qty <= 0) return warn('خطأ', 'أدخل كمية صحيحة');
  const max = parseInt(input.max, 10);
  if (qty > max) return warn('خطأ', 'الكمية تتجاوز المتاح للإرجاع');

  const client = state.clients.find(c => c.id === clientId);
  const amount = calcLineTotal(item.price, qty);
  const profitAdjustment = roundMoney((toNum(item.price) - toNum(item.cost)) * qty);
  const newReturn = {
    id: 'RET-' + Date.now(), ts: Date.now(), date: nowStr(),
    clientId, clientName: client.name,
    productName: item.name, qty, unitPrice: item.price,
    unitCost: toNum(item.cost), amount, profitAdjustment,
    returnKey: item.key
  };

  const matchedProd = state.products.find(p => p.id === item.productId || normalizeArabic(p.name) === normalizeArabic(item.name));
  const prevStock = matchedProd ? toNum(matchedProd.stock) : 0;
  if (matchedProd) matchedProd.stock = roundMoney(toNum(matchedProd.stock) + qty);

  state.returns.push(newReturn);
  logAudit('مرتجع', `إرجاع ${qty} × ${item.name} بسعر ${fmtCur(item.price)} لـ ${client.name}`);
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
  playSound('success');
  toast(`تم إرجاع ${qty} ${item.name} وخصم ${fmtCur(amount)}`);
}

async function recordDebtPayment() {
  const clientId = state.currentLedgerClientId;
  const c = state.clients.find(x => x.id === clientId);
  if (!c) return;
  const rawVal = toNum($('payDebtAmount').value);
  const amount = state.displayCurrency === 'USD' ? usdToSyp(rawVal) : roundMoney(rawVal);
  if (amount <= 0) return warn('تنبيه', 'أدخل مبلغاً صحيحاً');

  const newPay = { id: 'PAY-' + Date.now(), ts: Date.now(), date: nowStr(), clientId, amount, note: '' };
  state.payments.push(newPay);
  logAudit('تسديد دين زبون', `${c.name}: ${fmtCur(amount)}`);
  const ok = await saveToStorage();
  if (!ok) { state.payments.pop(); return; }
  $('payDebtAmount').value = '';
  renderLedgerSummary(clientId);
  switchLedgerSubTab('statement');
  playSound('success');
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

/* ---------- الشركات ---------- */
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
  $('cpBoxPriceInput').value = toNum(pr.boxPrice) || '';
  $('cpPiecesPerBoxInput').value = pr.piecesPerBox || 1;
  $('cpPiecePriceInput').value = toNum(pr.piecePrice) || '';
  $('cpConsumerPriceInput').value = toNum(pr.consumerPrice) || '';
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
  const boxPrice = roundMoney(toNum($('cpBoxPriceInput').value));
  pr.piecesPerBox = Math.max(1, toNum($('cpPiecesPerBoxInput').value) || 1);
  const enteredPiece = roundMoney(toNum($('cpPiecePriceInput').value));
  const consumerPrice = roundMoney(toNum($('cpConsumerPriceInput').value));
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
      const boxPrice = roundMoney(toNum($('swal-p-box-price').value));
      const piecesPerBox = Math.max(1, toNum($('swal-p-pieces').value) || 1);
      const piecePriceInput = roundMoney(toNum($('swal-p-piece-price').value));
      const consumerPrice = roundMoney(toNum($('swal-p-consumer').value));
      const wholesalePrice = roundMoney(toNum($('swal-p-wholesale').value));
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
      wholesalePrice: d.wholesalePrice || d.consumerPrice,
      lowStockThreshold: 10
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
  const amount = roundMoney(toNum($('payCompanyAmount').value));
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

/* ---------- المشتريات ---------- */
function generatePurchaseCode() {
  const used = new Set(state.purchases.map(p => String(p.id)));
  let code = '';
  do { code = String(Math.floor(100000 + Math.random() * 900000)); } while (used.has(code));
  return code;
}

function openPurchaseModal(preselectCompanyId = null) {
  if (!state.companies.length) {
    Swal.fire({
      title: 'لا توجد شركات بعد', text: 'هل تريد إضافة شركة أولاً؟',
      icon: 'info', showCancelButton: true, confirmButtonColor: '#0F5C4E', cancelButtonColor: '#64748b',
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
  if (!comp || !infoEl) return;
  const debt = getCompanyDebt(compId);
  infoEl.classList.remove('hidden');
  infoEl.textContent = `الموزع: ${comp.distributorName || '-'} • هاتف: ${comp.phone || '-'} • الدين الحالي: ${fmtCur(debt)}`;
}

async function quickAddCompanyForPurchase() {
  const { value: name } = await Swal.fire({
    title: 'إضافة شركة سريعة', input: 'text', inputPlaceholder: 'اسم الشركة',
    showCancelButton: true, confirmButtonColor: '#0F5C4E', confirmButtonText: 'إضافة', cancelButtonText: 'إلغاء'
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
  const total = Math.max(0, roundMoney(toNum($('purTotalAmount').value)));
  const paidRaw = $('purPaidAmount').value.trim();
  const paidEntered = paidRaw === '' ? total : Math.max(0, roundMoney(toNum(paidRaw)));
  const remaining = Math.max(0, roundMoney(total - paidEntered));
  const infoEl = $('purDebtAfterInfo');
  if (!infoEl) return;
  infoEl.textContent = `المتبقي (يُضاف إلى دين الشركة): ${fmtCur(remaining)}`;
  infoEl.className = remaining > 0 ? 'text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200 rounded-xl p-2.5' : 'text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl p-2.5';
}

async function savePurchase() {
  const compId = $('purCompanySelect').value;
  const comp = state.companies.find(c => c.id === compId);
  if (!comp) return warn('خطأ', 'اختر الشركة');
  const total = roundMoney(toNum($('purTotalAmount').value));
  if (!(total > 0)) return warn('خطأ', 'أدخل سعر الفاتورة');
  const paidRaw = $('purPaidAmount').value.trim();
  const paidEntered = paidRaw === '' ? total : Math.max(0, roundMoney(toNum(paidRaw)));
  const paidRecorded = roundMoney(Math.min(paidEntered, total));
  const remaining = Math.max(0, roundMoney(total - paidRecorded));
  const pur = {
    id: generatePurchaseCode(), ts: Date.now(), date: nowStr(),
    companyId: comp.id, companyName: comp.name,
    total, paid: paidRecorded, remaining, status: 'active'
  };
  state.purchases.push(pur);
  logAudit('فاتورة شراء', `فاتورة شراء #${pur.id} من ${comp.name} بقيمة ${fmtCur(total)}`);
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
  const list = state.purchases.filter(p => p.status === 'active')
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
    title: 'حذف فاتورة الشراء؟', text: 'سيتم إلغاء الفاتورة وتحديث دين الشركة.',
    icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6',
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

/* ---------- ديون الأشخاص ---------- */
function switchDebtTab(type) {
  currentDebtTab = type === 'give' ? 'give' : 'take';
  const isTake = currentDebtTab === 'take';
  $('debtTabTake').className = isTake ? 'px-5 py-2 rounded-xl text-sm font-bold transition bg-emerald-600 text-white' : 'px-5 py-2 rounded-xl text-sm font-bold transition bg-slate-100 text-slate-700 hover:bg-slate-200';
  $('debtTabGive').className = !isTake ? 'px-5 py-2 rounded-xl text-sm font-bold transition bg-rose-600 text-white' : 'px-5 py-2 rounded-xl text-sm font-bold transition bg-slate-100 text-slate-700 hover:bg-slate-200';
  $('debtSummaryTake').classList.toggle('hidden', !isTake);
  $('debtSummaryGive').classList.toggle('hidden', isTake);
  $('debtAddBtnLabel').textContent = isTake ? 'لي' : 'له';
  $('debtTableHead').className = isTake ? 'bg-emerald-700 text-white font-bold' : 'bg-rose-700 text-white font-bold';
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
  const amount = roundMoney(toNum($('debtPersonAmount').value));
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
  Swal.fire({ title: 'حذف السجل؟', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6', confirmButtonText: 'نعم، حذف', cancelButtonText: 'إلغاء' }).then(async res => {
    if (!res.isConfirmed) return;
    const removed = state.personDebts.find(d => d.id === id);
    state.personDebts = state.personDebts.filter(d => d.id !== id);
    logAudit('حذف دين شخصي', removed ? removed.name : id);
    const ok = await saveToStorage();
    if (!ok) { if (removed) state.personDebts.push(removed); return; }
    renderPersonDebts();
    toast('تم الحذف');
  });
}

/* ---------- المبيعات والفواتير ---------- */
function renderInvoicesTable() {
  const search = normalizeArabic(($('invoiceSearchInput')?.value || '').trim());
  const statusFilter = $('invoiceStatusFilter')?.value || 'all';
  const fromVal = $('invoiceFromDate')?.value;
  const toVal = $('invoiceToDate')?.value;
  const fromTs = fromVal ? new Date(fromVal + 'T00:00:00').getTime() : -Infinity;
  const toTs = toVal ? new Date(toVal + 'T23:59:59').getTime() : Infinity;

  const combined = [
    ...state.invoices.map(i => ({ ...i, _kind: 'invoice' })),
    ...state.directSales.map(s => ({
      id: s.id, ts: s.ts, date: s.date,
      clientId: null, clientName: 'بيع سريع — ' + s.name,
      paymentType: toNum(s.remaining) > 0 ? 'partial' : 'cash',
      total: toNum(s.total), paid: toNum(s.paid),
      remaining: toNum(s.remaining), profit: toNum(s.profit),
      status: 'active', _kind: 'direct'
    }))
  ].filter(item => {
    if (item.ts < fromTs || item.ts > toTs) return false;
    if (statusFilter === 'cancelled' && item.status !== 'cancelled') return false;
    if (statusFilter !== 'all' && statusFilter !== 'cancelled') {
      if (item.status === 'cancelled') return false;
      if (item.paymentType !== statusFilter) return false;
    }
    if (search && !(normalizeArabic(item.id).includes(search) || normalizeArabic(item.clientName).includes(search))) return false;
    return true;
  }).sort((a, b) => (b.ts || 0) - (a.ts || 0));

  const activeItems = combined.filter(x => x.status !== 'cancelled');
  const sumSales = sumList(activeItems, x => x.total);
  const sumPaid = sumList(activeItems, x => x.paid);
  const sumRem = sumList(activeItems, x => x.remaining);
  const sumProfit = sumList(activeItems, x => x.profit);

  if ($('invoicesSummaryStrip')) {
    $('invoicesSummaryStrip').innerHTML = `
      <div class="bg-slate-50 border rounded-xl p-2"><span class="block text-xs text-slate-500">المبيعات</span><span class="font-bold text-slate-800">${fmtCur(sumSales)}</span></div>
      <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-2"><span class="block text-xs text-emerald-700">المدفوع</span><span class="font-bold text-emerald-800">${fmtCur(sumPaid)}</span></div>
      <div class="bg-rose-50 border border-rose-200 rounded-xl p-2"><span class="block text-xs text-rose-700">المتبقي</span><span class="font-bold text-rose-700">${fmtCur(sumRem)}</span></div>
      <div class="bg-amber-50 border border-amber-200 rounded-xl p-2"><span class="block text-xs text-amber-700">الربح</span><span class="font-bold text-amber-800">${fmtCur(sumProfit)}</span></div>`;
  }

  $('invoicesTableBody').innerHTML = combined.map(item => {
    const isCancelled = item.status === 'cancelled';
    const badge = isCancelled ? `<span class="bg-rose-100 text-rose-700 px-2 py-0.5 rounded text-[11px] font-bold">ملغاة</span>` :
                  (item.paymentType === 'debt' ? `<span class="bg-rose-100 text-rose-700 px-2 py-0.5 rounded text-[11px] font-bold">آجل</span>` :
                   item.paymentType === 'partial' ? `<span class="bg-amber-100 text-amber-800 px-2 py-0.5 rounded text-[11px] font-bold">جزئي</span>` :
                   `<span class="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded text-[11px] font-bold">مدفوع</span>`);
    return `
    <tr class="hover:bg-slate-50 border-b border-slate-100 ${isCancelled ? 'opacity-60 line-through' : ''}">
      <td class="p-3 font-bold text-ashour">${esc(item.id)}</td>
      <td class="p-3 text-slate-500 text-xs">${esc(item.date || new Date(item.ts).toLocaleString('ar-SY'))}</td>
      <td class="p-3 font-bold text-slate-800">${esc(item.clientName || '-')}</td>
      <td class="p-3 font-bold text-slate-800">${fmtCur(item.total)}</td>
      <td class="p-3 text-emerald-700">${fmtCur(item.paid)}</td>
      <td class="p-3 text-rose-600">${fmtCur(item.remaining)}</td>
      <td class="p-3 text-amber-800">${fmtCur(item.profit)}</td>
      <td class="p-3">${badge}</td>
      <td class="p-3 text-center"><div class="flex justify-center gap-1">
        ${item._kind === 'invoice' ? `<button onclick="viewPastInvoice('${esc(item.id)}')" class="bg-slate-200 text-slate-800 hover:bg-ashour hover:text-white px-2 py-1 rounded text-xs font-bold transition"><i class="fa-solid fa-eye"></i></button>` : ''}
        ${!isCancelled && item._kind === 'invoice' ? `<button onclick="cancelInvoice('${esc(item.id)}')" class="bg-rose-100 text-rose-700 hover:bg-rose-600 hover:text-white px-2 py-1 rounded text-xs font-bold transition"><i class="fa-solid fa-ban"></i></button>` : ''}
        ${!isCancelled && item._kind === 'direct' ? `<button onclick="deleteDirectSale('${esc(item.id)}')" class="bg-rose-100 text-rose-700 hover:bg-rose-600 hover:text-white px-2 py-1 rounded text-xs font-bold transition"><i class="fa-solid fa-trash"></i></button>` : ''}
      </div></td>
    </tr>`;
  }).join('') || `<tr><td colspan="9" class="p-6 text-center text-slate-400 text-sm">لا توجد عمليات</td></tr>`;
}

function deleteDirectSale(id) {
  Swal.fire({ title: 'حذف عملية البيع السريع؟', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6', confirmButtonText: 'نعم', cancelButtonText: 'إلغاء' }).then(async res => {
    if (!res.isConfirmed) return;
    const removed = state.directSales.find(s => s.id === id);
    state.directSales = state.directSales.filter(s => s.id !== id);
    logAudit('حذف بيع سريع', removed ? `${removed.name} (${fmtCur(removed.total)})` : id);
    const ok = await saveToStorage();
    if (!ok) { if (removed) state.directSales.push(removed); return; }
    renderAll();
    toast('تم الحذف');
  });
}

function viewPastInvoice(invId) {
  const inv = state.invoices.find(i => i.id === invId);
  if (inv) showReceiptModal(inv);
}

function cancelInvoice(invId) {
  Swal.fire({ title: 'إلغاء الفاتورة؟', text: 'سيتم إرجاع الكميات للمخزون وإلغاء تأثير الفاتورة على الرصيد.', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6', confirmButtonText: 'نعم', cancelButtonText: 'إلغاء' }).then(async res => {
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
    logAudit('إلغاء فاتورة', `فاتورة ${inv.id}`);
    const ok = await saveToStorage();
    if (!ok) {
      inv.status = prevStatus;
      state.products.forEach(p => { if (prevStockMap.has(p.id)) p.stock = prevStockMap.get(p.id); });
      return;
    }
    renderAll();
    toast('تم إلغاء الفاتورة وإرجاع المخزون');
  });
}

/* ---------- المصاريف ---------- */
function openExpenseModal() {
  $('expTitle').value = '';
  $('expCategory').value = 'عام';
  $('expAmount').value = '';
  $('expNotes').value = '';
  openModal('expenseModal');
}

async function saveExpense() {
  const title = $('expTitle').value.trim();
  const category = $('expCategory').value || 'عام';
  const rawAmt = toNum($('expAmount').value);
  const amount = state.displayCurrency === 'USD' ? usdToSyp(rawAmt) : roundMoney(rawAmt);
  const notes = $('expNotes').value.trim();
  if (!title) return warn('خطأ', 'أدخل البند');
  if (!(amount > 0)) return warn('خطأ', 'أدخل مبلغاً صحيحاً');
  const newExp = { id: 'EXP-' + Date.now(), ts: Date.now(), date: nowStr(), title, category, amount, notes };
  state.expenses.push(newExp);
  logAudit('مصروف', `${title} (${category}): ${fmtCur(amount)}`);
  const ok = await saveToStorage();
  if (!ok) { state.expenses.pop(); return; }
  closeModal('expenseModal');
  renderExpenses();
  toast('تم حفظ المصروف');
}

function deleteExpense(id) {
  Swal.fire({ title: 'حذف المصروف؟', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6', confirmButtonText: 'نعم', cancelButtonText: 'إلغاء' }).then(async res => {
    if (!res.isConfirmed) return;
    const removed = state.expenses.find(e => e.id === id);
    state.expenses = state.expenses.filter(e => e.id !== id);
    logAudit('حذف مصروف', removed ? removed.title : id);
    const ok = await saveToStorage();
    if (!ok) { if (removed) state.expenses.push(removed); return; }
    renderExpenses();
    toast('تم الحذف');
  });
}

function renderExpenses() {
  $('expensesTableBody').innerHTML = [...state.expenses].sort((a, b) => (b.ts || 0) - (a.ts || 0)).map(e => `
    <tr class="hover:bg-slate-50 border-b border-slate-100">
      <td class="p-3 text-slate-500 text-xs">${esc(e.date || new Date(e.ts).toLocaleString('ar-SY'))}</td>
      <td class="p-3 font-bold text-slate-800">${esc(e.title)}</td>
      <td class="p-3"><span class="bg-purple-100 text-purple-800 px-2 py-0.5 rounded text-[11px] font-bold">${esc(e.category || 'عام')}</span></td>
      <td class="p-3 text-rose-600 font-bold">${fmtCur(e.amount)}</td>
      <td class="p-3 text-slate-600 text-xs">${esc(e.notes || '-')}</td>
      <td class="p-3 text-center"><button onclick="deleteExpense('${esc(e.id)}')" class="bg-rose-100 text-rose-700 hover:bg-rose-600 hover:text-white px-2.5 py-1 rounded text-xs font-bold transition"><i class="fa-solid fa-trash"></i></button></td>
    </tr>`).join('') || `<tr><td colspan="6" class="p-6 text-center text-slate-400 text-sm">لا توجد مصاريف</td></tr>`;
}

/* ---------- التقارير ---------- */
function setReportRange(days) {
  const to = new Date(), from = new Date();
  from.setDate(to.getDate() - days);
  $('repTo').value = to.toISOString().split('T')[0];
  $('repFrom').value = from.toISOString().split('T')[0];
  renderReports();
}

function renderReports() {
  const from = $('repFrom')?.value ? new Date($('repFrom').value + 'T00:00:00').getTime() : -Infinity;
  const to = $('repTo')?.value ? new Date($('repTo').value + 'T23:59:59').getTime() : Infinity;
  const invs = state.invoices.filter(i => i.status === 'active' && i.ts >= from && i.ts <= to);
  const ds = state.directSales.filter(s => s.ts >= from && s.ts <= to);
  const exps = state.expenses.filter(e => e.ts >= from && e.ts <= to);
  const rets = state.returns.filter(r => r.ts >= from && r.ts <= to);

  const sales = sumList(invs, i => i.total) + sumList(ds, s => s.total);
  const expenses = sumList(exps, e => e.amount);
  const returnsCost = sumList(rets, r => r.profitAdjustment != null ? r.profitAdjustment : r.amount);
  const grossProfit = roundMoney(sumList(invs, i => i.profit) + sumList(ds, s => s.profit) - returnsCost);
  const netProfit = roundMoney(grossProfit - expenses);

  $('reportCards').innerHTML = `
    <div class="bg-white border rounded-xl p-3 shadow-sm"><span class="text-xs text-slate-500 block">إجمالي المبيعات</span><span class="text-sm font-bold text-ashour">${fmtCur(sales)}</span></div>
    <div class="bg-white border rounded-xl p-3 shadow-sm"><span class="text-xs text-slate-500 block">المصاريف</span><span class="text-sm font-bold text-rose-600">${fmtCur(expenses)}</span></div>
    <div class="bg-white border rounded-xl p-3 shadow-sm"><span class="text-xs text-slate-500 block">إجمالي الربح</span><span class="text-sm font-bold text-amber-800">${fmtCur(grossProfit)}</span></div>
    <div class="bg-white border rounded-xl p-3 shadow-sm"><span class="text-xs text-slate-500 block">صافي الربح</span><span class="text-sm font-bold ${netProfit >= 0 ? 'text-emerald-700' : 'text-rose-600'}">${fmtCur(netProfit)}</span></div>`;

  const prodMap = new Map();
  invs.forEach(i => i.items.forEach(it => prodMap.set(it.name, roundMoney((prodMap.get(it.name) || 0) + toNum(it.qty)))));
  const sorted = [...prodMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  $('topProductsBody').innerHTML = sorted.map(([n, q], idx) => `<tr><td class="p-2.5 text-slate-500 font-bold">#${idx + 1}</td><td class="p-2.5 font-bold">${esc(n)}</td><td class="p-2.5 text-ashour font-bold">${fmt(q)}</td></tr>`).join('') || `<tr><td colspan="3" class="p-4 text-center text-slate-400">لا توجد بيانات</td></tr>`;

  $('auditLogBody').innerHTML = state.auditLog.slice(0, 40).map(a => `<tr><td class="p-2 text-slate-400 whitespace-nowrap">${esc(a.date)}</td><td class="p-2 font-bold text-ashour">${esc(a.type)}</td><td class="p-2">${esc(a.details)}</td></tr>`).join('');
}

function exportReportCSV() {
  const from = $('repFrom')?.value ? new Date($('repFrom').value + 'T00:00:00').getTime() : -Infinity;
  const to = $('repTo')?.value ? new Date($('repTo').value + 'T23:59:59').getTime() : Infinity;
  const rows = [['الرقم', 'التاريخ', 'الزبون', 'الإجمالي (ل.س.ج)', 'المدفوع (ل.س.ج)', 'المتبقي (ل.س.ج)', 'الربح (ل.س.ج)', 'الحالة']];
  state.invoices.filter(i => i.ts >= from && i.ts <= to).forEach(i => {
    rows.push([i.id, i.date || '', i.clientName, i.total, i.paid, i.remaining, i.profit, i.status === 'cancelled' ? 'ملغاة' : 'نشطة']);
  });
  const csv = '\uFEFF' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `تقرير_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
}

/* ---------- الإعدادات ---------- */
function loadStoreInfoToSettings() {
  if ($('setStoreName')) $('setStoreName').value = state.storeInfo.name || '';
  if ($('setStorePhone')) $('setStorePhone').value = state.storeInfo.phone || '';
  if ($('setStoreAddress')) $('setStoreAddress').value = state.storeInfo.address || '';
  if ($('setExchangeRate')) $('setExchangeRate').value = getRate();
  if ($('setPrinterWidth')) $('setPrinterWidth').value = state.printerWidth || '80';
}

async function saveExchangeRateSetting() {
  const r = toNum($('setExchangeRate')?.value);
  if (!(r > 0)) return warn('تنبيه', 'أدخل سعر صرف صحيحاً أكبر من صفر');
  const prevRate = state.exchangeRate;
  state.exchangeRate = roundMoney(r);
  logAudit('تحديث سعر الصرف', `1$ = ${fmt(state.exchangeRate)} ل.س.ج`);
  const ok = await saveToStorage();
  if (!ok) { state.exchangeRate = prevRate; return; }
  renderAll();
  toast(`تم حفظ سعر الصرف: 1$ = ${fmt(state.exchangeRate)} ل.س.ج`);
}

function applyPrinterWidth(w) {
  const width = w == 58 ? '58mm' : '80mm';
  let styleTag = document.getElementById('printerWidthStyle');
  if (!styleTag) {
    styleTag = document.createElement('style');
    styleTag.id = 'printerWidthStyle';
    document.head.appendChild(styleTag);
  }
  styleTag.textContent = `@media print { #printableReceipt { max-width: ${width} !important; } #receiptModal .max-w-md { max-width: ${w == 58 ? '260px' : '380px'} !important; } }`;
}

async function savePrinterWidth() {
  const w = $('setPrinterWidth').value || '80';
  state.printerWidth = w;
  applyPrinterWidth(w);
  const ok = await saveToStorage();
  if (ok) toast(`تم حفظ عرض الورق: ${w}mm`);
}

async function saveStoreSettings() {
  const prev = { ...state.storeInfo };
  state.storeInfo = {
    name: $('setStoreName').value.trim() || 'مركز عاشور للتجارة',
    phone: $('setStorePhone').value.trim() || '',
    address: $('setStoreAddress').value.trim() || ''
  };
  logAudit('تعديل بيانات المتجر', state.storeInfo.name);
  const ok = await saveToStorage();
  if (!ok) { state.storeInfo = prev; return; }
  $('headerStoreName').textContent = state.storeInfo.name;
  toast('تم حفظ البيانات');
}

async function changePinCode() {
  const oldP = $('oldPinInput').value.trim(), newP = $('newPinInput').value.trim();
  if (!oldP || !newP) return warn('خطأ', 'أدخل الرمز القديم والجديد');
  if (newP.length < 4 || newP.length > 6 || !/^\d+$/.test(newP)) return warn('خطأ', 'رمز PIN يجب أن يكون من 4 إلى 6 أرقام');
  const oldH = await hashPin(oldP, state.pinSalt);
  if (oldH !== state.pinHash) return warn('خطأ', 'الرمز الحالي غير صحيح', 'error');
  const prevSalt = state.pinSalt, prevHash = state.pinHash, prevLen = state.pinLength, prevChanged = state.pinChangedByUser;
  const newSalt = generateSalt();
  state.pinSalt = newSalt;
  state.pinHash = await hashPin(newP, newSalt);
  state.pinLength = newP.length;
  state.pinChangedByUser = true;
  logAudit('تغيير رمز PIN', 'تم تغيير رمز PIN');
  const ok = await saveToStorage();
  if (!ok) { state.pinSalt = prevSalt; state.pinHash = prevHash; state.pinLength = prevLen; state.pinChangedByUser = prevChanged; return; }
  $('oldPinInput').value = ''; $('newPinInput').value = '';
  toast('تم تغيير رمز PIN بنجاح');
}

async function resetRecordsKeepProducts() {
  const res = await Swal.fire({
    title: 'تصفير السجلات والإبقاء على المنتجات؟',
    html: 'سيتم حذف <b>الفواتير والمبيعات السريعة والمرتجعات والمصاريف والمشتريات والطلبات والديون</b>، مع <b>الإبقاء على جميع المنتجات</b>.<br><small class="text-slate-500">سيتم أخذ نسخة احتياطية محلية تلقائياً قبل التنفيذ.</small>',
    icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6',
    confirmButtonText: 'نعم، صفّر السجلات وأبقِ المنتجات', cancelButtonText: 'إلغاء'
  });
  if (!res.isConfirmed) return;
  await AshourDB.saveBackup(state);
  state.invoices = [];
  state.expenses = [];
  state.payments = [];
  state.returns = [];
  state.directSales = [];
  state.noInvoiceItems = [];
  state.purchases = [];
  state.companyPayments = [];
  state.personDebts = [];
  state.orders = [];
  state.dailyCloses = [];
  state.cart = [];
  state.invoiceCounter = 1000;
  state.clients = [{ id: 'c1', name: 'زبون نقدي مباشر', type: 'retail', phone: '-', address: '-', openingDebt: 0, customPrices: {}, creditLimit: 0 }];
  state.companies.forEach(comp => { if (comp.products) comp.products = []; });
  logAudit('تصفير السجلات', 'تم مسح السجلات مع الإبقاء على المنتجات');
  await saveToStorage();
  refreshStorageStatus();
  renderAll();
  toast('تم تصفير السجلات مع الإبقاء على المنتجات');
}

/* ---------- إغلاق الصندوق اليومي ---------- */
function openDailyCloseModal() {
  const today = dayKey(Date.now());
  const todayInvs = state.invoices.filter(i => i.status === 'active' && dayKey(i.ts) === today);
  const todayDS = state.directSales.filter(s => dayKey(s.ts) === today);
  const todayExps = state.expenses.filter(e => dayKey(e.ts) === today);
  const todayReturns = state.returns.filter(r => dayKey(r.ts) === today);

  const cashSales = sumList(todayInvs, i => i.paid) + sumList(todayDS, s => s.paid);
  const creditSales = sumList(todayInvs, i => i.remaining) + sumList(todayDS, s => s.remaining);
  const totalSales = sumList(todayInvs, i => i.total) + sumList(todayDS, s => s.total);
  const totalExpenses = sumList(todayExps, e => e.amount);
  const totalReturns = sumList(todayReturns, r => r.amount);
  const expectedCash = roundMoney(cashSales - totalExpenses - totalReturns);

  $('dailyCloseDate').textContent = 'اليوم: ' + new Date().toLocaleDateString('ar-SY');
  $('dailyCloseSummary').innerHTML = `
    <div class="flex justify-between bg-slate-50 border rounded-lg p-2"><span>عدد الفواتير:</span><span class="font-bold">${fmt(todayInvs.length + todayDS.length)}</span></div>
    <div class="flex justify-between bg-slate-50 border rounded-lg p-2"><span>إجمالي المبيعات:</span><span class="font-bold text-ashour">${fmtCur(totalSales)}</span></div>
    <div class="flex justify-between bg-emerald-50 border border-emerald-200 rounded-lg p-2"><span>نقدي (مدفوع):</span><span class="font-bold text-emerald-700">${fmtCur(cashSales)}</span></div>
    <div class="flex justify-between bg-rose-50 border border-rose-200 rounded-lg p-2"><span>آجل (دين):</span><span class="font-bold text-rose-700">${fmtCur(creditSales)}</span></div>
    <div class="flex justify-between bg-purple-50 border border-purple-200 rounded-lg p-2"><span>مصاريف اليوم:</span><span class="font-bold text-purple-700">${fmtCur(totalExpenses)}</span></div>
    <div class="flex justify-between bg-amber-50 border border-amber-200 rounded-lg p-2"><span>مرتجعات:</span><span class="font-bold text-amber-700">${fmtCur(totalReturns)}</span></div>
    <div class="flex justify-between bg-emerald-100 border-2 border-emerald-400 rounded-lg p-2 text-base"><span>النقدية المتوقعة:</span><span class="font-bold text-emerald-800">${fmtCur(expectedCash)}</span></div>
  `;
  $('dailyCloseActualCash').value = '';
  $('dailyCloseNotes').value = '';
  openModal('dailyCloseModal');
}

async function saveDailyClose() {
  const today = dayKey(Date.now());
  const actualCash = roundMoney(toNum($('dailyCloseActualCash').value));
  const notes = $('dailyCloseNotes').value.trim();
  if (!$('dailyCloseActualCash').value) return warn('تنبيه', 'أدخل النقدية الفعلية');

  const todayInvs = state.invoices.filter(i => i.status === 'active' && dayKey(i.ts) === today);
  const todayDS = state.directSales.filter(s => dayKey(s.ts) === today);
  const todayExps = state.expenses.filter(e => dayKey(e.ts) === today);
  const todayReturns = state.returns.filter(r => dayKey(r.ts) === today);
  const cashSales = sumList(todayInvs, i => i.paid) + sumList(todayDS, s => s.paid);
  const creditSales = sumList(todayInvs, i => i.remaining) + sumList(todayDS, s => s.remaining);
  const totalSales = sumList(todayInvs, i => i.total) + sumList(todayDS, s => s.total);
  const totalExpenses = sumList(todayExps, e => e.amount);
  const totalReturns = sumList(todayReturns, r => r.amount);
  const expectedCash = roundMoney(cashSales - totalExpenses - totalReturns);
  const diff = roundMoney(actualCash - expectedCash);

  const closeObj = {
    id: 'CLOSE-' + Date.now(), ts: Date.now(), date: nowStr(), dayKey: today,
    totalSales, cashSales, creditSales, totalExpenses, totalReturns,
    expectedCash, actualCash, diff, notes
  };
  state.dailyCloses.push(closeObj);
  logAudit('إغلاق الصندوق', `النقدية المتوقعة ${fmtCur(expectedCash)} • الفعلية ${fmtCur(actualCash)} • الفرق ${fmtCur(diff)}`);
  const ok = await saveToStorage();
  if (!ok) { state.dailyCloses.pop(); return; }
  closeModal('dailyCloseModal');
  playSound('success');
  Swal.fire({
    icon: diff === 0 ? 'success' : (Math.abs(diff) < expectedCash * 0.05 ? 'info' : 'warning'),
    title: 'تم إغلاق الصندوق',
    html: `النقدية المتوقعة: <b>${fmtCur(expectedCash)}</b><br>النقدية الفعلية: <b>${fmtCur(actualCash)}</b><br>الفرق: <b class="${diff === 0 ? 'text-emerald-700' : (diff > 0 ? 'text-blue-700' : 'text-rose-700')}">${fmtCur(diff)}</b>`,
    confirmButtonColor: '#0F5C4E'
  });
}

function viewLastDailyClose() {
  if (!state.dailyCloses.length) return warn('لا يوجد', 'لا يوجد سجل إغلاق سابق', 'info');
  const last = state.dailyCloses[state.dailyCloses.length - 1];
  Swal.fire({
    icon: last.diff === 0 ? 'success' : 'info',
    title: 'آخر إغلاق: ' + last.date,
    html: `
      <div class="text-right space-y-1 text-sm font-bold">
        <div>إجمالي المبيعات: <b>${fmtCur(last.totalSales)}</b></div>
        <div>نقدي: <b class="text-emerald-700">${fmtCur(last.cashSales)}</b></div>
        <div>آجل: <b class="text-rose-700">${fmtCur(last.creditSales)}</b></div>
        <div>مصاريف: <b>${fmtCur(last.totalExpenses)}</b></div>
        <div>مرتجعات: <b>${fmtCur(last.totalReturns)}</b></div>
        <div class="border-t pt-1">النقدية المتوقعة: <b>${fmtCur(last.expectedCash)}</b></div>
        <div>النقدية الفعلية: <b>${fmtCur(last.actualCash)}</b></div>
        <div>الفرق: <b class="${last.diff === 0 ? 'text-emerald-700' : 'text-rose-700'}">${fmtCur(last.diff)}</b></div>
        ${last.notes ? `<div>ملاحظات: ${esc(last.notes)}</div>` : ''}
      </div>`,
    confirmButtonColor: '#0F5C4E'
  });
}

/* ---------- الفاتورة والـ PDF ---------- */
function showReceiptModal(inv) {
  state.currentReceiptInv = inv;
  $('recStoreName').textContent = state.storeInfo.name;
  $('recStorePhone').textContent = state.storeInfo.phone ? `هاتف: ${state.storeInfo.phone}` : '';
  $('recStoreAddress').textContent = state.storeInfo.address ? `عنوان: ${state.storeInfo.address}` : '';
  $('recNum').textContent = inv.id;
  $('recDate').textContent = inv.date || new Date(inv.ts).toLocaleString('ar-SY');
  $('recClient').textContent = inv.clientName;
  $('recPriceMode').textContent = inv.priceMode || 'تجزئة';

  $('recItemsBody').innerHTML = (inv.items || []).map(it => `
    <tr>
      <td class="py-1.5">${esc(it.name)}</td>
      <td class="py-1.5 text-center">${fmt(it.qty)}</td>
      <td class="py-1.5 text-left">${fmtCur(it.price)}</td>
      <td class="py-1.5 text-left font-bold">${fmtCur(calcLineTotal(it.price, it.qty))}</td>
    </tr>`).join('');

  if (toNum(inv.discount) > 0) {
    $('recDiscountRow').classList.remove('hidden');
    $('recDiscount').textContent = fmtCur(inv.discount);
  } else $('recDiscountRow').classList.add('hidden');

  $('recTotal').textContent = fmtCur(inv.total);
  $('recPaid').textContent = fmtCur(inv.paid);
  $('recRemaining').textContent = fmtCur(inv.remaining);

  const change = toNum(inv.changeGiven);
  if (change > 0) {
    $('recChangeRow').classList.remove('hidden');
    $('recChange').textContent = fmtCur(change);
  } else $('recChangeRow').classList.add('hidden');

  if (inv.clientId && inv.clientId !== 'c1') {
    $('recTotalDebtRow').classList.remove('hidden');
    const rawBal = getClientRawBalance(inv.clientId);
    $('recTotalClientDebt').textContent = rawBal < 0 ? `دائن له ${fmtCur(-rawBal)}` : fmtCur(rawBal);
  } else $('recTotalDebtRow').classList.add('hidden');

  openModal('receiptModal');
}

async function generateReceiptBlob() {
  const el = $('printableReceipt');
  return await new Promise(resolve => {
    html2canvas(el, { scale: 2.5, backgroundColor: '#ffffff', useCORS: true }).then(canvas => {
      canvas.toBlob(blob => resolve(blob), 'image/png', 1.0);
    }).catch(() => resolve(null));
  });
}

async function saveReceiptAsImage() {
  const blob = await generateReceiptBlob();
  if (!blob) return warn('خطأ', 'تعذر إنشاء الصورة', 'error');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `فاتورة_${state.currentReceiptInv?.id || 'invoice'}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('تم حفظ صورة الفاتورة');
}

async function shareReceiptImage() {
  const blob = await generateReceiptBlob();
  if (!blob) return warn('خطأ', 'تعذر إنشاء الصورة', 'error');
  const file = new File([blob], `فاتورة_${state.currentReceiptInv?.id || 'invoice'}.png`, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'فاتورة', text: `فاتورة ${state.storeInfo.name}` }); } catch (_) {}
  } else {
    saveReceiptAsImage();
  }
}

function shareReceiptWhatsApp() {
  const inv = state.currentReceiptInv;
  if (!inv) return;
  const itemsText = (inv.items || []).map(i => `• ${i.name} (${i.qty}) = ${fmtCur(calcLineTotal(i.price, i.qty))}`).join('\n');
  const txt = `*${state.storeInfo.name}*\nفاتورة رقم: *${inv.id}*\nالزبون: ${inv.clientName}\nالتاريخ: ${inv.date}\n━━━━━━━━━━━━━━\n${itemsText}\n━━━━━━━━━━━━━━\nالإجمالي: *${fmtCur(inv.total)}*\nالمدفوع: ${fmtCur(inv.paid)}\nالمتبقي: ${fmtCur(inv.remaining)}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(txt)}`, '_blank');
}

function exportDataBackup() {
  const exportObj = { ...state };
  delete exportObj.pinHash;
  delete exportObj.pinSalt;
  const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `نسخة_احتياطية_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  toast('تم تصدير النسخة الاحتياطية');
}

function triggerImportBackup() {
  const inp = $('importBackupFile');
  if (!inp) return;
  inp.value = '';
  inp.click();
}

function importDataBackup(ev) {
  const file = ev.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.products)) {
        return warn('ملف غير صالح', 'تأكد من اختيار ملف نسخة احتياطية صحيح', 'error');
      }
      await AshourDB.saveBackup(state);
      const keepPinHash = state.pinHash;
      const keepPinSalt = state.pinSalt;
      const keepPinLen = state.pinLength;
      state = deepMerge(defaultState(), parsed);
      state.pinHash = keepPinHash;
      state.pinSalt = keepPinSalt;
      state.pinLength = keepPinLen;
      await saveToStorage();
      refreshCategoryWidgets();
      applyTheme(state.darkMode);
      applyPrinterWidth(state.printerWidth);
      renderAll();
      toast('تمت استعادة النسخة الاحتياطية');
    } catch (_) {
      warn('خطأ في القراءة', 'تعذر قراءة ملف النسخة الاحتياطية', 'error');
    }
  };
  reader.readAsText(file);
}

async function refreshStorageStatus() {
  const box = $('storageStatus');
  if (!box) return;
  try {
    const info = await AshourDB.getStatus();
    const usedKB = Math.round((info.localStorageSize || 0) / 1024);
    const quotaMB = info.estimate && info.estimate.quota ? (info.estimate.quota / (1024 * 1024)).toFixed(1) : 'غير محدد';
    const percent = info.estimate ? info.estimate.percent : 0;
    box.innerHTML = `
      <div>IndexedDB: <span class="text-emerald-700">${esc(info.indexedDB)}</span></div>
      <div>localStorage: <span class="text-emerald-700">${esc(info.localStorage)}</span> • ${fmt(usedKB)} KB</div>
      <div>السعة المتاحة: <span class="text-slate-800">${quotaMB} MB</span> (استخدام ${percent}%)</div>`;
  } catch (e) {
    box.innerHTML = `<div class="text-rose-600">تعذر قراءة حالة التخزين</div>`;
  }
}

async function testStorageCapacity() {
  toast('جارٍ اختبار الذاكرة...', 'info');
  const res = await AshourDB.testCapacity();
  if (res.ok) {
    refreshStorageStatus();
    Swal.fire({
      icon: 'success', title: 'الذاكرة سليمة',
      html: `تم اختبار حفظ ${res.sizeKB} KB بنجاح في ${res.ms}ms<br>IndexedDB: ${res.okIDB ? '✓' : '✗'} • localStorage: ${res.okLS ? '✓' : '✗'}`,
      confirmButtonColor: '#0F5C4E'
    });
  } else {
    Swal.fire({ icon: 'error', title: 'فشل الاختبار', html: esc(res.error || 'خطأ غير معروف'), confirmButtonColor: '#d33' });
  }
}

/* ---------- Render All + Initialization ---------- */
function renderAll() {
  if ($('headerStoreName')) $('headerStoreName').textContent = state.storeInfo.name;
  const curBtn = $('currencyToggleBtn');
  const curBtnD = $('currencyToggleBtnDesktop');
  const label = state.displayCurrency === 'USD' ? 'USD' : 'ل.س.ج';
  if (curBtn) curBtn.textContent = label;
  if (curBtnD) curBtnD.textContent = label;
  applyTheme(state.darkMode);
  applyPrinterWidth(state.printerWidth);
  populatePosClients();
  renderPosProducts();
  renderCart();
  renderProductsTable();
  renderInventory();
  renderClientsGrid();
  renderCompaniesGrid();
  renderInvoicesTable();
  renderPurchases();
  renderExpenses();
  renderOrders();
  updateLowStockBadge();
  updateOrdersBadge();
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadFromStorage();
  refreshCategoryWidgets();
  setReportRange(30);
  renderAll();
});
