// Appens tilstand. Data strømmer inn i sanntid fra databasen (Firestore),
// så endringer på én enhet dukker opp på de andre av seg selv.

import { backend } from './backend.js';
import { toast, uid } from './util.js';

export const COLLECTIONS = ['events', 'tasks', 'shopping', 'costs', 'insurance', 'mileage', 'meals', 'recipes', 'lists', 'pantry', 'rooms', 'things', 'wines', 'products'];

export const state = {
  user: null,
  household: null,
  secrets: null, // { geminiKey, geminiModel, pinHash, pinSalt }
  stats: {}, // lærte handlevaner per type liste
  filter: null,
  weather: null,
  power: {},
  ...Object.fromEntries(COLLECTIONS.map((c) => [c, []])),
};

const listeners = new Set();
export const subscribe = (fn) => listeners.add(fn);
let queued = false;
export const notify = () => {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    listeners.forEach((fn) => fn());
  });
};

try {
  state.filter = localStorage.getItem('fd.filter') || null;
} catch {
  /* ignorer */
}

export function setFilter(memberId) {
  state.filter = state.filter === memberId ? null : memberId;
  try {
    if (state.filter) localStorage.setItem('fd.filter', state.filter);
    else localStorage.removeItem('fd.filter');
  } catch {
    /* ignorer */
  }
  notify();
}

let unsubs = [];
/** Starter sanntidslyttere. Løses når husstand og hemmeligheter er lastet første gang. */
export function startData() {
  stopData();
  return new Promise((resolve, reject) => {
    let pending = 2;
    const done = () => --pending === 0 && resolve();
    const onErr = (e) => {
      console.error(e);
      reject(e);
    };
    let first1 = true, first2 = true;
    unsubs.push(
      backend.watchDoc('household/main', (d) => {
        state.household = d;
        if (state.filter && !d?.members?.some((m) => m.id === state.filter)) state.filter = null;
        notify();
        if (first1) (first1 = false), done();
      }, onErr),
      backend.watchDoc('secrets/main', (d) => {
        state.secrets = d || {};
        notify();
        if (first2) (first2 = false), done();
      }, onErr),
      backend.watchDoc('stats/shopping', (d) => {
        state.stats = d || {};
        notify();
      }, (e) => console.error('stats', e)),
      ...COLLECTIONS.map((c) =>
        backend.watchCollection(c, (items) => {
          state[c] = items;
          notify();
        }, (e) => console.error(c, e)),
      ),
    );
  });
}
export function stopData() {
  unsubs.forEach((u) => u?.());
  unsubs = [];
}

const fail = (msg) => (e) => {
  console.error(e);
  toast(e?.code === 'permission-denied' ? 'Ingen tilgang til å lagre.' : msg, 'error');
  throw e;
};

export async function saveHousehold(household) {
  const h = { ...household, updatedAt: new Date().toISOString(), updatedBy: state.user?.email || '' };
  state.household = h; // vis med en gang
  notify();
  await backend.saveDoc('household/main', h).catch(fail('Kunne ikke lagre oppsettet.'));
  return h;
}

export async function saveSecrets(patch) {
  const s = { ...(state.secrets || {}), ...patch };
  state.secrets = s;
  notify();
  await backend.saveDoc('secrets/main', s).catch(fail('Kunne ikke lagre.'));
}

export function upsert(collection, item) {
  const full = { createdAt: new Date().toISOString(), ...item, id: item.id || uid(), updatedAt: new Date().toISOString() };
  // Vis endringen med en gang (databasen bekrefter i bakgrunnen)
  const i = state[collection].findIndex((x) => x.id === full.id);
  state[collection] = i >= 0 ? state[collection].map((x) => (x.id === full.id ? full : x)) : [...state[collection], full];
  notify();
  backend.put(collection, full).catch(fail('Kunne ikke lagre – sjekk nettforbindelsen.')).catch(() => {});
  return full;
}

export function remove(collection, id) {
  state[collection] = state[collection].filter((x) => x.id !== id);
  notify();
  backend.del(collection, id).catch(fail('Kunne ikke slette.')).catch(() => {});
}

export function clearDoneShopping() {
  state.shopping.filter((x) => x.done).forEach((x) => remove('shopping', x.id));
}

export const member = (id) => state.household?.members?.find((m) => m.id === id) || null;
export const memberByName = (name) =>
  state.household?.members?.find((m) => m.name.toLowerCase() === String(name || '').toLowerCase().trim()) || null;

/** Slår sammen (merge) et dokument – brukes for statistikk */
export function mergeDoc(path, data) {
  return backend.mergeDoc(path, data).catch((e) => console.error(e));
}
