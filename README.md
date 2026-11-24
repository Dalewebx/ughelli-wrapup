# Ughelli Wrap-Up e-tickets

E-ticket site for the Ughelli Regional Choir End of Year Annual Wrap-Up (SCCWD, Ughelli Region).
Saturday 12 December 2026, 10am, Jaylayians Amusement Resort. Live at https://ughelli.sccwd.org.

## Pages
- `/` event page, ticket steppers, checkout (Paystack)
- `/ticket` QR e-tickets after payment, Save ticket, Find my ticket (phone + first name)
- `/door` usher scanner (DOOR_PIN or admin password). Blocks second scans.
- `/admin` sales, revenue, Paystack fee split, buyers, check-ins, sales switch, test ticket switch, event text and prices

## Stack
- Vite + plain TypeScript, no framework. Build: `npm run build`, output `dist`.
- Server code: Cloudflare Pages Functions in `functions/api/*`, shared code in `server/lib.ts`.
- Data: SCCWD Supabase, tables `ugh_settings`, `ugh_orders`, `ugh_tickets` and functions `ugh_*` only. Setup SQL in `sql/schema.sql`. RLS on, no public policies; only the service role key (server side) touches data.
- Payments: Paystack business "Regional EOY Party". Every payment uses subaccount `ACCT_2m04sitmmxwwohm` with `bearer: "subaccount"` (region pays the fee, 100% settles to them).
- Tickets are issued by `ugh_mark_paid` exactly once, from whichever comes first: the return page (`/api/verify`), the webhook (`/api/paystack-webhook`, HMAC SHA512) or admin Recheck.
- VIP and VVIP are tables of 4: one QR, scan shows ADMIT 4.
- Buyer pays the Paystack fee as a "Transaction fee" line (formula in `withFee`, same in server and client), so the region receives the full ticket price.
- Each ticket can carry its own guest name (or table name); blank uses the buyer's name.

## Environment variables (Cloudflare Pages, Production)
| Name | Value |
| --- | --- |
| SUPABASE_URL | SCCWD Supabase project URL |
| SUPABASE_SERVICE_ROLE_KEY | SCCWD Supabase service role key (secret) |
| PAYSTACK_SECRET_KEY | Live secret key of the "Regional EOY Party" business (secret) |
| ADMIN_PASSWORD | Admin password (secret) |
| DOOR_PIN | PIN for ushers on /door (secret) |
| PAYSTACK_SUBACCOUNT | Optional. Defaults to ACCT_2m04sitmmxwwohm |
| RESEND_API_KEY | Optional. Turns on the ticket email after payment (Resend free plan) |
| RESEND_FROM | Optional. Defaults to `Ughelli Wrap-Up <tickets@sccwd.org>` (sccwd.org must be verified in Resend) |

Paystack webhook URL (Settings > API Keys & Webhooks): `https://ughelli.sccwd.org/api/paystack-webhook`

## Launch checklist
1. Run `sql/schema.sql`, then `sql/002_names_fees_email.sql` in Supabase. Sales start closed, test ticket on.
2. Open `/?test=1`, buy the ₦100 test ticket with a real card, confirm the QR shows and admin shows the fee split.
3. Scan the test QR on `/door` (should admit), scan again (should say ALREADY USED).
4. In admin: turn the test ticket off, turn sales on.

## Notes for future chats
- Owner rules: no em dashes anywhere; light, eye-friendly colours; no AI-default fonts (this site uses Familjen Grotesk + Atkinson Hyperlegible); mobile-first with a proper PC layout; discuss plans before changing code.
- Everything on the public page must stay editable from admin.
- Built free for the region: must stay ₦0 (Cloudflare Pages free, no paid services).
- After every change you push, give a short GitHub commit summary (Summary line + brief Description).
- SQL must stay scoped to `ugh_` objects and be pasted in chat.
