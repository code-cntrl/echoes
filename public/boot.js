// Start-up safety net. A classic script that runs before everything else (the Content-Security-
// Policy allows no inline scripts), in plain ES5 so even a very old Safari can run it.
//  1. Fills in a few functions Safari only gained in iOS 15.4, which Echoes uses while starting.
//  2. If the app can't start (too old a browser, a script that fails or won't load, or a start that
//     never finishes), it replaces the endless "Loading…" with a message that says why and what to
//     do. app.js calls echoesBoot.started() once its first screen is up.
// Which versions run Echoes: README, "Which iPhones and iPads".
(function () {
  'use strict';
  var NEEDS = 14; // the oldest iOS/iPadOS whose Safari runs the app's modules (they use ??=)
  var WAIT_MS = 15000; // a start this slow is stuck, not slow
  var ERROR_GRACE_MS = 1500; // an error before the start: give the app a moment to start anyway

  // ---------- fallbacks (iOS 15.4 added these) ----------
  function fill(owner, name, fn) {
    if (owner && typeof owner[name] !== 'function') Object.defineProperty(owner, name, { value: fn, writable: true, configurable: true });
  }
  fill(Object, 'hasOwn', function (obj, key) {
    if (obj == null) throw new TypeError('Object.hasOwn needs an object');
    return Object.prototype.hasOwnProperty.call(Object(obj), key);
  });
  function at(index) {
    var n = this.length;
    var i = Math.trunc(index) || 0;
    if (i < 0) i += n;
    return i < 0 || i >= n ? undefined : this[i];
  }
  fill(Array.prototype, 'at', at);
  fill(String.prototype, 'at', function (index) { return at.call(String(this), index); });
  // A deep copy of the data Echoes keeps: objects, arrays, dates, maps, sets and binary data. Objects
  // the browser makes itself (keys, files) can't be changed, so the copy shares them.
  fill(window, 'structuredClone', function (value) {
    var seen = new Map();
    function copy(v) {
      if (typeof v === 'function' || typeof v === 'symbol') throw new TypeError('This value can’t be copied.');
      if (v === null || typeof v !== 'object') return v;
      if (seen.has(v)) return seen.get(v);
      var out, i, keys;
      if (v instanceof Date) out = new Date(v.getTime());
      else if (v instanceof RegExp) out = new RegExp(v.source, v.flags);
      else if (v instanceof ArrayBuffer) out = v.slice(0);
      else if (ArrayBuffer.isView(v)) out = v instanceof DataView ? new DataView(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)) : new v.constructor(v);
      else if (v instanceof Map) {
        out = new Map();
        seen.set(v, out);
        v.forEach(function (val, key) { out.set(copy(key), copy(val)); });
        return out;
      } else if (v instanceof Set) {
        out = new Set();
        seen.set(v, out);
        v.forEach(function (val) { out.add(copy(val)); });
        return out;
      } else if (Array.isArray(v)) {
        out = [];
        seen.set(v, out);
        for (i = 0; i < v.length; i++) out[i] = copy(v[i]);
        return out;
      } else if (Object.prototype.toString.call(v) === '[object Object]') {
        out = {};
        seen.set(v, out);
        keys = Object.keys(v);
        for (i = 0; i < keys.length; i++) out[keys[i]] = copy(v[keys[i]]);
        return out;
      } else return v;
      seen.set(v, out);
      return out;
    }
    return copy(value);
  });

  // ---------- which system this is ----------
  // "iPad; CPU OS 12_5_7", "iPhone; CPU iPhone OS 15_8". Since iPadOS 13 an iPad asks for desktop
  // sites, so it looks like a Mac with a touch screen. Newer Safari freezes the OS number while its
  // own Version/ follows the system, so the larger of the two counts.
  function appleSystem(ua) {
    var os = /\b(iPhone|iPad|iPod)\b[^)]*? OS (\d+)_(\d+)/.exec(ua);
    var touchMac = !os && /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
    if (!os && !touchMac) return null;
    var device = os ? os[1] : 'iPad';
    var major = os ? +os[2] : 0;
    var minor = os ? +os[3] : 0;
    var safari = /Version\/(\d+)\.(\d+)/.exec(ua);
    if (safari && +safari[1] > major) {
      major = +safari[1];
      minor = +safari[2];
    }
    if (!major) return null;
    var name = device === 'iPad' && major >= 13 ? 'iPadOS' : 'iOS';
    return { device: device, major: major, minor: minor, name: name, label: name + ' ' + major + '.' + minor };
  }
  var sys = appleSystem(navigator.userAgent || '');
  var thing = sys ? 'this ' + sys.device : 'this browser';
  var systemFor = function (version) { return (sys && sys.device === 'iPad' ? 'iPadOS ' : 'iOS ') + version; };
  var modules = 'noModule' in document.createElement('script');
  var tooOld = sys ? sys.major < NEEDS : !modules;

  // ---------- the message ----------
  var state = { ready: false, shown: null, error: null, errorTimer: 0, waitTimer: 0 };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  function show(kind) {
    if (state.ready || state.shown) return;
    var app = document.getElementById('app');
    if (!app) {
      document.addEventListener('DOMContentLoaded', function () { show(kind); });
      return;
    }
    state.shown = kind;
    var title;
    var lines = [];
    var below15_4 = sys && (sys.major < 15 || (sys.major === 15 && sys.minor < 4));
    if (kind === 'old') {
      title = 'Echoes can’t run on ' + thing;
      if (sys) {
        lines.push('It has ' + sys.label + ', and Echoes needs ' + systemFor(NEEDS) + ' or later.');
        lines.push('Update it in Settings → General → Software Update. If no update is offered, ' + thing + ' is too old for Echoes: use it on a newer iPhone, iPad, Chromebook or computer instead.');
      } else {
        lines.push('This browser is too old for Echoes.');
        lines.push('Update it, or open Echoes in a recent Safari, Chrome or Edge.');
      }
    } else {
      title = kind === 'slow' ? 'Echoes is taking too long to start' : 'Echoes couldn’t start';
      lines.push(kind === 'slow' ? 'Check the Wi-Fi, then reload.' : 'Something on ' + thing + ' stopped it. Reload to try again.');
      lines.push(below15_4
        ? 'If it keeps happening, update ' + thing + ' to ' + systemFor('15.4') + ' or later (Settings → General → Software Update), or use another device.'
        : 'If it keeps happening, try another browser or device, and tell whoever set up Echoes what it says below.');
    }
    var box = el('section', 'empty boot-fail');
    box.setAttribute('data-boot', kind);
    box.appendChild(el('h1', '', title));
    for (var i = 0; i < lines.length; i++) box.appendChild(el('p', 'muted', lines[i]));
    if (kind !== 'old') {
      var again = el('button', 'primary', 'Reload');
      again.type = 'button';
      again.addEventListener('click', function () { location.reload(); });
      var row = el('p');
      row.appendChild(again);
      box.appendChild(row);
    }
    var details = [sys ? sys.label : (navigator.userAgent || '').slice(0, 120)];
    if (state.error) details.push(state.error);
    box.appendChild(el('p', 'small muted boot-why', details.join(' · ')));
    app.innerHTML = '';
    app.appendChild(box);
  }

  function failed(message) {
    if (state.ready) return;
    if (!state.error) state.error = String(message || 'A script error.').slice(0, 300);
    if (!state.errorTimer) state.errorTimer = setTimeout(function () { show(tooOld ? 'old' : 'error'); }, ERROR_GRACE_MS);
  }

  // Script errors reach window; a script that won't load only fires on its element (seen here,
  // capturing). Other resources (an image, say) don't stop the app.
  window.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t !== window && t.tagName) {
      if (t.tagName === 'SCRIPT') failed('Couldn’t load ' + (t.getAttribute('src') || 'a script') + '.');
      return;
    }
    failed(e.message);
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    failed(r && r.message ? (r.name ? r.name + ': ' : '') + r.message : String(r));
  });
  if (tooOld) show('old');
  state.waitTimer = setTimeout(function () { show(tooOld ? 'old' : 'slow'); }, WAIT_MS);

  window.echoesBoot = {
    system: sys ? sys.label : null,
    get ready() { return state.ready; },
    get shown() { return state.shown; },
    started: function () {
      state.ready = true;
      clearTimeout(state.errorTimer);
      clearTimeout(state.waitTimer);
    },
  };
})();
