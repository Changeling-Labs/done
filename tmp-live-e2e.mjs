import { chromium } from 'playwright';

const base = 'https://changelinglabs.com/done/';
const browser = await chromium.launch();
const errors = [];

const newPage = async (label) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label} console: ${m.text()}`); });
  page.on('dialog', (d) => d.accept());
  return { ctx, page };
};

const a = await newPage('A');
await a.page.goto(base, { waitUntil: 'networkidle' });
await a.page.waitForSelector('form[data-form="start"]');
console.log('A landed:', await a.page.getAttribute('body', 'data-view'));

await a.page.fill('form[data-form="start"] input[name="title"]', 'Backend test');
await a.page.fill('form[data-form="start"] input[name="name"]', 'Edmund');
await a.page.click('form[data-form="start"] button[type="submit"]');
await a.page.waitForFunction(() => document.body.dataset.view === 'room', null, { timeout: 20000 });
const code = (await a.page.textContent('.code-chip-value')).replace(/\s/g, '');
console.log('A room created, code:', code);
console.log('A round:', (await a.page.textContent('.round-count strong')).trim());
console.log('A table:', await a.page.locator('.person').count());

const identity = await a.page.evaluate(() => JSON.parse(localStorage.getItem('done.identity.v1')));
console.log('A identity room:', identity.roomId.slice(0, 8) + '…');

const b = await newPage('B');
await b.page.goto(base + '?code=' + code, { waitUntil: 'networkidle' });
await b.page.waitForSelector('.card-invite');
console.log('B invite landing first card:', await b.page.locator('main.stack > .card h2').first().textContent());
await b.page.fill('form[data-form="join"] input[name="name"]', 'Mum');
await b.page.click('form[data-form="join"] button[type="submit"]');
await b.page.waitForFunction(() => document.body.dataset.view === 'room', null, { timeout: 20000 });
console.log('B joined as:', (await b.page.textContent('.me-name')).trim());

await a.page.waitForFunction(() => document.querySelectorAll('.person').length === 2, null, { timeout: 15000 });
console.log('A sees players (realtime):', await a.page.locator('.person').count());

await a.page.click('[data-action="toggle-done"]');
await a.page.waitForTimeout(700);
await b.page.click('[data-action="toggle-done"]');
await a.page.waitForFunction(() => document.querySelector('.round-count strong')?.textContent.trim() === '2', null, { timeout: 15000 });
await b.page.waitForFunction(() => document.querySelector('.round-count strong')?.textContent.trim() === '2', null, { timeout: 15000 });
console.log('A round after both taps:', (await a.page.textContent('.round-count strong')).trim());
console.log('B round after both taps:', (await b.page.textContent('.round-count strong')).trim());
console.log('A toast:', (await a.page.textContent('#toast')).trim());
console.log('B toast:', (await b.page.textContent('#toast')).trim());

// Is notify-round deployed and happy?
const fn = await a.page.evaluate(async (roomId) => {
  const { supabaseClient } = await import('/done/js/store.js');
  const sb = supabaseClient();
  const { data, error } = await sb.functions.invoke('notify-round', { body: { room_id: roomId } });
  if (error) {
    return { ok: false, message: String(error.message), status: error.context?.status ?? null };
  }
  return { ok: true, data };
}, identity.roomId);
console.log('notify-round:', JSON.stringify(fn));

// Clean up: both leave, which deletes the last-member room.
await a.page.click('[data-action="leave"]');
await a.page.waitForTimeout(400);
await b.page.click('[data-action="leave"]');
await b.page.waitForTimeout(600);
console.log('A view after leave:', await a.page.getAttribute('body', 'data-view'));
console.log('B view after leave:', await b.page.getAttribute('body', 'data-view'));

console.log('errors:', errors.length ? errors : 'none');
await browser.close();
