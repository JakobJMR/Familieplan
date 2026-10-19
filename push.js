// Kveldsvarsel: standard Web Push (VAPID) – ikke Firebase Cloud Messaging.
// Abonnementet lagres i Firestore under «pushsubs», én rad per enhet, så den
// planlagte jobben vet hvor den skal sende. Tømmingen av døde abonnement skjer
// i jobben, ikke her.
//
// Hver enhet må skru dette på for seg: et abonnement hører til nettleseren,
// ikke til kontoen.

import { backend } from './backend.js';
import { state } from './store.js';
import { vapidPublicKey } from './config.js';

const DEVICE_KEY = 'fd.deviceId';

/** Stabil id per enhet, slik at ny påmelding erstatter den gamle raden. */
function deviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = 'd' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    // Privat nettleservindu uten lagring: bruk en id som varer økten ut
    return 'd-okt-' + Math.random().toString(36).slice(2, 10);
  }
}

/** iOS sender bare varsler til apper som ligger på hjemskjermen. */
export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

export const pushConfigured = () => !!vapidPublicKey;

/**
 * 'ikke-stottet' | 'krever-hjemskjerm' | 'ikke-satt-opp' | 'nektet' | 'av' | 'pa'
 */
export async function pushState() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return isIOS() && !isStandalone() ? 'krever-hjemskjerm' : 'ikke-stottet';
  }
  if (isIOS() && !isStandalone()) return 'krever-hjemskjerm';
  if (!pushConfigured()) return 'ikke-satt-opp';
  if (Notification.permission === 'denied') return 'nektet';
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    return sub ? 'pa' : 'av';
  } catch {
    return 'av';
  }
}

/** base64url → Uint8Array, som PushManager krever */
function urlBase64ToUint8Array(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function label() {
  const ua = navigator.userAgent;
  if (/iphone/i.test(ua)) return 'iPhone';
  if (/ipad/i.test(ua)) return 'iPad';
  if (/android/i.test(ua)) return /mobile/i.test(ua) ? 'Android-telefon' : 'Android-nettbrett';
  if (/mac/i.test(ua)) return 'Mac';
  if (/windows/i.test(ua)) return 'Windows-PC';
  return 'Enhet';
}

/** Ber om tillatelse, melder på, og lagrer abonnementet. Kaster med norsk tekst. */
export async function enablePush() {
  if (!pushConfigured()) throw new Error('Varsler er ikke satt opp ennå – nøkkelen mangler i config.js.');
  if (isIOS() && !isStandalone())
    throw new Error('På iPhone og iPad må appen først legges til på hjemskjermen. Åpne den derfra og prøv igjen.');

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Du sa nei til varsler. Du kan endre det i nettleserinnstillingene for denne siden.');

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
  }

  const j = sub.toJSON();
  await backend.put('pushsubs', {
    id: deviceId(),
    endpoint: j.endpoint,
    p256dh: j.keys?.p256dh || '',
    auth: j.keys?.auth || '',
    email: state.user?.email || '',
    label: label(),
    updatedAt: new Date().toISOString(),
  });
  return true;
}

/** Melder av og fjerner raden, slik at jobben slutter å sende hit. */
export async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  } catch {
    /* abonnementet var alt borte */
  }
  await backend.del('pushsubs', deviceId()).catch(() => {});
  return true;
}
