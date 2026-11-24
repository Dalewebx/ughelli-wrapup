import './styles/base.css';
import './styles/door.css';
import jsQR from 'jsqr';
import { api, esc, fmtDate, Kind, KIND_LABEL, store } from './lib/common';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

type Stats = { tickets: number; people: number; inTickets: number; inPeople: number };

let pin = store.get('ugh_door_pin') || '';
let usher = store.get('ugh_door_usher') || '';
let stream: MediaStream | null = null;
let busy = false;
let lastCode = '';
let lastAt = 0;
let detector: any = null;
let autoClose = 0;

const ICON_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m7.5 12.5 3 3 6-6.5"/></svg>';
const ICON_NO = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="m8.5 8.5 7 7M15.5 8.5l-7 7"/></svg>';
const ICON_WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 20h20Z"/><path d="M12 10v4M12 17.5v.5"/></svg>';

function setStats(s?: Stats) {
  if (!s) return;
  $('d-count').textContent = `${s.inPeople} of ${s.people} people in`;
  $('d-tcount').textContent = `${s.inTickets} of ${s.tickets} tickets scanned`;
}

function buzz(ok: boolean) {
  try {
    navigator.vibrate?.(ok ? 120 : [200, 80, 200]);
  } catch {
    /* ignore */
  }
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = ok ? 880 : 220;
    o.type = ok ? 'sine' : 'square';
    g.gain.value = 0.12;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + (ok ? 0.15 : 0.35));
  } catch {
    /* ignore */
  }
}

function showResult(cls: string, icon: string, big: string, kind = '', name = '', sub = '', ms = 0) {
  const r = $('result');
  r.className = `d-result ${cls}`;
  $('r-icon').innerHTML = icon;
  $('r-big').textContent = big;
  $('r-kind').textContent = kind;
  $('r-name').textContent = name;
  $('r-sub').innerHTML = sub;
  r.hidden = false;
  clearTimeout(autoClose);
  if (ms) autoClose = window.setTimeout(closeResult, ms);
}

function closeResult() {
  clearTimeout(autoClose);
  $('result').hidden = true;
  busy = false;
}

$('r-next').addEventListener('click', closeResult);

async function check(raw: string) {
  if (busy) return;
  busy = true;
  showResult('wait', '', 'Checking', '', '', '');
  try {
    const res = await api('/api/scan', { json: { pin, code: raw, by: usher || 'Door' } });
    setStats(res.stats);
    const kind = res.kind ? KIND_LABEL[res.kind as Kind] : '';
    const when = res.at ? fmtDate(res.at, { hour: 'numeric', minute: '2-digit', hour12: true }) : '';
    if (res.result === 'ok') {
      buzz(true);
      const buyer = res.buyer && res.buyer !== res.name ? `Bought by ${esc(res.buyer)}<br>` : '';
      showResult('ok', ICON_OK, `ADMIT ${res.admits}`, kind + (res.test ? ' (test)' : ''), res.name, `${buyer}${esc(res.code)}`, 2600);
      $('last').textContent = `Last: ${res.name}, ${kind}, admitted ${res.admits}`;
    } else if (res.result === 'used') {
      buzz(false);
      showResult('used', ICON_NO, 'ALREADY USED', kind, res.name, `Scanned at ${esc(when)}${res.by ? ` by ${esc(res.by)}` : ''}<br>${esc(res.code)}`);
    } else if (res.result === 'unpaid') {
      buzz(false);
      showResult('unpaid', ICON_WARN, 'NOT PAID', '', res.name, 'This order was never paid. Send them to the help desk.');
    } else {
      buzz(false);
      showResult('invalid', ICON_NO, 'NOT VALID', '', '', 'This is not a ticket for this event.');
    }
  } catch (e: any) {
    if (e.status === 401) {
      signOut();
      $('login-err').textContent = 'The door PIN changed. Enter the new PIN.';
      $('login-err').hidden = false;
      closeResult();
      return;
    }
    buzz(false);
    showResult('unpaid', ICON_WARN, 'NO NETWORK', '', '', 'Could not reach the server. Check data or Wi-Fi and scan again.');
  }
}

