/* ==========================================================================
   app.js — عقل التطبيق (النصف الأول)
   ========================================================================== */

const CURRENCY = 'ل.س.ج';
const $ = id => document.getElementById(id);

function toNum(val) { const n = Number(val); return Number.isFinite(n) ? n : 0; }
function roundMoney(val) { return Math.round((toNum(val) + Number.EPSILON) * 100) / 100; }
function calcLineTotal(price, qty) { return roundMoney(toNum(price) * toNum(qty)); }
function sumList(arr, getter) { let t = 0; for (let i = 0; i < arr.length; i++) t = roundMoney(t + toNum(getter(arr[i]))); return t; }
const fmt = n => roundMoney(n).toLocaleString('en-US');
const fmtCur = n => `${fmt(n)} ${CURRENCY}`;
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function normalizeArabic(str) { return String(str || '').toLowerCase().replace(/[أآإٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[\u064b-\u065f]/g, ''); }
function dayKey(ts) { const d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
function nowStr() { return new Date().toLocaleString('ar-SY'); }
const warn = (title, text, icon='warning') => Swal.fire({ icon, title, text, confirmButtonColor:'#0F5C4E' });
const toast = (title, icon='success') => Swal.fire({ toast:true, position:'top-end', icon, title, showConfirmButton:false, timer:1600 });

/* ==================== Constants ==================== */
const DEFAULT_CATEGORIES = ['بسكويت','شيبس','عصائر ومشروبات','سكاكر وعلكة','قهوة','مواد غذائية'];
// تم إزالة الصور نهائياً من المنتجات الافتراضية
const IMPORTED_PRODUCTS = [
  {name:"اربيكا طبيعي صغير",category:"شيبس"}, {name:"اربيكا طبيعي جامبو",category:"شيبس"},
  {name:"تورتيز رقائق كبير 100",category:"شيبس"}, {name:"تورتيز رقائق",category:"شيبس"},
  {name:"سبوكي كبير 100",category:"شيبس"}, {name:"عصير كرتون 20",category:"عصائر ومشروبات"},
  {name:"اوكتبوس كرنشي",category:"شيبس"}, {name:"قهوه سادة موكا 100g",category:"قهوة"},
  {name:"قهوه كلاسيك مع الهال 100g",category:"قهوة"}, {name:"قهوة إكسترا هال 200",category:"قهوة"},
  {name:"قهوة كلاسيك مع هال 200g",category:"قهوة"}, {name:"توب فريش ساور",category:"سكاكر وعلكة"},
  {name:"كب كيك",category:"بسكويت"}, {name:"حنجور شوكالا",category:"بسكويت"},
  {name:"بسكويت ماتيلدا دارك",category:"بسكويت"}, {name:"بسكويت كريمة",category:"بسكويت"},
  {name:"سلسيتو مالح",category:"بسكويت"}, {name:"بسكوت مي تو",category:"بسكويت"},
  {name:"بسكويت تاندا",category:"بسكويت"}, {name:"قهوه اكسترا هال 100g",category:"قهوة"}
];

/* ==================== State ==================== */
let state = {};
function defaultState() {
  return {
    pinHash: null, pinSalt: null, pinLength: 4, pinAttempts: 0, pinLockUntil: 0,
    storeInfo: { name:'مركز عاشور للتجارة', phone:'0991234567', address:'السوق المركزي - صالة الجملة' },
    products: IMPORTED_PRODUCTS.map((p,i) => ({ id: (i+1).toString(), sku: (101+i).toString(), barcode: '', name: p.name, category: p.category, cost: 0, retailPrice: 0, wholesalePrice: 0 })),
    clients: [
      { id:'c1', name:'زبون نقدي مباشر', type:'retail', phone:'-', address:'-', openingDebt:0 },
      { id:'c2', name:'سوبرماركت البركة (موزع)', type:'wholesale', phone:'0998877665', address:'شارع التجارة', openingDebt:150 }
    ],
    invoices: [], expenses: [], payments: [], returns: [], directSales: [],
    companies: [{ id:'comp_1', name:'شركة الشام الغذائية', phone:'0982572810', address:'المدينة الصناعية - دمشق', distributorName:'أبو خالد الموزع', cycle:'كل أسبوع (السبت)', products:[{ id:'cp_1', name:'بسكويت كيكتي علبة', consumerPrice:35 },{ id:'cp_2', name:'بسكويت جنتي', consumerPrice:20 }] }],
    auditLog: [{ ts:Date.now(), date:nowStr(), type:'النظام', details:'بدء تشغيل النظام', status:'مكتمل' }],
    invoiceCounter: 1000,
    cart: [], selectedPosCategory:'الكل', currentLedgerClientId:null, currentReceiptInv:null, activeCompanyId:null
  };
}

async function saveToStorage() {
  const result = await AshourDB.save(state);
  if (!result.ok) {
    Swal.fire({ icon:'error', title:'فشل الحفظ!', html:`تعذّر حفظ البيانات.<br><small>${esc(result.errors.join(' | '))}</small>`, confirmButtonColor:'#d33' });
  }
  return result.ok;
}

let backupTimer = null;
function startAutoBackup() {
  if (backupTimer) clearInterval(backupTimer);
  backupTimer = setInterval(async () => { if (state.products) await AshourDB.saveBackup(state); }, 5 * 60 * 1000);
}

async function loadFromStorage() {
  const result = await AshourDB.load();
  if (result.ok && result.state) state = deepMerge(defaultState(), result.state);
  else state = defaultState();
  
  ['returns','directSales','companies','payments','expenses','invoices','products','clients'].forEach(k => { if (!Array.isArray(state[k])) state[k] = []; });
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

/* ==================== PIN ==================== */
function generateSalt() {
  try { const arr = new Uint8Array(16); crypto.getRandomValues(arr); return Array.from(arr).map(b => b.toString(16).padStart(2,'0')).join(''); }
  catch (_) { return 'salt_' + Date.now() + '_' + Math.random().toString(36).slice(2); }
}

async function hashPin(pin, salt) {
  const txt = String(salt || '') + String(pin);
  try {
    if (window.crypto && crypto.subtle && crypto.subtle.digest) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
    }
  } catch (e) {}
  let h = 5381; for (let i = 0; i < txt.length; i++) h = ((h << 5) + h + txt.charCodeAt(i)) | 0;
  return 'f' + (h >>> 0).toString(16);
}

let enteredPin = '';
function pressPin(n) { const targetLen = state.pinLength || 4; if (enteredPin.length < 6) { enteredPin += n; updatePinDots(); if (enteredPin.length === targetLen) submitPin(); } }
function clearPin() { enteredPin = ''; updatePinDots(); }
function updatePinDots() { document.querySelectorAll('.pin-dot').forEach((d,i) => { d.classList.toggle('bg-ashour', i < enteredPin.length); d.classList.remove('bg-red-500', 'border-red-500'); }); }

async function submitPin() {
  const errEl = $('pinError'); errEl.classList.add('hidden');
  if (state.pinLockUntil && Date.now() < state.pinLockUntil) {
    const secs = Math.ceil((state.pinLockUntil - Date.now()) / 1000);
    errEl.textContent = `محاولات كثيرة. انتظر ${secs} ثانية.`; errEl.classList.remove('hidden'); clearPin(); return;
  }
  const h = await hashPin(enteredPin, state.pinSalt);
  if (h === state.pinHash) {
    $('pinOverlay').classList.add('hidden'); state.pinAttempts = 0;
    await saveToStorage(); clearPin(); resetAutoLock();
    setTimeout(() => { const q = $('quickEntryInput'); if (q) q.focus(); }, 200);
  } else {
    state.pinAttempts = toNum(state.pinAttempts) + 1;
    const dotsContainer = $('pinDots'); dotsContainer.classList.add('animate-shake');
    document.querySelectorAll('.pin-dot').forEach(d => d.classList.add('bg-red-500','border-red-500'));
    setTimeout(() => dotsContainer.classList.remove('animate-shake'), 400);
    if (state.pinAttempts >= 5) { state.pinLockUntil = Date.now() + 30000; state.pinAttempts = 0; errEl.textContent = 'قفل 30 ثانية.'; }
    else errEl.textContent = 'رمز PIN غير صحيح';
    errEl.classList.remove('hidden'); setTimeout(() => clearPin(), 600); await saveToStorage();
  }
}

function lockApp() { $('pinOverlay').classList.remove('hidden'); clearPin(); $('pinError').classList.add('hidden'); }
let autoLockTimer = null, lastActivity = 0;
function resetAutoLock() { const now = Date.now(); if (now - lastActivity < 1500) return; lastActivity = now; clearTimeout(autoLockTimer); autoLockTimer = setTimeout(() => { if ($('pinOverlay').classList.contains('hidden')) lockApp(); }, 300000); }
['click','mousemove','keydown','touchstart'].forEach(ev => document.addEventListener(ev, resetAutoLock, { passive:true }));

function logAudit(type, details) { const entry = { ts: Date.now(), date: nowStr(), type, details, status:'مسجل' }; state.auditLog.unshift(entry); if (state.auditLog.length > 500) state.auditLog.length = 500; AshourDB.addAudit(entry); }

/* ==================== Navigation & Back Button ==================== */
function switchTab(tabId) {
  document.querySelectorAll('.tab-view').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('bg-white/20','active'));
  const view = $('view-' + tabId); if (view) view.classList.remove('hidden');
  const btn = $('tab-' + tabId); if (btn) btn.classList.add('bg-white/20','active');
  if (tabId === 'companies') { state.activeCompanyId = null; $('companyDetailPage').classList.add('hidden'); $('companiesListSection').classList.remove('hidden'); }
  if (tabId === 'settings') { loadStoreInfoToSettings(); refreshStorageStatus(); }
  if (tabId === 'reports') renderReports();
  renderAll();
}

// برمجة زر الرجوع في الهاتف
window.addEventListener('popstate', (e) => {
  // 1. إذا كانت الكاميرا مفتوحة، أغلقها
  if ($('barcodeScannerModal') && !$('barcodeScannerModal').classList.contains('hidden')) {
    closeBarcodeScanner();
    history.pushState(null, null, location.href);
    return;
  }
  // 2. إذا كانت هناك نافذة منبثقة مفتوحة، أغلقها
  const openMod = MODAL_IDS.find(id => $(id) && !$(id).classList.contains('hidden'));
  if (openMod) {
    closeModal(openMod);
    history.pushState(null, null, location.href);
    return;
  }
  // 3. إذا لم نكن في تبويب الكاشير، ارجع للكاشير
  if ($('view-pos').classList.contains('hidden')) {
    switchTab('pos');
    history.pushState(null, null, location.href);
    return;
  }
  // 4. إذا كنا في الكاشير، اسأل هل تريد الخروج
  Swal.fire({
    title: 'هل تريد الخروج من النظام؟',
    text: 'سيتم الخروج من التطبيق بالكامل.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#d33',
    cancelButtonColor: '#3085d6',
    confirmButtonText: 'نعم، خروج',
    cancelButtonText: 'إلغاء'
  }).then((result) => {
    if (result.isConfirmed) {
      history.back(); // يخرج فعلياً
    } else {
      history.pushState(null, null, location.href); // يعيد تفعيل الحماية
    }
  });
});
// تفعيل الحماية عند الدخول لأول مرة
history.pushState(null, null, location.href);

/* ==================== Categories ==================== */
function allCategories() { const set = new Set(DEFAULT_CATEGORIES); state.products.forEach(p => { if (p.category) set.add(p.category); }); return [...set]; }
function refreshCategoryWidgets() {
  const cats = allCategories();
  $('categoryList').innerHTML = cats.map(c => `<option value="${esc(c)}"></option>`).join('');
  $('prodCatDropdownList').innerHTML = `<div onclick="selectProdCat('')" class="p-2.5 hover:bg-gray-100 cursor-pointer text-xs font-bold">جميع الفئات</div>` + cats.map(c => `<div onclick="selectProdCat('${esc(c)}')" class="p-2.5 hover:bg-gray-100 cursor-pointer text-xs font-bold">${esc(c)}</div>`).join('');
  initPOSCategories();
}
function selectProdCat(cat) { $('prodCategoryFilter').value = cat; $('selectedProdCatText').textContent = cat || 'جميع الفئات'; $('prodCatDropdownList').classList.add('hidden'); renderProductsTable(); }
function toggleProdCatDropdown() { $('prodCatDropdownList').classList.toggle('hidden'); }
function getClientDebt(clientId) {
  const c = state.clients.find(x => x.id === clientId); if (!c) return 0;
  return roundMoney(toNum(c.openingDebt) + sumList(state.invoices.filter(i => i.clientId === clientId && i.status === 'active'), i => i.remaining) - sumList(state.payments.filter(p => p.clientId === clientId), p => p.amount) - sumList(state.returns.filter(r => r.clientId === clientId), r => r.amount));
}

/* ==================== POS & Cart ==================== */
function initPOSCategories() {
  const cats = ['الكل', ...allCategories()];
  if (!cats.includes(state.selectedPosCategory)) state.selectedPosCategory = 'الكل';
  const sidebar = $('posCategorySidebar');
  if (sidebar) sidebar.innerHTML = cats.map(cat => {
      const active = state.selectedPosCategory === cat;
      const count = cat === 'الكل' ? state.products.length : state.products.filter(p => p.category === cat).length;
      return `<button onclick="setPosCat('${esc(cat)}')" class="w-full text-right px-2 py-2 rounded-lg transition flex items-center justify-between ${active ? 'bg-ashour text-white shadow-sm' : 'bg-gray-50 text-gray-700 hover:bg-gray-100'}"><span>${esc(cat)}</span><span class="text-[10px] ${active ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'} px-1.5 py-0.5 rounded-full font-black">${count}</span></button>`;
  }).join('');
  const mobileBar = $('posCategoryFilter');
  if (mobileBar) mobileBar.innerHTML = cats.map(cat => `<button onclick="setPosCat('${esc(cat)}')" class="px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition ${state.selectedPosCategory === cat ? 'bg-ashour text-white shadow-sm' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}">${esc(cat)}</button>`).join('');
}
function setPosCat(cat) { state.selectedPosCategory = cat; initPOSCategories(); renderPosProducts(); }
function getSelectedPosClient() { const id = $('posClientSelect').value || (state.clients[0] ? state.clients[0].id : 'c1'); return state.clients.find(c => c.id === id) || state.clients[0] || { id:'c1', name:'زبون نقدي', type:'retail' }; }
function populatePosClients() {
  const filter = ($('posClientSearch').value || '').trim().toLowerCase();
  const list = state.clients.filter(c => !filter || normalizeArabic(c.name).includes(normalizeArabic(filter)) || (c.phone || '').includes(filter));
  const dropdown = $('clientDropdownList');
  dropdown.innerHTML = list.map(c => `<div onclick="selectClient('${esc(c.id)}', '${esc(c.name)}')" class="p-2.5 hover:bg-emerald-50 cursor-pointer text-xs font-bold flex justify-between items-center"><span>${esc(c.name)}</span><span class="text-[10px] text-gray-500">دين: ${fmtCur(getClientDebt(c.id))}</span></div>`).join('');
  if (list.length && !$('posClientSelect').value) selectClient(list[0].id, list[0].name);
}
function selectClient(id, label) { $('posClientSelect').value = id; $('selectedClientText').textContent = label; $('clientDropdownList').classList.add('hidden'); onPosClientChange(); }
function toggleClientDropdown() { $('clientDropdownList').classList.toggle('hidden'); populatePosClients(); }
function onPosClientChange() {
  const client = getSelectedPosClient(), badge = $('posPriceTypeBadge');
  if (client.type === 'wholesale') { badge.textContent = 'موزع (جملة)'; badge.className = 'inline-block bg-amber-100 text-amber-800 text-xs px-2 py-0.5 rounded font-black mt-1'; }
  else { badge.textContent = 'تجزئة (عادي)'; badge.className = 'inline-block bg-emerald-100 text-emerald-800 text-xs px-2 py-0.5 rounded font-black mt-1'; }
  renderPosProducts(); renderCart();
}

function renderPosProducts() {
  const search = normalizeArabic(($('posSearch').value || '').trim());
  const client = getSelectedPosClient();
  const priceKey = client.type === 'wholesale' ? 'wholesalePrice' : 'retailPrice';
  const filtered = state.products.filter(p => {
    const okCat = state.selectedPosCategory === 'الكل' || p.category === state.selectedPosCategory;
    return okCat && (!search || normalizeArabic(p.name).includes(search) || normalizeArabic(p.sku).includes(search) || normalizeArabic(p.barcode).includes(search));
  });
  if (!filtered.length) { $('posProductsGrid').innerHTML = `<div class="col-span-full text-center py-10 text-gray-400 text-sm font-bold">لا توجد منتجات مطابقة</div>`; return; }
  $('posProductsGrid').innerHTML = filtered.map(p => {
    const price = toNum(p[priceKey]);
    return `<div onclick="addToCart('${esc(p.id)}')" class="bg-white border hover:border-ashour cursor-pointer transition flex flex-col justify-between border-gray-200 rounded-xl p-2.5 shadow-sm card-hover animate-fade-slide-up relative group">
      <div><span class="text-[10px] text-ashour font-black block bg-ashour/10 px-1.5 py-0.5 rounded w-fit">${esc(p.sku || '-')}</span><h4 class="font-black text-sm text-gray-800 line-clamp-2 leading-tight mt-1">${esc(p.name)}</h4></div>
      <div class="mt-2 flex items-end justify-between border-t border-gray-100 pt-1.5"><span class="text-sm ${price > 0 ? 'text-ashour font-black' : 'text-red-500 font-bold text-xs'}">${price > 0 ? fmtCur(price) : 'حدد السعر'}</span><div class="w-6 h-6 bg-ashour/10 text-ashour rounded-md flex items-center justify-center group-hover:bg-ashour group-hover:text-white transition"><i class="fa-solid fa-plus text-xs"></i></div></div>
    </div>`;
  }).join('');
}

function handleQuickEntry(ev) {
  if (ev.key !== 'Enter') return;
  const input = ev.target, val = input.value.trim(); if (!val) return;
  let code = val, qty = 1;
  if (val.includes('*')) { const parts = val.split('*'); if (parts.length === 2) { code = parts[0].trim(); qty = parseInt(parts[1].trim(), 10) || 1; } }
  
  // البحث بالباركود أو الكود أو الاسم
  const product = state.products.find(p => String(p.barcode||'') === code || String(p.sku || '') === code || normalizeArabic(p.name).includes(normalizeArabic(code)));
  if (!product) { warn('غير موجود', `لا يوجد منتج مطابق: ${code}`, 'error'); return; }
  
  const client = getSelectedPosClient(), priceKey = client.type === 'wholesale' ? 'wholesalePrice' : 'retailPrice';
  if (!(toNum(product[priceKey]) > 0)) { Swal.fire({ icon:'info', title:'السعر غير محدد', text:`حدّد سعر ${product.name} أولاً.`, confirmButtonColor:'#0F5C4E' }).then(() => openProductModal(product.id)); return; }
  
  const existing = state.cart.find(i => i.productId === product.id && !i.isQuickOnly);
  if (existing) existing.qty = roundMoney(existing.qty + qty); else state.cart.push({ productId: product.id, qty });
  renderCart(); input.value = ''; input.focus(); toast(`تمت إضافة ${qty} × ${product.name}`);
}

function addToCart(productId) {
  const product = state.products.find(p => p.id === productId); if (!product) return;
  const client = getSelectedPosClient(), priceKey = client.type === 'wholesale' ? 'wholesalePrice' : 'retailPrice';
  if (!(toNum(product[priceKey]) > 0)) { Swal.fire({ icon:'info', title:'السعر غير محدد', text:'حدد السعر أولاً.', confirmButtonColor:'#0F5C4E' }).then(() => openProductModal(productId)); return; }
  const existing = state.cart.find(i => i.productId === productId && !i.isQuickOnly);
  if (existing) existing.qty = roundMoney(existing.qty + 1); else state.cart.push({ productId, qty: 1 });
  renderCart();
}

function updateCartQty(key, delta) {
  const item = state.cart.find(i => (i.quickId || i.productId) === key); if (!item) return;
  const newQty = roundMoney(toNum(item.qty) + toNum(delta));
  if (newQty <= 0) state.cart = state.cart.filter(i => (i.quickId || i.productId) !== key); else item.qty = newQty;
  renderCart();
}
function addQtyToLast(n) { if (!state.cart.length) return; const last = state.cart[state.cart.length - 1]; updateCartQty(last.quickId || last.productId, n); }
function multiplyLastQty(f) { if (!state.cart.length) return; state.cart[state.cart.length - 1].qty = roundMoney(toNum(state.cart[state.cart.length - 1].qty) * toNum(f)); renderCart(); }
function clearCart() { state.cart = []; $('posDiscount').value = ''; renderCart(); }

function getCartItemInfo(item, priceKey) {
  if (item.isQuickOnly) return { key: item.quickId, productId: item.quickId, name: item.name, unitPrice: toNum(item.price), unitCost: 0, isQuickOnly: true };
  const p = state.products.find(x => x.id === item.productId); if (!p) return null;
  return { key: p.id, productId: p.id, name: p.name, unitPrice: toNum(p[priceKey]), unitCost: toNum(p.cost), isQuickOnly: false };
}
function cartTotals() {
  const client = getSelectedPosClient(), priceKey = client.type === 'wholesale' ? 'wholesalePrice' : 'retailPrice';
  let subtotal = 0, cost = 0;
  state.cart.forEach(item => { const info = getCartItemInfo(item, priceKey); if (!info) return; subtotal = roundMoney(subtotal + calcLineTotal(info.unitPrice, item.qty)); cost = roundMoney(cost + calcLineTotal(info.unitCost, item.qty)); });
  const discount = Math.max(0, Math.min(toNum($('posDiscount').value), subtotal));
  return { subtotal, discount, total: roundMoney(subtotal - discount), cost, priceKey };
}
function renderCart() {
  const container = $('cartItemsList'), { subtotal, total, priceKey } = cartTotals();
  if (!state.cart.length) container.innerHTML = `<div class="text-center py-12 text-gray-400"><i class="fa-solid fa-basket-shopping text-4xl mb-2 opacity-40"></i><p class="text-xs font-bold">السلة فارغة.</p></div>`;
  else {
    container.innerHTML = state.cart.map(item => {
      const info = getCartItemInfo(item, priceKey); if (!info) return '';
      return `<div class="py-2 flex items-center justify-between gap-2"><div class="flex-grow min-w-0"><h5 class="font-bold text-xs text-gray-800 truncate">${esc(info.name)}</h5><span class="text-[10px] text-gray-500 font-bold">${fmt(info.unitPrice)} × ${item.qty}</span></div><div class="flex items-center gap-1"><button onclick="updateCartQty('${esc(info.key)}', -1)" class="w-6 h-6 bg-gray-200 hover:bg-red-500 hover:text-white rounded text-xs font-black">−</button><span class="w-7 text-center text-xs font-black">${item.qty}</span><button onclick="updateCartQty('${esc(info.key)}', 1)" class="w-6 h-6 bg-gray-200 hover:bg-ashour hover:text-white rounded text-xs font-black">+</button></div><div class="text-left font-black text-xs text-ashour min-w-[75px]">${fmtCur(calcLineTotal(info.unitPrice, item.qty))}</div></div>`;
    }).join('');
  }
  $('cartSubtotal').textContent = fmtCur(subtotal);
  const totalEl = $('cartTotal'); totalEl.textContent = fmtCur(total);
  totalEl.classList.remove('total-flash'); void totalEl.offsetWidth; totalEl.classList.add('total-flash');
  $('posPaidAmount').placeholder = `الكل (${fmt(total)})`;
}
function setPaidExact() { $('posPaidAmount').value = cartTotals().total; }
function setPaidAmount(amt) { $('posPaidAmount').value = amt; }
function repeatLastInvoice() {
  const client = getSelectedPosClient(); const last = [...state.invoices].reverse().find(i => i.clientId === client.id && i.status === 'active');
  if (!last) return warn('لا توجد فواتير', 'لا توجد فواتير سابقة لهذا الزبون', 'info');
  state.cart = last.items.filter(it => it.isQuickOnly || state.products.some(p => p.id === it.productId)).map(it => it.isQuickOnly ? { isQuickOnly:true, quickId:'q_' + Date.now() + '_' + Math.random().toString(36).slice(2,5), name:it.name, price:toNum(it.price), qty:toNum(it.qty) } : { productId:it.productId, qty:toNum(it.qty) });
  renderCart(); toast('تم نسخ آخر فاتورة');
}

function nextInvoiceNumber() { state.invoiceCounter = toNum(state.invoiceCounter || 1000) + 1; return 'INV-' + state.invoiceCounter; }

async function checkoutPOS() {
  if (!state.cart.length) return warn('السلة فارغة', 'أضف منتجات أولاً');
  const client = getSelectedPosClient(), { total, discount, cost, priceKey } = cartTotals();
  for (const item of state.cart) { const info = getCartItemInfo(item, priceKey); if (!info) return warn('منتج محذوف', 'أزل المنتجات المحذوفة من السلة', 'error'); if (!(info.unitPrice > 0)) return warn('سعر غير محدد', info.name, 'error'); }
  
  const paidRaw = $('posPaidAmount').value.trim(), paidInput = paidRaw === '' ? total : toNum(paidRaw);
  const paid = roundMoney(Math.min(Math.max(paidInput, 0), total)), remaining = roundMoney(total - paid);
  const items = state.cart.map(item => { const info = getCartItemInfo(item, priceKey); return { productId:info.productId, name:info.name, qty:toNum(item.qty), price:info.unitPrice, total:calcLineTotal(info.unitPrice, item.qty), isQuickOnly:info.isQuickOnly }; });
  
  const inv = { id: nextInvoiceNumber(), ts: Date.now(), date: nowStr(), clientId: client.id, clientName: client.name, paymentType: remaining > 0 ? (paid > 0 ? 'partial' : 'debt') : 'cash', items, discount, total, paid, remaining, profit: roundMoney(total - cost), status: 'active' };
  
  const previousCart = [...state.cart], previousCounter = state.invoiceCounter - 1, previousInvoices = [...state.invoices];
  state.invoices.push(inv);
  logAudit('بيع فاتورة', `فاتورة ${inv.id} للزبون ${client.name} بمبلغ ${fmtCur(total)}`);
  
  const ok = await saveToStorage();
  if (!ok) { state.invoices = previousInvoices; state.invoiceCounter = previousCounter; state.cart = previousCart; renderCart(); return; }
  
  showReceiptModal(inv); state.cart = []; $('posPaidAmount').value = ''; $('posDiscount').value = ''; renderAll(); toast('تم حفظ الفاتورة');
}

/* ==================== Barcode Scanner (Camera) ==================== */
let html5QrCode = null;
let currentScanTarget = 'quickEntryInput';

function openBarcodeScanner(targetId = 'quickEntryInput') {
  currentScanTarget = targetId;
  const modal = $('barcodeScannerModal');
  const reader = $('barcode-reader');
  
  // إظهار النافذة
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  
  // تشغيل الكاميرا
  html5QrCode = new Html5Qrcode("barcode-reader");
  html5QrCode.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: { width: 250, height: 150 } },
    (decodedText, decodedResult) => {
      // نجاح المسح
      handleBarcodeScanSuccess(decodedText);
    },
    (errorMessage) => {
      // تجاهل الأخطاء أثناء البحث
    }
  ).catch(err => {
    warn('خطأ', 'تعذر تشغيل الكاميرا. تأكد من إعطاء الإذن للمتصفح.', 'error');
    closeBarcodeScanner();
  });
}

