import { Env, bad, json, readJson, db, getSettings, isAdmin, settle, sendTicketEmail, cleanNames, phoneDigits, randomRef, MAX_PER_TYPE } from '../../server/lib';

const EDITABLE: Record<string, 'text' | 'int' | 'bool' | 'date' | 'list'> = {
  title: 'text', short_title: 'text', note_regular: 'text', note_vip: 'text', note_vvip: 'text', door_pin: 'text', organizer: 'text', about: 'text', venue: 'text', venue_area: 'text',
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
          'select=*,ugh_tickets(code,kind,admits,seq,guest_name,table_no,seat,table_name,checked_in_at,checked_in_by)&order=created_at.desc&limit=5000',
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

    // Cash, transfer or free tickets added by hand. Issues real QR tickets with no Paystack payment.
    if (body.action === 'manual_order') {
      const name = String(body.name || '').trim().replace(/\s+/g, ' ');
      const phone = String(body.phone || '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      const method = ['cash', 'transfer', 'free'].includes(body.method) ? body.method : 'cash';
      if (name.length < 2) return bad('Enter the buyer name.');
      if (phoneDigits(phone).length < 10) return bad('Enter a valid phone number.');
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return bad('That email looks wrong. Leave it empty if they have none.');
      const q = (k: string) => Math.max(0, Math.min(MAX_PER_TYPE * 5, Math.floor(Number(body.items?.[k] || 0)) || 0));
      const items = { regular: q('regular'), vip: q('vip'), vvip: q('vvip'), test: 0 };
      if (items.regular + items.vip + items.vvip === 0) return bad('Add at least one ticket.');
      const s = await getSettings(env);
      const face = items.regular * s.price_regular + items.vip * s.price_vip + items.vvip * s.price_vvip;
      const amount = method === 'free' ? 0 : face * 100;
      const ref = randomRef();
      await d.insert('ugh_orders', {
        ref, name, phone, phone_digits: phoneDigits(phone), email, items,
        guest_names: cleanNames(body.names, items), amount, ticket_total: amount, buyer_fee: 0, is_test: false,
      });
      await d.rpc('ugh_mark_paid', {
        p_ref: ref, p_fee: 0, p_sub: 0, p_main: 0, p_split: { manual: true, method },
        p_paid_at: new Date().toISOString(), p_channel: method,
      });
      if (email && env.RESEND_API_KEY) {
        try {
          await sendTicketEmail(env, ref);
        } catch (e) {
          console.error('manual email failed', e);
        }
      }
      return json({ ref });
    }

    if (body.action === 'edit_order') {
      const ref = String(body.ref || '');
      const name = String(body.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
      const phone = String(body.phone || '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      if (name.length < 2) return bad('Enter the buyer name.');
      if (phoneDigits(phone).length < 10) return bad('Enter a valid phone number.');
      await d.update('ugh_orders', `ref=eq.${encodeURIComponent(ref)}`, { name, phone, phone_digits: phoneDigits(phone), email });
      return json({ ok: true });
    }

    if (body.action === 'edit_ticket') {
      const code = String(body.code || '');
      if (!/^UGH-[0-9A-F]{10}$/.test(code)) return bad('Bad code.');
      const patch: Record<string, string | null> = { guest_name: String(body.guest_name || '').trim().slice(0, 60) || null };
      if ('table_name' in body) patch.table_name = String(body.table_name || '').trim().slice(0, 60) || null;
      await d.update('ugh_tickets', `code=eq.${code}`, patch);
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