// ---------- camera ----------
async function startCamera() {
  const note = $('camnote');
  note.textContent = 'Starting camera';
  try {
    if ('BarcodeDetector' in window) {
      const formats = await (window as any).BarcodeDetector.getSupportedFormats?.();
      if (!formats || formats.includes('qr_code')) detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
    }
  } catch {
    detector = null;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 1280 } },
      audio: false,
    });
    const video = $<HTMLVideoElement>('video');
    video.srcObject = stream;
    await video.play();
    note.textContent = 'Point at the QR code';
    setTimeout(() => {
      if (note.textContent === 'Point at the QR code') note.textContent = '';
    }, 3000);
    loop();
  } catch {
    note.textContent = 'Camera blocked. Allow camera access, or type codes below.';
  }
}

function stopCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

async function readFrame(video: HTMLVideoElement): Promise<string | null> {
  if (detector) {
    try {
      const found = await detector.detect(video);
      return found?.[0]?.rawValue || null;
    } catch {
      detector = null;
    }
  }
  const c = $<HTMLCanvasElement>('grab');
  const size = Math.min(video.videoWidth, video.videoHeight);
  if (!size) return null;
  const target = Math.min(size, 640);
  c.width = target;
  c.height = target;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(video, (video.videoWidth - size) / 2, (video.videoHeight - size) / 2, size, size, 0, 0, target, target);
  const img = ctx.getImageData(0, 0, target, target);
  return jsQR(img.data, target, target, { inversionAttempts: 'dontInvert' })?.data || null;
}

async function loop() {
  const video = $<HTMLVideoElement>('video');
  while (stream) {
    if (!busy && video.readyState >= 2) {
      const code = await readFrame(video);
      if (code) {
        const now = Date.now();
        if (!(code === lastCode && now - lastAt < 4000)) {
          lastCode = code;
          lastAt = now;
          await check(code);
        }
      }
    }
    await new Promise((r) => setTimeout(r, 180));
  }
}

$('manual-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>('manual');
  let v = input.value.trim().toUpperCase().replace(/\s+/g, '');
  if (!v) return;
  if (!v.startsWith('UGH-') && /^[0-9A-F]{10}$/.test(v)) v = `UGH-${v}`;
  input.value = '';
  input.blur();
  check(v);
});

// ---------- sign in ----------
async function enter() {
  $('v-login').hidden = true;
  $('v-scan').hidden = false;
  startCamera();
  setInterval(async () => {
    if (busy) return;
    try {
      const res = await api('/api/scan', { json: { pin, action: 'stats' } });
      setStats(res.stats);
    } catch {
      /* ignore */
    }
  }, 20000);
}

function signOut() {
  stopCamera();
  store.del('ugh_door_pin');
  pin = '';
  $('v-scan').hidden = true;
  $('v-login').hidden = false;
}

$('logout').addEventListener('click', signOut);

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('login-err');
  err.hidden = true;
  const p = $<HTMLInputElement>('pin').value.trim();
  const u = $<HTMLInputElement>('usher').value.trim();
  const btn = $<HTMLButtonElement>('login-btn');
  btn.disabled = true;
  try {
    const res = await api('/api/scan', { json: { pin: p, action: 'login' } });
    pin = p;
    usher = u;
    store.set('ugh_door_pin', p);
    store.set('ugh_door_usher', u);
    setStats(res.stats);
    enter();
  } catch (ex: any) {
    err.textContent = ex.status === 401 ? 'Wrong door PIN.' : ex.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

$<HTMLInputElement>('usher').value = usher;
if (pin) {
  api('/api/scan', { json: { pin, action: 'login' } })
    .then((res) => {
      setStats(res.stats);
      enter();
    })
    .catch(() => signOut());
}
