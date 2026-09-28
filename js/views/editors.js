// Redigering av husstandsoppsettet (brukes både i onboarding og innstillinger).
// Alle editorene jobber på et "utkast" (draft) som lagres samlet.

import { esc, uid, DAY_NAMES, today, relDay, fmtShort } from '../util.js';
import { pickEmoji } from '../components.js';
import { MEMBER_EMOJIS, ACTIVITY_EMOJIS, GARBAGE_EMOJIS } from '../emoji.js';
import { nextGarbage } from '../logic.js';

export function emptyHousehold() {
  return { name: '', members: [], schedules: [], garbage: [], holidays: [], location: null, priceArea: '', onboarded: false };
}

// ---------- Familiemedlemmer ----------

export function membersEditor(d) {
  return `<div class="editor-list">
    ${d.members
      .map(
        (m) => `<div class="edit-row member-row">
        <button type="button" class="emoji-btn big" data-act="emoji-member" data-id="${m.id}" aria-label="Velg ikon">${esc(m.emoji)}</button>
        <input class="grow" placeholder="Navn" value="${esc(m.name)}" data-path="members:${m.id}:name" maxlength="40">
        <select data-path="members:${m.id}:role" aria-label="Rolle">
          <option value="voksen" ${m.role === 'voksen' ? 'selected' : ''}>Voksen</option>
          <option value="barn" ${m.role === 'barn' ? 'selected' : ''}>Barn</option>
        </select>
        <button type="button" class="icon-btn" data-act="del-member" data-id="${m.id}" aria-label="Fjern">✕</button>
      </div>`,
      )
      .join('')}
  </div>
  <button type="button" class="btn soft" data-act="add-member">＋ Legg til familiemedlem</button>`;
}

// ---------- Faste ukeplaner ----------

export function schedulesEditor(d) {
  if (!d.members.length) return '<p class="muted">Legg til familiemedlemmer først.</p>';
  return d.members
    .map((m) => {
      const rows = d.schedules.filter((s) => s.memberId === m.id);
      return `<section class="sched-member">
      <h3>${esc(m.emoji)} <span data-member-name="${m.id}">${esc(m.name || 'Uten navn')}</span></h3>
      ${rows
        .map(
          (s) => `<div class="edit-row sched-row">
          <div class="sched-top">
            <button type="button" class="emoji-btn" data-act="emoji-sched" data-id="${s.id}">${esc(s.emoji)}</button>
            <input class="grow" placeholder="F.eks. Jobb, Skole, Fotball" value="${esc(s.label)}" data-path="schedules:${s.id}:label" maxlength="60">
            <button type="button" class="icon-btn" data-act="del-sched" data-id="${s.id}" aria-label="Fjern">✕</button>
          </div>
          <div class="sched-bottom">
            <div class="day-toggles" role="group" aria-label="Dager">
              ${DAY_NAMES.map((n, i) => `<button type="button" class="day ${s.days.includes(i + 1) ? 'on' : ''}" data-act="toggle-day" data-id="${s.id}" data-day="${i + 1}">${n.slice(0, 1)}</button>`).join('')}
            </div>
            <div class="time-range">
              <input type="time" value="${esc(s.start || '')}" data-path="schedules:${s.id}:start" aria-label="Fra">
              <span>–</span>
              <input type="time" value="${esc(s.end || '')}" data-path="schedules:${s.id}:end" aria-label="Til">
            </div>
          </div>
        </div>`,
        )
        .join('')}
      <button type="button" class="btn soft small" data-act="add-sched" data-member="${m.id}" data-role="${m.role}">＋ Fast aktivitet for ${esc(m.name || 'denne')}</button>
    </section>`;
    })
    .join('');
}

// ---------- Søppel ----------

export function garbageEditor(d) {
  return `<div class="editor-list">
    ${d.garbage
      .map((g) => {
        const nxt = g.refDate ? nextGarbage(g) : null;
        return `<div class="edit-row garbage-row">
        <div class="sched-top">
          <button type="button" class="emoji-btn" data-act="emoji-garbage" data-id="${g.id}">${esc(g.emoji)}</button>
          <input class="grow" placeholder="F.eks. Restavfall, Papir, Plast" value="${esc(g.name)}" data-path="garbage:${g.id}:name" maxlength="40">
          <button type="button" class="icon-btn" data-act="del-garbage" data-id="${g.id}" aria-label="Fjern">✕</button>
        </div>
        <div class="garbage-fields">
          <label class="field inline"><span>Tømmes hver</span>
            <select data-path="garbage:${g.id}:intervalWeeks" data-num="1">
              ${[1, 2, 3, 4, 6, 8].map((n) => `<option value="${n}" ${g.intervalWeeks === n ? 'selected' : ''}>${n === 1 ? 'uke' : n + '. uke'}</option>`).join('')}
            </select></label>
          <label class="field inline"><span>En dato den tømmes/ble tømt</span>
            <input type="date" value="${esc(g.refDate || '')}" data-path="garbage:${g.id}:refDate"></label>
        </div>
        ${nxt ? `<p class="hint ok">Neste tømming: ${relDay(nxt)} (${fmtShort(nxt)})</p>` : '<p class="hint">Velg en dato så regner appen ut resten.</p>'}
      </div>`;
      })
      .join('')}
  </div>
  <button type="button" class="btn soft" data-act="add-garbage">＋ Legg til avfallstype</button>`;
}

