// firebase-sync.js — المزامنة السحابية (مع دعم tombstones للحذف الآمن)
const FireSync = {
  currentUser: null,
  _isSyncing: false,
  _initialized: false,
  _initTries: 0,
  _timer: null,
  _latest: null,
  _lastError: false,
  _sizeWarned: false,
  UPLOAD_DELAY_MS: 3000,
  UID_KEY: 'ashour_last_uid',
  LOCAL_ONLY_KEYS: ['pinHash', 'pinSalt', 'pinAttempts', 'pinLockUntil', 'pinLength', 'cart', 'posPriceOverride',
    'customPricesEditing', 'currentLedgerClientId', 'currentReceiptInv', 'activeCompanyId', 'selectedPosCategory'],

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
        } else map.set(key, item);
      }
    });
    return Array.from(map.values());
  },

  _mergeTombstones(localTombs, cloudTombs) {
    const all = [...(localTombs || []), ...(cloudTombs || [])];
    const seen = new Set();
    return all.filter(t => {
      if (!t || !t.col || t.id === undefined) return false;
      const k = `${t.col}|${t.id}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  },

  _reconcileState(localState, cloudData) {
    const merged = typeof deepMerge === 'function' ? deepMerge(localState, cloudData) : { ...localState, ...cloudData };
    const tombstones = this._mergeTombstones(localState.tombstones, cloudData.tombstones);
    const tombSet = new Set(tombstones.map(t => `${t.col}|${t.id}`));
    merged.tombstones = tombstones;

    ['products', 'clients', 'invoices', 'expenses', 'payments', 'returns', 'directSales', 'noInvoiceItems',
      'companies', 'purchases', 'companyPayments', 'personDebts', 'orders', 'stockMovements'].forEach((key) => {
      let arr = this._mergeById(localState[key], cloudData[key]);
      // فلترة المحذوفات
      arr = arr.filter(item => !tombSet.has(`${key}|${item.id}`));
      merged[key] = arr;
    });

    const seen = new Set();
    merged.auditLog = [...(cloudData.auditLog || []), ...(localState.auditLog || [])]
      .filter((e) => {
        if (!e) return false;
        const k = `${e.ts || ''}_${e.type || ''}_${e.details || ''}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))
      .slice(0, 500);

    merged.invoiceCounter = Math.max(Number(localState.invoiceCounter) || 1000, Number(cloudData.invoiceCounter) || 1000);
    merged.clients.forEach((c) => { if (!c.customPrices || typeof c.customPrices !== 'object') c.customPrices = {}; });
    this.LOCAL_ONLY_KEYS.forEach((k) => { merged[k] = localState[k]; });
    merged.lastUpdated = Math.max(Number(localState.lastUpdated) || 0, Number(cloudData.lastUpdated) || 0, Date.now());
    return merged;
  },

  init() {
    const auth = window.firebaseAuth;
    if (!auth) {
      if (this._initTries++ < 20) setTimeout(() => this.init(), 1500);
      return;
    }
    if (this._initialized) return;
    this._initialized = true;

    window.firebaseOnAuthStateChanged(auth, async (user) => {
      this.currentUser = user;
      this._updateLoginUI(user);
      if (user) await this.loadFromCloud(user.uid);
    });
    window.addEventListener('online', () => {
      this._updateLoginUI(this.currentUser);
      if (this.currentUser && typeof state !== 'undefined') this.saveToCloud(state);
    });
    window.addEventListener('offline', () => this._updateLoginUI(this.currentUser));
  },

  _updateLoginUI(user) {
    const online = navigator.onLine;
    const btn = document.getElementById('settingsGoogleBtn');
    const text = document.getElementById('settingsGoogleBtnText');
    const statusEl = document.getElementById('settingsSyncStatus');
    const emailEl = document.getElementById('settingsSyncEmail');
    const headerStatus = document.getElementById('syncStatus');

    if (user) {
      if (text) text.textContent = 'تسجيل الخروج';
      if (btn) {
        btn.classList.remove('bg-white', 'text-blue-700', 'border-blue-300', 'hover:bg-blue-50');
        btn.classList.add('bg-rose-50', 'text-rose-700', 'border-rose-300', 'hover:bg-rose-100');
      }
      let label, color;
      if (this._lastError) { label = 'فشل الرفع'; color = 'text-rose-600'; }
      else if (!online) { label = 'غير متصل'; color = 'text-amber-600'; }
      else { label = 'متزامن'; color = 'text-emerald-600'; }
      if (statusEl) statusEl.innerHTML = `<span class="${color} font-bold"><i class="fa-solid fa-cloud"></i> ${label}</span>`;
      if (emailEl) emailEl.textContent = user.email || '';
      if (headerStatus) headerStatus.innerHTML = `<i class="fa-solid fa-cloud ${color.replace('600', '300')}"></i> ${label}`;
    } else {
      if (text) text.textContent = 'تسجيل الدخول بـ Google';
      if (btn) {
        btn.classList.add('bg-white', 'text-blue-700', 'border-blue-300', 'hover:bg-blue-50');
        btn.classList.remove('bg-rose-50', 'text-rose-700', 'border-rose-300', 'hover:bg-rose-100');
      }
      if (statusEl) statusEl.innerHTML = `<span class="text-slate-500"><i class="fa-solid fa-cloud-slash"></i> غير متزامن</span>`;
      if (emailEl) emailEl.textContent = 'سجّل الدخول لمزامنة بياناتك على كل الأجهزة';
      if (headerStatus) headerStatus.innerHTML = `<i class="fa-solid fa-cloud-slash"></i> غير متزامن`;
    }
  },

  async login() {
    if (!window.firebaseAuth) {
      if (typeof Swal !== 'undefined') Swal.fire('خطأ', 'النظام لم يجهز بعد. تأكد من الاتصال بالإنترنت وأعد تحميل الصفحة.', 'error');
      return;
    }
    try { await window.firebaseSignIn(window.firebaseAuth, window.googleProvider); }
    catch (error) {
      console.error('Login failed:', error);
      if (typeof Swal === 'undefined') return;
      let msg = 'فشل تسجيل الدخول.';
      if (error.code === 'auth/popup-blocked') msg = 'المتصفح منع النافذة المنبثقة. اسمح بها من إعدادات المتصفح.';
      else if (error.code === 'auth/unauthorized-domain') msg = `النطاق (${location.hostname}) غير مصرّح به في Firebase.`;
      else if (error.code === 'auth/cancelled-popup-request' || error.code === 'auth/popup-closed-by-user') return;
      else if (error.code === 'auth/network-request-failed') msg = 'تحقق من اتصال الإنترنت.';
      else if (error.code === 'auth/operation-not-allowed') msg = 'تسجيل الدخول بـ Google غير مفعّل في Firebase Console.';
      Swal.fire('خطأ في تسجيل الدخول', msg, 'error');
    }
  },

  async logout() {
    if (!window.firebaseAuth) return;
    try {
      const r = await Swal.fire({
        title: 'تسجيل خروج؟', text: 'بياناتك ستبقى محلياً.', icon: 'question',
        showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#64748b',
        confirmButtonText: 'نعم، خروج', cancelButtonText: 'إلغاء'
      });
      if (r.isConfirmed) {
        clearTimeout(this._timer);
        await window.firebaseSignOut(window.firebaseAuth);
        if (typeof toast === 'function') toast('تم تسجيل الخروج', 'success');
      }
    } catch (e) {}
  },

  saveToCloud(data) {
    if (!this.currentUser || !window.firebaseDB) return Promise.resolve(false);
    this._latest = data;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this._upload(), this.UPLOAD_DELAY_MS);
    return Promise.resolve(true);
  },

  async _upload() {
    if (!this.currentUser || !window.firebaseDB || !this._latest) return false;
    if (this._isSyncing) { this._timer = setTimeout(() => this._upload(), 1000); return false; }
    const data = this._latest;
    this._latest = null;
    try {
      const stamp = Date.now();
      const payload = { ...JSON.parse(JSON.stringify(data)), lastUpdated: stamp };
      this.LOCAL_ONLY_KEYS.forEach((k) => delete payload[k]);

      if (!this._sizeWarned && JSON.stringify(payload).length > 800000 && typeof Swal !== 'undefined') {
        this._sizeWarned = true;
        Swal.fire({ icon: 'warning', title: 'حجم البيانات كبير', text: 'اقترب حجم البيانات من حد المزامنة السحابية. صدّر نسخة احتياطية الآن.', confirmButtonColor: '#0F5C4E' });
      }
      if (typeof state === 'object' && state) state.lastUpdated = stamp;
      const ref = window.firebaseDoc(window.firebaseDB, 'users', this.currentUser.uid, 'store', 'data');
      await window.firebaseSetDoc(ref, payload);
      this._lastError = false;
      this._updateLoginUI(this.currentUser);
      return true;
    } catch (e) {
      console.error('Firebase Save Error:', e);
      this._lastError = true;
      if (!this._latest) this._latest = data;
      this._updateLoginUI(this.currentUser);
      return false;
    }
  },

  _hasLocalData() {
    return typeof state === 'object' && state && (
      (state.invoices || []).length || (state.clients || []).length > 1 ||
      (state.purchases || []).length || (state.expenses || []).length ||
      (state.products || []).length);
  },

  async loadFromCloud(uid) {
    if (!window.firebaseDB || typeof state === 'undefined') return;

    const lastUid = localStorage.getItem(this.UID_KEY);
    if (lastUid && lastUid !== uid && this._hasLocalData() && typeof Swal !== 'undefined') {
      const r = await Swal.fire({
        icon: 'warning', title: 'حساب مختلف',
        text: 'هذا الحساب يختلف عن الحساب السابق. هل تريد دمج بيانات هذا الجهاز مع بيانات الحساب الجديد؟',
        showCancelButton: true, confirmButtonText: 'ادمج', cancelButtonText: 'تسجيل الخروج',
        confirmButtonColor: '#0F5C4E', cancelButtonColor: '#d33', allowOutsideClick: false
      });
      if (!r.isConfirmed) { await window.firebaseSignOut(window.firebaseAuth); return; }
    }

    this._isSyncing = true;
    try {
      const ref = window.firebaseDoc(window.firebaseDB, 'users', uid, 'store', 'data');
      const snap = await window.firebaseGetDoc(ref);
      let pushLocal = false;

      if (snap.exists()) {
        const cloud = snap.data() || {};
        this.LOCAL_ONLY_KEYS.forEach((k) => delete cloud[k]);
        const localTs = Number(state.lastUpdated) || 0;
        const cloudTs = Number(cloud.lastUpdated) || 0;

        if (cloudTs > localTs + 1000) {
          state = this._reconcileState(state, cloud);
          if (window.AshourDB && typeof AshourDB.save === 'function') await AshourDB.save(state);
          if (typeof refreshCategoryWidgets === 'function') refreshCategoryWidgets();
          if (typeof initPOSCategories === 'function') initPOSCategories();
          if (typeof renderAll === 'function') renderAll();
          if (typeof toast === 'function') toast('تم تحديث البيانات من السحابة', 'info');
        } else if (localTs > cloudTs + 1000) pushLocal = true;
      } else pushLocal = true;

      localStorage.setItem(this.UID_KEY, uid);
      this._isSyncing = false;
      if (pushLocal) {
        this._latest = state;
        await this._upload();
        if (typeof toast === 'function' && !this._lastError) toast('تمت مزامنة بيانات هذا الجهاز', 'success');
      }
    } catch (e) {
      console.error('Firebase Load Error:', e);
      this._lastError = true;
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
  setTimeout(() => FireSync.init(), 800);
});
