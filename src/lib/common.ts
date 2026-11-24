export type Kind = 'regular' | 'vip' | 'vvip' | 'test';

export type EventInfo = {
  title: string;
  organizer: string;
  about: string;
  venue: string;
  venue_area: string;
  starts_at: string;
  highlights: string[];
  contact_phone: string;
  prices: Record<Kind, number>;
  sales_open: boolean;
  test_mode: boolean;
  closed_note: string;
};

export type Ticket = {
  code: string;
  kind: Kind;
  admits: number;
  seq: number;
  checked_in_at: string | null;
  checked_in_by?: string | null;
  order_ref?: string;
};

export const KIND_LABEL: Record<Kind, string> = {
  regular: 'Regular',
  vip: 'VIP Table',
  vvip: 'VVIP Table',
  test: 'Test ticket',
};

export const KIND_NOTE: Record<Kind, string> = {
  regular: 'Admits 1 person',
  vip: 'Table for 4, one QR',
  vvip: 'Table for 4, one QR',
  test: 'Admin payment test only',
};

export const TZ = 'Africa/Lagos';

export function naira(n: number): string {
  return '₦' + Math.round(n).toLocaleString('en-NG');
}

export function nairaKobo(kobo: number): string {
  const n = (kobo || 0) / 100;
  return '₦' + n.toLocaleString('en-NG', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

export function fmtDate(iso: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...opts }).format(new Date(iso));
}

export function longDate(iso: string): string {
  return fmtDate(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function timeOf(iso: string): string {
  return fmtDate(iso, { hour: 'numeric', minute: '2-digit', hour12: true }).replace(' ', '').toLowerCase();
}

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function waNumber(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.startsWith('234')) return d;
  if (d.startsWith('0')) return '234' + d.slice(1);
  return d;
}

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const r = await fetch(path, {
    ...rest,
    method: rest.method || (json !== undefined ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...((rest.headers as any) || {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  let data: any = null;
  try {
    data = await r.json();
  } catch {
    /* empty */
  }
  if (!r.ok) {
    const err: any = new Error(data?.error || `Request failed (${r.status})`);
    err.status = r.status;
    throw err;
  }
  return data as T;
}

export const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  },
  del(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

const ICONS: Record<string, string> = {
  feast:
    '<path d="M4 13h16a8 8 0 0 1-16 0Z"/><path d="M12 5v3M8.5 6.5l.8 2M15.5 6.5l-.8 2"/><path d="M3 21h18"/>',
  swim: '<path d="M2 16c2 0 2-1.5 4-1.5S8 16 10 16s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5"/><path d="M2 20c2 0 2-1.5 4-1.5S8 20 10 20s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5"/><circle cx="16" cy="6" r="2"/><path d="m6 12 4-5 4 3"/>',
  ball: '<circle cx="12" cy="12" r="9"/><path d="m12 7 4 3-1.5 4.5h-5L8 10Z"/><path d="M12 3v4M21 10.5l-5-.5M18 19l-3.5-4.5M6 19l3.5-4.5M3 10.5l5-.5"/>',
  paddle: '<circle cx="10" cy="9" r="6"/><path d="m14.5 13.5 5 5a1.4 1.4 0 0 1-2 2l-5-5"/><circle cx="19" cy="5" r="1.6"/>',
  dance: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  snooker: '<circle cx="8" cy="15" r="4"/><circle cx="16" cy="15" r="4"/><circle cx="12" cy="8" r="4"/><path d="M2 3l7 4"/>',
  fun: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="3"/>',
};

export function iconFor(text: string): string {
  const t = text.toLowerCase();
  let key = 'fun';
  if (/feast|food|eat|lunch|dinner|drink/.test(t)) key = 'feast';
  else if (/swim|pool/.test(t) && !/snooker/.test(t)) key = 'swim';
  else if (/soccer|football|match/.test(t)) key = 'ball';
  else if (/table tennis|ping|tennis/.test(t)) key = 'paddle';
  else if (/danc|music|dj|sing/.test(t)) key = 'dance';
  else if (/snooker|billiard/.test(t)) key = 'snooker';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[key]}</svg>`;
}

export const BRAND_MARK = `<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><defs><clipPath id="bm"><circle cx="16" cy="16" r="16"/></clipPath></defs><g clip-path="url(#bm)"><rect width="32" height="32" fill="#0fa3b1"/><circle cx="16" cy="12.5" r="5.5" fill="#ffc93c"/><path d="M0 20c2.7 0 2.7-2 5.3-2s2.7 2 5.4 2 2.6-2 5.3-2 2.7 2 5.3 2 2.7-2 5.4-2 2.6 2 5.3 2V32H0Z" fill="#fff"/><path d="M0 25c2.7 0 2.7-2 5.3-2s2.7 2 5.4 2 2.6-2 5.3-2 2.7 2 5.3 2 2.7-2 5.4-2 2.6 2 5.3 2" stroke="#bfe9ee" stroke-width="1.6" fill="none"/></g></svg>`;
