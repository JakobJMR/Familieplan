// Ukemeny og oppskrifter.

import { esc, today, addDays, startOfWeek, weekNumber, fmtShort, fmtWeekday, weekday, openModal, confirmDialog, toast } from '../util.js';
import { state, upsert, remove } from '../store.js';
import { emptyState, pickEmoji } from '../components.js';
import { hasAI, structureRecipe } from '../ai.js';
import { suggestMeals, winePairing } from '../ai-extra.js';
import { openAssistant, addShoppingItems } from './assistant.js';
import { pantryText } from './pantry.js';
import { allLists, addItem } from '../shoplists.js';

const FOOD_EMOJIS = ['🍽️', '🍝', '🌮', '🍕', '🍲', '🐟', '🍗', '🥩', '🍔', '🥘', '🍛', '🥗', '🍜', '🌭', '🥞', '🍳'];
let weekStart = startOfWeek(today());

export const mealOn = (d) => state.meals.find((m) => m.id === d) || null;
export const fixedMealOn = (d) => state.household?.fixedMeals?.[weekday(d)] || '';

// ───────────── Ukemeny ─────────────

export function renderMeals() {
  const t = today();
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const withIngr = days.map(mealOn).filter((m) => m?.ingredients?.length);
  return `
  <div class="week-nav">
    <button class="icon-btn" data-mweek="-1" aria-label="Forrige uke">‹</button>
    <div class="week-label"><b>Uke ${weekNumber(weekStart)}</b><span>${fmtShort(weekStart)} – ${fmtShort(days[6])}</span></div>
    <button class="icon-btn" data-mweek="1" aria-label="Neste uke">›</button>
  </div>
  <ul class="meal-week">
    ${days
      .map((d) => {
        const m = mealOn(d);
        const fixed = fixedMealOn(d);
        return `<li class="meal-day ${d === t ? 'is-today' : ''} ${d < t ? 'past' : ''}">
          <div class="md-date"><b>${fmtWeekday(d).slice(0, 3)}</b><span>${fmtShort(d)}</span></div>
          <button class="md-dish" data-meal="${d}">
            ${m ? `<span class="pe">${esc(m.emoji || '🍽️')}</span><span class="pt">${esc(m.dish)}${m.ingredients?.length ? `<small>${m.ingredients.length} ingredienser</small>` : ''}</span>`
              : fixed ? `<span class="pe">📌</span><span class="pt muted">${esc(fixed)} <small>fast rett</small></span>`
              : '<span class="pe">➕</span><span class="pt muted">Ikke planlagt</span>'}
          </button>
          ${hasAI() && !m ? `<button class="icon-btn subtle" data-suggest="${d}" aria-label="Foreslå middag">✨</button>` : ''}
          ${m?.ingredients?.length ? `<button class="icon-btn subtle" data-shop-meal="${d}" aria-label="Ingredienser til handlelista">🛒</button>` : ''}
        </li>`;
      })
      .join('')}
  </ul>
  <div class="row-btns">
    ${hasAI() ? '<button class="btn primary" data-what-cook>✨ Forslag ut fra det vi har</button>' : ''}
    ${withIngr.length ? '<button class="btn soft" data-shop-week>🛒 Ukas ingredienser til handlelista</button>' : ''}
  </div>
  <p class="hint">Faste retter (f.eks. taco på fredag) settes under Mer → Innstillinger → Faste middager.</p>`;
}

export function bindMeals(root, rerender) {
  root.querySelector('[data-what-cook]')?.addEventListener('click', () => suggestModal(Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))));
  root.querySelectorAll('[data-mweek]').forEach((b) => (b.onclick = () => ((weekStart = addDays(weekStart, 7 * Number(b.dataset.mweek))), rerender())));
  root.querySelectorAll('[data-meal]').forEach((b) => (b.onclick = () => mealModal(b.dataset.meal)));
  root.querySelectorAll('[data-suggest]').forEach((b) => {
    b.onclick = () => openAssistant(`Foreslå middag til ${fmtWeekday(b.dataset.suggest).toLowerCase()} ${fmtShort(b.dataset.suggest)}`, true);
  });
  root.querySelectorAll('[data-shop-meal]').forEach((b) => {
    b.onclick = () => {
      addShoppingItems((mealOn(b.dataset.shopMeal)?.ingredients || []).map((name) => ({ name })));
      toast('🛒 Lagt i handlelista', 'ok');
    };
  });
  root.querySelector('[data-shop-week]')?.addEventListener('click', () => {
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).filter((d) => d >= today());
    addShoppingItems(days.flatMap((d) => mealOn(d)?.ingredients || []).map((name) => ({ name })));
    toast('🛒 Ukas ingredienser er lagt i handlelista', 'ok');
  });
}

