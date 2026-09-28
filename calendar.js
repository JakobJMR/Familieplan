// Kalender: ukevisning med hendelser, frister, søppel og faste aktiviteter.

import { esc, today, addDays, startOfWeek, weekNumber, fmtShort, fmtWeekday, openModal, confirmDialog, toast } from '../util.js';
import { state, upsert, remove } from '../store.js';
import { dayType, schedulesOn, eventsOn, garbageOnDay, involves, yearsSince } from '../logic.js';
import { memberFilter, whoBadges, memberPicker, pickedMembers, pickEmoji } from '../components.js';
import { EVENT_EMOJIS } from '../emoji.js';
import { toggleTask } from './tasks.js';

let weekStart = startOfWeek(today());
let showSchedules = false;

export function renderCalendar() {
  const t = today();
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const end = days[6];
  const isThisWeek = weekStart === startOfWeek(t);

  return `
  <header class="view-head">
    <h1>📅 Kalender</h1>
    <button class="btn primary" data-new-event>＋ Ny</button>
  </header>
  ${memberFilter()}
  <div class="week-nav">
    <button class="icon-btn" data-week="-1" aria-label="Forrige uke">‹</button>
    <div class="week-label"><b>Uke ${weekNumber(weekStart)}</b><span>${fmtShort(weekStart)} – ${fmtShort(end)}</span></div>
    <button class="icon-btn" data-week="1" aria-label="Neste uke">›</button>
    ${isThisWeek ? '' : '<button class="btn ghost small" data-week="0">I dag</button>'}
  </div>
  <label class="toggle-line"><input type="checkbox" data-toggle-sched ${showSchedules ? 'checked' : ''}> Vis faste aktiviteter (jobb, skole …)</label>
  <div class="week">
    ${days.map((d) => dayBlock(d, t)).join('')}
  </div>`;
}

function dayBlock(d, t) {
  const h = state.household;
  const dt = dayType(d, h);
  const evs = eventsOn(d, state.events, state.filter);
  const tasks = state.tasks.filter((x) => x.due === d && involves(x, state.filter));
  const garbage = garbageOnDay(d, h);
  const scheds = showSchedules ? schedulesOn(d, h).filter((s) => !state.filter || s.memberId === state.filter) : [];
  const members = h?.members || [];
  const empty = !evs.length && !tasks.length && !garbage.length && !scheds.length;

  return `<section class="cal-day ${d === t ? 'is-today' : ''} ${d < t ? 'past' : ''} dt-${dt.kind}">
    <header class="day-head">
      <div><b>${fmtWeekday(d)}</b> <span class="muted">${fmtShort(d)}</span>
        ${dt.kind === 'ferie' || dt.kind === 'helligdag' ? `<span class="tag">${dt.emoji} ${esc(dt.label)}</span>` : ''}
        ${d === t ? '<span class="tag today">I dag</span>' : ''}
      </div>
      <button class="icon-btn add" data-new-event="${d}" aria-label="Ny hendelse ${fmtShort(d)}">＋</button>
    </header>
    ${empty ? '' : '<ul class="day-items">'}
      ${garbage.map((g) => `<li class="garbage"><span class="pe">${esc(g.emoji)}</span><span class="pt">${esc(g.name)} tømmes</span></li>`).join('')}
      ${evs
        .map((e) => {
          const yrs = yearsSince(e, d);
          return `<li class="event" data-event="${esc(e.id)}">
            <span class="pe">${esc(e.emoji)}</span>
            <span class="pt">${esc(e.title)}${yrs ? ` <small>(${yrs} år)</small>` : ''}${e.note ? `<small class="note">${esc(e.note)}</small>` : ''}</span>
            ${e.start ? `<span class="time">${esc(e.start)}${e.end ? '–' + esc(e.end) : ''}</span>` : ''}
            <span class="whos">${whoBadges(e.members)}</span>
          </li>`;
        })
        .join('')}
      ${tasks
        .map(
          (x) => `<li class="task ${x.done ? 'done' : ''}">
          <button class="check ${x.done ? 'on' : ''}" data-task="${esc(x.id)}" aria-label="Marker som gjort"></button>
          <span class="pt">${esc(x.title)}</span><span class="time">frist</span><span class="whos">${whoBadges(x.members)}</span></li>`,
        )
        .join('')}
      ${scheds
        .map((s) => {
          const m = members.find((x) => x.id === s.memberId);
          return `<li class="sched"><span class="pe">${esc(s.emoji)}</span><span class="pt">${esc(m?.name || '')}: ${esc(s.label)}</span>${s.start ? `<span class="time">${esc(s.start)}${s.end ? '–' + esc(s.end) : ''}</span>` : ''}</li>`;
        })
        .join('')}
    ${empty ? '' : '</ul>'}
  </section>`;
}

