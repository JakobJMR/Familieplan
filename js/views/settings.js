// Innstillinger: husstandsoppsett, AI (Gemini), familiekode, sikkerhetskopi, konto.

import { esc, toast, DAY_NAMES } from '../util.js';
import { state, saveHousehold, saveSecrets, COLLECTIONS } from '../store.js';
import { backend, isDemo } from '../backend.js';
import { setPin, hasPin } from '../pin.js';
import { DEFAULT_MODEL, testKey } from '../ai.js';
import {
  emptyHousehold, membersEditor, schedulesEditor, garbageEditor, holidaysEditor, placeEditor, bindEditors, validateDraft,
} from './editors.js';

let draft = null;
let dirty = false;
let open = 'members';

const SECTIONS = [
  ['members', '👪', 'Familien', membersEditor],
  ['schedules', '🗓️', 'Faste ukeplaner', schedulesEditor],
  ['garbage', '🗑️', 'Søppeltømming', garbageEditor],
  ['holidays', '🏖️', 'Ferier', holidaysEditor],
  ['place', '🌤️', 'Vær og strøm', placeEditor],
  ['meals', '🍽️', 'Faste middager', fixedMealsEditor],
];

function fixedMealsEditor(d) {
  d.fixedMeals ||= {};
  return `<p class="hint" style="margin-top:0">Faste retter vises i ukemenyen når ingenting annet er planlagt, f.eks. «Taco» på fredag.</p>
  <div class="editor-list">${DAY_NAMES.map(
    (n, i) => `<label class="edit-row member-row"><b style="width:44px">${n}</b>
      <input class="grow" placeholder="—" value="${esc(d.fixedMeals[i + 1] || '')}" data-path="fixedMeals.${i + 1}" maxlength="60"></label>`,
  ).join('')}</div>`;
}

export function resetSettingsDraft() {
  draft = null;
  dirty = false;
}
export const settingsDirty = () => dirty;

export function renderSettings() {
  if (!draft) draft = Object.assign(emptyHousehold(), structuredClone(state.household || {}));
  const s = state.secrets || {};
  return `
  <header class="view-head"><div><a href="#/mer" class="back-link">‹ Mer</a><h1>⚙️ Innstillinger</h1></div></header>
  ${isDemo ? '<div class="banner demo">🧪 <b>Demo-modus</b> – data lagres bare på denne enheten. Se README for å koble til Firebase.</div>' : ''}
  <label class="field card pad"><span>Husstandens navn</span>
    <input value="${esc(draft.name || '')}" data-hname maxlength="80" placeholder="F.eks. Familien Hansen"></label>
  ${SECTIONS.map(
    ([key, emoji, title, render]) => `<details class="card settings-section" data-sec="${key}" ${open === key ? 'open' : ''}>
      <summary><span>${emoji} ${title}</span><span class="chev">›</span></summary>
      <div class="sec-body" data-body="${key}">${render(draft)}</div>
    </details>`,
  ).join('')}

  <details class="card settings-section" ${open === 'ai' ? 'open' : ''} data-static="ai">
    <summary><span>✨ AI-assistent (Gemini)</span><span class="chev">›</span></summary>
    <div class="sec-body">
      <p class="muted">Gemini tolker forsikringsdokumenter, foreslår middag og gjør om «legg inn bursdag til Nils 12. oktober» til hendelser. Gratis med en nøkkel fra Google AI Studio (uten betalingskort).</p>
      <label class="field"><span>Gemini API-nøkkel ${s.geminiKey ? '✅' : ''}</span>
        <input type="password" id="ai-key" placeholder="${s.geminiKey ? '•••••• (lagret – lim inn ny for å bytte)' : 'Lim inn nøkkelen her'}" autocomplete="off"></label>
      <label class="field"><span>Modell</span>
        <input id="ai-model" value="${esc(s.geminiModel || '')}" placeholder="${DEFAULT_MODEL}"></label>
      <div class="row-btns">
        <button class="btn primary" id="ai-save">Lagre og test</button>
        ${s.geminiKey ? '<button class="btn danger ghost" id="ai-del">Fjern nøkkel</button>' : ''}
      </div>
      <p class="hint">Nøkkelen lagres i familiens database og kan bare leses av innloggede familiemedlemmer. Lag den på <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>.</p>
    </div>
  </details>

  <details class="card settings-section" data-static="pin">
    <summary><span>🔒 Familiekode</span><span class="chev">›</span></summary>
    <div class="sec-body">
      <p class="muted">${hasPin() ? 'Appen er låst med kode. Koden spørres når appen åpnes, og etter 5 minutter i bakgrunnen.' : 'Ingen kode er satt. Med kode låses appen hver gang den åpnes – lurt på et delt nettbrett.'}</p>
      <label class="field"><span>${hasPin() ? 'Ny kode' : 'Velg kode'} (4–8 siffer)</span>
        <input id="pin-new" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="off"></label>
      <div class="row-btns">
        <button class="btn primary" id="pin-save">${hasPin() ? 'Bytt kode' : 'Sett kode'}</button>
        ${hasPin() ? '<button class="btn danger ghost" id="pin-del">Fjern kode</button>' : ''}
      </div>
    </div>
  </details>

  <section class="card pad account">
    <h2 class="card-title">👤 Konto og data</h2>
    <p>Logget inn som <b>${esc(state.user?.email || '')}</b></p>
    <div class="row-btns">
      <button class="btn ghost" data-backup>💾 Last ned sikkerhetskopi</button>
      <button class="btn ghost" data-reload>🔄 Last inn på nytt</button>
      <button class="btn danger ghost" data-logout>Logg ut</button>
    </div>
    <p class="hint">Hvem som slipper inn styres av e-postlista i sikkerhetsreglene i Firebase (se README).</p>
  </section>
  <div class="save-bar ${dirty ? 'show' : ''}">
    <span>Du har endringer som ikke er lagret</span>
    <button class="btn ghost small" data-discard>Angre</button>
    <button class="btn primary" data-save>Lagre</button>
  </div>`;
}

