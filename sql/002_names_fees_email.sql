-- Update 2: a name on each ticket, buyer-paid transaction fee, ticket email tracking.
-- Only touches ugh_ objects. Safe to run more than once.

alter table public.ugh_orders add column if not exists guest_names jsonb not null default '{}'::jsonb;
alter table public.ugh_orders add column if not exists ticket_total int;
alter table public.ugh_orders add column if not exists buyer_fee int;
alter table public.ugh_orders add column if not exists email_sent_at timestamptz;
alter table public.ugh_tickets add column if not exists guest_name text;

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
      insert into public.ugh_tickets (code, order_ref, kind, admits, seq, guest_name)
      values (
        public.ugh_new_code(), o.ref, k, case when k in ('vip', 'vvip') then 4 else 1 end, i,
        coalesce(nullif(trim(o.guest_names -> k ->> (i - 1)), ''), o.name)
      );
    end loop;
  end loop;
  return true;
end $$;

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
      'name', coalesce(t.guest_name, o.name), 'buyer', o.name, 'at', t.checked_in_at, 'test', o.is_test);
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
    'name', coalesce(t.guest_name, o.name), 'buyer', o.name, 'at', t.checked_in_at, 'by', t.checked_in_by);
end $$;

revoke all on function public.ugh_mark_paid(text, int, int, int, jsonb, timestamptz, text) from public, anon, authenticated;
revoke all on function public.ugh_check_in(text, text) from public, anon, authenticated;
grant execute on function public.ugh_mark_paid(text, int, int, int, jsonb, timestamptz, text) to service_role;
grant execute on function public.ugh_check_in(text, text) to service_role;
