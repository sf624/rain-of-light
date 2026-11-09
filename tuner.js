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

  document.body.append(toggle, root);
  refresh();

  function button(text, title) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.title = title;
    return b;
  }

  function format(item, v) {
    const decimals = Math.max(0, -Math.floor(Math.log10(item.step)));
    return Number(v).toFixed(decimals);
  }

  function set(key, value) {
    settings[key] = value;
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
      const changed = {};
      for (const key of Object.keys(defaults)) {
        if (settings[key] !== defaults[key]) changed[key] = settings[key];
      }
      localStorage.setItem(storageKey, JSON.stringify(changed));
    } catch { /* storage may be blocked: tuning still works for this visit */ }
  }

  function show(visible) {
    root.hidden = !visible;
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
