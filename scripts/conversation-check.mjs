// Two phones, one family: a play test where two separate iPhone instances (Safari's engine, WebKit,
// each with its own storage) talk to each other through the home hub. Mom sets the family up on her
// phone and invites Sam (a kid), who joins from the invite on his phone. Then they go back and forth:
// a thank-you and a reaction, feedback for Sam with the break before replying, a reply and a
// promise with Mom as helper, a cheer and a tick, a question and its answer, and Sam writing DEAR MAN.
// Neither phone is reloaded: each learns of new things only when it is picked up again (or, on a
// real iPhone with the app on the Home Screen, from a notification). Mom's phone is light, Sam's is
// dark. Fails on any check or console error, and writes a storyboard of both screens at each step.
//   npm run test:conversation -- [outputDir]   (needs WebKit, see the README)
import { devices, webkit } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createApp } from '../src/server.js';

const outDir = resolve(process.argv[2] || 'screenshots/conversation');
mkdirSync(outDir, { recursive: true });
const MIN = 60_000;
// The hub's clock starts at 10:00 today, so the break and days never cross midnight by accident.
const tenAm = new Date();
tenAm.setHours(10, 0, 0, 0);
let skew = tenAm.getTime() - Date.now();
const now = () => Date.now() + skew;
const hub = createApp({ dataPath: ':memory:', now: () => new Date(now()) });
const base = await new Promise((r) => hub.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${hub.address().port}`)));

let browser;
try {
  browser = await webkit.launch({ headless: true });
} catch (err) {
  console.error(`WebKit isn't installed. Run: node node_modules/playwright-core/cli.js install webkit\n${err.message.split('\n')[0]}`);
  process.exit(1);
}
const errors = [];
const failures = [];
let passed = 0;
const check = (ok, what) => { if (ok) passed += 1; else failures.push(what); };
// Playwright adds a stylesheet of its own while taking a screenshot; WebKit reports the app's CSP
// refusing it. Only that message, and only while a screenshot is taken, is ignored.
const shooting = new WeakSet();

