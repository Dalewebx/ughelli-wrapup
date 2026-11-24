import { Env, bad, json, db, settle, ticketsFor } from '../../server/lib';

export const onRequestGet = async ({ request, env }: { request: Request; env: Env }) => {
  try {
    const ref = (new URL(request.url).searchParams.get('ref') || '').trim();
    if (!/^UGH[A-Z0-9]{8,30}$/.test(ref)) return bad('Ticket not found.', 404);
    const status = await settle(env, ref);
    if (status === 'missing') return bad('Ticket not found.', 404);
    const rows = await db(env).get('ugh_orders', `ref=eq.${ref}&select=ref,name,items,amount,status,paid_at,is_test`);
    const order = rows[0];
    const tickets = status === 'paid' ? await ticketsFor(env, ref) : [];
    return json({ status, order, tickets });
  } catch (e: any) {
    console.error(e);
    return bad('Could not check this payment right now.', 500);
  }
};
