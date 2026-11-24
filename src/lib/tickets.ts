import QRCode from 'qrcode';
import { esc, fmtDate, Kind, KIND_LABEL, longDate, Ticket, timeOf } from './common';

export type EventBits = { title: string; venue: string; starts_at: string };

const THEME: Record<Kind, { band: string; band2: string; ink: string; chip: string }> = {
  regular: { band: '#0fa3b1', band2: '#22b8c4', ink: '#ffffff', chip: 'rgba(255,255,255,.22)' },
  vip: { band: '#0a7a86', band2: '#139aa7', ink: '#ffffff', chip: 'rgba(255,255,255,.2)' },
  vvip: { band: '#f2b705', band2: '#ffd35c', ink: '#3b2a00', chip: 'rgba(59,42,0,.12)' },
  test: { band: '#7f9a9f', band2: '#a3b8bc', ink: '#ffffff', chip: 'rgba(255,255,255,.22)' },
};

export async function qrSvg(code: string): Promise<string> {
  return QRCode.toString(code, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#12343b', light: '#ffffff' } });
}

export async function ticketCard(t: Ticket, holder: string, ev: EventBits, index: number, total: number): Promise<string> {
  const th = THEME[t.kind];
  const used = !!t.checked_in_at;
  const qr = await qrSvg(t.code);
  return `
  <article class="tk ${t.kind}${used ? ' used' : ''}" style="--band:${th.band};--band2:${th.band2};--bandink:${th.ink};--chip:${th.chip}">
    <div class="tk-band">
      <div class="tk-ev">${esc(ev.title)}</div>
      <div class="tk-kind">${KIND_LABEL[t.kind]}</div>
      <div class="tk-admits">Admits ${t.admits}</div>
    </div>
    <div class="tk-body">
      <div class="tk-row">
        <div><small>Name</small><b>${esc(holder)}</b></div>
        <div class="r"><small>Ticket</small><b>${index} of ${total}</b></div>
      </div>
      <div class="tk-row">
        <div><small>Date</small><b>${fmtDate(ev.starts_at, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</b></div>
        <div class="r"><small>Time</small><b>${timeOf(ev.starts_at)}</b></div>
      </div>
      <div class="tk-row"><div><small>Venue</small><b>${esc(ev.venue)}</b></div></div>
    </div>
    <div class="tk-perf" aria-hidden="true"></div>
    <div class="tk-qr">
      <div class="tk-qrbox" role="img" aria-label="QR code ${t.code}">${qr}</div>
      <div class="tk-code">${t.code}</div>
      ${used ? `<div class="tk-usedtag">Checked in ${fmtDate(t.checked_in_at!, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</div>` : '<div class="tk-hint">Show this at the gate. It works once.</div>'}
    </div>
    <button class="btn btn-line tk-save" type="button" data-code="${t.code}">Save ticket</button>
  </article>`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

export async function ticketPng(t: Ticket, holder: string, ev: EventBits, index: number, total: number): Promise<Blob> {
  try {
    await (document as any).fonts?.ready;
  } catch {
    /* ignore */
  }
  const W = 1080;
  const H = 1720;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const th = THEME[t.kind];
  const head = "'Familjen Grotesk', 'Segoe UI', sans-serif";
  const body = "'Atkinson Hyperlegible', 'Segoe UI', sans-serif";

  ctx.fillStyle = '#e2f5f7';
  ctx.fillRect(0, 0, W, H);

  const X = 70;
  const CW = W - 140;
  ctx.save();
  ctx.shadowColor = 'rgba(18,52,59,.16)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 14;
  roundRect(ctx, X, 70, CW, H - 140, 44);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();

  // band
  ctx.save();
  roundRect(ctx, X, 70, CW, H - 140, 44);
  ctx.clip();
  const g = ctx.createLinearGradient(X, 70, X + CW, 470);
  g.addColorStop(0, th.band);
  g.addColorStop(1, th.band2);
  ctx.fillStyle = g;
  ctx.fillRect(X, 70, CW, 420);
  ctx.strokeStyle = th.ink === '#ffffff' ? 'rgba(255,255,255,.25)' : 'rgba(59,42,0,.14)';
  ctx.lineWidth = 4;
  for (let row = 0; row < 3; row++) {
    ctx.beginPath();
    const y = 400 + row * 26;
    for (let x = X; x <= X + CW; x += 4) ctx.lineTo(x, y + Math.sin((x / CW) * Math.PI * 8) * 7);
    ctx.stroke();
  }
  ctx.restore();

  ctx.fillStyle = th.ink;
  ctx.font = `600 34px ${head}`;
  let y = 150;
  for (const line of wrap(ctx, ev.title, CW - 120).slice(0, 2)) {
    ctx.fillText(line, X + 60, y);
    y += 44;
  }
  ctx.font = `700 92px ${head}`;
  ctx.fillText(KIND_LABEL[t.kind], X + 60, y + 78);
  ctx.font = `700 36px ${body}`;
  const adm = `ADMITS ${t.admits}`;
  const aw = ctx.measureText(adm).width + 48;
  roundRect(ctx, X + 60, y + 108, aw, 62, 31);
  ctx.fillStyle = th.chip;
  ctx.fill();
  ctx.fillStyle = th.ink;
  ctx.fillText(adm, X + 84, y + 151);

  // details
  const rows: [string, string, string?, string?][] = [
    ['NAME', holder, 'TICKET', `${index} of ${total}`],
    ['DATE', longDate(ev.starts_at), 'TIME', timeOf(ev.starts_at)],
    ['VENUE', ev.venue],
  ];
  y = 560;
  for (const [l1, v1, l2, v2] of rows) {
    ctx.fillStyle = '#7f9a9f';
    ctx.font = `700 24px ${body}`;
    ctx.fillText(l1, X + 60, y);
    if (l2) ctx.fillText(l2, X + CW - 260, y);
    ctx.fillStyle = '#12343b';
    ctx.font = `700 36px ${body}`;
    ctx.fillText(wrap(ctx, v1, l2 ? CW - 360 : CW - 120)[0], X + 60, y + 46);
    if (v2) ctx.fillText(v2, X + CW - 260, y + 46);
    y += 112;
  }

  // perforation
  const py = 900;
  ctx.fillStyle = '#e2f5f7';
  ctx.beginPath();
  ctx.arc(X, py, 30, 0, Math.PI * 2);
  ctx.arc(X + CW, py, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#d6e7e8';
  ctx.lineWidth = 4;
  ctx.setLineDash([16, 14]);
  ctx.beginPath();
  ctx.moveTo(X + 50, py);
  ctx.lineTo(X + CW - 50, py);
  ctx.stroke();
  ctx.setLineDash([]);

  // QR
  const qrCanvas = document.createElement('canvas');
  await QRCode.toCanvas(qrCanvas, t.code, { width: 520, margin: 0, errorCorrectionLevel: 'M', color: { dark: '#12343b', light: '#ffffff' } });
  ctx.drawImage(qrCanvas, (W - 520) / 2, 960, 520, 520);
  ctx.fillStyle = '#12343b';
  ctx.font = `700 44px ${head}`;
  ctx.textAlign = 'center';
  ctx.fillText(t.code, W / 2, 1550);
  ctx.fillStyle = '#4b6b71';
  ctx.font = `400 28px ${body}`;
  ctx.fillText('Show this QR at the gate. Each code works once.', W / 2, 1600);
  ctx.textAlign = 'left';

  return new Promise((resolve) => c.toBlob((b) => resolve(b!), 'image/png'));
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// On phones, the share sheet lets people "Save image" straight to their gallery.
export async function saveTicketImage(blob: Blob, name: string) {
  const file = new File([blob], name, { type: 'image/png' });
  const nav = navigator as any;
  if (nav.canShare && nav.canShare({ files: [file] }) && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
    try {
      await nav.share({ files: [file], title: 'My e-ticket' });
      return;
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
    }
  }
  downloadBlob(blob, name);
}
