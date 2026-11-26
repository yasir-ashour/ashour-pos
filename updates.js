/* updates.js — QR + PDF + reset PIN + نسخة تلقائية + تشفير */
(function () {
  'use strict';

  const params = new URLSearchParams(location.search);

  if (params.get('resetpin') === 'ashour2026') {
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
              text: 'تمت إعادة ضبط رمز PIN إلى 1234.',
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
  }

  if (params.get('statement')) {
    const clientId = params.get('statement');
    const tryOpen = () => {
      if (typeof state === 'object' && state && Array.isArray(state.clients)) {
        const c = state.clients.find(x => x.id === clientId);
        const pinOverlay = document.getElementById('pinOverlay');
        const unlocked = !pinOverlay || pinOverlay.classList.contains('hidden');
        if (c && typeof openClientDetailPage === 'function') {
          if (!unlocked) { setTimeout(tryOpen, 700); return; }
          openClientDetailPage(clientId);
        }
      } else {
        setTimeout(tryOpen, 300);
      }
    };
    setTimeout(tryOpen, 1200);
  }

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
    btn.type = 'button';
    btn.onclick = shareReceiptPDF;
    btn.className = 'bg-rose-600 hover:bg-rose-700 text-white py-2 rounded-xl font-bold text-xs flex items-center justify-center gap-1 col-span-2';
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
      }
    } catch (_) {}
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
    const parent = document.getElementById('backupSectionBox');
    if (!parent || parent.querySelector('#encryptedExportBtn')) return;

    const btn = document.createElement('button');
    btn.id = 'encryptedExportBtn';
    btn.type = 'button';
    btn.className = 'bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs px-4 py-2 rounded-xl';
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
    importBtn.type = 'button';
    importBtn.className = 'bg-violet-100 hover:bg-violet-200 text-violet-800 font-bold text-xs px-4 py-2 rounded-xl border border-violet-300';
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
    if (document.getElementById('backupSectionBox')) {
      addEncryptedExportButton(); clearInterval(waitForSettings);
    }
  }, 500);
})();
