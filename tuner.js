// A small panel of sliders and selects bound to a settings object.
// Settings are saved in this browser, so tuning survives a reload.
// The viewer page (index.html) shows a few of them; the lab (lab.html), all.

import { view } from './rotate.js';
import { CLOCK_KEYS, letGo } from './keys.js';

export function createTuner({ schema, lab = false, settings, defaults, storageKey, onChange }) {
  const toggle = document.createElement('button');
  toggle.className = 'tuner-toggle';
  toggle.type = 'button';
  toggle.title = 'Settings (p)';
  toggle.setAttribute('aria-label', 'Settings');
  toggle.textContent = '⚙';

  const root = document.createElement('aside');
  root.className = lab ? 'tuner' : 'tuner basic';
  root.hidden = true;

  const head = document.createElement('div');
  head.className = 'tuner-head';
  head.innerHTML = `<strong>${lab ? 'All settings' : 'Settings'}</strong>`;
  const buttons = document.createElement('div');
  buttons.className = 'tuner-buttons';
  const copyBtn = button('Copy', 'Copy the settings as JSON');
  const resetBtn = button('Reset', 'Every setting back to its default');
  const closeBtn = button('×', 'Close (p)');
  buttons.append(...(lab ? [copyBtn] : []), resetBtn, closeBtn);
  head.append(buttons);
  root.append(head);

  const inputs = new Map(); // key -> { input, out, item }
  // What this browser keeps: only values changed in the panel. A value given
  // in the URL is used for this visit but not kept, unless it is changed here.
  let kept = {};
  try { kept = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch { /* storage blocked */ }

  for (const group of lab ? schema : viewerSchema(schema)) {
    const section = document.createElement('section');
    if (group.title) {
      const h = document.createElement('h3');
      h.textContent = group.title;
      section.append(h);
    }
    for (const item of group.items) {
      const row = document.createElement('label');
      row.className = 'tuner-row';
      row.dataset.key = item.key;
      const name = document.createElement('span');
      name.className = 'tuner-name';
      name.append(item.label);
      let def = null;
      if (lab) {   // the default that applies on this device, and a way back to it
        def = document.createElement('button');
        def.type = 'button';
        def.className = 'tuner-def';
        def.addEventListener('click', () => { set(item.key, defaults[item.key]); refresh(); });
        name.append(' ', def);
      }
      if (item.hint) row.title = item.hint;
      let input, out = null;
      if (item.options) {
        input = document.createElement('select');
        item.options.forEach((opt, i) => {
          const o = document.createElement('option');
          o.value = opt;
          o.textContent = item.labels?.[i] ?? opt; // a plain name, when the value is not one
          input.append(o);
        });
        input.addEventListener('change', () => set(item.key, input.value));
      } else {
        input = document.createElement('input');
        input.type = 'range';
        input.min = item.min;
        input.max = item.max;
        input.step = item.step;
        out = document.createElement('output');
        input.addEventListener('input', () => set(item.key, Number(input.value)));
        touchSlider(row, input);
      }
      row.append(name, input);
      if (out) row.append(out);
      section.append(row);
      inputs.set(item.key, { input, out, item, row, def });
    }
    root.append(section);
  }

  // The lab links back to the viewer page (same URL settings, panel open). The
  // viewer page has no link to the lab: that is opened by its address.
  const foot = footer();
  if (lab) {
    const other = document.createElement('p');
    other.className = 'tuner-page';
    const link = document.createElement('a');
    link.href = `./${location.search}#tune`;
    link.textContent = 'Fewer settings';
    link.title = 'The viewer page';
    other.append(link);
    root.append(other);
  }
  root.append(foot);
  document.body.append(toggle, root);
  refresh();
  let versionAsked = false;

  // On a touch screen a slider moves only when a finger drags sideways: the
  // CSS lets the slider itself ignore touches (pointer-events: none), so the
  // row gets them; a vertical drag then scrolls the panel (touch-action: pan-y)
  // and a tap does nothing, where the native slider jumps its thumb to the
  // touch. The drag is relative: the value moves by as much as the finger,
  // wherever it began. A mouse, a keyboard and assistive tools use the native
  // slider (the CSS applies only to a coarse, hover-less main pointer).
  const touchOnly = window.matchMedia('(hover: none) and (pointer: coarse)');
  function touchSlider(row, input) {
    const at = (e) => view.point(e.clientX, e.clientY); // the panel may be turned with the picture
    const SLOP = 8; // CSS px before a drag counts as sideways
    let g = null;   // { id, x, y, v, sideways }
    row.addEventListener('pointerdown', (e) => {
      if (!touchOnly.matches || e.pointerType === 'mouse') return;
      g = { id: e.pointerId, ...at(e), v: Number(input.value), sideways: false };
    });
    row.addEventListener('pointermove', (e) => {
      if (!g || e.pointerId !== g.id) return;
      const p = at(e);
      const dx = p.x - g.x;
      if (!g.sideways) {
        if (Math.abs(dx) < SLOP || Math.abs(dx) < Math.abs(p.y - g.y)) return;
        g.sideways = true;
        g.x += Math.sign(dx) * SLOP; // the value starts moving from here, not with a jump
        try { row.setPointerCapture(e.pointerId); } catch { /* the drag then ends at the row's edge */ }
      }
      const min = Number(input.min), max = Number(input.max), step = Number(input.step) || 1;
      const room = Math.max(1, input.offsetWidth - 28); // the thumb's travel, about
      let v = g.v + ((p.x - g.x) / room) * (max - min);
      v = Math.min(max, Math.max(min, min + Math.round((v - min) / step) * step));
      v = Number(v.toFixed(6));
      if (String(v) === input.value) return;
      input.value = v;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const end = (e) => { if (g && e.pointerId === g.id) g = null; };
    row.addEventListener('pointerup', end);
    row.addEventListener('pointercancel', end);
  }

  function button(text, title) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.title = title;
    return b;
  }

  // A quiet last line: the repository, and the commit that is being served.
  // version.json is written by the Pages workflow; without it (a local server,
  // the old branch deploy) only the link shows.
  function footer() {
    const el = document.createElement('p');
    el.className = 'tuner-foot';
    const repo = 'https://github.com/sf624/rain-of-light';
    const gh = document.createElement('a');
    gh.href = repo;
    gh.target = '_blank';
    gh.rel = 'noopener';
    gh.textContent = 'GitHub';
    el.append(gh);
    el.loadVersion = () => fetch('version.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => {
        if (!v || typeof v.sha !== 'string' || !/^[0-9a-f]{7,40}$/.test(v.sha)) return;
        const a = document.createElement('a');
        a.href = `${repo}/commit/${v.sha}`;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = v.sha.slice(0, 7);
        a.className = 'tuner-sha';
        if (typeof v.date === 'string') a.title = v.date;
        el.append(' \u00b7 ', a);
      })
      .catch(() => { /* offline or no file: the link alone is enough */ });
    return el;
  }

  // What a value reads as: a number to its step, an option by its label.
  function format(item, v) {
    if (item.options) return item.labels?.[item.options.indexOf(String(v))] ?? String(v);
    const decimals = Math.max(0, -Math.floor(Math.log10(item.step)));
    return Number(v).toFixed(decimals);
  }

  function set(key, value) {
    settings[key] = value;
    if (value === defaults[key]) delete kept[key]; else kept[key] = value;
    const entry = inputs.get(key);
    if (entry && entry.out) entry.out.textContent = format(entry.item, value);
    mark(key);
    save();
    onChange(key, value);
  }

  function refresh() {
    for (const [key, { input, out, item }] of inputs) {
      input.value = settings[key];
      if (out) out.textContent = format(item, settings[key]);
      mark(key);
    }
  }

  // A row whose value is not the default says so, and offers the way back.
  function mark(key) {
    const entry = inputs.get(key);   // (the viewer's panel shows few settings, and no defaults)
    if (!entry?.def) return;
    const { row, def, item } = entry;
    const changed = settings[key] !== defaults[key];
    const text = format(item, defaults[key]);
    row.classList.toggle('changed', changed);
    def.textContent = `default ${text}`;
    def.disabled = !changed;
    def.title = changed ? `Back to the default, ${text}` : 'This is the default';
  }

  function save() {
    try {
      for (const key of Object.keys(kept)) if (!(key in defaults)) delete kept[key];
      localStorage.setItem(storageKey, JSON.stringify(kept));
    } catch { /* storage may be blocked: tuning still works for this visit */ }
  }

  function show(visible) {
    root.hidden = !visible;
    if (visible && !versionAsked) { versionAsked = true; foot.loadVersion(); }
    toggle.classList.toggle('active', visible);
  }

  toggle.addEventListener('click', () => show(root.hidden));
  closeBtn.addEventListener('click', () => show(false));
  resetBtn.addEventListener('click', () => {
    for (const key of Object.keys(defaults)) {
      if (settings[key] !== defaults[key]) {
        settings[key] = defaults[key];
        onChange(key, defaults[key]);
      }
    }
    kept = {};
    refresh();
    save();
  });
  copyBtn.addEventListener('click', async () => {
    const text = JSON.stringify(settings, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = 'Copied';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1200);
    } catch {
      prompt('Settings', text);
    }
  });

  // Keys typed into the panel must not reach the page's own shortcuts. In the lab the clock's
  // keys do (see keys.js), and a pointer's use of a control lets go of its focus.
  root.addEventListener('keydown', (e) => { if (!(lab && CLOCK_KEYS.has(e.key))) e.stopPropagation(); });
  if (lab) letGo(root);

  if (location.hash === '#tune') show(true); // a link that opens with the panel

  return {
    toggle: () => show(root.hidden),
    refresh,
    set,
  };
}

