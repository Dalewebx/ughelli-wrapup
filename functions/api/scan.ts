import { Env, bad, json, readJson, db, isDoor } from '../../server/lib';

async function doorStats(env: Env) {
  const rows: any[] = await db(env).get('ugh_tickets', 'select=admits,checked_in_at,ugh_orders!inner(status)&ugh_orders.status=eq.paid');
  let tickets = 0, people = 0, inTickets = 0, inPeople = 0;
  for (const t of rows) {
    tickets++; people += t.admits;
    if (t.checked_in_at) { inTickets++; inPeople += t.admits; }
  }
  return { tickets, people, inTickets, inPeople };
}

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  try {
    const body = await readJson(request);
    if (!isDoor(String(body.pin || ''), env)) return bad('Wrong door PIN.', 401);

    if (body.action === 'login' || body.action === 'stats') return json({ ok: true, stats: await doorStats(env) });

    const match = String(body.code || '').toUpperCase().match(/UGH-[0-9A-F]{10}/);
    if (!match) return json({ result: 'invalid', stats: await doorStats(env) });
    const by = String(body.by || 'Door').slice(0, 40);
    const result = await db(env).rpc('ugh_check_in', { p_code: match[0], p_by: by });
    return json({ ...result, stats: await doorStats(env) });
  } catch (e) {
    console.error(e);
    return bad('Scan failed. Check the network and try again.', 500);
  }
};
