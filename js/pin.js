// Familie-PIN: en lås som spørres når appen åpnes (etter Google-innlogging).
// Bare en saltet hash lagres i familiens database – aldri selve koden.

import { state, saveSecrets } from './store.js';

const LOCK_AFTER_MS = 5 * 60 * 1000; // lås igjen etter 5 min i bakgrunnen

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const hasPin = () => !!state.secrets?.pinHash;

export async function checkPin(pin) {
  const s = state.secrets || {};
  if (!s.pinHash) return true;
  return (await sha256(`${s.pinSalt}:${pin}`)) === s.pinHash;
}

export async function setPin(pin) {
  if (!pin) return saveSecrets({ pinHash: null, pinSalt: null });
  const salt = crypto.getRandomValues(new Uint32Array(4)).join('-');
  await saveSecrets({ pinSalt: salt, pinHash: await sha256(`${salt}:${pin}`) });
}

// --- Låsestatus for denne fanen ---
let unlocked = false;
let hiddenAt = 0;
try {
  unlocked = sessionStorage.getItem('fd.unlocked') === '1';
} catch {
  /* ignorer */
}
export const isUnlocked = () => unlocked || !hasPin();
export function markUnlocked() {
  unlocked = true;
  try {
    sessionStorage.setItem('fd.unlocked', '1');
  } catch {
    /* ignorer */
  }
}
export function lock() {
  unlocked = false;
  try {
    sessionStorage.removeItem('fd.unlocked');
  } catch {
    /* ignorer */
  }
}
/** Kaller onLock() hvis appen har vært i bakgrunnen lenge nok */
export function watchBackground(onLock) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > LOCK_AFTER_MS && hasPin()) {
      lock();
      onLock();
    }
  });
}
