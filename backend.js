// Datalag: Firebase (Google-innlogging + Firestore-database) når config.js er fylt ut,
// ellers DEMO-MODUS der alt lagres lokalt på denne enheten.
// Resten av appen snakker bare med funksjonene som eksporteres herfra.

import { firebaseConfig } from './config.js';

export const isDemo = !firebaseConfig.apiKey;

const CHUNK = 700_000; // tegn per bit (Firestore-dokumenter kan være maks ~1 MB)
export const MAX_FILE_MB = 8;

const stripUndefined = (o) => JSON.parse(JSON.stringify(o));
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('Kunne ikke lese fila.'));
    r.readAsDataURL(file);
  });
}
export function base64ToBlob(b64, type) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

// ═════════════════════════════ FIREBASE ═════════════════════════════

function firebaseBackend() {
  let fb, auth, db, provider;

  return {
    async init() {
      fb = await import('./vendor/firebase.js');
      const app = fb.initializeApp(firebaseConfig);
      auth = fb.initializeAuth(app, {
        persistence: [fb.indexedDBLocalPersistence, fb.browserLocalPersistence],
        popupRedirectResolver: fb.browserPopupRedirectResolver,
      });
      auth.languageCode = 'no';
      db = fb.initializeFirestore(app, {
        localCache: fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager() }),
      });
      provider = new fb.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await fb.getRedirectResult(auth).catch(() => null);
    },
    onUser(cb) {
      return fb.onAuthStateChanged(auth, (u) =>
        cb(u ? { uid: u.uid, email: (u.email || '').toLowerCase(), name: u.displayName || u.email, photo: u.photoURL } : null),
      );
    },
    async signIn() {
      try {
        await fb.signInWithPopup(auth, provider);
      } catch (e) {
        if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
          return fb.signInWithRedirect(auth, provider);
        }
        if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return;
        if (e.code === 'auth/unauthorized-domain') {
          throw new Error('Denne nettadressen er ikke godkjent i Firebase. Legg den til under Authentication → Settings → Authorized domains.');
        }
        throw e;
      }
    },
    signOut: () => fb.signOut(auth),
    async reauth() {
      await fb.reauthenticateWithPopup(auth.currentUser, provider);
    },
    /** true hvis innlogget bruker slipper inn i databasen (står i sikkerhetsreglene) */
    async checkAccess() {
      try {
        await fb.getDoc(fb.doc(db, 'household', 'main'));
        return true;
      } catch (e) {
        if (e.code === 'permission-denied') return false;
        throw e;
      }
    },
    watchDoc(path, cb, onErr) {
      return fb.onSnapshot(fb.doc(db, path), (s) => cb(s.exists() ? s.data() : null), onErr);
    },
    watchCollection(name, cb, onErr) {
      return fb.onSnapshot(fb.collection(db, name), (qs) => cb(qs.docs.map((d) => ({ ...d.data(), id: d.id }))), onErr);
    },
    saveDoc: (path, data) => fb.setDoc(fb.doc(db, path), stripUndefined(data)),
    mergeDoc: (path, data) => fb.setDoc(fb.doc(db, path), stripUndefined(data), { merge: true }),
    put: (col, item) => fb.setDoc(fb.doc(db, col, item.id), stripUndefined(item)),
    del: (col, id) => fb.deleteDoc(fb.doc(db, col, id)),
    async saveFile(file) {
      const b64 = await fileToBase64(file);
      const id = newId();
      const n = Math.ceil(b64.length / CHUNK) || 1;
      for (let i = 0; i < n; i++) {
        await fb.setDoc(fb.doc(db, 'files', id, 'chunks', String(i).padStart(3, '0')), { d: b64.slice(i * CHUNK, (i + 1) * CHUNK) });
      }
      await fb.setDoc(fb.doc(db, 'files', id), { name: file.name, type: file.type || 'application/pdf', size: file.size, chunks: n, createdAt: new Date().toISOString() });
      return { id, b64 };
    },
    async loadFileBase64(id) {
      const meta = await fb.getDoc(fb.doc(db, 'files', id));
      if (!meta.exists()) throw new Error('Fant ikke dokumentet.');
      const qs = await fb.getDocs(fb.collection(db, 'files', id, 'chunks'));
      const b64 = qs.docs.sort((a, b) => a.id.localeCompare(b.id)).map((d) => d.data().d).join('');
      return { b64, type: meta.data().type, name: meta.data().name };
    },
    async deleteFile(id) {
      const qs = await fb.getDocs(fb.collection(db, 'files', id, 'chunks'));
      for (const d of qs.docs) await fb.deleteDoc(d.ref);
      await fb.deleteDoc(fb.doc(db, 'files', id));
    },
  };
}

