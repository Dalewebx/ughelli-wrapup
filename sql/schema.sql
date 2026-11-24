-- Ughelli Regional Choir End of Year Wrap-Up tickets.
-- Everything here is prefixed ugh_ and touches nothing else in this Supabase project.
-- Safe to run more than once.

create table if not exists public.ugh_settings (
  id int primary key default 1 check (id = 1),
  title text not null,
  organizer text not null default '',
  about text not null default '',
  venue text not null default '',
  venue_area text not null default '',
  starts_at timestamptz not null,
  highlights jsonb not null default '[]'::jsonb,
  contact_phone text not null default '',
  price_regular int not null,
  price_vip int not null,
  price_vvip int not null,
  sales_open boolean not null default false,
  test_mode boolean not null default true,
  closed_note text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.ugh_orders (
  ref text primary key,
  name text not null,
  phone text not null,
  phone_digits text not null,
  email text not null,
  items jsonb not null,
  amount int not null,                 -- kobo
  is_test boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'paid', 'review')),
  paystack_fee int,                    -- kobo
  subaccount_share int,                -- kobo, what settles to the region
  main_share int,                      -- kobo, what stays on the main account (should be 0)
  split jsonb,
  channel text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists ugh_orders_phone_idx on public.ugh_orders (phone_digits);
create index if not exists ugh_orders_status_idx on public.ugh_orders (status);

create table if not exists public.ugh_tickets (
  code text primary key,
  order_ref text not null references public.ugh_orders(ref) on delete cascade,
  kind text not null check (kind in ('regular', 'vip', 'vvip', 'test')),
  admits int not null,
  seq int not null,
  checked_in_at timestamptz,
  checked_in_by text,
  created_at timestamptz not null default now()
);
create index if not exists ugh_tickets_order_idx on public.ugh_tickets (order_ref);

-- Locked down: no public access at all. Only the site's server functions (service role) can read or write.
alter table public.ugh_settings enable row level security;
alter table public.ugh_orders enable row level security;
alter table public.ugh_tickets enable row level security;

-- Random ticket code like UGH-3FA9C21B7D (40 random bits).
create or replace function public.ugh_new_code()
returns text language sql volatile as $$
  select 'UGH-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
$$;

-- Marks an order paid and issues its tickets in one go. Runs only once per order.
create or replace function public.ugh_mark_paid(
  p_ref text, p_fee int, p_sub int, p_main int, p_split jsonb, p_paid_at timestamptz, p_channel text
) returns boolean language plpgsql as $$
declare
  o public.ugh_orders;
  k text;
  n int;
  i int;
begin
  update public.ugh_orders
     set status = 'paid', paystack_fee = p_fee, subaccount_share = p_sub, main_share = p_main,
         split = p_split, paid_at = coalesce(p_paid_at, now()), channel = p_channel
   where ref = p_ref and status <> 'paid'
   returning * into o;
  if not found then
    return false;
  end if;
  foreach k in array array['regular', 'vip', 'vvip', 'test'] loop
    n := coalesce((o.items ->> k)::int, 0);
    for i in 1..n loop
      insert into public.ugh_tickets (code, order_ref, kind, admits, seq)
      values (public.ugh_new_code(), o.ref, k, case when k in ('vip', 'vvip') then 4 else 1 end, i);
    end loop;
  end loop;
  return true;
end $$;

-- Door check-in. The update only succeeds while the ticket is unused, so a second scan is always blocked.
create or replace function public.ugh_check_in(p_code text, p_by text)
returns jsonb language plpgsql as $$
declare
  t public.ugh_tickets;
  o public.ugh_orders;
begin
  update public.ugh_tickets tk
     set checked_in_at = now(), checked_in_by = p_by
   where tk.code = p_code
     and tk.checked_in_at is null
     and exists (select 1 from public.ugh_orders od where od.ref = tk.order_ref and od.status = 'paid')
   returning * into t;
  if found then
    select * into o from public.ugh_orders where ref = t.order_ref;
    return jsonb_build_object('result', 'ok', 'code', t.code, 'kind', t.kind, 'admits', t.admits,
      'name', o.name, 'at', t.checked_in_at, 'test', o.is_test);
  end if;

  select * into t from public.ugh_tickets where code = p_code;
  if not found then
    return jsonb_build_object('result', 'invalid', 'code', p_code);
  end if;
  select * into o from public.ugh_orders where ref = t.order_ref;
  if o.status <> 'paid' then
    return jsonb_build_object('result', 'unpaid', 'code', t.code, 'name', o.name);
  end if;
  return jsonb_build_object('result', 'used', 'code', t.code, 'kind', t.kind, 'admits', t.admits,
    'name', o.name, 'at', t.checked_in_at, 'by', t.checked_in_by);
end $$;

revoke all on function public.ugh_new_code() from public, anon, authenticated;
revoke all on function public.ugh_mark_paid(text, int, int, int, jsonb, timestamptz, text) from public, anon, authenticated;
revoke all on function public.ugh_check_in(text, text) from public, anon, authenticated;
grant execute on function public.ugh_new_code() to service_role;
grant execute on function public.ugh_mark_paid(text, int, int, int, jsonb, timestamptz, text) to service_role;
grant execute on function public.ugh_check_in(text, text) to service_role;

-- Starting event details. Everything here is editable later from the admin page.
insert into public.ugh_settings (
  id, title, organizer, about, venue, venue_area, starts_at, highlights, contact_phone,
  price_regular, price_vip, price_vvip, sales_open, test_mode, closed_note
) values (
  1,
  'Ughelli Regional Choir End of Year Annual Wrap-Up',
  'St. Cecilia Choir Warri Diocese, Ughelli Region',
  'One full day for the Ughelli Region choir family to close the year together. Good food at the love feast, a swim, a match on the pitch, table tennis, snooker and a dancing competition to settle who really has the moves. Come with your choir, come with your friends.',
  'Jaylayians Amusement Resort',
  '',
  '2026-12-12 10:00:00+01',
  '["Love feast", "Swimming", "Soccer", "Table tennis", "Dancing competition", "Snooker", "Fun and games"]'::jsonb,
  '0806 625 5265',
  8000, 30000, 50000,
  false, true,
  'Ticket sales are closed for now. Call or WhatsApp 0806 625 5265 for help.'
) on conflict (id) do nothing;
