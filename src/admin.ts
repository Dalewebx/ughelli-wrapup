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
  $('v-login').hidden = true;
  $('v-app').hidden = false;
  renderAll();
}

function renderAll() {
  renderSwitches();
  renderOverview();
  renderBuyers();
  fillForm();
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
function sum(list: Order[], f: (o: Order) => number) {
  return list.reduce((s, o) => s + (f(o) || 0), 0);
}

function renderOverview() {
  const paid = orders.filter((o) => o.status === 'paid' && !o.is_test);
  const gross = sum(paid, (o) => o.amount);
  const fees = sum(paid, (o) => o.paystack_fee ?? 0);
  const settle = sum(paid, (o) => o.subaccount_share ?? o.amount - (o.paystack_fee ?? 0));
  const tickets = paid.flatMap((o) => o.ugh_tickets);
  const people = tickets.reduce((s, t) => s + t.admits, 0);

  $('stats').innerHTML = [
    ['Total paid', nairaKobo(gross), `${paid.length} order${paid.length === 1 ? '' : 's'}`, 'hero'],
    ['Paystack fees', nairaKobo(fees), 'Paid by the region (subaccount)', ''],
    ['Settles to region', nairaKobo(settle), 'After fees', ''],
    ['Guests', String(people), `${tickets.length} ticket${tickets.length === 1 ? '' : 's'}`, ''],
  ]
    .map(([l, v, s, c]) => `<div class="stat ${c}"><small>${l}</small><b>${v}</b><span>${s}</span></div>`)
    .join('');

  const kinds: Kind[] = ['regular', 'vip', 'vvip'];
  const rows = kinds.map((k) => {
    const count = sum(paid, (o) => o.items[k] || 0);
    const price = settings[`price_${k}`];
    const rev = paid.reduce((s, o) => s + (o.items[k] || 0), 0) * price;
    return { k, count, people: count * (k === 'regular' ? 1 : 4), rev };
  });
  $('by-type').innerHTML =
    `<tr><th>Type</th><th class="n">Sold</th><th class="n">People</th><th class="n">At today's price</th></tr>` +
    rows.map((r) => `<tr><td>${KIND_LABEL[r.k]}</td><td class="n">${r.count}</td><td class="n">${r.people}</td><td class="n">${naira(r.rev)}</td></tr>`).join('') +
    `<tr><td>Total</td><td class="n">${sum(rows as any, (r: any) => r.count)}</td><td class="n">${people}</td><td class="n">${nairaKobo(gross)}</td></tr>`;

  const inT = tickets.filter((t) => t.checked_in_at);
  const inP = inT.reduce((s, t) => s + t.admits, 0);
  const pct = people ? Math.round((inP / people) * 100) : 0;
  const lastIn = inT.map((t) => t.checked_in_at!).sort().pop();
  $('checkins').innerHTML = `
    <div class="kv"><span>People in</span><b>${inP} of ${people}</b></div>
    <div class="bar"><i style="width:${pct}%"></i></div>
    <div class="kv"><span>Tickets scanned</span><b>${inT.length} of ${tickets.length}</b></div>
    <div class="kv"><span>Tables arrived</span><b>${inT.filter((t) => t.kind !== 'regular').length} of ${tickets.filter((t) => t.kind !== 'regular').length}</b></div>
    <div class="kv"><span>Last scan</span><b>${lastIn ? fmtDate(lastIn, { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' }) : 'None yet'}</b></div>`;

  const tests = orders.filter((o) => o.is_test && o.status === 'paid');
  $('test-card').hidden = !tests.length;
  $('test-box').innerHTML = tests
    .map(
      (o) => `
      <div class="kv"><span>${esc(o.name)} · ${fmtDate(o.paid_at!, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span><b>${nairaKobo(o.amount)}</b></div>
      <div class="kv"><span>Paystack fee</span><b>${nairaKobo(o.paystack_fee ?? 0)}</b></div>
      <div class="kv"><span>To region subaccount</span><b>${nairaKobo(o.subaccount_share ?? 0)}</b></div>
      <div class="kv"><span>Kept on main account</span><b>${nairaKobo(o.main_share ?? 0)}</b></div>`,
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
      o.ugh_tickets.some((t) => t.code.toLowerCase().includes(q))
    );
  });
  $('buyers-count').textContent = `${list.length} order${list.length === 1 ? '' : 's'}`;
  $('buyers').innerHTML = list
    .slice(0, 400)
    .map((o) => {
      const link = `${location.origin}/ticket?ref=${o.ref}`;
      const msg = `Hello ${o.name.split(' ')[0]}, here are your Ughelli Wrap-Up e-tickets: ${link}`;
      const stText = o.status === 'paid' ? 'Paid' : o.status === 'review' ? 'Needs review' : 'Not paid';
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
            ${o.status === 'paid' ? `<span>Paystack fee ${nairaKobo(o.paystack_fee ?? 0)} · To region ${nairaKobo(o.subaccount_share ?? 0)}${o.channel ? ` · ${esc(o.channel)}` : ''}</span>` : ''}
            <span>Ref: ${esc(o.ref)}</span>
          </div>
          <div class="b-tix">
            ${o.ugh_tickets
              .map(
                (t) => `<div class="b-tk"><span><code>${t.code}</code> · ${KIND_LABEL[t.kind]}${t.admits > 1 ? ` (admits ${t.admits})` : ''}</span>
                ${t.checked_in_at ? `<span><span class="in">In ${fmtDate(t.checked_in_at, { hour: 'numeric', minute: '2-digit' })}${t.checked_in_by ? ` by ${esc(t.checked_in_by)}` : ''}</span> <button class="linkbtn" data-undo="${t.code}" type="button">Undo</button></span>` : '<span class="muted">Not in yet</span>'}</div>`,
              )
              .join('')}
          </div>
          <div class="b-actions">
            ${o.status !== 'paid' ? `<button class="btn btn-primary sm" type="button" data-recheck="${o.ref}">Recheck with Paystack</button>` : ''}
            ${o.status === 'paid' ? `<a class="btn btn-soft sm" target="_blank" rel="noopener" href="https://wa.me/${waNumber(o.phone)}?text=${encodeURIComponent(msg)}">Send tickets on WhatsApp</a>
            <button class="btn btn-line sm" type="button" data-copy="${link}">Copy ticket link</button>` : ''}
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
