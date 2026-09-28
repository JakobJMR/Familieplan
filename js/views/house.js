// 🏠 Huset: enkel tegning per etasje, rom med innhold (ting og bokser), søk,
// «hvor er …?» med AI, bilde → innholdsliste og QR-etiketter på boksene.

import { esc, uid, openModal, confirmDialog, toast } from '../util.js';
import { state, upsert, remove, saveHousehold } from '../store.js';
import { emptyState, pickEmoji } from '../components.js';
import { hasAI } from '../ai.js';
import { askHouse, photoContents } from '../ai-extra.js';
import { compressImage, thumbnail, blobToBase64, readQR, qrSVG } from '../media.js';
import { backend, base64ToBlob } from '../backend.js';

const GW = 12; // rutenett-bredde
const GH = 8; // rutenett-høyde
const ROOM_EMOJIS = ['🛋️', '🍳', '🛏️', '🛁', '🚿', '🧸', '💻', '🧺', '📦', '🚪', '🔧', '🚗', '🍷', '🌱', '🎮', '🏋️', '👕', '🪜'];
const THING_EMOJIS = ['📦', '👕', '👶', '🎄', '🎿', '⛸️', '🧰', '🔌', '📚', '🧸', '🍽️', '🕯️', '🎒', '🧳', '🪛', '🎨', '🏕️', '🎁'];
const COLORS = ['#E8F1EC', '#F6EAD9', '#E6ECF6', '#F3E4EC', '#ECEAF6', '#EEF3E0', '#F7EFD2', '#E2EEF1'];

let editMode = false;
let floorId = null;
let query = '';
let aiAnswer = null;

const floors = () => {
  const f = state.household?.floors;
  return f?.length ? f : [{ id: 'f1', name: '1. etasje', emoji: '🏠' }];
};
const roomsOn = (fid) => state.rooms.filter((r) => (r.floorId || 'f1') === fid);
const thingsIn = (rid) => state.things.filter((t) => t.roomId === rid);
const roomById = (id) => state.rooms.find((r) => r.id === id);
const floorById = (id) => floors().find((f) => f.id === id);
const roomLabel = (r) => `${r.emoji || ''} ${r.name}${floors().length > 1 ? ` (${floorById(r.floorId || 'f1')?.name || ''})` : ''}`;

// ───────────── Tekst til AI og søk ─────────────

export function inventoryText(short = false) {
  if (!state.rooms.length) return short ? '' : '(ingen rom registrert)';
  const lines = [];
  for (const r of state.rooms) {
    const f = floorById(r.floorId || 'f1');
    const things = thingsIn(r.id);
    lines.push(`Rom: ${r.name} (${f?.name || ''})${things.length ? '' : ' – tomt'}`);
    for (const t of things) {
      lines.push(`  - ${t.name}${t.place ? ` [${t.place}]` : ''}${t.contents?.length ? ` – innhold: ${t.contents.join(', ')}` : ''}${t.tags?.length ? ` (stikkord: ${t.tags.join(', ')})` : ''}`);
    }
  }
  const txt = lines.join('\n');
  const max = short ? 6000 : 30000;
  return (short ? 'Husets inventar:\n' : '') + (txt.length > max ? txt.slice(0, max) + '\n…' : txt);
}

/** Finner rom ut fra fritekst som «boden oppe» eller «stue i kjeller» */
export function findRoom(text) {
  if (!text) return null;
  const words = String(text).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !['med', 'the', 'rommet'].includes(w));
  let best = null;
  let bestScore = 0;
  for (const r of state.rooms) {
    const f = floorById(r.floorId || 'f1');
    const cand = `${r.name} ${f?.name || ''} ${f?.aliases || ''}`.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    let score = 0;
    for (const w of words) if (cand.some((c) => c.length >= 3 && (w.startsWith(c) || c.startsWith(w)))) score++;
    if (String(text).toLowerCase().includes(r.name.toLowerCase())) score += 2;
    if (score > bestScore) (best = r), (bestScore = score);
  }
  return best;
}

