// Økonomi: faste kostnader, månedstotal, neste 30 dager og prisendringer.

import { esc, today, fmtShort, relDay, diffDays, fmtWeekday, openModal, confirmDialog, toast } from '../util.js';

const when = (d) => (diffDays(today(), d) <= 6 ? relDay(d) : fmtWeekday(d).toLowerCase());
import { state, upsert, remove } from '../store.js';
import { emptyState, pickEmoji } from '../components.js';
import { FREQS, CATEGORIES, catInfo, kr, monthly, amountOn, upcomingPayments, insuranceMonthly, priceChangeAlerts, insEmoji } from '../finance.js';

const COST_EMOJIS = ['🏠', '⚡', '💧', '🛡️', '🧸', '🚗', '⛽', '📺', '📱', '🌐', '🎵', '🏋️', '🐶', '💳', '🏦', '🧾'];

export function renderEconomy() {
  const costs = state.costs;
  const ins = state.insurance.filter((p) => insuranceMonthly(p) > 0);
  const insTotal = ins.reduce((s, p) => s + insuranceMonthly(p), 0);
  const costTotal = costs.reduce((s, c) => s + monthly(c), 0);
  const total = costTotal + insTotal;

  const byCat = {};
  for (const c of costs) byCat[c.category || 'annet'] = (byCat[c.category || 'annet'] || 0) + monthly(c);
  if (insTotal) byCat.forsikring = (byCat.forsikring || 0) + insTotal;
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...cats.map((c) => c[1]));

  const next = upcomingPayments(costs, 30);
  const next30 = next.reduce((s, p) => s + p.amount, 0);
  const changes = priceChangeAlerts(costs);

  return `
  <header class="view-head"><div><a href="#/mer" class="back-link">‹ Mer</a><h1>💰 Økonomi</h1></div>
    <button class="btn primary" data-new-cost>＋ Ny</button></header>

  <div class="stat-row">
    <div class="card stat"><span class="stat-label">Faste kostnader per måned</span><span class="stat-num">${kr(total)}</span><span class="stat-sub">${kr(total * 12)} per år</span></div>
    <div class="card stat"><span class="stat-label">Forfaller neste 30 dager</span><span class="stat-num">${kr(next30)}</span><span class="stat-sub">${next.length} ${next.length === 1 ? 'betaling' : 'betalinger'}</span></div>
  </div>

  ${changes.length ? `<div class="card notif" style="margin-top:14px"><h2 class="card-title">📈 Prisendringer</h2><ul class="notif-list">
    ${changes.map(({ c, d, diff }) => `<li class="${diff > 0 ? 'n-warn' : 'n-ok'}"><span class="n-icon">${diff > 0 ? '📈' : '📉'}</span>
      <span class="n-text">${esc(c.name)} ${diff > 0 ? 'øker' : 'går ned'} med ${kr(Math.abs(diff))} ${d >= 0 ? 'fra ' + esc(relDay(c.changeDate)) : '(endret ' + fmtShort(c.changeDate) + ')'}
      <small>${kr(c.amount)} → ${kr(c.changeAmount)} ${FREQS[c.frequency]?.label || ''}</small></span></li>`).join('')}
  </ul></div>` : ''}

  ${cats.length ? `<section class="card" style="margin-top:14px"><h2 class="card-title">Per kategori (per måned)</h2>
    <ul class="cat-bars">${cats.map(([id, v]) => {
      const [, e, n] = catInfo(id);
      return `<li><span class="cb-label">${e} ${esc(n)}</span><span class="cb-bar"><span style="width:${(v / max) * 100}%"></span></span><span class="cb-val">${kr(v)}</span></li>`;
    }).join('')}</ul></section>` : ''}

  <h2 class="section-title">🗓️ Neste 30 dager</h2>
  ${next.length ? `<ul class="pay-list">${next.map((p) => `<li><span class="pe">${esc(p.cost.emoji || catInfo(p.cost.category)[1])}</span>
    <span class="pt">${esc(p.cost.name)}<small>${esc(when(p.date))} · ${fmtShort(p.date)}</small></span><b>${kr(p.amount)}</b></li>`).join('')}</ul>`
    : '<p class="muted">Ingen registrerte forfall de neste 30 dagene. Legg inn «neste forfall» på kostnadene for å se dem her.</p>'}

  <h2 class="section-title">📋 Alle faste kostnader <span class="count">${costs.length}</span></h2>
  ${costs.length ? `<ul class="cost-list">${[...costs].sort((a, b) => monthly(b) - monthly(a)).map((c) => `<li><button class="cost-row" data-cost="${esc(c.id)}">
    <span class="pe">${esc(c.emoji || catInfo(c.category)[1])}</span>
    <span class="pt">${esc(c.name)}<small>${kr(amountOn(c))} ${FREQS[c.frequency]?.label || ''}${c.nextDue ? ' · neste ' + fmtShort(c.nextDue) : ''}</small></span>
    <b>${kr(monthly(c))}<small>/mnd</small></b></button></li>`).join('')}</ul>`
    : emptyState('💰', 'Ingen faste kostnader ennå', 'Legg inn boliglån, strøm, barnehage, abonnementer osv.')}

  ${ins.length ? `<h2 class="section-title">🛡️ Forsikringer <span class="count">${ins.length}</span></h2>
    <ul class="cost-list">${ins.map((p) => `<li><a class="cost-row" href="#/forsikring"><span class="pe">${insEmoji(p.type)}</span>
      <span class="pt">${esc(p.name)}<small>fra forsikringsoversikten</small></span><b>${kr(insuranceMonthly(p))}<small>/mnd</small></b></a></li>`).join('')}</ul>` : ''}
  <p class="hint">Ingen bankkobling – alt legges inn for hånd og blir værende i familiens egen database.</p>`;
}

