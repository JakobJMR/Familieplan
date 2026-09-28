// «Mer»-siden: inngang til økonomi, forsikring og innstillinger.

import { esc } from '../util.js';
import { state } from '../store.js';
import { isDemo } from '../backend.js';
import { hasAI } from '../ai.js';
import { kr, monthly, insuranceMonthly } from '../finance.js';

export function renderMore() {
  const costM = state.costs.reduce((s, c) => s + monthly(c), 0) + state.insurance.reduce((s, p) => s + insuranceMonthly(p), 0);
  const tiles = [
    ['okonomi', '💰', 'Økonomi', costM ? `${kr(costM)} i faste kostnader per måned` : 'Faste kostnader og forfall'],
    ['forsikring', '🛡️', 'Forsikring', state.insurance.length ? `${state.insurance.length} forsikringer` : 'Last opp forsikringsbevis'],
    ['hus', '🏠', 'Huset', state.things.length ? `${state.rooms.length} rom · ${state.things.length} ting og bokser` : 'Rom, bokser og «hvor er …?»'],
    ['produkter', '🧾', 'Produkter og garantier', state.products.length ? `${state.products.length} produkter` : 'Kvitteringer, garanti og bruksanvisninger'],
    ['vin', '🍷', 'Vinkjeller', state.wines.length ? `${state.wines.reduce((s, w) => s + (w.bottles || 0), 0)} flasker` : 'Ta bilde av etiketten'],
    ['innstillinger', '⚙️', 'Innstillinger', 'Familie, ukeplaner, søppel, AI og kode'],
  ];
  return `
  <header class="view-head"><h1>☰ Mer</h1></header>
  ${isDemo ? '<div class="banner demo">🧪 <b>Demo-modus</b> – data lagres bare på denne enheten.</div>' : ''}
  ${!hasAI() ? '<a class="banner ai-banner" href="#/innstillinger">✨ <span><b>Slå på AI-assistenten</b> – gratis med en Gemini-nøkkel. Tolker forsikringer, foreslår middag og forstår «legg inn bursdag til Nils».</span></a>' : ''}
  <ul class="more-tiles">${tiles
    .map(([k, e, t, s]) => `<li><a class="more-tile card" href="#/${k}"><span class="mt-emoji">${e}</span><span class="pt">${t}<small>${esc(s)}</small></span><span class="n-arrow">›</span></a></li>`)
    .join('')}</ul>`;
}
