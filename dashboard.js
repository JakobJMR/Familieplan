// Forsiden: dagens dato og dagtype, vær/strøm, varsler og dagens plan per familiemedlem.

import { esc, today, fmtLong, weekNumber, nowHM, addDays, relDay } from '../util.js';
import { state, member } from '../store.js';
import { dayType, schedulesOn, eventsOn, notifications, taskBuckets, garbageOnDay } from '../logic.js';
import { memberFilter, whoBadges } from '../components.js';
import { weatherCard, powerCard } from './widgets.js';
import { eventModal } from './calendar.js';
import { toggleTask } from './tasks.js';
import { insuranceNotices } from './insurance.js';
import { mealOn, fixedMealOn, mealModal } from './meals.js';
import { upcomingPayments, priceChangeAlerts, kr } from '../finance.js';
import { hasAI } from '../ai.js';
import { productNotices } from './products.js';
import { wineNotices } from './wine.js';
import { allLists, openCount, itemsIn } from '../shoplists.js';

function extraNotices() {
  const out = [];
  const pays = upcomingPayments(state.costs, 7);
  if (pays.length) {
    const sum = pays.reduce((s, p) => s + p.amount, 0);
    out.push({ icon: '💳', kind: 'info', text: `${pays.length} ${pays.length === 1 ? 'regning' : 'regninger'} forfaller innen 7 dager (${kr(sum)})`,
      detail: pays.slice(0, 3).map((p) => `${relDay(p.date)}: ${p.cost.name}`).join(' · '), go: 'okonomi' });
  }
  for (const { c, d, diff } of priceChangeAlerts(state.costs)) {
    if (d < 0 || d > 30) continue;
    out.push({ icon: diff > 0 ? '📈' : '📉', kind: diff > 0 ? 'warn' : 'ok', text: `${c.name} ${diff > 0 ? 'øker' : 'går ned'} med ${kr(Math.abs(diff))} fra ${relDay(c.changeDate)}`, go: 'okonomi' });
  }
  return [...insuranceNotices(), ...productNotices(), ...out, ...wineNotices()];
}

function dinnerCard(t) {
  const m = mealOn(t);
  const fixed = fixedMealOn(t);
  return `<article class="card dinner" data-dinner>
    <h2 class="card-title">🍽️ Middag i dag</h2>
    ${m ? `<p class="dinner-dish"><span>${esc(m.emoji || '🍽️')}</span> ${esc(m.dish)}</p>`
      : fixed ? `<p class="dinner-dish"><span>📌</span> ${esc(fixed)}</p>`
      : `<p class="muted">Ikke planlagt ennå. ${hasAI() ? 'Trykk for å velge, eller spør ✨ assistenten.' : 'Trykk for å velge.'}</p>`}
  </article>`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'God natt';
  if (h < 10) return 'God morgen';
  if (h < 17) return 'God dag';
  return 'God kveld';
}

function timeLabel(x) {
  if (!x.start) return '';
  return `<span class="time">${esc(x.start)}${x.end ? '–' + esc(x.end) : ''}</span>`;
}

function isNow(x) {
  if (!x.start || !x.end) return false;
  const n = nowHM();
  return x.start <= n && n < x.end;
}

