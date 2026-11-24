// firebase-sync.js — المزامنة السحابية
const FireSync = {
  currentUser: null,
  _isSyncing: false,
  _pendingSave: null,

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
      'products','clients','invoices','expenses','payments','returns',
      'directSales','noInvoiceItems','companies','purchases','companyPayments','personDebts'
    ];

    arrayKeys.forEach((key) => {
      merged[key] = this._mergeById(localState[key], cloudData[key]);
    });

    if (Array.isArray(localState.auditLog) || Array.isArray(cloudData.auditLog)) {
      const seenTs = new Set();
      const combinedAudit = [...(cloudData.auditLog || []), ...(localState.auditLog || [])]
        .filter((entry) => {
          if (!entry) return false;
          const k = `${entry.ts || ''}_${entry.type || ''}_${entry.details || ''}`;
          if (seenTs.has(k)) return false;
          seenTs.add(k);
          return true;
        })
        .sort((a, b) => (b.ts || 0) - (a.ts || 0))
        .slice(0, 500);
      merged.auditLog = combinedAudit;
    }

    merged.invoiceCounter = Math.max(
      Number(localState.invoiceCounter) || 1000,
      Number(cloudData.invoiceCounter) || 1000
    );

    merged.clients.forEach((c) => {
      if (!c.customPrices || typeof c.customPrices !== 'object') c.customPrices = {};
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
    if (!auth) return;

    window.firebaseOnAuthStateChanged(auth, async (user) => {
      this.currentUser = user;
      this._updateLoginUI(user);
      if (user) await this.loadFromCloud(user.uid);
    });

    window.addEventListener('online', () => {
      this._updateLoginUI(this.currentUser);
      if (this.currentUser && typeof state !== 'undefined') {
        this.saveToCloud(state).then(ok => {
          if (ok && typeof toast === 'function') toast('تمت المزامنة بعد عودة الاتصال', 'success');
        });
      }
    });

    window.addEventListener('offline', () => {
      this._updateLoginUI(this.currentUser);
    });
  },

  _updateLoginUI(user) {
    const isOnline = navigator.onLine;
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
      if (statusEl) statusEl.innerHTML = isOnline ? `<span class="text-emerald-600 font-bold"><i class="fa-solid fa-cloud"></i> متزامن</span>` : `<span class="text-amber-600 font-bold"><i class="fa-solid fa-cloud-slash"></i> غير متصل</span>`;
      if (emailEl) emailEl.textContent = user.email || '';
      if (headerStatus) headerStatus.innerHTML = isOnline ? `<i class="fa-solid fa-cloud text-emerald-300"></i> متزامن` : `<i class="fa-solid fa-cloud-slash text-amber-300"></i> غير متصل`;
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
    if (!window.firebaseAuth) return;
    try {
      await window.firebaseSignIn(window.firebaseAuth, window.googleProvider);
    } catch (error) {
      console.error('Login failed:', error);
      if (typeof Swal !== 'undefined') Swal.fire('خطأ', 'فشل تسجيل الدخول. تأكد من النطاق أو أعد المحاولة.', 'error');
    }
  },

  async logout() {
    if (!window.firebaseAuth) return;
    try {
      const confirmed = await Swal.fire({
        title: 'تسجيل خروج؟',
        text: 'بياناتك ستبقى على هذا الجهاز، لكن المزامنة السحابية ستتوقف.',
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'نعم، خروج',
        cancelButtonText: 'إلغاء'
      });
      if (confirmed.isConfirmed) {
        await window.firebaseSignOut(window.firebaseAuth);
        if (typeof toast === 'function') toast('تم تسجيل الخروج بنجاح', 'success');
      }
    } catch(e) {
      console.error('Logout error:', e);
      Swal.fire('خطأ', 'تعذر تسجيل الخروج', 'error');
    }
  },

  async saveToCloud(data) {
    if (!this.currentUser || !window.firebaseDB) return false;
    if (this._isSyncing) {
      this._pendingSave = data;
      return false;
    }
    try {
      const stamp = Date.now();
      const payload = {
        ...JSON.parse(JSON.stringify(data)),
        lastUpdated: stamp
      };
      if (typeof state === 'object' && state) state.lastUpdated = stamp;
      const userDoc = window.firebaseDoc(window.firebaseDB, 'users', this.currentUser.uid, 'store', 'data');
      await window.firebaseSetDoc(userDoc, payload);

      if (this._pendingSave) {
        const pending = this._pendingSave;
        this._pendingSave = null;
        setTimeout(() => this.saveToCloud(pending), 200);
      }
      return true;
    } catch (e) {
      console.error('Firebase Save Error:', e);
      return false;
    }
  },

  async loadFromCloud(uid) {
    if (!window.firebaseDB || typeof state === 'undefined') return;
    this._isSyncing = true;
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
    } finally {
      this._isSyncing = false;
      this._updateLoginUI(this.currentUser);
    }
  }
};

window.handleGoogleLoginClick = function () {
  if (!window.FireSync) return;
  if (FireSync.currentUser) FireSync.logout();
  else FireSync.login();
};

window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => FireSync.init(), 800);
});
