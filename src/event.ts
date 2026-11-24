import './styles/base.css';
import './styles/event.css';
import { api, EventInfo, esc, fmtDate, Kind, KIND_LABEL, KIND_NOTE, longDate, naira, store, timeOf, waNumber, withFee } from './lib/common';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const DEFAULT: EventInfo = {
  title: 'Ughelli Regional Choir End of Year Annual Wrap-Up',
  organizer: 'St. Cecilia Choir Warri Diocese, Ughelli Region',
  about:
    'One full day for the Ughelli Region choir family to close the year together. Good food at the love feast, a swim, a match on the pitch, table tennis, snooker and a dancing competition to settle who really has the moves. Come with your choir, come with your friends.',
  venue: 'Jaylayians Amusement Resort',
  venue_area: '',
  starts_at: '2026-12-12T09:00:00Z',
  highlights: ['Love feast', 'Swimming', 'Soccer', 'Table tennis', 'Dancing competition', 'Snooker', 'Fun and games'],
  contact_phone: '0806 625 5265',
  prices: { regular: 8000, vip: 30000, vvip: 50000, test: 100 },
  sales_open: true,
  test_mode: false,
  closed_note: '',
};

const DEFAULT_HERO = 'https://images.unsplash.com/photo-1768243803432-f95b00d29de2?w=1400&q=70&auto=format';
const showTest = new URLSearchParams(location.search).get('test') === '1';
let info: EventInfo = DEFAULT;
const qty: Record<Kind, number> = { regular: 0, vip: 0, vvip: 0, test: 0 };
const MAX = 10;
const guestNames: Record<string, string> = {};


function kinds(): Kind[] {
  const list: Kind[] = ['regular', 'vip', 'vvip'];
  if (showTest && info.test_mode) list.push('test');
  return list;
}

function canBuy(k: Kind): boolean {
  return k === 'test' ? info.test_mode : info.sales_open;
}

function renderInfo() {
  document.title = `${info.title} · ${fmtDate(info.starts_at, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}`;
  $('title').textContent = info.title;
  $('org').textContent = info.organizer;
  $('date-line').textContent = longDate(info.starts_at);
  $('time-line').textContent = timeOf(info.starts_at);
  $('venue').textContent = info.venue;
  $('venue-area').textContent = info.venue_area;
  $('area-pill').hidden = !info.venue_area;
  $('hero').style.backgroundImage = `url("${(info.hero_image || DEFAULT_HERO).replace(/"/g, '%22')}")`;
  $('about').textContent = info.about;
  $('highlights').innerHTML = info.highlights.map((h) => `<li>${esc(h)}</li>`).join('');

  const phone = info.contact_phone.trim();
  $('contact-line').textContent = phone ? `Questions? Call or WhatsApp ${phone}` : 'Questions? Reach the organisers through your choir.';
  const wa = waNumber(phone);
  ($('wa-link') as HTMLAnchorElement).href = `https://wa.me/${wa}`;
  ($('call-link') as HTMLAnchorElement).href = `tel:+${wa}`;
  ($('wa-link').parentElement as HTMLElement).hidden = !phone;

  const min = Math.min(info.prices.regular, info.prices.vip, info.prices.vvip);
  $('from').textContent = naira(min);

  const closed = $('closed');
  closed.hidden = info.sales_open;
  closed.textContent = info.closed_note || 'Ticket sales are closed right now.';
  $('stubs').classList.toggle('off', !info.sales_open && !(showTest && info.test_mode));
}

function renderStubs() {
  $('stubs').innerHTML = kinds()
    .map(
      (k) => `
      <div class="stub ${k}" data-k="${k}">
        <div class="stub-main">
          <div class="stub-name"><span>${KIND_LABEL[k]}</span>${k === 'vip' || k === 'vvip' ? '<span class="stub-badge">Admits 4</span>' : ''}</div>
          <div class="stub-note">${KIND_NOTE[k]}</div>
          <div class="stub-price">${naira(info.prices[k])}</div>
        </div>
        <div class="stub-side">
          <div class="step">
            <button type="button" data-d="-1" aria-label="Remove one ${KIND_LABEL[k]}">&minus;</button>
            <output aria-live="polite">0</output>
            <button type="button" data-d="1" aria-label="Add one ${KIND_LABEL[k]}">+</button>
          </div>
        </div>
      </div>`,
    )
    .join('');
  syncStubs();
}

