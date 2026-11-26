// firebase-sync.js — المزامنة السحابية مع قائمة انتظار تلقائية عند انقطاع الإنترنت
const FireSync = {
  currentUser: null,
  _isSyncing: false,
  _pendingSave: null,
  _initialized: false,
  _hasPendingUpload: false,

  _mergeById(localArr = [], remoteArr = []) {
    const map = new Map();
    (Array.isArray(localArr) ? localArr : []).forEach((item) => {
      if (item && item.id != null) map.set(String(item.id), item);
    });
    (Array.isArray(remoteArr) ? remoteArr : []).forEach((item) => {
      if (item && item.id != null) {
        const key = String(item.id);
        const existing = map.get(key);
        if (existing && typeof existing === 'object' && typeof item === 'object') {
          const merged = { ...existing, ...item };
          if (existing.customPrices || item.customPrices) {
            merged.customPrices = {
              ...(existing.customPrices && typeof existing.customPrices === 'object' ? existing.customPrices : {}),
              ...(item.customPrices && typeof item.customPrices === 'object' ? item.customPrices : {})
            };
          }
          map.set(key, merged);
        } else {
          map.set(key, item);
        }
      }
    });
    return Array.from(map.values());
  },

  _reconcileState(localState, cloudData) {
    const merged = typeof deepMerge === 'function'
      ? deepMerge(localState, cloudData)
      : { ...localState, ...cloudData };

    const arrayKeys = [
      'products', 'clients', 'invoices', 'expenses', 'payments', 'returns',
      'directSales', 'noInvoiceItems', 'companies', 'purchases', 'companyPayments', 'personDebts', 'orders'
    ];

    arrayKeys.forEach((key) => {
      merged[key] = this._mergeById(localState[key], cloudData[key]);
    });

    if (Array.isArray(localState.auditLog) || Array.isArray(cloudData.auditLog)) {
      const seenTs = new Set();
      merged.auditLog = [...(cloudData.auditLog || []), ...(localState.auditLog || [])]
        .filter((entry) => {
          if (!entry) return false;
          const k = `${entry.ts || ''}_${entry.type || ''}_${entry.details || ''}`;
          if (seenTs.has(k)) return false;
          seenTs.add(k);
          return true;
        })
        .sort((a, b) => (b.ts || 0) - (a.ts || 0))
        .slice(0, 500);
    }

    merged.invoiceCounter = Math.max(
      Number(localState.invoiceCounter) || 1000,
      Number(cloudData.invoiceCounter) || 1000
    );

    merged.clients.forEach((c) => {
      if (!c.customPrices || typeof c.customPrices !== 'object') c.customPrices = {};
    });

    merged.products.forEach((p) => {
      if (p.stock == null) p.stock = 0;
    });

    merged.cart = Array.isArray(localState.cart) ? localState.cart : [];
    merged.lastUpdated = Math.max(
      Number(localState.lastUpdated) || 0,
      Number(cloudData.lastUpdated) || 0,
      Date.now()
    );

    return merged;
  },

  init() {
    const auth = window.firebaseAuth;
    if (!auth) {
      setTimeout(() => this.init(), 500);
      return;
    }
    if (this._initialized) return;
    this._initialized = true;

    window.firebaseOnAuthStateChanged(auth, async (user) => {
      this.currentUser = user;
      this._updateLoginUI(user);
      if (user) {
        if (navigator.onLine) {
          await this.loadFromCloud(user.uid);
          if (this._hasPendingUpload && typeof state !== 'undefined') {
            await this.saveToCloud(state);
          }
        } else {
          this._hasPendingUpload = true;
          this._updateLoginUI(user);
        }
      }
    });

    window.addEventListener('online', async () => {
      this._updateLoginUI(this.currentUser);
      if (this.currentUser && typeof state !== 'undefined') {
        const ok = await this.saveToCloud(state);
        if (ok && typeof toast === 'function') {
          toast('تمت مزامنة البيانات بعد عودة الاتصال', 'success');
        }
      }
    });

    window.addEventListener('offline', () => {
      this._updateLoginUI(this.currentUser);
      if (typeof toast === 'function') {
        toast('وضع عدم الاتصال: العمل مستمر محلياً 100%', 'info');
      }
    });
  },

  _updateLoginUI(user) {
    const isOnline = navigator.onLine;
    const btn = document.getElementById('settingsGoogleBtn');
    const text = document.getElementById('settingsGoogleBtnText');
    const statusEl = document.getElementById('settingsSyncStatus');
    const emailEl = document.getElementById('settingsSyncEmail');
    const headerStatus = document.getElementById('syncStatus');

    if (!isOnline) {
      if (headerStatus) {
        headerStatus.innerHTML = `<i class="fa-solid fa-wifi-slash text-amber-300"></i> أوفلاين (محلي 100%)`;
      }
    }

    if (user) {
      if (text) text.textContent = 'تسجيل الخروج';
      if (btn) {
        btn.classList.remove('bg-white', 'text-blue-700', 'border-blue-300', 'hover:bg-blue-50');
        btn.classList.add('bg-rose-50', 'text-rose-700', 'border-rose-300', 'hover:bg-rose-100');
      }
      if (statusEl) {
        if (!isOnline) {
          statusEl.innerHTML = `<span class="text-amber-600 font-bold"><i class="fa-solid fa-cloud-slash"></i> غير متصل (بانتظار المزامنة)</span>`;
        } else if (this._isSyncing) {
          statusEl.innerHTML = `<span class="text-blue-600 font-bold"><i class="fa-solid fa-rotate fa-spin"></i> جاري المزامنة...</span>`;
        } else if (this._hasPendingUpload) {
          statusEl.innerHTML = `<span class="text-amber-600 font-bold"><i class="fa-solid fa-clock"></i> بانتظار إرسال التعديلات</span>`;
        } else {
          statusEl.innerHTML = `<span class="text-emerald-600 font-bold"><i class="fa-solid fa-cloud"></i> متزامن</span>`;
        }
      }
      if (emailEl) emailEl.textContent = user.email || '';
      if (headerStatus && isOnline) {
        headerStatus.innerHTML = this._isSyncing
          ? `<i class="fa-solid fa-rotate fa-spin text-sky-300"></i> جاري المزامنة...`
          : `<i class="fa-solid fa-cloud text-emerald-300"></i> متزامن`;
      }
    } else {
      if (text) text.textContent = 'تسجيل الدخول بـ Google';
      if (btn) {
        btn.classList.add('bg-white', 'text-blue-700', 'border-blue-300', 'hover:bg-blue-50');
        btn.classList.remove('bg-rose-50', 'text-rose-700', 'border-rose-300', 'hover:bg-rose-100');
      }
      if (statusEl) statusEl.innerHTML = `<span class="text-slate-500"><i class="fa-solid fa-cloud-slash"></i> غير متزامن</span>`;
      if (emailEl) emailEl.textContent = 'سجّل الدخول لمزامنة بياناتك على كل الأجهزة (يعمل أيضاً بدون نت)';
      if (headerStatus && isOnline) {
        headerStatus.innerHTML = `<i class="fa-solid fa-hard-drive text-emerald-300"></i> تخزين محلي جاهز`;
      }
    }
  },

  async login() {
    if (!navigator.onLine) {
      if (typeof Swal !== 'undefined') Swal.fire('لا يوجد إنترنت', 'تسجيل الدخول لـ Google يحتاج اتصالاً بالإنترنت، بينما العمل اليومي يعمل بالكامل بدون نت.', 'info');
      return;
    }
    if (!window.firebaseAuth || !window.firebaseSignIn) {
      if (typeof Swal !== 'undefined') Swal.fire('تنبيه', 'خدمات السحابة غير مجهزة حالياً. بياناتك محفوظة محلياً.', 'info');
      return;
    }
    try {
      await window.firebaseSignIn(window.firebaseAuth, window.googleProvider);
    } catch (error) {
      console.error('Login failed:', error);
      if (typeof Swal === 'undefined') return;
      let msg = 'فشل تسجيل الدخول.';
      if (error.code === 'auth/popup-blocked') msg = 'المتصفح منع النافذة المنبثقة. اسمح بها من إعدادات المتصفح.';
      else if (error.code === 'auth/unauthorized-domain') msg = `النطاق (${location.hostname}) غير مصرّح به في Firebase. أضفه من Firebase Console → Authentication → Settings → Authorized Domains.`;
      else if (error.code === 'auth/cancelled-popup-request' || error.code === 'auth/popup-closed-by-user') return;
      else if (error.code === 'auth/network-request-failed') msg = 'تحقق من اتصال الإنترنت.';
      else if (error.code === 'auth/operation-not-allowed') msg = 'تسجيل الدخول بـ Google غير مفعّل في Firebase Console → Authentication → Sign-in method.';
      Swal.fire('خطأ في تسجيل الدخول', msg, 'error');
    }
  },

  async logout() {
    if (!window.firebaseAuth || !window.firebaseSignOut) return;
    try {
      const confirmed = await Swal.fire({
        title: 'تسجيل خروج؟',
        text: 'بياناتك ستبقى محفوظة محلياً 100%.',
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'نعم، خروج',
        cancelButtonText: 'إلغاء'
      });
      if (confirmed.isConfirmed) {
        await window.firebaseSignOut(window.firebaseAuth);
        if (typeof toast === 'function') toast('تم تسجيل الخروج', 'success');
      }
    } catch (e) {}
  },

  async saveToCloud(data) {
    if (!this.currentUser || !window.firebaseDB || !window.firebaseDoc || !window.firebaseSetDoc) {
      return false;
    }
    if (!navigator.onLine) {
      this._hasPendingUpload = true;
      this._pendingSave = data;
      this._updateLoginUI(this.currentUser);
      return false;
    }
    if (this._isSyncing) {
      this._pendingSave = data;
      this._hasPendingUpload = true;
      return false;
    }

    this._isSyncing = true;
    this._updateLoginUI(this.currentUser);

    try {
      const stamp = Date.now();
      const payload = { ...JSON.parse(JSON.stringify(data)), lastUpdated: stamp };
      delete payload.pinHash;
      delete payload.pinSalt;
      delete payload.pinAttempts;
      delete payload.pinLockUntil;
      delete payload.customPricesEditing;

      if (typeof state === 'object' && state) state.lastUpdated = stamp;
      const userDoc = window.firebaseDoc(window.firebaseDB, 'users', this.currentUser.uid, 'store', 'data');
      await window.firebaseSetDoc(userDoc, payload);

      this._hasPendingUpload = false;
      this._isSyncing = false;
      this._updateLoginUI(this.currentUser);

      if (this._pendingSave) {
        const pending = this._pendingSave;
        this._pendingSave = null;
        setTimeout(() => this.saveToCloud(pending), 250);
      }
      return true;
    } catch (e) {
      console.error('Firebase Save Error:', e);
      this._hasPendingUpload = true;
      this._isSyncing = false;
      this._updateLoginUI(this.currentUser);
      return false;
    }
  },

  async loadFromCloud(uid) {
    if (!navigator.onLine || !window.firebaseDB || !window.firebaseGetDoc || typeof state === 'undefined') return;
    this._isSyncing = true;
    this._updateLoginUI(this.currentUser);

    try {
      const userDoc = window.firebaseDoc(window.firebaseDB, 'users', uid, 'store', 'data');
      const docSnap = await window.firebaseGetDoc(userDoc);

      if (docSnap.exists()) {
        const cloudData = docSnap.data() || {};
        const localLastUpdate = Number(state.lastUpdated) || 0;
        const cloudLastUpdate = Number(cloudData.lastUpdated) || 0;

        if (cloudLastUpdate > localLastUpdate + 1000) {
          state = this._reconcileState(state, cloudData);
          if (window.AshourDB && typeof AshourDB.save === 'function') await AshourDB.save(state);
          if (typeof ensureCookieProducts === 'function') await ensureCookieProducts();
          if (typeof refreshCategoryWidgets === 'function') refreshCategoryWidgets();
          if (typeof initPOSCategories === 'function') initPOSCategories();
          if (typeof renderAll === 'function') renderAll();
          if (typeof toast === 'function') toast('تم تحديث البيانات من السحابة', 'info');
        } else if (localLastUpdate > cloudLastUpdate + 1000) {
          this._isSyncing = false;
          await this.saveToCloud(state);
          if (typeof toast === 'function') toast('تمت مزامنة تعديلاتك المحلية', 'success');
        }
      } else {
        this._isSyncing = false;
        await this.saveToCloud(state);
      }
    } catch (e) {
      console.error('Firebase Load Error:', e);
      this._hasPendingUpload = true;
    } finally {
      this._isSyncing = false;
      this._updateLoginUI(this.currentUser);
    }
  }
};

window.FireSync = FireSync;

window.handleGoogleLoginClick = function () {
  if (!window.FireSync) return;
  if (!FireSync._initialized) FireSync.init();
  if (FireSync.currentUser) FireSync.logout();
  else FireSync.login();
};

window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => FireSync.init(), 500);
});
