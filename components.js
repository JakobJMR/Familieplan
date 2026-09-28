// Gjenbrukbare UI-biter.

import { esc, openModal } from './util.js';
import { state, setFilter } from './store.js';

/** Profilvelger: trykk på et familiemedlem for å filtrere visningen. */
export function memberFilter() {
  const members = state.household?.members || [];
  if (members.length < 2) return '';
  return `<nav class="member-filter" aria-label="Vis for">
    <button class="chip ${!state.filter ? 'on' : ''}" data-filter="">👪 Alle</button>
    ${members
      .map(
        (m) => `<button class="chip ${state.filter === m.id ? 'on' : ''}" data-filter="${esc(m.id)}">
          <span class="chip-emoji">${esc(m.emoji)}</span>${esc(m.name)}</button>`,
      )
      .join('')}
  </nav>`;
}

export function bindMemberFilter(root) {
  root.querySelectorAll('[data-filter]').forEach((b) => {
    b.onclick = () => (b.dataset.filter ? setFilter(b.dataset.filter) : state.filter && setFilter(state.filter));
  });
}

/** Små emoji-merker for hvem noe gjelder */
export function whoBadges(ids) {
  const members = state.household?.members || [];
  if (!ids?.length) return '<span class="who all" title="Hele familien">👪</span>';
  return ids
    .map((id) => members.find((m) => m.id === id))
    .filter(Boolean)
    .map((m) => `<span class="who" title="${esc(m.name)}">${esc(m.emoji)}</span>`)
    .join('');
}

/** Flervalg av familiemedlemmer i skjema. Ingen valgt = hele familien. */
export function memberPicker(selected = [], name = 'members') {
  const members = state.household?.members || [];
  return `<div class="member-picker" data-picker="${name}">
    ${members
      .map(
        (m) => `<label class="pick">
          <input type="checkbox" name="${name}" value="${esc(m.id)}" ${selected.includes(m.id) ? 'checked' : ''}>
          <span>${esc(m.emoji)} ${esc(m.name)}</span></label>`,
      )
      .join('')}
    <p class="hint">Ingen valgt = gjelder hele familien</p>
  </div>`;
}

export const pickedMembers = (form, name = 'members') =>
  [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);

/** Emoji-knapp som åpner en velger. onPick(emoji) kalles ved valg. */
export function pickEmoji(presets, current, onPick) {
  openModal(
    `<h2 class="modal-title">Velg emoji</h2>
     <div class="emoji-grid">${presets.map((e) => `<button type="button" class="emoji-opt ${e === current ? 'on' : ''}" data-e="${esc(e)}">${esc(e)}</button>`).join('')}</div>
     <label class="field"><span>Eller skriv/lim inn din egen</span>
       <input class="emoji-own" maxlength="8" value="${esc(current || '')}" inputmode="text"></label>
     <div class="modal-actions"><button type="button" class="btn ghost" data-close>Avbryt</button>
       <button type="button" class="btn primary" data-own>Bruk</button></div>`,
    (root, close) => {
      root.querySelectorAll('[data-e]').forEach((b) => (b.onclick = () => (onPick(b.dataset.e), close())));
      root.querySelector('[data-own]').onclick = () => {
        const v = root.querySelector('.emoji-own').value.trim();
        if (v) onPick(v);
        close();
      };
    },
  );
}

export function emptyState(emoji, title, text = '') {
  return `<div class="empty"><div class="empty-emoji">${emoji}</div><p class="empty-title">${esc(title)}</p>${text ? `<p class="muted">${esc(text)}</p>` : ''}</div>`;
}