function memberDay(m, t, dt, withFamily = false) {
  // withFamily: ved filtrering på én person tas også hendelser for hele familien med
  const mine = (x) => x.members?.includes(m.id) || (withFamily && !x.members?.length);
  const scheds = schedulesOn(t, state.household, m.id);
  const evs = eventsOn(t, state.events.filter(mine));
  const tasks = taskBuckets(state.tasks).open.filter((x) => mine(x) && x.due && x.due <= t);
  const items = [
    ...scheds.map((s) => ({ ...s, kind: 'sched', title: s.label })),
    ...evs.map((e) => ({ ...e, kind: 'event' })),
  ].sort((a, b) => (a.start || '00:00').localeCompare(b.start || '00:00'));

  let body;
  if (!items.length && !tasks.length) {
    body = `<p class="free">${dt.kind === 'ferie' || dt.kind === 'helligdag' ? 'Fri i dag 😎' : dt.kind === 'helg' ? 'Ingen planer – helg! 🛋️' : 'Ingenting fast i dag'}</p>`;
  } else {
    body = `<ul class="plan">
      ${items
        .map(
          (x) => `<li class="${x.kind} ${isNow(x) ? 'now' : ''}" ${x.kind === 'event' ? `data-event="${esc(x.id)}"` : ''}>
            <span class="pe">${esc(x.emoji)}</span><span class="pt">${esc(x.title)}</span>${timeLabel(x)}
          </li>`,
        )
        .join('')}
      ${tasks
        .map(
          (x) => `<li class="task ${x.due < t ? 'late' : ''}"><button class="check" data-task="${esc(x.id)}" aria-label="Marker som gjort"></button>
            <span class="pt">${esc(x.title)}</span>${x.due < t ? '<span class="time">forfalt</span>' : ''}</li>`,
        )
        .join('')}
    </ul>`;
  }
  return `<article class="card person">
    <header><span class="avatar">${esc(m.emoji)}</span><h3>${esc(m.name)}</h3></header>
    ${body}
  </article>`;
}

function familyEvents(t) {
  const evs = eventsOn(t, state.events.filter((e) => !e.members?.length));
  const garbage = garbageOnDay(t, state.household);
  const garbageTomorrow = garbageOnDay(addDays(t, 1), state.household);
  if (!evs.length && !garbage.length && !garbageTomorrow.length) return '';
  return `<article class="card person family">
    <header><span class="avatar">👪</span><h3>Hele familien</h3></header>
    <ul class="plan">
      ${garbage.map((g) => `<li class="garbage"><span class="pe">${esc(g.emoji)}</span><span class="pt">${esc(g.name)} tømmes i dag</span></li>`).join('')}
      ${garbageTomorrow.map((g) => `<li class="garbage"><span class="pe">${esc(g.emoji)}</span><span class="pt">Sett ut ${esc(g.name.toLowerCase())} i kveld</span></li>`).join('')}
      ${evs.map((e) => `<li class="event ${isNow(e) ? 'now' : ''}" data-event="${esc(e.id)}"><span class="pe">${esc(e.emoji)}</span><span class="pt">${esc(e.title)}</span>${timeLabel(e)}</li>`).join('')}
    </ul>
  </article>`;
}

function notifCard() {
  const list = [...notifications(state, state.filter), ...(state.filter ? [] : extraNotices())];
  return `<article class="card notif">
    <h2 class="card-title">🔔 Varsler</h2>
    ${
      list.length
        ? `<ul class="notif-list">${list
            .map(
              (n) => `<li class="n-${n.kind}" ${n.go ? `data-go="${n.go}"` : ''}>
              <span class="n-icon">${esc(n.icon)}</span>
              <span class="n-text">${esc(n.text)}${n.detail ? `<small>${esc(n.detail)}</small>` : ''}</span>
              ${n.go ? '<span class="n-arrow">›</span>' : ''}
            </li>`,
            )
            .join('')}</ul>`
        : '<p class="muted">Alt er i rute. Ingen varsler 🎉</p>'
    }
  </article>`;
}

function shoppingMini() {
  const lists = allLists().filter((l) => openCount(l.id) > 0);
  return `<article class="card shop-mini" data-go="mat">
    <h2 class="card-title">🛒 Handlelister</h2>
    ${lists.length
      ? lists.map((l) => {
          const open = itemsIn(l.id).filter((x) => !x.done);
          return `<p class="shop-line"><b>${esc(l.emoji || '🛒')} ${esc(l.name)}</b> <span class="muted">(${open.length})</span><br><span class="shop-emojis-inline">${open.slice(0, 12).map((x) => `<span title="${esc(x.name)}">${esc(x.emoji)}</span>`).join('')}</span> <small class="muted">${esc(open.slice(0, 4).map((x) => x.name).join(', '))}${open.length > 4 ? ' …' : ''}</small></p>`;
        }).join('')
      : '<p class="muted">Alle lister er tomme. Trykk for å legge til.</p>'}
  </article>`;
}

