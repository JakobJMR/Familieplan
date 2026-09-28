// Handlelister: flere lister (f.eks. Norsk og Svensk), forslag ut fra handlevaner,
// avhaking, og avhakede varer kan flyttes til «Hjemme»-lageret.

import { esc, openModal, confirmDialog, toast } from '../util.js';
import { state, upsert, remove } from '../store.js';
import { emptyState, pickEmoji } from '../components.js';
import { KINDS, allLists, listById, itemsIn, openCount, addItem, suggestions } from '../shoplists.js';
import { addToPantry } from './pantry.js';

let current = 'main';
try {
  current = sessionStorage.getItem('fd.list') || 'main';
} catch {
  /* ignorer */
}
const setCurrent = (id) => {
  current = id;
  try {
    sessionStorage.setItem('fd.list', id);
  } catch {
    /* ignorer */
  }
};

export function renderShopping() {
  const lists = allLists();
  if (!lists.some((l) => l.id === current)) current = 'main';
  const list = listById(current);
  const items = itemsIn(list.id);
  const open = items.filter((x) => !x.done).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  const done = items.filter((x) => x.done);
  const sugg = suggestions(list.id);

  return `
  <div class="list-tabs">
    ${lists.map((l) => `<button class="chip ${l.id === list.id ? 'on' : ''}" data-list="${esc(l.id)}">${esc(l.emoji || KINDS[l.kind]?.flag || '🛒')} ${esc(l.name)}${openCount(l.id) ? ` <span class="chip-count">${openCount(l.id)}</span>` : ''}</button>`).join('')}
    <button class="chip ghost-chip" data-new-list>＋ Ny liste</button>
  </div>
  <form class="quick-add" data-add>
    <input id="shop-input" name="name" placeholder="Legg til på «${esc(list.name)}» …" maxlength="80" autocomplete="off" enterkeyhint="enter">
    <button class="btn primary" type="submit" aria-label="Legg til">＋</button>
  </form>
  ${sugg.length ? `<div class="quick-chips">${sugg.map((q) => `<button class="chip" data-quick="${esc(q.name)}" data-emoji="${esc(q.emoji || '')}">${esc(q.emoji || '')} ${esc(q.name)}</button>`).join('')}</div>` : ''}
  ${
    open.length
      ? `<ul class="shop-list">${open.map(item).join('')}</ul>`
      : done.length
        ? emptyState('🧺', 'Alt er handlet!', '')
        : emptyState(list.kind === 'sverige' ? '🇸🇪' : '🛒', `«${list.name}» er tom`, 'Skriv inn en vare, eller trykk på et forslag. Appen lærer hva dere pleier å kjøpe.')
  }
  ${
    done.length
      ? `<div class="done-head"><h2 class="section-title">I kurven <span class="count">${done.length}</span></h2>
          <button class="btn ghost small" data-clear>${list.toPantry ? '🏠 Ferdig – legg i Hjemme' : '🧹 Fjern avhakede'}</button></div>
         <ul class="shop-list done">${done.map(item).join('')}</ul>`
      : ''
  }
  <button class="btn ghost small" data-list-settings style="margin-top:14px">⚙️ Innstillinger for «${esc(list.name)}»</button>`;
}

function item(x) {
  return `<li class="shop-item ${x.done ? 'done' : ''}">
    <button class="check ${x.done ? 'on' : ''}" data-toggle="${esc(x.id)}" aria-label="${x.done ? 'Angre' : 'Hak av'}"></button>
    <button class="shop-name" data-toggle="${esc(x.id)}"><span class="pe">${esc(x.emoji)}</span><span class="pt">${esc(x.name)}</span></button>
    <button class="icon-btn subtle" data-edit="${esc(x.id)}" aria-label="Endre">✎</button>
  </li>`;
}

export function bindShopping(root, rerender) {
  const form = root.querySelector('[data-add]');
  form.onsubmit = (e) => {
    e.preventDefault();
    const input = form.elements.name;
    const text = input.value;
    input.value = '';
    text.split(/,| og /).forEach((n) => addItem(current, n));
    document.getElementById('shop-input')?.focus();
  };
  root.querySelectorAll('[data-list]').forEach((b) => (b.onclick = () => (setCurrent(b.dataset.list), rerender())));
  root.querySelector('[data-new-list]').onclick = () => listModal({}, rerender);
  root.querySelector('[data-list-settings]').onclick = () => listModal(listById(current), rerender);
  root.querySelectorAll('[data-quick]').forEach((b) => (b.onclick = () => addItem(current, b.dataset.quick, b.dataset.emoji || undefined)));
  root.querySelectorAll('[data-toggle]').forEach((b) => {
    b.onclick = () => {
      const x = state.shopping.find((i) => i.id === b.dataset.toggle);
      if (x) upsert('shopping', { ...x, done: !x.done });
    };
  });
  root.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => editItem(state.shopping.find((i) => i.id === b.dataset.edit))));
  root.querySelector('[data-clear]')?.addEventListener('click', () => {
    const list = listById(current);
    const done = itemsIn(list.id).filter((x) => x.done);
    if (list.toPantry) done.forEach((x) => addToPantry(x.name, x.emoji));
    done.forEach((x) => remove('shopping', x.id));
    if (list.toPantry && done.length) toast(`🏠 ${done.length} varer lagt i Hjemme-lageret`, 'ok');
  });
}

