// Flere handlelister + læring av handlevaner.
// Hver liste har en «type» (Norge, Sverige, annet). Appen husker hva som kjøpes på
// hver type liste, så nye lister av samme type får gode forslag med en gang.

import { state, upsert, mergeDoc } from './store.js';
import { guessEmoji } from './emoji.js';

export const KINDS = {
  norge: { flag: '🇳🇴', label: 'Dagligvare i Norge' },
  sverige: { flag: '🇸🇪', label: 'Handel i Sverige' },
  annet: { flag: '🛍️', label: 'Annen butikk' },
};

// Utgangspunkt før appen har lært noe
const PRESETS = {
  norge: ['Melk', 'Brød', 'Egg', 'Smør', 'Ost', 'Pålegg', 'Bananer', 'Epler', 'Agurk', 'Tomater', 'Yoghurt', 'Kaffe', 'Dopapir', 'Kjøttdeig', 'Pasta'],
  sverige: ['Kjøttdeig', 'Kyllingfilet', 'Bacon', 'Pølser', 'Ost', 'Smør', 'Kaffe', 'Brus', 'Godteri', 'Sjokolade', 'Chips', 'Juice', 'Vaskemiddel', 'Tørkerull', 'Dopapir'],
  annet: [],
};

export const DEFAULT_LIST = { id: 'main', name: 'Handleliste', emoji: '🛒', kind: 'norge', toPantry: true, order: 0 };

export function allLists() {
  const lists = [...state.lists];
  if (!lists.some((l) => l.id === 'main')) lists.unshift(DEFAULT_LIST);
  return lists.sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || (a.createdAt || '').localeCompare(b.createdAt || ''));
}
export const listById = (id) => allLists().find((l) => l.id === id) || DEFAULT_LIST;
export const itemsIn = (listId) => state.shopping.filter((x) => (x.listId || 'main') === listId);
export const openCount = (listId) => itemsIn(listId).filter((x) => !x.done).length;

/** Finner liste ut fra navn/type («svensk», «Sverige», «norsk») */
export function resolveList(name) {
  if (!name) return null;
  const n = String(name).toLowerCase();
  const lists = allLists();
  return (
    lists.find((l) => l.name.toLowerCase() === n) ||
    lists.find((l) => l.name.toLowerCase().includes(n) || n.includes(l.name.toLowerCase())) ||
    (/svensk|sverige|swe/.test(n) && lists.find((l) => l.kind === 'sverige')) ||
    (/norsk|norge/.test(n) && lists.find((l) => l.kind === 'norge')) ||
    null
  );
}

const statKey = (name) => name.toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 60);

function learn(kind, name, emoji) {
  const key = statKey(name);
  if (!key) return;
  const prev = state.stats?.[kind]?.[key];
  const entry = { name, emoji, n: (prev?.n || 0) + 1, last: new Date().toISOString().slice(0, 10) };
  state.stats = { ...state.stats, [kind]: { ...(state.stats?.[kind] || {}), [key]: entry } };
  mergeDoc('stats/shopping', { [kind]: { [key]: entry } });
}

/** Legger en vare på en liste (eller henter den fram igjen hvis den er avhaket). */
export function addItem(listId, rawName, emoji) {
  const name = String(rawName || '').trim();
  if (!name) return;
  const nice = name.charAt(0).toUpperCase() + name.slice(1);
  const list = listById(listId);
  const existing = itemsIn(list.id).find((x) => x.name.toLowerCase() === nice.toLowerCase());
  if (existing) {
    if (existing.done) upsert('shopping', { ...existing, done: false });
    return existing;
  }
  const e = emoji || guessEmoji(nice);
  learn(list.kind || 'annet', nice, e);
  return upsert('shopping', { name: nice, emoji: e, done: false, listId: list.id });
}

/** Forslag for en liste: det familien pleier å kjøpe på denne typen liste, ellers standardforslag. */
export function suggestions(listId, max = 14) {
  const list = listById(listId);
  const kind = list.kind || 'annet';
  const have = new Set(itemsIn(list.id).filter((x) => !x.done).map((x) => x.name.toLowerCase()));
  const learned = Object.values(state.stats?.[kind] || {})
    .sort((a, b) => b.n - a.n || (b.last || '').localeCompare(a.last || ''))
    .map((s) => ({ name: s.name, emoji: s.emoji, learned: true }));
  const presets = (PRESETS[kind] || []).map((name) => ({ name, emoji: guessEmoji(name) }));
  const out = [];
  const seen = new Set();
  for (const s of [...learned, ...presets]) {
    const k = s.name.toLowerCase();
    if (seen.has(k) || have.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}
