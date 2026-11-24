import { Env, bad, json, readJson, db, getSettings, isAdmin, settle, sendTicketEmail } from '../../server/lib';

const EDITABLE: Record<string, 'text' | 'int' | 'bool' | 'date' | 'list'> = {
  title: 'text', organizer: 'text', about: 'text', venue: 'text', venue_area: 'text',
  starts_at: 'date', highlights: 'list', contact_phone: 'text', closed_note: 'text',
  price_regular: 'int', price_vip: 'int', price_vvip: 'int', sales_open: 'bool', test_mode: 'bool',
};

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  if (!isAdmin(request, env)) return bad('Wrong password.', 401);
  try {
    const body = await readJson(request);
    const d = db(env);

    if (body.action === 'load') {
      const [settings, orders] = await Promise.all([
        getSettings(env),
        d.get(
          'ugh_orders',
          'select=*,ugh_tickets(code,kind,admits,seq,guest_name,checked_in_at,checked_in_by)&order=created_at.desc&limit=5000',
        ),
      ]);
      return json({ settings, orders, email_ready: !!env.RESEND_API_KEY });
    }

    if (body.action === 'save') {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      for (const [key, type] of Object.entries(EDITABLE)) {
        if (!(key in (body.patch || {}))) continue;
        const v = body.patch[key];
        if (type === 'text') patch[key] = String(v ?? '').slice(0, 4000);
        if (type === 'bool') patch[key] = !!v;
        if (type === 'int') {
          const n = Math.round(Number(v));
          if (!Number.isFinite(n) || n < 100) return bad(`Price for ${key.replace('price_', '')} looks wrong.`);
          patch[key] = n;
        }
        if (type === 'date') {
          const t = new Date(String(v));
          if (isNaN(t.getTime())) return bad('The date and time look wrong.');
          patch[key] = t.toISOString();
        }
        if (type === 'list') patch[key] = (Array.isArray(v) ? v : []).map((x) => String(x).trim()).filter(Boolean).slice(0, 16);
      }
      const rows = await d.update('ugh_settings', 'id=eq.1', patch);
      return json({ settings: rows[0] });
    }

    if (body.action === 'recheck') {
      const status = await settle(env, String(body.ref || ''));
      return json({ status });
    }

    if (body.action === 'resend_email') {
      if (!env.RESEND_API_KEY) return bad('Email is not set up yet (RESEND_API_KEY missing).');
      const ref = String(body.ref || '');
      await d.update('ugh_orders', `ref=eq.${encodeURIComponent(ref)}&status=eq.paid`, { email_sent_at: null });
      await sendTicketEmail(env, ref);
      return json({ ok: true });
    }

    if (body.action === 'undo_checkin') {
      const code = String(body.code || '');
      if (!/^UGH-[0-9A-F]{10}$/.test(code)) return bad('Bad code.');
      await d.update('ugh_tickets', `code=eq.${code}`, { checked_in_at: null, checked_in_by: null });
      return json({ ok: true });
    }

    return bad('Unknown action.');
  } catch (e: any) {
    console.error(e);
    return bad(e.message || 'Something went wrong.', 500);
  }
};