function upcomingCard() {
  const t = today();
  const rows = [];
  for (let i = 1; i <= 3; i++) {
    const d = addDays(t, i);
    const evs = eventsOn(d, state.events, state.filter);
    const dt = dayType(d, state.household);
    const g = garbageOnDay(d, state.household);
    if (!evs.length && !g.length && (dt.kind === 'hverdag' || dt.kind === 'helg')) continue;
    rows.push(`<li><b>${esc(relDay(d))}</b>
      ${dt.kind === 'ferie' || dt.kind === 'helligdag' ? `<span class="tag">${dt.emoji} ${esc(dt.label)}</span>` : ''}
      ${g.map((x) => `<span class="tag">${esc(x.emoji)} ${esc(x.name)}</span>`).join('')}
      ${evs.map((e) => `<span class="tag ev" data-event="${esc(e.id)}">${esc(e.emoji)} ${e.start ? esc(e.start) + ' ' : ''}${esc(e.title)} ${whoBadges(e.members)}</span>`).join('')}
    </li>`);
  }
  if (!rows.length) return '';
  return `<article class="card upcoming"><h2 class="card-title">⏭️ De neste dagene</h2><ul class="up-list">${rows.join('')}</ul></article>`;
}

export function renderDashboard() {
  const t = today();
  const h = state.household;
  const dt = dayType(t, h);
  const members = (h?.members || []).filter((m) => !state.filter || m.id === state.filter);
  const who = state.filter ? member(state.filter) : null;

  const banner =
    dt.kind === 'ferie'
      ? `<div class="banner ferie">🏖️ <b>${esc(dt.label)}</b> – alle har fri! Faste ukeplaner er satt på pause.</div>`
      : dt.kind === 'helligdag'
        ? `<div class="banner helligdag">🇳🇴 <b>${esc(dt.label)}</b> – rød dag, faste planer er satt på pause.</div>`
        : '';

  return `
  <header class="dash-head">
    <div>
      <p class="greet">${greeting()}${who ? ', ' + esc(who.name) : ''}!</p>
      <h1>${fmtLong(t)}</h1>
      <p class="sub">Uke ${weekNumber(t)} · ${dt.emoji} ${esc(dt.label)}</p>
    </div>
  </header>
  ${memberFilter()}
  ${banner}
  <div class="dash-grid">
    <div class="col-main">
      <h2 class="section-title">${who ? `${esc(who.emoji)} ${esc(who.name)} i dag` : 'I dag'}</h2>
      <div class="people">
        ${state.filter ? '' : familyEvents(t)}
        ${members.map((m) => memberDay(m, t, dt, !!state.filter)).join('')}
      </div>
      ${upcomingCard()}
    </div>
    <div class="col-side">
      ${notifCard()}
      <div class="widgets">${weatherCard()}${powerCard()}</div>
      ${dinnerCard(t)}
      ${shoppingMini()}
    </div>
  </div>`;
}

export function bindDashboard(root, go) {
  root.querySelector('[data-dinner]')?.addEventListener('click', () => mealModal(today()));
  root.querySelectorAll('[data-go]').forEach((el) => (el.onclick = () => go(el.dataset.go)));
  root.querySelectorAll('[data-event]').forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation();
      const ev = state.events.find((x) => x.id === el.dataset.event);
      if (ev) eventModal(ev);
    };
  });
  root.querySelectorAll('[data-task]').forEach((el) => (el.onclick = () => toggleTask(el.dataset.task)));
}
