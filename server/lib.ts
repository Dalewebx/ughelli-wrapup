// Shared server helpers for the Pages Functions. Not a route (lives outside /functions).

export type Env = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  PAYSTACK_SECRET_KEY: string;
  ADMIN_PASSWORD: string;
  DOOR_PIN?: string;
  PAYSTACK_SUBACCOUNT?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  SITE_URL?: string;
};

export const SUBACCOUNT_DEFAULT = 'ACCT_2m04sitmmxwwohm';
export const TEST_PRICE = 100; // naira
export const MAX_PER_TYPE = 10;
export const KINDS = ['regular', 'vip', 'vvip', 'test'] as const;
export type Kind = (typeof KINDS)[number];

// Passes the Paystack fee to the buyer so the region still receives the full ticket price.
// Paystack NG: 1.5% + N100 (N100 waived under N2,500), capped at N2,000. Formula from Paystack's docs.
export function withFee(price: number): { fee: number; total: number } {
  if (price <= 0) return { fee: 0, total: 0 };
  let total = price / 0.985;
  if (total >= 2500) total = (price + 100) / 0.985;
  if (total - price > 2000) total = price + 2000;
  total = Math.ceil(total);
  return { fee: total - price, total };
}

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
    hero_image: s.hero_image || null,
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

  const first = await d.rpc('ugh_mark_paid', {
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
  if (first === true) {
    try {
      await sendTicketEmail(env, ref);
    } catch (e) {
      console.error('email failed', e);
    }
  }
  return 'paid';
}

const LABEL: Record<string, string> = { regular: 'Regular', vip: 'VIP Table', vvip: 'VVIP Table', test: 'Test ticket' };

function escHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

// Sends the "your tickets" email once, right after payment. Skipped quietly if Resend isn't set up.
export async function sendTicketEmail(env: Env, ref: string) {
  if (!env.RESEND_API_KEY) return;
  const d = db(env);
  const [order] = await d.get('ugh_orders', `ref=eq.${encodeURIComponent(ref)}&select=*`);
  if (!order || order.email_sent_at) return;
  const tickets: any[] = await d.get(
    'ugh_tickets',
    `order_ref=eq.${encodeURIComponent(ref)}&select=code,kind,admits,guest_name&order=kind.asc,seq.asc`,
  );
  const s = await getSettings(env);
  const site = (env.SITE_URL || 'https://ughelli.sccwd.org').replace(/\/+$/, '');
  const link = `${site}/ticket?ref=${ref}`;
  const when = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(s.starts_at));
  const first = String(order.name).split(/\s+/)[0];
  const rows = tickets
    .map(
      (t) => `<tr>
        <td style="padding:12px 0;border-bottom:1px solid #e7f1f2;font:700 15px Arial,sans-serif;color:#12343b">${LABEL[t.kind] || t.kind}<br><span style="font:400 14px Arial,sans-serif;color:#4b6b71">${escHtml(t.guest_name || order.name)} &middot; admits ${t.admits}</span></td>
        <td style="padding:12px 0;border-bottom:1px solid #e7f1f2;font:700 14px 'Courier New',monospace;color:#12343b;text-align:right">${t.code}</td>
      </tr>`,
    )
    .join('');
  const html = `<!doctype html><html><body style="margin:0;background:#f3f9f9;padding:24px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:18px;overflow:hidden">
    <tr><td style="background:#0fa3b1;padding:26px 26px 22px;font:700 22px Arial,sans-serif;color:#ffffff">${escHtml(s.title)}</td></tr>
    <tr><td style="padding:24px 26px 8px;font:400 16px/1.55 Arial,sans-serif;color:#12343b">
      Hi ${escHtml(first)}, your payment went through and your tickets are ready.<br><br>
      <b>${escHtml(when)}</b><br>${escHtml(s.venue)}${s.venue_area ? ', ' + escHtml(s.venue_area) : ''}
    </td></tr>
    <tr><td style="padding:8px 26px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>
    <tr><td style="padding:22px 26px 8px" align="center">
      <a href="${link}" style="display:inline-block;background:#0a7a86;color:#ffffff;text-decoration:none;font:700 16px Arial,sans-serif;padding:15px 28px;border-radius:12px">Open my QR tickets</a>
    </td></tr>
    <tr><td style="padding:12px 26px 26px;font:400 14px/1.5 Arial,sans-serif;color:#4b6b71" align="center">
      Show the QR at the gate. Each code works once, and a table QR lets in all 4 people.<br>
      Lost this email? Use Find my ticket on ${escHtml(site.replace(/^https?:\/\//, ''))} with your phone number.<br>
      Help: ${escHtml(s.contact_phone)}
    </td></tr>
  </table></body></html>`;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.RESEND_FROM || 'Ughelli Wrap-Up <tickets@sccwd.org>',
      to: [order.email],
      subject: `Your tickets: ${s.title}`,
      html,
    }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
  await d.update('ugh_orders', `ref=eq.${encodeURIComponent(ref)}`, { email_sent_at: new Date().toISOString() });
}

export async function ticketsFor(env: Env, ref: string) {
  return db(env).get(
    'ugh_tickets',
    `order_ref=eq.${encodeURIComponent(ref)}&select=code,kind,admits,seq,guest_name,checked_in_at&order=kind.asc,seq.asc`,
  );
}

export function isAdmin(request: Request, env: Env): boolean {
  return safeEqual(request.headers.get('x-admin-key') || '', env.ADMIN_PASSWORD || '');
}

export function isDoor(pin: string, env: Env): boolean {
  return safeEqual(pin || '', env.DOOR_PIN || '') || safeEqual(pin || '', env.ADMIN_PASSWORD || '');
}