export function mealModal(date) {
  const m = mealOn(date) || { dish: fixedMealOn(date), emoji: '🍽️', ingredients: [] };
  let emoji = m.emoji || '🍽️';
  openModal(
    `<form class="form" novalidate>
      <h2 class="modal-title">🍽️ Middag ${esc(fmtWeekday(date).toLowerCase())} ${fmtShort(date)}</h2>
      ${state.recipes.length ? `<label class="field"><span>Velg fra oppskriftene</span>
        <select name="recipe"><option value="">—</option>${state.recipes.map((r) => `<option value="${esc(r.id)}" ${m.recipeId === r.id ? 'selected' : ''}>${esc(r.emoji || '')} ${esc(r.name)}</option>`).join('')}</select></label>` : ''}
      <div class="title-row">
        <button type="button" class="emoji-btn big" data-emoji>${esc(emoji)}</button>
        <input name="dish" class="grow" placeholder="Hva blir det til middag?" value="${esc(m.dish || '')}" maxlength="80">
      </div>
      <label class="field"><span>Ingredienser (én per linje, valgfritt)</span>
        <textarea name="ingr" rows="4">${esc((m.ingredients || []).join('\n'))}</textarea></label>
      ${hasAI() && state.wines.some((w) => (w.bottles || 0) > 0) ? '<button type="button" class="btn soft small" data-pair>🍷 Hvilken vin fra kjelleren passer?</button><div class="pair-result"></div>' : ''}
      <div class="modal-actions">
        ${mealOn(date) ? '<button type="button" class="btn danger ghost" data-delete>Fjern</button>' : ''}
        <span class="spacer"></span>
        <button type="button" class="btn ghost" data-close>Avbryt</button>
        <button type="submit" class="btn primary">Lagre</button>
      </div>
    </form>`,
    (root, close) => {
      const form = root.querySelector('form');
      const f = form.elements;
      const eb = root.querySelector('[data-emoji]');
      eb.onclick = () => pickEmoji(FOOD_EMOJIS, emoji, (e) => ((emoji = e), (eb.textContent = e)));
      f.recipe?.addEventListener('change', () => {
        const r = state.recipes.find((x) => x.id === f.recipe.value);
        if (!r) return;
        f.dish.value = r.name;
        f.ingr.value = (r.ingredients || []).join('\n');
        emoji = r.emoji || emoji;
        eb.textContent = emoji;
      });
      form.onsubmit = (e) => {
        e.preventDefault();
        const dish = f.dish.value.trim();
        if (!dish) return toast('Skriv hva det blir til middag.', 'error');
        upsert('meals', {
          id: date, date, dish, emoji,
          recipeId: f.recipe?.value || null,
          ingredients: f.ingr.value.split('\n').map((x) => x.trim()).filter(Boolean),
        });
        close();
      };
      root.querySelector('[data-delete]')?.addEventListener('click', () => (remove('meals', date), close()));
      root.querySelector('[data-pair]')?.addEventListener('click', async (e) => {
        const dish = f.dish.value.trim();
        const out = root.querySelector('.pair-result');
        if (!dish) return toast('Skriv hva det blir til middag først.', 'error');
        e.target.disabled = true;
        out.innerHTML = '<p class="muted thinking">🍷 Sommelieren tenker …</p>';
        try {
          const r = await winePairing(dish, state.wines.filter((w) => (w.bottles || 0) > 0));
          const picks = (r.picks || []).map((p) => ({ ...p, w: state.wines.find((w) => w.id === p.id) })).filter((p) => p.w);
          out.innerHTML = picks.length
            ? `<ul class="pair-list">${picks.map((p) => `<li>${p.w.thumb ? `<img src="${p.w.thumb}" alt="">` : '<span class="pe">🍷</span>'}<span><b>${esc(p.w.producer || '')} ${esc(p.w.name)} ${esc(p.w.vintage || '')}</b><small>${esc(p.why)}</small></span></li>`).join('')}</ul>`
            : `<p class="muted">${esc(r.tip || 'Fant ingen som passer godt i kjelleren.')}</p>`;
        } catch (err) {
          out.innerHTML = `<p class="gate-error">${esc(err.message)}</p>`;
        }
        e.target.disabled = false;
      });
    },
  );
}