function listModal(l, rerender) {
  const editing = !!l.id;
  let emoji = l.emoji || '🛒';
  openModal(
    `<form class="form" novalidate>
      <h2 class="modal-title">${editing ? 'Innstillinger for lista' : 'Ny handleliste'}</h2>
      <div class="title-row">
        <button type="button" class="emoji-btn big" data-emoji>${esc(emoji)}</button>
        <input name="name" class="grow" placeholder="F.eks. Svensk, Rema, Byggvare" value="${esc(l.name || '')}" maxlength="30">
      </div>
      <label class="field"><span>Type liste (styrer forslagene)</span>
        <select name="kind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${(l.kind || 'norge') === k ? 'selected' : ''}>${v.flag} ${v.label}</option>`).join('')}</select></label>
      <label class="toggle-line"><input type="checkbox" name="toPantry" ${l.toPantry ?? true ? 'checked' : ''}> Avhakede varer legges i «Hjemme»-lageret</label>
      <div class="modal-actions">
        ${editing && l.id !== 'main' ? '<button type="button" class="btn danger ghost" data-delete>Slett lista</button>' : ''}
        <span class="spacer"></span>
        <button type="button" class="btn ghost" data-close>Avbryt</button>
        <button type="submit" class="btn primary">Lagre</button>
      </div>
    </form>`,
    (root, close) => {
      const form = root.querySelector('form');
      const f = form.elements;
      const eb = root.querySelector('[data-emoji]');
      eb.onclick = () => pickEmoji(['🛒', '🇳🇴', '🇸🇪', '🇩🇰', '🏪', '🧺', '🛍️', '🔨', '💊', '🎉', '🐶', '🌱'], emoji, (e) => ((emoji = e), (eb.textContent = e)));
      f.kind.onchange = () => {
        if (emoji === '🛒' || emoji === '🇳🇴' || emoji === '🇸🇪') (emoji = KINDS[f.kind.value].flag), (eb.textContent = emoji);
        if (!editing && !f.name.value.trim()) f.name.value = f.kind.value === 'sverige' ? 'Svensk' : f.kind.value === 'norge' ? 'Norsk' : '';
      };
      form.onsubmit = (e) => {
        e.preventDefault();
        const name = f.name.value.trim();
        if (!name) return toast('Gi lista et navn.', 'error');
        const saved = upsert('lists', { ...l, name, emoji, kind: f.kind.value, toPantry: f.toPantry.checked, order: l.order ?? allLists().length });
        setCurrent(saved.id);
        close();
        rerender();
      };
      root.querySelector('[data-delete]')?.addEventListener('click', async () => {
        const n = itemsIn(l.id).length;
        if (!(await confirmDialog(`Slette lista «${l.name}»${n ? ` og ${n} varer på den` : ''}?`))) return;
        itemsIn(l.id).forEach((x) => remove('shopping', x.id));
        remove('lists', l.id);
        setCurrent('main');
        close();
        rerender();
      });
    },
  );
}

function editItem(x) {
  if (!x) return;
  let emoji = x.emoji;
  openModal(
    `<form class="form">
      <h2 class="modal-title">Endre vare</h2>
      <div class="title-row">
        <button type="button" class="emoji-btn big" data-emoji>${esc(emoji)}</button>
        <input name="name" class="grow" value="${esc(x.name)}" maxlength="80">
      </div>
      <label class="field"><span>Liste</span><select name="list">${allLists().map((l) => `<option value="${esc(l.id)}" ${(x.listId || 'main') === l.id ? 'selected' : ''}>${esc(l.emoji || '')} ${esc(l.name)}</option>`).join('')}</select></label>
      <div class="modal-actions">
        <button type="button" class="btn danger ghost" data-delete>Slett</button>
        <span class="spacer"></span>
        <button type="button" class="btn ghost" data-close>Avbryt</button>
        <button type="submit" class="btn primary">Lagre</button>
      </div>
    </form>`,
    (root, close) => {
      const form = root.querySelector('form');
      const btn = root.querySelector('[data-emoji]');
      btn.onclick = () => pickEmoji(['🛒', '🥛', '🍞', '🥚', '🧀', '🍎', '🍌', '🥕', '🥩', '🐟', '🍝', '☕', '🧻', '🧼', '👶', '🐾'], emoji, (e) => ((emoji = e), (btn.textContent = e)));
      form.onsubmit = (e) => {
        e.preventDefault();
        const name = form.elements.name.value.trim();
        if (!name) return;
        close();
        upsert('shopping', { ...x, name, emoji, listId: form.elements.list.value });
      };
      root.querySelector('[data-delete]').onclick = () => (close(), remove('shopping', x.id));
    },
  );
}