export function bindCalendar(root, rerender) {
  root.querySelectorAll('[data-week]').forEach((b) => {
    b.onclick = () => {
      const n = Number(b.dataset.week);
      weekStart = n === 0 ? startOfWeek(today()) : addDays(weekStart, 7 * n);
      rerender();
    };
  });
  root.querySelector('[data-toggle-sched]').onchange = (e) => {
    showSchedules = e.target.checked;
    rerender();
  };
  root.querySelectorAll('[data-new-event]').forEach((b) => (b.onclick = () => eventModal({ date: b.dataset.newEvent || today() })));
  root.querySelectorAll('[data-event]').forEach((el) => {
    el.onclick = () => {
      const ev = state.events.find((x) => x.id === el.dataset.event);
      if (ev) eventModal(ev);
    };
  });
  root.querySelectorAll('[data-task]').forEach((el) => (el.onclick = () => toggleTask(el.dataset.task)));
}

/** Skjema for ny/redigert hendelse */
export function eventModal(ev = {}) {
  const editing = !!ev.id;
  let emoji = ev.emoji || '📅';
  const allDay = editing ? !ev.start : false;
  const preselect = ev.members || (state.filter && !editing ? [state.filter] : []);

  openModal(
    `<form class="form" novalidate>
      <h2 class="modal-title">${editing ? 'Endre hendelse' : 'Ny hendelse'}</h2>
      <div class="title-row">
        <button type="button" class="emoji-btn big" data-emoji>${esc(emoji)}</button>
        <input name="title" class="grow" placeholder="Hva skjer? F.eks. Tannlege" value="${esc(ev.title || '')}" maxlength="100" required>
      </div>
      <div class="row2">
        <label class="field"><span>Dato</span><input type="date" name="date" value="${esc(ev.date || today())}" required></label>
        <label class="field"><span>Gjentas</span>
          <select name="repeat">
            <option value="none" ${ev.repeat === 'none' || !ev.repeat ? 'selected' : ''}>Nei</option>
            <option value="weekly" ${ev.repeat === 'weekly' ? 'selected' : ''}>Hver uke</option>
            <option value="yearly" ${ev.repeat === 'yearly' ? 'selected' : ''}>Hvert år (bursdag o.l.)</option>
          </select></label>
      </div>
      <label class="toggle-line"><input type="checkbox" name="allday" ${allDay ? 'checked' : ''}> Hele dagen</label>
      <div class="row2 times" ${allDay ? 'hidden' : ''}>
        <label class="field"><span>Fra</span><input type="time" name="start" value="${esc(ev.start || '')}"></label>
        <label class="field"><span>Til (valgfritt)</span><input type="time" name="end" value="${esc(ev.end || '')}"></label>
      </div>
      <fieldset class="field"><legend>Hvem gjelder det?</legend>${memberPicker(preselect)}</fieldset>
      <label class="field"><span>Notat (valgfritt)</span><textarea name="note" rows="2" maxlength="500">${esc(ev.note || '')}</textarea></label>
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
      emojiBtn.onclick = () => pickEmoji(EVENT_EMOJIS, emoji, (e) => ((emoji = e), (emojiBtn.textContent = e)));
      f.allday.onchange = () => (root.querySelector('.times').hidden = f.allday.checked);
      f.title.addEventListener('input', () => {
        // Foreslå emoji ut fra tittelen hvis brukeren ikke har valgt selv
        if (editing || emoji !== '📅') return;
        const t = f.title.value.toLowerCase();
        const guess = /bursdag|fødsels/.test(t) ? '🎂' : /tannleg/.test(t) ? '🦷' : /lege|helsestasjon/.test(t) ? '🩺' : /fly|reise|ferie/.test(t) ? '✈️' : /fotball|trening|kamp/.test(t) ? '⚽' : /foreldremøte|skole/.test(t) ? '🏫' : /middag|bursdagsfest|fest/.test(t) ? '🎉' : null;
        if (guess) emojiBtn.textContent = guess;
      });
      form.onsubmit = async (e) => {
        e.preventDefault();
        const title = f.title.value.trim();
        if (!title) return toast('Skriv hva som skjer.', 'error');
        if (!f.date.value) return toast('Velg en dato.', 'error');
        const allday = f.allday.checked;
        const item = {
          ...(editing ? { id: ev.id } : {}),
          title,
          emoji: emojiBtn.textContent.trim() || emoji,
          date: f.date.value,
          start: allday ? null : f.start.value || null,
          end: allday ? null : f.end.value || null,
          repeat: f.repeat.value,
          members: pickedMembers(form),
          note: f.note.value.trim(),
        };
        if (item.start && item.end && item.end < item.start) return toast('Til-tid kan ikke være før fra-tid.', 'error');
        close();
        upsert('events', item);
      };
      root.querySelector('[data-delete]')?.addEventListener('click', async () => {
        const repeat = ev.repeat && ev.repeat !== 'none' ? ' (alle gjentakelser)' : '';
        if (await confirmDialog(`Slette «${ev.title}»${repeat}?`)) {
          close();
          remove('events', ev.id);
        }
      });
    },
  );
}