function syncStubs() {
  document.querySelectorAll<HTMLElement>('.stub').forEach((el) => {
    const k = el.dataset.k as Kind;
    const n = qty[k];
    el.classList.toggle('on', n > 0);
    el.querySelector('output')!.textContent = String(n);
    const [minus, plus] = el.querySelectorAll('button');
    (minus as HTMLButtonElement).disabled = n <= 0;
    const otherSelected = k === 'test' ? qty.regular + qty.vip + qty.vvip > 0 : qty.test > 0;
    (plus as HTMLButtonElement).disabled = n >= (k === 'test' ? 1 : MAX) || !canBuy(k) || otherSelected;
  });

  const subtotal = kinds().reduce((sum, k) => sum + qty[k] * info.prices[k], 0);
  const { fee, total } = withFee(subtotal);
  $('subtotal').textContent = naira(subtotal);
  $('fee').textContent = naira(fee);
  renderGuests();
  const count = kinds().reduce((sum, k) => sum + qty[k], 0);
  const people = qty.regular + qty.test + (qty.vip + qty.vvip) * 4;
  $('total').textContent = naira(total);
  $('count-line').textContent = count
    ? `${count} ticket${count > 1 ? 's' : ''} · ${people} ${people > 1 ? 'people' : 'person'}`
    : 'No tickets yet';
  const pay = $<HTMLButtonElement>('pay');
  if (!pay.dataset.busy) {
    pay.disabled = count === 0;
    pay.textContent = count ? `Pay ${naira(total)}` : 'Choose your tickets';
  }
  $('mbar-label').textContent = count ? `${count} ticket${count > 1 ? 's' : ''}` : 'From';
  $('mbar-amt').textContent = count ? naira(total) : $('from').textContent || '';
  $('mbar-btn').textContent = count ? 'Checkout' : 'Get tickets';
}

function renderGuests() {
  const list: { key: string; label: string }[] = [];
  (['regular', 'vip', 'vvip', 'test'] as Kind[]).forEach((k) => {
    for (let i = 0; i < qty[k]; i++) {
      const n = qty[k] > 1 ? ` ${i + 1}` : '';
      const label =
        k === 'regular' ? `Regular ticket${n}: guest name` : k === 'test' ? 'Test ticket: name' : `${KIND_LABEL[k]}${n}: table name or host`;
      list.push({ key: `${k}-${i}`, label });
    }
  });
  const box = $('guests');
  const wrap = $('guest-fields');
  const sig = list.map((x) => x.key).join(',');
  if (wrap.dataset.sig === sig) return;
  wrap.dataset.sig = sig;
  box.hidden = list.length < 2 && !list.some((x) => !x.key.startsWith('regular') && !x.key.startsWith('test'));
  wrap.innerHTML = list
    .map(
      (x) => `<div class="field"><label for="g-${x.key}">${esc(x.label)}</label>
      <input class="input" id="g-${x.key}" data-key="${x.key}" maxlength="60" value="${esc(guestNames[x.key] || '')}" placeholder="${x.key.startsWith('vip') || x.key.startsWith('vvip') ? 'e.g. St. Mary\'s Choir table' : 'Your name if left empty'}" /></div>`,
    )
    .join('');
}

$('guest-fields').addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.dataset.key) guestNames[el.dataset.key] = el.value;
});

function namesPayload(): Record<Kind, string[]> {
  const out = { regular: [], vip: [], vvip: [], test: [] } as Record<Kind, string[]>;
  (Object.keys(out) as Kind[]).forEach((k) => {
    for (let i = 0; i < qty[k]; i++) out[k].push((guestNames[`${k}-${i}`] || '').trim());
  });
  return out;
}

