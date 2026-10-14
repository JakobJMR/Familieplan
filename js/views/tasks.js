// Gjøremål: egne lister, men oppgaver med frist vises også i kalenderen.
// Samme samling rommer to slag: kind 'oppgave' (skal gjøres) og kind 'notat'
// (skal bare kunne finnes igjen). Notater holdes utenfor varselboksen – se taskBuckets.

import { esc, today, relDay, openModal, confirmDialog, toast } from '../util.js';
import { state, upsert, remove } from '../store.js';
import { taskBuckets, sortTasks, involves } from '../logic.js';
import { memberFilter, whoBadges, memberPicker, pickedMembers, pickEmoji, emptyState } from '../components.js';
import { TASK_EMOJIS, NOTE_EMOJIS } from '../emoji.js';

let showDone = false;
let query = '';
let activeTag = null;

const MAX_NOTES = 5000;
const MAX_TAGS = 8;

export const isNote = (x) => x.kind === 'notat';

/** «Bil, Verksted , bil» → ['bil','verksted'] */
export function normTags(raw) {
  return [
    ...new Set(
      String(raw || '')
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].slice(0, MAX_TAGS);
}

/** Alle stikkord i bruk, med antall, mest brukt først. */
function allTags() {
  const counts = new Map();
  for (const x of state.tasks) for (const t of x.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'nb'));
}

/** Alle søkeord må finnes i tittel, fritekst eller stikkord. */
function matches(x, terms) {
  if (!terms.length) return true;
  const hay = [x.title, x.notes, ...(x.tags || [])].filter(Boolean).join(' ').toLowerCase();
  return terms.every((t) => hay.includes(t));
}

export function toggleTask(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t || isNote(t)) return;
  const done = !t.done;
  upsert('tasks', { ...t, done, doneAt: done ? new Date().toISOString() : null });
  if (done) toast(`${t.emoji || '✅'} «${t.title}» er gjort!`, 'ok');
}

function row(x) {
  const t = today();
  const note = isNote(x);
  const late = !note && x.due && x.due < t && !x.done;
  const body = (x.notes || '').trim();
  const excerpt = body.split('\n')[0].slice(0, 80);
  const tags = (x.tags || []).slice(0, 3);
  return `<li class="task-row ${note ? 'note-row' : ''} ${x.done ? 'done' : ''} ${late ? 'late' : ''}">
    ${
      note
        ? '<span class="note-mark" aria-hidden="true">📓</span>'
        : `<button class="check ${x.done ? 'on' : ''}" data-task="${esc(x.id)}" aria-label="${x.done ? 'Marker som ikke gjort' : 'Marker som gjort'}"></button>`
    }
    <button class="task-main" data-edit="${esc(x.id)}">
      <span class="pe">${esc(x.emoji || (note ? '📓' : '✅'))}</span>
      <span class="pt">${esc(x.title)}
        ${excerpt ? `<small class="task-note">${esc(excerpt)}${body.length > 80 ? '…' : ''}</small>` : ''}
        ${tags.length ? `<small class="row-tags">${tags.map((tg) => '#' + esc(tg)).join(' ')}</small>` : ''}
      </span>
      ${!note && x.due ? `<span class="due ${late ? 'late' : ''}">${late ? '⚠️ ' : ''}${esc(relDay(x.due))}</span>` : ''}
    </button>
    <span class="whos">${whoBadges(x.members)}</span>
  </li>`;
}

function section(title, list, cls = '') {
  if (!list.length) return '';
  return `<section class="task-section ${cls}"><h2 class="section-title">${title} <span class="count">${list.length}</span></h2>
    <ul class="task-list">${sortTasks(list).map(row).join('')}</ul></section>`;
}

