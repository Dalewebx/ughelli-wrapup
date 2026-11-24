import { Env, bad, json, readJson, db, phoneDigits } from '../../server/lib';

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  try {
    const body = await readJson(request);
    const digits = phoneDigits(body.phone);
    const word = String(body.name || '').trim().toLowerCase().split(/\s+/)[0] || '';
    if (digits.length < 10 || word.length < 2) return bad('Enter your phone number and first name.');

    const rows: any[] = await db(env).get(
      'ugh_orders',
      `phone_digits=eq.${digits}&status=eq.paid&select=ref,name,items,paid_at,is_test&order=paid_at.desc`,
    );
    const mine = rows.filter((o) => String(o.name).toLowerCase().split(/\s+/).includes(word));
    if (!mine.length) return json({ orders: [] });

    const refs = mine.map((o) => o.ref).join(',');
    const tickets: any[] = await db(env).get(
      'ugh_tickets',
      `order_ref=in.(${refs})&select=order_ref,code,kind,admits,seq,guest_name,checked_in_at&order=kind.asc,seq.asc`,
    );
    return json({
      orders: mine.map((o) => ({ ...o, tickets: tickets.filter((t) => t.order_ref === o.ref) })),
    });
  } catch (e) {
    console.error(e);
    return bad('Could not search right now. Please try again.', 500);
  }
};