export function bindSettings(root, rerender, onSignOut) {
  const markDirty = () => {
    if (!dirty) {
      dirty = true;
      root.querySelector('.save-bar')?.classList.add('show');
    }
  };
  root.querySelectorAll('[data-body]').forEach((body) => {
    const sec = SECTIONS.find((s) => s[0] === body.dataset.body);
    bindEditors(body, draft, () => (body.innerHTML = sec[3](draft)), markDirty);
  });
  root.querySelector('[data-hname]').addEventListener('input', (e) => {
    draft.name = e.target.value;
    markDirty();
  });
  root.querySelectorAll('details[data-sec]').forEach((d) => {
    d.addEventListener('toggle', () => {
      if (!d.open) return;
      open = d.dataset.sec;
      const sec = SECTIONS.find((s) => s[0] === d.dataset.sec);
      d.querySelector('[data-body]').innerHTML = sec[3](draft);
    });
  });
  root.querySelector('[data-save]').onclick = async (e) => {
    const err = validateDraft(draft);
    if (err) return toast(err, 'error');
    e.target.disabled = true;
    try {
      await saveHousehold({ ...draft, onboarded: true });
      draft = null;
      dirty = false;
      toast('Lagret ✔', 'ok');
      rerender();
    } catch {
      e.target.disabled = false;
    }
  };
  root.querySelector('[data-discard]').onclick = () => {
    draft = null;
    dirty = false;
    rerender();
  };

  // AI
  root.querySelector('#ai-save').onclick = async (e) => {
    const key = root.querySelector('#ai-key').value.trim() || state.secrets?.geminiKey;
    const model = root.querySelector('#ai-model').value.trim();
    if (!key) return toast('Lim inn en nøkkel først.', 'error');
    e.target.disabled = true;
    e.target.textContent = 'Tester …';
    const r = await testKey(key, model || DEFAULT_MODEL);
    e.target.disabled = false;
    e.target.textContent = 'Lagre og test';
    if (!r.ok && !confirm(`Testen feilet (${r.status}: ${r.message}).\nLagre likevel?`)) return;
    await saveSecrets({ geminiKey: key, geminiModel: model || null });
    open = 'ai';
    toast(r.ok ? 'Gemini virker ✨' : 'Lagret', 'ok');
    rerender();
  };
  root.querySelector('#ai-del')?.addEventListener('click', async () => {
    if (!confirm('Fjerne Gemini-nøkkelen? AI-funksjonene slutter å virke.')) return;
    await saveSecrets({ geminiKey: null });
    rerender();
  });

  // PIN
  root.querySelector('#pin-save').onclick = async () => {
    const p = root.querySelector('#pin-new').value.trim();
    if (!/^\d{4,8}$/.test(p)) return toast('Koden må være 4–8 siffer.', 'error');
    await setPin(p);
    toast('Familiekoden er lagret 🔒', 'ok');
    rerender();
  };
  root.querySelector('#pin-del')?.addEventListener('click', async () => {
    if (!confirm('Fjerne familiekoden?')) return;
    await setPin(null);
    rerender();
  });

  root.querySelector('[data-backup]').onclick = () => {
    const data = { exportedAt: new Date().toISOString(), household: state.household, ...Object.fromEntries(COLLECTIONS.map((c) => [c, state[c]])) };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = `familie-sikkerhetskopi-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    toast('Sikkerhetskopi lastet ned (uten forsikringsdokumentene og nøkler).');
  };
  root.querySelector('[data-reload]').onclick = () => location.reload();
  root.querySelector('[data-logout]').onclick = async () => {
    await backend.signOut();
    onSignOut?.();
  };
}
