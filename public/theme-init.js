// Applies the saved theme family and mode before first paint. It is a classic, render-blocking
// script in <head> because the Content-Security-Policy allows no inline scripts. app.js owns the
// picker and calls window.ffTheme.apply() after a change.
(() => {
  const root = document.documentElement;
  // Browser and home-screen bar colours: each palette's --bg in styles.css (test/themes.test.js checks).
  const BAR = {
    messages: { light: '#f2f2f7', dark: '#000000' },
    graphite: { light: '#eef1f6', dark: '#171b21' },
    paper: { light: '#eee9dd', dark: '#16150f' },
  };
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
  const read = (key) => {
    try { return localStorage.getItem(key); } catch { return null; } // storage blocked: use the defaults
  };

  function apply() {
    const saved = read('ff-theme-family');
    const family = Object.hasOwn(BAR, saved ?? '') ? saved : 'messages'; // Messages is the default look
    const mode = read('ff-theme');
    root.dataset.themeFamily = family;
    if (mode === 'light' || mode === 'dark') root.dataset.theme = mode;
    else delete root.dataset.theme;
    const dark = mode === 'dark' || (mode !== 'light' && systemDark.matches);
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.append(meta);
    }
    meta.content = BAR[family][dark ? 'dark' : 'light'];
  }

  apply();
  // In System mode the CSS follows the OS by itself; the bar colour needs telling.
  systemDark.addEventListener('change', apply);
  window.ffTheme = { apply };
})();