async function phone(label, colorScheme) {
  const ctx = await browser.newContext({ ...devices['iPhone 15'], colorScheme });
  ctx.setDefaultTimeout(10_000);
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (shooting.has(page) && /^Refused to apply a stylesheet/.test(m.text())) return;
    errors.push(`${label}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('dialog', (d) => d.accept());
  await page.clock.install({ time: new Date(now()) });
  return { ctx, page, label };
}
// Putting a phone down and picking it up again, as the page sees it (no reload).
const visibility = (page, hidden) => page.evaluate((h) => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
  document.dispatchEvent(new Event('visibilitychange'));
}, hidden);
const putDown = (p) => visibility(p.page, true);
async function pickUp(p) {
  await visibility(p.page, false);
  await p.page.waitForTimeout(400);
}
const badge = async (page, tab) => {
  const b = page.locator('#nav a', { hasText: tab }).locator('.badge');
  return (await b.count()) ? (await b.innerText()).trim() : '';
};
const tab = (page, name) => page.locator('#nav a', { hasText: name }).click();
async function advance(ms) {
  skew += ms;
  for (const p of [mom, sam]) await p.page.clock.fastForward(ms);
}

// ---------- storyboard ----------
const story = [];
async function snap(caption, momNote, samNote) {
  await advance(4000); // a few seconds pass, so toasts from earlier steps have gone
  const shots = [];
  for (const p of [mom, sam]) {
    await p.page.mouse.move(0, 0);
    shooting.add(p.page);
    shots.push(await p.page.screenshot());
    await p.page.waitForTimeout(100);
    shooting.delete(p.page);
  }
  story.push({ caption, notes: [momNote, samNote], shots });
}

const mom = await phone('Mom’s phone', 'light');
const sam = await phone('Sam’s phone', 'dark');

try {
// 1. Mom sets up the family on her phone and adds Sam.
await mom.page.goto(base);
await mom.page.fill('#familyName', 'The Garcias');
await mom.page.fill('#name', 'Mom');
await mom.page.getByRole('button', { name: 'Create our family space' }).tap();
await mom.page.getByRole('heading', { name: 'Family', exact: true }).waitFor();
await mom.page.locator('[data-form="add-member"] input[name="name"]').fill('Sam');
await mom.page.locator('[data-form="add-member"] select[name="role"]').selectOption('kid');
await mom.page.locator('[data-form="add-member"] button[type="submit"]').tap();
await mom.page.locator('.people li', { hasText: 'Sam' }).waitFor();
check(true, 'Mom sets up the family and adds Sam');
// Adding someone on the hub opens their invite straight away (tapping Invite again would make a new one).
await mom.page.locator('#invite-panel img.qr').waitFor();
check(/Invite Sam/.test(await mom.page.locator('#invite-panel').innerText()), 'Sam’s invite opens as soon as he’s added');
const inviteUrl = new URL(await mom.page.locator('.invite-url').inputValue());
check(true, 'an invite with a QR code for Sam');
await mom.page.locator('#invite-panel').evaluate((el) => el.scrollIntoView({ block: 'start' }));

// 2. Sam opens the invite on his phone (as if he scanned the QR code) and joins.
await sam.page.goto(`${base}${inviteUrl.pathname}${inviteUrl.search}${inviteUrl.hash}`);
await sam.page.getByRole('heading', { name: 'Welcome, Sam!' }).waitFor();
await snap('Mom invites Sam; Sam opens the invite on his phone', 'Family · Invite with a QR code', 'The welcome promise');
await sam.page.getByRole('button', { name: /I promise/ }).tap();
await sam.page.locator('#nav a', { hasText: 'Inbox' }).waitFor();
check(true, 'Sam joins from the invite');
await putDown(mom);

// 3. Sam says thank you, with a kid's example as ghost text.
await tab(sam.page, 'Say it');
await sam.page.locator('.tile', { hasText: 'Mom' }).tap();
await sam.page.locator('.model-tile', { hasText: 'Thank-You Note' }).tap();
check((await sam.page.locator('#field-what').getAttribute('placeholder')) === 'You helped me with my math homework.', 'Sam sees a kid’s example as ghost text');
await sam.page.fill('#field-what', 'You made pancakes on Saturday.');
await sam.page.fill('#field-impact', 'It was the best breakfast ever!');
await snap('Sam writes Mom a thank-you note', '(phone down)', 'Say it · Thank-You Note, with a kid’s example in grey');
await sam.page.getByRole('button', { name: /^Send$/ }).tap();
await sam.page.locator('#toast.show').waitFor();
await putDown(sam);

// 4. Mom picks up her phone: the Inbox badge shows it, and she says thank you back.
await pickUp(mom);
check((await badge(mom.page, 'Inbox')) === '1', 'picking up her phone, Mom sees a new message on the Inbox tab');
await tab(mom.page, 'Inbox');
await mom.page.locator('.fb-head', { hasText: 'Sam' }).tap();
await mom.page.getByText('You made pancakes on Saturday.').waitFor();
await mom.page.locator('[data-reaction="thanks"]').tap();
await mom.page.locator('[data-reaction="thanks"][aria-pressed="true"]').waitFor();
check(true, 'Mom reads it and taps Thank you');
await snap('Mom reads it and taps Thank you', 'Inbox · Sam’s note, Thank you', '(phone down)');
await putDown(mom);

// 5. Sam picks up his phone, still on Sent: Mom's thank-you shows there as New, and on the Inbox tab.
await pickUp(sam);
check(/Thank you/.test(await sam.page.locator('main').innerText()) && (await sam.page.locator('main .pill.new').count()) === 1, 'picking up his phone, Sam sees Mom’s thank-you, marked New, on his note in Sent');
check((await badge(sam.page, 'Inbox')) === '1', 'and counted on the Inbox tab until he looks');
await tab(sam.page, 'Inbox');
await sam.page.getByText(/Answers to what you said/i).waitFor();
check(/Thank you/.test(await sam.page.locator('.responses').first().innerText()), 'the Inbox lists Mom’s thank-you at the top');
await putDown(sam);

// 6. Mom gives Sam some feedback: kid-friendly styles first.
await pickUp(mom);
await tab(mom.page, 'Give');
await mom.page.locator('.tile', { hasText: 'Sam' }).tap();
check(/Kind Words/.test(await mom.page.locator('.model-tile').first().innerText()), 'writing to a kid, kid-friendly styles come first');
await mom.page.locator('.model-tile', { hasText: 'Glow & Grow' }).tap();
await mom.page.fill('#field-glow', 'You read your sister a bedtime story without being asked.');
await mom.page.fill('#field-grow', 'Maybe put the books back on the shelf afterwards.');
await mom.page.getByRole('button', { name: /^Send$/ }).tap();
await mom.page.locator('#toast.show').waitFor();
check(true, 'Mom sends Sam a Glow & Grow');
await putDown(mom);

// 7. Sam opens it: a 10-minute break before writing back. He can still say Got it.
await pickUp(sam);
// 2: the new message, and Mom's thank-you, which counts until Sam opens Sent or taps Mark all as seen.
check((await badge(sam.page, 'Inbox')) === '2', 'Sam sees Mom’s message counted on the Inbox tab');
await tab(sam.page, 'Inbox');
await sam.page.locator('.fb-head', { hasText: 'Mom' }).first().tap();
await sam.page.locator('.calm').waitFor();
check(/10 min/.test(await sam.page.locator('.calm').innerText()), 'a 10-minute break for a kid');
await sam.page.locator('[data-reaction="got-it"]').tap();
await sam.page.locator('[data-reaction="got-it"][aria-pressed="true"]').waitFor();
check(true, 'Sam taps Got it during the break');
await sam.page.locator('.calm').scrollIntoViewIfNeeded();
await snap('Mom sends Sam a Glow & Grow; Sam opens it and takes a break', 'Give · sent', 'Inbox · the breathing bubble, Got it');

// 8. After the break Sam writes back and makes a promise, with Mom as his helper.
await advance(11 * MIN);
await sam.page.locator('[data-form="reply"]').waitFor();
check(true, 'the reply box appears when the break is over, without a reload');
await sam.page.locator('[data-form="reply"] textarea').fill('Okay! I’ll put them back tonight.');
await sam.page.locator('[data-form="reply"] button[type="submit"]').tap();
await sam.page.getByText('Okay! I’ll put them back tonight.').waitFor();
await sam.page.getByRole('link', { name: 'Make a promise' }).tap();
await sam.page.getByRole('heading', { name: 'Make a promise' }).waitFor();
await sam.page.locator('.ptile').first().tap();
check((await sam.page.locator('.tile:has(input:checked)').innerText()).includes('Mom'), 'Mom is Sam’s helper');
await sam.page.getByRole('button', { name: 'Start my promise' }).tap();
await sam.page.getByRole('heading', { name: 'Promises' }).waitFor();
check(true, 'Sam writes back and starts a promise');
await putDown(sam);

// 9. Mom picks up: Sam's reply, and his promise to cheer on.
await pickUp(mom);
check((await badge(mom.page, 'Inbox')) !== '', 'Mom sees Sam’s reply counted on the Inbox tab');
await tab(mom.page, 'Inbox');
check(/put them back tonight/.test(await mom.page.locator('.responses').first().innerText()), 'Mom sees Sam’s reply at the top of her Inbox');
await tab(mom.page, 'Plans');
const promise = mom.page.locator('.plan', { hasText: 'Sam' }).first();
await promise.waitFor();
await promise.locator('[data-action="cheer"]').first().tap();
await mom.page.getByText(/You cheered today/).waitFor();
check(true, 'Mom cheers Sam’s promise');
await snap('Sam writes back and makes a promise; Mom cheers him on', 'Plans · Sam’s promise, cheered', 'Promises · his new promise');
await putDown(mom);

// 10. Sam sees the cheer and ticks today.
await pickUp(sam);
await tab(sam.page, 'Promises');
await sam.page.locator('.cheers').waitFor();
check(true, 'Sam sees Mom’s cheer');
await sam.page.getByRole('button', { name: /I did it/ }).tap();
await sam.page.locator('.days.stickers li.kept').waitFor();
check(true, 'Sam ticks today and gets a star');

// 11. Sam asks Mom how he did.
await tab(sam.page, 'Say it');
await sam.page.getByRole('radio', { name: 'Ask', exact: true }).tap();
await sam.page.locator('.tile', { hasText: 'Mom' }).tap();
await sam.page.fill('#ask-what', 'I tidied my room all by myself.');
await sam.page.locator('.chip', { hasText: 'Both' }).tap();
await sam.page.locator('.model-tile', { hasText: 'Kind Words' }).tap();
await sam.page.getByRole('button', { name: 'Ask Mom' }).tap();
await sam.page.getByRole('heading', { name: 'Sent' }).waitFor();
check(true, 'Sam asks Mom for feedback');
await putDown(sam);

// 12. Mom picks up: a question for her. She answers it.
await pickUp(mom);
check((await badge(mom.page, 'Inbox')) !== '', 'Mom sees Sam’s question counted on the Inbox tab');
await tab(mom.page, 'Inbox');
await mom.page.locator('.asks .item', { hasText: 'Sam' }).tap();
await mom.page.locator('.ask-detail').waitFor();
await snap('Sam ticks his promise and asks Mom how he did', 'Inbox · Questions for you', 'Sent · Your questions');
await mom.page.getByRole('button', { name: 'Answer with Kind Words' }).tap();
await mom.page.locator('.notice.answering').waitFor();
await mom.page.locator('[data-key="feeling"][data-value="proud"]').tap();
await mom.page.fill('#field-happened', 'When you tidied your room all by yourself…');
await mom.page.fill('#field-like', 'You never give up!');
await mom.page.getByRole('button', { name: /^Send$/ }).tap();
await mom.page.locator('#toast.show').waitFor();
check(true, 'Mom answers Sam’s question');
await putDown(mom);

// 13. Sam picks up: Mom's answer, linked to his question; Sent says Mom answered.
await pickUp(sam);
await tab(sam.page, 'Inbox');
await sam.page.locator('.fb-head', { hasText: 'Mom' }).first().tap();
await sam.page.getByText(/An answer to your question/).waitFor();
check(true, 'Sam’s answer says which question it answers');
await sam.page.getByText('An answer to your question').scrollIntoViewIfNeeded();
await snap('Mom answers; Sam reads the answer to his question', 'Give · sent', 'Inbox · “An answer to your question”');
await tab(sam.page, 'Sent');
check(/Mom answered/.test(await sam.page.locator('.asks-mine').innerText()), 'Sent says Mom answered');

// 14. Sam writes Mom a DEAR MAN, a grown-up style, with a kid's example. Mom has her phone open
// this time: her Inbox badge goes up within 30 seconds, without a tap.
await pickUp(mom);
const before = Number(await badge(mom.page, 'Inbox')) || 0;
await tab(sam.page, 'Say it');
await sam.page.getByRole('radio', { name: 'Say it', exact: true }).tap();
await sam.page.locator('.tile', { hasText: 'Mom' }).tap();
await sam.page.locator('.model-tile', { hasText: 'DEAR MAN' }).tap();
check(/more steps than the others/.test(await sam.page.locator('[data-form="send"]').innerText()), 'a hint for a kid choosing a grown-up style');
await sam.page.fill('#field-describe', 'This morning you looked at your phone while I told you about my dream.');
await sam.page.fill('#field-express', 'I felt like you weren’t listening.');
await sam.page.fill('#field-assert', 'Could you put your phone down when I talk to you?');
await sam.page.getByRole('button', { name: /^Send$/ }).tap();
await sam.page.locator('#toast.show').waitFor();
await putDown(sam);
check((Number(await badge(mom.page, 'Inbox')) || 0) === before, 'nothing changes on Mom’s open phone straight away');
await advance(31_000);
await mom.page.waitForTimeout(400);
check((Number(await badge(mom.page, 'Inbox')) || 0) === before + 1, 'within 30 seconds the Inbox badge on Mom’s open phone goes up');
await tab(mom.page, 'Inbox');
await mom.page.locator('.fb-head', { hasText: 'Sam' }).first().tap();
await mom.page.getByText('Could you put your phone down when I talk to you?').waitFor();
const dearMan = mom.page.locator('.calm').first(); // the newest open message
await dearMan.scrollIntoViewIfNeeded();
check(/30 min/.test(await dearMan.innerText()), 'Mom gets a 30-minute break too');
check(true, 'Mom gets Sam’s DEAR MAN');
await snap('Sam writes Mom a DEAR MAN; Mom reads it and takes a break', 'Inbox · Sam’s DEAR MAN, the break', 'Say it · sent');

} catch (err) {
  // Stopped part-way: keep what both phones show, for working out why.
  failures.push(`stopped: ${err.message.split('\n').filter((l) => l.trim() && !/^\s*-\s+(attempting|element is|retrying|waiting \d|\d+ ×)/.test(l)).slice(0, 4).join(' / ')}`);
  for (const p of [mom, sam]) {
    shooting.add(p.page);
    await p.page.screenshot({ path: join(outDir, `stopped-${p === mom ? 'mom' : 'sam'}.png`), fullPage: true }).catch(() => {});
  }
}

// ---------- storyboard ----------
await mom.ctx.close();
await sam.ctx.close();
const img = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
const boardPaths = [];
const half = Math.ceil(story.length / 2);
for (const [i, part] of [story.slice(0, half), story.slice(half)].entries()) {
  const board = await (await browser.newContext({ deviceScaleFactor: 1 })).newPage();
  await board.setContent(`<!doctype html><style>
    body { margin: 0; padding: 22px; background: #8a8580; font: 600 15px system-ui, sans-serif; color: #fff; width: max-content; }
    h1 { font-size: 20px; margin: 0 0 4px; } p.sub { margin: 0 0 16px; font-weight: 500; }
    .step { display: grid; grid-template-columns: 200px 262px 262px; gap: 16px; align-items: start; margin-bottom: 18px; }
    .cap { font-size: 16px; padding-top: 8px; } .n { display: block; font-size: 28px; opacity: .8; }
    figure { margin: 0; } figcaption { margin-top: 6px; font-weight: 500; font-size: 13px; }
    img { display: block; width: 262px; border-radius: 22px; box-shadow: 0 6px 20px rgb(0 0 0 / 35%); }
  </style><h1>Two phones, one family · part ${i + 1} of 2</h1><p class="sub">Mom’s iPhone (light) and Sam’s iPhone (dark), in Safari’s engine, talking through the home hub</p>
  ${part.map((s, j) => `<div class="step"><div class="cap"><span class="n">${i * half + j + 1}</span>${s.caption}</div>
    ${s.shots.map((b, k) => `<figure><img src="${img(b)}"><figcaption>${k ? 'Sam' : 'Mom'}: ${s.notes[k]}</figcaption></figure>`).join('')}</div>`).join('')}`);
  const path = join(outDir, `conversation-${i + 1}.png`);
  await board.screenshot({ path, fullPage: true });
  boardPaths.push(path);
}
story.forEach((s, i) => s.shots.forEach((b, k) => writeFileSync(join(outDir, `${String(i + 1).padStart(2, '0')}-${k ? 'sam' : 'mom'}.png`), b)));
await browser.close();
hub.closeAllConnections?.();
hub.close();
if (errors.length) failures.push(...errors.map((e) => `console: ${e}`));
if (failures.length) {
  console.error(`${passed} passed, ${failures.length} failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`${passed} conversation checks passed. Storyboard:\n${boardPaths.join('\n')}`);