function tagBar() {
  const tags = allTags();
  if (!tags.length) return '';
  return `<nav class="tag-bar" aria-label="Stikkord">
    ${activeTag ? '<button class="chip small" data-tag="">✕ Alle</button>' : ''}
    ${tags
      .map(
        ([t, n]) =>
          `<button class="chip small ${activeTag === t ? 'on' : ''}" data-tag="${esc(t)}">#${esc(t)}<span class="chip-count">${n}</span></button>`,
      )
      .join('')}
  </nav>`;
}

export function renderTasks() {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const filtering = !!terms.length || !!activeTag;
  const mine = state.tasks.filter((x) => involves(x, state.filter));

  const head = `
  <header class="view-head">
    <h1>✅ Gjøremål</h1>
  </header>
  ${memberFilter()}
  <div class="task-search">
    <input id="task-q" type="search" value="${esc(query)}" placeholder="🔍 Søk i oppgaver og notater" autocomplete="off" enterkeyhint="search">
    ${query ? '<button class="btn ghost small" data-clear-q aria-label="Tøm søk">✕</button>' : ''}
  </div>
  ${tagBar()}`;

  if (filtering) {
    const hits = mine.filter((x) => matches(x, terms) && (!activeTag || (x.tags || []).includes(activeTag)));
    const open = sortTasks(hits.filter((x) => !isNote(x) && !x.done));
    const notes = hits.filter(isNote).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    const closed = hits.filter((x) => x.done);
    const label = activeTag && !terms.length ? `#${esc(activeTag)}` : '🔍 Treff';
    return `${head}
    ${
      hits.length
        ? `<section class="task-section"><h2 class="section-title">${label} <span class="count">${hits.length}</span></h2>
             <ul class="task-list">${[...open, ...notes, ...closed].map(row).join('')}</ul></section>`
        : emptyState('🔍', 'Ingen treff', 'Prøv et annet ord, eller fjern stikkordfilteret.')
    }`;
  }

  const b = taskBuckets(state.tasks, state.filter);
  const notes = mine.filter(isNote).sort((a, c) => (c.updatedAt || '').localeCompare(a.updatedAt || ''));
  const done = mine.filter((x) => x.done && !isNote(x)).sort((a, c) => (c.doneAt || '').localeCompare(a.doneAt || ''));

  return `${head}
  <form class="quick-add" data-quick-task>
    <input name="title" placeholder="Ny oppgave, f.eks. Bytte sengetøy" maxlength="120" autocomplete="off" enterkeyhint="done">
    <button class="btn primary" type="submit" aria-label="Legg til">＋</button>
  </form>
  <div class="row-btns tasks-actions">
    <button class="btn ghost small" data-new-note>📓 Nytt notat</button>
  </div>
  <p class="hint">Trykk på en oppgave for å sette frist, detaljer og stikkord. Oppgaver med frist vises også i kalenderen. Notater maser aldri – de ligger bare her til du søker dem opp.</p>
  ${
    b.open.length
      ? section('⚠️ Over fristen', b.overdue, 'late') + section('📌 I dag', b.today) + section('📝 Senere og uten frist', b.later)
      : emptyState('🎉', 'Ingen åpne oppgaver', 'Godt jobba!')
  }
  ${section('📓 Til info', notes, 'notes')}
  ${
    done.length
      ? `<button class="btn ghost small" data-show-done>${showDone ? 'Skjul' : 'Vis'} fullførte (${done.length})</button>
         ${showDone ? `<ul class="task-list done-list">${done.slice(0, 30).map(row).join('')}</ul>` : ''}`
      : ''
  }`;
}

export function bindTasks(root, rerender) {
  const form = root.querySelector('[data-quick-task]');
  if (form)
    form.onsubmit = (e) => {
      e.preventDefault();
      const input = form.elements.title;
      const title = input.value.trim();
      if (!title) return;
      input.value = '';
      upsert('tasks', {
        title,
        emoji: '✅',
        kind: 'oppgave',
        notes: '',
        tags: [],
        members: state.filter ? [state.filter] : [],
        done: false,
        due: null,
      });
    };

  const q = root.querySelector('#task-q');
  if (q) {
    // Behold markøren etter at visningen er tegnet på nytt
    if (query) {
      q.focus();
      q.setSelectionRange(q.value.length, q.value.length);
    }
    let timer;
    q.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        query = q.value;
        rerender();
      }, 200);
    });
  }
  root.querySelector('[data-clear-q]')?.addEventListener('click', () => ((query = ''), rerender()));
  root.querySelectorAll('[data-tag]').forEach((b) => {
    b.onclick = () => ((activeTag = b.dataset.tag || null), rerender());
  });
  root.querySelector('[data-new-note]')?.addEventListener('click', () => taskModal({ kind: 'notat' }));

  root.querySelectorAll('[data-task]').forEach((el) => (el.onclick = () => toggleTask(el.dataset.task)));
  root.querySelectorAll('[data-edit]').forEach((el) => {
    el.onclick = () => taskModal(state.tasks.find((x) => x.id === el.dataset.edit));
  });
  root.querySelector('[data-show-done]')?.addEventListener('click', () => {
    showDone = !showDone;
    rerender();
  });
}

