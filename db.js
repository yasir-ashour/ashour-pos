/* ==========================================================================
   db.js — محرك التخزين القوي (IndexedDB + localStorage)
   ========================================================================== */

(function (global) {
  'use strict';

  const DB_NAME = 'ashour_pos_db';
  const DB_VERSION = 1;
  const STORE_MAIN = 'main';
  const STORE_BACKUP = 'backup';
  const STORE_AUDIT = 'audit';
  const LS_KEY = 'ashour_pos_db_v12';
  const LS_BACKUP_KEY = 'ashour_pos_db_v12_mirror';

  let _db = null;

  function openDB() {
    return new Promise((resolve, reject) => {
      if (_db) return resolve(_db);
      if (!('indexedDB' in global)) return reject(new Error('IndexedDB غير مدعوم'));

      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (ev) => {
        const db = ev.target.result;
        if (!db.objectStoreNames.contains(STORE_MAIN)) db.createObjectStore(STORE_MAIN);
        if (!db.objectStoreNames.contains(STORE_BACKUP)) db.createObjectStore(STORE_BACKUP);
        if (!db.objectStoreNames.contains(STORE_AUDIT)) db.createObjectStore(STORE_AUDIT, { keyPath: 'ts' });
      };
      req.onsuccess = (ev) => { _db = ev.target.result; resolve(_db); };
      req.onerror = (ev) => reject(ev.target.error);
    });
  }

  function put(storeName, key, value) {
    return openDB().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = (ev) => reject(ev.target.error);
    }));
  }

  function get(storeName, key) {
    return openDB().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = (ev) => reject(ev.target.error);
    }));
  }

  function del(storeName, key) {
    return openDB().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = (ev) => reject(ev.target.error);
    }));
  }

  const Storage = {
    async save(state) {
      const errors = [];
      let okIndexedDB = false;
      let okLocalStorage = false;

      try {
        const serialized = JSON.parse(JSON.stringify(state));
        await put(STORE_MAIN, 'state', serialized);
        okIndexedDB = true;
      } catch (e) { errors.push('IndexedDB: ' + e.message); }

      try {
        const json = JSON.stringify(state);
        localStorage.setItem(LS_KEY, json);
        okLocalStorage = true;
      } catch (e) { errors.push('localStorage: ' + e.message); }

      return { ok: okIndexedDB || okLocalStorage, okIndexedDB, okLocalStorage, errors };
    },

    async saveBackup(state) {
      try {
        const serialized = JSON.parse(JSON.stringify(state));
        await put(STORE_BACKUP, 'backup_' + Date.now(), { ts: Date.now(), date: new Date().toISOString(), state: serialized });
        await this._trimBackups(10);
        return true;
      } catch (e) { return false; }
    },

    async _trimBackups(maxCount) {
      try {
        const db = await openDB();
        const tx = db.transaction(STORE_BACKUP, 'readwrite');
        const store = tx.objectStore(STORE_BACKUP);
        const req = store.getAllKeys();
        req.onsuccess = () => {
          const keys = req.result.sort();
          const toDelete = keys.slice(0, Math.max(0, keys.length - maxCount));
          toDelete.forEach(k => store.delete(k));
        };
      } catch (_) {}
    },

    async load() {
      try {
        const data = await get(STORE_MAIN, 'state');
        if (data && typeof data === 'object') return { ok: true, source: 'indexeddb', state: data };
      } catch (_) {}

      try {
        const raw = localStorage.getItem(LS_KEY) || localStorage.getItem(LS_BACKUP_KEY);
        if (raw) return { ok: true, source: 'localstorage', state: JSON.parse(raw) };
      } catch (_) {}

      try {
        const db = await openDB();
        const backups = await new Promise((resolve) => {
          const tx = db.transaction(STORE_BACKUP, 'readonly');
          const req = tx.objectStore(STORE_BACKUP).getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => resolve([]);
        });
        if (backups.length) {
          backups.sort((a, b) => (b.ts || 0) - (a.ts || 0));
          return { ok: true, source: 'backup', state: backups[0].state };
        }
      } catch (_) {}
      return { ok: false, state: null };
    },

    async getStatus() {
      const status = { indexedDB: 'غير متاح', localStorage: 'غير متاح', localStorageSize: 0, estimate: null };
      try { await openDB(); status.indexedDB = 'متاح ✓'; } catch (_) { status.indexedDB = 'غير مدعوم'; }
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) { status.localStorage = 'متاح ✓'; status.localStorageSize = new Blob([raw]).size; }
        else { status.localStorage = 'متاح (فارغ)'; }
      } catch (_) { status.localStorage = 'ممتلئ أو معطل'; }
      if (navigator.storage && navigator.storage.estimate) {
        try {
          const est = await navigator.storage.estimate();
          status.estimate = { usage: est.usage || 0, quota: est.quota || 0, percent: est.quota ? Math.round((est.usage / est.quota) * 100) : 0 };
        } catch (_) {}
      }
      return status;
    },

    async testCapacity() {
      const start = performance.now();
      const fake = { invoices: [], products: [], clients: [] };
      for (let i = 0; i < 5000; i++) fake.invoices.push({ id: 'TEST-' + i, ts: Date.now(), clientId: 'c1', clientName: 'اختبار', total: Math.random() * 100000, paid: 0, remaining: 0, items: [{ name: 'منتج اختبار', qty: 1, price: 100, total: 100 }] });
      for (let i = 0; i < 500; i++) fake.products.push({ id: String(i), sku: String(i), name: 'منتج ' + i, cost: 100, retailPrice: 150, wholesalePrice: 130 });
      const payload = { test: fake, ts: Date.now() };
      const sizeKB = Math.round(new Blob([JSON.stringify(payload)]).size / 1024);
      let okIDB = false, okLS = false, err = null;
      try { await put(STORE_MAIN, 'capacity_test', payload); okIDB = true; await del(STORE_MAIN, 'capacity_test'); } catch (e) { err = 'IndexedDB: ' + e.message; }
      try { const k = '__capacity_test__'; localStorage.setItem(k, JSON.stringify(payload)); localStorage.removeItem(k); okLS = true; } catch (e) { err = (err || '') + ' localStorage: ' + e.message; }
      return { ok: okIDB || okLS, okIDB, okLS, sizeKB, ms: Math.round(performance.now() - start), error: err };
    },

    async addAudit(entry) {
      try { await put(STORE_AUDIT, entry.ts || Date.now(), entry); } catch (_) {}
    }
  };
  global.AshourDB = Storage;
})(window);
