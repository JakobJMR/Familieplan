// Vær (Yr/MET) og strømpris (hvakosterstrommen.no) på dashbordet.

import { state, notify } from '../store.js';
import { esc, today, addDays, pad } from '../util.js';

const SYMBOLS = {
  clearsky: '☀️', fair: '🌤️', partlycloudy: '⛅', cloudy: '☁️', fog: '🌫️',
  lightrain: '🌦️', rain: '🌧️', heavyrain: '🌧️', lightrainshowers: '🌦️', rainshowers: '🌦️', heavyrainshowers: '🌧️',
  lightsleet: '🌨️', sleet: '🌨️', heavysleet: '🌨️', lightsleetshowers: '🌨️', sleetshowers: '🌨️', heavysleetshowers: '🌨️',
  lightsnow: '🌨️', snow: '❄️', heavysnow: '❄️', lightsnowshowers: '🌨️', snowshowers: '🌨️', heavysnowshowers: '❄️',
};
function symbolEmoji(code) {
  if (!code) return '🌡️';
  if (code.includes('thunder')) return '⛈️';
  const [base, time] = code.split('_');
  if (time === 'night' && (base === 'clearsky' || base === 'fair')) return '🌙';
  return SYMBOLS[base] || '🌡️';
}

// Hentes direkte fra nettleseren (åpne API-er, ingen nøkkel). Mellomlagres på enheten.
function cacheGet(key, maxAge) {
  try {
    const c = JSON.parse(localStorage.getItem(key) || 'null');
    if (c && (maxAge == null || Date.now() - c.t < maxAge)) return c.v;
  } catch {
    /* ignorer */
  }
  return undefined;
}
function cacheSet(key, v) {
  try {
    localStorage.setItem(key, JSON.stringify({ t: Date.now(), v }));
  } catch {
    /* ignorer */
  }
}

async function fetchWeather(lat, lon) {
  const la = Number(lat).toFixed(4), lo = Number(lon).toFixed(4);
  const key = `fd.w.${la},${lo}`;
  const hit = cacheGet(key, 30 * 60e3);
  if (hit) return hit;
  // MET/Yr: enkel GET uten egne headere – nettleseren identifiserer siden med Origin-headeren.
  const res = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${la}&lon=${lo}`);
  if (!res.ok) throw new Error('vær ' + res.status);
  const json = await res.json();
  const hours = (json?.properties?.timeseries || []).slice(0, 24).map((t) => ({
    time: t.time,
    temp: t.data?.instant?.details?.air_temperature ?? null,
    wind: t.data?.instant?.details?.wind_speed ?? null,
    symbol: t.data?.next_1_hours?.summary?.symbol_code || t.data?.next_6_hours?.summary?.symbol_code || null,
    precip: t.data?.next_1_hours?.details?.precipitation_amount ?? null,
  }));
  const v = { hours };
  cacheSet(key, v);
  return v;
}

async function fetchPower(dateStr, area) {
  const key = `fd.p.${dateStr}_${area}`;
  const hit = cacheGet(key, null);
  if (hit) return hit;
  const [y, m, d] = dateStr.split('-');
  const res = await fetch(`https://www.hvakosterstrommen.no/api/v1/prices/${y}/${m}-${d}_${area}.json`);
  if (res.status === 404) return null; // morgendagens priser er ikke publisert ennå
  if (!res.ok) throw new Error('strøm ' + res.status);
  const raw = await res.json();
  const vat = area === 'NO4' ? 1 : 1.25; // API-et er uten mva; Nord-Norge er fritatt
  const v = {
    area, date: dateStr, vatIncluded: vat !== 1,
    prices: (Array.isArray(raw) ? raw : []).map((p) => ({ start: p.time_start, end: p.time_end, ore: Math.round(p.NOK_per_kWh * vat * 1000) / 10 })),
  };
  if (v.prices.length) cacheSet(key, v);
  return v;
}

const loading = { weather: false, power: false };
const fresh = { weather: 0, power: 0 };

export function refreshWidgets(force = false) {
  const h = state.household;
  if (h?.location?.lat != null && !loading.weather && (force || Date.now() - fresh.weather > 15 * 60e3)) {
    loading.weather = true;
    fetchWeather(h.location.lat, h.location.lon)
      .then((w) => {
        state.weather = { ...w, place: h.location.name || '' };
        fresh.weather = Date.now();
      })
      .catch(() => (state.weather = state.weather || { error: true }))
      .finally(() => ((loading.weather = false), notify()));
  }
  if (h?.priceArea && !loading.power && (force || Date.now() - fresh.power > 20 * 60e3 || state.power.date !== today())) {
    loading.power = true;
    const t = today();
    const wantTomorrow = new Date().getHours() >= 13;
    Promise.all([fetchPower(t, h.priceArea), wantTomorrow ? fetchPower(addDays(t, 1), h.priceArea).catch(() => null) : null])
      .then(([a, b]) => {
        state.power = { date: t, today: a, tomorrow: b };
        fresh.power = Date.now();
      })
      .catch(() => (state.power = { ...state.power, error: true }))
      .finally(() => ((loading.power = false), notify()));
  }
}