function search(q) {
  const n = q.toLowerCase().trim();
  if (!n) return [];
  const terms = n.split(/\s+/).filter(Boolean);
  const hit = (s) => terms.every((t) => s.toLowerCase().includes(t.replace(/\.$/, '')));
  const out = [];
  for (const t of state.things) {
    const r = roomById(t.roomId);
    const all = [t.name, t.place, ...(t.contents || []), ...(t.tags || []), r?.name || ''].join(' ');
    if (!hit(all)) continue;
    const matched = (t.contents || []).filter((c) => terms.some((x) => c.toLowerCase().includes(x)));
    out.push({ t, r, matched });
  }
  return out.slice(0, 30);
}

// ───────────── Visning ─────────────

export function renderHouse(param) {
  if (param?.startsWith('rom:')) {
    const r = roomById(param.slice(4));
    if (r) return renderRoom(r);
  }
  if (param?.startsWith('ting:')) {
    const t = state.things.find((x) => x.id === param.slice(5));
    if (t) return renderRoom(roomById(t.roomId) || { id: '?', name: 'Ukjent rom', emoji: '❓' }, t.id);
  }
  const fl = floors();
  if (!fl.some((f) => f.id === floorId)) floorId = fl[0].id;
  const rooms = roomsOn(floorId);
  const results = search(query);
  const total = state.things.length;

  return `
  <header class="view-head"><div><a href="#/mer" class="back-link">‹ Mer</a><h1>🏠 Huset</h1></div>
    <button class="btn ${editMode ? 'primary' : 'ghost'} small" data-edit-mode>${editMode ? '✔ Ferdig' : '✏️ Rediger tegning'}</button></header>

  <form class="quick-add house-search" data-search>
    <input id="house-q" name="q" value="${esc(query)}" placeholder="Hvor er …? F.eks. «str. 86» eller «julepynt»" autocomplete="off">
    ${hasAI() ? '<button class="btn soft" type="submit" title="Spør AI">✨</button>' : ''}
    <label class="btn ghost" title="Scann etikett">📷<input type="file" accept="image/*" capture="environment" hidden data-scan></label>
  </form>
  ${aiAnswer ? `<div class="card ai-answer"><p>💬 ${esc(aiAnswer)}</p></div>` : ''}
  ${query ? `<div class="search-results">${results.length ? `<ul class="res-list">${results.map(({ t, r, matched }) => `<li><a class="res" href="#/hus/ting:${esc(t.id)}"><span class="pe">${esc(t.emoji || '📦')}</span>
      <span class="pt">${esc(t.name)}${matched.length ? `<small>🔎 ${matched.map(esc).join(', ')}</small>` : ''}<small>📍 ${esc(r ? roomLabel(r) : '?')}${t.place ? ' · ' + esc(t.place) : ''}</small></span></a></li>`).join('')}</ul>`
      : `<p class="muted">Fant ingenting på «${esc(query)}».${hasAI() ? ' Trykk ✨ for å spørre AI.' : ''}</p>`}</div>` : ''}

  <div class="floor-tabs">
    ${fl.map((f) => `<button class="chip ${f.id === floorId ? 'on' : ''}" data-floor="${esc(f.id)}">${esc(f.emoji || '🏠')} ${esc(f.name)}</button>`).join('')}
    ${editMode ? '<button class="chip ghost-chip" data-add-floor>＋ Etasje</button>' : ''}
  </div>

  <div class="plan ${editMode ? 'editing' : ''}" data-plan style="aspect-ratio:${GW}/${GH}">
    ${rooms.map((r) => {
      const n = thingsIn(r.id).length;
      return `<div class="room" data-room="${esc(r.id)}" style="left:${(r.x / GW) * 100}%;top:${(r.y / GH) * 100}%;width:${(r.w / GW) * 100}%;height:${(r.h / GH) * 100}%;background:${esc(r.color || COLORS[0])}">
        <span class="room-emoji">${esc(r.emoji || '🚪')}</span><span class="room-name">${esc(r.name)}</span>${n ? `<span class="room-count">${n}</span>` : ''}
        ${editMode ? '<span class="rs-handle" data-resize></span>' : ''}
      </div>`;
    }).join('')}
    ${!rooms.length ? `<div class="plan-empty">${editMode ? 'Trykk «＋ Rom» for å tegne det første rommet.' : 'Ingen rom her ennå – trykk «Rediger tegning».'}</div>` : ''}
  </div>
  ${editMode ? `<div class="row-btns" style="margin-top:10px">
      <button class="btn primary" data-add-room>＋ Rom</button>
      <button class="btn ghost" data-floor-settings>⚙️ Etasjen</button>
    </div>
    <p class="hint">Dra rommene for å flytte dem, og dra i hjørnet ◢ for å endre størrelse. Trykk på et rom for å gi det navn.</p>`
    : `<p class="hint">${total ? `${total} ting og bokser registrert. ` : ''}Trykk på et rom for å se og legge inn innhold.</p>`}`;
}