async function handleBarcodeScanSuccess(decodedText) {
  // إيقاف الكاميرا فوراً
  if (html5QrCode) {
    try { await html5QrCode.stop(); await html5QrCode.clear(); } catch(e){}
  }
  
  // إغلاق النافذة
  $('barcodeScannerModal').classList.add('hidden');
  $('barcodeScannerModal').style.display = 'none';

  // إذا كان المسح لإضافة منتج جديد (حقل الباركود)
  if (currentScanTarget === 'prodBarcodeInput') {
    $('prodBarcodeInput').value = decodedText;
    toast('تم قراءة الباركود بنجاح');
    return;
  }
  
  // إذا كان المسح للكاشير (إضافة منتج)
  if (currentScanTarget === 'quickEntryInput') {
    const input = $('quickEntryInput');
    input.value = decodedText;
    // استدعاء دالة الإضافة التلقائية
    handleQuickEntry({ key: 'Enter', target: input });
  }
}

async function closeBarcodeScanner() {
  if (html5QrCode) {
    try { await html5QrCode.stop(); await html5QrCode.clear(); } catch(e){}
    html5QrCode = null;
  }
  const modal = $('barcodeScannerModal');
  modal.classList.add('hidden');
  modal.style.display = 'none';
}
/* ==================== Direct Sale ==================== */
function openDirectSaleModal() {
  $('dsName').value = ''; $('dsPrice').value = ''; $('dsQty').value = '1'; $('dsNote').value = '';
  openModal('directSaleModal');
}
async function saveDirectSale() {
  const name = $('dsName').value.trim(), price = toNum($('dsPrice').value), qty = parseInt($('dsQty').value, 10) || 1, note = $('dsNote').value.trim();
  if (!name) return warn('خطأ', 'أدخل اسم الصنف');
  if (price <= 0) return warn('خطأ', 'أدخل سعراً صحيحاً');
  if (qty <= 0) return warn('خطأ', 'أدخل عدداً صحيحاً');
  const total = calcLineTotal(price, qty);
  const newSale = { id:'QS-' + Date.now(), ts:Date.now(), date:nowStr(), name, price, qty, total, profit: total, note };
  state.directSales.push(newSale); logAudit('بيع سريع', `${qty} × ${name} بقيمة ${fmtCur(total)}`);
  const ok = await saveToStorage(); if (!ok) { state.directSales.pop(); return; }
  closeModal('directSaleModal'); renderAll(); toast(`تم تسجيل ${qty} × ${name}`);
}

