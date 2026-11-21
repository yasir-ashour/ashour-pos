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
    products: IMPORTED_PRODUCTS.map((p,i) => ({ id: (i+1).toString(), sku: (101+i).toString(), name: p.name, category: p.category, cost: 0, retailPrice: 0, wholesalePrice: 0 })),
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

/* ==================== Navigation ==================== */
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

/* ==================== POS ==================== */
function initPOSCategories() {
  const cats = ['الكل', ...allCategories()];
  if (!cats.includes(state.selectedPosCategory)) state.selectedPosCategory = 'الكل';
  const sidebar = $('posCategorySidebar');
  if (sidebar) sidebar.innerHTML = cats.map(cat => {
      const active = state.selectedPosCategory === cat;
      const count = cat === 'الكل' ? state.products.length : state.products.filter(p => p.category === cat).length;
      return `<button onclick="setPosCat('${esc(cat)}')" class="w-full text-right px-2.5 py-2 rounded-lg transition flex items-center justify-between ${active ? 'bg-ashour text-white shadow-sm' : 'bg-gray-50 text-gray-700 hover:bg-gray-100'}"><span>${esc(cat)}</span><span class="text-[10px] ${active ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'} px-1.5 py-0.5 rounded-full font-black">${count}</span></button>`;
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
    return okCat && (!search || normalizeArabic(p.name).includes(search) || normalizeArabic(p.sku).includes(search));
  });
  if (!filtered.length) { $('posProductsGrid').innerHTML = `<div class="col-span-full text-center py-10 text-gray-400 text-xs font-bold">لا توجد منتجات مطابقة</div>`; return; }
  $('posProductsGrid').innerHTML = filtered.map(p => {
    const price = toNum(p[priceKey]);
    return `<div onclick="addToCart('${esc(p.id)}')" class="product-card bg-white border hover:border-ashour cursor-pointer transition flex flex-col justify-between border-gray-200 card-hover animate-fade-slide-up relative group">
      <div><span class="text-[10px] text-ashour font-black block bg-ashour/10 px-1.5 py-0.5 rounded w-fit">${esc(p.sku || '-')}</span><h4 class="font-black text-xs text-gray-800 line-clamp-2 leading-tight mt-1.5">${esc(p.name)}</h4></div>
      <div class="mt-2 flex items-end justify-between border-t border-gray-100 pt-1.5"><span class="text-xs ${price > 0 ? 'text-ashour font-black' : 'text-red-500 font-bold text-[10px]'}">${price > 0 ? fmtCur(price) : 'حدد السعر'}</span><div class="w-6 h-6 bg-ashour/10 text-ashour rounded-md flex items-center justify-center group-hover:bg-ashour group-hover:text-white transition"><i class="fa-solid fa-plus text-[10px]"></i></div></div>
    </div>`;
  }).join('');
}

function handleQuickEntry(ev) {
  if (ev.key !== 'Enter') return;
  const input = ev.target, val = input.value.trim(); if (!val) return;
  let code = val, qty = 1;
  if (val.includes('*')) { const parts = val.split('*'); if (parts.length === 2) { code = parts[0].trim(); qty = parseInt(parts[1].trim(), 10) || 1; } }
  const product = state.products.find(p => String(p.sku || '') === code || normalizeArabic(p.name).includes(normalizeArabic(code)));
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
      return `<div class="py-2 flex items-center justify-between gap-2"><div class="flex-grow min-w-0"><h5 class="font-bold text-xs text-gray-800 truncate">${esc(info.name)}</h5><span class="text-[10px] text-gray-500 font-bold">${fmt(info.unitPrice)} × ${item.qty}</span></div><div class="flex items-center gap-1"><button onclick="updateCartQty('${esc(info.key)}', -1)" class="w-6 h-6 bg-gray-200 hover:bg-red-500 hover:text-white rounded text-xs font-black">−</button><span class="w-7 text-center text-xs font-black">${item.qty}</span><button onclick="updateCartQty('${esc(info.key)}', 1)" class="w-6 h-6 bg-gray-200 hover:bg-ashour hover:text-white rounded text-xs font-black">+</button></div><div class="text-left font-black text-xs text-ashour min-w-[85px]">${fmtCur(calcLineTotal(info.unitPrice, item.qty))}</div></div>`;
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