// ---------- Ferie ----------

export function holidaysEditor(d) {
  const list = [...d.holidays].sort((a, b) => (a.from || '').localeCompare(b.from || ''));
  return `<div class="editor-list">
    ${list
      .map(
        (h) => `<div class="edit-row holiday-row">
        <div class="sched-top">
          <span class="emoji-btn static">🏖️</span>
          <input class="grow" placeholder="F.eks. Høstferie" value="${esc(h.label)}" data-path="holidays:${h.id}:label" maxlength="60">
          <button type="button" class="icon-btn" data-act="del-holiday" data-id="${h.id}" aria-label="Fjern">✕</button>
        </div>
        <div class="time-range">
          <input type="date" value="${esc(h.from || '')}" data-path="holidays:${h.id}:from" aria-label="Fra">
          <span>–</span>
          <input type="date" value="${esc(h.to || '')}" data-path="holidays:${h.id}:to" aria-label="Til">
        </div>
      </div>`,
      )
      .join('')}
  </div>
  <button type="button" class="btn soft" data-act="add-holiday">＋ Legg til ferie</button>
  <p class="hint">I ferier viser dashbordet «alle har fri» i stedet for de faste ukeplanene. Norske helligdager legges inn automatisk.</p>`;
}

// ---------- Sted og strømområde ----------

const AREAS = [
  ['NO1', 'Øst-Norge (Oslo)'],
  ['NO2', 'Sør-Norge (Kristiansand)'],
  ['NO3', 'Midt-Norge (Trondheim)'],
  ['NO4', 'Nord-Norge (Tromsø)'],
  ['NO5', 'Vest-Norge (Bergen)'],
];

export function placeEditor(d) {
  const loc = d.location || {};
  const has = loc.lat != null && loc.lon != null;
  return `<div class="place">
    <label class="field"><span>Stedsnavn (vises på værkortet)</span>
      <input placeholder="F.eks. Hjemme, Lillestrøm" value="${esc(loc.name || '')}" data-path="location.name" maxlength="60"></label>
    <div class="coords">
      <label class="field"><span>Breddegrad</span><input inputmode="decimal" placeholder="59.9139" value="${has ? loc.lat : ''}" data-path="location.lat" data-num="1"></label>
      <label class="field"><span>Lengdegrad</span><input inputmode="decimal" placeholder="10.7522" value="${has ? loc.lon : ''}" data-path="location.lon" data-num="1"></label>
    </div>
    <button type="button" class="btn soft" data-act="geolocate">📍 Bruk posisjonen min nå</button>
    <p class="hint">Tips: Står du ikke hjemme nå, kan du høyreklikke på huset ditt i Google Maps og kopiere tallene.</p>
    <label class="field"><span>Strømprisområde</span>
      <select data-path="priceArea">
        <option value="">Ikke vis strømpris</option>
        ${AREAS.map(([v, n]) => `<option value="${v}" ${d.priceArea === v ? 'selected' : ''}>${v} – ${n}</option>`).join('')}
      </select></label>
  </div>`;
}

// ---------- Felles hendelseshåndtering for editorene ----------

function setPath(d, path, value) {
  if (path.includes(':')) {
    const [arr, id, field] = path.split(':');
    const item = d[arr].find((x) => x.id === id);
    if (item) item[field] = value;
  } else if (path.includes('.')) {
    const [obj, field] = path.split('.');
    d[obj] ||= {};
    d[obj][field] = value;
  } else {
    d[path] = value;
  }
}

const SCHED_DEFAULTS = {
  voksen: { label: 'Jobb', emoji: '💼', days: [1, 2, 3, 4, 5], start: '08:00', end: '16:00' },
  barn: { label: 'Skole', emoji: '🏫', days: [1, 2, 3, 4, 5], start: '08:15', end: '14:00' },
};