function renderRoom(r, highlight = null) {
  const things = thingsIn(r.id).sort((a, b) => (a.place || '').localeCompare(b.place || '', 'nb') || a.name.localeCompare(b.name, 'nb'));
  return `
  <header class="view-head"><div><a href="#/hus" class="back-link">‹ Huset</a><h1>${esc(r.emoji || '🚪')} ${esc(r.name)}</h1>
    <p class="muted">${esc(floorById(r.floorId || 'f1')?.name || '')} · ${things.length} ${things.length === 1 ? 'ting' : 'ting'}</p></div></header>
  <div class="row-btns" style="margin-bottom:14px">
    <button class="btn primary" data-add-thing="boks">＋ Boks</button>
    <button class="btn soft" data-add-thing="ting">＋ Ting</button>
    ${hasAI() ? '<label class="btn soft">📷 Fra bilde ✨<input type="file" accept="image/*" capture="environment" hidden data-photo-add></label>' : ''}
  </div>
  ${things.length ? `<ul class="thing-list">${things.map((t) => `<li class="card thing ${t.id === highlight ? 'highlight' : ''}" id="t-${esc(t.id)}">
      <div class="thing-head">
        ${t.thumb ? `<img class="thing-thumb" src="${t.thumb}" alt="" data-photo="${esc(t.id)}">` : `<span class="thing-emoji">${esc(t.emoji || '📦')}</span>`}
        <div class="pt"><b>${esc(t.name)}</b>${t.place ? `<small>📍 ${esc(t.place)}</small>` : ''}${t.tags?.length ? `<small>🏷️ ${t.tags.map(esc).join(', ')}</small>` : ''}</div>
        <button class="icon-btn subtle" data-edit-thing="${esc(t.id)}" aria-label="Endre">✎</button>
      </div>
      ${t.contents?.length ? `<ul class="contents">${t.contents.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
      ${t.kind === 'boks' ? `<button class="btn ghost small" data-label="${esc(t.id)}">🏷️ QR-etikett</button>` : ''}
    </li>`).join('')}</ul>`
    : emptyState('📦', 'Ingenting registrert i dette rommet', 'Legg inn bokser og ting – eller ta et bilde av en åpen boks, så lager AI innholdslista.')}`;
}

// ───────────── Hendelser ─────────────

export function bindHouse(root, rerender, param) {
  if (param?.startsWith('rom:') || param?.startsWith('ting:')) return bindRoom(root, param);

  root.querySelector('[data-edit-mode]').onclick = () => ((editMode = !editMode), rerender());
  root.querySelectorAll('[data-floor]').forEach((b) => (b.onclick = () => ((floorId = b.dataset.floor), rerender())));
  const qInput = root.querySelector('#house-q');
  let timer;
  qInput.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      query = qInput.value;
      aiAnswer = null;
      rerender();
    }, 200);
  });
  root.querySelector('[data-search]').onsubmit = async (e) => {
    e.preventDefault();
    const q = qInput.value.trim();
    if (!q || !hasAI()) return;
    query = q;
    aiAnswer = '✨ Leter …';
    rerender();
    try {
      aiAnswer = await askHouse(q, inventoryText());
    } catch (err) {
      aiAnswer = err.message;
    }
    rerender();
  };
  root.querySelector('[data-scan]').onchange = (e) => scanLabel(e.target.files[0]);

  root.querySelector('[data-add-floor]')?.addEventListener('click', () => floorModal({}, rerender));
  root.querySelector('[data-floor-settings]')?.addEventListener('click', () => floorModal(floorById(floorId), rerender));
  root.querySelector('[data-add-room]')?.addEventListener('click', () => {
    const spot = freeSpot(roomsOn(floorId));
    upsert('rooms', { floorId, name: 'Nytt rom', emoji: '🚪', color: COLORS[state.rooms.length % COLORS.length], ...spot });
  });

  const plan = root.querySelector('[data-plan]');
  root.querySelectorAll('[data-room]').forEach((el) => {
    const r = roomById(el.dataset.room);
    if (!editMode) {
      el.onclick = () => (location.hash = `#/hus/rom:${r.id}`);
      return;
    }
    enableDrag(el, plan, r, () => roomModal(r));
  });
}

