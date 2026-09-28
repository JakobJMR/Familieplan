// 🍷 Vinkjeller: ta bilde av etiketten → AI kjenner igjen vinen og fyller ut resten.

import { esc, openModal, confirmDialog, toast } from '../util.js';
import { state, upsert, remove } from '../store.js';
import { emptyState } from '../components.js';
import { hasAI } from '../ai.js';
import { identifyWine } from '../ai-extra.js';
import { compressImage, thumbnail, blobToBase64 } from '../media.js';
import { backend, base64ToBlob } from '../backend.js';

const TYPES = { 'rød': '🍷', hvit: '🥂', 'rosé': '🌸', musserende: '🍾', 'søt': '🍯', oransje: '🍊', annet: '🍇' };
let filter = 'alle';
let sort = 'status';

const year = () => new Date().getFullYear();

/** { key, label, cls } – hvor i livet vinen er */
export function wineStatus(w) {
  const y = year();
  if (w.drinkUntil && y > w.drinkUntil) return { key: 'passert', label: 'Bør drikkes nå – passert toppen', cls: 'alert' };
  if (w.drinkUntil && y >= w.drinkUntil - 1 && (!w.drinkFrom || y >= w.drinkFrom)) return { key: 'snart', label: 'Drikk snart', cls: 'warn' };
  if (w.drinkFrom && y < w.drinkFrom) return { key: 'lagre', label: `Lagres – klar fra ${w.drinkFrom}`, cls: 'info' };
  if (w.drinkFrom || w.drinkUntil) return { key: 'klar', label: `Klar${w.drinkUntil ? ` (til ${w.drinkUntil})` : ''}`, cls: 'ok' };
  return { key: 'ukjent', label: 'Drikkevindu ukjent', cls: '' };
}
const ORDER = { passert: 0, snart: 1, klar: 2, ukjent: 3, lagre: 4 };

export function renderWine() {
  const wines = state.wines.filter((w) => (w.bottles || 0) > 0 || filter === 'tomme');
  const total = state.wines.reduce((s, w) => s + (w.bottles || 0), 0);
  const counts = { klar: 0, snart: 0, lagre: 0, passert: 0 };
  state.wines.filter((w) => (w.bottles || 0) > 0).forEach((w) => counts[wineStatus(w).key] !== undefined && (counts[wineStatus(w).key] += w.bottles));
  let list = wines.filter((w) => {
    const st = wineStatus(w).key;
    if (filter === 'alle') return true;
    if (filter === 'tomme') return !(w.bottles > 0);
    if (filter === 'drikk') return st === 'snart' || st === 'passert' || st === 'klar';
    if (filter === 'lagre') return st === 'lagre';
    return w.type === filter;
  });
  list = list.sort((a, b) =>
    sort === 'status' ? ORDER[wineStatus(a).key] - ORDER[wineStatus(b).key] || (a.drinkUntil || 9999) - (b.drinkUntil || 9999)
      : sort === 'aar' ? (a.vintage || 0) - (b.vintage || 0)
      : `${a.producer} ${a.name}`.localeCompare(`${b.producer} ${b.name}`, 'nb'),
  );

  return `
  <header class="view-head"><div><a href="#/mer" class="back-link">‹ Mer</a><h1>🍷 Vinkjeller</h1></div>
    <label class="btn primary">📷 Legg til<input type="file" accept="image/*" capture="environment" hidden data-add-photo></label></header>
  ${state.wines.length ? `<div class="stat-row four">
    <div class="card stat"><span class="stat-label">Flasker</span><span class="stat-num">${total}</span></div>
    <div class="card stat"><span class="stat-label">🟢 Klare</span><span class="stat-num">${counts.klar}</span></div>
    <div class="card stat"><span class="stat-label">🟠 Drikk snart</span><span class="stat-num">${counts.snart + counts.passert}</span></div>
    <div class="card stat"><span class="stat-label">🔵 Lagres</span><span class="stat-num">${counts.lagre}</span></div>
  </div>
  <div class="filter-row">
    ${[['alle', 'Alle'], ['drikk', 'Klar til å drikkes'], ['lagre', 'Lagres'], ...Object.keys(TYPES).filter((t) => state.wines.some((w) => w.type === t)).map((t) => [t, TYPES[t] + ' ' + t]), ['tomme', 'Drukket opp']]
      .map(([k, l]) => `<button class="chip small ${filter === k ? 'on' : ''}" data-wfilter="${k}">${esc(l)}</button>`).join('')}
    <select data-wsort class="sort-select"><option value="status" ${sort === 'status' ? 'selected' : ''}>Sorter: drikkevindu</option><option value="navn" ${sort === 'navn' ? 'selected' : ''}>Sorter: navn</option><option value="aar" ${sort === 'aar' ? 'selected' : ''}>Sorter: årgang</option></select>
  </div>` : ''}
  ${list.length ? `<ul class="wine-grid">${list.map(card).join('')}</ul>`
    : emptyState('🍷', state.wines.length ? 'Ingen viner i dette utvalget' : 'Vinkjelleren er tom', hasAI() ? 'Ta bilde av etiketten, så kjenner AI igjen vinen og fyller ut lagringspotensial og drikkevindu.' : 'Legg inn vinene dine. Med Gemini-nøkkel kan appen kjenne igjen vinen fra et bilde av etiketten.')}
  <button class="btn ghost small" data-add-manual style="margin-top:12px">＋ Legg inn uten bilde</button>`;
}

