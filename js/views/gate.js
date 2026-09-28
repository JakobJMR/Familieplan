// Skjermene før appen: Google-innlogging, PIN-lås, ingen tilgang, feil.

import { esc } from '../util.js';
import { backend, isDemo } from '../backend.js';
import { checkPin, setPin } from '../pin.js';

const shell = (inner) => `<main class="gate"><div class="gate-card">${inner}</div></main>`;

const GOOGLE_SVG = `<svg viewBox="0 0 48 48" width="22" height="22" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;

export function renderLogin(app, error = '') {
  app.innerHTML = shell(`
    <div class="gate-emoji">🏡</div>
    <h1>Familiens dashbord</h1>
    <p class="muted">${isDemo ? 'Demo-modus: data lagres bare på denne enheten. Fyll ut <b>js/config.js</b> for å dele med familien.' : 'Logg inn med Google-kontoen din. Bare kontoer familien har lagt til slipper inn.'}</p>
    ${error ? `<p class="gate-error" role="alert">${esc(error)}</p>` : ''}
    <button class="btn google" id="google">${isDemo ? '▶️ Prøv demoen' : `${GOOGLE_SVG} Fortsett med Google`}</button>`);
  const btn = app.querySelector('#google');
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      await backend.signIn();
    } catch (e) {
      renderLogin(app, e.message || 'Innloggingen feilet.');
    } finally {
      btn.disabled = false;
    }
  };
}

/** PIN-lås. onOk kalles når riktig kode er tastet. */
export function renderPin(app, onOk, onSignOut) {
  let pin = '';
  let busy = false;
  const draw = (error = '') => {
    app.innerHTML = shell(`
      <div class="gate-emoji">🔒</div>
      <h1>Familiekode</h1>
      <div class="pin-dots ${error ? 'shake' : ''}" aria-live="polite">
        ${Array.from({ length: Math.max(4, pin.length) }, (_, i) => `<span class="${i < pin.length ? 'on' : ''}"></span>`).join('')}
      </div>
      <p class="pin-error" role="alert">${esc(error)}</p>
      <div class="pinpad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button class="pin-key" data-k="${n}">${n}</button>`).join('')}
        <button class="pin-key muted" data-k="del" aria-label="Slett">⌫</button>
        <button class="pin-key" data-k="0">0</button>
        <button class="pin-key go" data-k="ok" aria-label="OK">→</button>
      </div>
      <button class="btn ghost small" id="forgot">Glemt koden?</button>`);
    app.querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => press(b.dataset.k)));
    app.querySelector('#forgot').onclick = () => forgot();
  };
  const press = (k) => {
    if (busy) return;
    if (k === 'del') pin = pin.slice(0, -1);
    else if (k === 'ok') return submit();
    else if (pin.length < 8) pin += k;
    draw();
    if (pin.length >= 4) autoTry();
  };
  let tryTimer;
  const autoTry = () => {
    clearTimeout(tryTimer);
    tryTimer = setTimeout(async () => {
      if (await checkPin(pin)) done();
    }, 150);
  };
  const done = () => {
    document.removeEventListener('keydown', onKey);
    onOk();
  };
  const submit = async () => {
    if (pin.length < 4) return draw('Koden har minst 4 siffer');
    busy = true;
    const ok = await checkPin(pin);
    busy = false;
    if (ok) return done();
    pin = '';
    await new Promise((r) => setTimeout(r, 600));
    draw('Feil kode – prøv igjen');
  };
  const forgot = () => {
    app.innerHTML = shell(`
      <div class="gate-emoji">🔑</div>
      <h1>Glemt koden?</h1>
      <p class="muted">Bekreft at det er deg med Google, så kan du velge en ny kode (eller fjerne den).</p>
      <button class="btn primary" id="reauth">Bekreft med Google</button>
      <button class="btn ghost" id="back">Tilbake</button>
      <button class="btn ghost small" id="out">Logg ut</button>`);
    app.querySelector('#back').onclick = () => draw();
    app.querySelector('#out').onclick = onSignOut;
    app.querySelector('#reauth').onclick = async () => {
      try {
        await backend.reauth();
        const p = prompt('Ny familiekode (4–8 siffer). La stå tom for å fjerne koden:') ?? null;
        if (p === null) return draw();
        if (p && !/^\d{4,8}$/.test(p)) return alert('Koden må være 4–8 siffer.');
        await setPin(p);
        done();
      } catch (e) {
        alert(e.message || 'Bekreftelsen feilet.');
      }
    };
  };
  const onKey = (e) => {
    if (!document.querySelector('.pinpad')) return;
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('del');
    else if (e.key === 'Enter') press('ok');
  };
  document.addEventListener('keydown', onKey);
  draw();
}

export function renderNoAccess(app, email, onSignOut) {
  app.innerHTML = shell(`
    <div class="gate-emoji">🔒</div>
    <h1>Ingen tilgang</h1>
    <p class="gate-error">${esc(email)} har ikke tilgang til familiens dashbord.</p>
    <p class="muted">Den som administrerer appen må legge til e-postadressen i sikkerhetsreglene i Firebase (se README).</p>
    <button class="btn primary" id="out">Logg inn med en annen konto</button>`);
  app.querySelector('#out').onclick = onSignOut;
}

export function renderError(app, message, onRetry) {
  app.innerHTML = shell(`
    <div class="gate-emoji">📡</div>
    <h1>Får ikke kontakt</h1>
    <p class="muted">${esc(message)}</p>
    <button class="btn primary" id="retry">Prøv igjen</button>`);
  app.querySelector('#retry').onclick = onRetry;
}

export function renderLoading(app, text = 'Henter familiens dag …') {
  app.innerHTML = shell(`<div class="gate-emoji spin">🏡</div><p class="muted">${esc(text)}</p>`);
}
