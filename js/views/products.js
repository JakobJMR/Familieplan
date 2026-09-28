// 🧾 Produkter: kvittering, garanti/reklamasjon, bruksanvisning (PDF, lenke eller QR),
// vedlikehold og «spør om produktet». AI leser hvert dokument ÉN gang.

import { esc, today, fmtShort, relDay, diffDays, addDays, openModal, confirmDialog, toast } from '../util.js';
import { state, upsert, remove } from '../store.js';
import { emptyState, pickEmoji } from '../components.js';
import { hasAI } from '../ai.js';
import { backend, base64ToBlob, MAX_FILE_MB } from '../backend.js';
import { readOnce, SCHEMAS, loadText, askFromTexts, AI_MAX_MB } from '../docs.js';
import { compressImage, readQR } from '../media.js';
import { kr } from '../finance.js';

const CATS = {
  kjøkken: '🍳', hvitevarer: '🧺', elektronikk: '📺', verktøy: '🛠️', møbler: '🛋️', klær: '👕', sport: '⚽', barn: '🧸', bil: '🚗', hage: '🌱', annet: '📦',
};
let q = '';
const chats = new Map(); // produkt-id (eller 'alle') → [{q,a}]

const addYears = (d, y) => (d && y ? `${Number(d.slice(0, 4)) + Math.floor(y)}${d.slice(4)}` : null);
export const warrantyUntil = (p) => p.warrantyUntil || addYears(p.purchaseDate, p.warrantyYears);
export const reklamasjonUntil = (p) => addYears(p.purchaseDate, p.reklamasjonYears || (p.purchaseDate ? 2 : null));

function nextDue(m) {
  if (!m.everyMonths) return null;
  const base = m.lastDone || today();
  const days = Math.max(1, Math.round(m.everyMonths * 30.4));
  return m.lastDone ? addDays(base, days) : today();
}

// ───────────── Oversikt ─────────────

export function renderProducts(param) {
  if (param) {
    const p = state.products.find((x) => x.id === param);
    if (p) return renderDetail(p);
  }
  const n = q.toLowerCase().trim();
  const list = state.products
    .filter((p) => !n || [p.name, p.brand, p.model, p.category, p.store].join(' ').toLowerCase().includes(n))
    .sort((a, b) => a.name.localeCompare(b.name, 'nb'));
  const withWarranty = state.products.filter((p) => warrantyUntil(p) >= today() || reklamasjonUntil(p) >= today()).length;
  return `
  <header class="view-head"><div><a href="#/mer" class="back-link">‹ Mer</a><h1>🧾 Produkter</h1></div>
    <button class="btn primary" data-new-prod>＋ Legg til</button></header>
  ${state.products.length ? `<div class="stat-row">
    <div class="card stat"><span class="stat-label">Produkter</span><span class="stat-num">${state.products.length}</span><span class="stat-sub">${state.products.filter((p) => p.manual?.textFileId || p.manual?.summary).length} med bruksanvisning</span></div>
    <div class="card stat"><span class="stat-label">Med garanti/reklamasjon</span><span class="stat-num">${withWarranty}</span><span class="stat-sub">fortsatt gyldig</span></div>
  </div>
  <input class="search-input" id="prod-q" value="${esc(q)}" placeholder="🔎 Søk etter produkt, merke, butikk …">` : ''}
  ${list.length ? `<ul class="cost-list" style="margin-top:12px">${list.map(row).join('')}</ul>`
    : emptyState('🧾', state.products.length ? 'Ingen treff' : 'Ingen produkter ennå', 'Legg inn kvitteringer, garantier og bruksanvisninger – f.eks. for vaskemaskin, TV, barnevogn og verktøy.')}
  ${state.products.length && hasAI() ? chatBox('alle', 'Spør om alle produktene', 'F.eks. «Når går garantien ut på TV-en?»') : ''}`;
}

