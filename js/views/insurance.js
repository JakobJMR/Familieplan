// Forsikring: last opp dokument → Gemini tolker → oversikt, detaljer, chat og kjørelengde.

import { esc, today, fmtShort, relDay, diffDays, openModal, confirmDialog, toast } from '../util.js';
import { state, upsert, remove } from '../store.js';
import { backend, assertFileSize, base64ToBlob, MAX_FILE_MB } from '../backend.js';
import { emptyState } from '../components.js';
import { hasAI } from '../ai.js';
import { readOnce, SCHEMAS, loadText, askFromTexts } from '../docs.js';
import { kr, insEmoji, INS_TYPES, nextRenewal, insuranceMonthly, mileageStatus } from '../finance.js';

const chat = []; // {q, a} – bare i minnet på denne enheten

const policies = () => [...state.insurance].sort((a, b) => (nextRenewal(a) || '9').localeCompare(nextRenewal(b) || '9'));
const logsFor = (id) => state.mileage.filter((l) => l.policyId === id);

// ───────────── Oversikt ─────────────

export function renderInsurance(param) {
  if (param) {
    const p = state.insurance.find((x) => x.id === param);
    if (p) return renderDetail(p);
  }
  const list = policies();
  const perYear = list.reduce((s, p) => s + insuranceMonthly(p) * 12, 0);
  return `
  <header class="view-head"><div><a href="#/mer" class="back-link">‹ Mer</a><h1>🛡️ Forsikring</h1></div>
    <button class="btn primary" data-add-ins>＋ Legg til</button></header>
  ${list.length ? `<div class="stat-row">
    <div class="card stat"><span class="stat-label">Totalt per år</span><span class="stat-num">${kr(perYear)}</span><span class="stat-sub">${kr(perYear / 12)} per måned</span></div>
    <div class="card stat"><span class="stat-label">Antall forsikringer</span><span class="stat-num">${list.length}</span><span class="stat-sub">${list.filter((p) => p.fileId).length} med dokument</span></div>
  </div>` : ''}
  ${list.length
    ? `<ul class="ins-list">${list.map(card).join('')}</ul>`
    : emptyState('🛡️', 'Ingen forsikringer ennå', hasAI() ? 'Last opp forsikringsbeviset (PDF eller bilde), så leser Gemini det for deg.' : 'Legg inn forsikringene dine. Med en Gemini-nøkkel kan appen lese dokumentene for deg.')}
  ${list.length ? chatBox() : ''}`;
}

function card(p) {
  const r = nextRenewal(p);
  const d = r ? diffDays(today(), r) : null;
  const ms = p.type === 'bil' ? mileageStatus(p, logsFor(p.id)) : null;
  return `<li><a class="ins-card" href="#/forsikring/${esc(p.id)}">
    <span class="ins-emoji">${insEmoji(p.type)}</span>
    <span class="pt">${esc(p.name)}<small>${esc(p.company || '')}${p.pricePerYear ? ' · ' + kr(p.pricePerYear) + '/år' : ''}</small>
      ${r ? `<small class="${d <= 30 ? 'warn-text' : ''}">🔄 Fornyes ${d <= 60 ? esc(relDay(r)) : fmtShort(r)}</small>` : ''}
      ${ms && !ms.needsNewStart ? `<small class="${ms.overPace || ms.remaining < 0 ? 'warn-text' : ''}">🚗 ${ms.remaining.toLocaleString('nb-NO')} km igjen</small>` : ''}
    </span><span class="n-arrow">›</span></a></li>`;
}

function chatBox() {
  return `<section class="card chat" style="margin-top:16px">
    <h2 class="card-title">💬 Spør om forsikringene</h2>
    ${chat.map((c) => `<div class="chat-q">${esc(c.q)}</div><div class="chat-a">${esc(c.a)}</div>`).join('')}
    ${hasAI() ? `<form class="chat-form">
      <textarea name="q" rows="2" placeholder="F.eks. «Dekker gruppelivet hvis jeg blir ufør?»" maxlength="400"></textarea>
      <div class="modal-actions"><span class="spacer"></span><button class="btn primary" type="submit">Spør ✨</button></div>
      <p class="chat-status muted"></p>
    </form>` : '<p class="muted">Legg inn Gemini-nøkkelen under Innstillinger for å stille spørsmål.</p>'}
    <p class="hint">Svarene er et hjelpemiddel, ikke juridisk rådgivning. Sjekk vilkårene eller spør selskapet ved viktige saker.</p>
  </section>`;
}

