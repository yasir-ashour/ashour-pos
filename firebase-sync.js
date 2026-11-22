// firebase-sync.js
const FireSync = {
  currentUser: null,

  init() {
    const auth = window.firebaseAuth;
    if (!auth) return;

    window.firebaseOnAuthStateChanged(auth, async (user) => {
      this.currentUser = user;
      const btn = document.getElementById('googleLoginBtn');
      const statusEl = document.getElementById('syncStatus');
      
      if (user) {
        if (btn) btn.innerHTML = `<i class="fa-solid fa-right-from-bracket"></i> خروج`;
        if (btn) btn.onclick = () => this.logout();
        if (statusEl) statusEl.innerHTML = `<i class="fa-solid fa-cloud text-emerald-300"></i> متزامن`;
        await this.loadFromCloud(user.uid);
      } else {
        if (btn) btn.innerHTML = `<i class="fa-brands fa-google"></i> ربط الحساب`;
        if (btn) btn.onclick = () => this.login();
        if (statusEl) statusEl.innerHTML = `<i class="fa-solid fa-cloud-slash"></i> غير متزامن`;
      }
    });
  },

  async login() {
    if (!window.firebaseAuth) return;
    try {
      await window.firebaseSignIn(window.firebaseAuth, window.googleProvider);
    } catch (error) {
      console.error("Login failed:", error);
      Swal.fire('خطأ', 'فشل تسجيل الدخول. تأكد من النطاق.', 'error');
    }
  },

  async logout() {
    if (!window.firebaseAuth) return;
    await window.firebaseSignOut(window.firebaseAuth);
  },

  async saveToCloud(data) {
    if (!this.currentUser || !window.firebaseDB) return false;
    try {
      const userDoc = window.firebaseDoc(window.firebaseDB, 'users', this.currentUser.uid, 'store', 'data');
      await window.firebaseSetDoc(userDoc, { ...data, lastUpdated: Date.now() });
      return true;
    } catch (e) {
      console.error("Firebase Save Error:", e);
      return false;
    }
  },

  async loadFromCloud(uid) {
    if (!window.firebaseDB) return;
    try {
      const userDoc = window.firebaseDoc(window.firebaseDB, 'users', uid, 'store', 'data');
      const docSnap = await window.firebaseGetDoc(userDoc);
      if (docSnap.exists()) {
        const cloudData = docSnap.data();
        const localLastUpdate = state.lastUpdated || 0;
        if (cloudData.lastUpdated > localLastUpdate) {
          state = deepMerge(state, cloudData);
          await AshourDB.save(state); // حفظ محلي
          renderAll();
          toast('تم تحديث البيانات من السحابة');
        }
      } else {
        await this.saveToCloud(state); // رفع البيانات الأولى
      }
    } catch (e) {
      console.error("Firebase Load Error:", e);
    }
  }
};

window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => FireSync.init(), 1000);
});