function row(p) {
  const w = warrantyUntil(p);
  const r = reklamasjonUntil(p);
  const active = [w, r].filter((d) => d && d >= today()).sort().pop();
  const due = (p.maintenance || []).some((m) => nextDue(m) && nextDue(m) <= addDays(today(), 7));
  return `<li><a class="cost-row" href="#/produkter/${esc(p.id)}"><span class="pe">${esc(p.emoji || CATS[p.category] || '📦')}</span>
    <span class="pt">${esc(p.name)}<small>${esc([p.brand, p.model].filter(Boolean).join(' '))}${p.manual?.summary ? ' · 📘' : ''}${p.receiptFileId ? ' · 🧾' : ''}${due ? ' · 🔧 vedlikehold' : ''}</small>
      ${active ? `<small class="${diffDays(today(), active) < 60 ? 'warn-text' : 'ok-text'}">🛡️ ${w && w >= today() ? 'Garanti' : 'Reklamasjon'} til ${fmtShort(active)} ${active.slice(0, 4)}</small>` : ''}</span>
    <span class="n-arrow">›</span></a></li>`;
}

function chatBox(key, title, ph) {
  const log = chats.get(key) || [];
  return `<section class="card chat" style="margin-top:16px">
    <h2 class="card-title">💬 ${esc(title)}</h2>
    ${log.map((c) => `<div class="chat-q">${esc(c.q)}</div><div class="chat-a">${esc(c.a)}</div>`).join('')}
    <form class="chat-form" data-chat="${esc(key)}">
      <textarea name="q" rows="2" placeholder="${esc(ph)}" maxlength="400"></textarea>
      <div class="modal-actions"><span class="spacer"></span><button class="btn primary" type="submit">Spør ✨</button></div>
      <p class="chat-status muted"></p>
    </form>
    <p class="hint">Svarene bygger på det AI har lest fra dokumentene tidligere – originalene leses ikke på nytt.</p>
  </section>`;
}

// ───────────── Detaljer ─────────────

