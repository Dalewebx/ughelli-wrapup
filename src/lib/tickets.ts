import QRCode from 'qrcode';
import { esc, fmtDate, Kind, KIND_LABEL, longDate, Ticket, timeOf } from './common';

export type EventBits = { title: string; venue: string; starts_at: string };

type Theme = {
  bg: string;
  ink: string;
  muted: string;
  accent: string;
  edge: string;
  pattern?: boolean;
  strip?: boolean;
};

// Each grade has its own look: Regular is clean white, VIP is black, VVIP is engraved champagne gold.
const THEME: Record<Kind, Theme> = {
  regular: { bg: '#ffffff', ink: '#15131a', muted: '#8d8a96', accent: '#d9600c', edge: '#e2e0e8', strip: true },
  vip: { bg: '#121016', ink: '#ffffff', muted: 'rgba(255,255,255,0.55)', accent: '#ffb21a', edge: '#121016' },
  vvip: { bg: '#fbf1da', ink: '#3d2c08', muted: '#8a7444', accent: '#8a5a00', edge: '#e6c57a', pattern: true },
  test: { bg: '#ffffff', ink: '#15131a', muted: '#8d8a96', accent: '#8d8a96', edge: '#e2e0e8', strip: true },
};

export async function qrSvg(code: string): Promise<string> {
  return QRCode.toString(code, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#15131a', light: '#ffffff' } });
}

function typeLine(t: Ticket) {
  return `${KIND_LABEL[t.kind]}${t.seat ? ` · Seat ${t.seat} of 4` : t.admits > 1 ? ` · Admits ${t.admits}` : ''}`;
}

export async function ticketCard(t: Ticket, holder: string, ev: EventBits, index: number, total: number): Promise<string> {
  const used = !!t.checked_in_at;
  const qr = await qrSvg(t.code);
  return `
  <article class="tk tk-${t.kind}${used ? ' used' : ''}">
    <div class="tk-top"><span class="tk-type">${typeLine(t)}</span>${total > 1 ? `<span class="tk-count">${index} of ${total}</span>` : ''}</div>
    <div class="tk-name">${esc(holder)}</div>
    <div class="tk-ev">${esc(ev.title)}</div>
    <div class="tk-meta">
      <div><small>Date</small><b>${fmtDate(ev.starts_at, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</b></div>
      <div><small>Time</small><b>${timeOf(ev.starts_at)}</b></div>
      <div class="wide"><small>Venue</small><b>${esc(ev.venue)}</b></div>
      ${t.table_name ? `<div class="wide"><small>Table</small><b>${esc(t.table_name)}</b></div>` : ''}
    </div>
    <div class="tk-qr">
      <div class="tk-qrbox" role="img" aria-label="QR code ${t.code}">${qr}</div>
      <div class="tk-code">${t.code}</div>
      ${used ? `<div class="tk-usedtag">Checked in ${fmtDate(t.checked_in_at!, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</div>` : ''}
    </div>
    <button class="tk-save" type="button" data-code="${t.code}">Save ticket</button>
    <div class="tk-credit">Designed by Palmweaver</div>
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
  // Phone-screen shape so it fills the screen when opened from the gallery at the gate.
  const W = 1080;
  const H = 1920;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const th = THEME[t.kind];
  const head = "'Oswald', 'Arial Narrow', sans-serif";
  const body = "-apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
  const mono = "ui-monospace, Menlo, Consolas, monospace";

  ctx.fillStyle = '#f3f2f7';
  ctx.fillRect(0, 0, W, H);

  const X = 60;
  const Y = 60;
  const CW = W - 120;
  const CH = H - 120;
  ctx.save();
  ctx.shadowColor = 'rgba(21,19,26,.18)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 14;
  roundRect(ctx, X, Y, CW, CH, 48);
  ctx.fillStyle = th.bg;
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRect(ctx, X, Y, CW, CH, 48);
  ctx.clip();
  if (th.pattern) {
    ctx.strokeStyle = 'rgba(160,110,20,0.09)';
    ctx.lineWidth = 2;
    for (let d = -CH; d < CW + CH; d += 18) {
      ctx.beginPath();
      ctx.moveTo(X + d, Y);
      ctx.lineTo(X + d - CH, Y + CH);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(X + d - CH, Y);
      ctx.lineTo(X + d, Y + CH);
      ctx.stroke();
    }
  }
  if (th.strip) {
    const g = ctx.createLinearGradient(0, Y, 0, Y + CH);
    g.addColorStop(0, t.kind === 'test' ? '#a5a2ad' : '#ff7a1a');
    g.addColorStop(1, t.kind === 'test' ? '#c9c6d0' : '#ffb21a');
    ctx.fillStyle = g;
    ctx.fillRect(X, Y, 18, CH);
  }
  ctx.restore();
  if (th.pattern) {
    ctx.strokeStyle = th.edge;
    ctx.lineWidth = 4;
    roundRect(ctx, X + 22, Y + 22, CW - 44, CH - 44, 34);
    ctx.stroke();
  }

  const L = X + 80;
  const R = X + CW - 80;
  // top line
  ctx.fillStyle = th.accent;
  ctx.font = `600 40px ${head}`;
  ctx.fillText(typeLine(t).toUpperCase(), L, Y + 130);
  if (total > 1) {
    ctx.textAlign = 'right';
    ctx.fillStyle = th.muted;
    ctx.font = `600 36px ${head}`;
    ctx.fillText(`${index} OF ${total}`, R, Y + 130);
    ctx.textAlign = 'left';
  }

  // name, shrunk to fit one line
  let size = 96;
  ctx.font = `700 ${size}px ${head}`;
  while (ctx.measureText(holder.toUpperCase()).width > R - L && size > 54) {
    size -= 4;
    ctx.font = `700 ${size}px ${head}`;
  }
  ctx.fillStyle = th.ink;
  ctx.fillText(holder.toUpperCase(), L, Y + 250);
  ctx.fillStyle = th.muted;
  ctx.font = `400 30px ${body}`;
  ctx.fillText(wrap(ctx, ev.title, R - L)[0], L, Y + 305);

  // details
  const rows: [string, string, string?, string?][] = [
    ['DATE', fmtDate(ev.starts_at, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }), 'TIME', timeOf(ev.starts_at)],
    ['VENUE', ev.venue],
    ...(t.table_name ? ([['TABLE', t.table_name]] as [string, string][]) : []),
  ];
  let y = Y + 400;
  for (const [l1, v1, l2, v2] of rows) {
    ctx.fillStyle = th.muted;
    ctx.font = `700 24px ${body}`;
    ctx.fillText(l1, L, y);
    if (l2) ctx.fillText(l2, R - 220, y);
    ctx.fillStyle = th.ink;
    ctx.font = `700 36px ${body}`;
    ctx.fillText(wrap(ctx, v1, l2 ? R - L - 260 : R - L)[0], L, y + 46);
    if (v2) ctx.fillText(v2, R - 220, y + 46);
    y += 108;
  }

  // QR on a white panel
  const P = 640;
  const px = (W - P) / 2;
  const py = Math.max(y + 10, Y + 760);
  roundRect(ctx, px, py, P, P, 36);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  if (t.kind !== 'vip') {
    ctx.strokeStyle = th.edge;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  const qrCanvas = document.createElement('canvas');
  await QRCode.toCanvas(qrCanvas, t.code, { width: 560, margin: 0, errorCorrectionLevel: 'M', color: { dark: '#15131a', light: '#ffffff' } });
  ctx.drawImage(qrCanvas, px + 40, py + 40, 560, 560);

  ctx.textAlign = 'center';
  ctx.fillStyle = th.ink;
  ctx.font = `700 46px ${mono}`;
  ctx.fillText(t.code, W / 2, py + P + 80);
  ctx.fillStyle = th.muted;
  ctx.font = `400 28px ${body}`;
  ctx.fillText('Show this QR at the gate. Each code works once.', W / 2, py + P + 130);
  ctx.font = `400 22px ${body}`;
  ctx.fillText('Designed by Palmweaver', W / 2, Y + CH - 50);
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