function freeSpot(rooms) {
  const taken = (x, y, w, h) => rooms.some((r) => x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y);
  for (let y = 0; y <= GH - 2; y++) for (let x = 0; x <= GW - 3; x++) if (!taken(x, y, 3, 2)) return { x, y, w: 3, h: 2 };
  return { x: 0, y: 0, w: 3, h: 2 };
}

/** Dra for å flytte, dra i hjørnet for å endre størrelse. Kort trykk = innstillinger. */
function enableDrag(el, plan, r, onTap) {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const resize = !!e.target.closest('[data-resize]');
    const rect = plan.getBoundingClientRect();
    const cw = rect.width / GW;
    const ch = rect.height / GH;
    const start = { px: e.clientX, py: e.clientY, x: r.x, y: r.y, w: r.w, h: r.h };
    let moved = false;
    let cur = { ...start };
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    const move = (ev) => {
      const dx = Math.round((ev.clientX - start.px) / cw);
      const dy = Math.round((ev.clientY - start.py) / ch);
      if (Math.abs(ev.clientX - start.px) > 6 || Math.abs(ev.clientY - start.py) > 6) moved = true;
      if (resize) {
        cur.w = Math.max(1, Math.min(GW - start.x, start.w + dx));
        cur.h = Math.max(1, Math.min(GH - start.y, start.h + dy));
      } else {
        cur.x = Math.max(0, Math.min(GW - start.w, start.x + dx));
        cur.y = Math.max(0, Math.min(GH - start.h, start.y + dy));
      }
      Object.assign(el.style, { left: (cur.x / GW) * 100 + '%', top: (cur.y / GH) * 100 + '%', width: (cur.w / GW) * 100 + '%', height: (cur.h / GH) * 100 + '%' });
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.classList.remove('dragging');
      if (!moved) return onTap();
      if (cur.x !== r.x || cur.y !== r.y || cur.w !== r.w || cur.h !== r.h) upsert('rooms', { ...r, x: cur.x, y: cur.y, w: cur.w, h: cur.h });
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
}

function roomModal(r) {
  let emoji = r.emoji || '🚪';
  let color = r.color || COLORS[0];
  const n = thingsIn(r.id).length;
  openModal(
    `<form class="form">
      <h2 class="modal-title">Rom</h2>
      <div class="title-row">
        <button type="button" class="emoji-btn big" data-emoji>${esc(emoji)}</button>
        <input name="name" class="grow" value="${esc(r.name === 'Nytt rom' ? '' : r.name)}" placeholder="F.eks. Stue, Bod, Vaskerom" maxlength="40">
      </div>
      <label class="field"><span>Etasje</span><select name="floor">${floors().map((f) => `<option value="${esc(f.id)}" ${(r.floorId || 'f1') === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>
      <div class="field"><span>Farge</span><div class="color-row">${COLORS.map((c) => `<button type="button" class="swatch ${c === color ? 'on' : ''}" data-color="${c}" style="background:${c}"></button>`).join('')}</div></div>
      <div class="modal-actions">
        <button type="button" class="btn danger ghost" data-delete>Slett rom</button><span class="spacer"></span>
        <button type="button" class="btn ghost" data-close>Avbryt</button><button type="submit" class="btn primary">Lagre</button>
      </div>
    </form>`,
    (root, close) => {
      const form = root.querySelector('form');
      const eb = root.querySelector('[data-emoji]');
      eb.onclick = () => pickEmoji(ROOM_EMOJIS, emoji, (e) => ((emoji = e), (eb.textContent = e)));
      root.querySelectorAll('[data-color]').forEach((b) => {
        b.onclick = () => {
          color = b.dataset.color;
          root.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('on', x === b));
        };
      });
      form.elements.name.addEventListener('input', () => {
        const v = form.elements.name.value.toLowerCase();
        if (emoji !== '🚪') return;
        const g = /stue/.test(v) ? '🛋️' : /kjøkken/.test(v) ? '🍳' : /soverom|sove/.test(v) ? '🛏️' : /bad/.test(v) ? '🛁' : /bod|lager/.test(v) ? '📦' : /garasje/.test(v) ? '🚗' : /vask/.test(v) ? '🧺' : /kontor/.test(v) ? '💻' : /barne/.test(v) ? '🧸' : /vin/.test(v) ? '🍷' : null;
        if (g) eb.textContent = g;
      });
      form.onsubmit = (e) => {
        e.preventDefault();
        const name = form.elements.name.value.trim() || 'Rom';
        upsert('rooms', { ...r, name, emoji: eb.textContent.trim() || emoji, color, floorId: form.elements.floor.value });
        close();
      };
      root.querySelector('[data-delete]').onclick = async () => {
        if (!(await confirmDialog(`Slette «${r.name}»${n ? ` og ${n} ting i rommet` : ''}?`))) return;
        thingsIn(r.id).forEach((t) => remove('things', t.id));
        remove('rooms', r.id);
        close();
      };
    },
  );
}

function floorModal(f, rerender) {
  const editing = !!f.id;
  openModal(
    `<form class="form">
      <h2 class="modal-title">${editing ? 'Etasje' : 'Ny etasje'}</h2>
      <label class="field"><span>Navn</span><input name="name" value="${esc(f.name || '')}" placeholder="F.eks. Kjeller, 2. etasje, Loft, Uthus" maxlength="30"></label>
      <label class="field"><span>Andre ord for den (hjelper AI og søk)</span><input name="aliases" value="${esc(f.aliases || '')}" placeholder="F.eks. oppe, nede, underetasjen" maxlength="80"></label>
      <div class="modal-actions">
        ${editing && floors().length > 1 ? '<button type="button" class="btn danger ghost" data-delete>Slett etasjen</button>' : ''}<span class="spacer"></span>
        <button type="button" class="btn ghost" data-close>Avbryt</button><button type="submit" class="btn primary">Lagre</button>
      </div>
    </form>`,
    (root, close) => {
      const form = root.querySelector('form');
      form.onsubmit = async (e) => {
        e.preventDefault();
        const name = form.elements.name.value.trim();
        if (!name) return toast('Gi etasjen et navn.', 'error');
        const list = floors().map((x) => ({ ...x }));
        const emoji = /kjeller|under/i.test(name) ? '⬇️' : /loft|2\.|oppe/i.test(name) ? '⬆️' : /uthus|garasje|bod/i.test(name) ? '🏚️' : '🏠';
        if (editing) Object.assign(list.find((x) => x.id === f.id), { name, emoji, aliases: form.elements.aliases.value.trim() });
        else list.push({ id: uid(), name, emoji, aliases: form.elements.aliases.value.trim() });
        await saveHousehold({ ...state.household, floors: list });
        if (!editing) floorId = list[list.length - 1].id;
        close();
        rerender();
      };
      root.querySelector('[data-delete]')?.addEventListener('click', async () => {
        const rooms = roomsOn(f.id);
        if (!(await confirmDialog(`Slette «${f.name}»${rooms.length ? ` og ${rooms.length} rom med innhold` : ''}?`))) return;
        rooms.forEach((r) => {
          thingsIn(r.id).forEach((t) => remove('things', t.id));
          remove('rooms', r.id);
        });
        await saveHousehold({ ...state.household, floors: floors().filter((x) => x.id !== f.id) });
        floorId = null;
        close();
        rerender();
      });
    },
  );
}

// ───────────── Rom-siden ─────────────

function roomIdFromParam(param) {
  if (param.startsWith('rom:')) return param.slice(4);
  return state.things.find((x) => x.id === param.slice(5))?.roomId;
}

function bindRoom(root, param) {
  const rid = roomIdFromParam(param);
  root.querySelectorAll('[data-add-thing]').forEach((b) => (b.onclick = () => thingModal({ roomId: rid, kind: b.dataset.addThing })));
  root.querySelectorAll('[data-edit-thing]').forEach((b) => (b.onclick = () => thingModal(state.things.find((t) => t.id === b.dataset.editThing))));
  root.querySelectorAll('[data-label]').forEach((b) => (b.onclick = () => labelModal(state.things.find((t) => t.id === b.dataset.label))));
  root.querySelectorAll('[data-photo]').forEach((img) => (img.onclick = () => showPhoto(state.things.find((t) => t.id === img.dataset.photo))));
  root.querySelector('[data-photo-add]')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    toast('✨ Ser på bildet …');
    try {
      const small = await compressImage(file, 1400);
      const [thumb, b64] = await Promise.all([thumbnail(small, 240), blobToBase64(small)]);
      const r = await photoContents(b64);
      const { id: photoFileId } = await backend.saveFile(small);
      thingModal({ roomId: rid, kind: 'boks', name: r.title || '', emoji: r.emoji || '📦', contents: r.items || [], thumb, photoFileId, fromAI: true });
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  if (param.startsWith('ting:')) setTimeout(() => document.getElementById('t-' + param.slice(5))?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
}

function thingModal(t) {
  const editing = !!t.id;
  let emoji = t.emoji || (t.kind === 'boks' ? '📦' : '🔹');
  let thumb = t.thumb || null;
  let photoFileId = t.photoFileId || null;
  openModal(
    `<form class="form" novalidate>
      <h2 class="modal-title">${t.fromAI ? '✨ Sjekk det AI fant' : editing ? 'Endre' : t.kind === 'boks' ? 'Ny boks' : 'Ny ting'}</h2>
      <div class="title-row">
        <button type="button" class="emoji-btn big" data-emoji>${esc(emoji)}</button>
        <input name="name" class="grow" value="${esc(t.name || '')}" placeholder="${t.kind === 'boks' ? 'F.eks. Boks med str. 86 klær' : 'F.eks. Skiutstyr'}" maxlength="80">
      </div>
      <div class="row2">
        <label class="field"><span>Rom</span><select name="room">${state.rooms.map((r) => `<option value="${esc(r.id)}" ${r.id === t.roomId ? 'selected' : ''}>${esc(roomLabel(r))}</option>`).join('')}</select></label>
        <label class="field"><span>Plass (valgfritt)</span><input name="place" value="${esc(t.place || '')}" placeholder="F.eks. Hylle 2, venstre" maxlength="60"></label>
      </div>
      <label class="field"><span>${t.kind === 'boks' ? 'Innhold' : 'Detaljer'} (én per linje)</span><textarea name="contents" rows="5" placeholder="Bodyer str. 86\nBukser str. 86\nLue">${esc((t.contents || []).join('\n'))}</textarea></label>
      <label class="field"><span>Stikkord (valgfritt, kommaseparert)</span><input name="tags" value="${esc((t.tags || []).join(', '))}" placeholder="F.eks. babyklær, vinter, Nils"></label>
      <div class="photo-row">${thumb ? `<img src="${thumb}" alt="" class="thing-thumb">` : ''}<label class="btn ghost small">📷 ${thumb ? 'Bytt bilde' : 'Legg til bilde'}<input type="file" accept="image/*" capture="environment" hidden data-pic></label></div>
      <div class="modal-actions">
        ${editing ? '<button type="button" class="btn danger ghost" data-delete>Slett</button>' : ''}<span class="spacer"></span>
        <button type="button" class="btn ghost" data-close>Avbryt</button><button type="submit" class="btn primary">Lagre</button>
      </div>
    </form>`,
    (root, close) => {
      const form = root.querySelector('form');
      const f = form.elements;
      const eb = root.querySelector('[data-emoji]');
      eb.onclick = () => pickEmoji(THING_EMOJIS, emoji, (e) => ((emoji = e), (eb.textContent = e)));
      root.querySelector('[data-pic]').onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const small = await compressImage(file, 1400);
          thumb = await thumbnail(small, 240);
          photoFileId = (await backend.saveFile(small)).id;
          root.querySelector('.photo-row').innerHTML = `<img src="${thumb}" alt="" class="thing-thumb"><span class="ok-text">✔ Bilde lagt til</span>`;
        } catch (err) {
          toast(err.message, 'error');
        }
      };
      form.onsubmit = (e) => {
        e.preventDefault();
        const name = f.name.value.trim();
        if (!name) return toast('Gi den et navn.', 'error');
        const clean = { ...t };
        delete clean.fromAI;
        upsert('things', {
          ...clean, name, emoji, roomId: f.room.value, place: f.place.value.trim(), kind: t.kind || 'ting',
          contents: f.contents.value.split('\n').map((x) => x.trim()).filter(Boolean),
          tags: f.tags.value.split(',').map((x) => x.trim()).filter(Boolean),
          thumb, photoFileId,
        });
        close();
      };
      root.querySelector('[data-delete]')?.addEventListener('click', async () => {
        if (!(await confirmDialog(`Slette «${t.name}»?`))) return;
        if (t.photoFileId) backend.deleteFile(t.photoFileId).catch(() => {});
        remove('things', t.id);
        close();
      });
    },
  );
}

async function showPhoto(t) {
  if (!t?.photoFileId) return;
  try {
    const { b64, type } = await backend.loadFileBase64(t.photoFileId);
    const url = URL.createObjectURL(base64ToBlob(b64, type));
    openModal(`<h2 class="modal-title">${esc(t.name)}</h2><img src="${url}" alt="" class="doc-img"><div class="modal-actions"><span class="spacer"></span><button class="btn ghost" data-close>Lukk</button></div>`);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function labelModal(t) {
  if (!t) return;
  const url = `${location.origin}${location.pathname}#/hus/ting:${t.id}`;
  const r = roomById(t.roomId);
  const svg = await qrSVG(url);
  openModal(
    `<div class="label-sheet" id="print-label">
      <div class="label">
        <div class="label-qr">${svg}</div>
        <div class="label-text"><b>${esc(t.emoji || '📦')} ${esc(t.name)}</b><small>${esc(r ? r.name : '')}${t.place ? ' · ' + esc(t.place) : ''}</small>
          <ul>${(t.contents || []).slice(0, 8).map((c) => `<li>${esc(c)}</li>`).join('')}${(t.contents || []).length > 8 ? '<li>…</li>' : ''}</ul></div>
      </div>
    </div>
    <p class="hint">Skriv ut og fest på boksen. Scann med kameraet (eller 📷 i appen) for å se innholdet – alltid oppdatert.</p>
    <div class="modal-actions"><span class="spacer"></span><button class="btn ghost" data-close>Lukk</button><button class="btn primary" data-print>🖨️ Skriv ut</button></div>`,
    (root) => {
      root.querySelector('[data-print]').onclick = () => {
        document.body.classList.add('printing-label');
        window.print();
        setTimeout(() => document.body.classList.remove('printing-label'), 500);
      };
    },
  );
}

async function scanLabel(file) {
  if (!file) return;
  try {
    const text = await readQR(file);
    if (!text) return toast('Fant ingen QR-kode i bildet. Prøv å gå nærmere.', 'error');
    const m = text.match(/#\/hus\/ting:([\w-]+)/);
    if (m) location.hash = `#/hus/ting:${m[1]}`;
    else toast(`QR-koden inneholder: ${text.slice(0, 80)}`);
  } catch (err) {
    toast(err.message, 'error');
  }
}