function card(w) {
  const st = wineStatus(w);
  return `<li><button class="wine-card" data-wine="${esc(w.id)}">
    <span class="wine-img">${w.thumb ? `<img src="${w.thumb}" alt="">` : `<span>${TYPES[w.type] || '🍷'}</span>`}</span>
    <span class="wine-info">
      <b>${esc(w.name)}${w.vintage ? ' ' + esc(w.vintage) : ''}</b>
      <small>${esc([w.producer, w.region, w.country].filter(Boolean).join(' · '))}</small>
      <span class="wine-badges"><span class="wbadge ${st.cls}">${esc(st.label)}</span>${w.cellarWorthy ? '<span class="wbadge">🏆 Lagringsverdig</span>' : ''}</span>
    </span>
    <span class="wine-count">${w.bottles || 0}<small>fl.</small></span>
  </button></li>`;
}

export function bindWine(root, rerender) {
  root.querySelectorAll('[data-wfilter]').forEach((b) => (b.onclick = () => ((filter = b.dataset.wfilter), rerender())));
  root.querySelector('[data-wsort]')?.addEventListener('change', (e) => ((sort = e.target.value), rerender()));
  root.querySelector('[data-add-manual]').onclick = () => wineModal({ bottles: 1, type: 'rød' });
  root.querySelector('[data-add-photo]').onchange = (e) => addFromPhoto(e.target.files[0]);
  root.querySelectorAll('[data-wine]').forEach((b) => (b.onclick = () => wineDetail(state.wines.find((w) => w.id === b.dataset.wine))));
}

async function addFromPhoto(file) {
  if (!file) return;
  const close = openModal('<div class="center-pad"><div class="gate-emoji spin">🍷</div><p class="muted">Lagrer bildet og ser på etiketten …</p></div>');
  try {
    const small = await compressImage(file, 1400);
    const [thumb, b64] = await Promise.all([thumbnail(small, 300), blobToBase64(small)]);
    const { id: photoFileId } = await backend.saveFile(small);
    let data = {};
    if (hasAI()) {
      try {
        data = await identifyWine(b64);
      } catch (err) {
        toast(`AI klarte ikke å lese etiketten: ${err.message}`, 'error');
      }
    }
    close();
    wineModal({ ...cleanWine(data), thumb, photoFileId, bottles: 1, fromAI: !!data.name });
  } catch (err) {
    close();
    toast(err.message, 'error');
  }
}

function cleanWine(d = {}) {
  const yr = (v) => (Number.isInteger(Number(v)) && Number(v) > 1900 && Number(v) < 2200 ? Number(v) : null);
  return {
    name: d.name || '', producer: d.producer || '', vintage: yr(d.vintage), type: TYPES[d.type] ? d.type : 'rød',
    grapes: d.grapes || '', region: d.region || '', country: d.country || '', abv: Number(d.abv) || null,
    drinkFrom: yr(d.drinkFrom), drinkUntil: yr(d.drinkUntil), storage: d.storage || '', cellarWorthy: d.cellarWorthy === true,
    style: d.style || '', pairing: d.pairing || '', confidence: d.confidence || '',
  };
}

