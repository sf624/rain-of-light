// A small panel of sliders and selects bound to a settings object.
// Settings are saved in this browser, so tuning survives a reload.

export function createTuner({ schema, settings, defaults, storageKey, onChange }) {
  const toggle = document.createElement('button');
  toggle.className = 'tuner-toggle';
  toggle.type = 'button';
  toggle.title = 'Settings (p)';
  toggle.setAttribute('aria-label', 'Settings');
  toggle.textContent = '⚙';

  const root = document.createElement('aside');
  root.className = 'tuner';
  root.hidden = true;

  const head = document.createElement('div');
  head.className = 'tuner-head';
  head.innerHTML = '<strong>Settings</strong>';
  const buttons = document.createElement('div');
  buttons.className = 'tuner-buttons';
  const copyBtn = button('Copy', 'Copy the settings as JSON');
  const resetBtn = button('Reset', 'Back to the defaults');
  const closeBtn = button('×', 'Close (p)');
  buttons.append(copyBtn, resetBtn, closeBtn);
  head.append(buttons);
  root.append(head);

  const inputs = new Map(); // key -> { input, out, item }
  // What this browser keeps: only values changed in the panel. A value given
  // in the URL is used for this visit but not kept, unless it is changed here.
  let kept = {};
  try { kept = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch { /* storage blocked */ }

  for (const group of schema) {
    const section = document.createElement('section');
    const h = document.createElement('h3');
    h.textContent = group.title;
    section.append(h);
    for (const item of group.items) {
      const row = document.createElement('label');
      row.className = 'tuner-row';
      const name = document.createElement('span');
      name.className = 'tuner-name';
      name.textContent = item.label;
      if (item.hint) row.title = item.hint;
      let input, out = null;
      if (item.options) {
        input = document.createElement('select');
        for (const opt of item.options) {
          const o = document.createElement('option');
          o.value = opt;
          o.textContent = opt;
          input.append(o);
        }
        input.addEventListener('change', () => set(item.key, input.value));
      } else {
        input = document.createElement('input');
        input.type = 'range';
        input.min = item.min;
        input.max = item.max;
        input.step = item.step;
        out = document.createElement('output');
        input.addEventListener('input', () => set(item.key, Number(input.value)));
      }
      row.append(name, input);
      if (out) row.append(out);
      section.append(row);
      inputs.set(item.key, { input, out, item });
    }
    root.append(section);
  }

  const foot = footer();
  root.append(foot);
  document.body.append(toggle, root);
  refresh();
  let versionAsked = false;

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

  function format(item, v) {
    const decimals = Math.max(0, -Math.floor(Math.log10(item.step)));
    return Number(v).toFixed(decimals);
  }

  function set(key, value) {
    settings[key] = value;
    if (value === defaults[key]) delete kept[key]; else kept[key] = value;
    const entry = inputs.get(key);
    if (entry && entry.out) entry.out.textContent = format(entry.item, value);
    save();
    onChange(key, value);
  }

  function refresh() {
    for (const [key, { input, out, item }] of inputs) {
      input.value = settings[key];
      if (out) out.textContent = format(item, settings[key]);
    }
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

  // Keys typed into the panel must not reach the page's own shortcuts.
  root.addEventListener('keydown', (e) => e.stopPropagation());

  if (location.hash === '#tune') show(true); // a link that opens with the panel

  return {
    toggle: () => show(root.hidden),
    refresh,
    set,
  };
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