/* ==================== Products ==================== */
function generateUniqueSku() {
  const existing = new Set(state.products.map(p => String(p.sku || '').trim()));
  let num = Math.max(200, 101 + state.products.length);
  while (existing.has(String(num))) num++;
  return String(num);
}
function setAutoGeneratedSku() { $('prodSkuInput').value = generateUniqueSku(); }

function renderProductsTable() {
  const search = normalizeArabic(($('prodSearch').value || '').trim()), cat = $('prodCategoryFilter').value;
  const list = state.products.filter(p => (!cat || p.category === cat) && (!search || normalizeArabic(p.name).includes(search) || normalizeArabic(p.sku).includes(search) || normalizeArabic(p.barcode).includes(search)));
  if ($('prodCountBadge')) $('prodCountBadge').textContent = list.length;
  $('productsTableBody').innerHTML = list.map(p => `
    <tr class="hover:bg-gray-50 border-b border-gray-100">
      <td class="p-3 text-ashour font-black">${esc(p.sku || '-')} <br><span class="text-[10px] text-gray-500 font-normal">${esc(p.barcode || '')}</span></td>
      <td class="p-3 font-black text-indigo-700">${esc(p.name)}</td>
      <td class="p-3"><span class="bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-[10px]">${esc(p.category || '-')}</span></td>
      <td class="p-3 text-gray-600">${fmt(p.cost)}</td>
      <td class="p-3 text-emerald-800">${fmt(p.retailPrice)}</td>
      <td class="p-3 text-amber-800">${fmt(p.wholesalePrice)}</td>
      <td class="p-3 text-center"><div class="flex justify-center gap-1">
        <button onclick="openProductModal('${esc(p.id)}')" class="bg-indigo-100 text-indigo-700 hover:bg-indigo-600 hover:text-white px-2.5 py-1 rounded transition text-xs font-bold"><i class="fa-solid fa-pen"></i></button>
        <button onclick="deleteProduct('${esc(p.id)}')" class="bg-red-100 text-red-700 hover:bg-red-600 hover:text-white px-2.5 py-1 rounded transition text-xs font-bold"><i class="fa-solid fa-trash"></i></button>
      </div></td>
    </tr>`).join('') || `<tr><td colspan="7" class="p-6 text-center text-gray-400 text-sm">لا توجد منتجات</td></tr>`;
}

function openProductModal(prodId = null) {
  $('prodEditId').value = prodId || '';
  if (prodId) {
    const p = state.products.find(x => x.id === prodId); if (!p) return;
    $('productModalTitle').textContent = 'تعديل منتج';
    $('prodSkuInput').value = p.sku || ''; $('prodBarcodeInput').value = p.barcode || ''; $('prodNameInput').value = p.name || ''; $('prodCatInput').value = p.category || '';
    $('prodCostInput').value = toNum(p.cost); $('prodRetailInput').value = toNum(p.retailPrice); $('prodWholesaleInput').value = toNum(p.wholesalePrice);
  } else {
    $('productModalTitle').textContent = 'إضافة منتج جديد';
    $('prodSkuInput').value = generateUniqueSku(); $('prodBarcodeInput').value = ''; $('prodNameInput').value = ''; $('prodCatInput').value = '';
    $('prodCostInput').value = ''; $('prodRetailInput').value = ''; $('prodWholesaleInput').value = '';
  }
  openModal('productModal');
}

async function saveProduct() {
  const editId = $('prodEditId').value; let sku = $('prodSkuInput').value.trim();
  const barcode = $('prodBarcodeInput').value.trim(), name = $('prodNameInput').value.trim(), category = $('prodCatInput').value.trim() || 'مواد غذائية';
  const cost = toNum($('prodCostInput').value), retailPrice = toNum($('prodRetailInput').value), wholesalePrice = toNum($('prodWholesaleInput').value);
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
    const p = state.products.find(x => x.id === editId); if (!p) return;
    previous = { ...p }; Object.assign(p, { sku, barcode, name, category, cost, retailPrice, wholesalePrice }); logAudit('تعديل منتج', name);
  } else {
    state.products.push({ id: Date.now().toString(), sku, barcode, name, category, cost, retailPrice, wholesalePrice }); logAudit('إضافة منتج', `${name} (كود: ${sku})`);
  }
  const ok = await saveToStorage(); if (!ok) { if (editId && previous) { const p = state.products.find(x => x.id === editId); if (p) Object.assign(p, previous); } else state.products.pop(); return; }
  closeModal('productModal'); refreshCategoryWidgets(); renderAll(); toast('تم الحفظ');
}

