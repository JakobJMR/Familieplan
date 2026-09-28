// «Hjemme»: det som finnes i kjøleskap, fryser og skap. Fylles automatisk fra handlelista.

import { esc, openModal, toast } from '../util.js';
import { state, upsert, remove } from '../store.js';
import { emptyState } from '../components.js';
import { guessEmoji } from '../emoji.js';
import { hasAI } from '../ai.js';
import { allLists, addItem } from '../shoplists.js';

export const PLACES = [
  ['kjoleskap', '🧊', 'Kjøleskap'],
  ['fryser', '❄️', 'Fryser'],
  ['skap', '🗄️', 'Skap og tørrvarer'],
  ['annet', '🏠', 'Annet'],
];

// Enkel gjetting av hvor varen hører hjemme
function guessPlace(name) {
  const n = name.toLowerCase();
  if (/frossen|frosne|\bis\b|iskrem|fisk(e)?pinner|pizza/.test(n)) return 'fryser';
  if (/melk|ost|smør|yoghurt|skyr|egg|pålegg|skinke|kjøtt|kylling|bacon|pølse|fisk|laks|torsk|reke|salat|agurk|tomat|paprika|fløte|rømme|juice|leverpostei/.test(n)) return 'kjoleskap';
  if (/pasta|ris|mel|sukker|kaffe|te\b|hermetikk|boks|krydder|olje|müsli|musli|havre|gryn|kjeks|chips|nøtter|buljong|taco|saus|godteri|sjokolade|snop|brus/.test(n)) return 'skap';
  return 'annet';
}

export function addToPantry(name, emoji, place) {
  const existing = state.pantry.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (existing) return upsert('pantry', { ...existing, addedAt: new Date().toISOString() });
  return upsert('pantry', { name, emoji: emoji || guessEmoji(name), place: place || guessPlace(name), addedAt: new Date().toISOString() });
}

export const pantryText = () => state.pantry.map((x) => x.name).join(', ');

export function renderPantry() {
  const byPlace = PLACES.map(([k, e, n]) => [k, e, n, state.pantry.filter((x) => (x.place || 'annet') === k).sort((a, b) => a.name.localeCompare(b.name, 'nb'))]).filter((p) => p[3].length);
  return `
  <form class="quick-add" data-pantry-add>
    <input id="pantry-input" name="name" placeholder="Legg til noe vi har …" maxlength="60" autocomplete="off">
    <select name="place" class="place-select" aria-label="Hvor">${PLACES.map(([k, e]) => `<option value="${k}">${e}</option>`).join('')}<option value="" selected>Auto</option></select>
    <button class="btn primary" type="submit" aria-label="Legg til">＋</button>
  </form>
  ${hasAI() ? '<button class="btn soft" data-what-cook style="margin-bottom:12px">✨ Hva kan vi lage av dette?</button>' : ''}
  ${byPlace.length
    ? byPlace.map(([k, e, n, items]) => `<h2 class="section-title">${e} ${n} <span class="count">${items.length}</span></h2>
      <div class="pantry-grid">${items.map((x) => `<button class="pantry-item" data-pitem="${esc(x.id)}"><span>${esc(x.emoji)}</span>${esc(x.name)}</button>`).join('')}</div>`).join('')
    : emptyState('🏠', 'Ingenting registrert hjemme ennå', 'Varer du haker av på handlelista havner her automatisk. Trykk på en vare når den er brukt opp.')}`;
}

export function bindPantry(root, openSuggest) {
  const form = root.querySelector('[data-pantry-add]');
  form.onsubmit = (e) => {
    e.preventDefault();
    const text = form.elements.name.value;
    const place = form.elements.place.value || undefined;
    form.elements.name.value = '';
    text.split(/,| og /).map((x) => x.trim()).filter(Boolean).forEach((n) => addToPantry(n.charAt(0).toUpperCase() + n.slice(1), null, place));
    document.getElementById('pantry-input')?.focus();
  };
  root.querySelector('[data-what-cook]')?.addEventListener('click', () => openSuggest());
  root.querySelectorAll('[data-pitem]').forEach((b) => {
    b.onclick = () => {
      const x = state.pantry.find((i) => i.id === b.dataset.pitem);
      if (!x) return;
      openModal(
        `<h2 class="modal-title">${esc(x.emoji)} ${esc(x.name)}</h2>
         <label class="field"><span>Ligger i</span><select data-place>${PLACES.map(([k, e, n]) => `<option value="${k}" ${x.place === k ? 'selected' : ''}>${e} ${n}</option>`).join('')}</select></label>
         <div class="row-btns">
           <button class="btn primary" data-used>✔ Brukt opp</button>
           <button class="btn soft" data-rebuy>🛒 Brukt opp – kjøp igjen</button>
         </div>
         <label class="field" style="margin-top:12px"><span>Kjøp igjen på</span><select data-rebuy-list>${allLists().map((l) => `<option value="${esc(l.id)}">${esc(l.emoji || '')} ${esc(l.name)}</option>`).join('')}</select></label>
         <div class="modal-actions"><span class="spacer"></span><button class="btn ghost" data-close>Lukk</button></div>`,
        (r, close) => {
          r.querySelector('[data-place]').onchange = (e) => upsert('pantry', { ...x, place: e.target.value });
          r.querySelector('[data-used]').onclick = () => (remove('pantry', x.id), close());
          r.querySelector('[data-rebuy]').onclick = () => {
            addItem(r.querySelector('[data-rebuy-list]').value, x.name, x.emoji);
            remove('pantry', x.id);
            close();
            toast(`🛒 ${x.name} er satt på handlelista`, 'ok');
          };
        },
      );
    };
  });
}
