// Økonomi, forsikring og kjørelengde – ren beregningslogikk.

import { today, addDays, diffDays, parseISO, iso } from './util.js';

export const FREQS = {
  week: { label: 'hver uke', perYear: 52, months: null, days: 7 },
  month: { label: 'hver måned', perYear: 12, months: 1 },
  quarter: { label: 'hvert kvartal', perYear: 4, months: 3 },
  half: { label: 'hvert halvår', perYear: 2, months: 6 },
  year: { label: 'hvert år', perYear: 1, months: 12 },
};

export const CATEGORIES = [
  ['bolig', '🏠', 'Bolig og lån'], ['strom', '⚡', 'Strøm og energi'], ['forsikring', '🛡️', 'Forsikring'],
  ['barn', '🧸', 'Barn og barnehage'], ['bil', '🚗', 'Bil og transport'], ['abonnement', '📺', 'Abonnementer'],
  ['mat', '🛒', 'Mat og husholdning'], ['annet', '💳', 'Annet'],
];
export const catInfo = (id) => CATEGORIES.find((c) => c[0] === id) || CATEGORIES[CATEGORIES.length - 1];

export const kr = (n) =>
  n == null || !Number.isFinite(Number(n)) ? '–' : `${Math.round(Number(n)).toLocaleString('nb-NO')} kr`;

function addMonths(s, n) {
  const d = parseISO(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return iso(d);
}

/** Beløpet som gjelder på en gitt dato (tar hensyn til registrert prisendring) */
export function amountOn(cost, date = today()) {
  if (cost.changeDate && cost.changeAmount != null && date >= cost.changeDate) return Number(cost.changeAmount);
  return Number(cost.amount) || 0;
}

export function monthly(cost, date = today()) {
  const f = FREQS[cost.frequency] || FREQS.month;
  return (amountOn(cost, date) * f.perYear) / 12;
}

/** Alle forfall for en kostnad mellom from og to (inkl.) */
export function occurrences(cost, from, to) {
  if (!cost.nextDue) return [];
  const f = FREQS[cost.frequency] || FREQS.month;
  const out = [];
  let d = cost.nextDue;
  let guard = 0;
  // Spol fram til from (hvis nextDue ligger i fortiden)
  while (d < from && guard++ < 1000) d = f.days ? addDays(d, f.days) : addMonths(d, f.months);
  while (d <= to && guard++ < 1200) {
    out.push(d);
    d = f.days ? addDays(d, f.days) : addMonths(d, f.months);
  }
  return out;
}

export function upcomingPayments(costs, days = 30) {
  const t = today();
  const end = addDays(t, days);
  return costs
    .flatMap((c) => occurrences(c, t, end).map((date) => ({ cost: c, date, amount: amountOn(c, date) })))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function insuranceMonthly(p) {
  if (p.pricePerMonth) return Number(p.pricePerMonth);
  if (p.pricePerYear) return Number(p.pricePerYear) / 12;
  return 0;
}

export function priceChangeAlerts(costs) {
  const t = today();
  return costs
    .filter((c) => c.changeDate && c.changeAmount != null)
    .map((c) => ({ c, d: diffDays(t, c.changeDate), diff: Number(c.changeAmount) - Number(c.amount) }))
    .filter((x) => x.d >= -7 && x.d <= 60 && x.diff !== 0);
}

// ─────────── Forsikring ───────────

export const INS_TYPES = {
  bil: '🚗', hus: '🏠', innbo: '🛋️', reise: '🧳', liv: '❤️', ulykke: '🩹', 'uføre': '♿', helse: '⚕️', barn: '🧸', dyr: '🐶', 'båt': '⛵', annet: '🛡️',
};
export const insEmoji = (type) => INS_TYPES[type] || '🛡️';

/** Neste fornyelsesdato (rulles fram år for år) */
export function nextRenewal(p) {
  if (!p.renewalDate) return null;
  let d = p.renewalDate;
  const t = today();
  let guard = 0;
  while (d < t && guard++ < 50) d = addMonths(d, 12);
  return d;
}

// ─────────── Kjørelengde ───────────

/**
 * Beregner kjørelengde for en bilforsikring.
 * policy.mileage = { annualKm, periodStart (YYYY-MM-DD), startOdometer }
 * logs = [{date, odometer}] for denne polisen
 */
export function mileageStatus(policy, logs) {
  const m = policy.mileage;
  if (!m?.annualKm || !m.periodStart) return null;
  const t = today();
  let start = m.periodStart;
  let guard = 0;
  while (start > t && guard++ < 50) start = addMonths(start, -12); // oppgitt dato er neste fornyelse → året startet ett år før
  while (addMonths(start, 12) <= t && guard++ < 100) start = addMonths(start, 12);
  const periodEnd = addMonths(start, 12);
  const rolled = start > m.periodStart; // ny periode har startet – trenger ny startstand
  const inPeriod = logs.filter((l) => l.date >= start).sort((a, b) => a.date.localeCompare(b.date) || a.odometer - b.odometer);
  const before = logs.filter((l) => l.date < start).sort((a, b) => b.date.localeCompare(a.date))[0];
  const startOdo = rolled ? (before?.odometer ?? null) : m.startOdometer == null ? null : Number(m.startOdometer);
  if (startOdo == null) return { needsNewStart: true, periodStart: start, periodEnd, annualKm: m.annualKm };
  const latest = inPeriod[inPeriod.length - 1];
  const driven = latest ? Math.max(0, latest.odometer - startOdo) : 0;
  const remaining = m.annualKm - driven;
  // Tempo regnes fra datoen startstanden gjelder (periodestart, eller dagen den ble logget)
  const fromDate = !rolled && m.startDate && m.startDate > start ? m.startDate : start;
  const elapsed = latest ? diffDays(fromDate, latest.date) : 0;
  const daysLeft = diffDays(t, periodEnd);
  const projected = latest && elapsed >= 14 ? Math.round(driven + (driven / elapsed) * diffDays(latest.date, periodEnd)) : null;
  return {
    annualKm: m.annualKm, driven, remaining, projected, periodStart: start, periodEnd, daysLeft,
    lastLog: latest || null, pct: Math.min(100, Math.round((driven / m.annualKm) * 100)),
    overPace: projected != null && projected > m.annualKm,
    stale: !latest || diffDays(latest.date, t) > 35,
  };
}