export function taskModal(task = {}) {
  const editing = !!task.id;
  let kind = task.kind === 'notat' ? 'notat' : 'oppgave';
  let emoji = task.emoji || (kind === 'notat' ? '📓' : '✅');
  const suggestions = allTags()
    .slice(0, 10)
    .map(([t]) => t);

  const heading = () => (editing ? (kind === 'notat' ? 'Endre notat' : 'Endre oppgave') : kind === 'notat' ? 'Nytt notat' : 'Ny oppgave');

  openModal(
    `<form class="form" novalidate>
      <h2 class="modal-title" data-heading>${heading()}</h2>
      <div class="kind-row" role="group" aria-label="Type">
        <button type="button" class="chip small ${kind === 'oppgave' ? 'on' : ''}" data-kind="oppgave">✅ Oppgave</button>
        <button type="button" class="chip small ${kind === 'notat' ? 'on' : ''}" data-kind="notat">📓 Notat</button>
      </div>
      <div class="title-row">
        <button type="button" class="emoji-btn big" data-emoji>${esc(emoji)}</button>
        <input name="title" class="grow" placeholder="${kind === 'notat' ? 'Hva gjelder det?' : 'Hva skal gjøres?'}" value="${esc(task.title || '')}" maxlength="120">
      </div>
      <div class="field" data-due-field ${kind === 'notat' ? 'hidden' : ''}><span>Frist (valgfritt)</span>
        <div class="due-row">
          <input type="date" name="due" value="${esc(task.due || '')}">
          <button type="button" class="btn soft small" data-due="0">I dag</button>
          <button type="button" class="btn soft small" data-due="1">I morgen</button>
          <button type="button" class="btn soft small" data-due="">Ingen</button>
        </div></div>
      <label class="field"><span>Detaljer (valgfritt)</span>
        <textarea name="notes" rows="4" maxlength="${MAX_NOTES}" placeholder="Plass til det som ikke passer i tittelen – lenker, mål, hva som ble sagt.">${esc(task.notes || '')}</textarea></label>
      <label class="field"><span>Stikkord (skill med komma)</span>
        <input name="tags" value="${esc((task.tags || []).join(', '))}" placeholder="bil, verksted" autocomplete="off"></label>
      ${
        suggestions.length
          ? `<div class="tag-suggest">${suggestions.map((t) => `<button type="button" class="chip small" data-add-tag="${esc(t)}">#${esc(t)}</button>`).join('')}</div>`
          : ''
      }
      <fieldset class="field"><legend>Hvem gjelder det?</legend>${memberPicker(task.members || [])}</fieldset>
      <div class="modal-actions">
        ${editing ? '<button type="button" class="btn danger ghost" data-delete>Slett</button>' : ''}
        <span class="spacer"></span>
        <button type="button" class="btn ghost" data-close>Avbryt</button>
        <button type="submit" class="btn primary">Lagre</button>
      </div>
    </form>`,
    (root, close) => {
      const form = root.querySelector('form');
      const f = form.elements;
      const emojiBtn = root.querySelector('[data-emoji]');
      const dueField = root.querySelector('[data-due-field]');
      const headingEl = root.querySelector('[data-heading]');

      emojiBtn.onclick = () =>
        pickEmoji(kind === 'notat' ? NOTE_EMOJIS : TASK_EMOJIS, emoji, (e) => ((emoji = e), (emojiBtn.textContent = e)));

      root.querySelectorAll('[data-kind]').forEach((b) => {
        b.onclick = () => {
          kind = b.dataset.kind;
          root.querySelectorAll('[data-kind]').forEach((o) => o.classList.toggle('on', o.dataset.kind === kind));
          dueField.hidden = kind === 'notat';
          if (kind === 'notat') f.due.value = '';
          // Bytt bare standard-emojien, aldri en brukeren selv har valgt
          if (emoji === '✅' && kind === 'notat') emoji = '📓';
          else if (emoji === '📓' && kind === 'oppgave') emoji = '✅';
          emojiBtn.textContent = emoji;
          f.title.placeholder = kind === 'notat' ? 'Hva gjelder det?' : 'Hva skal gjøres?';
          headingEl.textContent = heading();
        };
      });

      root.querySelectorAll('[data-add-tag]').forEach((b) => {
        b.onclick = () => {
          const have = normTags(f.tags.value);
          if (!have.includes(b.dataset.addTag)) f.tags.value = [...have, b.dataset.addTag].join(', ');
        };
      });

      root.querySelectorAll('[data-due]').forEach((b) => {
        b.onclick = () => {
          if (b.dataset.due === '') f.due.value = '';
          else {
            const d = new Date();
            d.setDate(d.getDate() + Number(b.dataset.due));
            f.due.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          }
        };
      });

      form.onsubmit = (e) => {
        e.preventDefault();
        const title = f.title.value.trim();
        if (!title) return toast(kind === 'notat' ? 'Gi notatet en tittel.' : 'Skriv hva som skal gjøres.', 'error');
        close();
        upsert('tasks', {
          ...task,
          title,
          emoji,
          kind,
          notes: f.notes.value.trim().slice(0, MAX_NOTES),
          tags: normTags(f.tags.value),
          due: kind === 'notat' ? null : f.due.value || null,
          members: pickedMembers(form),
          done: kind === 'notat' ? false : !!task.done,
        });
      };

      root.querySelector('[data-delete]')?.addEventListener('click', async () => {
        if (await confirmDialog(`Slette «${task.title}»?`)) {
          close();
          remove('tasks', task.id);
        }
      });
    },
  );
}