export function bindInsurance(root, rerender, param) {
  root.querySelector('[data-add-ins]')?.addEventListener('click', addFlow);
  const form = root.querySelector('.chat-form');
  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const q = form.elements.q.value.trim();
      if (!q) return;
      const st = form.querySelector('.chat-status');
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        st.textContent = '✨ Tenker …';
        // Bruker det AI allerede har lest og lagret – originaldokumentene leses ikke på nytt
        const sources = await Promise.all(state.insurance.map(async (p) => ({
          title: `${p.name} (${p.company || 'ukjent selskap'})`,
          facts: `Type: ${p.type}. Forsikret: ${p.insured || '-'}. Pris: ${p.pricePerYear ? p.pricePerYear + ' kr/år' : '-'}. Fornyes: ${p.renewalDate || '-'}. Egenandel: ${p.deductible || '-'}\nSammendrag: ${p.summary || '-'}\nDekker: ${(p.covers || []).join('; ') || '-'}\nDekker ikke: ${(p.notCovered || []).join('; ') || '-'}\nDetaljer: ${(p.keyTerms || []).join('; ') || '-'}`,
          text: p.textFileId ? await loadText(p.textFileId).catch(() => '') : '',
        })));
        const a = await askFromTexts(q, sources, 'familiens forsikringer');
        chat.push({ q, a });
        rerender();
      } catch (err) {
        st.textContent = err.message;
        btn.disabled = false;
      }
    };
  }
  if (param) bindDetail(root, state.insurance.find((x) => x.id === param));
}

// ───────────── Legg til (med AI-tolkning) ─────────────

function addFlow() {
  openModal(
    `<h2 class="modal-title">＋ Ny forsikring</h2>
     <label class="upload">
       <input type="file" accept="application/pdf,image/*" hidden>
       <span class="upload-emoji">📄</span>
       <b>Last opp forsikringsbevis</b>
       <span class="muted">PDF eller bilde, maks ${MAX_FILE_MB} MB${hasAI() ? ' – Gemini leser det og fyller ut for deg' : ''}</span>
     </label>
     <p class="upload-status" aria-live="polite"></p>
     <div class="modal-actions"><button class="btn ghost" data-manual>Fyll ut selv uten dokument</button><span class="spacer"></span><button class="btn ghost" data-close>Avbryt</button></div>`,
    (root, close) => {
      const st = root.querySelector('.upload-status');
      root.querySelector('[data-manual]').onclick = () => (close(), editPolicy({}));
      root.querySelector('input[type=file]').onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          assertFileSize(file);
          st.textContent = '💾 Lagrer dokumentet trygt …';
          const { id: fileId, b64 } = await backend.saveFile(file);
          let data = {};
          let textFileId = null;
          if (hasAI()) {
            st.textContent = '✨ Gemini leser dokumentet én gang … (tar gjerne 10–40 sekunder)';
            try {
              ({ data, textFileId } = await readOnce({ source: { b64, mime: file.type || 'application/pdf', file }, ...SCHEMAS.insurance }));
            } catch (err) {
              toast(`AI-tolkningen feilet: ${err.message} Du kan fylle ut selv.`, 'error');
            }
          }
          close();
          editPolicy({ ...cleanAI(data), fileId, fileName: file.name, textFileId, aiRead: !!data.name });
        } catch (err) {
          st.textContent = err.message || 'Noe gikk galt.';
        }
      };
    },
  );
}

function cleanAI(d = {}) {
  const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));
  const date = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const arr = (v) => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, 20) : []);
  const out = {
    type: INS_TYPES[d.type] ? d.type : 'annet',
    name: d.name || '', company: d.company || '', policyNumber: d.policyNumber || '', insured: d.insured || '',
    pricePerYear: num(d.pricePerYear), pricePerMonth: num(d.pricePerMonth), renewalDate: date(d.renewalDate),
    deductible: d.deductible || '', summary: d.summary || '',
    covers: arr(d.covers), notCovered: arr(d.notCovered), keyTerms: arr(d.keyTerms),
  };
  if (out.type === 'bil' && num(d.annualKm)) out.mileage = { annualKm: num(d.annualKm), periodStart: out.renewalDate, startOdometer: null };
  return out;
}

