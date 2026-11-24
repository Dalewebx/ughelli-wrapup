export type Kind = 'regular' | 'vip' | 'vvip' | 'test';

export type EventInfo = {
  title: string;
  short_title?: string;
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
  hero_image?: string | null;
};

export type Ticket = {
  code: string;
  kind: Kind;
  admits: number;
  seq: number;
  guest_name?: string | null;
  table_no?: number | null;
  seat?: number | null;
  table_name?: string | null;
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
  regular: '1 person',
  vip: 'Table for 4, a QR for each seat',
  vvip: 'Table for 4, a QR for each seat',
  test: 'Admin payment test only',
};

export const TZ = 'Africa/Lagos';

// Same formula as the server. Buyer pays the Paystack fee so the region receives the full ticket price.
export function withFee(price: number): { fee: number; total: number } {
  if (price <= 0) return { fee: 0, total: 0 };
  let total = price / 0.985;
  if (total >= 2500) total = (price + 100) / 0.985;
  if (total - price > 2000) total = price + 2000;
  total = Math.ceil(total);
  return { fee: total - price, total };
}

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


