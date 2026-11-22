/* ==========================================================================
   app.js — عقل التطبيق الكامل (مركز عاشور)
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

// تنسيق الأرقام بفواصل كل 3 خانات مع إبقاء القيمة الرقمية دقيقة: 646 أو 6,255
function fmt(n) {
  const num = roundMoney(n);
  const parts = String(num).split('.');
  const intFormatted = Number(parts[0]).toLocaleString('en-US');
  return parts.length > 1 ? `${intFormatted}.${parts[1]}` : intFormatted;
}
function fmtCur(n) {
  return `${fmt(n)} ${CURRENCY}`;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
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
const warn = (title, text, icon = 'warning') => Swal.fire({ icon, title, text, confirmButtonColor: '#0F5C4E' });
const toast = (title, icon = 'success') => Swal.fire({ toast: true, position: 'top-end', icon, title, showConfirmButton: false, timer: 1600 });

/* ==================== Constants ==================== */
const DEFAULT_CATEGORIES = ['بسكويت', 'شيبس', 'عصائر ومشروبات', 'سكاكر وعلكة', 'قهوة', 'مواد غذائية'];
const IMPORTED_PRODUCTS = [
  { name: "اربيكا طبيعي صغير", category: "شيبس" }, { name: "اربيكا طبيعي جامبو", category: "شيبس" },
  { name: "تورتيز رقائق كبير 100", category: "شيبس" }, { name: "تورتيز رقائق", category: "شيبس" },
  { name: "سبوكي كبير 100", category: "شيبس" }, { name: "عصير كرتون 20", category: "عصائر ومشروبات" },
  { name: "اوكتبوس كرنشي", category: "شيبس" }, { name: "قهوه سادة موكا 100g", category: "قهوة" },
  { name: "قهوه كلاسيك مع الهال 100g", category: "قهوة" }, { name: "قهوة إكسترا هال 200", category: "قهوة" },
  { name: "قهوة كلاسيك مع هال 200g", category: "قهوة" }, { name: "توب فريش ساور", category: "سكاكر وعلكة" },
  { name: "كب كيك", category: "بسكويت" }, { name: "حنجور شوكالا", category: "بسكويت" },
  { name: "بسكويت ماتيلدا دارك", category: "بسكويت" }, { name: "بسكويت كريمة", category: "بسكويت" },
  { name: "سلسيتو مالح", category: "بسكويت" }, { name: "بسكوت مي تو", category: "بسكويت" },
  { name: "بسكويت تاندا", category: "بسكويت" }, { name: "قهوه اكسترا هال 100g", category: "قهوة" }
];

/* ==================== State ==================== */
let state = {};
let isCheckoutSubmitting = false;

function defaultState() {
  return {
    pinHash: null, pinSalt: null, pinLength: 4, pinAttempts: 0, pinLockUntil: 0,
    storeInfo: { name: 'مركز عاشور للتجارة', phone: '0991234567', address: 'السوق المركزي - صالة الجملة' },
    products: IMPORTED_PRODUCTS.map((p, i) => ({
      id: (i + 1).toString(),
      sku: (101 + i).toString(),
      barcode: '',
      name: p.name,
      category: p.category,
      cost: 0,
      retailPrice: 0,
      wholesalePrice: 0
    })),
    clients: [
      { id: 'c1', name: 'زبون نقدي مباشر', type: 'retail', phone: '-', address: '-', openingDebt: 0 },
      { id: 'c2', name: 'سوبرماركت البركة (موزع)', type: 'wholesale', phone: '0998877665', address: 'شارع التجارة', openingDebt: 150 }
    ],
    invoices: [],
    expenses: [],
    payments: [],
    returns: [],
    directSales: [],
    noInvoiceItems: [],
    companies: [],
    purchases: [],
    companyPayments: [],
    personDebts: [],
    auditLog: [{ ts: Date.now(), date: nowStr(), type: 'النظام', details: 'بدء تشغيل النظام', status: 'مكتمل' }],
    invoiceCounter: 1000,
    cart: [],
    selectedPosCategory: 'الكل',
    posPriceOverride: null, // 'retail' | 'wholesale' | null (تلقائي حسب الزبون)
    currentLedgerClientId: null,
    currentReceiptInv: null,
    activeCompanyId: null
  };
}

async function saveToStorage() {
  const result = await AshourDB.save(state);
  if (!result.ok) {
    Swal.fire({ icon: 'error', title: 'فشل الحفظ!', html: `تعذّر حفظ البيانات.<br><small>${esc(result.errors.join(' | '))}</small>`, confirmButtonColor: '#d33' });
  }
  return result.ok;
}

let backupTimer = null;
function startAutoBackup() {
  if (backupTimer) clearInterval(backupTimer);
  backupTimer = setInterval(async () => {
    if (state.products) await AshourDB.saveBackup(state);
  }, 5 * 60 * 1000);
}

async function loadFromStorage() {
  const result = await AshourDB.load();
  if (result.ok && result.state) state = deepMerge(defaultState(), result.state);
  else state = defaultState();

  ['returns', 'directSales', 'noInvoiceItems', 'companies', 'payments', 'expenses', 'invoices', 'products', 'clients', 'purchases', 'companyPayments', 'personDebts'].forEach(k => {
    if (!Array.isArray(state[k])) state[k] = [];
  });

  if (!state.invoiceCounter) state.invoiceCounter = 1000;
  if (!state.pinSalt) state.pinSalt = generateSalt();
  if (!state.pinHash) {
    state.pinHash = await hashPin('1234', state.pinSalt);
    state.pinLength = 4;
  }
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

/* ==================== PIN ==================== */
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

/* ==================== Navigation ==================== */
function switchTab(tabId) {
  document.querySelectorAll('.tab-view').forEach(el => {
    el.classList.add('hidden');
    el.classList.remove('active');
  });
  const view = $('view-' + tabId);
  if (view) {
    view.classList.remove('hidden');
    setTimeout(() => view.classList.add('active'), 20);
  }
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('bg-white/20', 'active'));
  const btn = $('tab-' + tabId);
  if (btn) btn.classList.add('bg-white/20', 'active');

  if (tabId === 'settings') { loadStoreInfoToSettings(); refreshStorageStatus(); }
  if (tabId === 'reports') renderReports();
  if (tabId === 'purchases') renderPurchases();
  if (tabId === 'debts') renderPersonDebts();
  if (tabId === 'clients') renderClientsGrid();
  if (tabId === 'companies') renderCompaniesGrid();

  renderAll();
}

const MODAL_IDS = ['barcodeScannerModal', 'quickProductModal', 'directSaleModal', 'noInvoiceModal', 'productModal', 'companyModal', 'companyProductModal', 'purchaseModal', 'personDebtModal', 'companyPaymentModal', 'receiptModal', 'clientModal'];

window.addEventListener('popstate', () => {
  if ($('barcodeScannerModal') && !$('barcodeScannerModal').classList.contains('hidden')) {
    closeBarcodeScanner();
    history.pushState(null, null, location.href);
    return;
  }
  const openMod = MODAL_IDS.find(id => $(id) && !$(id).classList.contains('hidden'));
  if (openMod) {
    closeModal(openMod);
    history.pushState(null, null, location.href);
    return;
  }
  const activeTab = document.querySelector('.tab-btn.active');
  if (activeTab && activeTab.id !== 'tab-pos') {
    switchTab('pos');
    history.pushState(null, null, location.href);
    return;
  }
  Swal.fire({
    title: 'هل تريد الخروج من النظام؟',
    text: 'سيتم إغلاق التطبيق.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#d33',
    cancelButtonColor: '#3085d6',
    confirmButtonText: 'نعم، خروج',
    cancelButtonText: 'إلغاء'
  }).then(result => {
    if (result.isConfirmed) history.back();
    else history.pushState(null, null, location.href);
  });
});
history.pushState(null, null, location.href);