function renderDetail(p) {
  const w = warrantyUntil(p);
  const r = reklamasjonUntil(p);
  const room = state.rooms.find((x) => x.id === p.roomId);
  const m = p.manual || {};
  const dateCell = (d) => (d ? `<b>${fmtShort(d)} ${d.slice(0, 4)}</b><small class="${d < today() ? 'alert-text' : diffDays(today(), d) < 60 ? 'warn-text' : ''}">${d < today() ? 'utløpt' : 'om ' + diffDays(today(), d) + ' dager'}</small>` : '<b>–</b>');
  return `
  <header class="view-head"><div><a href="#/produkter" class="back-link">‹ Produkter</a>
    <h1>${esc(p.emoji || CATS[p.category] || '📦')} ${esc(p.name)}</h1><p class="muted">${esc([p.brand, p.model].filter(Boolean).join(' · '))}</p></div>
    <button class="btn ghost small" data-edit-prod>✎ Endre</button></header>
  <div class="fact-grid">
    <div class="card fact"><span>Kjøpt</span><b>${p.purchaseDate ? fmtShort(p.purchaseDate) + ' ' + p.purchaseDate.slice(0, 4) : '–'}</b><small>${esc(p.store || '')}${p.price ? ' · ' + kr(p.price) : ''}</small></div>
    <div class="card fact"><span>Garanti til</span>${dateCell(w)}</div>
    <div class="card fact"><span>Reklamasjon til</span>${dateCell(r)}${p.reklamasjonYears ? `<small>${p.reklamasjonYears} år</small>` : ''}</div>
    <div class="card fact"><span>Står i</span><b class="small">${room ? esc(room.emoji + ' ' + room.name) : '–'}</b></div>
  </div>

  <section class="card ins-sec">
    <h2 class="card-title">📘 Bruksanvisning</h2>
    ${m.summary ? `<p>${esc(m.summary)}</p>
      ${m.keyFacts?.length ? `<h3 class="sub-h">Nyttig å vite</h3><ul class="bullets">${m.keyFacts.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${m.troubleshooting?.length ? `<h3 class="sub-h">🩺 Feilsøking</h3><ul class="trouble">${m.troubleshooting.map((t) => `<li><b>${esc(t.problem)}</b><span>${esc(t.solution)}</span></li>`).join('')}</ul>` : ''}
      <p class="hint">Lest ${m.readAt ? fmtShort(m.readAt.slice(0, 10)) + ' ' + m.readAt.slice(0, 4) : ''} fra ${m.source === 'link' || m.source === 'qr' ? 'lenke' : 'PDF'} – svarene under bygger på denne lesingen.</p>`
      : '<p class="muted">Ingen bruksanvisning lagt inn.</p>'}
    <div class="row-btns" style="margin-top:10px">
      ${m.fileId ? '<button class="btn soft small" data-open-file="manual">📄 Åpne PDF</button>' : ''}
      ${m.url ? `<a class="btn soft small" href="${esc(m.url)}" target="_blank" rel="noopener">🔗 Åpne lenke</a>` : ''}
      ${hasAI() ? `<button class="btn ${m.summary ? 'ghost' : 'primary'} small" data-add-manual>${m.summary ? '🔄 Bytt / les på nytt' : '＋ Legg til bruksanvisning'}</button>` : ''}
    </div>
  </section>

  <section class="card ins-sec">
    <h2 class="card-title">🔧 Vedlikehold</h2>
    ${(p.maintenance || []).length ? `<ul class="maint-list">${p.maintenance.map((x) => {
      const d = nextDue(x);
      return `<li><span class="pt">${esc(x.task)}<small>${x.everyMonths ? 'hver ' + (x.everyMonths < 1 ? Math.round(x.everyMonths * 4) + '. uke' : x.everyMonths === 1 ? 'måned' : x.everyMonths + '. måned') : ''}${x.lastDone ? ' · sist ' + fmtShort(x.lastDone) : ' · aldri registrert'}</small>
        ${d ? `<small class="${d <= today() ? 'warn-text' : ''}">Neste: ${d <= today() ? 'nå' : esc(relDay(d))}</small>` : ''}</span>
        <button class="btn soft small" data-maint-done="${esc(x.id)}">✔ Gjort</button>
        <button class="icon-btn subtle" data-maint-del="${esc(x.id)}" aria-label="Fjern">✕</button></li>`;
    }).join('')}</ul>` : '<p class="muted">Ingen vedlikeholdsoppgaver. AI foreslår dem når den leser bruksanvisningen.</p>'}
    <form class="km-form" data-maint-add><input name="task" placeholder="F.eks. Rens filter"><select name="every"><option value="0.25">ukentlig</option><option value="1">hver mnd</option><option value="3" selected>hver 3. mnd</option><option value="6">hvert halvår</option><option value="12">hvert år</option></select><button class="btn ghost" type="submit">＋</button></form>
  </section>

  <section class="card ins-sec">
    <h2 class="card-title">🗂️ Dokumenter</h2>
    <ul class="doc-list">
      ${p.receiptFileId ? '<li><button class="btn ghost small" data-open-file="receipt">🧾 Kvittering</button></li>' : ''}
      ${(p.documents || []).map((d) => `<li><button class="btn ghost small" data-open-doc="${esc(d.id)}">📄 ${esc(d.name)}</button><button class="icon-btn subtle" data-del-doc="${esc(d.id)}" aria-label="Fjern">✕</button></li>`).join('')}
    </ul>
    <div class="row-btns">
      ${!p.receiptFileId ? `<label class="btn soft small">🧾 Legg ved kvittering${hasAI() ? ' ✨' : ''}<input type="file" accept="image/*,application/pdf" hidden data-receipt></label>` : ''}
      <label class="btn ghost small">📎 Annet dokument (garantibevis o.l.)<input type="file" accept="image/*,application/pdf" hidden data-other-doc></label>
    </div>
  </section>

  ${hasAI() && (m.textFileId || m.summary || p.receiptTextFileId) ? chatBox(p.id, `Spør om ${p.name}`, 'F.eks. «Hva betyr feilkode E21?» eller «Hvordan avkalker jeg den?»') : ''}
  <button class="btn danger ghost" data-del-prod style="margin-top:16px">Slett produktet</button>`;
}

// ───────────── Hendelser ─────────────

export function bindProducts(root, rerender, param) {
  root.querySelector('[data-new-prod]')?.addEventListener('click', addFlow);
  const qi = root.querySelector('#prod-q');
  if (qi) {
    let t;
    qi.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => ((q = qi.value), rerender()), 200);
    });
  }
  root.querySelectorAll('[data-chat]').forEach((form) => {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const question = form.elements.q.value.trim();
      if (!question) return;
      const key = form.dataset.chat;
      const st = form.querySelector('.chat-status');
      form.querySelector('[type=submit]').disabled = true;
      st.textContent = '✨ Tenker …';
      try {
        const a = await askProducts(question, key === 'alle' ? null : state.products.find((x) => x.id === key));
        chats.set(key, [...(chats.get(key) || []), { q: question, a }]);
        rerender();
      } catch (err) {
        st.textContent = err.message;
        form.querySelector('[type=submit]').disabled = false;
      }
    };
  });
  if (!param) return;
  const p = state.products.find((x) => x.id === param);
  if (!p) return;
  const save = (patch) => upsert('products', { ...p, ...patch });

  root.querySelector('[data-edit-prod]').onclick = () => productModal(p);
  root.querySelector('[data-del-prod]').onclick = async () => {
    if (!(await confirmDialog(`Slette «${p.name}» og dokumentene?`))) return;
    [p.receiptFileId, p.receiptTextFileId, p.manual?.fileId, p.manual?.textFileId, ...(p.documents || []).map((d) => d.fileId)].filter(Boolean).forEach((id) => backend.deleteFile(id).catch(() => {}));
    remove('products', p.id);
    location.hash = '#/produkter';
  };
  root.querySelector('[data-add-manual]')?.addEventListener('click', () => manualFlow(p));
  root.querySelectorAll('[data-open-file]').forEach((b) => (b.onclick = () => openFile(b.dataset.openFile === 'manual' ? p.manual.fileId : p.receiptFileId)));
  root.querySelectorAll('[data-open-doc]').forEach((b) => (b.onclick = () => openFile(p.documents.find((d) => d.id === b.dataset.openDoc)?.fileId)));
  root.querySelectorAll('[data-del-doc]').forEach((b) => {
    b.onclick = async () => {
      const d = p.documents.find((x) => x.id === b.dataset.delDoc);
      if (!(await confirmDialog(`Fjerne «${d.name}»?`))) return;
      backend.deleteFile(d.fileId).catch(() => {});
      save({ documents: p.documents.filter((x) => x.id !== d.id) });
    };
  });
  root.querySelectorAll('[data-maint-done]').forEach((b) => {
    b.onclick = () => {
      save({ maintenance: p.maintenance.map((x) => (x.id === b.dataset.maintDone ? { ...x, lastDone: today() } : x)) });
      toast('🔧 Registrert som gjort', 'ok');
    };
  });
  root.querySelectorAll('[data-maint-del]').forEach((b) => (b.onclick = () => save({ maintenance: p.maintenance.filter((x) => x.id !== b.dataset.maintDel) })));
  const mf = root.querySelector('[data-maint-add]');
  mf.onsubmit = (e) => {
    e.preventDefault();
    const task = mf.elements.task.value.trim();
    if (!task) return;
    save({ maintenance: [...(p.maintenance || []), { id: crypto.randomUUID?.() || String(Date.now()), task, everyMonths: Number(mf.elements.every.value), lastDone: null }] });
  };
  root.querySelector('[data-receipt]')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const close = busy('🧾 Leser kvitteringen …');
    try {
      const r = await readReceipt(file);
      close();
      save({
        receiptFileId: r.fileId, receiptTextFileId: r.textFileId,
        store: p.store || r.data.store || '', purchaseDate: p.purchaseDate || r.data.purchaseDate || null, price: p.price ?? r.data.price ?? null,
        warrantyYears: p.warrantyYears ?? r.data.warrantyYears ?? null, reklamasjonYears: p.reklamasjonYears ?? r.data.reklamasjonYears ?? null,
      });
      toast('🧾 Kvitteringen er lagt ved', 'ok');
    } catch (err) {
      close();
      toast(err.message, 'error');
    }
  });
  root.querySelector('[data-other-doc]')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const small = file.type.startsWith('image/') ? await compressImage(file, 1800) : file;
      if (small.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`Fila er for stor (maks ${MAX_FILE_MB} MB).`);
      const name = prompt('Hva slags dokument er dette?', /garanti/i.test(file.name) ? 'Garantibevis' : 'Dokument') || file.name;
      const { id } = await backend.saveFile(small);
      save({ documents: [...(p.documents || []), { id: String(Date.now()), name, fileId: id }] });
      toast('📎 Lagt ved', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function busy(text) {
  return openModal(`<div class="center-pad"><div class="gate-emoji spin">✨</div><p class="muted">${esc(text)}</p><p class="hint">Dette gjøres bare én gang – resultatet lagres.</p></div>`);
}

async function openFile(fileId) {
  if (!fileId) return;
  try {
    const { b64, type, name } = await backend.loadFileBase64(fileId);
    const url = URL.createObjectURL(base64ToBlob(b64, type));
    openModal(
      `<h2 class="modal-title">📄 ${esc(name || 'Dokument')}</h2>
       ${type.startsWith('image/') ? `<img src="${url}" alt="" class="doc-img">` : ''}
       <div class="row-btns" style="margin-top:12px"><a class="btn primary" href="${url}" target="_blank" rel="noopener">Åpne</a><a class="btn ghost" href="${url}" download="${esc(name || 'dokument')}">Last ned</a></div>
       <div class="modal-actions"><span class="spacer"></span><button class="btn ghost" data-close>Lukk</button></div>`,
    );
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ───────────── Lesing (én gang) ─────────────

async function readReceipt(file) {
  const stored = file.type.startsWith('image/') ? await compressImage(file, 1800) : file;
  if (stored.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`Fila er for stor (maks ${MAX_FILE_MB} MB).`);
  const { id: fileId } = await backend.saveFile(stored);
  if (!hasAI()) return { fileId, textFileId: null, data: {} };
  const { data, textFileId } = await readOnce({ source: { file: stored }, ...SCHEMAS.receipt });
  return { fileId, textFileId, data };
}

/** Leser bruksanvisning fra fil eller lenke. Lagrer PDF-en bare hvis den er liten nok. */
async function readManual(source) {
  let fileId = null;
  if (source.file) {
    if (source.file.size > AI_MAX_MB * 1024 * 1024) throw new Error(`PDF-en er for stor (maks ${AI_MAX_MB} MB). Bruk heller en lenke til bruksanvisningen.`);
    if (source.file.size <= MAX_FILE_MB * 1024 * 1024) fileId = (await backend.saveFile(source.file)).id;
  }
  const { data, textFileId } = await readOnce({ source, ...SCHEMAS.manual });
  const maint = (Array.isArray(data.maintenance) ? data.maintenance : [])
    .filter((m) => m?.task)
    .slice(0, 8)
    .map((m, i) => ({ id: `ai${Date.now()}${i}`, task: String(m.task), everyMonths: Number(m.everyMonths) || null, lastDone: null }));
  return {
    data,
    manual: {
      source: source.url ? source.kind || 'link' : 'pdf', url: source.url || null, fileId, textFileId,
      summary: data.summary || '', keyFacts: Array.isArray(data.keyFacts) ? data.keyFacts.slice(0, 15) : [],
      troubleshooting: Array.isArray(data.troubleshooting) ? data.troubleshooting.slice(0, 20) : [],
      readAt: new Date().toISOString(),
    },
    maint,
  };
}

function manualSourcePicker(title, onSource) {
  openModal(
    `<h2 class="modal-title">${esc(title)}</h2>
     <div class="source-grid">
       <label class="upload small"><input type="file" accept="application/pdf" hidden data-src-pdf><span class="upload-emoji">📄</span><b>PDF</b><span class="muted">Lastet ned bruksanvisning</span></label>
       <label class="upload small"><input type="file" accept="image/*" capture="environment" hidden data-src-qr><span class="upload-emoji">🔳</span><b>QR-kode</b><span class="muted">Ta bilde av koden</span></label>
     </div>
     <form class="quick-add" data-src-link style="margin-top:12px"><input name="url" type="url" placeholder="…eller lim inn lenke (https://…)"><button class="btn primary" type="submit">Les</button></form>
     <p class="hint">AI leser bruksanvisningen én gang og lagrer en oppsummering med feilsøking og vedlikehold. Lenker må være offentlige (ikke bak innlogging).</p>
     <div class="modal-actions"><span class="spacer"></span><button class="btn ghost" data-close>Avbryt</button></div>`,
    (root, close) => {
      root.querySelector('[data-src-pdf]').onchange = (e) => e.target.files[0] && (close(), onSource({ file: e.target.files[0] }));
      root.querySelector('[data-src-qr]').onchange = async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        const text = await readQR(f).catch(() => null);
        if (!text) return toast('Fant ingen QR-kode. Prøv igjen litt nærmere.', 'error');
        if (!/^https?:\/\//i.test(text)) return toast(`QR-koden er ikke en lenke: ${text.slice(0, 60)}`, 'error');
        close();
        onSource({ url: text, kind: 'qr' });
      };
      root.querySelector('[data-src-link]').onsubmit = (e) => {
        e.preventDefault();
        const url = e.target.elements.url.value.trim();
        if (!/^https?:\/\//i.test(url)) return toast('Skriv inn en hel lenke som starter med https://', 'error');
        close();
        onSource({ url, kind: 'link' });
      };
    },
  );
}

function manualFlow(p) {
  manualSourcePicker(`📘 Bruksanvisning for ${p.name}`, async (source) => {
    const close = busy('📘 Leser bruksanvisningen …');
    try {
      const r = await readManual(source);
      close();
      [p.manual?.fileId, p.manual?.textFileId].filter(Boolean).forEach((id) => backend.deleteFile(id).catch(() => {}));
      const known = new Set((p.maintenance || []).map((m) => m.task.toLowerCase()));
      upsert('products', { ...p, manual: r.manual, maintenance: [...(p.maintenance || []), ...r.maint.filter((m) => !known.has(m.task.toLowerCase()))] });
      toast('📘 Bruksanvisningen er lest og lagret', 'ok');
    } catch (err) {
      close();
      toast(err.message, 'error');
    }
  });
}

function addFlow() {
  openModal(
    `<h2 class="modal-title">＋ Nytt produkt</h2>
     <div class="source-grid">
       <label class="upload small"><input type="file" accept="image/*,application/pdf" hidden data-start-receipt><span class="upload-emoji">🧾</span><b>Fra kvittering</b><span class="muted">${hasAI() ? 'AI fyller ut produkt, dato, pris og garanti' : 'Bilde eller PDF'}</span></label>
       ${hasAI() ? '<button class="upload small" data-start-manual><span class="upload-emoji">📘</span><b>Fra bruksanvisning</b><span class="muted">PDF, lenke eller QR-kode</span></button>' : ''}
     </div>
     <div class="modal-actions"><button class="btn ghost" data-start-blank>Fyll ut selv</button><span class="spacer"></span><button class="btn ghost" data-close>Avbryt</button></div>`,
    (root, close) => {
      root.querySelector('[data-start-blank]').onclick = () => (close(), productModal({}));
      root.querySelector('[data-start-receipt]').onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        close();
        const done = busy('🧾 Leser kvitteringen …');
        try {
          const r = await readReceipt(file);
          done();
          const d = r.data || {};
          productModal({
            name: d.productName || '', brand: d.brand || '', model: d.model || '', category: CATS[d.category] ? d.category : 'annet', emoji: d.emoji || null,
            store: d.store || '', purchaseDate: d.purchaseDate || null, price: Number(d.price) || null,
            warrantyYears: Number(d.warrantyYears) || null, reklamasjonYears: [2, 5].includes(Number(d.reklamasjonYears)) ? Number(d.reklamasjonYears) : 2,
            receiptFileId: r.fileId, receiptTextFileId: r.textFileId, fromAI: !!d.productName,
          });
        } catch (err) {
          done();
          toast(err.message, 'error');
        }
      };
      root.querySelector('[data-start-manual]')?.addEventListener('click', () => {
        close();
        manualSourcePicker('📘 Nytt produkt fra bruksanvisning', async (source) => {
          const done = busy('📘 Leser bruksanvisningen …');
          try {
            const r = await readManual(source);
            done();
            const d = r.data || {};
            productModal({ name: d.productName || '', brand: d.brand || '', model: d.model || '', category: CATS[d.category] ? d.category : 'annet', emoji: d.emoji || null, manual: r.manual, maintenance: r.maint, reklamasjonYears: 2, fromAI: true });
          } catch (err) {
            done();
            toast(err.message, 'error');
          }
        });
      });
    },
  );
}

function productModal(p) {
  const editing = !!p.id;
  let emoji = p.emoji || CATS[p.category] || '📦';
  openModal(
    `<form class="form" novalidate>
      <h2 class="modal-title">${p.fromAI ? '✨ Sjekk det AI fant' : editing ? 'Endre produkt' : 'Nytt produkt'}</h2>
      ${p.fromAI ? '<p class="hint ok" style="margin-top:-6px">Se over og rett opp før du lagrer – AI kan ta feil.</p>' : ''}
      <div class="title-row">
        <button type="button" class="emoji-btn big" data-emoji>${esc(emoji)}</button>
        <input name="name" class="grow" value="${esc(p.name || '')}" placeholder="F.eks. Vaskemaskin" maxlength="80">
      </div>
      <div class="row2">
        <label class="field"><span>Merke</span><input name="brand" value="${esc(p.brand || '')}" maxlength="40"></label>
        <label class="field"><span>Modell</span><input name="model" value="${esc(p.model || '')}" maxlength="60"></label>
      </div>
      <div class="row2">
        <label class="field"><span>Kategori</span><select name="category">${Object.entries(CATS).map(([k, e]) => `<option value="${k}" ${(p.category || 'annet') === k ? 'selected' : ''}>${e} ${k}</option>`).join('')}</select></label>
        <label class="field"><span>Står i rom</span><select name="room"><option value="">—</option>${state.rooms.map((r) => `<option value="${esc(r.id)}" ${p.roomId === r.id ? 'selected' : ''}>${esc(r.emoji || '')} ${esc(r.name)}</option>`).join('')}</select></label>
      </div>
      <div class="row2">
        <label class="field"><span>Kjøpsdato</span><input type="date" name="purchaseDate" value="${esc(p.purchaseDate || '')}"></label>
        <label class="field"><span>Butikk</span><input name="store" value="${esc(p.store || '')}" maxlength="40"></label>
      </div>
      <div class="row2">
        <label class="field"><span>Pris (kr)</span><input name="price" inputmode="numeric" value="${esc(p.price ?? '')}"></label>
        <label class="field"><span>Produsentgaranti (år)</span><input name="warrantyYears" inputmode="decimal" value="${esc(p.warrantyYears ?? '')}"></label>
      </div>
      <label class="field"><span>Reklamasjonsrett</span><select name="reklamasjonYears">
        <option value="2" ${(p.reklamasjonYears || 2) === 2 ? 'selected' : ''}>2 år (vanlig)</option>
        <option value="5" ${p.reklamasjonYears === 5 ? 'selected' : ''}>5 år (ting som skal vare lenge – hvitevarer, møbler o.l.)</option></select></label>
      <label class="field"><span>Notater</span><textarea name="notes" rows="2">${esc(p.notes || '')}</textarea></label>
      <div class="modal-actions"><span class="spacer"></span>
        <button type="button" class="btn ghost" data-close>Avbryt</button><button type="submit" class="btn primary">Lagre</button></div>
    </form>`,
    (root, close) => {
      const form = root.querySelector('form');
      const f = form.elements;
      const eb = root.querySelector('[data-emoji]');
      eb.onclick = () => pickEmoji(Object.values(CATS).concat(['🧊', '☕', '🔌', '💡', '🚲', '📱', '💻', '🎧']), emoji, (e) => ((emoji = e), (eb.textContent = e)));
      f.category.onchange = () => {
        if (Object.values(CATS).includes(emoji)) (emoji = CATS[f.category.value]), (eb.textContent = emoji);
      };
      const num = (v) => (v === '' || !Number.isFinite(Number(String(v).replace(',', '.'))) ? null : Number(String(v).replace(',', '.')));
      form.onsubmit = (e) => {
        e.preventDefault();
        const name = f.name.value.trim();
        if (!name) return toast('Gi produktet et navn.', 'error');
        const clean = { ...p };
        delete clean.fromAI;
        const saved = upsert('products', {
          ...clean, name, emoji, brand: f.brand.value.trim(), model: f.model.value.trim(), category: f.category.value,
          roomId: f.room.value || null, purchaseDate: f.purchaseDate.value || null, store: f.store.value.trim(),
          price: num(f.price.value), warrantyYears: num(f.warrantyYears.value), reklamasjonYears: Number(f.reklamasjonYears.value), notes: f.notes.value.trim(),
          maintenance: p.maintenance || [], documents: p.documents || [],
        });
        close();
        location.hash = `#/produkter/${saved.id}`;
      };
    },
  );
}