// The viewer page's panel: the items marked `viewer: n`, in that order, each
// under its `short` label if it has one. A group keeps its heading where it
// brings more than one item; the others share a section without one.
export function viewerSchema(schema) {
  const picked = schema.flatMap((group) => group.items.filter((item) => item.viewer)
    .map((item) => ({ group, item: { ...item, label: item.short ?? item.label } })))
    .sort((a, b) => a.item.viewer - b.item.viewer);
  const sections = [];
  for (const { group, item } of picked) {
    const title = picked.filter((p) => p.group === group).length > 1 ? group.title : '';
    const last = sections.at(-1);
    if (last && last.title === title) last.items.push(item);
    else sections.push({ title, items: [item] });
  }
  return sections;
}

// Defaults, then what this browser saved, then the URL (?key=value).
export function loadSettings(defaults, storageKey, params) {
  const settings = { ...defaults };
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
    for (const key of Object.keys(defaults)) if (key in saved) settings[key] = saved[key];
  } catch { /* nothing saved, or storage blocked */ }
  for (const key of Object.keys(defaults)) {
    if (!params.has(key)) continue;
    const raw = params.get(key);
    if (typeof defaults[key] !== 'number') settings[key] = raw;
    else if (Number.isFinite(Number(raw))) settings[key] = Number(raw);
  }
  return settings;
}
