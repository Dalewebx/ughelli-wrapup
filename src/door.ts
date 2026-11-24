import './styles/base.css';
import './styles/door.css';
import jsQR from 'jsqr';
import { api, esc, fmtDate, Kind, KIND_LABEL, store } from './lib/common';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

type Stats = { tickets: number; people: number; inTickets: number; inPeople: number };
type Entry = {
  code: string;
  kind: Kind;
  admits: number;
  seat: number | null;
  table_name: string | null;
  name: string;
  buyer: string;
  test: boolean;
  checked_in_at: string | null;
  checked_in_by: string | null;
};
type Queued = { code: string; by: string; at: string };

let pin = store.get('ugh_door_pin') || '';
let usher = store.get('ugh_door_usher') || '';
let stream: MediaStream | null = null;
let busy = false;
let lastCode = '';
let lastAt = 0;
let detector: any = null;
let autoClose = 0;
let online = true;

// ---------- saved guest list and offline queue ----------
function readJSON<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(store.get(key) || '') as T;
  } catch {
    return fallback;
  }
}
let list = readJSON<{ at: string; tickets: Entry[] }>('ugh_door_list', { at: '', tickets: [] });
let queue = readJSON<Queued[]>('ugh_door_queue', []);
const saveList = () => store.set('ugh_door_list', JSON.stringify(list));
const saveQueue = () => store.set('ugh_door_queue', JSON.stringify(queue));
const findEntry = (code: string) => list.tickets.find((t) => t.code === code);

function localStats(): Stats {
  let tickets = 0, people = 0, inTickets = 0, inPeople = 0;
  for (const t of list.tickets) {
    tickets++;
    people += t.admits;
    if (t.checked_in_at) {
      inTickets++;
      inPeople += t.admits;
    }
  }
  return { tickets, people, inTickets, inPeople };
}

function setStatus() {
  const el = $('d-status');
  el.classList.toggle('off', !online);
  const saved = list.at ? `guest list saved ${fmtDate(list.at, { hour: 'numeric', minute: '2-digit', hour12: true })}` : 'no guest list saved yet';
  const waiting = queue.length ? ` · ${queue.length} waiting to sync` : '';
  el.querySelector('span')!.textContent = online ? `Online · ${saved}${waiting}` : `No network · scanning from ${saved}${waiting}`;
}

function setStats(s?: Stats) {
  if (!s) return;
  $('d-count').textContent = `${s.inPeople} of ${s.people} people in`;
  $('d-tcount').textContent = `${s.inTickets} of ${s.tickets} tickets scanned`;
}

