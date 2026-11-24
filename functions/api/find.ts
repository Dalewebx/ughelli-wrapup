import { Env, bad, json, readJson, db, phoneDigits, sendTicketEmail } from '../../server/lib';

function mask(email: string): string {
  const [user, domain] = email.split('@');
  if (!domain) return email;
  const keep = user.length <= 2 ? user.slice(0, 1) : user.slice(0, 2);
  return `${keep}${'*'.repeat(Math.max(2, user.length - keep.length))}@${domain}`;
}

// Find my ticket: never shows tickets on screen. It emails the ticket link to the address on the order,
// so someone who only knows your phone number can't open your QR.
export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  try {
    if (!env.RESEND_API_KEY) return bad('Ticket email is not available right now. Contact the organisers.', 503);
    const body = await readJson(request);
    const q = String(body.query || '').trim().toLowerCase();
    let filter = '';
    if (q.includes('@')) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(q)) return bad('That email address looks wrong.');
      filter = `email=eq.${encodeURIComponent(q)}`;
    } else {
      const digits = phoneDigits(q);
      if (digits.length < 10) return bad('Enter the phone number or email you used.');
      filter = `phone_digits=eq.${digits}`;
    }

    const orders: any[] = await db(env).get(
      'ugh_orders',
      `${filter}&status=eq.paid&select=ref,email,email_sent_at&order=paid_at.desc&limit=5`,
    );
    if (!orders.length) return json({ found: 0, to: [] });

    const now = Date.now();
    for (const o of orders) {
      // Small cooldown so the button can't be used to flood someone's inbox.
      const recent = o.email_sent_at && now - new Date(o.email_sent_at).getTime() < 3 * 60 * 1000;
      if (!recent) await sendTicketEmail(env, o.ref, true);
    }
    return json({ found: orders.length, to: [...new Set(orders.map((o) => mask(o.email)))] });
  } catch (e) {
    console.error(e);
    return bad('Could not send right now. Please try again.', 500);
  }
};
