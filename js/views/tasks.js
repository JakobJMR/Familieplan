// Gjøremål: egne lister, men oppgaver med frist vises også i kalenderen.

import { esc, today, relDay, openModal, confirmDialog, toast } from '../util.js';
import { state, upsert, remove } from '../store.js';
import { taskBuckets, sortTasks, involves } from '../logic.js';
import { memberFilter, whoBadges, memberPicker, pickedMembers, pickEmoji, emptyState } from '../components.js';
import { TASK_EMOJIS } from '../emoji.js';

let showDone = false;

export function toggleTask(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  const done = !t.done;
  upsert('tasks', { ...t, done, doneAt: done ? new Date().toISOString() : null });
  if (done) toast(`${t.emoji || '✅'} «${t.title}» er gjort!`, 'ok');
}

function row(x) {
  const t = today();
  const late = x.due && x.due < t && !x.done;
  return `<li class="task-row ${x.done ? 'done' : ''} ${late ? 'late' : ''}">
    <button class="check ${x.done ? 'on' : ''}" data-task="${esc(x.id)}" aria-label="${x.done ? 'Marker som ikke gjort' : 'Marker som gjort'}"></button>
    <button class="task-main" data-edit="${esc(x.id)}">
      <span class="pe">${esc(x.emoji || '✅')}</span>
      <span class="pt">${esc(x.title)}</span>
      ${x.due ? `<span class="due ${late ? 'late' : ''}">${late ? '⚠️ ' : ''}${esc(relDay(x.due))}</span>` : ''}
    </button>
    <span class="whos">${whoBadges(x.members)}</span>
  </li>`;
}

function section(title, list, cls = '') {
  if (!list.length) return '';
  return `<section class="task-section ${cls}"><h2 class="section-title">${title} <span class="count">${list.length}</span></h2>
    <ul class="task-list">${sortTasks(list).map(row).join('')}</ul></section>`;
}

export function renderTasks() {
  const b = taskBuckets(state.tasks, state.filter);
  const done = state.tasks
    .filter((x) => x.done && involves(x, state.filter))
    .sort((a, c) => (c.doneAt || '').localeCompare(a.doneAt || ''));

  return `
  <header class="view-head">
    <h1>✅ Gjøremål</h1>
  </header>
  ${memberFilter()}
  <form class="quick-add" data-quick-task>
    <input name="title" placeholder="Ny oppgave, f.eks. Bytte sengetøy" maxlength="120" autocomplete="off" enterkeyhint="done">
    <button class="btn primary" type="submit" aria-label="Legg til">＋</button>
  </form>
  <p class="hint">Trykk på en oppgave for å sette frist og hvem som skal gjøre den. Oppgaver med frist vises også i kalenderen.</p>
  ${
    b.open.length
      ? section('⚠️ Over fristen', b.overdue, 'late') + section('📌 I dag', b.today) + section('📝 Senere og uten frist', b.later)
      : emptyState('🎉', 'Ingen åpne oppgaver', 'Godt jobba!')
  }
  ${
    done.length
      ? `<button class="btn ghost small" data-show-done>${showDone ? 'Skjul' : 'Vis'} fullførte (${done.length})</button>
         ${showDone ? `<ul class="task-list done-list">${done.slice(0, 30).map(row).join('')}</ul>` : ''}`
      : ''
  }`;
}

export function bindTasks(root, rerender) {
  const form = root.querySelector('[data-quick-task]');
  form.onsubmit = (e) => {
    e.preventDefault();
    const input = form.elements.title;
    const title = input.value.trim();
    if (!title) return;
    input.value = '';
    upsert('tasks', { title, emoji: '✅', members: state.filter ? [state.filter] : [], done: false, due: null });
  };
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
  let emoji = task.emoji || '✅';
  openModal(
    `<form class="form" novalidate>
      <h2 class="modal-title">${editing ? 'Endre oppgave' : 'Ny oppgave'}</h2>
      <div class="title-row">
        <button type="button" class="emoji-btn big" data-emoji>${esc(emoji)}</button>
        <input name="title" class="grow" placeholder="Hva skal gjøres?" value="${esc(task.title || '')}" maxlength="120">
      </div>
      <div class="field"><span>Frist (valgfritt)</span>
        <div class="due-row">
          <input type="date" name="due" value="${esc(task.due || '')}">
          <button type="button" class="btn soft small" data-due="0">I dag</button>
          <button type="button" class="btn soft small" data-due="1">I morgen</button>
          <button type="button" class="btn soft small" data-due="">Ingen</button>
        </div></div>
      <fieldset class="field"><legend>Hvem skal gjøre den?</legend>${memberPicker(task.members || [])}</fieldset>
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
      emojiBtn.onclick = () => pickEmoji(TASK_EMOJIS, emoji, (e) => ((emoji = e), (emojiBtn.textContent = e)));
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
        if (!title) return toast('Skriv hva som skal gjøres.', 'error');
        close();
        upsert('tasks', {
          ...task,
          title,
          emoji,
          due: f.due.value || null,
          members: pickedMembers(form),
          done: !!task.done,
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
