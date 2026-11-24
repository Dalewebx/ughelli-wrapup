import './styles/base.css';
import './styles/ticket.css';
import { api, EventInfo, esc, mapLink, store, Ticket } from './lib/common';
import { downloadBlob, EventBits, saveTicketImage, ticketCard, ticketPng } from './lib/tickets';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

type Order = { ref: string; name: string; tickets: Ticket[] };

let ev: EventBits = {
  title: 'Ughelli Regional Choir End of Year Annual Wrap-Up',
  venue: 'Jaylayians Amusement Resort',
  starts_at: '2026-12-12T09:00:00Z',
};
let helpPhone = '0806 625 5265';
let shown: Order[] = [];

// Every paid order bought on this phone, so all of them show up together, no matter how long ago.
function savedRefs(): string[] {
  try {
    const list = JSON.parse(store.get('ugh_refs') || '[]');
    return Array.isArray(list) ? list.filter((r) => typeof r === 'string') : [];
  } catch {
    return [];
  }
}
function rememberRef(ref: string) {
  const list = savedRefs().filter((r) => r !== ref);
  list.unshift(ref);
  store.set('ugh_refs', JSON.stringify(list.slice(0, 30)));
}
function forgetRef(ref: string) {
  store.set('ugh_refs', JSON.stringify(savedRefs().filter((r) => r !== ref)));
}

const views = ['v-wait', 'v-pending', 'v-tickets', 'v-find'];
function show(id: string) {
  views.forEach((v) => ($(v).hidden = v !== id));
  window.scrollTo({ top: 0 });
}

function setStep(n: number) {
  document.querySelectorAll<HTMLElement>('#steps li').forEach((li) => {
    const s = Number(li.dataset.s);
    li.classList.toggle('done', s < n || n === 3);
    li.classList.toggle('now', s === n);
  });
}

async function renderOrders(orders: Order[]) {
  shown = orders;
  const grid = $('tk-grid');
  const first = (orders[0]?.name || '').split(/\s+/)[0];
  $('hello').textContent = first ? `You're in, ${first}` : "You're in";
  const html: string[] = [];
  for (const o of orders) {
    if (orders.length > 1) html.push(`<div class="order-label" style="grid-column:1/-1">Order ${esc(o.ref.slice(-6))}</div>`);
    let i = 0;
    for (const t of o.tickets) {
      i++;
      html.push(await ticketCard(t, t.guest_name || o.name, ev, i, o.tickets.length));
    }
  }
  grid.innerHTML = html.join('');
  show('v-tickets');
}

function findTicket(code: string): { t: Ticket; o: Order; i: number } | null {
  for (const o of shown) {
    const i = o.tickets.findIndex((t) => t.code === code);
    if (i >= 0) return { t: o.tickets[i], o, i: i + 1 };
  }
  return null;
}

