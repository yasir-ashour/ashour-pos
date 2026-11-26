/* updates.js — تصميم داكن + QR + PDF + reset PIN + نسخة تلقائية + تشفير + دخول 1234 */
(function () {
  'use strict';

  const SITE_PASSCODE = '1234';
  const AUTH_SESSION_KEY = 'ashour_site_unlocked_v2';
  const params = new URLSearchParams(location.search);

  function unlockNativePinOverlay() {
    const pinOverlay = document.getElementById('pinOverlay');
    if (pinOverlay) {
      pinOverlay.classList.add('hidden');
      pinOverlay.style.display = 'none';
    }
    if (typeof state === 'object' && state) {
      state.pinAttempts = 0;
      state.pinLockUntil = 0;
    }
  }

  function removeLoginGate() {
    const gate = document.getElementById('sitePasscodeOverlay');
    if (gate) gate.remove();
    unlockNativePinOverlay();
  }

  function showSiteLoginGate() {
    if (sessionStorage.getItem(AUTH_SESSION_KEY) === '1') {
      unlockNativePinOverlay();
      return;
    }
    if (document.getElementById('sitePasscodeOverlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'sitePasscodeOverlay';
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:99999',
      'background:linear-gradient(180deg,#0F2D3D 0%,#0A1E2A 100%)',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'padding:16px',
      'font-family:inherit',
      'direction:rtl'
    ].join(';');

    overlay.innerHTML = `
      <div style="width:100%;max-width:360px;background:#ffffff;border-radius:18px;padding:24px;box-shadow:0 20px 45px rgba(0,0,0,0.4);text-align:center;">
        <div style="width:54px;height:54px;margin:0 auto 12px;border-radius:14px;background:#0F5C4E;color:#ffffff;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;">
          <i class="fa-solid fa-shield-halved"></i>
        </div>
        <h2 style="margin:0 0 6px;font-size:19px;font-weight:800;color:#0F2D3D;">مركز عاشور</h2>
        <p style="margin:0 0 16px;font-size:13px;color:#475569;font-weight:600;">أدخل رمز الدخول (1234) للمتابعة</p>
        <form id="sitePasscodeForm">
          <input
            id="sitePasscodeInput"
            type="password"
            inputmode="numeric"
            autocomplete="current-password"
            placeholder="••••"
            style="width:100%;box-sizing:border-box;padding:12px 14px;font-size:22px;letter-spacing:8px;text-align:center;border:2px solid #CBD5E1;border-radius:12px;outline:none;color:#0F2D3D;font-weight:800;"
          />
          <div id="sitePasscodeError" style="min-height:20px;margin-top:8px;font-size:12px;font-weight:700;color:#DC2626;"></div>
          <button
            type="submit"
            style="width:100%;margin-top:6px;padding:12px 14px;border:none;border-radius:12px;background:#0F5C4E;color:#ffffff;font-size:14px;font-weight:800;cursor:pointer;"
          >
            دخول
          </button>
        </form>
      </div>
    `;

    (document.body || document.documentElement).appendChild(overlay);

    const form = overlay.querySelector('#sitePasscodeForm');
    const input = overlay.querySelector('#sitePasscodeInput');
    const errorEl = overlay.querySelector('#sitePasscodeError');

    setTimeout(() => input && input.focus(), 60);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const entered = (input.value || '').trim();
      if (entered === SITE_PASSCODE) {
        sessionStorage.setItem(AUTH_SESSION_KEY, '1');
        removeLoginGate();
      } else {
        errorEl.textContent = 'رمز الدخول غير صحيح';
        input.value = '';
        input.focus();
      }
    });
  }

  function lockSiteAccess() {
    sessionStorage.removeItem(AUTH_SESSION_KEY);
    const pinOverlay = document.getElementById('pinOverlay');
    if (pinOverlay) {
      pinOverlay.classList.remove('hidden');
      pinOverlay.style.display = '';
    }
    showSiteLoginGate();
  }

  if (params.get('resetpin') === 'ashour2026') {
    sessionStorage.removeItem(AUTH_SESSION_KEY);
    const tryReset = () => {
      if (typeof state === 'object' && state && typeof state.pinHash !== 'undefined') {
        state.pinHash = null;
        state.pinSalt = null;
        state.pinAttempts = 0;
        state.pinLockUntil = 0;
        state.pinLength = 4;
        const afterSave = () => {
          if (typeof Swal !== 'undefined') {
            Swal.fire({
              icon: 'success',
              title: 'تم',
              text: 'تمت إعادة ضبط الدخول. الرمز هو 1234.',
              timer: 1800,
              showConfirmButton: false
            }).then(() => {
              location.href = location.pathname;
            });
          } else {
            alert('تمت إعادة الضبط — الرمز 1234');
            location.href = location.pathname;
          }
        };
        if (typeof saveToStorage === 'function') {
          Promise.resolve(saveToStorage()).then(afterSave).catch(afterSave);
        } else {
          afterSave();
        }
      } else {
        setTimeout(tryReset, 250);
      }
    };
    setTimeout(tryReset, 500);
    return;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showSiteLoginGate, { once: true });
  } else {
    showSiteLoginGate();
  }

  if (params.get('statement')) {
    const clientId = params.get('statement');
    const tryOpen = () => {
      if (typeof state === 'object' && state && Array.isArray(state.clients)) {
        const c = state.clients.find(x => x.id === clientId);
        if (c && typeof openClientDetailPage === 'function') {
          if (sessionStorage.getItem(AUTH_SESSION_KEY) !== '1') { setTimeout(tryOpen, 800); return; }
          openClientDetailPage(clientId);
        }
      } else { setTimeout(tryOpen, 300); }
    };
    setTimeout(tryOpen, 1200);
  }

  const designCSS = document.createElement('style');
  designCSS.textContent = `
    @media (min-width: 1024px) {
      body { background: #F1F5F9 !important; }
      header.header-gradient {
        position: fixed !important; top: 0; right: 0; bottom: 0; left: auto !important;
        width: 240px !important; height: 100vh !important; z-index: 30 !important;
        overflow-y: auto !important;
        background: linear-gradient(180deg, #0F2D3D 0%, #0A1E2A 100%) !important;
        border-left: 1px solid rgba(255,255,255,0.08) !important;
        display: flex !important; flex-direction: column !important; padding: 0 !important;
      }
      header.header-gradient > div {
        flex-direction: column !important; align-items: stretch !important;
        justify-content: flex-start !important; height: 100% !important;
        max-width: none !important; padding: 16px 12px !important;
        gap: 8px !important; flex: 1 !important; display: flex !important;
      }
      header.header-gradient > div > div:first-child {
        width: 100% !important; padding-bottom: 14px !important;
        border-bottom: 1px solid rgba(255,255,255,0.1) !important;
        margin-bottom: 6px !important; display: flex !important;
        flex-direction: column !important; gap: 6px !important;
      }
      header.header-gradient > div > div:first-child > div:first-child { gap: 10px !important; }
      header.header-gradient > div > div:first-child h1 { font-size: 15px !important; }
      header.header-gradient > div > div:first-child .w-9 {
        width: 40px !important; height: 40px !important;
        background: #14B8A6 !important; border-radius: 12px !important;
      }
      header.header-gradient #syncStatus {
        font-size: 11px !important; text-align: right !important;
      }
      header.header-gradient nav {
        flex-direction: column !important; align-items: stretch !important;
        gap: 2px !important; overflow: visible !important;
        width: 100% !important; flex: 1 !important; padding: 0 !important;
      }
      header.header-gradient nav .tab-btn {
        display: flex !important; align-items: center !important;
        gap: 12px !important; width: 100% !important;
        text-align: right !important; padding: 11px 14px !important;
        border-radius: 10px !important; font-size: 13.5px !important;
        font-weight: 600 !important; color: rgba(255,255,255,0.78) !important;
        transition: all 0.15s ease !important; white-space: nowrap !important;
        background: transparent !important;
      }
      header.header-gradient nav .tab-btn i {
        width: 18px !important; text-align: center !important;
        font-size: 15px !important; flex-shrink: 0 !important;
      }
      header.header-gradient nav .tab-btn:hover {
        background: rgba(255,255,255,0.06) !important; color: #fff !important;
      }
      header.header-gradient nav .tab-btn.active {
        background: #fff !important; color: #0F2D3D !important;
        box-shadow: 0 4px 12px -4px rgba(0,0,0,0.4) !important; font-weight: 800 !important;
      }
      header.header-gradient nav .tab-btn.active i { color: #14B8A6 !important; }
      header.header-gradient > div > div:last-child {
        flex-direction: column !important; align-items: stretch !important;
        width: 100% !important; gap: 6px !important;
        padding-top: 14px !important; border-top: 1px solid rgba(255,255,255,0.1) !important;
        display: flex !important;
      }
      header.header-gradient > div > div:last-child button {
        width: 100% !important; justify-content: center !important;
        padding: 9px 10px !important; font-size: 12.5px !important;
      }
      main {
        margin: 0 240px 0 0 !important; max-width: none !important;
        padding: 14px 16px !important;
      }
      .pos-layout { grid-template-columns: 1fr 380px !important; }
      .pos-sidebar { display: none !important; }
      .sticky { top: 14px !important; }
      #posProductsGrid { max-height: calc(100vh - 180px) !important; }
    }
  `;
  document.head.appendChild(designCSS);

  function ensureQRBox() {
    const receipt = document.getElementById('printableReceipt');
    if (!receipt || receipt.querySelector('#receiptQRBox')) return;
    const qrBox = document.createElement('div');
    qrBox.id = 'receiptQRBox';
    qrBox.style.cssText = 'text-align:center;margin-top:8px;padding-top:6px;border-top:1px dashed #000;';
    qrBox.innerHTML = '<img id="receiptQRImg" alt="QR" style="width:90px;height:90px;display:none;background:#fff;margin:0 auto;" /><div style="font-size:9px;margin-top:2px;font-weight:700;">امسح للاطلاع على كشف حسابك</div>';
    receipt.appendChild(qrBox);
  }

  function generateQR(inv) {
    const img = document.getElementById('receiptQRImg');
    if (!img) return;
    if (!inv || !inv.clientId || inv.clientId === 'c1') { img.style.display = 'none'; return; }
    if (typeof QRCode === 'undefined') return;
    const base = location.origin + location.pathname;
    const url = `${base}?statement=${encodeURIComponent(inv.clientId)}`;
    try {
      QRCode.toDataURL(url, { width: 220, margin: 1, color: { dark: '#000000', light: '#FFFFFF' }, errorCorrectionLevel: 'M' },
        (err, dataUrl) => {
          if (!err && dataUrl) { img.src = dataUrl; img.style.display = 'inline-block'; }
          else { img.style.display = 'none'; }
        });
    } catch (e) { img.style.display = 'none'; }
  }

  async function generateReceiptPDFBlob() {
    const el = document.getElementById('printableReceipt');
    if (!el) throw new Error('receipt element missing');
    if (typeof html2canvas === 'undefined') throw new Error('html2canvas missing');
    const origOverflow = el.style.overflow, origHeight = el.style.height, origMaxHeight = el.style.maxHeight;
    el.style.overflow = 'visible'; el.style.height = 'auto'; el.style.maxHeight = 'none';
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    try {
      const canvas = await html2canvas(el, { scale: 4, backgroundColor: '#ffffff', useCORS: true, allowTaint: true, logging: false, windowWidth: el.scrollWidth, windowHeight: el.scrollHeight });
      const pageWidthMM = 80;
      const pageHeightMM = (canvas.height / canvas.width) * pageWidthMM;
      if (window.jspdf && window.jspdf.jsPDF) {
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [pageWidthMM, pageHeightMM] });
        const imgData = canvas.toDataURL('image/jpeg', 0.95);
        pdf.addImage(imgData, 'JPEG', 0, 0, pageWidthMM, pageHeightMM);
        return pdf.output('blob');
      }
      const jpegBin = atob(canvas.toDataURL('image/jpeg', 0.92).split(',')[1]);
      const bytes = new Uint8Array(jpegBin.length);
      for (let i = 0; i < jpegBin.length; i++) bytes[i] = jpegBin.charCodeAt(i);
      return buildManualPdf(bytes, canvas.width, canvas.height);
    } finally {
      el.style.overflow = origOverflow; el.style.height = origHeight; el.style.maxHeight = origMaxHeight;
    }
  }

  function buildManualPdf(jpegBytes, w, h) {
    const W = 226.77, H = (W * h) / w;
    const parts = [], offs = []; let len = 0;
    const add = b => { if (typeof b === 'string') b = new TextEncoder().encode(b); parts.push(b); len += b.length; };
    const obj = (n, body) => { offs[n] = len; add(`${n} 0 obj\n${body}\nendobj\n`); };
    add('%PDF-1.4\n');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W.toFixed(2)} ${H.toFixed(2)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
    offs[4] = len;
    add(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`);
    add(jpegBytes);
    add('\nendstream\nendobj\n');
    const content = `q ${W.toFixed(2)} 0 0 ${H.toFixed(2)} 0 0 cm /Im0 Do Q`;
    obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const xref = len;
    add('xref\n0 6\n0000000000 65535 f \n');
    for (let i = 1; i <= 5; i++) add(String(offs[i]).padStart(10, '0') + ' 00000 n \n');
    add(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
    return new Blob(parts, { type: 'application/pdf' });
  }

  async function shareReceiptPDF() {
    try {
      if (typeof toast === 'function') toast('جاري تجهيز PDF...', 'info');
      const blob = await generateReceiptPDFBlob();
      const invId = (typeof state === 'object' && state.currentReceiptInv) ? state.currentReceiptInv.id : Date.now();
      const fileName = `فاتورة_${invId}.pdf`;
      const file = new File([blob], fileName, { type: 'application/pdf' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ title: `فاتورة ${invId}`, files: [file] }); return; }
        catch (e) { if (e.name === 'AbortError') return; }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fileName;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      if (typeof toast === 'function') toast('تم حفظ PDF', 'success');
    } catch (err) {
      if (typeof warn === 'function') warn('تنبيه', 'تعذر إنشاء PDF: ' + err.message, 'error');
      else alert('تعذر إنشاء PDF: ' + err.message);
    }
  }
  window.shareReceiptPDF = shareReceiptPDF;

  function patchReceiptModal() {
    if (typeof window.showReceiptModal === 'function' && !window.showReceiptModal.__patched) {
      const orig = window.showReceiptModal;
      const wrapped = function (inv) {
        orig.call(this, inv);
        setTimeout(() => { ensureQRBox(); generateQR(inv); addPDFButton(); }, 60);
      };
      wrapped.__patched = true;
      window.showReceiptModal = wrapped;
    }
  }
  function addPDFButton() {
    const grid = document.querySelector('#receiptModal .grid.grid-cols-2');
    if (!grid || document.getElementById('pdfBtn')) return;
    const btn = document.createElement('button');
    btn.id = 'pdfBtn';
    btn.onclick = shareReceiptPDF;
    btn.className = 'bg-rose-600 hover:bg-rose-700 text-white py-2 rounded-xl font-bold text-sm flex items-center justify-center gap-1 col-span-2';
    btn.innerHTML = '<i class="fa-solid fa-file-pdf"></i> مشاركة PDF (جودة أعلى)';
    grid.appendChild(btn);
  }
  const waitForApp = setInterval(() => {
    if (typeof window.showReceiptModal === 'function' && typeof state === 'object' && state) {
      patchReceiptModal(); clearInterval(waitForApp);
    }
  }, 300);
  document.addEventListener('click', (e) => { if (e.target.closest('#receiptModal')) setTimeout(addPDFButton, 50); });

  const AUTO_BACKUP_KEY = 'ashour_last_auto_backup';
  const DAY_MS = 24 * 60 * 60 * 1000;
  async function runAutoBackup() {
    try {
      if (typeof state !== 'object' || !state || !state.products) return;
      const last = parseInt(localStorage.getItem(AUTO_BACKUP_KEY) || '0', 10);
      if (Date.now() - last < DAY_MS) return;
      if (typeof AshourDB !== 'undefined' && typeof AshourDB.saveBackup === 'function') {
        await AshourDB.saveBackup(state);
        localStorage.setItem(AUTO_BACKUP_KEY, String(Date.now()));
        console.log('[auto-backup] نسخة احتياطية تلقائية');
      }
    } catch (e) { console.warn('[auto-backup] فشل:', e); }
  }
  const waitForData = setInterval(() => {
    if (typeof state === 'object' && state && state.products) {
      clearInterval(waitForData); runAutoBackup();
      setInterval(runAutoBackup, 60 * 60 * 1000);
    }
  }, 1000);

  async function deriveKey(password, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' }, keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encryptBackup(dataStr, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt);
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(dataStr));
    const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
    combined.set(salt, 0); combined.set(iv, salt.length);
    combined.set(new Uint8Array(encrypted), salt.length + iv.length);
    return combined;
  }
  async function decryptBackup(buffer, password) {
    const data = new Uint8Array(buffer);
    const salt = data.slice(0, 16);
    const iv = data.slice(16, 28);
    const ciphertext = data.slice(28);
    const key = await deriveKey(password, salt);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return new TextDecoder().decode(decrypted);
  }

  function addEncryptedExportButton() {
    const backupSection = Array.from(document.querySelectorAll('h3')).find(h => h.textContent.includes('النسخ الاحتياطي'));
    if (!backupSection) return;
    const parent = backupSection.closest('.space-y-2');
    if (!parent || parent.querySelector('#encryptedExportBtn')) return;
    const btn = document.createElement('button');
    btn.id = 'encryptedExportBtn';
    btn.className = 'bg-violet-600 hover:bg-violet-700 text-white font-bold text-sm px-4 py-2 rounded-xl mt-2';
    btn.innerHTML = '<i class="fa-solid fa-lock"></i> تصدير مشفّر';
    btn.onclick = async () => {
      const pwd = prompt('أدخل كلمة مرور قوية (8 أحرف على الأقل):');
      if (!pwd || pwd.length < 8) return alert('كلمة المرور قصيرة');
      try {
        const snapshot = JSON.parse(JSON.stringify(state));
        delete snapshot.pinHash; delete snapshot.pinSalt;
        delete snapshot.pinAttempts; delete snapshot.pinLockUntil;
        const encrypted = await encryptBackup(JSON.stringify(snapshot), pwd);
        const blob = new Blob([encrypted], { type: 'application/octet-stream' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `Ashour_Encrypted_${new Date().toISOString().slice(0, 10)}.enc`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        alert('✅ تم تصدير نسخة مشفّرة. احفظ كلمة المرور!');
      } catch (e) { alert('خطأ: ' + e.message); }
    };
    parent.appendChild(btn);

    const importBtn = document.createElement('button');
    importBtn.id = 'encryptedImportBtn';
    importBtn.className = 'bg-violet-100 hover:bg-violet-200 text-violet-800 font-bold text-sm px-4 py-2 rounded-xl mt-2 mr-2 border border-violet-300';
    importBtn.innerHTML = '<i class="fa-solid fa-unlock"></i> استعادة مشفّرة';
    importBtn.onclick = () => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.enc';
      input.onchange = async () => {
        const file = input.files[0]; if (!file) return;
        const pwd = prompt('أدخل كلمة المرور:');
        if (!pwd) return;
        try {
          const buf = await file.arrayBuffer();
          const json = await decryptBackup(buf, pwd);
          const incoming = JSON.parse(json);
          if (!Array.isArray(incoming.products)) throw new Error('ملف غير صالح');
          if (!confirm('ستُستبدل البيانات الحالية. متابعة؟')) return;
          const keepPin = state.pinHash, keepSalt = state.pinSalt, keepLen = state.pinLength;
          state = Object.assign(defaultState(), incoming);
          ['returns','directSales','noInvoiceItems','companies','payments','expenses','invoices','purchases','companyPayments','personDebts','orders','stockMovements','tombstones','trash'].forEach(k => { if (!Array.isArray(state[k])) state[k] = []; });
          state.pinHash = keepPin; state.pinSalt = keepSalt; state.pinLength = keepLen || 4;
          if (typeof saveToStorage === 'function') await saveToStorage();
          if (typeof renderAll === 'function') renderAll();
          alert('✅ تمت الاستعادة'); location.reload();
        } catch (e) { alert('فشل: ' + e.message); }
      };
      input.click();
    };
    parent.appendChild(importBtn);
  }
  const waitForSettings = setInterval(() => {
    if (document.getElementById('view-settings') && document.querySelector('#view-settings h2')) {
      addEncryptedExportButton(); clearInterval(waitForSettings);
    }
  }, 800);

  window.lockSiteAccess = lockSiteAccess;
  console.log('%c[updates.js] التحديثات جاهزة ✓', 'color:#14B8A6;font-weight:bold;font-size:13px');
})();