function editPolicy(p) {
  const lines = (a) => (a || []).join('\n');
  const m = p.mileage || {};
  openModal(
    `<form class="form" novalidate>
      <h2 class="modal-title">${p.id ? 'Endre forsikring' : p.aiRead ? '✨ Sjekk det Gemini fant' : 'Ny forsikring'}</h2>
      ${p.aiRead ? '<p class="hint ok" style="margin-top:-6px">Se over og rett opp før du lagrer – AI kan ta feil.</p>' : ''}
      <div class="row2">
        <label class="field"><span>Type</span><select name="type">${Object.entries(INS_TYPES).map(([k, e]) => `<option value="${k}" ${(p.type || 'annet') === k ? 'selected' : ''}>${e} ${k[0].toUpperCase() + k.slice(1)}</option>`).join('')}</select></label>
        <label class="field"><span>Selskap</span><input name="company" value="${esc(p.company || '')}" maxlength="60"></label>
      </div>
      <label class="field"><span>Navn</span><input name="name" value="${esc(p.name || '')}" placeholder="F.eks. Bilforsikring Golf" maxlength="80"></label>
      <div class="row2">
        <label class="field"><span>Pris per år (kr)</span><input name="pricePerYear" inputmode="numeric" value="${esc(p.pricePerYear ?? '')}"></label>
        <label class="field"><span>Pris per måned (kr)</span><input name="pricePerMonth" inputmode="numeric" value="${esc(p.pricePerMonth ?? '')}"></label>
      </div>
      <div class="row2">
        <label class="field"><span>Fornyes / hovedforfall</span><input type="date" name="renewalDate" value="${esc(p.renewalDate || '')}"></label>
        <label class="field"><span>Egenandel</span><input name="deductible" value="${esc(p.deductible || '')}" maxlength="120"></label>
      </div>
      <div class="row2">
        <label class="field"><span>Polisenummer</span><input name="policyNumber" value="${esc(p.policyNumber || '')}" maxlength="40"></label>
        <label class="field"><span>Hvem/hva er forsikret</span><input name="insured" value="${esc(p.insured || '')}" maxlength="120"></label>
      </div>
      <fieldset class="field car-fields" ${p.type === 'bil' ? '' : 'hidden'}><legend>🚗 Kjørelengde</legend>
        <div class="row2">
          <label class="field"><span>Km per år</span><input name="annualKm" inputmode="numeric" value="${esc(m.annualKm ?? '')}" placeholder="F.eks. 16000"></label>
          <label class="field"><span>Kilometerstand nå</span><input name="startOdometer" inputmode="numeric" value="${esc(m.startOdometer ?? '')}"></label>
        </div>
        <label class="field"><span>Forsikringsåret startet (siste hovedforfall)</span><input type="date" name="periodStart" value="${esc(m.periodStart || p.renewalDate || '')}"></label>
        <label class="field"><span>Kjørt hittil i forsikringsåret (km, cirka – valgfritt)</span><input name="drivenSoFar" inputmode="numeric" value=""></label>
      </fieldset>
      <label class="field"><span>Kort oppsummering</span><textarea name="summary" rows="3">${esc(p.summary || '')}</textarea></label>
      <label class="field"><span>✅ Dekker (én per linje)</span><textarea name="covers" rows="4">${esc(lines(p.covers))}</textarea></label>
      <label class="field"><span>❌ Dekker ikke (én per linje)</span><textarea name="notCovered" rows="3">${esc(lines(p.notCovered))}</textarea></label>
      <label class="field"><span>📋 Andre detaljer (én per linje)</span><textarea name="keyTerms" rows="3">${esc(lines(p.keyTerms))}</textarea></label>
      <div class="modal-actions"><span class="spacer"></span>
        <button type="button" class="btn ghost" data-close>Avbryt</button><button type="submit" class="btn primary">Lagre</button></div>
    </form>`,
    (root, close) => {
      const form = root.querySelector('form');
      const f = form.elements;
      f.type.onchange = () => (root.querySelector('.car-fields').hidden = f.type.value !== 'bil');
      const num = (v) => {
        const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
        return v === '' || !Number.isFinite(n) ? null : Math.round(n);
      };
      const ls = (v) => v.split('\n').map((x) => x.replace(/^[-•*]\s*/, '').trim()).filter(Boolean);
      form.onsubmit = (e) => {
        e.preventDefault();
        const name = f.name.value.trim() || `${f.type.value[0].toUpperCase() + f.type.value.slice(1)}forsikring`;
        const item = {
          ...p, name, type: f.type.value, company: f.company.value.trim(),
          pricePerYear: num(f.pricePerYear.value), pricePerMonth: num(f.pricePerMonth.value),
          renewalDate: f.renewalDate.value || null, deductible: f.deductible.value.trim(),
          policyNumber: f.policyNumber.value.trim(), insured: f.insured.value.trim(),
          summary: f.summary.value.trim(), covers: ls(f.covers.value), notCovered: ls(f.notCovered.value), keyTerms: ls(f.keyTerms.value),
          mileage: f.type.value === 'bil' && num(f.annualKm.value)
            ? (() => {
                const odoNow = num(f.startOdometer.value);
                const sofar = num(f.drivenSoFar.value);
                const periodStart = f.periodStart.value || f.renewalDate.value || today();
                // Har man oppgitt hvor mye som er kjørt hittil, regnes startstanden ut; ellers gjelder stand nå fra i dag.
                if (odoNow != null && sofar != null) return { annualKm: num(f.annualKm.value), startOdometer: odoNow - sofar, periodStart, startDate: null };
                const keep = p.mileage && p.mileage.startOdometer === odoNow;
                return { annualKm: num(f.annualKm.value), startOdometer: odoNow, periodStart, startDate: keep ? p.mileage.startDate || null : odoNow != null ? today() : null };
              })()
            : null,
        };
        delete item.aiRead;
        const saved = upsert('insurance', item);
        close();
        location.hash = `#/forsikring/${saved.id}`;
      };
    },
  );
}

