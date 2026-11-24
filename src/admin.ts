import './styles/base.css';
import './styles/admin.css';
import { api, esc, fmtDate, Kind, KIND_LABEL, naira, nairaKobo, store, Ticket, waNumber } from './lib/common';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

type Order = {
  ref: string;
  name: string;
  phone: string;
  email: string;
  items: Record<Kind, number>;
  amount: number;
  ticket_total: number | null;
  buyer_fee: number | null;
  split: any;
  email_sent_at: string | null;
  is_test: boolean;
  status: 'pending' | 'paid' | 'review';
  paystack_fee: number | null;
  subaccount_share: number | null;
  main_share: number | null;
  channel: string | null;
  paid_at: string | null;
  created_at: string;
  ugh_tickets: Ticket[];
};

let key = (() => {
  try {
    return sessionStorage.getItem('ugh_admin') || '';
  } catch {
    return '';
  }
})();
let settings: any = null;
let orders: Order[] = [];
let filter = 'paid';
let emailReady = false;

function toast(msg: string) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout((t as any)._h);
  (t as any)._h = setTimeout(() => (t.hidden = true), 2600);
}

async function call(json: any) {
  return api('/api/admin', { json, headers: { 'x-admin-key': key } });
}

// ---------- auth ----------
$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  key = $<HTMLInputElement>('pw').value;
  const err = $('login-err');
  err.hidden = true;
  try {
    await load();
    try {
      sessionStorage.setItem('ugh_admin', key);
    } catch {
      /* ignore */
    }
  } catch (ex: any) {
    err.textContent = ex.status === 401 ? 'Wrong password.' : ex.message;
    err.hidden = false;
  }
});

$('logout').addEventListener('click', () => {
  try {
    sessionStorage.removeItem('ugh_admin');
  } catch {
    /* ignore */
  }
  location.reload();
});

$('refresh').addEventListener('click', async () => {
  await load();
  toast('Up to date');
});

// ---------- tabs ----------
$('tabs').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button[data-tab]') as HTMLElement | null;
  if (!b) return;
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll<HTMLElement>('[data-view]').forEach((v) => (v.hidden = v.dataset.view !== b.dataset.tab));
  store.set('ugh_admin_tab', b.dataset.tab!);
});

// ---------- load ----------
async function load() {
  const res = await call({ action: 'load' });
  settings = res.settings;
  orders = res.orders;
  emailReady = !!res.email_ready;
  $('v-login').hidden = true;
  $('v-app').hidden = false;
  renderAll();
}

function renderAll() {
  renderSwitches();
  renderOverview();
  renderBuyers();
  fillForm();
  manualTotal();
}

function renderSwitches() {
  $<HTMLInputElement>('t-sales').checked = settings.sales_open;
  $<HTMLInputElement>('t-test').checked = settings.test_mode;
  const pill = $('sales-pill');
  pill.textContent = settings.sales_open ? 'Sales open' : 'Sales closed';
  pill.classList.toggle('open', settings.sales_open);
  $('sales-note').textContent = settings.sales_open ? 'Buyers can pay now.' : "Buyers can't pay while this is off.";
}

async function saveSwitch(field: 'sales_open' | 'test_mode', el: HTMLInputElement) {
  el.disabled = true;
  try {
    const res = await call({ action: 'save', patch: { [field]: el.checked } });
    settings = res.settings;
    renderSwitches();
    toast(field === 'sales_open' ? (settings.sales_open ? 'Sales are open' : 'Sales are closed') : settings.test_mode ? 'Test ticket on' : 'Test ticket off');
  } catch (e: any) {
    el.checked = !el.checked;
    toast(e.message);
  } finally {
    el.disabled = false;
  }
}
$('t-sales').addEventListener('change', (e) => saveSwitch('sales_open', e.target as HTMLInputElement));
$('t-test').addEventListener('change', (e) => saveSwitch('test_mode', e.target as HTMLInputElement));

// ---------- overview ----------
function isManual(o: Order) {
  return o.channel === 'cash' || o.channel === 'transfer' || o.channel === 'free';
}

function tableStats(list: Order[]) {
  const tables = new Map<string, boolean>();
  for (const o of list)
    for (const t of o.ugh_tickets) {
      if (t.kind !== 'vip' && t.kind !== 'vvip') continue;
      const key = t.seat ? `${o.ref}-${t.kind}-${t.table_no}` : t.code;
      tables.set(key, (tables.get(key) || false) || !!t.checked_in_at);
    }
  return { total: tables.size, arrived: [...tables.values()].filter(Boolean).length };
}