export function weatherCard() {
  const h = state.household;
  if (h?.location?.lat == null) return '';
  const w = state.weather;
  if (!w) return `<article class="card widget weather"><p class="muted">Henter vær …</p></article>`;
  if (w.error || !w.hours?.length) return `<article class="card widget weather"><p class="muted">🌡️ Været er ikke tilgjengelig akkurat nå.</p></article>`;
  const now = w.hours[0];
  const next = w.hours.slice(1, 13).filter((_, i) => i % 2 === 1);
  const rain6 = w.hours.slice(0, 6).reduce((s, x) => s + (x.precip || 0), 0);
  return `<article class="card widget weather">
    <div class="widget-head"><span>Været${w.place ? ' · ' + esc(w.place) : ''}</span><a class="src" href="https://www.yr.no" target="_blank" rel="noopener">Yr</a></div>
    <div class="weather-now">
      <span class="w-emoji">${symbolEmoji(now.symbol)}</span>
      <span class="w-temp">${Math.round(now.temp)}°</span>
      <span class="w-meta">${rain6 > 0.1 ? `☔ ${rain6.toFixed(1).replace('.', ',')} mm neste 6 t` : 'Opphold neste 6 t'}<br>💨 ${Math.round(now.wind ?? 0)} m/s</span>
    </div>
    <div class="w-hours">${next
      .map((x) => {
        const d = new Date(x.time);
        return `<div><span>${pad(d.getHours())}</span><span>${symbolEmoji(x.symbol)}</span><b>${Math.round(x.temp)}°</b></div>`;
      })
      .join('')}</div>
  </article>`;
}

/** Slår sammen 15-minutters priser til timessnitt. */
function hourly(prices) {
  const byHour = new Map();
  for (const p of prices) {
    const hr = new Date(p.start).getHours();
    if (!byHour.has(hr)) byHour.set(hr, []);
    byHour.get(hr).push(p.ore);
  }
  return [...byHour.entries()].map(([h, arr]) => ({ h, ore: arr.reduce((a, b) => a + b, 0) / arr.length })).sort((a, b) => a.h - b.h);
}
const ore = (n) => `${n.toFixed(0)} øre`;
const span = (h) => `${pad(h)}–${pad((h + 1) % 24)}`;

export function powerCard() {
  const h = state.household;
  if (!h?.priceArea) return '';
  const p = state.power;
  if (p.error && !p.today) return `<article class="card widget power"><p class="muted">⚡ Strømprisen er ikke tilgjengelig akkurat nå.</p></article>`;
  if (!p.today) return `<article class="card widget power"><p class="muted">Henter strømpris …</p></article>`;
  const now = new Date();
  const cur = p.today.prices.find((x) => new Date(x.start) <= now && now < new Date(x.end));
  const hours = hourly(p.today.prices);
  const avg = hours.reduce((s, x) => s + x.ore, 0) / hours.length;
  const max = Math.max(...hours.map((x) => x.ore), 1);
  const min = Math.min(...hours.map((x) => x.ore));
  const nowH = now.getHours();
  const rest = hours.filter((x) => x.h >= nowH);
  const cheapest = rest.reduce((a, b) => (b.ore < a.ore ? b : a), rest[0] || hours[0]);
  const priciest = hours.reduce((a, b) => (b.ore > a.ore ? b : a), hours[0]);
  const level = !cur ? '' : cur.ore < avg * 0.85 ? 'low' : cur.ore > avg * 1.15 ? 'high' : 'mid';
  const levelText = { low: 'Billig nå', mid: 'Normalt nå', high: 'Dyrt nå' }[level] || '';

  let tomorrow = '';
  if (p.tomorrow?.prices?.length) {
    const th = hourly(p.tomorrow.prices);
    const tavg = th.reduce((s, x) => s + x.ore, 0) / th.length;
    const tc = th.reduce((a, b) => (b.ore < a.ore ? b : a), th[0]);
    tomorrow = `<p class="p-tomorrow">I morgen: snitt ${ore(tavg)} · billigst kl. ${span(tc.h)} (${ore(tc.ore)})</p>`;
  }

  return `<article class="card widget power">
    <div class="widget-head"><span>Strøm · ${esc(h.priceArea)}</span><a class="src" href="https://www.hvakosterstrommen.no" target="_blank" rel="noopener">hvakosterstrommen.no</a></div>
    <div class="power-now">
      <span class="p-price">${cur ? cur.ore.toFixed(0) : '–'}<small> øre/kWh</small></span>
      ${levelText ? `<span class="p-level ${level}">${levelText}</span>` : ''}
    </div>
    <div class="p-bars" aria-hidden="true">${hours
      .map((x) => `<span class="${x.h === nowH ? 'now' : ''} ${x.ore <= min + (avg - min) * 0.3 ? 'cheap' : ''}" style="height:${Math.max(6, (x.ore / max) * 100)}%"></span>`)
      .join('')}</div>
    <div class="p-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
    <p class="p-facts">Billigst resten av dagen: <b>kl. ${span(cheapest.h)}</b> (${ore(cheapest.ore)}) · Dyrest: kl. ${span(priciest.h)}</p>
    ${tomorrow}
    <p class="hint">Spotpris${p.today.vatIncluded ? ' inkl. mva' : ' (uten mva i Nord-Norge)'}, uten nettleie og strømstøtte.</p>
  </article>`;
}
