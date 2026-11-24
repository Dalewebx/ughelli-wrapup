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

function codeOf(raw: unknown): string | null {
  const m = String(raw || '').toUpperCase().match(/UGH-[0-9A-F]{10}/);
  return m ? m[0] : null;
}

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  try {
    const body = await readJson(request);
    if (!(await isDoor(String(body.pin || ''), env))) return bad('Wrong door PIN.', 401);
    const d = db(env);

    if (body.action === 'login' || body.action === 'stats') return json({ ok: true, stats: await doorStats(env) });

    // Guest list saved on the usher's phone so scanning keeps working with no network.
    if (body.action === 'list') {
      const rows: any[] = await d.get(
        'ugh_tickets',
        'select=code,kind,admits,seat,table_name,guest_name,checked_in_at,checked_in_by,ugh_orders!inner(name,status,is_test)&ugh_orders.status=eq.paid&limit=10000',
      );
      return json({
        at: new Date().toISOString(),
        tickets: rows.map((t) => ({
          code: t.code, kind: t.kind, admits: t.admits, seat: t.seat, table_name: t.table_name,
          name: t.guest_name || t.ugh_orders.name, buyer: t.ugh_orders.name, test: t.ugh_orders.is_test,
          checked_in_at: t.checked_in_at, checked_in_by: t.checked_in_by,
        })),
        stats: await doorStats(env),
      });
    }

    // Check-ins made while offline, sent once signal returns.
    if (body.action === 'sync') {
      const items: any[] = Array.isArray(body.items) ? body.items.slice(0, 500) : [];
      const results: any[] = [];
      for (const it of items) {
        const code = codeOf(it.code);
        if (!code) continue;
        const by = `${String(it.by || 'Door').slice(0, 30)} (offline)`;
        const r = await d.rpc('ugh_check_in', { p_code: code, p_by: by });
        results.push({ code, result: r.result, name: r.name, by: r.by, at: r.at });
      }
      return json({ results, stats: await doorStats(env) });
    }

    const code = codeOf(body.code);
    if (!code) return json({ result: 'invalid', stats: await doorStats(env) });
    const by = String(body.by || 'Door').slice(0, 40);
    const result = await d.rpc('ugh_check_in', { p_code: code, p_by: by });
    return json({ ...result, stats: await doorStats(env) });
  } catch (e) {
    console.error(e);
    return bad('Scan failed. Check the network and try again.', 500);
  }
};