$('stubs').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button[data-d]') as HTMLButtonElement | null;
  if (!btn || btn.disabled) return;
  const k = (btn.closest('.stub') as HTMLElement).dataset.k as Kind;
  qty[k] = Math.max(0, Math.min(k === 'test' ? 1 : MAX, qty[k] + Number(btn.dataset.d)));
  syncStubs();
});

// ---------- countdown ----------
function tick() {
  const start = new Date(info.starts_at).getTime();
  const diff = start - Date.now();
  const done = $('cd-done');
  if (diff <= 0) {
    $('countdown').hidden = true;
    done.hidden = false;
    const endOfDay = start + 14 * 3600 * 1000;
    done.textContent = Date.now() < endOfDay ? 'It is happening today. See you at the resort.' : 'That is a wrap. Thank you for coming.';
    return;
  }
  $('countdown').hidden = false;
  done.hidden = true;
  const s = Math.floor(diff / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  $('cd-d').textContent = pad(Math.floor(s / 86400));
  $('cd-h').textContent = pad(Math.floor((s % 86400) / 3600));
  $('cd-m').textContent = pad(Math.floor((s % 3600) / 60));
  $('cd-s').textContent = pad(s % 60);
}
setInterval(tick, 1000);

// ---------- mobile bar ----------
const mbar = $('mbar');
const box = $('tickets');
new IntersectionObserver(
  ([entry]) => {
    mbar.classList.toggle('away', entry.isIntersecting);
  },
  { threshold: 0.12 },
).observe(box);
$('mbar-btn').addEventListener('click', () => {
  const count = kinds().reduce((sum, k) => sum + qty[k], 0);
  (count ? $('buyer') : box).scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ---------- checkout ----------
const saved = (() => {
  try {
    return JSON.parse(store.get('ugh_buyer') || '{}');
  } catch {
    return {};
  }
})();
(['name', 'phone', 'email'] as const).forEach((f) => {
  if (saved[f]) $<HTMLInputElement>(`f-${f}`).value = saved[f];
});

$('buyer').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('err');
  err.hidden = true;
  const name = $<HTMLInputElement>('f-name').value.trim();
  const phone = $<HTMLInputElement>('f-phone').value.trim();
  const email = $<HTMLInputElement>('f-email').value.trim();
  const fail = (m: string, focus?: string) => {
    err.textContent = m;
    err.hidden = false;
    if (focus) $(focus).focus();
  };
  if (name.length < 2) return fail('Please enter your full name.', 'f-name');
  if (phone.replace(/\D/g, '').length < 10) return fail('Please enter a valid phone number.', 'f-phone');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail('Please enter a valid email address.', 'f-email');

  store.set('ugh_buyer', JSON.stringify({ name, phone, email }));
  const pay = $<HTMLButtonElement>('pay');
  pay.dataset.busy = '1';
  pay.disabled = true;
  pay.innerHTML = '<span class="spinner"></span> Opening Paystack';
  try {
    const res = await api<{ ref: string; url: string }>('/api/order', { json: { name, phone, email, items: qty, names: namesPayload() } });
    store.set('ugh_last_ref', res.ref);
    location.href = res.url;
  } catch (ex: any) {
    delete pay.dataset.busy;
    syncStubs();
    fail(ex.message || 'Could not start payment. Please try again.');
  }
});

// Back button from Paystack restores the page from cache with a busy button. Reset it.
window.addEventListener('pageshow', (e) => {
  if (e.persisted) {
    delete $('pay').dataset.busy;
    syncStubs();
  }
});

// ---------- boot ----------
renderInfo();
renderStubs();
tick();
api<EventInfo>('/api/event')
  .then((data) => {
    info = data;
    renderInfo();
    renderStubs();
    tick();
  })
  .catch(() => {
    /* keep defaults on screen */
  });
