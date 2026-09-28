// Bilder og QR-koder: krymping, miniatyrer, lese QR fra bilde, lage QR-etiketter.

let extras = null;
const loadExtras = async () => (extras ||= await import('./vendor/extras.js'));

function loadImage(fileOrBlob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(fileOrBlob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Kunne ikke lese bildet.'));
    };
    img.src = url;
  });
}

function drawScaled(img, max) {
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return c;
}

/** Krymper et bilde til maks `max` piksler (JPEG). Returnerer File. */
export async function compressImage(file, max = 1400, quality = 0.75) {
  const img = await loadImage(file);
  const c = drawScaled(img, max);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', quality));
  return new File([blob], (file.name || 'bilde').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
}

/** Liten miniatyr som data-URL (lagres rett i dokumentet, ca. 5–15 kB). */
export async function thumbnail(file, max = 200) {
  const img = await loadImage(file);
  return drawScaled(img, max).toDataURL('image/jpeg', 0.7);
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('Kunne ikke lese fila.'));
    r.readAsDataURL(blob);
  });
}

/** Leser en QR-kode fra et bilde (foto av koden). Returnerer teksten eller null. */
export async function readQR(file) {
  const img = await loadImage(file);
  // Native (Android/Chrome) først – raskt
  if ('BarcodeDetector' in window) {
    try {
      const det = new window.BarcodeDetector({ formats: ['qr_code'] });
      const r = await det.detect(img);
      if (r[0]?.rawValue) return r[0].rawValue;
    } catch {
      /* fall tilbake */
    }
  }
  const { jsQR } = await loadExtras();
  for (const max of [1000, 1600, 600]) {
    const c = drawScaled(img, max);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    const code = jsQR(d.data, d.width, d.height, { inversionAttempts: 'attemptBoth' });
    if (code?.data) return code.data;
  }
  return null;
}

/** SVG-markup for en QR-kode */
export async function qrSVG(text, cell = 4) {
  const { qrcode } = await loadExtras();
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: cell, margin: 2, scalable: true });
}

/** Knapp-HTML for å ta/velge bilde. accept styrer filtype. */
export const pickerInput = (attrs = '', accept = 'image/*') => `<input type="file" accept="${accept}" hidden ${attrs}>`;