/** Kobler input/klikk i root til utkastet d. rerender() tegner editoren på nytt. */
export function bindEditors(root, d, rerender, onDirty = () => {}) {
  const onInput = (e) => {
    const el = e.target.closest('[data-path]');
    if (!el) return;
    let v = el.value;
    if (el.dataset.num) {
      v = v.replace(',', '.').trim();
      v = v === '' ? null : Number(v);
      if (v !== null && !Number.isFinite(v)) return;
    }
    setPath(d, el.dataset.path, v === '' ? null : v);
    if (el.dataset.path.endsWith(':name') && el.dataset.path.startsWith('members:')) {
      // Oppdater overskrifter i ukeplan-editoren uten å miste fokus
      root.querySelectorAll(`[data-member-name="${el.dataset.path.split(':')[1]}"]`).forEach((n) => (n.textContent = v));
    }
    onDirty();
    if (e.type === 'change' && (el.type === 'date' || el.tagName === 'SELECT') && el.dataset.path.startsWith('garbage:')) rerender();
  };
  root.addEventListener('input', onInput);
  root.addEventListener('change', onInput);

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = b.dataset.id;
    const find = (arr) => d[arr].find((x) => x.id === id);
    switch (b.dataset.act) {
      case 'add-member': {
        const emoji = MEMBER_EMOJIS[d.members.length % 6];
        d.members.push({ id: uid(), name: '', emoji, role: d.members.length < 2 ? 'voksen' : 'barn' });
        break;
      }
      case 'del-member':
        d.members = d.members.filter((m) => m.id !== id);
        d.schedules = d.schedules.filter((s) => s.memberId !== id);
        break;
      case 'emoji-member':
        return pickEmoji(MEMBER_EMOJIS, find('members')?.emoji, (em) => ((find('members').emoji = em), onDirty(), rerender()));
      case 'add-sched':
        d.schedules.push({ id: uid(), memberId: b.dataset.member, ...structuredClone(SCHED_DEFAULTS[b.dataset.role] || SCHED_DEFAULTS.voksen) });
        break;
      case 'del-sched':
        d.schedules = d.schedules.filter((s) => s.id !== id);
        break;
      case 'emoji-sched':
        return pickEmoji(ACTIVITY_EMOJIS, find('schedules')?.emoji, (em) => ((find('schedules').emoji = em), onDirty(), rerender()));
      case 'toggle-day': {
        const s = find('schedules');
        const day = Number(b.dataset.day);
        s.days = s.days.includes(day) ? s.days.filter((x) => x !== day) : [...s.days, day].sort();
        break;
      }
      case 'add-garbage':
        d.garbage.push({ id: uid(), name: '', emoji: GARBAGE_EMOJIS[d.garbage.length % GARBAGE_EMOJIS.length], intervalWeeks: 2, refDate: null });
        break;
      case 'del-garbage':
        d.garbage = d.garbage.filter((g) => g.id !== id);
        break;
      case 'emoji-garbage':
        return pickEmoji(GARBAGE_EMOJIS, find('garbage')?.emoji, (em) => ((find('garbage').emoji = em), onDirty(), rerender()));
      case 'add-holiday':
        d.holidays.push({ id: uid(), label: '', from: today(), to: today() });
        break;
      case 'del-holiday':
        d.holidays = d.holidays.filter((h) => h.id !== id);
        break;
      case 'geolocate':
        if (!navigator.geolocation) return alert('Nettleseren støtter ikke posisjon.');
        b.disabled = true;
        b.textContent = '📍 Finner posisjon …';
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            d.location ||= {};
            d.location.lat = Math.round(pos.coords.latitude * 10000) / 10000;
            d.location.lon = Math.round(pos.coords.longitude * 10000) / 10000;
            d.location.name ||= 'Hjemme';
            onDirty();
            rerender();
          },
          () => {
            b.disabled = false;
            b.textContent = '📍 Bruk posisjonen min nå';
            alert('Fikk ikke tilgang til posisjonen. Du kan skrive inn tallene selv.');
          },
          { timeout: 15000 },
        );
        return;
      default:
        return;
    }
    onDirty();
    rerender();
  });
}

/** Sjekker utkastet før lagring. Returnerer feilmelding eller null. */
export function validateDraft(d, step = 'all') {
  if (step === 'all' || step === 'members') {
    if (!d.members.length) return 'Legg til minst ett familiemedlem.';
    if (d.members.some((m) => !m.name?.trim())) return 'Alle familiemedlemmer må ha et navn.';
  }
  if (step === 'all' || step === 'schedules') {
    const bad = d.schedules.find((s) => !s.days.length);
    if (bad) return `«${bad.label || 'Aktivitet'}» mangler dager.`;
  }
  if (step === 'all' || step === 'garbage') {
    if (d.garbage.some((g) => !g.name?.trim())) return 'Alle avfallstyper må ha et navn.';
    if (d.garbage.some((g) => !g.refDate)) return 'Velg en tømmedato for hver avfallstype.';
  }
  if (step === 'all' || step === 'holidays') {
    if (d.holidays.some((h) => !h.from || !h.to || h.to < h.from)) return 'Sjekk datoene på feriene (til-dato kan ikke være før fra-dato).';
  }
  return null;
}