// ───────────── Detaljer ─────────────

function renderDetail(p) {
  const r = nextRenewal(p);
  const ms = p.type === 'bil' ? mileageStatus(p, logsFor(p.id)) : null;
  const list = (title, arr, cls) => (arr?.length ? `<section class="card ins-sec"><h2 class="card-title">${title}</h2><ul class="bullets ${cls}">${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>` : '');
  return `
  <header class="view-head"><div><a href="#/forsikring" class="back-link">‹ Forsikring</a>
    <h1>${insEmoji(p.type)} ${esc(p.name)}</h1><p class="muted">${esc(p.company || '')}${p.policyNumber ? ' · nr. ' + esc(p.policyNumber) : ''}</p></div></header>
  <div class="fact-grid">
    <div class="card fact"><span>Pris</span><b>${p.pricePerYear ? kr(p.pricePerYear) + '/år' : p.pricePerMonth ? kr(p.pricePerMonth) + '/mnd' : '–'}</b>${p.pricePerYear && p.pricePerMonth ? `<small>${kr(p.pricePerMonth)}/mnd</small>` : ''}</div>
    <div class="card fact"><span>Fornyes</span><b>${r ? fmtShort(r) : '–'}</b>${r ? `<small>${diffDays(today(), r) <= 1 ? esc(relDay(r)) : 'om ' + diffDays(today(), r) + ' dager'}</small>` : ''}</div>
    <div class="card fact"><span>Egenandel</span><b class="small">${esc(p.deductible || '–')}</b></div>
    <div class="card fact"><span>Forsikret</span><b class="small">${esc(p.insured || '–')}</b></div>
  </div>
  ${p.summary ? `<section class="card ins-sec"><p class="ins-summary">${esc(p.summary)}</p></section>` : ''}
  ${ms ? mileageCard(ms) : ''}
  ${list('✅ Dette dekkes', p.covers, 'yes')}
  ${list('❌ Dette dekkes ikke', p.notCovered, 'no')}
  ${list('📋 Detaljer', p.keyTerms, '')}
  <div class="row-btns" style="margin-top:16px">
    ${p.fileId ? '<button class="btn primary" data-open-doc>📄 Åpne originaldokumentet</button>' : ''}
    ${p.fileId && !p.textFileId && hasAI() ? '<button class="btn soft" data-read-once>✨ La AI lese dokumentet (én gang)</button>' : ''}
    <button class="btn ghost" data-edit-ins>✎ Endre</button>
    ${!p.fileId ? '<label class="btn ghost">📎 Legg ved dokument<input type="file" accept="application/pdf,image/*" hidden data-attach></label>' : ''}
    <button class="btn danger ghost" data-del-ins>Slett</button>
  </div>`;
}