function wineModal(w) {
  const editing = !!w.id;
  const rooms = state.rooms;
  openModal(
    `<form class="form" novalidate>
      <h2 class="modal-title">${w.fromAI ? '✨ Sjekk det AI fant' : editing ? 'Endre vin' : 'Ny vin'}</h2>
      ${w.fromAI && w.confidence && w.confidence !== 'høy' ? `<p class="hint warn-text" style="margin-top:-6px">AI var ${esc(w.confidence)} sikker – se nøye over.</p>` : ''}
      ${w.thumb ? `<img src="${w.thumb}" alt="" class="wine-modal-img">` : ''}
      <label class="field"><span>Navn</span><input name="name" value="${esc(w.name || '')}" maxlength="80"></label>
      <div class="row2">
        <label class="field"><span>Produsent</span><input name="producer" value="${esc(w.producer || '')}" maxlength="60"></label>
        <label class="field"><span>Årgang</span><input name="vintage" inputmode="numeric" value="${esc(w.vintage || '')}" maxlength="4"></label>
      </div>
      <div class="row2">
        <label class="field"><span>Type</span><select name="type">${Object.entries(TYPES).map(([k, e]) => `<option value="${k}" ${w.type === k ? 'selected' : ''}>${e} ${k}</option>`).join('')}</select></label>
        <label class="field"><span>Antall flasker</span><input name="bottles" inputmode="numeric" value="${esc(w.bottles ?? 1)}"></label>
      </div>
      <div class="row2">
        <label class="field"><span>Drue(r)</span><input name="grapes" value="${esc(w.grapes || '')}"></label>
        <label class="field"><span>Område / land</span><input name="region" value="${esc([w.region, w.country].filter(Boolean).join(', '))}"></label>
      </div>
      <div class="row2">
        <label class="field"><span>Drikkes fra (år)</span><input name="drinkFrom" inputmode="numeric" value="${esc(w.drinkFrom || '')}" maxlength="4"></label>
        <label class="field"><span>Drikkes innen (år)</span><input name="drinkUntil" inputmode="numeric" value="${esc(w.drinkUntil || '')}" maxlength="4"></label>
      </div>
      <label class="toggle-line"><input type="checkbox" name="cellarWorthy" ${w.cellarWorthy ? 'checked' : ''}> 🏆 Lagringsverdig</label>
      <label class="field"><span>Lagringspotensial</span><input name="storage" value="${esc(w.storage || '')}"></label>
      <label class="field"><span>Stil og smak</span><textarea name="style" rows="2">${esc(w.style || '')}</textarea></label>
      <label class="field"><span>Passer til</span><input name="pairing" value="${esc(w.pairing || '')}"></label>
      <div class="row2">
        <label class="field"><span>Pris per flaske (kr)</span><input name="price" inputmode="numeric" value="${esc(w.price ?? '')}"></label>
        <label class="field"><span>Hvor står den?</span><select name="room"><option value="">—</option>${rooms.map((r) => `<option value="${esc(r.id)}" ${w.roomId === r.id ? 'selected' : ''}>${esc(r.emoji || '')} ${esc(r.name)}</option>`).join('')}</select></label>
      </div>
      <label class="field"><span>Plass / hylle</span><input name="place" value="${esc(w.place || '')}" placeholder="F.eks. Reol B, rad 3"></label>
      <label class="field"><span>Egne notater</span><textarea name="notes" rows="2">${esc(w.notes || '')}</textarea></label>
      <div class="modal-actions">
        ${editing ? '<button type="button" class="btn danger ghost" data-delete>Slett</button>' : ''}<span class="spacer"></span>
        <button type="button" class="btn ghost" data-close>Avbryt</button><button type="submit" class="btn primary">Lagre</button>
      </div>
    </form>`,
    (root, close) => {
      const form = root.querySelector('form');
      const f = form.elements;
      const int = (v) => (v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));
      form.onsubmit = (e) => {
        e.preventDefault();
        const name = f.name.value.trim();
        if (!name) return toast('Gi vinen et navn.', 'error');
        const [region, ...rest] = f.region.value.split(',').map((x) => x.trim());
        const clean = { ...w };
        delete clean.fromAI;
        delete clean.confidence;
        upsert('wines', {
          ...clean, name, producer: f.producer.value.trim(), vintage: int(f.vintage.value), type: f.type.value,
          bottles: Math.max(0, int(f.bottles.value) ?? 1), grapes: f.grapes.value.trim(), region: region || '', country: rest.join(', ') || w.country || '',
          drinkFrom: int(f.drinkFrom.value), drinkUntil: int(f.drinkUntil.value), cellarWorthy: f.cellarWorthy.checked,
          storage: f.storage.value.trim(), style: f.style.value.trim(), pairing: f.pairing.value.trim(),
          price: int(f.price.value), roomId: f.room.value || null, place: f.place.value.trim(), notes: f.notes.value.trim(),
        });
        close();
      };
      root.querySelector('[data-delete]')?.addEventListener('click', async () => {
        if (!(await confirmDialog(`Slette «${w.name}»?`))) return;
        if (w.photoFileId) backend.deleteFile(w.photoFileId).catch(() => {});
        remove('wines', w.id);
        close();
      });
    },
  );
}