// ───────────── Middagsforslag ut fra det vi har ─────────────

export function suggestModal(weekDays = null) {
  const t = today();
  const days = (weekDays || Array.from({ length: 7 }, (_, i) => addDays(t, i))).filter((d) => d >= t);
  const empty = days.filter((d) => !mealOn(d) && !fixedMealOn(d));
  const lists = allLists();
  openModal(
    `<form class="form suggest-form">
      <h2 class="modal-title">✨ Hva kan vi lage?</h2>
      <label class="field"><span>Dette har vi (rett gjerne)</span>
        <textarea name="have" rows="3" placeholder="F.eks. kylling, ris, brokkoli, rømme">${esc(pantryText())}</textarea></label>
      <label class="toggle-line"><input type="checkbox" name="only"> Bruk bare det vi har (+ basisvarer)</label>
      ${empty.length ? `<label class="toggle-line"><input type="checkbox" name="fill" checked> Fyll de ${empty.length} tomme dagene i ukemenyen</label>` : ''}
      <div class="modal-actions"><span class="spacer"></span><button type="button" class="btn ghost" data-close>Lukk</button><button class="btn primary" type="submit">Foreslå ✨</button></div>
      <div class="suggest-result" aria-live="polite"></div>
    </form>`,
    (root, close) => {
      const form = root.querySelector('form');
      const out = root.querySelector('.suggest-result');
      form.onsubmit = async (e) => {
        e.preventDefault();
        const f = form.elements;
        const dates = f.fill?.checked ? empty : [];
        out.innerHTML = '<p class="muted thinking">✨ Kokken tenker …</p>';
        form.querySelector('[type=submit]').disabled = true;
        try {
          const recent = state.meals.filter((m) => m.date >= addDays(t, -14)).map((m) => m.dish).join(', ');
          const fixed = Object.entries(state.household?.fixedMeals || {}).filter(([, v]) => v).map(([k, v]) => `dag ${k}: ${v}`).join(', ');
          const r = await suggestMeals({ have: f.have.value.trim(), onlyHave: f.only.checked, dates, recipes: state.recipes.map((x) => x.name).join(', '), fixed, avoid: recent });
          const sug = (r.suggestions || []).slice(0, 7);
          const dayOpts = (sel) => days.map((d) => `<option value="${d}" ${d === sel ? 'selected' : ''}>${fmtWeekday(d)} ${fmtShort(d)}${mealOn(d) ? ' (har rett)' : ''}</option>`).join('');
          out.innerHTML = sug.length
            ? `<ul class="sugg-list">${sug
                .map((x, i) => `<li class="card sugg">
                  <div class="sugg-head"><span class="sugg-emoji">${esc(x.emoji || '🍽️')}</span><div><b>${esc(x.dish)}</b><small>${esc(x.why || '')}${x.minutes ? ' · ca. ' + esc(x.minutes) + ' min' : ''}</small></div></div>
                  ${x.missing?.length ? `<p class="small-text">🛒 Mangler: ${x.missing.map(esc).join(', ')}</p>` : '<p class="small-text ok-text">✔ Dere har alt</p>'}
                  <details><summary>Ingredienser</summary><ul class="bullets">${(x.ingredients || []).map((g) => `<li>${esc(g)}</li>`).join('')}</ul></details>
                  <div class="sugg-actions">
                    <select data-day="${i}">${dayOpts(x.date && days.includes(x.date) ? x.date : empty[i] || days[0])}</select>
                    ${x.missing?.length ? `<select data-shoplist="${i}">${lists.map((l) => `<option value="${esc(l.id)}">🛒 ${esc(l.name)}</option>`).join('')}<option value="">Ikke handleliste</option></select>` : ''}
                    <button type="button" class="btn primary small" data-use="${i}">Sett på menyen</button>
                  </div>
                </li>`)
                .join('')}</ul>`
            : '<p class="muted">Fikk ingen forslag. Prøv å skrive litt mer om hva dere har.</p>';
          out.querySelectorAll('[data-use]').forEach((b) => {
            b.onclick = () => {
              const i = Number(b.dataset.use);
              const x = sug[i];
              const d = out.querySelector(`[data-day="${i}"]`).value;
              upsert('meals', { id: d, date: d, dish: x.dish, emoji: x.emoji || '🍽️', ingredients: x.ingredients || [], recipeId: null });
              const listId = out.querySelector(`[data-shoplist="${i}"]`)?.value;
              if (listId) (x.missing || []).forEach((m) => addItem(listId, m));
              b.textContent = '✔ Lagt inn';
              b.disabled = true;
              toast(`🍽️ ${x.dish} ${fmtWeekday(d).toLowerCase()}${listId && x.missing?.length ? ' – det som mangler er på handlelista' : ''}`, 'ok');
            };
          });
        } catch (err) {
          out.innerHTML = `<p class="gate-error">${esc(err.message)}</p>`;
        }
        form.querySelector('[type=submit]').disabled = false;
      };
    },
  );
}