function ticketLabel(t: Ticket) {
  return `${KIND_LABEL[t.kind]}${t.seat ? `, seat ${t.seat} of 4` : t.admits > 1 ? ` (admits ${t.admits})` : ''}`;
}

function sum(list: Order[], f: (o: Order) => number) {
  return list.reduce((s, o) => s + (f(o) || 0), 0);
}

function renderOverview() {
  const paid = orders.filter((o) => o.status === 'paid' && !o.is_test);
  const online = paid.filter((o) => !isManual(o));
  const byHand = paid.filter((o) => isManual(o) && o.channel !== 'free');
  const free = paid.filter((o) => o.channel === 'free');
  const gross = sum(online, (o) => o.amount);
  const onlineSales = sum(online, (o) => o.ticket_total ?? o.amount);
  const handSales = sum(byHand, (o) => o.amount);
  const ticketSales = onlineSales + handSales;
  const buyerFees = sum(online, (o) => o.buyer_fee ?? 0);
  const fees = sum(online, (o) => o.paystack_fee ?? 0);
  const settle = sum(online, (o) => o.subaccount_share ?? o.amount - (o.paystack_fee ?? 0));
  const tickets = paid.flatMap((o) => o.ugh_tickets);
  const people = tickets.reduce((s, t) => s + t.admits, 0);

  $('stats').innerHTML = [
    ['Ticket sales', nairaKobo(ticketSales), `Online ${nairaKobo(onlineSales)} · by hand ${nairaKobo(handSales)}${free.length ? ` · ${free.length} free order${free.length === 1 ? '' : 's'}` : ''}`, 'hero'],
    ['Paystack fees', nairaKobo(fees), `Buyers covered ${nairaKobo(buyerFees)} of it`, ''],
    ['Settles to region', nairaKobo(settle), `Online sales into the subaccount (buyers paid ${nairaKobo(gross)})`, ''],
    ['Guests', String(people), `${tickets.length} ticket${tickets.length === 1 ? '' : 's'}`, ''],
  ]
    .map(([l, v, s, c]) => `<div class="stat ${c}"><small>${l}</small><b>${v}</b><span>${s}</span></div>`)
    .join('');

  const kinds: Kind[] = ['regular', 'vip', 'vvip'];
  const rows = kinds.map((k) => {
    const count = sum(paid, (o) => o.items[k] || 0);
    const price = settings[`price_${k}`];
    const rev = paid.filter((o) => o.channel !== 'free').reduce((s, o) => s + (o.items[k] || 0), 0) * price;
    return { k, count, people: count * (k === 'regular' ? 1 : 4), rev };
  });
  $('by-type').innerHTML =
    `<tr><th>Type</th><th class="n">Sold</th><th class="n">People</th><th class="n">At today's price</th></tr>` +
    rows.map((r) => `<tr><td>${KIND_LABEL[r.k]}</td><td class="n">${r.count}</td><td class="n">${r.people}</td><td class="n">${naira(r.rev)}</td></tr>`).join('') +
    `<tr><td>Total</td><td class="n">${sum(rows as any, (r: any) => r.count)}</td><td class="n">${people}</td><td class="n">${nairaKobo(ticketSales)}</td></tr>`;

  const inT = tickets.filter((t) => t.checked_in_at);
  const inP = inT.reduce((s, t) => s + t.admits, 0);
  const pct = people ? Math.round((inP / people) * 100) : 0;
  const lastIn = inT.map((t) => t.checked_in_at!).sort().pop();
  $('checkins').innerHTML = `
    <div class="kv"><span>People in</span><b>${inP} of ${people}</b></div>
    <div class="bar"><i style="width:${pct}%"></i></div>
    <div class="kv"><span>Tickets scanned</span><b>${inT.length} of ${tickets.length}</b></div>
    <div class="kv"><span>Tables with someone in</span><b>${tableStats(paid).arrived} of ${tableStats(paid).total}</b></div>
    <div class="kv"><span>Last scan</span><b>${lastIn ? fmtDate(lastIn, { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' }) : 'None yet'}</b></div>`;

  const tests = orders.filter((o) => o.is_test && o.status === 'paid');
  $('test-card').hidden = !tests.length;
  $('test-box').innerHTML = tests
    .map(
      (o) => `
      <div class="kv"><span>${esc(o.name)} · ${fmtDate(o.paid_at!, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span><b>${nairaKobo(o.amount)}</b></div>
      <div class="kv"><span>Paystack fee</span><b>${nairaKobo(o.paystack_fee ?? 0)}</b></div>
      <div class="kv"><span>To region subaccount</span><b>${nairaKobo(o.subaccount_share ?? 0)}</b></div>
      <div class="kv"><span>Kept on main account</span><b>${nairaKobo(o.main_share ?? 0)}</b></div>
      <div class="kv"><span>Subaccount Paystack confirmed</span><b>${esc(o.split?.subaccount || 'Not reported')}</b></div>`,
    )
    .join('<hr style="border:0;border-top:2px solid var(--line-soft);margin:10px 0">');

  const origin = location.origin;
  $('l-public').textContent = origin + '/';
  $('l-door').textContent = origin + '/door';
  $('l-find').textContent = origin + '/ticket?find=1';
}