// ───────────── Spørsmål ─────────────

async function askProducts(question, only = null) {
  const ql = question.toLowerCase();
  const list = only ? [only] : state.products;
  // Hent fulltekst bare for produktene spørsmålet handler om (eller det ene produktet)
  const relevant = only ? [only] : list.filter((p) => [p.name, p.brand, p.model].filter(Boolean).some((w) => w.length > 2 && ql.includes(w.toLowerCase())));
  const sources = await Promise.all(
    list.map(async (p) => {
      const facts = `Kjøpt: ${p.purchaseDate || '?'} hos ${p.store || '?'} for ${p.price ? p.price + ' kr' : '?'}. Garanti til: ${warrantyUntil(p) || '?'}. Reklamasjon til: ${reklamasjonUntil(p) || '?'}. ${p.manual?.summary ? 'Bruksanvisning: ' + p.manual.summary : ''} ${(p.manual?.troubleshooting || []).map((t) => `${t.problem}: ${t.solution}`).join('; ')}`;
      const text = relevant.includes(p) && p.manual?.textFileId ? await loadText(p.manual.textFileId).catch(() => '') : '';
      return { title: `${p.name} ${[p.brand, p.model].filter(Boolean).join(' ')}`, facts, text };
    }),
  );
  return askFromTexts(question, sources, 'familiens produkter, garantier og bruksanvisninger');
}

// ───────────── Til dashbordet ─────────────

export function productNotices() {
  const t = today();
  const out = [];
  for (const p of state.products) {
    for (const [label, d] of [['Garantien', warrantyUntil(p)], ['Reklamasjonsretten', reklamasjonUntil(p)]]) {
      if (d && d >= t && diffDays(t, d) <= 45) out.push({ icon: '🛡️', kind: 'warn', text: `${label} på ${p.name} går ut ${relDay(d)}`, detail: 'Er det noe som bør meldes før den tid?', go: `produkter/${p.id}` });
    }
    for (const m of p.maintenance || []) {
      const d = nextDue(m);
      if (m.lastDone && d && d <= addDays(t, 3)) out.push({ icon: '🔧', kind: 'info', text: `${p.name}: ${m.task}`, detail: d <= t ? 'Tid for vedlikehold' : `Om ${diffDays(t, d)} dager`, go: `produkter/${p.id}` });
    }
  }
  return out;
}