$('tk-grid').addEventListener('click', async (e) => {
  const btn = (e.target as HTMLElement).closest('.tk-save') as HTMLButtonElement | null;
  if (!btn) return;
  const hit = findTicket(btn.dataset.code!);
  if (!hit) return;
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Preparing image';
  try {
    const blob = await ticketPng(hit.t, hit.t.guest_name || hit.o.name, ev, hit.i, hit.o.tickets.length);
    await saveTicketImage(blob, `ticket-${hit.t.code}.png`);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
});

$('save-all').addEventListener('click', async () => {
  const btn = $<HTMLButtonElement>('save-all');
  btn.disabled = true;
  try {
    for (const o of shown) {
      let i = 0;
      for (const t of o.tickets) {
        i++;
        const blob = await ticketPng(t, t.guest_name || o.name, ev, i, o.tickets.length);
        downloadBlob(blob, `ticket-${t.code}.png`);
        await new Promise((r) => setTimeout(r, 450));
      }
    }
  } finally {
    btn.disabled = false;
  }
});

$('find-other').addEventListener('click', () => {
  history.replaceState(null, '', '/ticket?find=1');
  show('v-find');
});

// ---------- after payment ----------
async function waitForPayment(ref: string) {
  show('v-wait');
  setStep(0);
  const started = Date.now();
  let attempt = 0;
  while (Date.now() - started < 75000) {
    attempt++;
    try {
      const res = await api<{ status: string; order: any; tickets: Ticket[] }>(`/api/verify?ref=${encodeURIComponent(ref)}`);
      if (res.status === 'paid') {
        setStep(1);
        await new Promise((r) => setTimeout(r, 400));
        setStep(3);
        rememberRef(ref);
        store.del('ugh_last_ref');
        await new Promise((r) => setTimeout(r, 350));
        await renderOrders([{ ref, name: res.order.name, tickets: res.tickets }]);
        return;
      }
      if (res.status === 'review') {
        pending(ref, 'Your payment needs a quick manual check by the organisers. Please message them with the reference below.');
        return;
      }
    } catch (e: any) {
      if (e.status === 404) {
        pending(ref, 'We could not find this order. If you paid, contact the organisers with the reference below.');
        return;
      }
    }
    if (attempt === 4) $('wait-note').textContent = 'Still waiting for Paystack. This can take up to a minute on slow networks.';
    await new Promise((r) => setTimeout(r, Math.min(2000 + attempt * 500, 5000)));
  }
  pending(ref);
}

let pendingTimer = 0;
function pending(ref: string, note?: string) {
  if (note) $('pending-note').textContent = note;
  $('pending-help').innerHTML = `Reference: <b>${esc(ref)}</b><br>Help: call or WhatsApp ${esc(helpPhone)}`;
  show('v-pending');
  $('pending-retry').onclick = () => waitForPayment(ref);
  clearInterval(pendingTimer);
  if (!note) {
    pendingTimer = window.setInterval(async () => {
      try {
        const res = await api(`/api/verify?ref=${encodeURIComponent(ref)}`);
        if (res.status === 'paid') {
          clearInterval(pendingTimer);
          waitForPayment(ref);
        }
      } catch {
        /* keep trying */
      }
    }, 15000);
  }
}

// ---------- find ----------
$('find-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('find-err');
  const ok = $('find-ok');
  err.hidden = true;
  ok.hidden = true;
  const query = $<HTMLInputElement>('q').value.trim();
  const btn = $<HTMLButtonElement>('find-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Sending';
  try {
    const res = await api<{ found: number; to: string[] }>('/api/find', { json: { query } });
    if (!res.found) {
      err.textContent = `We couldn't find paid tickets for that. Check the number or email you used, or call ${helpPhone}.`;
      err.hidden = false;
    } else {
      ok.textContent = `Done. Your tickets have been sent to ${res.to.join(' and ')}. Check your inbox, and your spam folder too.`;
      ok.hidden = false;
    }
  } catch (ex: any) {
    err.textContent = ex.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send my tickets';
  }
});

// ---------- boot ----------
async function loadEvent() {
  try {
    const info = await api<EventInfo>('/api/event');
    ev = { title: info.title, venue: info.venue, starts_at: info.starts_at };
    ($('dir-link') as HTMLAnchorElement).href = mapLink(info.venue, info.venue_area, info.map_url);
    helpPhone = info.contact_phone || helpPhone;
    $('help-line').textContent = `Help: ${helpPhone}`;
  } catch {
    /* defaults */
  }
}

(async () => {
  const p = new URLSearchParams(location.search);
  const ref = (p.get('ref') || p.get('reference') || p.get('trxref') || '').trim();
  const eventLoad = loadEvent();
  if (ref) {
    await eventLoad;
    return waitForPayment(ref);
  }
  if (p.get('find')) return show('v-find');
  // A payment started on this phone that may have been confirmed later by Paystack.
  const pending = store.get('ugh_last_ref');
  const refs = savedRefs();
  if (pending && !refs.includes(pending)) refs.push(pending);
  if (refs.length) {
    await eventLoad;
    const results = await Promise.all(
      refs.map(async (r) => {
        try {
          const res = await api(`/api/verify?ref=${encodeURIComponent(r)}`);
          if (res.status === 'paid') {
            rememberRef(r);
            if (r === pending) store.del('ugh_last_ref');
            return { ref: r, name: res.order.name, tickets: res.tickets, paidAt: res.order.paid_at || '' } as Order & { paidAt: string };
          }
        } catch (e: any) {
          if (e?.status === 404) {
            forgetRef(r);
            if (r === pending) store.del('ugh_last_ref');
          }
        }
        return null;
      }),
    );
    const paid = results.filter(Boolean) as (Order & { paidAt: string })[];
    paid.sort((a, b) => (a.paidAt < b.paidAt ? 1 : -1));
    if (paid.length) return renderOrders(paid);
  }
  show('v-find');
})();