// ═════════════════════════════ DEMO (lokalt) ═════════════════════════════

function demoBackend() {
  const KEY = 'fd.demo.v2';
  let data;
  try {
    data = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    data = null;
  }
  data ||= { docs: {}, cols: {}, files: {}, user: null };
  const docL = new Map(); // path → Set(cb)
  const colL = new Map();
  const userL = new Set();
  const persist = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      /* full lagring – ignorer i demo */
    }
  };
  const emitDoc = (p) => docL.get(p)?.forEach((cb) => cb(structuredClone(data.docs[p] ?? null)));
  const emitCol = (c) => docL && colL.get(c)?.forEach((cb) => cb(Object.values(data.cols[c] || {}).map((x) => structuredClone(x))));
  const later = (fn) => setTimeout(fn, 0);

  return {
    async init() {},
    onUser(cb) {
      userL.add(cb);
      later(() => cb(data.user));
      return () => userL.delete(cb);
    },
    async signIn() {
      data.user = { uid: 'demo', email: 'demo@denne-enheten', name: 'Demo' };
      persist();
      userL.forEach((cb) => cb(data.user));
    },
    async signOut() {
      data.user = null;
      persist();
      userL.forEach((cb) => cb(null));
    },
    async reauth() {},
    async checkAccess() {
      return true;
    },
    watchDoc(path, cb) {
      if (!docL.has(path)) docL.set(path, new Set());
      docL.get(path).add(cb);
      later(() => cb(structuredClone(data.docs[path] ?? null)));
      return () => docL.get(path).delete(cb);
    },
    watchCollection(name, cb) {
      if (!colL.has(name)) colL.set(name, new Set());
      colL.get(name).add(cb);
      later(() => cb(Object.values(data.cols[name] || {}).map((x) => structuredClone(x))));
      return () => colL.get(name).delete(cb);
    },
    async saveDoc(path, value) {
      data.docs[path] = stripUndefined(value);
      persist();
      emitDoc(path);
    },
    async mergeDoc(path, value) {
      const deep = (a, b) => {
        for (const [k, v] of Object.entries(b)) {
          if (v && typeof v === 'object' && !Array.isArray(v)) a[k] = deep(a[k] && typeof a[k] === 'object' ? a[k] : {}, v);
          else a[k] = v;
        }
        return a;
      };
      data.docs[path] = deep(data.docs[path] || {}, stripUndefined(value));
      persist();
      emitDoc(path);
    },
    async put(col, item) {
      (data.cols[col] ||= {})[item.id] = stripUndefined(item);
      persist();
      emitCol(col);
    },
    async del(col, id) {
      delete data.cols[col]?.[id];
      persist();
      emitCol(col);
    },
    async saveFile(file) {
      const b64 = await fileToBase64(file);
      const id = newId();
      data.files[id] = { name: file.name, type: file.type || 'application/pdf', b64 };
      persist();
      return { id, b64 };
    },
    async loadFileBase64(id) {
      const f = data.files[id];
      if (!f) throw new Error('Fant ikke dokumentet (i demo-modus lagres store filer ikke mellom økter).');
      return { b64: f.b64, type: f.type, name: f.name };
    },
    async deleteFile(id) {
      delete data.files[id];
      persist();
    },
  };
}

export const backend = isDemo ? demoBackend() : firebaseBackend();

export function assertFileSize(file) {
  if (file.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`Fila er for stor (maks ${MAX_FILE_MB} MB).`);
}
