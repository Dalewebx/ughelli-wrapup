import {
  Env, bad, json, readJson, getSettings, db, paystack, phoneDigits, randomRef,
  SUBACCOUNT_DEFAULT, TEST_PRICE, MAX_PER_TYPE, withFee, cleanNames,
} from '../../server/lib';

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  try {
    const body = await readJson(request);
    const name = String(body.name || '').trim().replace(/\s+/g, ' ');
    const phone = String(body.phone || '').trim();
    const email = String(body.email || '').trim().toLowerCase();

    if (name.length < 2 || name.length > 80) return bad('Please enter your full name.');
    if (phoneDigits(phone).length < 10) return bad('Please enter a valid phone number.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return bad('Please enter a valid email address.');

    const q = (k: string) => {
      const n = Math.floor(Number(body.items?.[k] || 0));
      return Number.isFinite(n) ? Math.max(0, Math.min(MAX_PER_TYPE, n)) : 0;
    };
    const items = { regular: q('regular'), vip: q('vip'), vvip: q('vvip'), test: q('test') };
    const count = items.regular + items.vip + items.vvip + items.test;
    if (count === 0) return bad('Pick at least one ticket.');

    const s = await getSettings(env);
    const isTest = items.test > 0;
    if (isTest) {
      if (!s.test_mode) return bad('Test tickets are switched off.');
      if (items.regular + items.vip + items.vvip > 0) return bad('Buy the test ticket on its own.');
    } else if (!s.sales_open) {
      return bad(s.closed_note || 'Ticket sales are closed right now.');
    }

    const subtotal =
      items.regular * s.price_regular + items.vip * s.price_vip + items.vvip * s.price_vvip + items.test * TEST_PRICE;
    const { fee, total: naira } = withFee(subtotal);
    const ref = randomRef();

    const guest_names = cleanNames(body.names, items);

    await db(env).insert('ugh_orders', {
      ref, name, phone, phone_digits: phoneDigits(phone), email, items, guest_names,
      amount: naira * 100, ticket_total: subtotal * 100, buyer_fee: fee * 100, is_test: isTest,
    });

    const origin = new URL(request.url).origin;
    const init = await paystack(env, '/transaction/initialize', {
      email,
      amount: naira * 100,
      currency: 'NGN',
      reference: ref,
      callback_url: `${origin}/ticket?ref=${ref}`,
      subaccount: env.PAYSTACK_SUBACCOUNT || SUBACCOUNT_DEFAULT,
      bearer: 'subaccount',
      metadata: {
        event: 'Ughelli Wrap-Up 2026',
        items,
        custom_fields: [
          { display_name: 'Name', variable_name: 'name', value: name },
          { display_name: 'Phone', variable_name: 'phone', value: phone },
          {
            display_name: 'Tickets',
            variable_name: 'tickets',
            value: `Regular ${items.regular}, VIP ${items.vip}, VVIP ${items.vvip}${isTest ? ', Test 1' : ''}`,
          },
          { display_name: 'Transaction fee', variable_name: 'fee', value: `NGN ${fee}` },
        ],
      },
    });

    if (!init?.status || !init.data?.authorization_url) {
      console.error('Paystack init failed', JSON.stringify(init));
      return bad(init?.message ? `Payment could not start: ${init.message}` : 'Payment could not start. Please try again.', 502);
    }
    return json({ ref, url: init.data.authorization_url });
  } catch (e: any) {
    console.error(e);
    // detail is for diagnosis only; the page shows the friendly message.
    return json({ error: 'Something went wrong. Please try again.', detail: String(e?.message || e).slice(0, 300) }, 500);
  }
};
