/* ashour-fixes.js — يُحمَّل بعد app.js مباشرة */
(function () {
  'use strict';
  const CLEAN_FLAG = 'ashour_cleanstart_v1';
  const rate = () => toNum(state.exchangeRate) || 15000;

  /* ---------- 1) العملة: الإدخال دائماً بالليرة، والدولار للعرض فقط ---------- */
  window.fmtCur = function (n) {
    if (state.showUsd) {
      return '$' + (toNum(n) / rate()).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return fmt(n) + ' ل.س.ج';
  };
  window.toggleCurrency = async function () {
    state.showUsd = !state.showUsd;
    state.displayCurrency = 'SYP';
    syncCurrencyButtons();
    await saveToStorage();
    renderAll();
    toast(state.showUsd ? 'العرض بالدولار' : 'العرض بالليرة السورية', 'info');
  };
  function syncCurrencyButtons() {
    ['currencyToggleBtn', 'currencyToggleBtnDesktop'].forEach(id => { const b = $(id); if (b) b.textContent = state.showUsd ? 'USD' : 'SYP'; });
  }

  // رصيد الزبون: الاستردادات (مبالغ سالبة) لا تزيد الدين
  window.getClientDebt = function (clientId) {
    const c = state.clients.find(x => x.id === clientId);
    if (!c) return 0;
    const raw = roundMoney(
      toNum(c.openingDebt) +
      sumList(state.invoices.filter(i => i.clientId === clientId && i.status === 'active'), i => i.remaining) -
      sumList(state.payments.filter(p => p.clientId === clientId && toNum(p.amount) > 0), p => p.amount) -
      sumList(state.returns.filter(r => r.clientId === clientId), r => r.amount)
    );
    return Math.max(0, raw);
  };

  /* ---------- 2) سعر الصرف يدوياً من الإعدادات ---------- */
  window.repriceUsdProducts = function () {
    const r = rate();
    state.products.forEach(p => {
      if (p.currency === 'USD' && p.usd) {
        p.cost = Math.round(toNum(p.usd.cost) * r);
        p.retailPrice = Math.round(toNum(p.usd.retail) * r);
        p.wholesalePrice = Math.round(toNum(p.usd.wholesale) * r);
      }
    });
  };
  window.saveExchangeRate = async function () {
    const v = toNum($('setRate').value);
    if (!(v > 0)) return warn('خطأ', 'أدخل سعر صرف صحيحاً');
    const prev = state.exchangeRate;
    state.exchangeRate = v;
    repriceUsdProducts();
    logAudit('تعديل سعر الصرف', `1$ = ${fmt(v)} ل.س`);
    if (!(await saveToStorage())) { state.exchangeRate = prev; repriceUsdProducts(); return; }
    renderAll();
    toast('تم حفظ سعر الصرف');
  };
  const _loadStore = window.loadStoreInfoToSettings;
  window.loadStoreInfoToSettings = function () {
    _loadStore();
    const r = $('setRate'); if (r) r.value = rate();
  };

  /* ---------- 3) منتج بسعر الدولار ---------- */
  window.setProdCur = function (cur) {
    $('prodCurrency').value = cur;
    $('prodCurBtn').textContent = cur === 'USD'
      ? 'عملة المنتج: دولار ($) — اضغط للتبديل إلى الليرة'
      : 'عملة المنتج: ليرة سورية — اضغط للتبديل إلى الدولار';
  };
  window.toggleProdCurrency = function () { setProdCur($('prodCurrency').value === 'USD' ? 'SYP' : 'USD'); };
  const _openProd = window.openProductModal;
  window.openProductModal = function (id = null) {
    _openProd(id);
    const p = id ? state.products.find(x => x.id === id) : null;
    if (p && p.currency === 'USD' && p.usd) {
      setProdCur('USD');
      $('prodCostInput').value = p.usd.cost || '';
      $('prodRetailInput').value = p.usd.retail || '';
      $('prodWholesaleInput').value = p.usd.wholesale || '';
    } else setProdCur('SYP');
  };
  window.saveProduct = async function () {
    const editId = $('prodEditId').value;
    let sku = $('prodSkuInput').value.trim();
    const barcode = $('prodBarcodeInput').value.trim();
    const name = $('prodNameInput').value.trim();
    const category = $('prodCatInput').value.trim() || 'مواد غذائية';
    const cur = $('prodCurrency').value;
    const raw = { cost: toNum($('prodCostInput').value), retail: toNum($('prodRetailInput').value), wholesale: toNum($('prodWholesaleInput').value) };
    if (!name) return warn('خطأ', 'أدخل اسم المنتج');
    if (raw.retail <= 0 && raw.wholesale <= 0) return warn('خطأ', 'أدخل سعراً واحداً على الأقل');
    if (!sku) sku = generateUniqueSku();
    const toSyp = v => (cur === 'USD' ? Math.round(v * rate()) : v);
    const data = { sku, barcode, name, category, cost: toSyp(raw.cost), retailPrice: toSyp(raw.retail), wholesalePrice: toSyp(raw.wholesale), currency: cur, usd: cur === 'USD' ? raw : null };

    const dup = state.products.find(p => p.sku === sku && p.id !== editId);
    if (dup) return warn('كود مكرر', `الكود ${sku} مستخدم للمنتج: ${dup.name}`, 'error');
    if (barcode) {
      const dupB = state.products.find(p => p.barcode === barcode && p.id !== editId);
      if (dupB) return warn('باركود مكرر', `الباركود ${barcode} مستخدم للمنتج: ${dupB.name}`, 'error');
    }
    let previous = null;
    if (editId) {
      const p = state.products.find(x => x.id === editId);
      if (!p) return;
      previous = { ...p };
      Object.assign(p, data);
      logAudit('تعديل منتج', name);
    } else {
      state.products.push({ id: Date.now().toString(), ...data });
      logAudit('إضافة منتج', `${name} (كود: ${sku})`);
    }
    if (!(await saveToStorage())) {
      if (editId && previous) { const p = state.products.find(x => x.id === editId); if (p) Object.assign(p, previous); }
      else state.products.pop();
      return;
    }
    closeModal('productModal');
    refreshCategoryWidgets();
    renderAll();
    toast('تم الحفظ');
  };

  /* ---------- 4) صورة الفاتورة: أعمدة واضحة وأرقام لاتينية ---------- */
  const style = document.createElement('style');
  style.textContent = `
    #printableReceipt table{table-layout:fixed;width:100%;border-collapse:collapse}
    #printableReceipt th,#printableReceipt td{padding:5px 4px;vertical-align:middle;word-break:break-word}
    #printableReceipt .rn{direction:ltr;unicode-bidi:isolate;white-space:nowrap;text-align:center;font-variant-numeric:tabular-nums;letter-spacing:0}
    #printableReceipt .rl{direction:ltr;unicode-bidi:isolate;display:inline-block}`;
  document.head.appendChild(style);

  function fmtDateTime(ts) {
    const d = new Date(ts || Date.now()), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}  ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function fixReceiptLayout(inv) {
    const wrapLtr = (id, text) => { const el = $(id); if (el) el.innerHTML = `<span class="rl">${esc(text)}</span>`; };
    wrapLtr('recNum', '#' + inv.id);
    wrapLtr('recDate', fmtDateTime(inv.ts));
    wrapLtr('recStorePhone', 'هاتف: ' + (state.storeInfo.phone || '-'));
    const tbl = $('recItemsBody') && $('recItemsBody').closest('table');
    if (!tbl) return;
    if (!tbl.querySelector('colgroup')) {
      tbl.insertAdjacentHTML('afterbegin', '<colgroup><col style="width:34%"><col style="width:12%"><col style="width:26%"><col style="width:28%"></colgroup>');
    }
    tbl.querySelectorAll('tr').forEach(tr => {
      [...tr.children].forEach((c, i) => { if (i > 0) c.classList.add('rn'); });
    });
  }
  const _show = window.showReceiptModal;
  window.showReceiptModal = function (inv) { _show(inv); fixReceiptLayout(inv); };

  window.generateReceiptCanvas = async function () {
    if (typeof html2canvas === 'undefined') throw new Error('html2canvas غير محملة');
    const src = $('printableReceipt');
    if (!src) throw new Error('عنصر الفاتورة غير موجود');
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;left:-9999px;top:0;width:400px;padding:12px;background:#fff;direction:rtl;font-family:"IBM Plex Sans Arabic",Inter,sans-serif;font-size:14px;color:#000';
    const clone = src.cloneNode(true);
    clone.removeAttribute('id');
    clone.style.cssText = 'width:376px;border:0;padding:6px;background:#fff;color:#000;border-radius:0';
    wrap.appendChild(clone);
    document.body.appendChild(wrap);
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      return await html2canvas(wrap, { scale: 3, backgroundColor: '#ffffff', useCORS: true, logging: false, width: 400, windowWidth: 400 });
    } finally { wrap.remove(); }
  };

  /* ---------- 5) مشاركة الفاتورة PDF (بدون مكتبات) ---------- */
  function buildPdf(jpeg, w, h) {
    const W = 226.77, H = (W * h) / w, parts = [], offs = [];
    let len = 0;
    const add = b => { if (typeof b === 'string') b = new TextEncoder().encode(b); parts.push(b); len += b.length; };
    const obj = (n, body) => { offs[n] = len; add(`${n} 0 obj\n${body}\nendobj\n`); };
    add('%PDF-1.4\n');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W.toFixed(2)} ${H.toFixed(2)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
    offs[4] = len;
    add(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
    add(jpeg); add('\nendstream\nendobj\n');
    const content = `q ${W.toFixed(2)} 0 0 ${H.toFixed(2)} 0 0 cm /Im0 Do Q`;
    obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const xref = len;
    add('xref\n0 6\n0000000000 65535 f \n');
    for (let i = 1; i <= 5; i++) add(String(offs[i]).padStart(10, '0') + ' 00000 n \n');
    add(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
    return new Blob(parts, { type: 'application/pdf' });
  }
  window.shareReceiptPDF = async function () {
    try {
      toast('جاري تجهيز PDF...', 'info');
      const canvas = await generateReceiptCanvas();
      const bin = atob(canvas.toDataURL('image/jpeg', 0.92).split(',')[1]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = buildPdf(bytes, canvas.width, canvas.height);
      const id = state.currentReceiptInv ? state.currentReceiptInv.id : Date.now();
      const file = new File([blob], `فاتورة_${id}.pdf`, { type: 'application/pdf' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ title: `فاتورة ${id}`, files: [file] }); return; }
        catch (e) { if (e.name === 'AbortError') return; }
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = file.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (_) { warn('تنبيه', 'تعذر إنشاء PDF، استخدم الطباعة.', 'error'); }
  };

  /* ---------- 6) الطلبات من شاشة الكاشير ---------- */
  window.addCartToOrders = async function () {
    if (!state.cart.length) return warn('السلة فارغة', 'أضف منتجات أولاً');
    const client = getSelectedPosClient();
    if (!client || client.id === 'c1') return warn('اختر الزبون', 'اختر اسم الزبون من القائمة لإضافة الطلب', 'info');
    const { value: v } = await Swal.fire({
      title: 'موعد الاستلام',
      html: `<input id="oDate" type="date" class="swal2-input" value="${dayKey(Date.now())}"><input id="oTime" type="time" class="swal2-input">`,
      showCancelButton: true, confirmButtonText: 'إضافة وطباعة', cancelButtonText: 'إلغاء', confirmButtonColor: '#0F5C4E',
      preConfirm: () => ({ d: $('oDate').value, t: $('oTime').value })
    });
    if (!v) return;
    const items = state.cart.map(it => {
      const i = getCartItemInfo(it);
      return i ? { name: i.name, qty: toNum(it.qty), price: i.unitPrice } : null;
    }).filter(Boolean);
    const { total, discount } = cartTotals();
    const order = {
      id: 'ORD-' + Date.now(), clientId: client.id, clientName: client.name, clientPhone: client.phone || '',
      items, total, notes: '', dueDate: v.d, dueTime: v.t, status: 'pending', createdAt: Date.now(), deliveredAt: null
    };
    state.orders.push(order);
    logAudit('طلب جديد', `${client.name} - ${items.length} صنف - ${v.d} ${v.t}`);
    if (!(await saveToStorage())) { state.orders.pop(); return; }
    clearCart();
    updateOrdersBadge();
    renderOrders();
    showReceiptModal({
      id: order.id, ts: order.createdAt, date: nowStr(), clientId: client.id, clientName: client.name,
      priceMode: `طلب — الاستلام ${v.d} ${v.t || ''}`.trim(),
      items: items.map(i => ({ ...i, total: calcLineTotal(i.price, i.qty) })),
      discount, total, paid: 0, remaining: 0, changeGiven: 0
    });
    toast('أُضيف الطلب إلى القائمة');
  };
  const _openOrder = window.openOrderModal;
  window.openOrderModal = function (orderId = null) {
    if (orderId) return _openOrder(orderId);
    switchTab('pos');
    toast('أضف الأصناف ثم اضغط «إضافة إلى الطلبات»', 'info');
  };

  // البيع السريع نقدي بالكامل: كان المتبقي يُسجَّل على لا أحد فيضيع الدين
  window.saveDirectSale = async function () {
    const name = $('dsName').value.trim();
    const qty = Math.max(1, parseInt($('dsQty').value, 10) || 1);
    const price = toNum($('dsPrice').value);
    if (!name) return warn('خطأ', 'أدخل اسم الصنف');
    if (price <= 0) return warn('خطأ', 'أدخل سعراً صحيحاً');
    const total = calcLineTotal(price, qty);
    const paidRaw = $('dsPaid').value.trim();
    if (paidRaw !== '' && toNum(paidRaw) < total) {
      return warn('الدفع ناقص', 'البيع السريع نقدي بالكامل. للبيع الآجل استخدم الكاشير مع اختيار زبون.', 'info');
    }
    const costRaw = $('dsCost') ? $('dsCost').value.trim() : '';
    const unitCost = costRaw === '' ? null : toNum(costRaw);
    const profit = unitCost == null ? 0 : roundMoney(total - calcLineTotal(unitCost, qty));   // بدون تكلفة: لا يُحسب ربح
    const sale = { id: 'QS-' + Date.now(), ts: Date.now(), date: nowStr(), name, price, qty, total, paid: total, remaining: 0, profit, cost: unitCost };
    state.directSales.push(sale);
    logAudit('بيع سريع', `${qty} × ${name} بقيمة ${fmtCur(total)}`);
    if (!(await saveToStorage())) { state.directSales.pop(); return; }
    closeModal('directSaleModal');
    renderAll();
    toast(`تم تسجيل ${qty} × ${name}`);
  };

  /* ---------- 7) بدء نظيف مرة واحدة (يُبقي المنتجات فقط) + حذف زر التصفير ---------- */
  window.factoryReset = function () {};
  async function cleanStartOnce() {
    if (localStorage.getItem(CLEAN_FLAG)) return;
    const hasData = ['invoices', 'expenses', 'payments', 'returns', 'directSales', 'companies', 'purchases', 'companyPayments', 'personDebts', 'orders']
      .some(k => (state[k] || []).length) || state.clients.length > 1;
    if (!hasData) { localStorage.setItem(CLEAN_FLAG, '1'); return; }
    const r = await Swal.fire({
      icon: 'warning', title: 'بدء نظيف',
      html: 'سيُحذف كل شيء <b>ما عدا المنتجات</b>: الفواتير والمرتجعات والزبائن والشركات والمشتريات والمصاريف والطلبات والسجل.',
      showDenyButton: true, showCancelButton: true,
      confirmButtonText: 'احذف الآن', denyButtonText: 'نزّل نسخة أولاً', cancelButtonText: 'لاحقاً',
      confirmButtonColor: '#d33', denyButtonColor: '#0F5C4E', allowOutsideClick: false
    });
    if (r.isDenied) { await exportDataBackup(); return cleanStartOnce(); }
    if (!r.isConfirmed) return;
    const d = defaultState();
    ['invoices', 'expenses', 'payments', 'returns', 'directSales', 'noInvoiceItems', 'companies', 'purchases', 'companyPayments', 'personDebts', 'orders']
      .forEach(k => { state[k] = []; });
    state.clients = d.clients; state.auditLog = d.auditLog; state.invoiceCounter = 1000;
    state.cart = []; state.currentLedgerClientId = null; state.activeCompanyId = null;
    state.lastUpdated = Date.now();
    state.trash = [];
    snap = null;   // لا تُحفَظ السجلات المحذوفة عمداً في سلة المحذوفات
    if (!(await saveToStorage())) return;
    localStorage.setItem(CLEAN_FLAG, '1');
    refreshCategoryWidgets(); renderAll();
    Swal.fire({ icon: 'success', title: 'تم البدء من جديد', text: 'بقيت المنتجات فقط.', confirmButtonColor: '#0F5C4E' });
  }

  /* ---------- 8) أرقام الفواتير: لاحقة خاصة بكل جهاز لمنع التكرار بين جهازين ---------- */
  const devTag = () => {
    let d = localStorage.getItem('ashour_dev');
    if (!d) {
      d = String.fromCharCode(65 + (Math.random() * 26 | 0)) + String.fromCharCode(65 + (Math.random() * 26 | 0));
      localStorage.setItem('ashour_dev', d);
    }
    return d;
  };
  window.nextInvoiceNumber = function () {
    state.invoiceCounter = toNum(state.invoiceCounter || 1000) + 1;
    return 'INV-' + state.invoiceCounter + '-' + devTag();
  };

  /* ---------- 9) سلة المحذوفات: أي سجل يُحذف يُحفظ نسخة منه في state.trash ---------- */
  const TRASH_KEYS = ['products', 'clients', 'companies', 'payments', 'companyPayments', 'purchases', 'expenses', 'personDebts', 'directSales', 'orders', 'returns'];
  let snap = null;
  const takeSnap = () => {
    snap = {};
    TRASH_KEYS.forEach(k => { snap[k] = new Map((state[k] || []).filter(x => x && x.id != null).map(x => [String(x.id), x])); });
  };
  const _save = window.saveToStorage;
  window.saveToStorage = async function () {
    if (!snap) takeSnap();
    const removed = [];
    TRASH_KEYS.forEach(k => {
      const now = new Set((state[k] || []).map(x => x && String(x.id)));
      snap[k].forEach((rec, id) => { if (!now.has(id)) removed.push({ col: k, ts: Date.now(), rec }); });
    });
    const prevTrash = state.trash;
    if (removed.length) state.trash = [...(state.trash || []), ...removed].slice(-2000);
    const ok = await _save();
    if (ok) takeSnap(); else state.trash = prevTrash;
    return ok;
  };

  /* ---------- 10) التصميم الجديد للابتوب: قائمة جانبية يمين + اختصارات ---------- */
  const design = document.createElement('style');
  design.textContent = `@media (min-width:1024px){
    body{background:#EEF3F2}
    header.header-gradient{position:fixed;top:0!important;right:0;bottom:0;width:230px;height:100vh;z-index:30;overflow-y:auto}
    header.header-gradient>div{flex-direction:column;align-items:stretch;justify-content:flex-start;height:100%;max-width:none;padding:18px 12px;gap:14px}
    header.header-gradient nav{flex-direction:column;align-items:stretch;gap:4px;overflow:visible;width:100%;flex:1}
    .tab-btn{display:flex;align-items:center;gap:10px;width:100%;text-align:right;padding:11px 14px!important;border-radius:12px!important;font-size:14px}
    .tab-btn i{width:20px;text-align:center}
    .tab-btn.active{background:#fff!important;color:#0F5C4E;box-shadow:0 4px 12px -4px rgba(0,0,0,.3)}
    header.header-gradient>div>div:last-child{flex-direction:column;align-items:stretch;width:100%}
    main{margin:0 230px 0 0!important;max-width:none!important;padding:16px 20px!important}
    .sticky{top:12px!important}
    #posProductsGrid{max-height:calc(100vh - 190px)}
    div:has(>#quickEntryInput){width:300px!important}
    #quickEntryInput{font-size:16px;padding:12px}
  }`;
  document.head.appendChild(design);
  document.addEventListener('keydown', e => {
    const ov = $('pinOverlay');
    if (ov && !ov.classList.contains('hidden')) return;
    const typing = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName || '');
    if (e.key === 'F3') { e.preventDefault(); switchTab('pos'); const s = $('posSearch'); if (s) s.focus(); }
    else if (e.key === 'F8') { e.preventDefault(); const p = $('posPaidAmount'); if (p) p.focus(); }
    else if (e.key === '/' && !typing) { e.preventDefault(); const q = $('quickEntryInput'); if (q) q.focus(); }
  });
  whenReady(() => $('currencyToggleBtnDesktop'), () => {
    const box = $('currencyToggleBtnDesktop').parentElement;
    if (box && !$('kbHint')) {
      const h = document.createElement('div');
      h.id = 'kbHint'; h.className = 'hidden lg:block text-[10px] opacity-70 text-center mt-2 leading-5';
      h.textContent = 'F2 بيع سريع • F3 بحث • F4 حفظ • / باركود';
      box.appendChild(h);
    }
  });

  /* ---------- 11) استعادة المحذوفات ---------- */
  const colName = { products: 'منتج', clients: 'زبون', companies: 'شركة', payments: 'دفعة زبون', companyPayments: 'دفعة شركة', purchases: 'فاتورة شراء', expenses: 'مصروف', personDebts: 'دين شخصي', directSales: 'بيع سريع', orders: 'طلب', returns: 'مرتجع' };
  const recLabel = r => r.name || r.title || r.clientName || r.companyName || r.id;
  window.openTrash = function () {
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
  };
  window.restoreTrash = async function (i) {
    const t = (state.trash || [])[i];
    if (!t) return;
    if (!Array.isArray(state[t.col])) state[t.col] = [];
    if (!state[t.col].some(x => String(x.id) === String(t.rec.id))) state[t.col].push(t.rec);
    state.trash.splice(i, 1);
    if (!(await saveToStorage())) return;
    refreshCategoryWidgets(); renderAll();
    Swal.close(); toast('تمت الاستعادة');
  };
  whenReady(() => $('storageStatus'), () => {
    const box = $('storageStatus').closest('.space-y-2');
    if (box && !$('trashBox')) {
      const d = document.createElement('div');
      d.id = 'trashBox'; d.className = 'space-y-2 mt-4';
      d.innerHTML = '<h3 class="font-bold text-sm text-slate-800"><i class="fa-solid fa-trash-can-arrow-up text-amber-600"></i> سلة المحذوفات</h3><button onclick="openTrash()" class="bg-amber-600 hover:bg-amber-700 text-white font-bold text-sm px-4 py-2 rounded-xl">عرض واستعادة المحذوفات</button>';
      box.after(d);
    }
  });

  /* ---------- 12) تحويل الطلب إلى فاتورة: لا يُغلق الطلب إلا بعد حفظ الفاتورة ---------- */
  let pendingOrderId = null;
  window.convertOrderToInvoice = async function (orderId) {
    const order = state.orders.find(o => o.id === orderId);
    if (!order) return;
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
    pendingOrderId = order.id;
    switchTab('pos'); renderCart();
    toast('أكمل الفاتورة واضغط حفظ، وسيُغلق الطلب بعدها', 'info');
  };
  const _checkout = window.checkoutPOS;
  window.checkoutPOS = async function () {
    const before = state.invoices.length;
    await _checkout();
    if (pendingOrderId && state.invoices.length > before) {
      const o = state.orders.find(x => x.id === pendingOrderId);
      if (o) {
        o.status = 'delivered'; o.deliveredAt = Date.now();
        o.invoiceId = state.invoices[state.invoices.length - 1].id;
        await saveToStorage(); renderOrders(); updateOrdersBadge();
      }
      pendingOrderId = null;
    }
  };
  const _clear = window.clearCart;
  window.clearCart = function () { pendingOrderId = null; _clear(); };

  /* ---------- 13) PIN وشاشة البداية وزر الرجوع وفاتورة ملغاة ---------- */
  const pinCss = document.createElement('style');
  pinCss.textContent = '#pinOverlay{background:#0f172a!important;backdrop-filter:none!important}';
  document.head.appendChild(pinCss);
  function buildPinDots() {
    const el = $('pinDots'); if (!el) return;
    el.innerHTML = Array.from({ length: state.pinLength || 4 }, () => '<div class="w-3.5 h-3.5 rounded-full border-2 border-ashour pin-dot transition"></div>').join('');
  }
  whenReady(() => typeof state === 'object' && state.pinLength && $('pinDots'), buildPinDots);
  const _chg = window.changePinCode;
  window.changePinCode = async function () { await _chg(); buildPinDots(); };
  setTimeout(() => { const s = $('ashour-intro'); if (s) s.remove(); }, 3200);   // لا يعلق الشعار إن تأخرت مكتبة خارجية

  window.addEventListener('popstate', e => {
    const open = id => $(id) && !$(id).classList.contains('hidden');
    if (MODAL_IDS.some(open)) return;
    const back = open('view-client-detail') ? 'clients' : (open('view-company-detail') ? 'companies' : null);
    if (back) { e.stopImmediatePropagation(); switchTab(back); history.pushState(null, null, location.href); }
  }, true);

  const _show2 = window.showReceiptModal;
  window.showReceiptModal = function (inv) {
    _show2(inv);
    const old = $('recCancelled'); if (old) old.remove();
    if (inv.status === 'cancelled') {
      const d = document.createElement('div');
      d.id = 'recCancelled'; d.className = 'text-center font-bold text-rose-700 border-2 border-rose-600 rounded-lg py-1 my-2';
      d.textContent = 'فاتورة ملغاة';
      $('recNum').closest('.space-y-1').before(d);
    }
  };

  /* ---------- 14) علامة ' في الأسماء لم تعد تكسر الأزرار ---------- */
  window.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"'\\]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#8217;', '\\': '&#8726;' }[c]));
  };
  const plainQ = s => String(s).replace(/'/g, '\u2019');
  const realCat = cat => allCategories().find(c => plainQ(c) === cat) || cat;
  const _setCat = window.setPosCat;
  window.setPosCat = function (cat) { _setCat(realCat(cat)); };
  const _selCat = window.selectProdCat;
  window.selectProdCat = function (cat) { _selCat(realCat(cat)); };

  /* ---------- 15) السلة كجدول: الصنف | الكمية | السعر | الإجمالي | حذف ---------- */
  const _renderCart = window.renderCart;
  window.renderCart = function () {
    _renderCart();
    const box = $('cartItemsList');
    if (!box || !state.cart.length) return;
    const btn = 'w-6 h-6 bg-slate-200 rounded text-xs font-bold';
    const rows = state.cart.map(item => {
      const i = getCartItemInfo(item);
      if (!i) return '';
      const k = esc(i.key);
      return `<tr class="border-b border-slate-100 num-tabular">
        <td class="py-2 pr-1 font-bold text-xs">${esc(i.name)}${i.isCustom ? ' <span class="text-[10px] bg-purple-100 text-purple-800 px-1 rounded">خاص</span>' : ''}</td>
        <td class="py-2"><div class="flex items-center justify-center gap-1">
          <button onclick="updateCartQty('${k}',-1)" class="${btn} hover:bg-rose-500 hover:text-white">−</button>
          <input type="number" min="0" step="any" value="${item.qty}" onchange="setCartItemQtyDirect('${k}',this.value)" class="w-12 text-center bg-slate-50 border border-slate-300 rounded text-xs font-bold py-0.5">
          <button onclick="updateCartQty('${k}',1)" class="${btn} hover:bg-ashour hover:text-white">+</button></div></td>
        <td class="py-2 text-center text-xs">${fmt(i.unitPrice)}</td>
        <td class="py-2 text-left text-xs font-bold text-ashour">${fmt(calcLineTotal(i.unitPrice, item.qty))}</td>
        <td class="py-2 text-center"><button onclick="setCartItemQtyDirect('${k}',0)" title="حذف" class="text-rose-500 hover:text-rose-700"><i class="fa-solid fa-trash text-xs"></i></button></td></tr>`;
    }).join('');
    box.innerHTML = `<table class="w-full text-right"><thead><tr class="text-[11px] text-slate-500 border-b">
      <th class="pb-1 pr-1">الصنف</th><th class="pb-1 text-center">الكمية</th><th class="pb-1 text-center">السعر</th><th class="pb-1 text-left">الإجمالي</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  };

  /* ---------- 16) التكلفة في البيع السريع والمنتج السريع (لا ربح وهمي) ---------- */
  function costField(id, label) {
    const d = document.createElement('div');
    d.innerHTML = `<label class="block mb-1 text-slate-500 text-xs">${label}</label><input type="number" step="any" id="${id}" placeholder="اختياري — بدونها لا يُحسب ربح" class="w-full bg-slate-50 border rounded-xl p-2 text-xs">`;
    return d;
  }
  whenReady(() => $('dsSummaryText') && $('qpBarcode'), () => {
    if (!$('dsCost')) $('dsSummaryText').before(costField('dsCost', 'تكلفة الوحدة:'));
    if (!$('qpCost')) $('qpBarcode').parentElement.before(costField('qpCost', 'تكلفة الوحدة:'));
  });
  const _openDS = window.openDirectSaleModal;
  window.openDirectSaleModal = function () { _openDS(); if ($('dsCost')) $('dsCost').value = ''; };
  const _openQP = window.openQuickProductModal;
  window.openQuickProductModal = function (b) { _openQP(b); if ($('qpCost')) $('qpCost').value = ''; };
  const _saveQP = window.saveQuickProduct;
  window.saveQuickProduct = function () {
    const raw = $('qpCost') ? $('qpCost').value.trim() : '';
    const before = state.cart.length;
    _saveQP();
    if (raw !== '' && state.cart.length > before) state.cart[state.cart.length - 1].cost = toNum(raw);
    renderCart();
  };
  // سطر بدون تكلفة معروفة: تكلفته = سعره (ربحه صفر) بدل أن يُحسب كله ربحاً
  const _info = window.getCartItemInfo;
  window.getCartItemInfo = function (item) {
    const r = _info(item);
    if (r && item.isQuickOnly) r.unitCost = item.cost != null ? toNum(item.cost) : toNum(item.price);
    return r;
  };

  /* ---------- 17) الرصيد الدائن للزبون (له علينا) يظهر في كشف الحساب ---------- */
  const _ledger = window.renderLedgerSummary;
  window.renderLedgerSummary = function (clientId) {
    _ledger(clientId);
    const c = state.clients.find(x => x.id === clientId);
    if (!c) return;
    const bal = roundMoney(
      toNum(c.openingDebt) +
      sumList(state.invoices.filter(i => i.clientId === clientId && i.status === 'active'), i => i.remaining) -
      sumList(state.payments.filter(p => p.clientId === clientId && toNum(p.amount) > 0), p => p.amount) -
      sumList(state.returns.filter(r => r.clientId === clientId), r => r.amount)
    );
    if (bal < 0) {
      $('ledgerSummaryCards').insertAdjacentHTML('beforeend',
        `<div class="bg-white border border-emerald-300 rounded-xl p-3 shadow-sm col-span-2 md:col-span-4"><span class="block text-xs text-emerald-700">رصيد دائن للزبون (له علينا)</span><span class="text-sm font-bold text-emerald-700">${fmtCur(-bal)}</span></div>`);
    }
  };

  /* ---------- 18) قراءة آمنة + تغيير PIN الافتراضي + منتجات البسكويت مرة واحدة ---------- */
  window.loadFromStorage = async function () {
    const result = await AshourDB.load();
    if (!result.ok && result.error) {
      // فشلت القراءة (وليس أن البيانات غير موجودة): لا نكتب حالة فارغة فوق بياناتك
      await Swal.fire({ icon: 'error', title: 'تعذّر قراءة البيانات', text: 'لم يتغيّر شيء. أغلق التطبيق وأعد فتحه، وإن تكرر الأمر فاستعد من نسخة احتياطية.', allowOutsideClick: false, confirmButtonColor: '#d33' });
      throw new Error('load failed');
    }
    state = (result.ok && result.state) ? deepMerge(defaultState(), result.state) : defaultState();
    ['returns', 'directSales', 'noInvoiceItems', 'companies', 'payments', 'expenses', 'invoices', 'products', 'clients', 'purchases', 'companyPayments', 'personDebts', 'orders', 'trash']
      .forEach(k => { if (!Array.isArray(state[k])) state[k] = []; });
    state.clients.forEach(c => { if (!c.customPrices || typeof c.customPrices !== 'object') c.customPrices = {}; });
    if (!state.invoiceCounter) state.invoiceCounter = 1000;
    if (!state.pinSalt) state.pinSalt = generateSalt();
    if (!state.pinHash) { state.pinHash = await hashPin('1234', state.pinSalt); state.pinLength = 4; }
    if (!state.pinLength) state.pinLength = 4;
    await saveToStorage();
    startAutoBackup();
  };

  async function ensurePinChanged() {
    if ((await hashPin('1234', state.pinSalt)) !== state.pinHash) return;
    const r = await Swal.fire({
      icon: 'warning', title: 'غيّر رمز PIN الافتراضي', text: 'الرمز الحالي 1234 معروف للجميع. اختر رمزاً من 4 إلى 6 أرقام.',
      input: 'password', inputAttributes: { maxlength: 6, inputmode: 'numeric' },
      showCancelButton: true, confirmButtonText: 'حفظ', cancelButtonText: 'لاحقاً', confirmButtonColor: '#0F5C4E',
      inputValidator: v => (/^\d{4,6}$/.test(v || '') && v !== '1234') ? null : 'من 4 إلى 6 أرقام وغير 1234'
    });
    if (!r.isConfirmed) return;
    state.pinHash = await hashPin(r.value, state.pinSalt);
    state.pinLength = r.value.length;
    logAudit('تغيير PIN', 'تغيير الرمز الافتراضي');
    if (await saveToStorage()) { buildPinDots(); toast('تم تغيير PIN'); }
  }

  // كانت تعود المنتجات المحذوفة (بسكويت 200/300/500) عند كل تشغيل
  const _cookies = window.ensureCookieProducts;
  window.ensureCookieProducts = async function () {
    if (localStorage.getItem('ashour_cookies_done')) return;
    await _cookies();
    localStorage.setItem('ashour_cookies_done', '1');
  };

  /* ---------- تركيب الواجهة ---------- */
  function whenReady(cond, fn, tries = 200) {
    const t = setInterval(() => {
      let ok = false; try { ok = cond(); } catch (_) {}
      if (ok) { clearInterval(t); fn(); } else if (--tries <= 0) clearInterval(t);
    }, 300);
  }
  function mountUI() {
    state.displayCurrency = 'SYP';
    if (typeof state.showUsd !== 'boolean') state.showUsd = false;
    syncCurrencyButtons();
    repriceUsdProducts();

    // سعر الصرف في الإعدادات
    const store = $('setStoreName') && $('setStoreName').closest('.space-y-2');
    if (store && !$('rateBox')) {
      const box = document.createElement('div');
      box.id = 'rateBox'; box.className = 'space-y-2 pb-4 border-b border-slate-100';
      box.innerHTML = `<h3 class="font-bold text-sm text-slate-800"><i class="fa-solid fa-dollar-sign text-amber-500"></i> سعر صرف الدولار</h3>
        <div class="flex flex-wrap gap-2 items-center text-sm font-bold"><span>1$ =</span>
        <input id="setRate" type="number" step="any" class="w-40 bg-slate-50 border rounded-xl p-2 num-tabular"><span>ل.س</span>
        <button onclick="saveExchangeRate()" class="bg-ashour text-white px-4 py-2 rounded-xl">حفظ</button></div>
        <p class="text-xs text-slate-500">المنتجات المسعّرة بالدولار تتحدّث أسعارها بالليرة تلقائياً.</p>`;
      store.parentNode.insertBefore(box, store);
      $('setRate').value = rate();
    }
    // زر عملة المنتج
    const cat = $('prodCatInput') && $('prodCatInput').parentElement;
    if (cat && !$('prodCurBtn')) {
      const row = document.createElement('div');
      row.innerHTML = `<button type="button" id="prodCurBtn" onclick="toggleProdCurrency()" class="w-full bg-amber-100 text-amber-900 border border-amber-300 rounded-xl py-2 text-sm font-bold"></button><input type="hidden" id="prodCurrency" value="SYP">`;
      cat.parentNode.insertBefore(row, cat.nextSibling);
      setProdCur('SYP');
    }
    // زر الطلبات في الكاشير
    const pay = $('checkoutSaveBtn');
    if (pay && !$('addToOrdersBtn')) {
      const b = document.createElement('button');
      b.id = 'addToOrdersBtn'; b.type = 'button'; b.onclick = addCartToOrders;
      b.className = 'w-full bg-amber-500 hover:bg-amber-600 text-white font-bold py-2.5 rounded-xl shadow-sm transition text-sm';
      b.innerHTML = '<i class="fa-solid fa-clipboard-list"></i> إضافة إلى قائمة الطلبات';
      pay.parentNode.insertBefore(b, pay);
    }
    // زر PDF
    const grid = document.querySelector('#receiptModal .grid.grid-cols-2');
    if (grid && !$('pdfBtn')) {
      const b = document.createElement('button');
      b.id = 'pdfBtn'; b.onclick = shareReceiptPDF;
      b.className = 'bg-rose-600 text-white py-2 rounded-xl font-bold text-sm flex items-center justify-center gap-1 col-span-2';
      b.innerHTML = '<i class="fa-solid fa-file-pdf"></i> مشاركة PDF';
      grid.appendChild(b);
    }
    // حذف زر التصفير
    document.querySelectorAll('[onclick="factoryReset()"]').forEach(b => {
      const box = b.closest('.space-y-2');
      const hr = box && box.previousElementSibling;
      if (hr && hr.tagName === 'HR') hr.remove();
      (box || b).remove();
    });
    renderAll();
  }
  whenReady(() => typeof state === 'object' && Array.isArray(state.products) && $('setStoreName'), mountUI);
  whenReady(() => typeof state === 'object' && Array.isArray(state.products) && $('pinOverlay') && $('pinOverlay').classList.contains('hidden'), async () => { await cleanStartOnce(); await ensurePinChanged(); });
})();
