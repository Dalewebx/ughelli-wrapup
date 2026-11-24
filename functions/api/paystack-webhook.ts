import { Env, hmacSha512Hex, safeEqual, settle } from '../../server/lib';

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  const raw = await request.text();
  const signature = request.headers.get('x-paystack-signature') || '';
  const expected = await hmacSha512Hex(env.PAYSTACK_SECRET_KEY, raw);
  if (!safeEqual(expected, signature)) return new Response('bad signature', { status: 401 });

  try {
    const evt = JSON.parse(raw);
    const ref = String(evt?.data?.reference || '');
    // Only handle this event's payments. Anything else on the business is ignored.
    if (evt?.event === 'charge.success' && ref.startsWith('UGH')) await settle(env, ref);
  } catch (e) {
    console.error('webhook error', e);
    return new Response('retry', { status: 500 });
  }
  return new Response('ok', { status: 200 });
};
