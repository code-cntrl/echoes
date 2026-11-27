// boot.js: the fallbacks for older Safari and how it reads the system version, run in a bare context
// where structuredClone, Object.hasOwn and .at() don't exist (as on iOS 14.0 to 15.3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const BOOT = readFileSync(new URL('../public/boot.js', import.meta.url), 'utf8');
// Results cross back as JSON: objects from another context have other prototypes.
const run = (ctx, expr) => JSON.parse(vm.runInContext(`JSON.stringify(${expr})`, ctx));

function boot({ userAgent = 'Mozilla/5.0 (iPad; CPU OS 15_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.2 Mobile/15E148 Safari/604.1', maxTouchPoints = 5, modules = true } = {}) {
  const ctx = vm.createContext({
    navigator: { userAgent, maxTouchPoints },
    document: {
      createElement: () => (modules ? { noModule: false } : {}),
      getElementById: () => null,
      addEventListener() {},
    },
    location: {},
    setTimeout: () => 0,
    clearTimeout() {},
  });
  vm.runInContext('window = globalThis; window.addEventListener = function () {}; delete Object.hasOwn; delete Array.prototype.at; delete String.prototype.at;', ctx);
  assert.equal(vm.runInContext('typeof structuredClone + typeof Object.hasOwn + typeof [].at', ctx), 'undefinedundefinedundefined');
  vm.runInContext(BOOT, ctx);
  return ctx;
}

test('boot.js fills in Object.hasOwn and .at() where they are missing', () => {
  const ctx = boot();
  assert.deepEqual(run(ctx, `[
    Object.hasOwn({ a: 1 }, 'a'), Object.hasOwn({ a: 1 }, 'toString'), Object.hasOwn([5], 0),
    [1, 2, 3].at(-1), [1, 2, 3].at(0), [1, 2, 3].at(3), [1, 2, 3].at(-4), [1, 2, 3].at(1.7), 'abc'.at(-1), ''.at(0),
  ]`), [true, false, true, 3, 1, null, null, 2, 'c', null]);
  assert.throws(() => vm.runInContext('Object.hasOwn(null, "a")', ctx), /needs an object/);
  // Not enumerable, like the real ones: for..in over an array still sees only its items.
  assert.deepEqual(run(ctx, '(function () { var k = []; for (var i in [7]) k.push(i); return k; })()'), ['0']);
});

test('boot.js structuredClone makes a deep copy of the data Echoes keeps', () => {
  const ctx = boot();
  const out = run(ctx, `(() => {
    class Note { constructor() { this.text = 'hi'; } }
    const when = new Date('2026-01-02T03:04:05Z');
    const doc = { members: [{ id: 'a', name: 'Sam', tags: new Set(['kid']) }], when, map: new Map([['k', { n: 1 }]]),
      bytes: new Uint8Array([1, 2, 3]), buf: new Uint8Array([9]).buffer, note: new Note(), nothing: null, missing: undefined };
    doc.self = doc;
    const copy = structuredClone(doc);
    copy.members[0].name = 'Changed';
    copy.bytes[0] = 99;
    copy.map.get('k').n = 2;
    return ({
      deep: doc.members[0].name === 'Sam' && doc.bytes[0] === 1 && doc.map.get('k').n === 1,
      newObjects: copy !== doc && copy.members !== doc.members && copy.when !== doc.when && copy.bytes !== doc.bytes,
      date: copy.when.getTime() === when.getTime(),
      set: copy.members[0].tags instanceof Set && copy.members[0].tags.has('kid'),
      bytes: copy.bytes instanceof Uint8Array && copy.bytes.length === 3,
      buf: copy.buf instanceof ArrayBuffer && copy.buf !== doc.buf && new Uint8Array(copy.buf)[0] === 9,
      cycle: copy.self === copy,
      plain: Object.getPrototypeOf(copy.note) === Object.prototype && copy.note.text === 'hi',
      nulls: copy.nothing === null && 'missing' in copy && copy.missing === undefined,
      primitives: structuredClone(5) === 5 && structuredClone('x') === 'x' && structuredClone(null) === null,
    }); })()`);
  assert.deepEqual(out, { deep: true, newObjects: true, date: true, set: true, bytes: true, buf: true, cycle: true, plain: true, nulls: true, primitives: true });
  assert.throws(() => vm.runInContext('structuredClone({ f() {} })', ctx), /can’t be copied/);
});

test('boot.js leaves the browser’s own functions alone', () => {
  const ctx = vm.createContext({ navigator: { userAgent: '' }, document: { createElement: () => ({ noModule: false }), getElementById: () => null, addEventListener() {} }, setTimeout: () => 0, clearTimeout() {} });
  vm.runInContext('window = globalThis; window.addEventListener = function () {}; var real = function structuredClone() {}; window.structuredClone = real; var hasOwn = Object.hasOwn;', ctx);
  vm.runInContext(BOOT, ctx);
  assert.equal(vm.runInContext('structuredClone === real && Object.hasOwn === hasOwn', ctx), true);
});

test('boot.js names the iPhone or iPad system from what Safari reports', () => {
  const name = (userAgent, maxTouchPoints = 5) => vm.runInContext('echoesBoot.system', boot({ userAgent, maxTouchPoints }));
  assert.equal(name('Mozilla/5.0 (iPad; CPU OS 12_5_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1'), 'iOS 12.5');
  assert.equal(name('Mozilla/5.0 (iPad; CPU OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6.6 Mobile/15E148 Safari/604.1'), 'iPadOS 15.8');
  assert.equal(name('Mozilla/5.0 (iPhone; CPU iPhone OS 14_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1'), 'iOS 14.8');
  // Chrome on an iPhone has no Version/.
  assert.equal(name('Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1'), 'iOS 16.3');
  // An iPad asking for the desktop site looks like a Mac with a touch screen.
  assert.equal(name('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1 Safari/605.1.15'), 'iPadOS 13.1');
  assert.equal(name('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15', 0), null);
  // Safari 26 keeps reporting OS 18_6; its Version/ is the real one.
  assert.equal(name('Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1'), 'iOS 26.0');
  assert.equal(name('Mozilla/5.0 (X11; CrOS x86_64 15917.71.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'), null);
});