function deleteProduct(id) {
  Swal.fire({ title:'حذف المنتج؟', icon:'warning', showCancelButton:true, confirmButtonColor:'#d33', cancelButtonColor:'#3085d6', confirmButtonText:'نعم', cancelButtonText:'إلغاء' }).then(async res => {
    if (!res.isConfirmed) return;
    const removed = state.products.find(p => p.id === id), removedFromCart = state.cart.filter(i => i.productId === id);
    state.products = state.products.filter(p => p.id !== id); state.cart = state.cart.filter(i => i.productId !== id); logAudit('حذف منتج', removed ? removed.name : id);
    const ok = await saveToStorage(); if (!ok) { if (removed) state.products.push(removed); state.cart.push(...removedFromCart); return; }
    renderAll();
  });
}

function openQuickProductModal() { $('qpName').value = ''; $('qpPrice').value = ''; $('qpQty').value = '1'; openModal('quickProductModal'); }
function saveQuickProduct() {
  const name = $('qpName').value.trim(), price = toNum($('qpPrice').value), qty = parseInt($('qpQty').value, 10) || 1;
  if (!name) return warn('خطأ', 'أدخل اسم المنتج');
  if (price <= 0 || qty <= 0) return warn('خطأ', 'أدخل سعراً وعدداً صحيحين');
  state.cart.push({ isQuickOnly:true, quickId:'q_' + Date.now() + '_' + Math.random().toString(36).slice(2,5), name, price, qty });
  closeModal('quickProductModal'); renderCart(); toast(`تمت إضافة ${qty} × ${name}`);
}

