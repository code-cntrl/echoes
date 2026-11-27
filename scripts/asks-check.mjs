// Headless Edge check of asking for feedback: Ava asks Dad and Sam about something she did, Sam (a
// kid) tries a grown-up style and answers with Kind Words, Dad puts it aside, and Ava sees who answered. Then an anonymous
// question to everyone: answers come without names, are held like any anonymous message, and Ava
// sees only how many arrived. Fails on any check or unexpected console error.
//   npm run test:asks -- [outputDir]   (screenshots and dark-above-light boards go there)
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { createApp } from '../src/server.js';

const outDir = resolve(process.argv[2] || 'screenshots/asks');
mkdirSync(outDir, { recursive: true });
const HOUR = 36e5;
// Start at 10:00 local time, so moving the clock on a few hours never crosses midnight.
const tenAm = new Date();
tenAm.setHours(10, 0, 0, 0);
let skew = tenAm.getTime() - Date.now();
const now = () => Date.now() + skew;
const hub = createApp({ dataPath: ':memory:', now: () => new Date(now()) });
const base = await new Promise((r) => hub.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${hub.address().port}`)));

function client() {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(cookie && { cookie }) }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = await res.json();
    if (!res.ok) throw new Error(`${method} ${path}: ${data.error}`);
    return data;
  };
}
const mom = client();
await mom('POST', '/api/setup', { familyName: 'The Lees', name: 'Mom', emoji: '👩' });
const dad = await mom('POST', '/api/members', { name: 'Dad', emoji: '👨', role: 'adult', isParent: true });
const ava = await mom('POST', '/api/members', { name: 'Ava', emoji: '🦊', role: 'adult' });
const sam = await mom('POST', '/api/members', { name: 'Sam', emoji: '👦', role: 'kid' });
// Each person keeps at most 20 sign-ins and the boards sign in many times, so a client whose
// sign-in was let go signs in again.
const as = async (id) => {
  const c = client();
  const login = () => c('POST', '/api/login', { memberId: id });
  await login();
  await c('POST', '/api/welcome');
  return async (...args) => c(...args).catch(async (e) => {
    if (!/sign in/.test(e.message)) throw e;
    await login();
    return c(...args);
  });
};
const dadC = await as(dad.id);
const avaC = await as(ava.id);
const samC = await as(sam.id);

// ---------- browser ----------
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
const failures = [];
let passed = 0;
const check = (ok, what) => { if (ok) passed += 1; else failures.push(what); };
const shots = {};
const SIZES = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  fold: { viewport: { width: 744, height: 900 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desk: { viewport: { width: 1440, height: 1000 } },
};

async function open(name, { scheme = 'light', size = 'phone', hash = '#/inbox' } = {}) {
  const ctx = await browser.newContext({ colorScheme: scheme, ...SIZES[size] });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}/${scheme}/${size}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${name}/${scheme}/${size}: ${e.message}`));
  if (process.env.DEBUG_ASKS) page.on('response', async (r) => { if (r.status() >= 400) console.log('DEBUG', r.request().method(), r.url(), r.request().postData(), await r.text()); });
  page.on('dialog', (d) => d.accept());
  await page.clock.install({ time: new Date(now()) });
  await page.goto(base);
  await page.getByText('Keep me signed in on this device').click();
  await page.locator('.tile', { hasText: name }).first().click();
  await page.locator('#nav a').first().waitFor();
  if (hash !== '#/inbox') await page.evaluate((h) => { location.hash = h; }, hash);
  return { ctx, page };
}
const top = (page) => page.evaluate(() => window.scrollTo(0, 0));
const badge = async (page, tab) => {
  const b = page.locator('#nav a', { hasText: tab }).locator('.badge');
  return (await b.count()) ? (await b.innerText()).trim() : '';
};
// One state at every size, dark and light, for its board.
async function board(key, name, hash, setup) {
  for (const size of Object.keys(SIZES)) {
    for (const scheme of ['dark', 'light']) {
      const { ctx, page } = await open(name, { scheme, size, hash });
      await setup(page, size);
      await page.mouse.move(0, 0);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${key} fits the ${size} width (${scheme})`);
      shots[`${key}-${size}-${scheme}`] = await page.screenshot();
      await ctx.close();
    }
  }
}
// Ava's question to Dad and Sam, filled in but not sent.
async function fillAsk(page) {
  await page.getByRole('radio', { name: 'Ask', exact: true }).click();
  await page.getByRole('heading', { name: 'Ask for feedback' }).waitFor();
  await page.getByRole('radio', { name: /A few people/ }).click();
  await page.locator('.tile', { hasText: 'Dad' }).click();
  await page.locator('.tile', { hasText: 'Sam' }).click();
  await page.fill('#ask-what', 'I ran the bake sale stall on Saturday.');
}

// 1. Ava asks Dad and Sam (Give, then Ask).
{
  const { ctx, page } = await open('Ava', { hash: '#/give' });
  await page.locator('.mode-switch').waitFor();
  check((await page.getByRole('radio', { name: 'Give', exact: true }).getAttribute('aria-checked')) === 'true', 'Give opens on Give');
  await page.getByRole('radio', { name: 'Ask', exact: true }).click();
  await page.getByRole('heading', { name: 'Ask for feedback' }).waitFor();
  check(await page.getByRole('button', { name: 'Ask', exact: true }).isDisabled(), 'Ask waits until someone is chosen');
  check((await page.getByText('How should they answer?').count()) === 0, 'styles appear once someone is chosen');
  await page.getByRole('radio', { name: /A few people/ }).click();
  await page.locator('.tile', { hasText: 'Dad' }).click();
  await page.locator('.tile', { hasText: 'Sam' }).click();
  check(!(await page.locator('.footnote', { hasText: 'more steps' }).count()), 'no hint for a style that suits kids');
  await page.locator('.model-tile', { hasText: 'DEAR MAN' }).click();
  check(/Sam is a kid\. DEAR MAN has more steps, so Kind Words or Glow & Grow might be easier for Sam\./.test(await page.locator('main').innerText()),
    'asking a kid with a grown-up style shows a gentle hint');
  await page.locator('.model-tile', { hasText: 'Glow & Grow' }).click();
  const anon = page.getByRole('checkbox', { name: /answer anonymously/ });
  check(await anon.isDisabled(), 'anonymous answers need 3 or more people');
  const summary = await page.locator('[data-form="ask"] p').first().innerText();
  if (process.env.DEBUG_ASKS) console.log('DEBUG summary', JSON.stringify(summary));
  check(/To Dad, Sam · 🌱 Glow & Grow/.test(summary), 'the summary names who and the style');
  await page.getByRole('button', { name: 'Ask 2 people' }).click();
  check((await page.locator('#ask-what:invalid').count()) === 1, '“What did you do?” is required');
  await page.fill('#ask-what', 'I ran the bake sale stall on Saturday.');
  await page.locator('.chip', { hasText: 'Both' }).click();
  check((await page.locator('#ask-what').inputValue()) === 'I ran the bake sale stall on Saturday.', 'the text stays when a chip is tapped');
  await page.reload();
  await page.getByRole('heading', { name: 'Ask for feedback' }).waitFor();
  check((await page.locator('#ask-what').inputValue()) === 'I ran the bake sale stall on Saturday.'
    && (await page.locator('.tile.selected').count()) === 2 && (await page.locator('.chip.selected').innerText()) === 'Both', 'the question is kept on reload');
  await page.getByRole('button', { name: 'Ask 2 people' }).click();
  await page.getByRole('heading', { name: 'Sent' }).waitFor();
  const q = page.locator('.asks-mine li', { hasText: 'bake sale' });
  await q.waitFor();
  check(/0\/2 answered/.test(await q.innerText()), 'Sent shows 0 of 2 answered');
  check(/waiting for Dad and Sam/.test(await q.innerText()), 'Sent says who it is waiting for');
  await ctx.close();
}
await board('ask', 'Ava', '#/give', async (page) => { await fillAsk(page); await top(page); });

// 2. Sam sees the question at the top of the Inbox; the badge counts it.
{
  const { ctx, page } = await open('Sam');
  const row = page.locator('.asks .item', { hasText: 'Ava' });
  await row.waitFor();
  check(/asked you/.test(await row.innerText()) && /bake sale stall/.test(await row.innerText()), 'Sam’s Inbox shows Ava’s question');
  check(/🌱 Glow & Grow · both/.test(await row.innerText()), 'Sam is asked to answer in the style Ava picked');
  check((await badge(page, 'Inbox')) === '1', 'the Inbox badge counts the question');
  await row.click();
  await page.locator('.ask-detail').waitFor();
  check(/What Ava did/i.test(await page.locator('.ask-detail').innerText()), 'on a phone the question opens in place');
  await page.getByRole('button', { name: 'Answer with Glow & Grow' }).click();
  await page.locator('.notice.answering').waitFor();
  check(/Answering Ava:/.test(await page.locator('.notice.answering').innerText()), 'Give says what Sam is answering');
  check(await page.locator('.tile.selected', { hasText: 'Ava' }).count() === 1, 'the answer goes to Ava');
  // Ghost text: a kid's worked example, and another one on request.
  const ghost = () => page.locator('#field-glow').getAttribute('placeholder');
  check((await ghost()) === 'You read me a really funny bedtime story.' && (await page.locator('#field-glow').inputValue()) === '', 'a kid sees a kid’s example as grey ghost text, not filled in');
  await page.getByRole('button', { name: /Show another \(1 of 2\)/ }).click();
  check((await ghost()) === 'You let me pick the music in the car.', 'Show another changes the example');
  check((await page.locator('.model-tile').count()) === 6, 'Sam can pick any style, grown-up ones included');
  await page.locator('.model-tile', { hasText: 'DEAR MAN' }).click();
  check(/more steps than the others/.test(await page.locator('[data-form="send"]').innerText()), 'a kid choosing a grown-up style gets a gentle hint');
  check((await page.locator('#field-describe').getAttribute('placeholder')) === 'At dinner you said I can’t have my phone, but my brother had his.', 'with a kid’s DEAR MAN example');
  await page.locator('.model-tile', { hasText: 'Kind Words' }).click();
  await page.locator('[data-key="feeling"]').first().click();
  await page.locator('[data-field="happened"]').fill('You sold all the cookies and you smiled at everyone.');
  await page.locator('[data-form="send"] button[type="submit"]').click();
  await page.locator('#toast.show').waitFor();
  await page.evaluate(() => { location.hash = '#/inbox'; });
  await page.getByRole('heading', { name: 'No feedback yet' }).waitFor();
  check((await page.locator('.asks').count()) === 0, 'the question leaves Sam’s Inbox once answered');
  check((await badge(page, 'Inbox')) === '', 'the badge clears');
  await ctx.close();
}

// 3. Dad: the question in the reading pane, then Not now. Ava isn't told.
await board('question', 'Dad', '#/inbox', async (page) => {
  await page.locator('.asks .item', { hasText: 'Ava' }).click();
  await page.getByRole('button', { name: 'Answer with Glow & Grow' }).waitFor();
  await top(page);
});
await board('answering', 'Dad', '#/inbox', async (page) => {
  await page.locator('.asks .item', { hasText: 'Ava' }).click();
  await page.getByRole('button', { name: 'Answer with Glow & Grow' }).click();
  await page.locator('.notice.answering').waitFor();
  await top(page);
});
{
  const { ctx, page } = await open('Dad', { size: 'desk' });
  await page.locator('.asks .item', { hasText: 'Ava' }).click();
  const reader = page.locator('#reader');
  await reader.getByRole('heading', { name: 'Ava asked you' }).waitFor();
  check((await page.locator('.ask-detail').count()) === 0, 'on a wide screen the question opens in the reading pane');
  check(/Ava sees your answer with your name/.test(await reader.innerText()), 'the pane says answers carry your name');
  await reader.getByRole('button', { name: 'Answer with Glow & Grow' }).click();
  await page.locator('.notice.answering').waitFor();
  check(/Ava asked for answers with your name/.test(await page.locator('main').innerText()), 'no anonymous option when Ava wants names');
  await page.evaluate(() => { location.hash = '#/inbox'; });
  await page.locator('.asks .item', { hasText: 'Ava' }).click();
  await reader.getByRole('button', { name: 'Not now' }).click();
  await page.locator('#toast.show', { hasText: 'Ava won’t be told' }).waitFor();
  check((await page.locator('.asks').count()) === 0, 'Not now removes the question');
  await ctx.close();
}

// 4. Ava: Sam's answer in her Inbox, linked to the question; Sent shows who answered.
{
  const { ctx, page } = await open('Ava');
  await page.locator('.fb-head', { hasText: 'Sam' }).click();
  await page.getByText('An answer to your question: “I ran the bake sale stall on Saturday.”').waitFor();
  check(true, 'Sam’s message says it answers Ava’s question');
  await page.evaluate(() => { location.hash = '#/sent'; });
  const q = page.locator('.asks-mine li', { hasText: 'bake sale' });
  await q.waitFor();
  check(/1\/2 answered/.test(await q.innerText()), 'Sent shows 1 of 2 answered');
  check(/Sam answered · waiting for Dad/.test(await q.innerText()), 'Sent names Sam; Dad’s Not now isn’t shown');
  await ctx.close();
}
await board('sent', 'Ava', '#/sent', async (page) => { await page.locator('.asks-mine').waitFor(); await top(page); });

// 5. An anonymous question to everyone: no names, and held answers aren't counted early.
{
  const { ctx, page } = await open('Ava', { hash: '#/give' });
  await page.getByRole('radio', { name: 'Ask', exact: true }).click();
  await page.getByRole('radio', { name: /Everyone/ }).click();
  await page.fill('#ask-what', 'I planned the trip to the lake.');
  const anon = page.getByRole('checkbox', { name: /answer anonymously/ });
  check(!(await anon.isDisabled()), 'anonymous answers can be allowed for 3 people');
  await anon.check();
  check(/Answers arrive in your Inbox without names/.test(await page.locator('.tips').innerText()), 'the tips say answers come without names');
  check(/They answer with Glow & Grow/.test(await page.locator('.tips').innerText()) && (await page.locator('.model-tile').count()) === 6,
    'everyone, Sam included, answers in the style Ava picks');
  await page.getByRole('button', { name: 'Ask everyone' }).click();
  const q = page.locator('.asks-mine li', { hasText: 'trip to the lake' });
  await q.waitFor();
  check(/Answers come without names/.test(await q.innerText()), 'Sent says answers come without names');
  await ctx.close();
}
await board('ask-anon', 'Ava', '#/give', async (page) => {
  await page.getByRole('radio', { name: 'Ask', exact: true }).click();
  await page.getByRole('radio', { name: /Everyone/ }).click();
  await page.fill('#ask-what', 'I planned the trip to the lake.');
  await page.getByRole('checkbox', { name: /answer anonymously/ }).check();
  await top(page);
});
await board('answering-anon', 'Dad', '#/inbox', async (page) => {
  await page.locator('.asks .item', { hasText: 'trip to the lake' }).click();
  await page.getByRole('button', { name: 'Answer with Glow & Grow' }).click();
  await page.locator('.notice.answering').waitFor();
  await page.locator('[data-form="send"]').scrollIntoViewIfNeeded();
});
{
  const { forMe } = await mom('GET', '/api/asks');
  const ask = forMe.find((a) => /lake/.test(a.what));
  check(ask?.anonymous === true && ask.count === 3, 'Mom is asked, and may answer anonymously');
  const kindAnswer = { model: 'glow-grow', fields: { glow: 'Everyone had a great day.' } };
  let refused = '';
  await mom('POST', '/api/feedback', { toIds: [ava.id], ...kindAnswer, askId: ask.id }).catch((e) => { refused = e.message; });
  check(/without names/.test(refused), 'a named answer to an anonymous question is refused');
  const res = await mom('POST', '/api/feedback', { toIds: [ava.id], ...kindAnswer, anonymous: true, askId: ask.id });
  check(res.held === true, 'the anonymous answer is held like any anonymous message');
  {
    const { ctx: dctx, page: d } = await open('Dad');
    await d.locator('.asks .item', { hasText: 'trip to the lake' }).click();
    await d.getByRole('button', { name: 'Answer with Glow & Grow' }).click();
    await d.locator('.notice.answering').waitFor();
    const box = d.getByRole('checkbox', { name: /Send anonymously/ });
    check(await box.isChecked() && await box.isDisabled(), 'Dad’s answer is anonymous, and can’t be switched to named');
    check((await d.locator('.model-tile').count()) === 1, 'Dad can only answer with Glow & Grow, like everyone');
    check((await d.locator('#field-glow').getAttribute('placeholder')) === 'You were really patient helping Grandma with her phone.', 'a grown-up sees a grown-up’s example');
    await d.locator('[data-field="glow"]').fill('The picnic was lovely.');
    await d.getByRole('button', { name: 'Send anonymously' }).click();
    await d.locator('#toast.show', { hasText: 'anonymously' }).waitFor();
    check(true, 'Dad sends his answer anonymously');
    await dctx.close();
  }
  const before = (await avaC('GET', '/api/asks')).mine.find((a) => a.id === ask.id);
  check(before.answered === 0 && before.answeredBy === null, 'held answers aren’t counted yet, and no names are given');
  skew += 3 * HOUR + 60_000;
  const after = (await avaC('GET', '/api/asks')).mine.find((a) => a.id === ask.id);
  check(after.answered === 2 && after.answeredBy === null, 'once they arrive Ava sees 2 answers, not who');
  const msg = (await avaC('GET', '/api/inbox')).find((f) => f.askWhat === 'I planned the trip to the lake.');
  const lake = (await avaC('GET', '/api/inbox')).filter((f) => f.askWhat === 'I planned the trip to the lake.');
  check(msg && lake.length === 2 && lake.every((f) => f.anonymous && !f.from && f.model === 'glow-grow'), 'both answers arrive without names, in the same style');
  const { ctx, page } = await open('Ava', { hash: '#/sent' });
  const row = page.locator('.asks-mine li', { hasText: 'trip to the lake' });
  await row.waitFor();
  check(/2 answers so far, without names/.test(await row.innerText()), 'Sent shows the count without names');
  await row.getByRole('button', { name: 'Stop asking' }).click();
  await page.locator('#toast.show', { hasText: 'Stopped asking' }).waitFor();
  check((await page.locator('.asks-mine li', { hasText: 'trip to the lake' }).count()) === 0, 'Stop asking removes it from Sent');
  await ctx.close();
  check(!(await samC('GET', '/api/asks')).forMe.some((a) => /lake/.test(a.what)), 'Stop asking removes it from Sam’s Inbox');
}

// 6. One shared device (no hub, IndexedDB): Papa asks Lily, Lily answers, and both are kept after a reload.
{
  const PUBLIC = resolve('public');
  const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
  const staticHost = createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    try {
      const file = join(PUBLIC, path === '/' ? 'index.html' : decodeURIComponent(path.slice(1)));
      if (!file.startsWith(PUBLIC)) throw new Error();
      const data = readFileSync(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' }).end(data);
    } catch {
      res.writeHead(404, { 'content-type': 'text/html' }).end('<h1>Not found</h1>');
    }
  });
  const staticUrl = await new Promise((r) => staticHost.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${staticHost.address().port}`)));
  const ctx = await browser.newContext({ colorScheme: 'light', ...SIZES.phone });
  const page = await ctx.newPage();
  // No hub here: the app's look for one gets 404s from /api/. Any other missing file is a failure.
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`device: ${m.text()}`); });
  page.on('response', (r) => { if (r.status() >= 400 && !new URL(r.url()).pathname.startsWith('/api/')) errors.push(`device: ${r.status()} ${r.url()}`); });
  page.on('pageerror', (e) => errors.push(`device: ${e.message}`));
  page.on('dialog', (d) => d.accept());
  await page.goto(staticUrl);
  await page.locator('.notice', { hasText: 'home base' }).waitFor();
  await page.fill('#familyName', 'iPad Family');
  await page.fill('#name', 'Papa');
  await page.getByRole('button', { name: 'Create our family space' }).click();
  await page.getByRole('heading', { name: 'Family', exact: true }).waitFor();
  await page.locator('[data-form="add-member"] input[name="name"]').fill('Lily');
  await page.locator('[data-form="add-member"] select[name="role"]').selectOption('kid');
  await page.locator('[data-form="add-member"] button[type="submit"]').click();
  await page.locator('.people li', { hasText: 'Lily' }).waitFor();
  await page.locator('#nav a', { hasText: 'Give' }).click();
  await page.getByRole('radio', { name: 'Ask', exact: true }).click();
  await page.locator('.tile', { hasText: 'Lily' }).click();
  await page.fill('#ask-what', 'I made pancakes for breakfast.');
  await page.getByRole('button', { name: 'Ask Lily' }).click();
  await page.getByRole('heading', { name: 'Sent' }).waitFor();
  await page.locator('#me').getByRole('button', { name: 'Switch' }).click();
  await page.locator('.tile', { hasText: 'Lily' }).click();
  await page.getByRole('button', { name: /I promise/ }).click();
  await page.locator('#nav a', { hasText: 'Inbox' }).click();
  await page.locator('.asks .item', { hasText: 'Papa' }).click();
  await page.getByRole('button', { name: 'Answer with Glow & Grow' }).click();
  await page.locator('[data-field="glow"]').fill('The pancakes were yummy.');
  await page.locator('[data-form="send"] button[type="submit"]').click();
  await page.locator('#toast.show').waitFor();
  await page.reload();
  await page.locator('#me').getByRole('button', { name: 'Switch' }).click();
  await page.locator('.tile', { hasText: 'Papa' }).click();
  await page.locator('#nav a', { hasText: 'Sent' }).click();
  const row = page.locator('.asks-mine li', { hasText: 'pancakes' });
  await row.waitFor();
  const text = await row.innerText();
  check(/1\/1 answered/.test(text) && /Lily answered/.test(text), 'on one shared device, the question and Lily’s answer are kept after a reload');
  await ctx.close();
  await new Promise((r) => staticHost.close(r));
}