function mileageCard(ms) {
  if (ms.needsNewStart) {
    return `<section class="card ins-sec mileage"><h2 class="card-title">🚗 Kjørelengde</h2>
      <p>Et nytt forsikringsår startet ${fmtShort(ms.periodStart)}. Logg kilometerstanden for å starte nedtellingen på nytt.</p>
      ${logForm()}</section>`;
  }
  return `<section class="card ins-sec mileage">
    <h2 class="card-title">🚗 Kjørelengde</h2>
    <div class="km-big"><b class="${ms.remaining < 0 ? 'alert-text' : ''}">${ms.remaining.toLocaleString('nb-NO')} km</b> igjen av ${ms.annualKm.toLocaleString('nb-NO')}</div>
    <div class="progress ${ms.overPace ? 'warn' : ''}"><span style="width:${ms.pct}%"></span></div>
    <p class="muted">${ms.driven.toLocaleString('nb-NO')} km kjørt siden ${fmtShort(ms.periodStart)} · ${ms.daysLeft} dager igjen av forsikringsåret</p>
    ${ms.projected != null ? `<p class="${ms.overPace ? 'warn-text' : 'ok-text'}">${ms.overPace ? '⚠️' : '👍'} Med dette tempoet ender dere på ca. ${ms.projected.toLocaleString('nb-NO')} km${ms.overPace ? ` – ${(ms.projected - ms.annualKm).toLocaleString('nb-NO')} km over` : ''}.</p>` : ''}
    ${ms.stale ? '<p class="hint">Tips: Logg kilometerstanden ca. én gang i måneden.</p>' : ''}
    ${logForm()}
  </section>`;
}

function logForm() {
  return `<form class="km-form"><input type="date" name="date" value="${today()}"><input name="odo" inputmode="numeric" placeholder="Kilometerstand"><button class="btn primary" type="submit">Logg</button></form>
    <button class="btn ghost small" data-km-history>Vis logg</button>`;
}