function wineDetail(w) {
  if (!w) return;
  const st = wineStatus(w);
  const room = state.rooms.find((r) => r.id === w.roomId);
  const row = (k, v) => (v ? `<div class="kv"><span>${k}</span><b>${esc(v)}</b></div>` : '');
  openModal(
    `<div class="wine-detail">
      ${w.thumb ? `<img src="${w.thumb}" alt="" class="wine-modal-img" data-full>` : ''}
      <h2 class="modal-title">${esc(w.name)}${w.vintage ? ' ' + esc(w.vintage) : ''}</h2>
      <p class="muted">${esc([w.producer, w.region, w.country].filter(Boolean).join(' · '))}</p>
      <p><span class="wbadge ${st.cls}">${esc(st.label)}</span>${w.cellarWorthy ? ' <span class="wbadge">🏆 Lagringsverdig</span>' : ''}</p>
      <div class="bottle-ctl">
        <button class="icon-btn" data-dec aria-label="Én mindre">−</button>
        <span><b data-count>${w.bottles || 0}</b> flasker</span>
        <button class="icon-btn" data-inc aria-label="Én mer">＋</button>
        <button class="btn primary small" data-drink>🍷 Drikk en</button>
      </div>
      ${row('Type', `${TYPES[w.type] || ''} ${w.type}`)}${row('Druer', w.grapes)}${row('Drikkevindu', w.drinkFrom || w.drinkUntil ? `${w.drinkFrom || '?'}–${w.drinkUntil || '?'}` : '')}
      ${row('Lagring', w.storage)}${row('Stil', w.style)}${row('Passer til', w.pairing)}${row('Pris', w.price ? w.price + ' kr' : '')}
      ${row('Står i', [room ? room.emoji + ' ' + room.name : '', w.place].filter(Boolean).join(' · '))}${row('Notater', w.notes)}
      ${w.drunk?.length ? `<p class="hint">Drukket: ${w.drunk.slice(-5).map(esc).join(', ')}</p>` : ''}
      <div class="modal-actions"><span class="spacer"></span><button class="btn ghost" data-close>Lukk</button><button class="btn primary" data-edit>Endre</button></div>
    </div>`,
    (root, close) => {
      const set = (n, drank = false) => {
        const drunk = drank ? [...(w.drunk || []), new Date().toISOString().slice(0, 10)] : w.drunk || [];
        Object.assign(w, upsert('wines', { ...w, bottles: Math.max(0, n), drunk }));
        root.querySelector('[data-count]').textContent = w.bottles;
      };
      root.querySelector('[data-dec]').onclick = () => set((w.bottles || 0) - 1);
      root.querySelector('[data-inc]').onclick = () => set((w.bottles || 0) + 1);
      root.querySelector('[data-drink]').onclick = () => {
        if (!(w.bottles > 0)) return toast('Ingen flasker igjen.', 'error');
        set(w.bottles - 1, true);
        toast(`🍷 Skål! ${w.bottles} igjen av ${w.name}`, 'ok');
      };
      root.querySelector('[data-edit]').onclick = () => (close(), wineModal(w));
      root.querySelector('[data-full]')?.addEventListener('click', async () => {
        if (!w.photoFileId) return;
        const { b64, type } = await backend.loadFileBase64(w.photoFileId);
        openModal(`<img src="${URL.createObjectURL(base64ToBlob(b64, type))}" alt="" class="doc-img"><div class="modal-actions"><span class="spacer"></span><button class="btn ghost" data-close>Lukk</button></div>`);
      });
    },
  );
}

export function wineNotices() {
  const drinkNow = state.wines.filter((w) => w.bottles > 0 && ['snart', 'passert'].includes(wineStatus(w).key));
  if (!drinkNow.length) return [];
  return [{ icon: '🍷', kind: 'info', text: `${drinkNow.length} ${drinkNow.length === 1 ? 'vin' : 'viner'} bør drikkes snart`, detail: drinkNow.slice(0, 3).map((w) => `${w.name} ${w.vintage || ''}`).join(' · '), go: 'vin' }];
}