async function withTimeout<T>(p: (signal: AbortSignal) => Promise<T>, ms = 6000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await p(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function loadList() {
  try {
    const res = await withTimeout((signal) => api('/api/scan', { json: { pin, action: 'list' }, signal }), 15000);
    list = { at: res.at, tickets: res.tickets };
    // Keep local offline check-ins that haven't synced yet.
    for (const q of queue) {
      const e = findEntry(q.code);
      if (e && !e.checked_in_at) {
        e.checked_in_at = q.at;
        e.checked_in_by = `${q.by} (offline)`;
      }
    }
    saveList();
    online = true;
    setStats(res.stats);
  } catch (e: any) {
    if (e?.status === 401) return signOut();
    online = false;
  }
  setStatus();
}

async function sync() {
  if (!queue.length) return;
  try {
    const items = queue.slice();
    const res = await withTimeout((signal) => api('/api/scan', { json: { pin, action: 'sync', items }, signal }), 15000);
    queue = queue.filter((q) => !items.some((i) => i.code === q.code));
    saveQueue();
    online = true;
    setStats(res.stats);
    const twice = (res.results || []).filter((r: any) => r.result === 'used');
    if (twice.length) {
      const box = $('d-conflict');
      box.innerHTML = `Let in twice while offline: ${twice.map((r: any) => `${esc(r.name || '')} (${esc(r.code)})`).join(', ')}. The other scan was by ${esc(twice[0].by || 'another phone')}.`;
      box.hidden = false;
    }
  } catch (e: any) {
    if (e?.status === 401) return signOut();
    online = false;
  }
  setStatus();
}

// ---------- feedback ----------
const ICON_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m7.5 12.5 3 3 6-6.5"/></svg>';
const ICON_NO = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="m8.5 8.5 7 7M15.5 8.5l-7 7"/></svg>';
const ICON_WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 20h20Z"/><path d="M12 10v4M12 17.5v.5"/></svg>';

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

function kindText(r: { kind?: Kind; seat?: number | null; test?: boolean }) {
  if (!r.kind) return '';
  return `${KIND_LABEL[r.kind]}${r.seat ? ` · Seat ${r.seat} of 4` : ''}${r.test ? ' (test)' : ''}`;
}

function subText(r: { table_name?: string | null; buyer?: string; name?: string; code: string }) {
  const lines: string[] = [];
  if (r.table_name) lines.push(`Table: ${esc(r.table_name)}`);
  if (r.buyer && r.buyer !== r.name) lines.push(`Bought by ${esc(r.buyer)}`);
  lines.push(esc(r.code));
  return lines.join('<br>');
}

function showAnswer(res: any, offline = false) {
  const when = res.at ? fmtDate(res.at, { hour: 'numeric', minute: '2-digit', hour12: true }) : '';
  const tag = offline ? '<br><small>Checked offline, will sync</small>' : '';
  if (res.result === 'ok') {
    buzz(true);
    showResult('ok', ICON_OK, `ADMIT ${res.admits}`, kindText(res), res.name, subText(res) + tag, 2600);
    $('last').textContent = `Last: ${res.name}, ${kindText(res)}`;
  } else if (res.result === 'used') {
    buzz(false);
    showResult('used', ICON_NO, 'ALREADY USED', kindText(res), res.name, `Scanned at ${esc(when)}${res.by ? ` by ${esc(res.by)}` : ''}<br>${esc(res.code)}`);
  } else if (res.result === 'unpaid') {
    buzz(false);
    showResult('unpaid', ICON_WARN, 'NOT PAID', '', res.name, 'This order was never paid. Send them to the help desk.');
  } else if (res.result === 'unknown_offline') {
    buzz(false);
    showResult('unpaid', ICON_WARN, 'NOT IN SAVED LIST', '', '', 'No network, and this code is not in the guest list saved on this phone. If they bought very recently, scan again once signal returns.');
  } else {
    buzz(false);
    showResult('invalid', ICON_NO, 'NOT VALID', '', '', 'This is not a ticket for this event.');
  }
}

function offlineCheck(code: string) {
  const e = findEntry(code);
  if (!e) return showAnswer({ result: 'unknown_offline', code });
  if (e.checked_in_at) return showAnswer({ result: 'used', ...e, at: e.checked_in_at, by: e.checked_in_by }, true);
  const at = new Date().toISOString();
  e.checked_in_at = at;
  e.checked_in_by = `${usher || 'Door'} (offline)`;
  saveList();
  queue.push({ code, by: usher || 'Door', at });
  saveQueue();
  setStats(localStats());
  setStatus();
  showAnswer({ result: 'ok', ...e, at }, true);
}

async function check(raw: string) {
  if (busy) return;
  const match = String(raw || '').toUpperCase().match(/UGH-[0-9A-F]{10}/);
  busy = true;
  if (!match) return showAnswer({ result: 'invalid', code: raw });
  const code = match[0];
  showResult('wait', '', 'Checking', '', '', '');
  try {
    const res = await withTimeout((signal) => api('/api/scan', { json: { pin, code, by: usher || 'Door' }, signal }));
    online = true;
    setStats(res.stats);
    const e = findEntry(code);
    if (e && res.result === 'ok') {
      e.checked_in_at = res.at;
      e.checked_in_by = usher || 'Door';
      saveList();
    }
    setStatus();
    showAnswer(res);
    if (queue.length) sync();
  } catch (err: any) {
    if (err?.status === 401) {
      closeResult();
      signOut();
      $('login-err').textContent = 'The door PIN changed. Enter the new PIN.';
      $('login-err').hidden = false;
      return;
    }
    // No network or server trouble: fall back to the saved guest list.
    online = false;
    setStatus();
    offlineCheck(code);
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
let timers: number[] = [];

function enter() {
  $('v-login').hidden = true;
  $('v-scan').hidden = false;
  setStatus();
  setStats(localStats());
  startCamera();
  loadList();
  timers.push(window.setInterval(() => !busy && loadList(), 60000));
  timers.push(window.setInterval(() => !busy && sync(), 15000));
}

window.addEventListener('online', () => {
  if (!pin) return;
  sync();
  loadList();
});

function signOut() {
  stopCamera();
  timers.forEach(clearInterval);
  timers = [];
  store.del('ugh_door_pin');
  pin = '';
  $('v-scan').hidden = true;
  $('v-login').hidden = false;
}

$('logout').addEventListener('click', () => {
  if (queue.length && !confirm(`${queue.length} offline check-ins have not synced yet. Sign out anyway? They stay saved on this phone.`)) return;
  signOut();
});

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
    err.textContent = ex.status === 401 ? 'Wrong door PIN.' : 'No network. Sign in once with signal; after that the scanner works offline.';
    err.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

// Register the offline helper for this page only.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/door-sw.js', { scope: '/door' }).catch(() => {});
}

$<HTMLInputElement>('usher').value = usher;
if (pin) {
  // Already signed in on this phone: go straight in, even with no network.
  enter();
}