function bindDetail(root, p) {
  if (!p) return;
  root.querySelector('[data-edit-ins]').onclick = () => editPolicy(p);
  root.querySelector('[data-del-ins]').onclick = async () => {
    if (!(await confirmDialog(`Slette «${p.name}»${p.fileId ? ' og dokumentet' : ''}?`))) return;
    if (p.fileId) backend.deleteFile(p.fileId).catch(() => {});
    if (p.textFileId) backend.deleteFile(p.textFileId).catch(() => {});
    logsFor(p.id).forEach((l) => remove('mileage', l.id));
    remove('insurance', p.id);
    location.hash = '#/forsikring';
  };
  root.querySelector('[data-open-doc]')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    e.target.textContent = '📄 Henter …';
    try {
      const { b64, type, name } = await backend.loadFileBase64(p.fileId);
      const url = URL.createObjectURL(base64ToBlob(b64, type));
      const fname = name || 'forsikring.pdf';
      openModal(
        `<h2 class="modal-title">📄 ${esc(fname)}</h2>
         ${type.startsWith('image/') ? `<img src="${url}" alt="" class="doc-img">` : ''}
         <div class="row-btns" style="margin-top:12px">
           <a class="btn primary" href="${url}" target="_blank" rel="noopener">Åpne</a>
           <a class="btn ghost" href="${url}" download="${esc(fname)}">Last ned</a>
         </div>
         <div class="modal-actions"><span class="spacer"></span><button class="btn ghost" data-close>Lukk</button></div>`,
      );
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      e.target.disabled = false;
      e.target.textContent = '📄 Åpne originaldokumentet';
    }
  });
  root.querySelector('[data-read-once]')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    e.target.textContent = '✨ Leser …';
    try {
      const { b64, type } = await backend.loadFileBase64(p.fileId);
      const { data, textFileId } = await readOnce({ source: { b64, mime: type }, ...SCHEMAS.insurance });
      const c = cleanAI(data);
      upsert('insurance', { ...p, textFileId, summary: p.summary || c.summary, covers: p.covers?.length ? p.covers : c.covers, notCovered: p.notCovered?.length ? p.notCovered : c.notCovered, keyTerms: p.keyTerms?.length ? p.keyTerms : c.keyTerms });
      toast('✨ Dokumentet er lest og lagret', 'ok');
    } catch (err) {
      toast(err.message, 'error');
      e.target.disabled = false;
    }
  });
  root.querySelector('[data-attach]')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      assertFileSize(file);
      toast('💾 Lagrer dokumentet …');
      const { id } = await backend.saveFile(file);
      upsert('insurance', { ...p, fileId: id, fileName: file.name });
      toast('📎 Dokumentet er lagt ved', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  const km = root.querySelector('.km-form');
  if (km) {
    km.onsubmit = (e) => {
      e.preventDefault();
      const odo = Number(km.elements.odo.value.replace(/\s/g, ''));
      if (!Number.isFinite(odo) || odo <= 0) return toast('Skriv inn kilometerstanden.', 'error');
      const date = km.elements.date.value || today();
      upsert('mileage', { policyId: p.id, date, odometer: Math.round(odo) });
      // Første logging i en ny periode blir ny startstand
      const ms = mileageStatus(p, logsFor(p.id));
      if (ms?.needsNewStart || p.mileage?.startOdometer == null) {
        upsert('insurance', { ...p, mileage: { ...p.mileage, startOdometer: Math.round(odo), startDate: date, periodStart: ms?.periodStart || p.mileage?.periodStart || date } });
      }
      toast('🚗 Kilometerstand logget', 'ok');
    };
    root.querySelector('[data-km-history]').onclick = () => {
      const logs = logsFor(p.id).sort((a, b) => b.date.localeCompare(a.date));
      openModal(
        `<h2 class="modal-title">🚗 Kilometerlogg</h2>
         ${logs.length ? `<ul class="pay-list">${logs.map((l) => `<li><span class="pt">${fmtShort(l.date)} ${l.date.slice(0, 4)}</span><b>${l.odometer.toLocaleString('nb-NO')} km</b>
           <button class="icon-btn subtle" data-del-log="${esc(l.id)}" aria-label="Slett">✕</button></li>`).join('')}</ul>` : '<p class="muted">Ingen logginger ennå.</p>'}
         <div class="modal-actions"><span class="spacer"></span><button class="btn ghost" data-close>Lukk</button></div>`,
        (r, close) => r.querySelectorAll('[data-del-log]').forEach((b) => (b.onclick = () => (remove('mileage', b.dataset.delLog), close()))),
      );
    };
  }
}

// Til dashbordet
export function insuranceNotices() {
  const out = [];
  for (const p of state.insurance) {
    const r = nextRenewal(p);
    if (r) {
      const d = diffDays(today(), r);
      if (d >= 0 && d <= 30) out.push({ icon: '🔄', kind: 'warn', text: `${p.name} fornyes ${relDay(r)}`, detail: p.pricePerYear ? `Nå: ${kr(p.pricePerYear)}/år – sjekk om prisen er god` : '', go: `forsikring/${p.id}` });
    }
    if (p.type === 'bil') {
      const ms = mileageStatus(p, logsFor(p.id));
      if (ms && !ms.needsNewStart) {
        out.push({
          icon: '🚗',
          kind: ms.remaining < 0 || ms.overPace ? 'alert' : 'info',
          text: `${ms.remaining.toLocaleString('nb-NO')} km igjen av kjørelengden`,
          detail: ms.overPace ? `Prognose: ${ms.projected.toLocaleString('nb-NO')} km – over grensen` : ms.stale ? 'Logg kilometerstanden' : `${ms.daysLeft} dager igjen av forsikringsåret`,
          go: `forsikring/${p.id}`,
        });
      } else if (ms?.needsNewStart) {
        out.push({ icon: '🚗', kind: 'warn', text: 'Nytt forsikringsår – logg kilometerstanden', go: `forsikring/${p.id}` });
      }
    }
  }
  return out;
}