// ---------- buyers ----------
$('search').addEventListener('input', renderBuyers);
$('filter').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button[data-f]') as HTMLElement | null;
  if (!b) return;
  filter = b.dataset.f!;
  document.querySelectorAll('#filter button').forEach((x) => x.classList.toggle('on', x === b));
  renderBuyers();
});

function itemsText(items: Record<Kind, number>) {
  return (['regular', 'vip', 'vvip', 'test'] as Kind[])
    .filter((k) => items[k])
    .map((k) => `${items[k]} ${KIND_LABEL[k]}`)
    .join(', ');
}

function renderBuyers() {
  const q = $<HTMLInputElement>('search').value.trim().toLowerCase();
  const qd = q.replace(/\D/g, '');
  const list = orders.filter((o) => {
    if (filter === 'test' && !o.is_test) return false;
    if (filter !== 'test' && filter !== 'all' && (o.status !== filter || o.is_test)) return false;
    if (!q) return true;
    return (
      o.name.toLowerCase().includes(q) ||
      o.email.toLowerCase().includes(q) ||
      (qd.length >= 4 && o.phone.replace(/\D/g, '').includes(qd)) ||
      o.ref.toLowerCase().includes(q) ||
      o.ugh_tickets.some((t) => t.code.toLowerCase().includes(q) || (t.guest_name || '').toLowerCase().includes(q))
    );
  });
  $('buyers-count').textContent = `${list.length} order${list.length === 1 ? '' : 's'}`;
  $('buyers').innerHTML = list
    .slice(0, 400)
    .map((o) => {
      const link = `${location.origin}/ticket?ref=${o.ref}`;
      const msg = `Hello ${o.name.split(' ')[0]}, here are your Ughelli Wrap-Up e-tickets: ${link}`;
      const stText =
        o.status === 'paid' ? (o.channel === 'free' ? 'Free' : isManual(o) ? `Paid (${o.channel})` : 'Paid') : o.status === 'review' ? 'Needs review' : 'Not paid';
      return `
      <details class="buyer">
        <summary>
          <span class="b-name">${esc(o.name)}${o.is_test ? ' (test)' : ''}</span>
          <span class="b-amt">${nairaKobo(o.amount)}</span>
          <span class="b-sub">${esc(itemsText(o.items))}</span>
          <span class="b-st st-${o.status}">${stText}</span>
        </summary>
        <div class="b-body">
          <div class="b-meta">
            <span>Phone: ${esc(o.phone)}</span>
            <span>Email: ${esc(o.email)}</span>
            <span>Ordered: ${fmtDate(o.created_at, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}${o.paid_at ? ` · Paid: ${fmtDate(o.paid_at, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}</span>
            ${o.buyer_fee != null ? `<span>Tickets ${nairaKobo(o.ticket_total ?? 0)} + transaction fee ${nairaKobo(o.buyer_fee)}</span>` : ''}
            ${o.status === 'paid' ? `<span>Paystack fee ${nairaKobo(o.paystack_fee ?? 0)} · To region ${nairaKobo(o.subaccount_share ?? 0)}${o.channel ? ` · ${esc(o.channel)}` : ''}</span>
            <span>Subaccount Paystack confirmed: ${esc(o.split?.subaccount || 'Not reported')}</span>
            <span>Ticket email: ${o.email_sent_at ? 'sent ' + fmtDate(o.email_sent_at, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : emailReady ? 'not sent' : 'email not set up'}</span>` : ''}
            <span>Ref: ${esc(o.ref)}</span>
          </div>
          <div class="b-tix">
            ${o.ugh_tickets
              .map(
                (t) => `<div class="b-tk"><span><code>${t.code}</code> · ${ticketLabel(t)}${t.table_name ? ` · ${esc(t.table_name)}` : ''}${t.guest_name ? ` · ${esc(t.guest_name)}` : ''}</span>
                ${t.checked_in_at ? `<span><span class="in">In ${fmtDate(t.checked_in_at, { hour: 'numeric', minute: '2-digit' })}${t.checked_in_by ? ` by ${esc(t.checked_in_by)}` : ''}</span> <button class="linkbtn" data-undo="${t.code}" type="button">Undo</button></span>` : '<span class="muted">Not in yet</span>'}</div>`,
              )
              .join('')}
          </div>
          <div class="b-actions">
            ${o.status !== 'paid' ? `<button class="btn btn-primary sm" type="button" data-recheck="${o.ref}">Recheck with Paystack</button>` : ''}
            ${o.status === 'paid' ? `<a class="btn btn-soft sm" target="_blank" rel="noopener" href="https://wa.me/${waNumber(o.phone)}?text=${encodeURIComponent(msg)}">Send tickets on WhatsApp</a>
            <button class="btn btn-line sm" type="button" data-copy="${link}">Copy ticket link</button>
            ${emailReady && o.email ? `<button class="btn btn-line sm" type="button" data-email="${o.ref}">Resend email</button>` : ''}
            <button class="btn btn-line sm" type="button" data-edit="${o.ref}">Edit names</button>` : ''}
          </div>
          <div class="edit-grid" data-editbox="${o.ref}" hidden>
            <div class="edit-row"><input class="input" data-f="name" value="${esc(o.name)}" placeholder="Buyer name" /><input class="input" data-f="phone" value="${esc(o.phone)}" placeholder="Phone" /></div>
            <input class="input" data-f="email" value="${esc(o.email)}" placeholder="Email" />
            ${o.ugh_tickets
              .map(
                (t) => `<div class="edit-row"><input class="input" data-code="${t.code}" data-tf="guest_name" value="${esc(t.guest_name || '')}" placeholder="${esc(ticketLabel(t))}: name" />${t.seat ? `<input class="input" data-code="${t.code}" data-tf="table_name" value="${esc(t.table_name || '')}" placeholder="Table name" />` : '<span></span>'}</div>`,
              )
              .join('')}
            <div class="b-actions"><button class="btn btn-primary sm" type="button" data-save="${o.ref}">Save changes</button></div>
          </div>
        </div>
      </details>`;
    })
    .join('');
}

$('buyers').addEventListener('click', async (e) => {
  const el = e.target as HTMLElement;
  const re = el.closest('[data-recheck]') as HTMLButtonElement | null;
  const undo = el.closest('[data-undo]') as HTMLButtonElement | null;
  const copy = el.closest('[data-copy]') as HTMLButtonElement | null;
  const mail = el.closest('[data-email]') as HTMLButtonElement | null;
  const edit = el.closest('[data-edit]') as HTMLButtonElement | null;
  const save = el.closest('[data-save]') as HTMLButtonElement | null;
  if (edit) {
    const box = document.querySelector(`[data-editbox="${edit.dataset.edit}"]`) as HTMLElement;
    box.hidden = !box.hidden;
  }
  if (save) {
    const ref = save.dataset.save!;
    const box = document.querySelector(`[data-editbox="${ref}"]`) as HTMLElement;
    const f = (k: string) => (box.querySelector(`[data-f="${k}"]`) as HTMLInputElement).value;
    save.disabled = true;
    try {
      await call({ action: 'edit_order', ref, name: f('name'), phone: f('phone'), email: f('email') });
      const byCode = new Map<string, any>();
      box.querySelectorAll<HTMLInputElement>('[data-code]').forEach((inp) => {
        const row = byCode.get(inp.dataset.code!) || { code: inp.dataset.code };
        row[inp.dataset.tf!] = inp.value;
        byCode.set(inp.dataset.code!, row);
      });
      const order = orders.find((o) => o.ref === ref)!;
      for (const row of byCode.values()) {
        const t = order.ugh_tickets.find((x) => x.code === row.code)!;
        if ((row.guest_name ?? '') !== (t.guest_name || '') || ('table_name' in row && row.table_name !== (t.table_name || '')))
          await call({ action: 'edit_ticket', ...row });
      }
      toast('Saved');
      await load();
    } catch (ex: any) {
      toast(ex.message);
      save.disabled = false;
    }
  }
  if (mail) {
    mail.disabled = true;
    try {
      await call({ action: 'resend_email', ref: mail.dataset.email });
      toast('Email sent');
      await load();
    } catch (ex: any) {
      toast(ex.message);
      mail.disabled = false;
    }
  }
  if (re) {
    re.disabled = true;
    re.textContent = 'Checking';
    try {
      const r = await call({ action: 'recheck', ref: re.dataset.recheck });
      toast(r.status === 'paid' ? 'Paid. Tickets issued.' : r.status === 'review' ? 'Paid amount did not match. Check Paystack.' : 'Paystack says not paid yet');
      await load();
    } catch (ex: any) {
      toast(ex.message);
      re.disabled = false;
    }
  }
  if (undo) {
    if (!confirm(`Undo check-in for ${undo.dataset.undo}? It can then be scanned again.`)) return;
    try {
      await call({ action: 'undo_checkin', code: undo.dataset.undo });
      toast('Check-in undone');
      await load();
    } catch (ex: any) {
      toast(ex.message);
    }
  }
  if (copy) {
    try {
      await navigator.clipboard.writeText(copy.dataset.copy!);
      toast('Link copied');
    } catch {
      prompt('Copy this link', copy.dataset.copy);
    }
  }
});

// ---------- event form ----------
function toLocalInput(iso: string) {
  const d = new Date(new Date(iso).getTime() + 3600 * 1000); // Nigeria is UTC+1 all year
  return d.toISOString().slice(0, 16);
}

function fillForm() {
  const s = settings;
  $<HTMLInputElement>('e-title').value = s.title;
  $<HTMLInputElement>('e-short').value = s.short_title || '';
  $<HTMLInputElement>('e-pin').value = s.door_pin || '';
  $<HTMLInputElement>('e-nr').value = s.note_regular ?? '1 person';
  $<HTMLInputElement>('e-nv').value = s.note_vip ?? '';
  $<HTMLInputElement>('e-nvv').value = s.note_vvip ?? '';
  $<HTMLInputElement>('e-organizer').value = s.organizer;
  $<HTMLInputElement>('e-date').value = toLocalInput(s.starts_at);
  $<HTMLInputElement>('e-phone').value = s.contact_phone;
  $<HTMLInputElement>('e-venue').value = s.venue;
  $<HTMLInputElement>('e-area').value = s.venue_area;
  $<HTMLTextAreaElement>('e-about').value = s.about;
  $<HTMLTextAreaElement>('e-high').value = (s.highlights || []).join('\n');
  $<HTMLInputElement>('e-pr').value = s.price_regular;
  $<HTMLInputElement>('e-pv').value = s.price_vip;
  $<HTMLInputElement>('e-pvv').value = s.price_vvip;
  $<HTMLInputElement>('e-closed').value = s.closed_note;
}

$('ev-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('ev-msg');
  msg.hidden = true;
  const v = (id: string) => $<HTMLInputElement>(id).value;
  const date = v('e-date');
  const patch = {
    title: v('e-title').trim(),
    short_title: v('e-short').trim(),
    door_pin: v('e-pin').trim(),
    note_regular: v('e-nr').trim(),
    note_vip: v('e-nv').trim(),
    note_vvip: v('e-nvv').trim(),
    organizer: v('e-organizer').trim(),
    starts_at: date ? `${date}:00+01:00` : settings.starts_at,
    contact_phone: v('e-phone').trim(),
    venue: v('e-venue').trim(),
    venue_area: v('e-area').trim(),
    about: v('e-about').trim(),
    highlights: v('e-high').split('\n').map((x) => x.trim()).filter(Boolean),
    price_regular: Number(v('e-pr')),
    price_vip: Number(v('e-pv')),
    price_vvip: Number(v('e-pvv')),
    closed_note: v('e-closed').trim(),
  };
  if (!patch.title) {
    msg.className = 'msg msg-error';
    msg.textContent = 'The event needs a name.';
    msg.hidden = false;
    return;
  }
  const btn = $<HTMLButtonElement>('ev-save');
  btn.disabled = true;
  try {
    const res = await call({ action: 'save', patch });
    settings = res.settings;
    renderAll();
    toast('Saved. The public page is updated.');
  } catch (ex: any) {
    msg.className = 'msg msg-error';
    msg.textContent = ex.message;
    msg.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

// ---------- add tickets by hand ----------
let method = 'cash';
$('m-method').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button[data-m]') as HTMLElement | null;
  if (!b) return;
  method = b.dataset.m!;
  document.querySelectorAll('#m-method button').forEach((x) => x.classList.toggle('on', x === b));
  manualTotal();
});
function mq(id: string) {
  return Math.max(0, Math.floor(Number($<HTMLInputElement>(id).value) || 0));
}
function manualTotal() {
  if (!settings) return;
  const face = mq('m-regular') * settings.price_regular + mq('m-vip') * settings.price_vip + mq('m-vvip') * settings.price_vvip;
  $('m-total').textContent = method === 'free' ? `Free tickets (worth ${naira(face)}), not counted as sales` : `Total to collect: ${naira(face)}`;
}
['m-regular', 'm-vip', 'm-vvip'].forEach((id) => $(id).addEventListener('input', manualTotal));

$('manual-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('m-err');
  err.hidden = true;
  const btn = $<HTMLButtonElement>('m-btn');
  btn.disabled = true;
  try {
    const name = $<HTMLInputElement>('m-name').value;
    const phone = $<HTMLInputElement>('m-phone').value;
    const res = await call({
      action: 'manual_order',
      name,
      phone,
      email: $<HTMLInputElement>('m-email').value,
      method,
      items: { regular: mq('m-regular'), vip: mq('m-vip'), vvip: mq('m-vvip') },
    });
    const link = `${location.origin}/ticket?ref=${res.ref}`;
    const msg = `Hello ${name.trim().split(' ')[0]}, here are your Ughelli Wrap-Up e-tickets: ${link}`;
    const done = $('m-done');
    done.innerHTML = `<b>Tickets created for ${esc(name)}.</b><span>Send them the link so they can save their QR tickets.</span>
      <div class="b-actions"><a class="btn btn-primary sm" target="_blank" rel="noopener" href="https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(msg)}">Send on WhatsApp</a>
      <a class="btn btn-line sm" target="_blank" rel="noopener" href="${link}">Open tickets</a></div>`;
    done.hidden = false;
    (e.target as HTMLFormElement).reset();
    manualTotal();
    await load();
  } catch (ex: any) {
    err.textContent = ex.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

// ---------- download list ----------
$('csv').addEventListener('click', () => {
  const rows = [['Ticket code', 'Type', 'Seat', 'Table', 'Name on ticket', 'Buyer', 'Phone', 'Email', 'Payment', 'Paid at', 'Checked in at', 'Checked in by']];
  for (const o of orders) {
    if (o.status !== 'paid') continue;
    for (const t of o.ugh_tickets) {
      rows.push([
        t.code,
        KIND_LABEL[t.kind],
        t.seat ? `${t.seat} of 4` : '',
        t.table_name || '',
        t.guest_name || o.name,
        o.name,
        o.phone,
        o.email,
        o.is_test ? 'test' : o.channel === 'free' ? 'free' : isManual(o) ? o.channel || '' : 'online',
        o.paid_at ? fmtDate(o.paid_at, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '',
        t.checked_in_at ? fmtDate(t.checked_in_at, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '',
        t.checked_in_by || '',
      ]);
    }
  }
  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ughelli-wrapup-tickets.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
});

// ---------- boot ----------
const savedTab = store.get('ugh_admin_tab');
if (savedTab) (document.querySelector(`#tabs [data-tab="${savedTab}"]`) as HTMLElement | null)?.click();
if (key) load().catch(() => ($('v-login').hidden = false));
setInterval(() => {
  if (key && !document.hidden && $('v-app').hidden === false) {
    call({ action: 'load' })
      .then((res) => {
        settings = res.settings;
        orders = res.orders;
        renderSwitches();
        renderOverview();
        const open = document.querySelector('#buyers details[open]');
        if (!open && document.activeElement?.id !== 'search') renderBuyers();
      })
      .catch(() => {});
  }
}, 30000);