// ───────────── Oppskrifter ─────────────

export function renderRecipes() {
  const list = [...state.recipes].sort((a, b) => a.name.localeCompare(b.name, 'nb'));
  return `
  <div class="row-btns" style="margin-bottom:12px">
    <button class="btn primary" data-new-recipe>＋ Ny oppskrift</button>
    ${hasAI() ? '<button class="btn soft" data-paste-recipe>✨ Lim inn oppskrift</button>' : ''}
  </div>
  ${
    list.length
      ? `<ul class="recipe-list">${list
          .map((r) => `<li><button class="recipe-card" data-recipe="${esc(r.id)}"><span class="r-emoji">${esc(r.emoji || '🍲')}</span>
            <span class="pt">${esc(r.name)}<small>${(r.ingredients || []).length} ingredienser</small></span><span class="n-arrow">›</span></button></li>`)
          .join('')}</ul>`
      : emptyState('📖', 'Ingen oppskrifter ennå', 'Legg inn familiens favoritter, så blir det lett å planlegge uka.')
  }`;
}

export function bindRecipes(root) {
  root.querySelector('[data-new-recipe]').onclick = () => recipeEdit({});
  root.querySelector('[data-paste-recipe]')?.addEventListener('click', pasteRecipe);
  root.querySelectorAll('[data-recipe]').forEach((b) => (b.onclick = () => recipeView(state.recipes.find((r) => r.id === b.dataset.recipe))));
}

function recipeView(r) {
  if (!r) return;
  openModal(
    `<h2 class="modal-title">${esc(r.emoji || '🍲')} ${esc(r.name)}</h2>
     ${r.servings ? `<p class="muted">${esc(r.servings)} porsjoner</p>` : ''}
     <h3 class="sub-h">Ingredienser</h3>
     <ul class="bullets">${(r.ingredients || []).map((i) => `<li>${esc(i)}</li>`).join('') || '<li class="muted">–</li>'}</ul>
     ${r.steps ? `<h3 class="sub-h">Slik gjør du</h3><p class="steps">${esc(r.steps)}</p>` : ''}
     <div class="row-btns" style="margin-top:14px">
       <button class="btn soft small" data-shop>🛒 Til handlelista</button>
       <label class="btn soft small plan-btn">📅 Sett på ukemenyen <input type="date" data-plan></label>
     </div>
     <div class="modal-actions">
       <button class="btn danger ghost" data-delete>Slett</button><span class="spacer"></span>
       <button class="btn ghost" data-close>Lukk</button><button class="btn primary" data-edit>Endre</button>
     </div>`,
    (root, close) => {
      root.querySelector('[data-shop]').onclick = () => {
        addShoppingItems((r.ingredients || []).map((name) => ({ name })));
        toast('🛒 Lagt i handlelista', 'ok');
      };
      root.querySelector('[data-plan]').onchange = (e) => {
        const d = e.target.value;
        if (!d) return;
        upsert('meals', { id: d, date: d, dish: r.name, emoji: r.emoji || '🍽️', recipeId: r.id, ingredients: r.ingredients || [] });
        toast(`📅 ${r.name} er satt på ${fmtWeekday(d).toLowerCase()} ${fmtShort(d)}`, 'ok');
        close();
      };
      root.querySelector('[data-edit]').onclick = () => (close(), recipeEdit(r));
      root.querySelector('[data-delete]').onclick = async () => {
        if (await confirmDialog(`Slette oppskriften «${r.name}»?`)) (remove('recipes', r.id), close());
      };
    },
  );
}

