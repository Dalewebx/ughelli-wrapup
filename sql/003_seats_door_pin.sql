-- Update 3: one QR per seat for tables, short hero headline, door PIN in admin, new about text.
-- Only touches ugh_ objects. Safe to run more than once.

alter table public.ugh_settings add column if not exists short_title text not null default 'End of Year Annual Wrap-Up';
alter table public.ugh_settings add column if not exists door_pin text not null default '';
alter table public.ugh_tickets add column if not exists table_no int;
alter table public.ugh_tickets add column if not exists seat int;
alter table public.ugh_tickets add column if not exists table_name text;

update public.ugh_settings
   set organizer = 'Ughelli Regional Choir · St. Cecilia Choir Warri Diocese',
       about = 'The first ever Ughelli Regional Choir end of year get-together, and it promises to be a lot of fun. Come with your fellow choristers, come with your friends.'
 where id = 1;

create or replace function public.ugh_mark_paid(
  p_ref text, p_fee int, p_sub int, p_main int, p_split jsonb, p_paid_at timestamptz, p_channel text
) returns boolean language plpgsql as $$
declare
  o public.ugh_orders;
  k text;
  n int;
  i int;
  s int;
  t jsonb;
  tname text;
  sname text;
  first_name text;
begin
  update public.ugh_orders
     set status = 'paid', paystack_fee = p_fee, subaccount_share = p_sub, main_share = p_main,
         split = p_split, paid_at = coalesce(p_paid_at, now()), channel = p_channel
   where ref = p_ref and status <> 'paid'
   returning * into o;
  if not found then
    return false;
  end if;
  first_name := split_part(o.name, ' ', 1);

  -- Single tickets: one QR each.
  foreach k in array array['regular', 'test'] loop
    n := coalesce((o.items ->> k)::int, 0);
    for i in 1..n loop
      insert into public.ugh_tickets (code, order_ref, kind, admits, seq, guest_name)
      values (public.ugh_new_code(), o.ref, k, 1, i,
              coalesce(nullif(trim(o.guest_names -> k ->> (i - 1)), ''), o.name));
    end loop;
  end loop;

  -- Tables of 4: one QR per seat, so guests can arrive at different times.
  foreach k in array array['vip', 'vvip'] loop
    n := coalesce((o.items ->> k)::int, 0);
    for i in 1..n loop
      t := o.guest_names -> k -> (i - 1);
      if jsonb_typeof(t) = 'object' then
        tname := nullif(trim(t ->> 'name'), '');
      elsif jsonb_typeof(t) = 'string' then
        tname := nullif(trim(t #>> '{}'), '');
      else
        tname := null;
      end if;
      tname := coalesce(tname, first_name || '''s table' || case when n > 1 then ' ' || i else '' end);
      for s in 1..4 loop
        sname := case when jsonb_typeof(t) = 'object' then nullif(trim(t -> 'seats' ->> (s - 1)), '') end;
        insert into public.ugh_tickets (code, order_ref, kind, admits, seq, guest_name, table_no, seat, table_name)
        values (public.ugh_new_code(), o.ref, k, 1, (i - 1) * 4 + s,
                coalesce(sname, case when s = 1 then o.name else 'Guest of ' || first_name end),
                i, s, tname);
      end loop;
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
      'name', coalesce(t.guest_name, o.name), 'buyer', o.name, 'seat', t.seat, 'table_name', t.table_name,
      'at', t.checked_in_at, 'test', o.is_test);
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
    'name', coalesce(t.guest_name, o.name), 'buyer', o.name, 'seat', t.seat, 'table_name', t.table_name,
    'at', t.checked_in_at, 'by', t.checked_in_by);
end $$;

revoke all on function public.ugh_mark_paid(text, int, int, int, jsonb, timestamptz, text) from public, anon, authenticated;
revoke all on function public.ugh_check_in(text, text) from public, anon, authenticated;
grant execute on function public.ugh_mark_paid(text, int, int, int, jsonb, timestamptz, text) to service_role;
grant execute on function public.ugh_check_in(text, text) to service_role;