// ---------- boards: one per state; phone, foldable and desktop, dark above light ----------
const img = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
const BOARDS = [
  ['ask', 'Give · Ask for feedback'],
  ['question', 'Inbox · a question for Dad'],
  ['answering', 'Give · answering Ava'],
  ['sent', 'Sent · your questions'],
  ['ask-anon', 'Give · asking everyone, answers without names'],
  ['answering-anon', 'Give · answering without names'],
];
const page = await (await browser.newContext({ deviceScaleFactor: 1 })).newPage();
const boardPaths = [];
for (const [key, title] of BOARDS) {
  const row = (scheme) => `<div class="row">${['phone', 'fold', 'desk'].map((size) => `<figure><img class="${size}" src="${img(shots[`${key}-${size}-${scheme}`])}"><figcaption>${scheme} · ${{ phone: 'phone', fold: 'foldable', desk: 'desktop' }[size]}</figcaption></figure>`).join('')}</div>`;
  await page.setContent(`<!doctype html><style>
    body { margin: 0; padding: 22px; background: #8a8580; font: 600 15px system-ui, sans-serif; color: #fff; width: max-content; }
    h1 { font-size: 20px; margin: 0 0 14px; } .row { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 18px; }
    figure { margin: 0; } figcaption { margin-top: 6px; } img { display: block; border-radius: 14px; box-shadow: 0 6px 20px rgb(0 0 0 / 35%); }
    .phone { width: 260px; } .fold { width: 372px; } .desk { width: 720px; }
  </style><h1>Ask for feedback · ${title}</h1>${row('dark')}${row('light')}`);
  const path = join(outDir, `board-${key}.png`);
  await page.screenshot({ path, fullPage: true });
  boardPaths.push(path);
}
for (const [k, buf] of Object.entries(shots)) writeFileSync(join(outDir, `${k}.png`), buf);

await browser.close();
hub.closeAllConnections?.();
hub.close();
if (errors.length) failures.push(...errors.map((e) => `console: ${e}`));
if (failures.length) {
  console.error(`${passed} passed, ${failures.length} failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`${passed} asking checks passed. Boards:\n${boardPaths.join('\n')}`);
