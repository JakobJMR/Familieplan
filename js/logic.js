// Domenelogikk: helligdager, dagtype, ukeplaner, gjentakende hendelser, søppel og varsler.

import { addDays, diffDays, parseISO, today, weekday, iso, pad } from './util.js';

// ---------- Norske helligdager ----------

function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${y}-${pad(month)}-${pad(day)}`;
}

const holidayCache = new Map();
export function publicHolidays(y) {
  if (holidayCache.has(y)) return holidayCache.get(y);
  const e = easter(y);
  const map = new Map([
    [`${y}-01-01`, 'Første nyttårsdag'],
    [addDays(e, -3), 'Skjærtorsdag'],
    [addDays(e, -2), 'Langfredag'],
    [e, 'Første påskedag'],
    [addDays(e, 1), 'Andre påskedag'],
    [`${y}-05-01`, 'Arbeidernes dag'],
    [`${y}-05-17`, 'Grunnlovsdagen'],
    [addDays(e, 39), 'Kristi himmelfartsdag'],
    [addDays(e, 49), 'Første pinsedag'],
    [addDays(e, 50), 'Andre pinsedag'],
    [`${y}-12-25`, 'Første juledag'],
    [`${y}-12-26`, 'Andre juledag'],
  ]);
  holidayCache.set(y, map);
  return map;
}
export const publicHoliday = (s) => publicHolidays(Number(s.slice(0, 4))).get(s) || null;

// ---------- Dagtype ----------

export function holidayPeriod(s, household) {
  return (household?.holidays || []).find((h) => h.from <= s && s <= h.to) || null;
}

/** { kind: 'ferie'|'helligdag'|'helg'|'hverdag', label, emoji } */
export function dayType(s, household) {
  const ferie = holidayPeriod(s, household);
  if (ferie) return { kind: 'ferie', label: ferie.label || 'Ferie', emoji: '🏖️' };
  const hd = publicHoliday(s);
  if (hd) return { kind: 'helligdag', label: hd, emoji: '🇳🇴' };
  if (weekday(s) >= 6) return { kind: 'helg', label: 'Helg', emoji: '☕' };
  return { kind: 'hverdag', label: 'Vanlig hverdag', emoji: '📋' };
}

// ---------- Ukeplaner ----------

export function schedulesOn(s, household, memberId = null) {
  const t = dayType(s, household);
  if (t.kind === 'ferie' || t.kind === 'helligdag') return [];
  const wd = weekday(s);
  return (household?.schedules || [])
    .filter((x) => x.days.includes(wd) && (!memberId || x.memberId === memberId))
    .sort(byTime);
}

// ---------- Hendelser ----------

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export function occursOn(ev, s) {
  if (!ev.date || s < ev.date) return ev.date === s;
  if (ev.repeat === 'weekly') return diffDays(ev.date, s) % 7 === 0;
  if (ev.repeat === 'yearly') {
    const md = ev.date.slice(5);
    if (md === '02-29' && !isLeap(Number(s.slice(0, 4)))) return s.slice(5) === '02-28';
    return s.slice(5) === md;
  }
  return ev.date === s;
}

export const involves = (item, memberId) => !memberId || !item.members?.length || item.members.includes(memberId);

export function byTime(a, b) {
  return (a.start || '00:00').localeCompare(b.start || '00:00');
}

export function eventsOn(s, events, memberId = null) {
  return events.filter((e) => occursOn(e, s) && involves(e, memberId)).sort(byTime);
}

export function eventsBetween(from, to, events, memberId = null) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    for (const e of eventsOn(d, events, memberId)) out.push({ ...e, on: d });
  }
  return out;
}

/** Hvor mange år (f.eks. bursdag) – kun for årlige hendelser med startår i fortiden */
export function yearsSince(ev, s) {
  if (ev.repeat !== 'yearly' || !ev.date) return null;
  const n = Number(s.slice(0, 4)) - Number(ev.date.slice(0, 4));
  return n > 0 ? n : null;
}

// ---------- Oppgaver ----------

export function taskBuckets(tasks, memberId = null) {
  const t = today();
  const open = tasks.filter((x) => !x.done && involves(x, memberId));
  return {
    open,
    overdue: open.filter((x) => x.due && x.due < t),
    today: open.filter((x) => x.due === t),
    later: open.filter((x) => !x.due || x.due > t),
  };
}

export function sortTasks(list) {
  return [...list].sort((a, b) => {
    if (a.due && b.due) return a.due.localeCompare(b.due);
    if (a.due) return -1;
    if (b.due) return 1;
    return (a.createdAt || '').localeCompare(b.createdAt || '');
  });
}

// ---------- Søppel ----------

export function garbageOn(g, s) {
  if (!g.refDate) return false;
  const n = 7 * (g.intervalWeeks || 1);
  const d = diffDays(g.refDate, s);
  return ((d % n) + n) % n === 0;
}

export function nextGarbage(g, from = today()) {
  const n = 7 * (g.intervalWeeks || 1);
  for (let i = 0; i <= n; i++) {
    const d = addDays(from, i);
    if (garbageOn(g, d)) return d;
  }
  return null;
}

export function garbageOnDay(s, household) {
  return (household?.garbage || []).filter((g) => garbageOn(g, s));
}

// ---------- Varsler til dashbordet ----------

export function notifications(state, memberId = null) {
  const { household, events, tasks } = state;
  const t = today();
  const out = [];

  // Søppel
  for (const g of household?.garbage || []) {
    const next = nextGarbage(g, t);
    if (!next) continue;
    const d = diffDays(t, next);
    if (d === 0) out.push({ icon: g.emoji, kind: 'warn', text: `${g.name} tømmes i dag` });
    else if (d === 1) out.push({ icon: g.emoji, kind: 'warn', text: `${g.name} tømmes i morgen – sett ut dunken i kveld` });
    else if (d <= 6) out.push({ icon: g.emoji, kind: 'info', text: `${g.name} tømmes ${d === 2 ? 'i overmorgen' : 'på ' + weekdayName(next)}` });
  }

  // Hendelser
  const todays = eventsOn(t, events, memberId);
  if (todays.length) {
    out.push({
      icon: '📅',
      kind: 'info',
      text: `${todays.length} ${todays.length === 1 ? 'hendelse' : 'hendelser'} i dag`,
      detail: todays.map((e) => `${e.start ? e.start + ' ' : ''}${e.title}`).join(' · '),
      go: 'kalender',
    });
  }
  const week = eventsBetween(addDays(t, 1), addDays(t, 7), events, memberId);
  if (week.length) {
    out.push({
      icon: '🗓️',
      kind: 'info',
      text: `${week.length} ${week.length === 1 ? 'hendelse' : 'hendelser'} de neste 7 dagene`,
      detail: week.slice(0, 3).map((e) => `${weekdayName(e.on, true)}: ${e.title}`).join(' · ') + (week.length > 3 ? ' …' : ''),
      go: 'kalender',
    });
  }

  // Oppgaver
  const b = taskBuckets(tasks, memberId);
  if (b.overdue.length)
    out.push({ icon: '⚠️', kind: 'alert', text: `${b.overdue.length} ${b.overdue.length === 1 ? 'oppgave' : 'oppgaver'} har gått over fristen`, go: 'oppgaver' });
  if (b.today.length)
    out.push({ icon: '✅', kind: 'warn', text: `${b.today.length} ${b.today.length === 1 ? 'oppgave' : 'oppgaver'} skal gjøres i dag`, go: 'oppgaver' });
  const rest = b.open.length - b.overdue.length - b.today.length;
  if (rest > 0) out.push({ icon: '📝', kind: 'info', text: `${rest} andre åpne ${rest === 1 ? 'oppgave' : 'oppgaver'}`, go: 'oppgaver' });

  // Ferie som nærmer seg
  const upcoming = (household?.holidays || []).filter((h) => h.from > t).sort((a, b) => a.from.localeCompare(b.from))[0];
  if (upcoming) {
    const d = diffDays(t, upcoming.from);
    if (d <= 14) out.push({ icon: '🏖️', kind: 'ok', text: `${upcoming.label} starter om ${d} ${d === 1 ? 'dag' : 'dager'}` });
  }

  return out;
}

function weekdayName(s, short = false) {
  return new Intl.DateTimeFormat('nb-NO', { weekday: short ? 'short' : 'long' }).format(parseISO(s)).replace('.', '');
}

export { iso };
