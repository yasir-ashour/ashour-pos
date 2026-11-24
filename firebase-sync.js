// firebase-sync.js
const FireSync = {
  currentUser: null,
  _isSyncing: false,

  _mergeById(localArr = [], remoteArr = []) {
    const map = new Map();
    (Array.isArray(localArr) ? localArr : []).forEach((item) => {
      if (item && item.id != null) {
        map.set(String(item.id), item);
      }
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
      'products',
      'clients',
      'invoices',
      'expenses',
      'payments',
      'returns',
      'directSales',
      'noInvoiceItems',
      'companies',
      'purchases',
      'companyPayments',
      'personDebts'
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
      if (!c.customPrices || typeof c.customPrices !== 'object') {
        c.customPrices = {};
      }
    });

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
      const btn = document.getElementById('googleLoginBtn');
      const statusEl = document.getElementById('syncStatus');

      if (user) {
        if (btn) {
          btn.innerHTML = `<i class="fa-solid fa-right-from-bracket"></i> خروج`;
          btn.onclick = () => this.logout();
        }
        if (statusEl) {
          statusEl.innerHTML = `<i class="fa-solid fa-cloud text-emerald-300"></i> متزامن`;
        }
        await this.loadFromCloud(user.uid);
      } else {
        if (btn) {
          btn.innerHTML = `<i class="fa-brands fa-google"></i> ربط الحساب`;
          btn.onclick = () => this.login();
        }
        if (statusEl) {
          statusEl.innerHTML = `<i class="fa-solid fa-cloud-slash"></i> غير متزامن`;
        }
      }
    });
  },

  async login() {
    if (!window.firebaseAuth) return;
    try {
      await window.firebaseSignIn(window.firebaseAuth, window.googleProvider);
    } catch (error) {
      console.error('Login failed:', error);
      Swal.fire('خطأ', 'فشل تسجيل الدخول. تأكد من النطاق.', 'error');
    }
  },

  async logout() {
    if (!window.firebaseAuth) return;
    await window.firebaseSignOut(window.firebaseAuth);
  },

  async saveToCloud(data) {
    if (!this.currentUser || !window.firebaseDB || this._isSyncing) return false;
    try {
      const stamp = Date.now();
      const payload = {
        ...JSON.parse(JSON.stringify(data)),
        lastUpdated: stamp
      };
      if (typeof state === 'object' && state) {
        state.lastUpdated = stamp;
      }
      const userDoc = window.firebaseDoc(window.firebaseDB, 'users', this.currentUser.uid, 'store', 'data');
      await window.firebaseSetDoc(userDoc, payload);
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

        if (cloudLastUpdate > localLastUpdate) {
          state = this._reconcileState(state, cloudData);
          if (window.AshourDB && typeof AshourDB.save === 'function') {
            await AshourDB.save(state);
          }
          if (typeof refreshCategoryWidgets === 'function') refreshCategoryWidgets();
          if (typeof initPOSCategories === 'function') initPOSCategories();
          if (typeof renderAll === 'function') renderAll();
          if (typeof toast === 'function') toast('تم تحديث البيانات من السحابة');
        }
      } else {
        await this.saveToCloud(state);
      }
    } catch (e) {
      console.error('Firebase Load Error:', e);
    } finally {
      this._isSyncing = false;
    }
  }
};

window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => FireSync.init(), 800);
});