function recipeEdit(r) {
  let emoji = r.emoji || '🍲';
  openModal(
    `<form class="form" novalidate>
      <h2 class="modal-title">${r.id ? 'Endre oppskrift' : 'Ny oppskrift'}</h2>
      <div class="title-row">
        <button type="button" class="emoji-btn big" data-emoji>${esc(emoji)}</button>
        <input name="name" class="grow" placeholder="Navn, f.eks. Pasta bolognese" value="${esc(r.name || '')}" maxlength="80">
      </div>
      <label class="field"><span>Porsjoner</span><input name="servings" inputmode="numeric" value="${esc(r.servings || '')}" maxlength="3"></label>
      <label class="field"><span>Ingredienser (én per linje)</span><textarea name="ingr" rows="6">${esc((r.ingredients || []).join('\n'))}</textarea></label>
      <label class="field"><span>Fremgangsmåte</span><textarea name="steps" rows="6">${esc(r.steps || '')}</textarea></label>
      <div class="modal-actions"><span class="spacer"></span>
        <button type="button" class="btn ghost" data-close>Avbryt</button><button type="submit" class="btn primary">Lagre</button></div>
    </form>`,
    (root, close) => {
      const form = root.querySelector('form');
      const f = form.elements;
      const eb = root.querySelector('[data-emoji]');
      eb.onclick = () => pickEmoji(FOOD_EMOJIS, emoji, (e) => ((emoji = e), (eb.textContent = e)));
      form.onsubmit = (e) => {
        e.preventDefault();
        const name = f.name.value.trim();
        if (!name) return toast('Gi oppskriften et navn.', 'error');
        upsert('recipes', {
          ...r, name, emoji,
          servings: f.servings.value.trim() || null,
          ingredients: f.ingr.value.split('\n').map((x) => x.trim()).filter(Boolean),
          steps: f.steps.value.trim(),
        });
        close();
      };
    },
  );
}

function pasteRecipe() {
  openModal(
    `<form class="form">
      <h2 class="modal-title">✨ Lim inn oppskrift</h2>
      <p class="muted">Lim inn teksten fra en nettside, en melding eller skriv den med egne ord. Gemini rydder den til en oppskrift.</p>
      <textarea name="t" rows="8" placeholder="Lim inn her …"></textarea>
      <p class="assist-status"></p>
      <div class="modal-actions"><span class="spacer"></span>
        <button type="button" class="btn ghost" data-close>Avbryt</button><button type="submit" class="btn primary">Gjør om ✨</button></div>
    </form>`,
    (root, close) => {
      const form = root.querySelector('form');
      form.onsubmit = async (e) => {
        e.preventDefault();
        const t = form.elements.t.value.trim();
        if (!t) return;
        const st = root.querySelector('.assist-status');
        st.textContent = '✨ Leser oppskriften …';
        form.querySelector('[type=submit]').disabled = true;
        try {
          const r = await structureRecipe(t);
          close();
          recipeEdit({ name: r.name, emoji: r.emoji, servings: r.servings, ingredients: r.ingredients || [], steps: r.steps || '' });
        } catch (err) {
          st.textContent = err.message;
          form.querySelector('[type=submit]').disabled = false;
        }
      };
    },
  );
}
