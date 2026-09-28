// ✨ Assistenten: skriv eller snakk («legg inn bursdag til Nils 12. oktober»,
// «vi mangler middag torsdag», «kjøp melk og brød») → Gemini foreslår handlinger
// → du bekrefter før noe lagres.

import { esc, openModal, toast, fmtShort, relDay } from '../util.js';
import { state, upsert, memberByName } from '../store.js';
import { runAssistant, hasAI } from '../ai.js';
import { allLists, addItem, resolveList, listById } from '../shoplists.js';
import { inventoryText, findRoom } from './house.js';
import { eventModal } from './calendar.js';
import { taskModal } from './tasks.js';

const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

const EXAMPLES = [
  'Legg inn bursdag til Nils 12. oktober',
  'Vi mangler middag torsdag',
  'Kjøp melk, brød og bananer',
  'Emma skal til tannlegen tirsdag kl 14',
  'Pappa må bytte vinterdekk før 20. oktober',
  'Kjøp kaffe og brus på svenskelista',
  'Hvor er klær str. 86?',
];

export function openAssistant(prefill = '', autoSubmit = false) {
  openModal(
    `<div class="assistant">
      <h2 class="modal-title">✨ Hva vil du legge inn?</h2>
      ${hasAI() ? '' : '<p class="gate-error">AI er ikke satt opp ennå. Legg inn en gratis Gemini-nøkkel under Mer → Innstillinger → AI. Du kan fortsatt legge inn ting manuelt nedenfor.</p>'}
      <form class="assist-form">
        <textarea name="q" rows="2" placeholder="Skriv – eller trykk 🎙️ og snakk" maxlength="500">${esc(prefill)}</textarea>
        <div class="assist-btns">
          ${SpeechRec ? '<button type="button" class="icon-btn mic" data-mic aria-label="Snakk">🎙️</button>' : ''}
          <button type="submit" class="btn primary" ${hasAI() ? '' : 'disabled'}>Tolk ✨</button>
        </div>
      </form>
      ${SpeechRec ? '' : '<p class="hint">Tips: Trykk på mikrofonen på tastaturet for å diktere.</p>'}
      <div class="assist-examples">${EXAMPLES.map((e) => `<button type="button" class="chip small" data-ex="${esc(e)}">${esc(e)}</button>`).join('')}</div>
      <div class="assist-result" aria-live="polite"></div>
      <div class="assist-manual">
        <span class="muted">Eller legg inn selv:</span>
        <button type="button" class="btn soft small" data-manual="event">📅 Hendelse</button>
        <button type="button" class="btn soft small" data-manual="task">✅ Oppgave</button>
      </div>
    </div>`,
    (root, close) => {
      const form = root.querySelector('form');
      const ta = form.elements.q;
      const result = root.querySelector('.assist-result');
      root.querySelectorAll('[data-ex]').forEach((b) => (b.onclick = () => ((ta.value = b.dataset.ex), ta.focus())));
      root.querySelector('[data-manual="event"]').onclick = () => (close(), eventModal({}));
      root.querySelector('[data-manual="task"]').onclick = () => (close(), taskModal({}));

      const mic = root.querySelector('[data-mic]');
      if (mic) {
        let rec = null;
        mic.onclick = () => {
          if (rec) return rec.stop();
          rec = new SpeechRec();
          rec.lang = 'nb-NO';
          rec.interimResults = true;
          mic.classList.add('listening');
          const before = ta.value ? ta.value + ' ' : '';
          rec.onresult = (e) => {
            ta.value = before + [...e.results].map((r) => r[0].transcript).join('');
          };
          rec.onerror = (e) => {
            if (e.error === 'not-allowed') toast('Mikrofonen er blokkert. Tillat mikrofon i nettleseren.', 'error');
          };
          rec.onend = () => {
            mic.classList.remove('listening');
            rec = null;
            if (ta.value.trim() && hasAI()) form.requestSubmit();
          };
          rec.start();
        };
      }

      form.onsubmit = async (e) => {
        e.preventDefault();
        const q = ta.value.trim();
        if (!q) return;
        result.innerHTML = '<p class="muted thinking">✨ Tenker …</p>';
        try {
          const r = await runAssistant(q, `Handlelister: ${allLists().map((l) => l.name).join(', ')}.\n${inventoryText(true)}`);
          showActions(result, r, close);
        } catch (err) {
          result.innerHTML = `<p class="gate-error">${esc(err.message)}</p>`;
        }
      };
      if (autoSubmit && prefill && hasAI()) form.requestSubmit();
    },
  );
}

