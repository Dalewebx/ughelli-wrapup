// Shared server helpers for the Pages Functions. Not a route (lives outside /functions).

export type Env = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  PAYSTACK_SECRET_KEY: string;
  ADMIN_PASSWORD: string;
  DOOR_PIN?: string;
  PAYSTACK_SUBACCOUNT?: string;
};

export const SUBACCOUNT_DEFAULT = 'ACCT_2m04sitmmxwwohm';
export const TEST_PRICE = 100; // naira
export const MAX_PER_TYPE = 10;
export const KINDS = ['regular', 'vip', 'vvip', 'test'] as const;
export type Kind = (typeof KINDS)[number];

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export function bad(message: string, status = 400): Response {
  return json({ error: message }, status);
}

export function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function phoneDigits(p: string): string {
  return String(p || '').replace(/\D/g, '').slice(-10);
}

export function randomRef(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  let s = '';
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return `UGH${s}`;
}

export async function readJson(request: Request): Promise<any> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

// Tiny Supabase REST client using the service role key.
export function db(env: Env) {
  const base = env.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1';
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
  async function req(path: string, init: RequestInit = {}): Promise<any> {
    const r = await fetch(base + path, { ...init, headers: { ...headers, ...((init.headers as any) || {}) } });
    const text = await r.text();
    if (!r.ok) throw new Error(`Database error ${r.status}: ${text.slice(0, 300)}`);
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return {
    get: (table: string, query: string) => req(`/${table}?${query}`),
    insert: (table: string, row: unknown) =>
      req(`/${table}`, { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) }),
    update: (table: string, query: string, patch: unknown) =>
      req(`/${table}?${query}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(patch),
      }),
    rpc: (fn: string, args: unknown) => req(`/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) }),
  };
}

export async function getSettings(env: Env): Promise<any> {
  const rows = await db(env).get('ugh_settings', 'id=eq.1&select=*');
  if (!rows || !rows[0]) throw new Error('Event settings missing. Run the SQL setup first.');
  return rows[0];
}

export function publicSettings(s: any) {
  return {
    title: s.title,
    organizer: s.organizer,
    about: s.about,
    venue: s.venue,
    venue_area: s.venue_area,
    starts_at: s.starts_at,
    highlights: s.highlights || [],
    contact_phone: s.contact_phone,
    prices: { regular: s.price_regular, vip: s.price_vip, vvip: s.price_vvip, test: TEST_PRICE },
    sales_open: s.sales_open,
    test_mode: s.test_mode,
    closed_note: s.closed_note,
  };
}

// ---------- Paystack ----------

export async function paystack(env: Env, path: string, body?: unknown): Promise<any> {
  const r = await fetch(`https://api.paystack.co${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  try {
    return await r.json();
  } catch {
    return { status: false, message: `Paystack returned ${r.status}` };
  }
}

export async function hmacSha512Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, [
    'sign',
  ]);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Checks a payment with Paystack and, if it succeeded, marks the order paid and issues tickets.
// Safe to call any number of times, from the return page, the webhook or admin.
export async function settle(env: Env, ref: string): Promise<'paid' | 'pending' | 'review' | 'missing'> {
  const d = db(env);
  const rows = await d.get('ugh_orders', `ref=eq.${encodeURIComponent(ref)}&select=*`);
  const order = rows?.[0];
  if (!order) return 'missing';
  if (order.status === 'paid') return 'paid';

  const v = await paystack(env, `/transaction/verify/${encodeURIComponent(ref)}`);
  const t = v?.data;
  if (!v?.status || !t || t.status !== 'success') return order.status === 'review' ? 'review' : 'pending';

  if (Number(t.amount) < Number(order.amount) || t.currency !== 'NGN') {
    await d.update('ugh_orders', `ref=eq.${encodeURIComponent(ref)}`, {
      status: 'review',
      split: { note: 'Amount or currency did not match', paystack_amount: t.amount, currency: t.currency },
    });
    return 'review';
  }

  const fee = Number(t.fees ?? 0);
  const fs = t.fees_split || null;
  const main = fs && fs.integration != null ? Number(fs.integration) : 0;
  const sub = fs && fs.subaccount != null ? Number(fs.subaccount) : Number(t.amount) - fee - main;

  await d.rpc('ugh_mark_paid', {
    p_ref: ref,
    p_fee: fee,
    p_sub: sub,
    p_main: main,
    p_split: {
      fees_split: fs,
      subaccount: t.subaccount?.subaccount_code ?? null,
      paystack_amount: t.amount,
    },
    p_paid_at: t.paid_at || t.paidAt || null,
    p_channel: t.channel || null,
  });
  return 'paid';
}

export async function ticketsFor(env: Env, ref: string) {
  return db(env).get(
    'ugh_tickets',
    `order_ref=eq.${encodeURIComponent(ref)}&select=code,kind,admits,seq,checked_in_at&order=kind.asc,seq.asc`,
  );
}

export function isAdmin(request: Request, env: Env): boolean {
  return safeEqual(request.headers.get('x-admin-key') || '', env.ADMIN_PASSWORD || '');
}

export function isDoor(pin: string, env: Env): boolean {
  return safeEqual(pin || '', env.DOOR_PIN || '') || safeEqual(pin || '', env.ADMIN_PASSWORD || '');
}
