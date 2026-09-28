// «Mat»-fanen: handleliste, ukemeny og oppskrifter.

import { renderShopping, bindShopping } from './shopping.js';
import { renderMeals, bindMeals, renderRecipes, bindRecipes, suggestModal } from './meals.js';
import { renderPantry, bindPantry } from './pantry.js';

let seg = 'handleliste';
try {
  seg = sessionStorage.getItem('fd.foodseg') || seg;
} catch {
  /* ignorer */
}

const SEGS = [
  ['handleliste', '🛒 Handleliste'],
  ['ukemeny', '🍽️ Ukemeny'],
  ['hjemme', '🏠 Hjemme'],
  ['oppskrifter', '📖 Oppskrifter'],
];

export function renderFood() {
  return `
  <header class="view-head"><h1>🍽️ Mat</h1></header>
  <div class="segments" role="tablist">
    ${SEGS.map(([k, l]) => `<button role="tab" class="seg ${seg === k ? 'on' : ''}" data-seg="${k}" aria-selected="${seg === k}">${l}</button>`).join('')}
  </div>
  <div data-seg-body>${seg === 'handleliste' ? renderShopping() : seg === 'ukemeny' ? renderMeals() : seg === 'hjemme' ? renderPantry() : renderRecipes()}</div>`;
}

export function bindFood(root, rerender) {
  root.querySelectorAll('[data-seg]').forEach((b) => {
    b.onclick = () => {
      seg = b.dataset.seg;
      try {
        sessionStorage.setItem('fd.foodseg', seg);
      } catch {
        /* ignorer */
      }
      rerender();
    };
  });
  if (seg === 'handleliste') bindShopping(root, rerender);
  else if (seg === 'ukemeny') bindMeals(root, rerender);
  else if (seg === 'hjemme') bindPantry(root, () => suggestModal());
  else bindRecipes(root, rerender);
}

export function setFoodSegment(s) {
  seg = s;
}