function memberIds(names = []) {
  return names.map((n) => memberByName(n)?.id).filter(Boolean);
}
function memberLabel(names = []) {
  const ms = names.map(memberByName).filter(Boolean);
  return ms.length ? ms.map((m) => m.emoji + ' ' + m.name).join(', ') : '👪 Hele familien';
}

function describe(a) {
  switch (a.type) {
    case 'event':
      return `📅 <b>${esc(a.emoji || '')} ${esc(a.title)}</b><br><small>${a.date ? esc(relDay(a.date)) + ' (' + fmtShort(a.date) + ')' : 'uten dato'}${a.start ? ' kl. ' + esc(a.start) : ''}${a.repeat === 'yearly' ? ' · hvert år' : a.repeat === 'weekly' ? ' · hver uke' : ''} · ${memberLabel(a.members)}</small>`;
    case 'task':
      return `✅ <b>${esc(a.title)}</b><br><small>${a.due ? 'frist ' + esc(relDay(a.due)) : 'uten frist'} · ${memberLabel(a.members)}</small>`;
    case 'shopping':
      return `🛒 <b>${esc(listById(resolveList(a.list)?.id || 'main').name)}:</b> ${(a.items || []).map((i) => esc((i.emoji || '') + ' ' + i.name)).join(', ')}`;
    case 'thing': {
      const room = findRoom(a.room);
      return `📦 <b>${esc(a.emoji || '')} ${esc(a.name)}</b> → ${room ? esc(room.emoji + ' ' + room.name) : '<span class="warn-text">fant ikke rommet «' + esc(a.room || '') + '»</span>'}${a.contents?.length ? `<br><small>${a.contents.map(esc).join(' · ')}</small>` : ''}`;
    }
    case 'meal':
      return `🍽️ <b>${esc(a.emoji || '')} ${esc(a.dish)}</b> ${a.date ? esc(relDay(a.date)) : ''}<br><small>${(a.ingredients || []).map(esc).join(' · ')}</small>`;
    default:
      return null;
  }
}

function showActions(el, r, close) {
  const actions = (r.actions || []).filter((a) => describe(a));
  el.innerHTML = `
    ${r.reply ? `<p class="assist-reply">💬 ${esc(r.reply)}</p>` : ''}
    ${
      actions.length
        ? `<ul class="assist-actions">${actions
            .map((a, i) => `<li><label><input type="checkbox" data-i="${i}" checked><span>${describe(a)}</span></label>${a.type === 'meal' && a.ingredients?.length ? '<label class="toggle-line small ingr-toggle"><input type="checkbox" data-ingr checked> Legg ingrediensene i handlelista</label>' : ''}</li>`)
            .join('')}</ul>
           <div class="modal-actions"><span class="spacer"></span><button class="btn primary" data-apply>Legg inn valgte</button></div>`
        : ''
    }`;
  el.querySelector('[data-apply]')?.addEventListener('click', () => {
    let n = 0;
    el.querySelectorAll('input[data-i]').forEach((cb) => {
      if (!cb.checked) return;
      const a = actions[Number(cb.dataset.i)];
      const withIngr = cb.closest('li').querySelector('[data-ingr]')?.checked;
      apply(a, withIngr);
      n++;
    });
    close();
    if (n) toast(`✨ ${n} ${n === 1 ? 'ting' : 'ting'} lagt inn`, 'ok');
  });
}

export function addShoppingItems(items, listId = 'main') {
  for (const it of items) addItem(listId, String(it.name || it).trim(), it.emoji || undefined);
}

function apply(a, withIngr) {
  if (a.type === 'event' && a.date) {
    upsert('events', {
      title: a.title, emoji: a.emoji || '📅', date: a.date, start: a.start || null, end: a.end || null,
      members: memberIds(a.members), repeat: ['weekly', 'yearly'].includes(a.repeat) ? a.repeat : 'none', note: '',
    });
  } else if (a.type === 'task') {
    upsert('tasks', { title: a.title, emoji: a.emoji || '✅', due: a.due || null, members: memberIds(a.members), done: false });
  } else if (a.type === 'shopping') {
    addShoppingItems(a.items || [], resolveList(a.list)?.id || 'main');
  } else if (a.type === 'thing') {
    const room = findRoom(a.room);
    if (room) upsert('things', { roomId: room.id, name: a.name, emoji: a.emoji || '📦', kind: a.contents?.length ? 'boks' : 'ting', contents: a.contents || [], place: a.place || '', tags: [] });
  } else if (a.type === 'meal' && a.date) {
    upsert('meals', { id: a.date, date: a.date, dish: a.dish, emoji: a.emoji || '🍽️', ingredients: a.ingredients || [], recipeId: null });
    if (withIngr) addShoppingItems((a.ingredients || []).map((i) => ({ name: i })));
  }
}