/* ==================== Smart Input & Paste ==================== */
function openSmartInputModal() { $('smartInputText').value = ''; openModal('smartInputModal'); }
function extractQtyAndProduct(line) {
  const normalizedLine = normalizeArabic(line); let qty = null;
  const afterWordMatch = normalizedLine.match(/(?:العدد|عدد|كميه|الكميه|x|\*)\s*[:\-]?\s*(\d+)/);
  if (afterWordMatch) qty = parseInt(afterWordMatch[1], 10); else { const trailingNumMatch = normalizedLine.match(/(\d+)\s*$/); if (trailingNumMatch) qty = parseInt(trailingNumMatch[1], 10); }
  if (!qty || qty <= 0) qty = 1;
  const cleanText = normalizedLine.replace(/(?:العدد|عدد|كميه|الكميه|علبه|علب|كرتون|حبه|قطعه)/g, ' ').replace(/\d+/g, ' ').replace(/[^\u0600-\u06FFa-zA-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const queryTokens = cleanText.split(' ').filter(w => w.length > 0); let bestMatch = null, bestScore = 0;
  state.products.forEach(p => { const pNorm = normalizeArabic(p.name); let score = 0; if (cleanText && pNorm.includes(cleanText)) score += 10; queryTokens.forEach(tok => { if (pNorm.includes(tok)) score += (tok.length >= 2 ? 3 : 1); }); if (score > bestScore) { bestScore = score; bestMatch = p; } });
  return { product: bestMatch, qty, score: bestScore };
}
function processSmartInput() {
  const raw = $('smartInputText').value.trim(); if (!raw) return;
  const client = getSelectedPosClient(), priceKey = client.type === 'wholesale' ? 'wholesalePrice' : 'retailPrice';
  const lines = raw.split(/\n|,|،/).map(s => s.trim()).filter(Boolean); let addedCount = 0; const skipped = [];
  lines.forEach(line => {
    const { product, qty, score } = extractQtyAndProduct(line);
    if (product && score > 0) {
      const unitPrice = toNum(product[priceKey]) || toNum(product.retailPrice) || toNum(product.wholesalePrice);
      if (unitPrice <= 0) { skipped.push(`${product.name} (السعر غير محدد)`); return; }
      const existing = state.cart.find(i => i.productId === product.id && !i.isQuickOnly);
      if (existing) existing.qty = roundMoney(existing.qty + qty); else state.cart.push({ productId: product.id, qty });
      addedCount++;
    } else skipped.push(line);
  });
  closeModal('smartInputModal'); renderCart();
  if (skipped.length) warn('تمت الإضافة مع تنبيه', `أُضيف ${addedCount}، لم يُعرَف: ${skipped.join(' ، ')}`, 'info'); else toast(`تمت إضافة ${addedCount} صنف`);
}
function openSmartPasteModal() { $('smartPasteText').value = ''; openModal('smartPasteModal'); }
async function processSmartPaste() {
  const raw = $('smartPasteText').value.trim(); if (!raw) return;
  const addedItems = []; let skipped = 0;
  raw.split('\n').forEach(line => {
    const parts = line.split(',').map(s => s.trim());
    if (parts.length < 5 || !parts[0]) { skipped++; return; }
    const sku = parts[5] || generateUniqueSku();
    if (state.products.some(p => p.sku === sku)) { skipped++; return; }
    addedItems.push({ id: Date.now().toString() + Math.random().toString(36).slice(2,6), name: parts[0], category: parts[1] || 'مواد غذائية', cost: toNum(parts[2]), retailPrice: toNum(parts[3]), wholesalePrice: toNum(parts[4]), sku, barcode: parts[6] || '' });
  });
  state.products.push(...addedItems); logAudit('لصق ذكي', `إضافة ${addedItems.length} منتج`);
  const ok = await saveToStorage(); if (!ok) { state.products = state.products.filter(p => !addedItems.some(a => a.id === p.id)); return; }
  closeModal('smartPasteModal'); refreshCategoryWidgets(); renderAll();
  Swal.fire({ icon:'success', title:'تمت الإضافة', text:`أُضيف ${addedItems.length} منتج.${skipped ? ` تم تجاهل ${skipped} سطر.` : ''}`, confirmButtonColor:'#0F5C4E' });
}

/* ==================== Clients ==================== */
function renderClientsGrid() {
  const q = normalizeArabic(($('clientSearch').value || '').trim());
  const list = state.clients.filter(c => !q || normalizeArabic(c.name).includes(q) || (c.phone || '').includes(q));
  $('clientsGrid').innerHTML = list.map(c => {
    const debt = getClientDebt(c.id), invCount = state.invoices.filter(i => i.clientId === c.id && i.status === 'active').length;
    return `<div class="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm space-y-3 flex flex-col justify-between card-hover animate-fade-slide-up">
      <div><div class="flex items-center justify-between"><span class="text-[10px] font-black px-2 py-0.5 rounded ${c.type === 'wholesale' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}">${c.type === 'wholesale' ? 'موزع جملة' : 'عميل تجزئة'}</span><span class="text-xs text-gray-400 font-bold"><i class="fa-solid fa-phone text-[10px]"></i> ${esc(c.phone || '-')}</span></div>
      <h4 onclick="openLedger('${esc(c.id)}', 'statement')" class="font-black text-base text-gray-800 hover:text-ashour cursor-pointer mt-2 transition">${esc(c.name)}</h4><p class="text-xs text-gray-500 font-bold">${esc(c.address || '-')} • ${invCount} فاتورة</p></div>
      <div class="border-t border-gray-100 pt-3 flex items-center justify-between gap-2"><div><span class="text-[10px] text-gray-500 font-bold block">الدين</span><span class="text-sm font-black ${debt > 0 ? 'text-red-600' : 'text-emerald-700'}">${fmtCur(debt)}</span></div>
      <div class="flex gap-1"><button onclick="openLedger('${esc(c.id)}', 'statement')" class="bg-ashour/10 text-ashour hover:bg-ashour hover:text-white px-2.5 py-1.5 rounded-xl text-xs font-bold transition">كشف</button><button onclick="openLedger('${esc(c.id)}', 'returns')" class="bg-amber-100 text-amber-900 hover:bg-amber-500 hover:text-white px-2.5 py-1.5 rounded-xl text-xs font-bold transition">مرتجعات</button><button onclick="openClientModal('${esc(c.id)}')" class="bg-indigo-100 text-indigo-700 hover:bg-indigo-600 hover:text-white px-2.5 py-1.5 rounded-xl text-xs font-bold transition"><i class="fa-solid fa-pen"></i></button><button onclick="deleteClient('${esc(c.id)}')" class="bg-red-100 text-red-700 hover:bg-red-600 hover:text-white px-2.5 py-1.5 rounded-xl text-xs font-bold transition"><i class="fa-solid fa-trash"></i></button></div></div></div>`;
  }).join('') || `<div class="col-span-full text-center py-10 text-gray-400 text-sm font-bold">لا يوجد زبائن</div>`;
}
function openClientModal(id = null) {
  $('clientEditId').value = id || '';
  if (id) {
    const c = state.clients.find(x => x.id === id); if (!c) return;
    $('clientModalTitle').textContent = 'تعديل زبون'; $('clientNameInput').value = c.name || ''; $('clientPhoneInput').value = c.phone === '-' ? '' : (c.phone || ''); $('clientAddressInput').value = c.address === '-' ? '' : (c.address || ''); $('clientOpeningInput').value = toNum(c.openingDebt); document.querySelector(`input[name="clientTypeRadio"][value="${c.type}"]`).checked = true;
  } else {
    $('clientModalTitle').textContent = 'إضافة زبون'; $('clientNameInput').value = ''; $('clientPhoneInput').value = ''; $('clientAddressInput').value = ''; $('clientOpeningInput').value = '0'; document.querySelector('input[name="clientTypeRadio"][value="retail"]').checked = true;
  }
  openModal('clientModal');
}
async function saveClient() {
  const id = $('clientEditId').value, name = $('clientNameInput').value.trim();
  const type = document.querySelector('input[name="clientTypeRadio"]:checked').value;
  const phone = $('clientPhoneInput').value.trim() || '-', address = $('clientAddressInput').value.trim() || '-', openingDebt = toNum($('clientOpeningInput').value);
  if (!name) return warn('خطأ', 'أدخل اسم الزبون');
  let previous = null;
  if (id) { const c = state.clients.find(x => x.id === id); if (!c) return; previous = { ...c }; Object.assign(c, { name, type, phone, address, openingDebt }); logAudit('تعديل زبون', name); }
  else { state.clients.push({ id: 'c_' + Date.now(), name, type, phone, address, openingDebt }); logAudit('إضافة زبون', name); }
  const ok = await saveToStorage(); if (!ok) { if (id && previous) { const c = state.clients.find(x => x.id === id); if (c) Object.assign(c, previous); } else state.clients.pop(); return; }
  closeModal('clientModal'); renderAll(); toast('تم الحفظ');
}
function deleteClient(id) {
  if (state.invoices.some(i => i.clientId === id && i.status === 'active') || getClientDebt(id) > 0) return warn('لا يمكن الحذف', 'لدى الزبون فواتير أو رصيد.', 'error');
  Swal.fire({ title:'حذف الزبون؟', icon:'warning', showCancelButton:true, confirmButtonColor:'#d33', cancelButtonColor:'#3085d6', confirmButtonText:'نعم', cancelButtonText:'إلغاء' }).then(async res => {
    if (!res.isConfirmed) return;
    const removed = state.clients.find(c => c.id === id); state.clients = state.clients.filter(c => c.id !== id); logAudit('حذف زبون', id);
    const ok = await saveToStorage(); if (!ok) { if (removed) state.clients.push(removed); return; }
    renderAll();
  });
}

/* ==================== Ledger & Returns ==================== */
function switchLedgerSubTab(sub) {
  const isRet = sub === 'returns';
  $('ledgerStatementPanel').classList.toggle('hidden', isRet); $('ledgerReturnsPanel').classList.toggle('hidden', !isRet);
  $('ledgerTabStatementBtn').className = isRet ? 'px-3.5 py-2 rounded-xl bg-gray-100 text-gray-700 hover:bg-gray-200 transition' : 'px-3.5 py-2 rounded-xl bg-ashour text-white transition';
  $('ledgerTabReturnsBtn').className = isRet ? 'px-3.5 py-2 rounded-xl bg-amber-600 text-white transition' : 'px-3.5 py-2 rounded-xl bg-amber-100 text-amber-900 hover:bg-amber-200 transition';
  if (isRet && state.currentLedgerClientId) renderClientReturnsTab(state.currentLedgerClientId);
}
function openLedger(clientId, initialSubTab = 'statement') {
  state.currentLedgerClientId = clientId; const c = state.clients.find(x => x.id === clientId); if (!c) return;
  const activeInvs = state.invoices.filter(i => i.clientId === clientId && i.status === 'active');
  const totalPurchases = sumList(activeInvs, i => i.total);
  const totalPaid = sumList(activeInvs, i => i.paid) + sumList(state.payments.filter(p => p.clientId === clientId), p => p.amount);
  const totalReturns = sumList(state.returns.filter(r => r.clientId === clientId), r => r.amount);
  const currentDebt = getClientDebt(clientId);
  $('ledgerClientName').textContent = 'كشف حساب: ' + c.name;
  $('ledgerClientBadge').textContent = c.type === 'wholesale' ? 'موزع جملة' : 'زبون عادي';
  $('ledgerClientBadge').className = `text-[11px] font-black px-2.5 py-0.5 rounded-full ${c.type === 'wholesale' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`;
  $('ledgerClientPhone').innerHTML = `<i class="fa-solid fa-phone text-ashour ml-1"></i> ${esc(c.phone || '-')}`;
  $('ledgerSummaryCards').innerHTML = `<div class="bg-white border border-gray-200 rounded-xl p-2.5"><span class="block text-[10px] text-gray-500">المشتريات</span><span class="text-sm font-black text-gray-800">${fmtCur(totalPurchases)}</span></div><div class="bg-white border border-gray-200 rounded-xl p-2.5"><span class="block text-[10px] text-emerald-700">المدفوع</span><span class="text-sm font-black text-emerald-700">${fmtCur(totalPaid)}</span></div><div class="bg-white border border-gray-200 rounded-xl p-2.5"><span class="block text-[10px] text-amber-700">المرتجعات</span><span class="text-sm font-black text-amber-700">${fmtCur(totalReturns)}</span></div><div class="bg-white border border-red-200 rounded-xl p-2.5"><span class="block text-[10px] text-red-600">الدين</span><span class="text-sm font-black text-red-600">${fmtCur(currentDebt)}</span></div>`;
  const rows = [];
  if (toNum(c.openingDebt) > 0) rows.push({ id:'op', type:'opening', ts:0, label:'رصيد افتتاحي', debit:toNum(c.openingDebt), credit:0 });
  activeInvs.forEach(i => rows.push({ id:i.id, type:'invoice', ts:i.ts, label:`فاتورة ${i.id} — [${i.items.map(it => `${it.qty} × ${it.name}`).join(' ، ')}]`, debit:i.total, credit:i.paid }));
  state.payments.filter(p => p.clientId === clientId).forEach(p => rows.push({ id:p.id, type:'payment', ts:p.ts, label:'تسديد دفعة', debit:0, credit:p.amount }));
  state.returns.filter(r => r.clientId === clientId).forEach(r => rows.push({ id:r.id, type:'return', ts:r.ts, label:`مرتجع: ${r.qty} × ${r.productName}`, debit:0, credit:r.amount }));
  rows.sort((a,b) => (a.ts || 0) - (b.ts || 0));
  $('ledgerTableBody').innerHTML = rows.map(r => `<tr class="border-b border-gray-100 hover:bg-gray-50"><td class="p-2 text-gray-500 whitespace-nowrap">${r.ts ? new Date(r.ts).toLocaleString('ar-SY') : '—'}</td><td class="p-2 text-gray-800">${esc(r.label)}</td><td class="p-2 text-red-600 whitespace-nowrap">${r.debit ? fmt(r.debit) : '—'}</td><td class="p-2 text-emerald-700 whitespace-nowrap">${r.credit ? fmt(r.credit) : '—'}</td><td class="p-2 text-center whitespace-nowrap">${r.type === 'invoice' ? `<button onclick="viewPastInvoice('${esc(r.id)}')" class="bg-ashour text-white hover:bg-ashour-dark px-2 py-1 rounded text-xs font-bold transition"><i class="fa-solid fa-receipt"></i></button>` : ''}${r.type === 'payment' ? `<button onclick="deletePayment('${r.id}')" class="text-red-500 hover:text-red-700 font-bold text-xs"><i class="fa-solid fa-trash"></i></button>` : ''}${r.type !== 'invoice' && r.type !== 'payment' ? '—' : ''}</td></tr>`).join('') || `<tr><td colspan="5" class="p-4 text-center text-gray-400">لا توجد معاملات</td></tr>`;
  $('payDebtAmount').value = ''; switchLedgerSubTab(initialSubTab); openModal('ledgerModal');
}
function getClientReturnableSummary(clientId) {
  const map = new Map();
  state.invoices.filter(i => i.clientId === clientId && i.status === 'active').forEach(inv => inv.items.forEach(it => {
    const key = (it.productId || normalizeArabic(it.name)) + '||' + toNum(it.price);
    if (!map.has(key)) map.set(key, { key, productId:it.productId, name:it.name, price:toNum(it.price), boughtQty:0, returnedQty:0 });
    map.get(key).boughtQty = roundMoney(map.get(key).boughtQty + toNum(it.qty));
  }));
  state.returns.filter(r => r.clientId === clientId).forEach(ret => {
    const key = normalizeArabic(ret.productName) + '||' + toNum(ret.unitPrice);
    if (map.has(key)) map.get(key).returnedQty = roundMoney(map.get(key).returnedQty + toNum(ret.qty));
  });
  return [...map.values()].map(x => ({ ...x, remainingQty: Math.max(0, roundMoney(x.boughtQty - x.returnedQty)) }));
}
function renderClientReturnsTab(clientId) {
  const list = getClientReturnableSummary(clientId), container = $('clientReturnableItemsList');
  if (!list.length) container.innerHTML = `<div class="text-center py-6 text-gray-400 text-xs font-bold bg-gray-50 rounded-xl border border-dashed">لا توجد أصناف مسجلة</div>`;
  else container.innerHTML = list.map(item => `<div class="flex items-center justify-between gap-2 bg-gray-50 border border-gray-200 rounded-xl p-3"><div><div class="font-black text-xs text-gray-800">${esc(item.name)} <span class="text-red-600">(مرتجع: ${item.returnedQty})</span></div><div class="text-[10px] text-gray-500 font-bold">سعر: ${fmtCur(item.price)} • المشترى: ${item.boughtQty} • المتبقي: ${item.remainingQty}</div></div><div class="flex items-center gap-1.5"><button onclick="increaseClientReturn('${esc(clientId)}', '${esc(item.name)}', ${item.price}, ${item.remainingQty})" ${item.remainingQty <= 0 ? 'disabled' : ''} class="bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white w-8 h-8 rounded-xl text-sm font-black">+</button><button onclick="decreaseClientReturn('${esc(clientId)}', '${esc(item.name)}', ${item.price})" ${item.returnedQty <= 0 ? 'disabled' : ''} class="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white w-8 h-8 rounded-xl text-sm font-black">−</button></div></div>`).join('');
  const rets = state.returns.filter(r => r.clientId === clientId).sort((a,b) => (b.ts || 0) - (a.ts || 0));
  $('clientReturnsHistoryList').innerHTML = rets.length ? rets.map(r => `<div class="flex justify-between items-center border-b border-gray-200 pb-1"><span>${esc(r.date)} — ${r.qty} × ${esc(r.productName)}</span><span class="text-emerald-700 font-black">خصم ${fmtCur(r.amount)}</span></div>`).join('') : `<div class="text-gray-400">لا توجد مرتجعات.</div>`;
}
async function increaseClientReturn(clientId, productName, unitPrice, maxRemaining) {
  if (maxRemaining <= 0) return warn('تنبيه', 'وصلت للحد الأقصى');
  const client = state.clients.find(c => c.id === clientId); if (!client) return;
  const deductAmount = calcLineTotal(unitPrice, 1);
  const newReturn = { id:'RET-' + Date.now() + '_' + Math.random().toString(36).slice(2,5), ts:Date.now(), date:nowStr(), clientId, clientName:client.name, productName, qty:1, unitPrice:toNum(unitPrice), amount:deductAmount };
  state.returns.push(newReturn); logAudit('مرتجع', `+1 ${productName} لـ ${client.name}`);
  const ok = await saveToStorage(); if (!ok) { state.returns.pop(); return; }
  renderAll(); openLedger(clientId, 'returns'); toast(`تمت زيادة مرتجع 1 × ${productName}`);
}
async function decreaseClientReturn(clientId, productName, unitPrice) {
  const idx = [...state.returns].reverse().findIndex(r => r.clientId === clientId && normalizeArabic(r.productName) === normalizeArabic(productName) && toNum(r.unitPrice) === toNum(unitPrice));
  if (idx === -1) return warn('تنبيه', 'لا يوجد مرتجع لتقليصه');
  const realIdx = state.returns.length - 1 - idx, target = { ...state.returns[realIdx] }, wasQty = toNum(target.qty);
  if (wasQty > 1) { state.returns[realIdx].qty = roundMoney(wasQty - 1); state.returns[realIdx].amount = calcLineTotal(target.unitPrice, state.returns[realIdx].qty); } else state.returns.splice(realIdx, 1);
  logAudit('تعديل مرتجع', `-1 ${productName}`);
  const ok = await saveToStorage(); if (!ok) { if (wasQty > 1) { state.returns[realIdx] = target; } else state.returns.splice(realIdx, 0, target); return; }
  renderAll(); openLedger(clientId, 'returns'); toast('تم إنقاص المرتجع');
}
async function recordDebtPayment() {
  const clientId = state.currentLedgerClientId, c = state.clients.find(x => x.id === clientId); if (!c) return;
  const amount = toNum($('payDebtAmount').value); if (amount <= 0) return warn('تنبيه', 'أدخل مبلغاً صحيحاً');
  const newPay = { id:'PAY-' + Date.now(), ts:Date.now(), date:nowStr(), clientId, amount, note:'' };
  state.payments.push(newPay); logAudit('تسديد', `${c.name}: ${fmtCur(amount)}`);
  const ok = await saveToStorage(); if (!ok) { state.payments.pop(); return; }
  renderAll(); openLedger(clientId, 'statement'); toast('تم تسجيل الدفعة');
}
function deletePayment(payId) {
  Swal.fire({ title:'حذف الدفعة؟', icon:'warning', showCancelButton:true, confirmButtonColor:'#d33', cancelButtonColor:'#3085d6', confirmButtonText:'نعم', cancelButtonText:'إلغاء' }).then(async res => {
    if (!res.isConfirmed) return;
    const removed = state.payments.find(p => p.id === payId); state.payments = state.payments.filter(p => p.id !== payId);
    const ok = await saveToStorage(); if (!ok) { if (removed) state.payments.push(removed); return; }
    renderAll(); openLedger(state.currentLedgerClientId, 'statement'); toast('تم الحذف');
  });
}

/* ==================== Companies ==================== */
function renderCompaniesGrid() {
  const q = normalizeArabic(($('companySearch')?.value || '').trim());
  const list = state.companies.filter(comp => !q || normalizeArabic(comp.name).includes(q) || normalizeArabic(comp.cycle).includes(q) || normalizeArabic(comp.distributorName).includes(q) || (comp.phone || '').includes(q) || (comp.products || []).some(pr => normalizeArabic(pr.name).includes(q)));
  $('companiesGrid').innerHTML = list.map(comp => {
    const prods = Array.isArray(comp.products) ? comp.products : [];
    return `<div onclick="openCompanyDetailPage('${esc(comp.id)}')" class="bg-white border border-gray-200 hover:border-ashour rounded-2xl p-4 shadow-sm space-y-3 cursor-pointer card-hover animate-fade-slide-up"><div class="flex items-start justify-between gap-2 border-b border-gray-100 pb-3"><div><h4 class="font-black text-base text-ashour flex items-center gap-2"><i class="fa-solid fa-building text-ashour-gold"></i> ${esc(comp.name)}</h4><p class="text-xs text-gray-500 font-bold mt-1"><i class="fa-solid fa-user-tie text-[11px] text-indigo-600"></i> ${esc(comp.distributorName || '-')} • <i class="fa-solid fa-phone text-[11px] text-emerald-600"></i> ${esc(comp.phone || '-')}</p><p class="text-xs text-indigo-700 font-black mt-1.5 bg-indigo-50 px-2.5 py-1 rounded-lg inline-block"><i class="fa-solid fa-rotate"></i> ${esc(comp.cycle || 'غير محدد')}</p></div><div onclick="event.stopPropagation()" class="flex gap-1"><button onclick="openCompanyModal('${esc(comp.id)}')" class="bg-indigo-100 text-indigo-700 hover:bg-indigo-600 hover:text-white px-2.5 py-1.5 rounded-xl text-xs font-bold"><i class="fa-solid fa-pen"></i></button><button onclick="deleteCompany('${esc(comp.id)}')" class="bg-red-100 text-red-700 hover:bg-red-600 hover:text-white px-2.5 py-1.5 rounded-xl text-xs font-bold"><i class="fa-solid fa-trash"></i></button></div></div><div class="flex justify-between items-center text-xs font-bold text-gray-600"><span>منتجات: <b class="text-ashour">${prods.length}</b></span><span class="text-ashour font-black">فتح <i class="fa-solid fa-arrow-left mr-1"></i></span></div></div>`;
  }).join('') || `<div class="col-span-full text-center py-10 text-gray-400 text-sm font-bold">لا توجد شركات</div>`;
}
function openCompanyDetailPage(compId) {
  state.activeCompanyId = compId; const comp = state.companies.find(c => c.id === compId); if (!comp) return;
  if (!Array.isArray(comp.products)) comp.products = [];
  $('companiesListSection').classList.add('hidden'); const page = $('companyDetailPage'); page.classList.remove('hidden');
  page.innerHTML = `<div class="bg-white rounded-2xl p-4 sm:p-5 border border-gray-200 shadow-sm space-y-4 animate-fade-slide-up"><div class="flex flex-wrap justify-between items-center gap-2 border-b border-gray-100 pb-3"><button onclick="backToCompaniesList()" class="bg-gray-100 hover:bg-gray-200 text-gray-800 px-3.5 py-2 rounded-xl text-sm font-black flex items-center gap-2"><i class="fa-solid fa-arrow-right"></i> رجوع</button><button onclick="openCompanyModal('${esc(comp.id)}')" class="bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-2 rounded-xl text-sm font-bold flex items-center gap-1"><i class="fa-solid fa-pen"></i> تعديل</button></div><div class="text-center py-2 animate-title-pop"><h2 class="text-2xl sm:text-3xl font-black text-ashour">${esc(comp.name)}</h2><div class="w-20 h-1 bg-ashour-gold mx-auto mt-2 rounded-full"></div></div><div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm font-bold"><div class="bg-gray-50 border border-gray-200 rounded-xl p-3"><span class="text-gray-500 block text-[11px]">الهاتف</span><span class="text-sm font-black text-gray-800">${esc(comp.phone || '-')}</span></div><div class="bg-gray-50 border border-gray-200 rounded-xl p-3"><span class="text-gray-500 block text-[11px]">العنوان</span><span class="text-sm font-black text-gray-800">${esc(comp.address || '-')}</span></div><div class="bg-amber-50/70 border border-amber-200 rounded-xl p-3"><span class="text-gray-500 block text-[11px]">الموزع والدورة</span><span class="text-sm font-black text-amber-900">${esc(comp.distributorName || '-')} • ${esc(comp.cycle || '-')}</span></div></div></div><div class="bg-white rounded-2xl p-4 sm:p-5 border border-gray-200 shadow-sm space-y-4 animate-fade-slide-up"><div class="flex flex-wrap justify-between items-center gap-2"><h3 class="text-lg font-black text-ashour"><i class="fa-solid fa-boxes-stacked text-ashour-gold"></i> منتجات الشركة</h3><button onclick="addProductDirectlyToCompany('${esc(comp.id)}')" class="bg-ashour hover:bg-ashour-dark text-white px-3.5 py-2 rounded-xl text-sm font-black flex items-center gap-1"><i class="fa-solid fa-plus"></i> إضافة منتج</button></div><div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">${comp.products.map((pr, idx) => `<div class="border border-gray-200 rounded-2xl p-3 bg-gray-50/60 space-y-2 flex flex-col justify-between card-hover"><div class="font-black text-sm text-gray-800">${esc(pr.name)}</div><div class="text-sm font-black text-emerald-700">سعر المستهلك: ${fmtCur(pr.consumerPrice)}</div><div class="flex gap-1.5 items-center border-t border-gray-200 pt-2 text-xs font-bold"><input type="number" step="any" id="cpPrice_${idx}" value="${toNum(pr.consumerPrice)}" class="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-sm font-black"><button onclick="updateCompanyProductPrice('${esc(comp.id)}', ${idx})" class="bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1.5 rounded-lg text-xs font-black whitespace-nowrap">حفظ</button><button onclick="removeCompanyProduct('${esc(comp.id)}', ${idx})" class="bg-red-100 hover:bg-red-600 text-red-700 hover:text-white px-2 py-1.5 rounded-lg text-xs"><i class="fa-solid fa-trash"></i></button></div></div>`).join('') || `<div class="col-span-full text-center py-8 text-gray-400 text-sm font-bold">لا توجد منتجات</div>`}</div></div>`;
}
function backToCompaniesList() { state.activeCompanyId = null; $('companyDetailPage').classList.add('hidden'); $('companiesListSection').classList.remove('hidden'); renderCompaniesGrid(); }
async function updateCompanyProductPrice(compId, idx) {
  const comp = state.companies.find(c => c.id === compId); if (!comp || !comp.products[idx]) return;
  const oldPrice = comp.products[idx].consumerPrice; comp.products[idx].consumerPrice = toNum($('cpPrice_' + idx)?.value);
  const ok = await saveToStorage(); if (!ok) { comp.products[idx].consumerPrice = oldPrice; return; }
  openCompanyDetailPage(compId); toast('تم تحديث السعر');
}
async function removeCompanyProduct(compId, idx) {
  const comp = state.companies.find(c => c.id === compId); if (!comp || !comp.products[idx]) return;
  const removed = comp.products.splice(idx, 1)[0];
  const ok = await saveToStorage(); if (!ok) { comp.products.splice(idx, 0, removed); return; }
  openCompanyDetailPage(compId); toast('تم الحذف');
}
async function addProductDirectlyToCompany(compId) {
  const comp = state.companies.find(c => c.id === compId); if (!comp) return;
  const { value: formValues } = await Swal.fire({ title: 'إضافة منتج للشركة', html: `<input id="swal-p-name" class="swal2-input" placeholder="اسم المنتج"><input id="swal-p-price" type="number" step="any" class="swal2-input" placeholder="سعر المستهلك (${CURRENCY})">`, focusConfirm: false, showCancelButton: true, confirmButtonColor: '#0F5C4E', confirmButtonText: 'إضافة', cancelButtonText: 'إلغاء', preConfirm: () => { const name = document.getElementById('swal-p-name').value.trim(); const price = toNum(document.getElementById('swal-p-price').value); if (!name) { Swal.showValidationMessage('أدخل اسم المنتج'); return false; } return { name, price }; } });
  if (!formValues) return;
  const newProd = { id: 'cp_' + Date.now(), name: formValues.name, consumerPrice: formValues.price }; comp.products.push(newProd);
  const ok = await saveToStorage(); if (!ok) { comp.products.pop(); return; }
  openCompanyDetailPage(compId); toast('تمت الإضافة');
}
function addCompanyProductRow(name = '', consumerPrice = '') {
  const row = document.createElement('div'); row.className = 'flex gap-2 items-center comp-prod-row bg-white p-2 rounded-xl border border-gray-200';
  row.innerHTML = `<input type="text" value="${esc(name)}" placeholder="اسم المنتج" class="flex-grow bg-gray-50 border border-gray-300 rounded-lg px-2 py-1.5 text-sm font-bold comp-prod-name"><input type="number" step="any" value="${esc(consumerPrice)}" placeholder="السعر" class="w-28 bg-gray-50 border border-gray-300 rounded-lg px-2 py-1.5 text-sm font-bold comp-prod-price"><button type="button" onclick="this.parentElement.remove()" class="bg-red-100 text-red-600 hover:bg-red-600 hover:text-white px-2 py-1.5 rounded-lg text-sm font-bold"><i class="fa-solid fa-xmark"></i></button>`;
  $('compProductsRows').appendChild(row);
}
function openCompanyModal(id = null) {
  $('compEditId').value = id || ''; $('compProductsRows').innerHTML = '';
  if (id) { const comp = state.companies.find(x => x.id === id); if (!comp) return; $('companyModalTitle').textContent = 'تعديل شركة'; $('compNameInput').value = comp.name || ''; $('compPhoneInput').value = comp.phone || ''; $('compAddressInput').value = comp.address || ''; $('compDistributorInput').value = comp.distributorName || ''; $('compCycleInput').value = comp.cycle || ''; if (Array.isArray(comp.products) && comp.products.length) comp.products.forEach(p => addCompanyProductRow(p.name, p.consumerPrice)); else addCompanyProductRow(); }
  else { $('companyModalTitle').textContent = 'إضافة شركة'; $('compNameInput').value = ''; $('compPhoneInput').value = ''; $('compAddressInput').value = ''; $('compDistributorInput').value = ''; $('compCycleInput').value = ''; addCompanyProductRow(); }
  openModal('companyModal');
}
async function saveCompany() {
  const id = $('compEditId').value, name = $('compNameInput').value.trim(); const phone = $('compPhoneInput').value.trim() || '-', address = $('compAddressInput').value.trim() || '-', distributorName = $('compDistributorInput').value.trim() || '-', cycle = $('compCycleInput').value.trim() || 'غير محدد';
  if (!name) return warn('خطأ', 'أدخل اسم الشركة');
  const products = []; document.querySelectorAll('#compProductsRows .comp-prod-row').forEach(row => { const pName = row.querySelector('.comp-prod-name').value.trim(); const pPrice = toNum(row.querySelector('.comp-prod-price').value); if (pName) products.push({ id: 'cp_' + Date.now() + '_' + Math.random().toString(36).slice(2,5), name: pName, consumerPrice: pPrice }); });
  let previous = null;
  if (id) { const comp = state.companies.find(x => x.id === id); if (!comp) return; previous = { ...comp }; Object.assign(comp, { name, phone, address, distributorName, cycle, products }); logAudit('تعديل شركة', name); }
  else { state.companies.push({ id: 'comp_' + Date.now(), name, phone, address, distributorName, cycle, products }); logAudit('إضافة شركة', name); }
  const ok = await saveToStorage(); if (!ok) { if (id && previous) { const comp = state.companies.find(x => x.id === id); if (comp) Object.assign(comp, previous); } else state.companies.pop(); return; }
  closeModal('companyModal'); if (id && state.activeCompanyId === id) openCompanyDetailPage(id); else renderCompaniesGrid(); toast('تم الحفظ');
}
function deleteCompany(id) {
  Swal.fire({ title: 'حذف هذه الشركة؟', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6', confirmButtonText: 'نعم', cancelButtonText: 'إلغاء' }).then(async res => {
    if (!res.isConfirmed) return;
    const removed = state.companies.find(c => c.id === id); state.companies = state.companies.filter(c => c.id !== id); logAudit('حذف شركة', id);
    const ok = await saveToStorage(); if (!ok) { if (removed) state.companies.push(removed); return; }
    backToCompaniesList();
  });
}

/* ==================== Invoices & Expenses ==================== */
function renderInvoicesTable() {
  const query = normalizeArabic(($('invoiceSearchInput')?.value || '').trim());
  const invRows = state.invoices.map(inv => ({ kind: 'invoice', id: inv.id, ts: inv.ts || 0, date: inv.date, clientName: inv.clientName, total: toNum(inv.total), paid: toNum(inv.paid), remaining: toNum(inv.remaining), profit: toNum(inv.profit), status: inv.status }));
  const directRows = state.directSales.map(ds => ({ kind: 'direct', id: ds.id, ts: ds.ts || 0, date: ds.date, clientName: `بيع سريع (${ds.qty} × ${ds.name})${ds.note ? ' - ' + ds.note : ''}`, total: toNum(ds.total), paid: toNum(ds.total), remaining: 0, profit: toNum(ds.profit), status: 'direct' }));
  const list = [...invRows, ...directRows].filter(row => !query || normalizeArabic(row.id).includes(query) || normalizeArabic(row.clientName).includes(query)).sort((a,b) => b.ts - a.ts);
  $('invoicesTableBody').innerHTML = list.map(row => {
    if (row.kind === 'direct') return `<tr class="hover:bg-amber-50/40 border-b border-gray-100 bg-amber-50/20"><td class="p-3 text-amber-700 font-black">${esc(row.id)}</td><td class="p-3 text-gray-500 whitespace-nowrap">${esc(row.date)}</td><td class="p-3 text-gray-800">${esc(row.clientName)}</td><td class="p-3 text-gray-800">${fmtCur(row.total)}</td><td class="p-3 text-emerald-700">${fmtCur(row.paid)}</td><td class="p-3 text-gray-400">${fmtCur(0)}</td><td class="p-3 text-indigo-700">${fmtCur(row.profit)}</td><td class="p-3"><span class="px-2 py-0.5 rounded text-[10px] font-black bg-amber-100 text-amber-800">بدون فاتورة</span></td><td class="p-3 text-center whitespace-nowrap"><button onclick="deleteDirectSale('${esc(row.id)}')" class="text-red-600 hover:underline font-bold"><i class="fa-solid fa-trash"></i></button></td></tr>`;
    const cancelled = row.status === 'cancelled';
    return `<tr class="hover:bg-gray-50 border-b border-gray-100 ${cancelled ? 'opacity-60' : ''}"><td class="p-3 text-ashour font-black">${esc(row.id)}</td><td class="p-3 text-gray-500 whitespace-nowrap">${esc(row.date)}</td><td class="p-3 text-gray-800">${esc(row.clientName)}</td><td class="p-3 text-gray-800 ${cancelled ? 'line-through' : ''}">${fmtCur(row.total)}</td><td class="p-3 text-emerald-700">${fmtCur(row.paid)}</td><td class="p-3 text-red-600">${fmtCur(row.remaining)}</td><td class="p-3 text-indigo-700">${cancelled ? '—' : fmtCur(row.profit)}</td><td class="p-3"><span class="px-2 py-0.5 rounded text-[10px] font-black ${cancelled ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-800'}">${cancelled ? 'ملغاة' : 'نشطة'}</span></td><td class="p-3 text-center whitespace-nowrap"><button onclick="viewPastInvoice('${esc(row.id)}')" class="text-ashour hover:underline font-bold ml-2"><i class="fa-solid fa-eye"></i></button>${cancelled ? '' : `<button onclick="cancelInvoice('${esc(row.id)}')" class="text-red-600 hover:underline font-bold"><i class="fa-solid fa-ban"></i></button>`}</td></tr>`;
  }).join('') || `<tr><td colspan="9" class="p-6 text-center text-gray-400 text-sm">لا توجد فواتير مطابقة</td></tr>`;
}
function deleteDirectSale(id) {
  Swal.fire({ title: 'حذف سجل البيع السريع؟', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6', confirmButtonText: 'نعم', cancelButtonText: 'إلغاء' }).then(async res => {
    if (!res.isConfirmed) return;
    const removed = state.directSales.find(d => d.id === id); state.directSales = state.directSales.filter(d => d.id !== id);
    const ok = await saveToStorage(); if (!ok) { if (removed) state.directSales.push(removed); return; }
    renderAll(); toast('تم الحذف');
  });
}
function viewPastInvoice(id) { const inv = state.invoices.find(i => i.id === id); if (inv) showReceiptModal(inv); }
function cancelInvoice(id) {
  const inv = state.invoices.find(i => i.id === id); if (!inv || inv.status === 'cancelled') return;
  Swal.fire({ title:'إلغاء الفاتورة؟', html:`تأكيد إلغاء الفاتورة <b>${esc(inv.id)}</b> — ${fmtCur(inv.total)}`, icon:'warning', showCancelButton:true, confirmButtonColor:'#d33', cancelButtonColor:'#3085d6', confirmButtonText:'نعم', cancelButtonText:'تراجع' }).then(async res => {
    if (!res.isConfirmed) return;
    inv.status = 'cancelled'; inv.cancelledAt = Date.now(); logAudit('إلغاء فاتورة', `${inv.id} للزبون ${inv.clientName}`);
    const ok = await saveToStorage(); if (!ok) { inv.status = 'active'; delete inv.cancelledAt; return; }
    renderAll(); toast('أُلغيت الفاتورة');
  });
}
function openExpenseModal() { $('expTitle').value = ''; $('expAmount').value = ''; $('expNotes').value = ''; openModal('expenseModal'); }
async function saveExpense() {
  const title = $('expTitle').value.trim(), amount = toNum($('expAmount').value), notes = $('expNotes').value.trim() || '-';
  if (!title || amount <= 0) return warn('خطأ', 'أدخل البند والمبلغ');
  const newExp = { id:'EXP-' + Date.now(), ts: Date.now(), date: nowStr(), title, amount, notes };
  state.expenses.push(newExp); logAudit('مصروف', `${title} ${fmtCur(amount)}`);
  const ok = await saveToStorage(); if (!ok) { state.expenses.pop(); return; }
  closeModal('expenseModal'); renderAll(); toast('تم التسجيل');
}
function deleteExpense(id) {
  Swal.fire({ title:'حذف المصروف؟', icon:'warning', showCancelButton:true, confirmButtonColor:'#d33', cancelButtonColor:'#3085d6', confirmButtonText:'نعم', cancelButtonText:'إلغاء' }).then(async res => {
    if (!res.isConfirmed) return;
    const removed = state.expenses.find(e => e.id === id); state.expenses = state.expenses.filter(e => e.id !== id);
    const ok = await saveToStorage(); if (!ok) { if (removed) state.expenses.push(removed); return; }
    renderAll();
  });
}
function renderExpensesTable() {
  const list = [...state.expenses].sort((a,b) => (b.ts || 0) - (a.ts || 0));
  $('expensesTableBody').innerHTML = list.map(e => `<tr class="hover:bg-gray-50 border-b border-gray-100"><td class="p-3 text-gray-500 whitespace-nowrap">${esc(e.date)}</td><td class="p-3 font-bold text-gray-800">${esc(e.title)}</td><td class="p-3 text-purple-700 font-black">${fmtCur(e.amount)}</td><td class="p-3 text-gray-600">${esc(e.notes)}</td><td class="p-3 text-center"><button onclick="deleteExpense('${esc(e.id)}')" class="bg-red-100 text-red-600 hover:bg-red-600 hover:text-white px-2.5 py-1 rounded transition text-xs font-bold"><i class="fa-solid fa-trash"></i></button></td></tr>`).join('') || `<tr><td colspan="5" class="p-6 text-center text-gray-400 text-sm">لا توجد مصاريف</td></tr>`;
}

/* ==================== Reports & Settings ==================== */
let lastReport = null;
function setReportRange(days) { const to = new Date(), from = new Date(); if (days > 0) from.setDate(from.getDate() - days + 1); $('repFrom').value = dayKey(from.getTime()); $('repTo').value = dayKey(to.getTime()); renderReports(); }
function renderReports() {
  if (!$('repFrom').value) setReportRange(0);
  const from = $('repFrom').value, to = $('repTo').value, inRange = ts => { if (!ts) return false; const k = dayKey(ts); return k >= from && k <= to; };
  const invs = state.invoices.filter(i => i.status === 'active' && inRange(i.ts)), dsList = state.directSales.filter(d => inRange(d.ts)), exps = state.expenses.filter(e => inRange(e.ts));
  const sales = roundMoney(sumList(invs, i => i.total) + sumList(dsList, d => d.total)), profit = roundMoney(sumList(invs, i => i.profit) + sumList(dsList, d => d.profit)), expTotal = sumList(exps, e => e.amount);
  const card = (label, value, color) => `<div class="bg-${color}-50 border border-${color}-200 rounded-xl p-3"><span class="block text-[11px] text-${color}-700">${label}</span><span class="text-sm font-black text-${color}-900">${value}</span></div>`;
  $('reportCards').innerHTML = card('الفواتير + بيع سريع', `${invs.length} + ${dsList.length}`, 'emerald') + card('المبيعات', fmtCur(sales), 'blue') + card('إجمالي الربح', fmtCur(profit), 'indigo') + card('المصاريف', fmtCur(expTotal), 'purple');
  const map = {};
  invs.forEach(i => i.items.forEach(it => { const k = normalizeArabic(it.name); if (!map[k]) map[k] = { name: it.name, qty: 0, rev: 0 }; map[k].qty = roundMoney(map[k].qty + toNum(it.qty)); map[k].rev = roundMoney(map[k].rev + toNum(it.total)); }));
  dsList.forEach(d => { const k = normalizeArabic(d.name); if (!map[k]) map[k] = { name: d.name, qty: 0, rev: 0 }; map[k].qty = roundMoney(map[k].qty + toNum(d.qty)); map[k].rev = roundMoney(map[k].rev + toNum(d.total)); });
  const top = Object.values(map).sort((a,b) => b.qty - a.qty).slice(0, 10);
  $('topProductsBody').innerHTML = top.map(t => `<tr class="border-b border-gray-100"><td class="p-2 text-gray-800">${esc(t.name)}</td><td class="p-2 text-ashour font-black">${t.qty}</td><td class="p-2 text-gray-700">${fmtCur(t.rev)}</td></tr>`).join('') || `<tr><td colspan="3" class="p-4 text-center text-gray-400">لا بيانات</td></tr>`;
  lastReport = { from, to, sales, profit, expTotal, net: roundMoney(profit - expTotal), count: invs.length + dsList.length, top };
}
function exportReportCSV() {
  if (!lastReport) renderReports();
  const r = lastReport, lines = [['العملة', CURRENCY], ['تقرير', `${r.from} إلى ${r.to}`], ['عدد العمليات', r.count], ['المبيعات', r.sales], ['إجمالي الربح', r.profit], ['المصاريف', r.expTotal], ['الصافي', r.net], [], ['الصنف', 'الكمية', 'الإيراد']];
  r.top.forEach(t => lines.push([t.name, t.qty, t.rev]));
  const csv = '\uFEFF' + lines.map(row => row.map(c => `"${String(c == null ? '' : c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `report_${r.from}_${r.to}.csv`; document.body.appendChild(a); a.click(); a.remove();
}
function renderAuditLog() { $('auditLogBody').innerHTML = state.auditLog.slice(0, 50).map(l => `<tr class="border-b border-gray-100"><td class="p-2 text-gray-400 whitespace-nowrap">${esc(l.date)}</td><td class="p-2 font-black text-ashour">${esc(l.type)}</td><td class="p-2 text-gray-800">${esc(l.details)}</td></tr>`).join('') || `<tr><td colspan="3" class="p-4 text-center text-gray-400">لا حركات</td></tr>`; }

function loadStoreInfoToSettings() { $('setStoreName').value = state.storeInfo.name || ''; $('setStorePhone').value = state.storeInfo.phone || ''; $('setStoreAddress').value = state.storeInfo.address || ''; $('headerStoreName').textContent = state.storeInfo.name || 'مركز عاشور للتجارة'; }
async function saveStoreSettings() {
  const prev = { ...state.storeInfo };
  state.storeInfo = { name: $('setStoreName').value.trim() || 'مركز عاشور للتجارة', phone: $('setStorePhone').value.trim(), address: $('setStoreAddress').value.trim() };
  logAudit('تعديل الإعدادات', 'تحديث بيانات المتجر');
  const ok = await saveToStorage(); if (!ok) { state.storeInfo = prev; return; }
  loadStoreInfoToSettings(); toast('حُفظت البيانات');
}
async function changePinCode() {
  const oldPin = $('oldPinInput').value, newPin = $('newPinInput').value;
  if (!newPin || newPin.length < 4 || newPin.length > 6 || !/^\d+$/.test(newPin)) return warn('خطأ', 'الرمز من 4 إلى 6 أرقام');
  if (await hashPin(oldPin, state.pinSalt) !== state.pinHash) return warn('خطأ', 'الرمز الحالي غير صحيح', 'error');
  const prevHash = state.pinHash, prevLen = state.pinLength;
  state.pinHash = await hashPin(newPin, state.pinSalt); state.pinLength = newPin.length; logAudit('تغيير PIN', 'تم تغيير رمز الحماية');
  const ok = await saveToStorage(); if (!ok) { state.pinHash = prevHash; state.pinLength = prevLen; return; }
  $('oldPinInput').value = ''; $('newPinInput').value = ''; toast('تم تغيير PIN');
}
async function refreshStorageStatus() {
  const el = $('storageStatus'); if (!el) return;
  const status = await AshourDB.getStatus();
  let html = `<div class="flex justify-between"><span>IndexedDB:</span><span class="${status.indexedDB.includes('✓') ? 'text-emerald-700' : 'text-red-600'}">${status.indexedDB}</span></div>`;
  html += `<div class="flex justify-between"><span>localStorage:</span><span class="${status.localStorage.includes('✓') ? 'text-emerald-700' : 'text-amber-600'}">${status.localStorage}</span></div>`;
  if (status.localStorageSize > 0) html += `<div class="flex justify-between"><span>حجم البيانات:</span><span>${(status.localStorageSize / 1024).toFixed(1)} KB</span></div>`;
  if (status.estimate) html += `<div class="flex justify-between"><span>المساحة المتاحة:</span><span>${(status.estimate.quota / (1024*1024)).toFixed(1)} MB</span></div>`;
  el.innerHTML = html;
}
async function testStorageCapacity() {
  Swal.fire({ title: 'جارٍ الاختبار...', text: 'يتم الآن كتابة 5000 فاتورة وهمية لاختبار قوة الذاكرة.', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } });
  const res = await AshourDB.testCapacity();
  if (res.ok) { Swal.fire({ icon: 'success', title: 'الذاكرة قوية جداً!', html: `نجح الاختبار.<br>الحجم المكتوب: <b>${res.sizeKB} KB</b><br>الزمن: <b>${res.ms} ms</b><br>IndexedDB: ${res.okIDB ? '✓' : '✗'} | localStorage: ${res.okLS ? '✓' : '✗'}`, confirmButtonColor: '#0F5C4E' }); }
  else { Swal.fire({ icon: 'error', title: 'فشل الاختبار', text: res.error || 'الذاكرة ممتلئة.', confirmButtonColor: '#d33' }); }
  refreshStorageStatus();
}
async function exportDataBackup() {
  const snapshot = JSON.parse(JSON.stringify(state)); delete snapshot.pinHash; delete snapshot.pinAttempts; delete snapshot.pinLockUntil;
  const a = document.createElement('a'); a.href = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(snapshot, null, 2)); a.download = `Ashour_Backup_${new Date().toISOString().slice(0,10)}.json`; document.body.appendChild(a); a.click(); a.remove(); toast('تم تصدير النسخة');
}
function importDataBackup(ev) {
  const file = ev.target.files[0]; if (!file) return; const reader = new FileReader();
  reader.onload = e => {
    try {
      const incoming = JSON.parse(e.target.result);
      if (!Array.isArray(incoming.products) || !Array.isArray(incoming.clients)) throw new Error('bad');
      Swal.fire({ title:'استعادة البيانات؟', text:'ستُستبدل البيانات الحالية.', icon:'warning', showCancelButton:true, confirmButtonColor:'#d33', cancelButtonColor:'#3085d6', confirmButtonText:'نعم', cancelButtonText:'إلغاء' }).then(async res => {
        if (!res.isConfirmed) return;
        const keepPin = state.pinHash, keepLen = state.pinLength, keepSalt = state.pinSalt;
        state = Object.assign(defaultState(), incoming);
        ['returns','directSales','companies','payments','expenses','invoices'].forEach(k => { if (!Array.isArray(state[k])) state[k] = []; });
        state.pinHash = keepPin; state.pinLength = keepLen || 4; state.pinSalt = keepSalt || state.pinSalt; state.cart = [];
        const ok = await saveToStorage(); if (!ok) return;
        refreshCategoryWidgets(); initPOSCategories(); renderAll();
        Swal.fire({ icon:'success', title:'تمت الاستعادة', confirmButtonColor:'#0F5C4E' });
      });
    } catch (err) { warn('ملف غير صالح', 'النسخة تالفة.', 'error'); } finally { ev.target.value = ''; }
  }; reader.readAsText(file);
}

/* ==================== Receipt & Modals ==================== */
function showReceiptModal(inv) {
  state.currentReceiptInv = inv; const client = state.clients.find(c => c.id === inv.clientId) || { id:null };
  const totalDebt = client.id ? getClientDebt(client.id) : 0, hasDebt = totalDebt > 0 || toNum(inv.remaining) > 0;
  $('recStoreName').textContent = state.storeInfo.name || 'مركز عاشور للتجارة'; $('recStorePhone').textContent = `هاتف: ${state.storeInfo.phone || '-'}`; $('recStoreAddress').textContent = `العنوان: ${state.storeInfo.address || '-'}`;
  $('recNum').textContent = '#' + inv.id; $('recDate').textContent = inv.date; $('recClient').textContent = inv.clientName;
  $('recPayType').textContent = inv.status === 'cancelled' ? 'ملغاة' : (inv.remaining > 0 ? (inv.paid > 0 ? 'دفع جزئي' : 'آجل (دين)') : 'نقدي');
  $('recItemsBody').innerHTML = inv.items.map(i => `<tr class="border-b border-gray-200"><td class="py-1 font-bold">${esc(i.name)}</td><td class="py-1 text-center">${i.qty}</td><td class="py-1 text-left">${fmt(i.price)}</td><td class="py-1 text-left font-bold">${fmt(i.total)}</td></tr>`).join('');
  if (toNum(inv.discount) > 0) { $('recDiscountRow').classList.remove('hidden'); $('recDiscount').textContent = fmtCur(inv.discount); } else $('recDiscountRow').classList.add('hidden');
  $('recTotal').textContent = fmtCur(inv.total); $('recPaidRow').classList.toggle('hidden', !hasDebt); $('recRemainingRow').classList.toggle('hidden', !hasDebt); $('recTotalDebtRow').classList.toggle('hidden', !hasDebt);
  if (hasDebt) { $('recPaid').textContent = fmtCur(inv.paid); $('recRemaining').textContent = fmtCur(inv.remaining); $('recTotalClientDebt').textContent = fmtCur(totalDebt); }
  openModal('receiptModal');
}
async function generateReceiptCanvas() {
  if (typeof html2canvas === 'undefined') throw new Error('مكتبة html2canvas غير محملة');
  const el = $('printableReceipt'); if (document.fonts && document.fonts.ready) await document.fonts.ready;
  return await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true, allowTaint: true });
}
async function saveReceiptAsImage() {
  try { toast('جاري التجهيز...', 'info'); const canvas = await generateReceiptCanvas(), link = document.createElement('a'), invId = state.currentReceiptInv ? state.currentReceiptInv.id : Date.now(); link.download = `فاتورة_${invId}.png`; link.href = canvas.toDataURL('image/png'); document.body.appendChild(link); link.click(); link.remove(); toast('تم حفظ الفاتورة'); }
  catch (e) { warn('تنبيه', 'تعذر إنشاء الصورة، استخدم الطباعة.', 'error'); }
}

// إصلاح زر المشاركة ليعمل على جميع الهواتف
async function shareReceiptImage() {
  try {
    toast('جاري التجهيز للمشاركة...', 'info');
    const canvas = await generateReceiptCanvas();
    const invId = state.currentReceiptInv ? state.currentReceiptInv.id : Date.now();
    
    canvas.toBlob(async (blob) => {
      if (!blob) return saveReceiptAsImage();
      const file = new File([blob], `فاتورة_${invId}.png`, { type: 'image/png' });
      
      // التحقق من دعم المتصفح للمشاركة
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            title: `فاتورة ${invId}`,
            text: `فاتورة من ${state.storeInfo.name}`,
            files: [file]
          });
        } catch (shareError) {
          // إذا رفض المستخدم المشاركة أو حدث خطأ، نقوم بتنزيل الصورة بدلاً من ذلك
          if (shareError.name !== 'AbortError') saveReceiptAsImage();
        }
      } else {
        // الهواتف التي لا تدعم المشاركة (أو الكمبيوتر) ستقوم بتنزيل الصورة
        saveReceiptAsImage();
      }
    }, 'image/png');
  } catch (e) {
    saveReceiptAsImage();
  }
}

const MODAL_IDS = ['barcodeScannerModal','quickProductModal','directSaleModal','productModal','companyModal','expenseModal','smartPasteModal','smartInputModal','receiptModal','clientModal','ledgerModal'];
function openModal(id) { const el = $(id); el.classList.remove('hidden'); el.style.display = 'flex'; }
function closeModal(id) { const el = $(id); el.classList.add('hidden'); el.style.display = 'none'; }

// اختصارات الكيبورد
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { MODAL_IDS.forEach(id => { const el = $(id); if (el && !el.classList.contains('hidden')) closeModal(id); }); return; }
  if (e.key === 'F2') { e.preventDefault(); if (!$('pinOverlay').classList.contains('hidden')) return; openSmartInputModal(); }
  if (e.key === 'F4') { e.preventDefault(); if (!$('pinOverlay').classList.contains('hidden')) return; if (!$('view-pos').classList.contains('hidden')) checkoutPOS(); }
});

function renderAll() {
  populatePosClients(); renderPosProducts(); renderCart(); renderInvoicesTable(); renderProductsTable(); renderClientsGrid();
  if (state.activeCompanyId) openCompanyDetailPage(state.activeCompanyId); else renderCompaniesGrid();
  renderExpensesTable(); renderAuditLog(); if (!$('view-reports').classList.contains('hidden')) renderReports();
}

/* ==================== Init ==================== */
if ('serviceWorker' in navigator) { window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => {}); }); }
window.addEventListener('DOMContentLoaded', async function () {
  await loadFromStorage(); refreshCategoryWidgets(); initPOSCategories(); loadStoreInfoToSettings(); renderAll();
  setTimeout(() => { const q = $('quickEntryInput'); if (q) q.focus(); }, 300);
});
