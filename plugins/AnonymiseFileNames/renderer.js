(function () {
  'use strict';
  if (window.__slickRandName) return;
  window.__slickRandName = true;

  const d = Object.getOwnPropertyDescriptor(File.prototype, 'name');
  if (!d || typeof d.get !== 'function' || !d.configurable) return;
  const og = d.get;

  const cr = window.crypto;
  const rng =
    cr && cr.getRandomValues
      ? (n) => {
          let a = new Uint32Array(n);
          cr.getRandomValues(a);
          return a;
        }
      : (n) => {
          let a = new Uint32Array(n);
          for (let i = 0; i < n; i++) a[i] = (Math.random() * 0xffffffff) >>> 0;
          return a;
        };

  const rb = () => {
    let b = rng(7),
      s = '';
    for (let i = 0; i < 7; i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[b[i] % 36];
    return s;
  };

  const ext = (n) => {
    if (typeof n !== 'string') return '';
    let b = n.slice(Math.max(n.lastIndexOf('/'), n.lastIndexOf('\\')) + 1),
      dot = b.lastIndexOf('.');
    return dot > 0 ? b.slice(dot) : '';
  };

  const lm = (n) => typeof n === 'string' && /^[a-z0-9]{7}(\.[^./\\]+)?$/.test(n);
  const c = new WeakMap();

  Object.defineProperty(File.prototype, 'name', {
    configurable: true,
    enumerable: d.enumerable,
    get: function () {
      let r;
      try {
        r = og.call(this);
      } catch (e) {
        return og.call(this);
      }
      let v = c.get(this);
      if (v !== undefined) return v;
      let m = lm(r) ? r : rb() + ext(r);
      c.set(this, m);
      return m;
    },
  });
})();