export function bindEconomy(root) {
  root.querySelector('[data-new-cost]').onclick = () => costModal({});
  root.querySelectorAll('[data-cost]').forEach((b) => (b.onclick = () => costModal(state.costs.find((c) => c.id === b.dataset.cost))));
}

function costModal(c = {}) {
  const editing = !!c.id;
  let emoji = c.emoji || '💳';
  openModal(
    `<form class="form" novalidate>
      <h2 class="modal-title">${editing ? 'Endre kostnad' : 'Ny fast kostnad'}</h2>
      <div class="title-row">
        <button type="button" class="emoji-btn big" data-emoji>${esc(emoji)}</button>
        <input name="name" class="grow" placeholder="F.eks. Boliglån, Strøm, Netflix" value="${esc(c.name || '')}" maxlength="60">
      </div>
      <div class="row2">
        <label class="field"><span>Beløp (kr)</span><input name="amount" inputmode="decimal" value="${esc(c.amount ?? '')}"></label>
        <label class="field"><span>Hvor ofte</span><select name="frequency">${Object.entries(FREQS).map(([k, f]) => `<option value="${k}" ${(c.frequency || 'month') === k ? 'selected' : ''}>${f.label}</option>`).join('')}</select></label>
      </div>
      <div class="row2">
        <label class="field"><span>Kategori</span><select name="category">${CATEGORIES.map(([k, e, n]) => `<option value="${k}" ${(c.category || 'annet') === k ? 'selected' : ''}>${e} ${n}</option>`).join('')}</select></label>
        <label class="field"><span>Neste forfall (valgfritt)</span><input type="date" name="nextDue" value="${esc(c.nextDue || '')}"></label>
      </div>
      <details class="price-change" ${c.changeDate ? 'open' : ''}><summary>📈 Kjent prisendring?</summary>
        <div class="row2">
          <label class="field"><span>Nytt beløp</span><input name="changeAmount" inputmode="decimal" value="${esc(c.changeAmount ?? '')}"></label>
          <label class="field"><span>Fra dato</span><input type="date" name="changeDate" value="${esc(c.changeDate || '')}"></label>
        </div>
      </details>
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
      const eb = root.querySelector('[data-emoji]');
      eb.onclick = () => pickEmoji(COST_EMOJIS, emoji, (e) => ((emoji = e), (eb.textContent = e)));
      f.category.onchange = () => {
        if (!editing && emoji === '💳') (emoji = catInfo(f.category.value)[1]), (eb.textContent = emoji);
      };
      const num = (v) => {
        const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
        return v === '' || !Number.isFinite(n) ? null : n;
      };
      form.onsubmit = (e) => {
        e.preventDefault();
        const name = f.name.value.trim();
        const amount = num(f.amount.value);
        if (!name) return toast('Gi kostnaden et navn.', 'error');
        if (amount == null) return toast('Skriv inn et beløp.', 'error');
        const changeAmount = num(f.changeAmount.value);
        upsert('costs', {
          ...c, name, emoji, amount, frequency: f.frequency.value, category: f.category.value,
          nextDue: f.nextDue.value || null,
          changeAmount: changeAmount ?? null, changeDate: changeAmount != null && f.changeDate.value ? f.changeDate.value : null,
        });
        close();
      };
      root.querySelector('[data-delete]')?.addEventListener('click', async () => {
        if (await confirmDialog(`Slette «${c.name}»?`)) (remove('costs', c.id), close());
      });
    },
  );
}