/* ==================== Categories & Balances ==================== */
function allCategories() {
  const set = new Set(DEFAULT_CATEGORIES);
  state.products.forEach(p => { if (p.category) set.add(p.category); });
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

function getClientDebt(clientId) {
  const c = state.clients.find(x => x.id === clientId);
  if (!c) return 0;
  return roundMoney(
    toNum(c.openingDebt) +
    sumList(state.invoices.filter(i => i.clientId === clientId && i.status === 'active'), i => i.remaining) -
    sumList(state.payments.filter(p => p.clientId === clientId), p => p.amount) -
    sumList(state.returns.filter(r => r.clientId === clientId), r => r.amount)
  );
}

/* ==================== POS, Pricing Mode & Cart ==================== */
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
  return state.clients.find(c => c.id === id) || state.clients[0] || { id: 'c1', name: 'زبون نقدي مباشر', type: 'retail' };
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

  if (state.cart.length > 0) {
    const res = await Swal.fire({
      title: `تبديل التسعيرة إلى (${nextLabel})؟`,
      text: 'هل تريد تحديث أسعار الأصناف الحالية في السلة إلى التسعيرة الجديدة؟',
      icon: 'question',
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonColor: '#0F5C4E',
      denyButtonColor: '#475569',
      cancelButtonColor: '#d33',
      confirmButtonText: 'نعم، حدّث السلة',
      denyButtonText: 'بدّل الشارة فقط',
      cancelButtonText: 'إلغاء'
    });
    if (res.isDismissed) return;
    if (res.isConfirmed) {
      const priceKey = next === 'wholesale' ? 'wholesalePrice' : 'retailPrice';
      state.cart.forEach(item => {
        if (!item.isQuickOnly) {
          const p = state.products.find(x => x.id === item.productId);
          if (p && toNum(p[priceKey]) > 0) item.customPrice = toNum(p[priceKey]);
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
  const mode = getActivePriceType();
  const isWholesale = mode === 'wholesale';
  const badge = $('posPriceTypeBadge');
  const invBadge = $('posInvoicePriceBadge');
  if (badge) {
    badge.textContent = isWholesale ? 'جملة (موزع)' : 'تجزئة (عادي)';
    badge.className = isWholesale
      ? 'inline-block bg-amber-100 text-amber-800 text-xs px-2 py-0.5 rounded font-bold mt-1'
      : 'inline-block bg-emerald-100 text-emerald-800 text-xs px-2 py-0.5 rounded font-bold mt-1';
  }
  if (invBadge) {
    invBadge.textContent = isWholesale ? 'تسعيرة: جملة' : 'تسعيرة: تجزئة';
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
  dropdown.innerHTML = list.map(c => `<div onclick="selectClient('${esc(c.id)}', '${esc(c.name)}')" class="p-2.5 hover:bg-emerald-50 cursor-pointer text-xs font-bold flex justify-between items-center num-tabular"><span>${esc(c.name)}</span><span class="text-[11px] text-slate-500">دين: ${fmtCur(getClientDebt(c.id))}</span></div>`).join('');
  if (list.length && !$('posClientSelect').value) selectClient(list[0].id, list[0].name);
}
function selectClient(id, label) {
  $('posClientSelect').value = id;
  $('selectedClientText').textContent = label;
  $('clientDropdownList').classList.add('hidden');
  state.posPriceOverride = null; // مواءمة التسعيرة افتراضياً مع نوع الزبون الجديد
  onPosClientChange();
}
function toggleClientDropdown() {
  $('clientDropdownList').classList.toggle('hidden');
  populatePosClients();
}
function onPosClientChange() {
  updatePosPriceUI();
  renderPosProducts();
  renderCart();
}

function renderPosProducts() {
  const search = normalizeArabic(($('posSearch')?.value || '').trim());
  const priceKey = getActivePriceType() === 'wholesale' ? 'wholesalePrice' : 'retailPrice';
  const filtered = state.products.filter(p => {
    const okCat = state.selectedPosCategory === 'الكل' || p.category === state.selectedPosCategory;
    return okCat && (!search || normalizeArabic(p.name).includes(search) || normalizeArabic(p.sku).includes(search) || normalizeArabic(p.barcode).includes(search));
  });
  if (!filtered.length) {
    $('posProductsGrid').innerHTML = `<div class="col-span-full text-center py-10 text-slate-400 text-sm font-bold">لا توجد منتجات مطابقة</div>`;
    return;
  }
  $('posProductsGrid').innerHTML = filtered.map(p => {
    const price = toNum(p[priceKey]);
    return `<div onclick="addToCart('${esc(p.id)}')" class="bg-white border hover:border-ashour cursor-pointer transition flex flex-col justify-between border-slate-200 rounded-xl p-2.5 shadow-sm card-hover relative group">
      <div>
        <span class="text-[11px] text-ashour font-bold block bg-ashour/10 px-1.5 py-0.5 rounded w-fit num-tabular">${esc(p.sku || '-')}</span>
        <h4 class="font-bold text-sm text-slate-800 line-clamp-2 leading-tight mt-1">${esc(p.name)}</h4>
      </div>
      <div class="mt-2 flex items-end justify-between border-t border-slate-100 pt-1.5 num-tabular">
        <span class="text-sm ${price > 0 ? 'text-ashour font-bold' : 'text-rose-500 font-bold text-xs'}">${price > 0 ? fmtCur(price) : 'حدد السعر'}</span>
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
      icon: 'question',
      title: 'رمز غير موجود',
      text: `لم يتم العثور على منتج بالرمز (${code}). هل تريد فتح منتج سريع؟`,
      showCancelButton: true,
      confirmButtonColor: '#4f46e5',
      cancelButtonColor: '#64748b',
      confirmButtonText: 'فتح منتج سريع',
      cancelButtonText: 'إغلاق'
    }).then(res => {
      if (res.isConfirmed) openQuickProductModal(code);
    });
    input.value = '';
    input.focus();
    return;
  }

  const priceKey = getActivePriceType() === 'wholesale' ? 'wholesalePrice' : 'retailPrice';
  if (!(toNum(product[priceKey]) > 0)) {
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
  const priceKey = getActivePriceType() === 'wholesale' ? 'wholesalePrice' : 'retailPrice';
  if (!(toNum(product[priceKey]) > 0)) {
    Swal.fire({ icon: 'info', title: 'السعر غير محدد', text: 'حدد السعر أولاً.', confirmButtonColor: '#0F5C4E' })
      .then(() => openProductModal(productId));
    return;
  }
  const existing = state.cart.find(i => i.productId === productId && !i.isQuickOnly);
  if (existing) existing.qty = roundMoney(toNum(existing.qty) + 1);
  else state.cart.push({ productId, qty: 1 });
  renderCart();
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

function getCartItemInfo(item, priceKey) {
  if (item.isQuickOnly) {
    return { key: item.quickId, productId: item.quickId, name: item.name, unitPrice: toNum(item.price), unitCost: 0, isQuickOnly: true };
  }
  const p = state.products.find(x => x.id === item.productId);
  if (!p) return null;
  const activePrice = item.customPrice != null && toNum(item.customPrice) > 0 ? toNum(item.customPrice) : toNum(p[priceKey]);
  return { key: p.id, productId: p.id, name: p.name, unitPrice: activePrice, unitCost: toNum(p.cost), isQuickOnly: false };
}

function cartTotals() {
  const priceKey = getActivePriceType() === 'wholesale' ? 'wholesalePrice' : 'retailPrice';
  let subtotal = 0, cost = 0;
  state.cart.forEach(item => {
    const info = getCartItemInfo(item, priceKey);
    if (!info) return;
    subtotal = roundMoney(subtotal + calcLineTotal(info.unitPrice, item.qty));
    cost = roundMoney(cost + calcLineTotal(info.unitCost, item.qty));
  });
  const discount = Math.max(0, Math.min(toNum($('posDiscount')?.value), subtotal));
  const total = roundMoney(subtotal - discount);
  const discountPct = subtotal > 0 ? roundMoney((discount / subtotal) * 100) : 0;
  return { subtotal, discount, total, cost, priceKey, discountPct };
}

function renderCart() {
  const container = $('cartItemsList');
  const { subtotal, total, discount, discountPct, priceKey } = cartTotals();

  if (!state.cart.length) {
    container.innerHTML = `<div class="text-center py-10 text-slate-400"><i class="fa-solid fa-basket-shopping text-3xl mb-2 opacity-40"></i><p class="text-xs font-bold">السلة فارغة.</p></div>`;
  } else {
    container.innerHTML = state.cart.map(item => {
      const info = getCartItemInfo(item, priceKey);
      if (!info) return '';
      return `<div class="py-2 flex items-center justify-between gap-2 num-tabular">
        <div class="flex-grow min-w-0">
          <h5 class="font-bold text-xs text-slate-800 truncate">${esc(info.name)}</h5>
          <span class="text-[11px] text-slate-500 font-semibold">${fmt(info.unitPrice)} × ${item.qty}</span>
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
    if (discount > 0 && discountPct >= 15) {
      $('discountPctText').textContent = `${discountPct}%`;
      warnBadge.classList.remove('hidden');
    } else {
      warnBadge.classList.add('hidden');
    }
  }

  $('cartSubtotal').textContent = fmtCur(subtotal);
  $('cartTotal').textContent = fmtCur(total);
  $('posPaidAmount').placeholder = `الإجمالي: ${fmt(total)}`;
  updatePaymentSummaryPreview();
}

function setPaidExact() {
  const { total } = cartTotals();
  $('posPaidAmount').value = total;
  updatePaymentSummaryPreview();
}
function setCreditMode() {
  $('posPaidAmount').value = 0;
  updatePaymentSummaryPreview();
}
function setPaidAmount(amt) {
  $('posPaidAmount').value = amt;
  updatePaymentSummaryPreview();
}

function updatePaymentSummaryPreview() {
  const { total } = cartTotals();
  const raw = $('posPaidAmount').value.trim();
  const paidEntered = raw === '' ? total : Math.max(0, toNum(raw));
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
  const last = [...state.invoices].reverse().find(i => i.clientId === client.id && i.status === 'active');
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
  const { total, discount, cost, priceKey } = cartTotals();

  for (const item of state.cart) {
    const info = getCartItemInfo(item, priceKey);
    if (!info) return warn('منتج محذوف', 'أزل المنتجات المحذوفة من السلة', 'error');
    if (!(info.unitPrice > 0)) return warn('سعر غير محدد', info.name, 'error');
  }

  const paidRaw = $('posPaidAmount').value.trim();
  const paidEntered = paidRaw === '' ? total : Math.max(0, toNum(paidRaw));
  const changeGiven = paidEntered > total ? roundMoney(paidEntered - total) : 0;
  const paidRecorded = roundMoney(Math.min(paidEntered, total));
  const remaining = roundMoney(total - paidRecorded);

  // منع تسجيل دين على "زبون نقدي مباشر" غير المحدد
  if (remaining > 0 && client.id === 'c1') {
    return warn('اختيار الزبون مطلوب', 'لتسجيل فاتورة آجلة أو جزئية، يرجى اختيار زبون مسجل بدلاً من الزبون النقدي المباشر.', 'warning');
  }

  const saveBtn = $('checkoutSaveBtn');
  isCheckoutSubmitting = true;
  if (saveBtn) saveBtn.disabled = true;

  const items = state.cart.map(item => {
    const info = getCartItemInfo(item, priceKey);
    return {
      productId: info.productId,
      name: info.name,
      qty: toNum(item.qty),
      price: info.unitPrice,
      total: calcLineTotal(info.unitPrice, item.qty),
      isQuickOnly: info.isQuickOnly
    };
  });

  const paymentType = remaining > 0 ? (paidRecorded > 0 ? 'partial' : 'debt') : 'cash';
  const priceModeLabel = getActivePriceType() === 'wholesale' ? 'جملة' : 'تجزئة';
  const inv = {
    id: nextInvoiceNumber(),
    ts: Date.now(),
    date: nowStr(),
    clientId: client.id,
    clientName: client.name,
    priceMode: priceModeLabel,
    paymentType,
    items,
    discount,
    total,
    paid: paidRecorded,
    remaining,
    changeGiven,
    profit: roundMoney(total - cost),
    status: 'active'
  };

  const previousInvoices = [...state.invoices];
  state.invoices.push(inv);
  logAudit('بيع فاتورة', `فاتورة ${inv.id} للزبون ${client.name} (${priceModeLabel}) بمبلغ ${fmtCur(total)} — متبقي ${fmtCur(remaining)}`);

  const ok = await saveToStorage();
  if (!ok) {
    state.invoices = previousInvoices;
    isCheckoutSubmitting = false;
    if (saveBtn) saveBtn.disabled = false;
    return;
  }

  showReceiptModal(inv);
  state.cart = [];
  state.posPriceOverride = null;
  $('posPaidAmount').value = '';
  $('posDiscount').value = '';
  updatePosPriceUI();
  renderPosProducts();
  renderCart();
  renderAll();
  toast('تم حفظ الفاتورة');

  setTimeout(() => {
    isCheckoutSubmitting = false;
    if (saveBtn) saveBtn.disabled = false;
  }, 500);
}

/* ==================== Barcode Scanner ==================== */
let html5QrCode = null;
let currentScanTarget = 'quickEntryInput';

function openBarcodeScanner(targetId = 'quickEntryInput') {
  currentScanTarget = targetId;
  const modal = $('barcodeScannerModal');
  modal.classList.remove('hidden');
  modal.style.display = 'flex';

  html5QrCode = new Html5Qrcode("barcode-reader");
  html5QrCode.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: { width: 250, height: 150 } },
    decodedText => handleBarcodeScanSuccess(decodedText),
    () => {}
  ).catch(() => {
    warn('خطأ', 'تعذر تشغيل الكاميرا. تأكد من إعطاء الإذن للمتصفح.', 'error');
    closeBarcodeScanner();
  });
}

async function handleBarcodeScanSuccess(decodedText) {
  if (html5QrCode) {
    try { await html5QrCode.stop(); await html5QrCode.clear(); } catch (_) {}
    html5QrCode = null;
  }
  const modal = $('barcodeScannerModal');
  modal.classList.add('hidden');
  modal.style.display = 'none';

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
    try { await html5QrCode.stop(); await html5QrCode.clear(); } catch (_) {}
    html5QrCode = null;
  }
  const modal = $('barcodeScannerModal');
  modal.classList.add('hidden');
  modal.style.display = 'none';
}

/* ==================== Direct Sale & No-Invoice ==================== */
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
  const price = Math.max(0, toNum($('dsPrice').value));
  const total = calcLineTotal(price, qty);
  const paidRaw = $('dsPaid').value.trim();
  const paid = paidRaw === '' ? total : Math.max(0, toNum(paidRaw));
  const change = paid > total ? roundMoney(paid - total) : 0;
  const remaining = paid < total ? roundMoney(total - paid) : 0;
  $('dsSummaryText').textContent = `الإجمالي: ${fmtCur(total)} • المدفوع: ${fmtCur(paid)} • الباقي: ${fmtCur(change)} • متبقي: ${fmtCur(remaining)}`;
}

async function saveDirectSale() {
  const name = $('dsName').value.trim();
  const qty = Math.max(1, parseInt($('dsQty').value, 10) || 1);
  const price = toNum($('dsPrice').value);
  if (!name) return warn('خطأ', 'أدخل اسم الصنف');
  if (price <= 0) return warn('خطأ', 'أدخل سعراً صحيحاً');

  const total = calcLineTotal(price, qty);
  const paidRaw = $('dsPaid').value.trim();
  const paidEntered = paidRaw === '' ? total : Math.max(0, toNum(paidRaw));
  const paidRecorded = roundMoney(Math.min(paidEntered, total));
  const remaining = roundMoney(total - paidRecorded);

  const newSale = {
    id: 'QS-' + Date.now(),
    ts: Date.now(),
    date: nowStr(),
    name,
    price,
    qty,
    total,
    paid: paidRecorded,
    remaining,
    profit: paidRecorded
  };
  state.directSales.push(newSale);
  logAudit('بيع سريع', `${qty} × ${name} بقيمة ${fmtCur(total)}`);
  const ok = await saveToStorage();
  if (!ok) { state.directSales.pop(); return; }
  closeModal('directSaleModal');
  renderAll();
  toast(`تم تسجيل ${qty} × ${name}`);
}

function openNoInvoiceModal() {
  $('niName').value = '';
  $('niQty').value = '2';
  $('niPrice').value = '';
  $('niNote').value = 'للبيت';
  openModal('noInvoiceModal');
}

async function saveNoInvoiceItem() {
  const name = $('niName').value.trim();
  const qty = Math.max(1, parseInt($('niQty').value, 10) || 1);
  const price = Math.max(0, toNum($('niPrice').value));
  const note = $('niNote').value.trim() || 'بدون فاتورة';
  if (!name) return warn('خطأ', 'أدخل اسم الصنف');

  const total = calcLineTotal(price, qty);
  const entry = {
    id: 'NOINV-' + Date.now(),
    ts: Date.now(),
    date: nowStr(),
    name,
    qty,
    price,
    total,
    note
  };
  state.noInvoiceItems.push(entry);
  logAudit('بدون فاتورة', `${qty} × ${name} (${note})`);
  const ok = await saveToStorage();
  if (!ok) { state.noInvoiceItems.pop(); return; }
  closeModal('noInvoiceModal');
  renderAll();
  toast(`تم تسجيل ${qty} × ${name} بدون فاتورة`);
}

/* ==================== Products & Quick Product ==================== */
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
  $('productsTableBody').innerHTML = list.map(p => `
    <tr class="hover:bg-slate-50 border-b border-slate-100">
      <td class="p-3 text-ashour font-bold">${esc(p.sku || '-')} <br><span class="text-[11px] text-slate-500 font-normal">${esc(p.barcode || '')}</span></td>
      <td class="p-3 font-bold text-indigo-700">${esc(p.name)}</td>
      <td class="p-3"><span class="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-[11px]">${esc(p.category || '-')}</span></td>
      <td class="p-3 text-slate-600">${fmtCur(p.cost)}</td>
      <td class="p-3 text-emerald-800">${fmtCur(p.retailPrice)}</td>
      <td class="p-3 text-amber-800">${fmtCur(p.wholesalePrice)}</td>
      <td class="p-3 text-center"><div class="flex justify-center gap-1">
        <button onclick="openProductModal('${esc(p.id)}')" class="bg-indigo-100 text-indigo-700 hover:bg-indigo-600 hover:text-white px-2.5 py-1 rounded transition text-xs font-bold"><i class="fa-solid fa-pen"></i></button>
        <button onclick="deleteProduct('${esc(p.id)}')" class="bg-rose-100 text-rose-700 hover:bg-rose-600 hover:text-white px-2.5 py-1 rounded transition text-xs font-bold"><i class="fa-solid fa-trash"></i></button>
      </div></td>
    </tr>`).join('') || `<tr><td colspan="7" class="p-6 text-center text-slate-400 text-sm">لا توجد منتجات</td></tr>`;
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
    $('prodCostInput').value = toNum(p.cost);
    $('prodRetailInput').value = toNum(p.retailPrice);
    $('prodWholesaleInput').value = toNum(p.wholesalePrice);
  } else {
    $('productModalTitle').textContent = 'إضافة منتج جديد';
    $('prodSkuInput').value = generateUniqueSku();
    $('prodBarcodeInput').value = '';
    $('prodNameInput').value = '';
    $('prodCatInput').value = '';
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
  const cost = toNum($('prodCostInput').value);
  const retailPrice = toNum($('prodRetailInput').value);
  const wholesalePrice = toNum($('prodWholesaleInput').value);

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
    Object.assign(p, { sku, barcode, name, category, cost, retailPrice, wholesalePrice });
    logAudit('تعديل منتج', name);
  } else {
    state.products.push({ id: Date.now().toString(), sku, barcode, name, category, cost, retailPrice, wholesalePrice });
    logAudit('إضافة منتج', `${name} (كود: ${sku})`);
  }

  const ok = await saveToStorage();
  if (!ok) {
    if (editId && previous) {
      const p = state.products.find(x => x.id === editId);
      if (p) Object.assign(p, previous);
    } else state.products.pop();
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
    if (!ok) {
      if (removed) state.products.push(removed);
      state.cart.push(...removedFromCart);
      return;
    }
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
  const price = toNum($('qpPrice').value);
  const qty = Math.max(1, parseInt($('qpQty').value, 10) || 1);
  const barcode = $('qpBarcode').value.trim();
  if (!name) return warn('خطأ', 'أدخل اسم المنتج');
  if (!(price > 0)) return warn('خطأ', 'أدخل سعراً صحيحاً');

  state.cart.push({
    isQuickOnly: true,
    quickId: 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
    name,
    price,
    qty,
    barcode
  });
  closeModal('quickProductModal');
  renderCart();
  toast(`تمت إضافة ${qty} × ${name}`);
}

/* ==================== Clients, Edit Modal & Ledger ==================== */
function openClientModal(clientId = null) {
  $('clientEditId').value = clientId || '';
  if (clientId) {
    const c = state.clients.find(x => x.id === clientId);
    if (!c) return;
    $('clientModalTitle').textContent = 'تعديل بيانات الزبون';
    $('clientNameInput').value = c.name || '';
    $('clientPhoneInput').value = c.phone || '';
    $('clientAddressInput').value = c.address || '';
    $('clientOpeningInput').value = toNum(c.openingDebt);
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
  const openingDebt = toNum($('clientOpeningInput').value);
  const checkedRadio = document.querySelector('input[name="clientTypeRadio"]:checked');
  const type = checkedRadio ? checkedRadio.value : 'retail';

  if (!name) return warn('خطأ', 'أدخل اسم الزبون');

  let previous = null;
  if (editId) {
    const c = state.clients.find(x => x.id === editId);
    if (!c) return;
    previous = { ...c };
    Object.assign(c, { name, type, phone, address, openingDebt });
    logAudit('تعديل زبون', `${name} (رصيد افتتاحي: ${fmtCur(openingDebt)})`);
  } else {
    const newClient = { id: 'c_' + Date.now(), name, type, phone, address, openingDebt };
    state.clients.push(newClient);
    logAudit('إضافة زبون', name);
  }

  const ok = await saveToStorage();
  if (!ok) {
    if (editId && previous) {
      const c = state.clients.find(x => x.id === editId);
      if (c) Object.assign(c, previous);
    } else state.clients.pop();
    return;
  }

  closeModal('clientModal');
  renderClientsGrid();
  populatePosClients();
  if (editId && state.currentLedgerClientId === editId) {
    openClientDetailPage(editId);
  }
  toast('تم حفظ بيانات الزبون');
}

function renderClientsGrid() {
  const q = normalizeArabic(($('clientSearch')?.value || '').trim());
  const list = state.clients.filter(c => !q || normalizeArabic(c.name).includes(q) || (c.phone || '').includes(q));
  $('clientsGrid').innerHTML = list.map(c => {
    const debt = getClientDebt(c.id);
    const invCount = state.invoices.filter(i => i.clientId === c.id && i.status === 'active').length;
    return `<div onclick="openClientDetailPage('${esc(c.id)}')" class="bg-white border border-slate-200 hover:border-ashour rounded-2xl p-4 shadow-sm space-y-3 flex flex-col justify-between card-hover cursor-pointer">
      <div>
        <div class="flex items-center justify-between">
          <span class="text-[11px] font-bold px-2 py-0.5 rounded ${c.type === 'wholesale' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}">${c.type === 'wholesale' ? 'موزع جملة' : 'عميل تجزئة'}</span>
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

function openClientDetailPage(clientId) {
  state.currentLedgerClientId = clientId;
  const c = state.clients.find(x => x.id === clientId);
  if (!c) return;

  $('ledgerClientName').textContent = c.name;
  $('ledgerClientBadge').textContent = c.type === 'wholesale' ? 'موزع جملة' : 'زبون تجزئة';
  $('ledgerClientBadge').className = `text-xs font-bold px-2 py-0.5 rounded-full ${c.type === 'wholesale' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`;

  switchTab('client-detail');
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
  state.invoices.filter(i => i.clientId === clientId && i.status === 'active').forEach(inv => inv.items.forEach(it => {
    const key = (it.productId || normalizeArabic(it.name)) + '||' + toNum(it.price);
    if (!map.has(key)) map.set(key, { key, productId: it.productId, name: it.name, price: toNum(it.price), boughtQty: 0, returnedQty: 0 });
    map.get(key).boughtQty = roundMoney(map.get(key).boughtQty + toNum(it.qty));
  }));
  state.returns.filter(r => r.clientId === clientId).forEach(ret => {
    const key = normalizeArabic(ret.productName) + '||' + toNum(ret.unitPrice);
    if (map.has(key)) map.get(key).returnedQty = roundMoney(map.get(key).returnedQty + toNum(ret.qty));
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
            سعر الفاتورة الفعلي: <span class="text-ashour font-bold">${fmtCur(item.price)}</span> •
            الكمية المشتراة: <span class="font-bold">${fmt(item.boughtQty)}</span> •
            المرتجع سابقاً: <span class="font-bold">${fmt(item.returnedQty)}</span> •
            المتاح للإرجاع: <span class="text-emerald-700 font-bold">${fmt(item.remainingQty)}</span>
          </div>
        </div>
        <div class="flex items-center gap-2 bg-slate-50 p-1.5 rounded-lg border border-slate-200">
          <span class="text-xs font-bold text-slate-600">كمية الإرجاع:</span>
          <input type="number" id="returnQty_${esc(item.key)}" min="1" max="${item.remainingQty}" value="${item.remainingQty > 0 ? 1 : 0}" ${item.remainingQty <= 0 ? 'disabled' : ''} class="w-16 bg-white border border-slate-300 rounded-md p-1.5 text-center text-sm font-bold focus:border-ashour">
          <button onclick="submitClientReturn('${esc(clientId)}', '${esc(item.name)}', ${item.price}, '${esc(item.key)}')" ${item.remainingQty <= 0 ? 'disabled' : ''} class="bg-ashour hover:bg-ashour-dark disabled:opacity-40 text-white px-3 py-1.5 rounded-md text-xs font-bold transition">تأكيد الإرجاع</button>
        </div>
      </div>`).join('');
  }

  const rets = state.returns.filter(r => r.clientId === clientId).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  $('clientReturnsHistoryList').innerHTML = rets.length
    ? rets.map(r => `<div class="flex justify-between items-center border-b border-slate-200 py-1"><span>${esc(r.date)} — ${fmt(r.qty)} × ${esc(r.productName)} (${fmtCur(r.unitPrice)})</span><span class="text-emerald-700 font-bold">خصم ${fmtCur(r.amount)}</span></div>`).join('')
    : `<div class="text-slate-400 text-sm">لا توجد مرتجعات.</div>`;
}

async function submitClientReturn(clientId, productName, unitPrice, key) {
  const input = $('returnQty_' + key);
  const qty = parseInt(input.value, 10);
  if (!qty || qty <= 0) return warn('خطأ', 'أدخل كمية صحيحة');
  const max = parseInt(input.max, 10);
  if (qty > max) return warn('خطأ', 'الكمية تتجاوز المتاح للإرجاع');

  const client = state.clients.find(c => c.id === clientId);
  const amount = calcLineTotal(unitPrice, qty);
  const newReturn = { id: 'RET-' + Date.now(), ts: Date.now(), date: nowStr(), clientId, clientName: client.name, productName, qty, unitPrice, amount };

  state.returns.push(newReturn);
  logAudit('مرتجع', `إرجاع ${qty} × ${productName} بسعر ${fmtCur(unitPrice)} لـ ${client.name}`);
  const ok = await saveToStorage();
  if (!ok) { state.returns.pop(); return; }

  renderLedgerSummary(clientId);
  renderClientReturnsTab(clientId);
  toast(`تم إرجاع ${qty} ${productName} وخصم ${fmtCur(amount)}`);
}

async function recordDebtPayment() {
  const clientId = state.currentLedgerClientId;
  const c = state.clients.find(x => x.id === clientId);
  if (!c) return;
  const amount = toNum($('payDebtAmount').value);
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

/* ==================== Companies & Purchases ==================== */
function getCompanyDebt(companyId) {
  const purchasesRemaining = sumList(state.purchases.filter(p => p.companyId === companyId && p.status === 'active'), p => p.remaining);
  const paymentsMade = sumList(state.companyPayments.filter(p => p.companyId === companyId), p => p.amount);
  return roundMoney(purchasesRemaining - paymentsMade);
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
  $('cpBoxPriceInput').value = pr.boxPrice || '';
  $('cpPiecesPerBoxInput').value = pr.piecesPerBox || 1;
  $('cpPiecePriceInput').value = pr.piecePrice || '';
  $('cpConsumerPriceInput').value = pr.consumerPrice || '';
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
  pr.boxPrice = toNum($('cpBoxPriceInput').value);
  pr.piecesPerBox = toNum($('cpPiecesPerBoxInput').value) || 1;
  pr.piecePrice = toNum($('cpPiecePriceInput').value);
  pr.consumerPrice = toNum($('cpConsumerPriceInput').value);

  if (!pr.name) return warn('خطأ', 'أدخل اسم المنتج');
  const ok = await saveToStorage();
  if (!ok) { Object.assign(pr, oldData); return; }

  closeModal('companyProductModal');
  renderCompanyProductsGrid(state.activeCompanyId);
  toast('تم تعديل المنتج بنجاح');
}

async function addProductDirectlyToCompany() {
  const comp = state.companies.find(c => c.id === state.activeCompanyId);
  if (!comp) return;
  const { value: formValues } = await Swal.fire({
    title: 'إضافة منتج للشركة',
    html: `<input id="swal-p-name" class="swal2-input" placeholder="اسم المنتج">`,
    showCancelButton: true,
    confirmButtonColor: '#0F5C4E',
    confirmButtonText: 'إضافة',
    cancelButtonText: 'إلغاء',
    preConfirm: () => {
      const name = document.getElementById('swal-p-name').value.trim();
      if (!name) { Swal.showValidationMessage('أدخل اسم المنتج'); return false; }
      return { name };
    }
  });
  if (!formValues) return;
  if (!Array.isArray(comp.products)) comp.products = [];
  comp.products.push({ id: 'cp_' + Date.now(), name: formValues.name, boxPrice: 0, piecesPerBox: 1, piecePrice: 0, consumerPrice: 0 });
  const ok = await saveToStorage();
  if (!ok) { comp.products.pop(); return; }
  renderCompanyProductsGrid(state.activeCompanyId);
  toast('تمت الإضافة');
}

function openCompanyModal(id = null) {
  $('compEditId').value = id || '';
  if (id) {
    const comp = state.companies.find(x => x.id === id);
    if (!comp) return;
    $('compNameInput').value = comp.name || '';
    $('compPhoneInput').value = comp.phone || '';
    $('compAddressInput').value = comp.address || '';
    $('compDistributorInput').value = comp.distributorName || '';
    $('compCycleInput').value = comp.cycle || '';
  } else {
    $('compNameInput').value = '';
    $('compPhoneInput').value = '';
    $('compAddressInput').value = '';
    $('compDistributorInput').value = '';
    $('compCycleInput').value = '';
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
    const comp = state.companies.find(x => x.id === id);
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
    if (id && previous) {
      const comp = state.companies.find(x => x.id === id);
      if (comp) Object.assign(comp, previous);
    } else state.companies.pop();
    return;
  }

  closeModal('companyModal');
  if (id && state.activeCompanyId === id) openCompanyDetailPage(id);
  else renderCompaniesGrid();
  toast('تم الحفظ');
}

/* ==================== Purchases (6-Digit Code + Company Link) ==================== */
function generateSixDigitPurchaseCode() {
  const used = new Set(state.purchases.map(p => String(p.code || p.id || '').replace(/\D/g, '')));
  let code = '';
  for (let i = 0; i < 50; i++) {
    code = String(Math.floor(100000 + Math.random() * 900000));
    if (!used.has(code)) return code;
  }
  return String(100000 + (state.purchases.length % 899999));
}

function populatePurchaseCompanySelect(selectedId = '') {
  const sel = $('purCompanySelect');
  if (!sel) return;
  sel.innerHTML = `<option value="">-- اختر الشركة --</option>` + state.companies.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  if (selectedId) sel.value = selectedId;
  onPurchaseCompanyChange();
}

function onPurchaseCompanyChange() {
  const compId = $('purCompanySelect')?.value || '';
  const badge = $('purSelectedCompanyBadge');
  const infoEl = $('purCompanyDebtInfo');
  if (!compId) {
    if (badge) badge.innerHTML = `<i class="fa-solid fa-building"></i>`;
    if (infoEl) infoEl.classList.add('hidden');
    return;
  }
  const comp = state.companies.find(c => c.id === compId);
  if (badge && comp) {
    const initial = comp.name.trim().charAt(0).toUpperCase() || 'ش';
    badge.innerHTML = `<span class="font-bold text-sm">${esc(initial)}</span>`;
  }
  if (infoEl && comp) {
    const currentDebt = getCompanyDebt(comp.id);
    infoEl.textContent = `الشركة: ${comp.name} • الدين الحالي للشركة: ${fmtCur(currentDebt)}`;
    infoEl.classList.remove('hidden');
  }
  updatePurchaseCalc();
}

async function quickAddCompanyForPurchase() {
  const { value: compName } = await Swal.fire({
    title: 'إضافة شركة جديدة',
    input: 'text',
    inputPlaceholder: 'أدخل اسم الشركة',
    showCancelButton: true,
    confirmButtonColor: '#0F5C4E',
    confirmButtonText: 'إضافة واختيار',
    cancelButtonText: 'إلغاء',
    inputValidator: v => !v || !v.trim() ? 'يرجى إدخال اسم الشركة' : null
  });
  if (!compName) return;
  const newComp = {
    id: 'comp_' + Date.now(),
    name: compName.trim(),
    phone: '-',
    address: '-',
    distributorName: '-',
    cycle: 'غير محدد',
    products: []
  };
  state.companies.push(newComp);
  logAudit('إضافة شركة من المشتريات', newComp.name);
  const ok = await saveToStorage();
  if (!ok) { state.companies.pop(); return; }
  renderCompaniesGrid();
  populatePurchaseCompanySelect(newComp.id);
  toast(`تمت إضافة الشركة (${newComp.name})`);
}

function openPurchaseModal() {
  $('purPreviewCode').textContent = generateSixDigitPurchaseCode();
  populatePurchaseCompanySelect(state.activeCompanyId || '');
  $('purTotalAmount').value = '';
  $('purPaidAmount').value = '';
  updatePurchaseCalc();
  openModal('purchaseModal');
}

function updatePurchaseCalc() {
  const total = Math.max(0, toNum($('purTotalAmount')?.value));
  const paid = Math.max(0, toNum($('purPaidAmount')?.value));
  const remaining = roundMoney(Math.max(0, total - paid));
  const compId = $('purCompanySelect')?.value || '';
  const currentDebt = compId ? getCompanyDebt(compId) : 0;
  const afterDebt = roundMoney(currentDebt + remaining);
  const info = $('purDebtAfterInfo');
  if (info) {
    info.textContent = `المتبقي (يُضاف إلى دين الشركة): ${fmtCur(remaining)} • دين الشركة بعد الفاتورة: ${fmtCur(afterDebt)}`;
  }
}

async function savePurchase() {
  const companyId = $('purCompanySelect').value;
  const total = toNum($('purTotalAmount').value);
  const paidRaw = $('purPaidAmount').value.trim();
  const paid = paidRaw === '' ? 0 : Math.max(0, toNum(paidRaw));

  if (!companyId) return warn('خطأ', 'اختر الشركة أو أضف شركة جديدة');
  if (!(total > 0)) return warn('خطأ', 'أدخل سعر الفاتورة');

  const comp = state.companies.find(c => c.id === companyId);
  const code = $('purPreviewCode').textContent || generateSixDigitPurchaseCode();
  const remaining = roundMoney(Math.max(0, total - paid));

  const newPurchase = {
    id: code,
    code,
    ts: Date.now(),
    date: nowStr(),
    companyId,
    companyName: comp ? comp.name : 'شركة',
    total,
    paid,
    remaining,
    status: 'active'
  };

  state.purchases.push(newPurchase);
  logAudit('فاتورة شراء', `كود ${code} — ${comp ? comp.name : ''} بقيمة ${fmtCur(total)} (متبقي دين: ${fmtCur(remaining)})`);

  const ok = await saveToStorage();
  if (!ok) { state.purchases.pop(); return; }

  closeModal('purchaseModal');
  renderPurchases();
  renderCompaniesGrid();
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

  const list = [...state.purchases]
    .filter(p => {
      if (p.status === 'cancelled') return false;
      if (filterCompId && p.companyId !== filterCompId) return false;
      if (fromDate || toDate) {
        const k = dayKey(p.ts || 0);
        if (fromDate && k < fromDate) return false;
        if (toDate && k > toDate) return false;
      }
      return true;
    })
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));

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
      <td class="p-3 text-center">
        <button onclick="deletePurchase('${esc(p.id)}')" class="text-rose-500 hover:text-rose-700"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>`;
  }).join('') || `<tr><td colspan="7" class="p-6 text-center text-slate-400 text-sm">لا توجد مشتريات مسجلة</td></tr>`;
}

function deletePurchase(id) {
  Swal.fire({ title: 'حذف فاتورة الشراء؟', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6', confirmButtonText: 'نعم', cancelButtonText: 'إلغاء' }).then(async res => {
    if (!res.isConfirmed) return;
    const removed = state.purchases.find(p => p.id === id);
    state.purchases = state.purchases.filter(p => p.id !== id);
    logAudit('حذف فاتورة شراء', removed ? `كود ${removed.code || removed.id}` : id);
    const ok = await saveToStorage();
    if (!ok) { if (removed) state.purchases.push(removed); return; }
    renderPurchases();
    renderCompaniesGrid();
    toast('تم الحذف');
  });
}

function openCompanyPaymentModal() {
  $('payCompanyAmount').value = '';
  $('payCompanyNotes').value = '';
  openModal('companyPaymentModal');
}

async function recordCompanyPayment() {
  const amount = toNum($('payCompanyAmount').value);
  const notes = $('payCompanyNotes').value.trim();
  if (!(amount > 0)) return warn('خطأ', 'أدخل مبلغاً صحيحاً');

  const comp = state.companies.find(c => c.id === state.activeCompanyId);
  const newPayment = { id: 'CPAY-' + Date.now(), ts: Date.now(), date: nowStr(), companyId: state.activeCompanyId, amount, notes };
  state.companyPayments.push(newPayment);
  logAudit('تسديد لشركة', `${comp ? comp.name : ''} — مبلغ ${fmtCur(amount)}`);

  const ok = await saveToStorage();
  if (!ok) { state.companyPayments.pop(); return; }
  closeModal('companyPaymentModal');
  openCompanyDetailPage(state.activeCompanyId);
  toast('تم تسجيل الدفعة');
}

/* ==================== Person Debts ==================== */
function renderPersonDebts() {
  $('personDebtsTableBody').innerHTML = state.personDebts.map(d => `
    <tr class="hover:bg-slate-50 border-b border-slate-100">
      <td class="p-3 font-bold text-slate-800">${esc(d.name)}</td>
      <td class="p-3 text-slate-600">${esc(d.phone)}</td>
      <td class="p-3 font-bold ${d.type === 'take' ? 'text-rose-600' : 'text-emerald-700'}">${fmtCur(d.amount)}</td>
      <td class="p-3"><span class="px-2 py-0.5 rounded text-xs font-bold ${d.type === 'take' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-800'}">${d.type === 'take' ? 'دين لي (على الشخص)' : 'دين عليّ (أنا مدين)'}</span></td>
      <td class="p-3 text-slate-500">${esc(d.notes)}</td>
      <td class="p-3 text-center">
        <button onclick="deletePersonDebt('${esc(d.id)}')" class="text-rose-500 hover:text-rose-700"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>`).join('') || `<tr><td colspan="6" class="p-6 text-center text-slate-400 text-sm">لا توجد ديون مسجلة</td></tr>`;
}

function openPersonDebtModal() {
  $('debtPersonName').value = '';
  $('debtPersonPhone').value = '';
  $('debtPersonAmount').value = '';
  $('debtPersonNotes').value = '';
  openModal('personDebtModal');
}

async function savePersonDebt() {
  const name = $('debtPersonName').value.trim();
  const phone = $('debtPersonPhone').value.trim();
  const type = $('debtPersonType').value;
  const amount = toNum($('debtPersonAmount').value);
  const notes = $('debtPersonNotes').value.trim();
  if (!name) return warn('خطأ', 'أدخل اسم الشخص');
  if (!(amount > 0)) return warn('خطأ', 'أدخل مبلغاً صحيحاً');

  const newDebt = { id: 'DEBT-' + Date.now(), ts: Date.now(), name, phone, type, amount, notes };
  state.personDebts.push(newDebt);
  logAudit('دين شخصي', `${name} - ${fmtCur(amount)}`);
  const ok = await saveToStorage();
  if (!ok) { state.personDebts.pop(); return; }
  closeModal('personDebtModal');
  renderPersonDebts();
  toast('تم الحفظ');
}

function deletePersonDebt(id) {
  Swal.fire({ title: 'حذف الدين؟', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6', confirmButtonText: 'نعم', cancelButtonText: 'إلغاء' }).then(async res => {
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

/* ==================== Invoices, Filters & Expenses ==================== */
function renderInvoicesTable() {
  const query = normalizeArabic(($('invoiceSearchInput')?.value || '').trim());
  const statusFilter = $('invoiceStatusFilter')?.value || 'all';
  const fromDate = $('invoiceFromDate')?.value || '';
  const toDate = $('invoiceToDate')?.value || '';

  const invRows = state.invoices.map(inv => {
    const payKind = inv.status === 'cancelled'
      ? 'cancelled'
      : (toNum(inv.remaining) > 0 ? (toNum(inv.paid) > 0 ? 'partial' : 'debt') : 'cash');
    return {
      kind: 'invoice',
      id: inv.id,
      ts: inv.ts || 0,
      date: inv.date,
      clientName: inv.clientName,
      total: toNum(inv.total),
      paid: toNum(inv.paid),
      remaining: toNum(inv.remaining),
      profit: toNum(inv.profit),
      status: inv.status,
      filterCategory: payKind
    };
  });

  const directRows = state.directSales.map(ds => ({
    kind: 'direct',
    id: ds.id,
    ts: ds.ts || 0,
    date: ds.date,
    clientName: `بيع سريع (${ds.qty} × ${ds.name})`,
    total: toNum(ds.total),
    paid: toNum(ds.paid != null ? ds.paid : ds.total),
    remaining: toNum(ds.remaining || 0),
    profit: toNum(ds.profit),
    status: 'direct',
    filterCategory: 'cash'
  }));

  const noInvRows = state.noInvoiceItems.map(ni => ({
    kind: 'no_invoice',
    id: ni.id,
    ts: ni.ts || 0,
    date: ni.date,
    clientName: `بدون فاتورة (${ni.qty} × ${ni.name} — ${ni.note})`,
    total: toNum(ni.total),
    paid: 0,
    remaining: 0,
    profit: 0,
    status: 'no_invoice',
    filterCategory: 'no_invoice'
  }));

  const list = [...invRows, ...directRows, ...noInvRows]
    .filter(row => {
      if (statusFilter !== 'all' && row.filterCategory !== statusFilter) return false;
      if (fromDate || toDate) {
        const k = dayKey(row.ts || 0);
        if (fromDate && k < fromDate) return false;
        if (toDate && k > toDate) return false;
      }
      if (query && !(normalizeArabic(row.id).includes(query) || normalizeArabic(row.clientName).includes(query))) return false;
      return true;
    })
    .sort((a, b) => b.ts - a.ts);

  const activeSalesRows = list.filter(r => r.status !== 'cancelled' && r.kind !== 'no_invoice');
  const totalSales = sumList(activeSalesRows, r => r.total);
  const totalProfit = sumList(activeSalesRows, r => r.profit);
  const totalRemaining = sumList(activeSalesRows, r => r.remaining);

  if ($('invoicesSummaryStrip')) {
    $('invoicesSummaryStrip').innerHTML = `
      <div class="bg-slate-50 border rounded-xl p-2"><span class="block text-xs text-slate-500">عدد السجلات</span><span class="font-bold text-slate-800">${fmt(list.length)}</span></div>
      <div class="bg-blue-50 border border-blue-200 rounded-xl p-2"><span class="block text-xs text-blue-700">إجمالي المبيعات</span><span class="font-bold text-blue-900">${fmtCur(totalSales)}</span></div>
      <div class="bg-indigo-50 border border-indigo-200 rounded-xl p-2"><span class="block text-xs text-indigo-700">الربح</span><span class="font-bold text-indigo-900">${fmtCur(totalProfit)}</span></div>
      <div class="bg-rose-50 border border-rose-200 rounded-xl p-2"><span class="block text-xs text-rose-700">المتبقي (ديون)</span><span class="font-bold text-rose-700">${fmtCur(totalRemaining)}</span></div>`;
  }

  $('invoicesTableBody').innerHTML = list.map(row => {
    if (row.kind === 'no_invoice') {
      return `<tr class="hover:bg-slate-50 border-b border-slate-100 bg-slate-50/60">
        <td class="p-3 text-slate-700 font-bold">${esc(row.id)}</td>
        <td class="p-3 text-slate-500 whitespace-nowrap">${esc(row.date)}</td>
        <td class="p-3 text-slate-800">${esc(row.clientName)}</td>
        <td class="p-3 text-slate-600">${fmtCur(row.total)}</td>
        <td class="p-3 text-slate-400">—</td>
        <td class="p-3 text-slate-400">—</td>
        <td class="p-3 text-slate-400">—</td>
        <td class="p-3"><span class="px-2 py-0.5 rounded text-[11px] font-bold bg-slate-200 text-slate-800">بدون فاتورة</span></td>
        <td class="p-3 text-center whitespace-nowrap"><button onclick="deleteNoInvoiceItem('${esc(row.id)}')" class="text-rose-600 hover:underline font-bold"><i class="fa-solid fa-trash"></i></button></td>
      </tr>`;
    }
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
    const statusClass = cancelled
      ? 'bg-rose-100 text-rose-700'
      : (row.filterCategory === 'debt' ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-800');

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
}

function deleteDirectSale(id) {
  Swal.fire({ title: 'حذف سجل البيع السريع؟', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6', confirmButtonText: 'نعم', cancelButtonText: 'إلغاء' }).then(async res => {
    if (!res.isConfirmed) return;
    const removed = state.directSales.find(d => d.id === id);
    state.directSales = state.directSales.filter(d => d.id !== id);
    logAudit('حذف بيع سريع', removed ? `${removed.name} (${fmtCur(removed.total)})` : id);
    const ok = await saveToStorage();
    if (!ok) { if (removed) state.directSales.push(removed); return; }
    renderAll();
    toast('تم الحذف');
  });
}

function deleteNoInvoiceItem(id) {
  Swal.fire({ title: 'حذف السجل؟', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6', confirmButtonText: 'نعم', cancelButtonText: 'إلغاء' }).then(async res => {
    if (!res.isConfirmed) return;
    const removed = state.noInvoiceItems.find(d => d.id === id);
    state.noInvoiceItems = state.noInvoiceItems.filter(d => d.id !== id);
    logAudit('حذف سجل بدون فاتورة', removed ? removed.name : id);
    const ok = await saveToStorage();
    if (!ok) { if (removed) state.noInvoiceItems.push(removed); return; }
    renderAll();
    toast('تم الحذف');
  });
}

function viewPastInvoice(id) {
  const inv = state.invoices.find(i => i.id === id);
  if (inv) showReceiptModal(inv);
}

function cancelInvoice(id) {
  const inv = state.invoices.find(i => i.id === id);
  if (!inv || inv.status === 'cancelled') return;
  Swal.fire({ title: 'إلغاء الفاتورة؟', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6', confirmButtonText: 'نعم', cancelButtonText: 'تراجع' }).then(async res => {
    if (!res.isConfirmed) return;
    inv.status = 'cancelled';
    inv.cancelledAt = Date.now();
    logAudit('إلغاء فاتورة', `${inv.id} (${inv.clientName} — ${fmtCur(inv.total)})`);
    const ok = await saveToStorage();
    if (!ok) { inv.status = 'active'; delete inv.cancelledAt; return; }
    renderAll();
    toast('أُلغيت الفاتورة');
  });
}

function openExpenseModal() {
  $('expTitle').value = '';
  $('expAmount').value = '';
  $('expNotes').value = '';
  openModal('expenseModal');
}
async function saveExpense() {
  const title = $('expTitle').value.trim();
  const amount = toNum($('expAmount').value);
  const notes = $('expNotes').value.trim() || '-';
  if (!title || !(amount > 0)) return warn('خطأ', 'أدخل البند والمبلغ');
  const newExp = { id: 'EXP-' + Date.now(), ts: Date.now(), date: nowStr(), title, amount, notes };
  state.expenses.push(newExp);
  logAudit('مصروف', `${title} ${fmtCur(amount)}`);
  const ok = await saveToStorage();
  if (!ok) { state.expenses.pop(); return; }
  closeModal('expenseModal');
  renderAll();
  toast('تم التسجيل');
}
function deleteExpense(id) {
  Swal.fire({ title: 'حذف المصروف؟', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6', confirmButtonText: 'نعم', cancelButtonText: 'إلغاء' }).then(async res => {
    if (!res.isConfirmed) return;
    const removed = state.expenses.find(e => e.id === id);
    state.expenses = state.expenses.filter(e => e.id !== id);
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

/* ==================== Reports & Settings ==================== */
let lastReport = null;
function setReportRange(days) {
  const to = new Date(), from = new Date();
  if (days > 0) from.setDate(from.getDate() - days + 1);
  $('repFrom').value = dayKey(from.getTime());
  $('repTo').value = dayKey(to.getTime());
  renderReports();
}
function renderReports() {
  if (!$('repFrom').value) setReportRange(0);
  const from = $('repFrom').value, to = $('repTo').value;
  const inRange = ts => { if (!ts) return false; const k = dayKey(ts); return k >= from && k <= to; };
  const invs = state.invoices.filter(i => i.status === 'active' && inRange(i.ts));
  const dsList = state.directSales.filter(d => inRange(d.ts));
  const exps = state.expenses.filter(e => inRange(e.ts));

  const sales = roundMoney(sumList(invs, i => i.total) + sumList(dsList, d => d.total));
  const profit = roundMoney(sumList(invs, i => i.profit) + sumList(dsList, d => d.profit));
  const expTotal = sumList(exps, e => e.amount);

  const card = (label, value, color) => `<div class="bg-${color}-50 border border-${color}-200 rounded-xl p-3"><span class="block text-xs text-${color}-700">${label}</span><span class="text-sm font-bold text-${color}-900">${value}</span></div>`;
  $('reportCards').innerHTML =
    card('الفواتير + بيع سريع', `${fmt(invs.length)} + ${fmt(dsList.length)}`, 'emerald') +
    card('المبيعات', fmtCur(sales), 'blue') +
    card('إجمالي الربح', fmtCur(profit), 'indigo') +
    card('المصاريف', fmtCur(expTotal), 'purple');

  const map = {};
  invs.forEach(i => i.items.forEach(it => {
    const k = normalizeArabic(it.name);
    if (!map[k]) map[k] = { name: it.name, qty: 0, rev: 0 };
    map[k].qty = roundMoney(map[k].qty + toNum(it.qty));
    map[k].rev = roundMoney(map[k].rev + toNum(it.total));
  }));
  dsList.forEach(d => {
    const k = normalizeArabic(d.name);
    if (!map[k]) map[k] = { name: d.name, qty: 0, rev: 0 };
    map[k].qty = roundMoney(map[k].qty + toNum(d.qty));
    map[k].rev = roundMoney(map[k].rev + toNum(d.total));
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
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `report_${r.from}_${r.to}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
function renderAuditLog() {
  $('auditLogBody').innerHTML = state.auditLog.slice(0, 80).map(l => `<tr class="border-b border-slate-100"><td class="p-2 text-slate-400 whitespace-nowrap">${esc(l.date)}</td><td class="p-2 font-bold text-ashour">${esc(l.type)}</td><td class="p-2 text-slate-800">${esc(l.details)}</td><td class="p-2 text-emerald-700 font-bold whitespace-nowrap">${esc(l.status || '')}</td></tr>`).join('') || `<tr><td colspan="4" class="p-4 text-center text-slate-400">لا حركات</td></tr>`;
}

function loadStoreInfoToSettings() {
  $('setStoreName').value = state.storeInfo.name || '';
  $('setStorePhone').value = state.storeInfo.phone || '';
  $('setStoreAddress').value = state.storeInfo.address || '';
  $('headerStoreName').textContent = state.storeInfo.name || 'مركز عاشور للتجارة';
}
async function saveStoreSettings() {
  const prev = { ...state.storeInfo };
  state.storeInfo = {
    name: $('setStoreName').value.trim() || 'مركز عاشور للتجارة',
    phone: $('setStorePhone').value.trim(),
    address: $('setStoreAddress').value.trim()
  };
  logAudit('تعديل الإعدادات', 'تحديث بيانات المتجر');
  const ok = await saveToStorage();
  if (!ok) { state.storeInfo = prev; return; }
  loadStoreInfoToSettings();
  toast('حُفظت البيانات');
}
async function changePinCode() {
  const oldPin = $('oldPinInput').value;
  const newPin = $('newPinInput').value;
  if (!newPin || newPin.length < 4 || newPin.length > 6 || !/^\d+$/.test(newPin)) return warn('خطأ', 'الرمز من 4 إلى 6 أرقام');
  if (await hashPin(oldPin, state.pinSalt) !== state.pinHash) return warn('خطأ', 'الرمز الحالي غير صحيح', 'error');
  const prevHash = state.pinHash, prevLen = state.pinLength;
  state.pinHash = await hashPin(newPin, state.pinSalt);
  state.pinLength = newPin.length;
  logAudit('تغيير PIN', 'تم تغيير رمز الحماية');
  const ok = await saveToStorage();
  if (!ok) { state.pinHash = prevHash; state.pinLength = prevLen; return; }
  $('oldPinInput').value = '';
  $('newPinInput').value = '';
  toast('تم تغيير PIN');
}
async function refreshStorageStatus() {
  const el = $('storageStatus');
  if (!el) return;
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
  if (res.ok) {
    Swal.fire({ icon: 'success', title: 'الذاكرة قوية جداً!', html: `نجح الاختبار.<br>الحجم المكتوب: <b>${res.sizeKB} KB</b><br>الزمن: <b>${res.ms} ms</b>`, confirmButtonColor: '#0F5C4E' });
  } else {
    Swal.fire({ icon: 'error', title: 'فشل الاختبار', text: res.error || 'الذاكرة ممتلئة.', confirmButtonColor: '#d33' });
  }
  refreshStorageStatus();
}
async function exportDataBackup() {
  const snapshot = JSON.parse(JSON.stringify(state));
  delete snapshot.pinHash; delete snapshot.pinAttempts; delete snapshot.pinLockUntil;
  const a = document.createElement('a');
  a.href = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(snapshot, null, 2));
  a.download = `Ashour_Backup_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast('تم تصدير النسخة');
}
function importDataBackup(ev) {
  const file = ev.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const incoming = JSON.parse(e.target.result);
      if (!Array.isArray(incoming.products) || !Array.isArray(incoming.clients)) throw new Error('bad');
      Swal.fire({ title: 'استعادة البيانات؟', text: 'ستُستبدل البيانات الحالية.', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6', confirmButtonText: 'نعم', cancelButtonText: 'إلغاء' }).then(async res => {
        if (!res.isConfirmed) return;
        const keepPin = state.pinHash, keepLen = state.pinLength, keepSalt = state.pinSalt;
        state = Object.assign(defaultState(), incoming);
        ['returns', 'directSales', 'noInvoiceItems', 'companies', 'payments', 'expenses', 'invoices', 'purchases', 'companyPayments', 'personDebts'].forEach(k => {
          if (!Array.isArray(state[k])) state[k] = [];
        });
        state.pinHash = keepPin; state.pinLength = keepLen || 4; state.pinSalt = keepSalt || state.pinSalt; state.cart = [];
        const ok = await saveToStorage();
        if (!ok) return;
        refreshCategoryWidgets();
        initPOSCategories();
        renderAll();
        Swal.fire({ icon: 'success', title: 'تمت الاستعادة', confirmButtonColor: '#0F5C4E' });
      });
    } catch (_) {
      warn('ملف غير صالح', 'النسخة تالفة.', 'error');
    } finally {
      ev.target.value = '';
    }
  };
  reader.readAsText(file);
}

/* ==================== Receipt & WhatsApp Sharing ==================== */
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

  if (toNum(inv.discount) > 0) {
    $('recDiscountRow').classList.remove('hidden');
    $('recDiscount').textContent = fmtCur(inv.discount);
  } else $('recDiscountRow').classList.add('hidden');

  $('recTotal').textContent = fmtCur(inv.total);
  $('recPaidRow').classList.toggle('hidden', !hasDebt && change <= 0);
  $('recRemainingRow').classList.toggle('hidden', !hasDebt);
  $('recTotalDebtRow').classList.toggle('hidden', !hasDebt);
  $('recChangeRow').classList.toggle('hidden', !(change > 0));

  if (hasDebt || change > 0) $('recPaid').textContent = fmtCur(inv.paid);
  if (hasDebt) {
    $('recRemaining').textContent = fmtCur(inv.remaining);
    $('recTotalClientDebt').textContent = fmtCur(totalDebt);
  }
  if (change > 0) $('recChange').textContent = fmtCur(change);

  openModal('receiptModal');
}

function shareReceiptWhatsApp() {
  const inv = state.currentReceiptInv;
  if (!inv) return;
  const lines = [
    `*${state.storeInfo.name || 'مركز عاشور للتجارة'}*`,
    `رقم الفاتورة: #${inv.id}`,
    `التاريخ: ${inv.date}`,
    `الزبون: ${inv.clientName}`,
    `التسعيرة: ${inv.priceMode || 'تجزئة'}`,
    `--------------------`,
    ...inv.items.map(i => `• ${i.name} (${fmt(i.qty)} × ${fmt(i.price)}) = ${fmtCur(i.total)}`),
    `--------------------`,
    ...(toNum(inv.discount) > 0 ? [`الخصم: ${fmtCur(inv.discount)}`] : []),
    `الإجمالي: *${fmtCur(inv.total)}*`,
    `المدفوع: ${fmtCur(inv.paid)}`,
    ...(toNum(inv.remaining) > 0 ? [`المتبقي: *${fmtCur(inv.remaining)}*`] : []),
    ...(toNum(inv.changeGiven) > 0 ? [`الباقي للزبون: ${fmtCur(inv.changeGiven)}`] : [])
  ];
  window.open(`https://wa.me/?text=${encodeURIComponent(lines.join('\n'))}`, '_blank');
}

async function generateReceiptCanvas() {
  if (typeof html2canvas === 'undefined') throw new Error('مكتبة html2canvas غير محملة');
  const el = $('printableReceipt');
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  return await html2canvas(el, { scale: 4, backgroundColor: '#ffffff', useCORS: true, allowTaint: true });
}
async function saveReceiptAsImage() {
  try {
    toast('جاري التجهيز...', 'info');
    const canvas = await generateReceiptCanvas();
    const link = document.createElement('a');
    const invId = state.currentReceiptInv ? state.currentReceiptInv.id : Date.now();
    link.download = `فاتورة_${invId}.png`;
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    link.remove();
    toast('تم حفظ الفاتورة');
  } catch (_) {
    warn('تنبيه', 'تعذر إنشاء الصورة، استخدم الطباعة.', 'error');
  }
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
        try {
          await navigator.share({ title: `فاتورة ${invId}`, text: `فاتورة من ${state.storeInfo.name}`, files: [file] });
        } catch (shareError) {
          if (shareError.name !== 'AbortError') saveReceiptAsImage();
        }
      } else {
        saveReceiptAsImage();
      }
    }, 'image/png');
  } catch (_) {
    saveReceiptAsImage();
  }
}

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

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    MODAL_IDS.forEach(id => { const el = $(id); if (el && !el.classList.contains('hidden')) closeModal(id); });
    return;
  }
  if (e.key === 'F2') {
    e.preventDefault();
    if (!$('pinOverlay').classList.contains('hidden')) return;
    openDirectSaleModal();
  }
  if (e.key === 'F4') {
    e.preventDefault();
    if (!$('pinOverlay').classList.contains('hidden')) return;
    if (!$('view-pos').classList.contains('hidden')) checkoutPOS();
  }
});

function renderAll() {
  populatePosClients();
  updatePosPriceUI();
  renderPosProducts();
  renderCart();
  renderInvoicesTable();
  renderProductsTable();
  renderClientsGrid();
  renderCompaniesGrid();
  renderExpensesTable();
  renderAuditLog();
  renderPurchases();
  renderPersonDebts();
  if (!$('view-reports').classList.contains('hidden')) renderReports();
}

/* ==================== Init ==================== */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => {}); });
}
window.addEventListener('DOMContentLoaded', async function () {
  await loadFromStorage();
  refreshCategoryWidgets();
  initPOSCategories();
  loadStoreInfoToSettings();
  renderAll();
  setTimeout(() => { const q = $('quickEntryInput'); if (q) q.focus(); }, 300);
});
