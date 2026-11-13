// Measures the colour story (see director.js) without rendering: over many
// seeds, how often neighbouring passages differ in hue, how often each colour
// mode and palette comes, and how far the mood wanders. With and without the story.
// It also measures how long the picture stays in one colour family, and how
// much of the rain flows sideways (see show.js, drift), and how much of the
// time a form shows, and two at once (0: one form at a time, see show.js).
//   node tools/story-stats.mjs [seeds=50] [hours=1]
globalThis.innerWidth = globalThis.innerHeight = 1000;
const { COLOR_MODES, PALETTES, SETS, FORMS, EGGS } = await import('../config.js');
const { createDirector, hueOf, apart, KIN } = await import('../director.js');
const { createShow } = await import('../show.js');
const { createDirection } = await import('../direction.js');
const { DEFAULTS } = await import('../config.js');

// The hue of some colours together: their mean, each weighted by how much colour it has.
const hueOfAll = (cs) => {
  let x = 0, y = 0;
  for (const c of cs) { const [h, s] = hueOf(c); x += s * Math.cos(h * Math.PI / 180); y += s * Math.sin(h * Math.PI / 180); }
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
};
const pal = (n) => PALETTES.find((p) => p.name === n);
const ONE_PALETTE = ['mono', 'comet', 'accent'];
// The passages of rain alone: falling, and sideways.
const RAIN_ALONE = ['rain', 'drift'];
// The rain's main hue in a colour episode (undefined: many colours at once).
export function rainHue(e) {
  const name = e.item.name;
  if (ONE_PALETTE.includes(name)) return hueOfAll([e.p.a]);
  if (name === 'gradient') return hueOfAll([e.p.a, e.q.b]);
  if (name === 'palette') return ['sunset', 'ocean'].includes(e.set.name) ? hueOfAll(e.set.c) : undefined;
  if (name === 'cloud') return ((e.hue + 0.2) % 1) * 360;
  return undefined;
}
// What shows at t: the passage's kind, its main hue, and the names of its colours.
export function look(S, director, show, t) {
  const c = show.cast(t);
  const e = director[S.story === 'on' ? 'story' : 'color'].at(t);
  const form = c.items.find((i) => i.form !== 'layer'), layer = c.items.find((i) => i.form === 'layer');
  const name = e.item.name;
  const rain = name + (ONE_PALETTE.includes(name) ? ` ${e.p.name}` : name === 'gradient' ? ` ${e.p.name}>${e.q.name}`
    : name === 'palette' ? ` ${e.set.name}` : name === 'cloud' ? ` ${Math.round(((e.hue + 0.2) % 1) * 360)}` : '');
  // A form is the subject (rain through it takes its colour); else the rain; else the layer.
  const hue = form ? hueOfAll([pal(form.palette).a]) : RAIN_ALONE.includes(c.kind) ? rainHue(e)
    : layer ? hueOfAll([pal(layer.palette).a]) : undefined;
  return { kind: c.kind, hue, rain, form, layer, e, mood: director.mood(t) % 360 };
}

// How long the picture stays in one colour family: the stretches of time (s)
// in which the main hue (see look) stays within KIN degrees (see director.js). A stretch ends
// when the hue (or no hue: many colours at once) lies outside for more than
// GRACE seconds, so one short passage of another colour does not end it.
const GRACE = 30, STEP = 5;
export function stretches(S, director, show, span) {
  const out = [];
  let lo, hi, h0, from, outside;   // the stretch: its range from its first hue h0, its start, since when outside
  const close = (t) => { if (from !== undefined) out.push(t - from); from = undefined; };
  for (let t = 0; t < span; t += STEP) {
    const { hue } = look(S, director, show, t);
    if (from !== undefined && hue !== undefined) {
      const d = ((hue - h0) % 360 + 540) % 360 - 180;
      if (Math.max(hi, d) - Math.min(lo, d) <= KIN) { lo = Math.min(lo, d); hi = Math.max(hi, d); outside = undefined; continue; }
    }
    if (from !== undefined) {
      outside ??= t;
      if (t - outside <= GRACE) continue;
      close(outside);
      t = outside - STEP;            // start again where it left the family
      continue;
    }
    if (hue !== undefined) { from = t; h0 = hue; lo = hi = 0; outside = undefined; }
  }
  close(outside ?? span);
  return out;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const SEEDS = Number(process.argv[2]) || 50, SPAN = (Number(process.argv[3]) || 1) * 3600;
  const out = [];
  const pct = (n, d) => `${(100 * n / d).toFixed(1)}%`.padStart(6);
  const res = {};
  const count = (k, n) => { k[n] = (k[n] || 0) + 1; };
  for (const story of ['on', 'off']) {
    const r = res[story] = { runs: [], far: 0, far2: 0, pairs: 0, many: 0, passages: 0, modes: {}, pals: {}, forms: {}, layers: {}, sets: {}, off: 0, offN: 0 };
    for (let seed = 1; seed <= SEEDS; seed++) {
      const S = { scene: 'mix', form: 'auto', layer: 'auto', story };
      const director = createDirector(seed);
      const show = createShow(S, { feet: 0, seed });
      // Sampled each second. A new passage: another kind, or another form.
      const marks = [];
      let last = null;
      for (let t = 0; t < SPAN; t++) {
        const c = show.cast(t);
        const key = `${c.kind}|${c.items.filter((i) => i.form !== 'layer').map((i) => i.form + i.palette).join()}`;
        if (!last || last.key !== key) marks.push(last = { key, t0: t });
        last.t1 = t;
        // Shares of time: the rain's mode while rain falls alone, the palettes of forms and layers.
        const e = director[story === 'on' ? 'story' : 'color'].at(t);
        if (RAIN_ALONE.includes(c.kind)) {
          count(r.modes, e.item.name);
          if ([...ONE_PALETTE, 'gradient'].includes(e.item.name)) count(r.pals, e.p.name);
          if (e.item.name === 'palette') count(r.sets, e.set.name);
          const h = rainHue(e);
          if (h !== undefined) { r.off += apart(h, director.mood(t)); r.offN++; }
        }
        for (const i of c.items) count(i.form === 'layer' ? r.layers : r.forms, i.palette);
      }
      r.runs.push(...stretches(S, director, show, SPAN));
      let prev;
      for (const m of marks) {
        const l = look(S, director, show, (m.t0 + m.t1) / 2);
        r.passages++;
        if (l.hue === undefined) { r.many++; continue; }
        if (prev !== undefined) { r.pairs++; if (apart(prev, l.hue) > 90) r.far++; if (apart(prev, l.hue) > 120) r.far2++; }
        prev = l.hue;
      }
    }
  }
  const both = (f) => ['on', 'off'].map(f).join('  ');
  const table = (title, key, names) => {
    out.push('', title, '                 on     off');
    for (const n of names) {
      out.push(`  ${n.padEnd(10)} ${both((s) => { const k = res[s][key]; return pct(k[n] || 0, Object.values(k).reduce((a, b) => a + b, 0)); })}`);
    }
  };
  out.push(`Colour story: ${SEEDS} seeds x ${SPAN / 3600} h`);
  out.push('', 'Neighbouring passages (main hue: the form\'s palette, else the rain\'s colour at the passage\'s middle, else the layer\'s;',
    'passages of many colours have none and are left out of the pairs)',
    '                                         on     off');
  out.push(`  main hues more than 90 degrees apart ${both((s) => pct(res[s].far, res[s].pairs))}`);
  out.push(`  main hues more than 120 degrees apart${both((s) => pct(res[s].far2, res[s].pairs))}`);
  out.push(`  pairs counted                        ${both((s) => String(res[s].pairs).padStart(6))}`);
  out.push(`  passages of many colours             ${both((s) => pct(res[s].many, res[s].passages))}`);
  out.push(`  the rain's hue from the mood, mean   ${both((s) => `${(res[s].off / res[s].offN).toFixed(0)} deg`.padStart(6))}`);
  out.push('', `Stretches in one colour family (main hue within ${KIN} degrees, an outside spell under ${GRACE} s forgiven)`,
    '                                         on     off');
  const runs = (s) => [...res[s].runs].sort((a, b) => a - b);
  const at = (s, x) => { const l = runs(s); return `${(l[Math.floor(x * (l.length - 1))] / 60).toFixed(1)} min`.padStart(9); };
  const long = (s) => { const l = runs(s), all = l.reduce((a, b) => a + b, 0); return pct(l.filter((x) => x > 240).reduce((a, b) => a + b, 0), all); };
  out.push(`  median                            ${both((s) => at(s, 0.5))}`);
  out.push(`  90%                               ${both((s) => at(s, 0.9))}`);
  out.push(`  longest                           ${both((s) => at(s, 1))}`);
  out.push(`  share of time in stretches > 4 min   ${both(long)}`);
  out.push(`  stretches > 4 min                    ${both((s) => String(runs(s).filter((x) => x > 240).length).padStart(6))}`);
  table('Colour modes (share of the time rain falls alone)', 'modes', COLOR_MODES.map((m) => m.name));
  table('Palettes of the rain (mono, gradient, accent, comet)', 'pals', PALETTES.map((p) => p.name));
  table('Sets of the palette rain', 'sets', SETS.map((p) => p.name));
  table('Palettes of the forms (share of the time a form shows)', 'forms', PALETTES.map((p) => p.name));
  table('Palettes of the layer', 'layers', PALETTES.map((p) => p.name));
  // The mood: how far it moves within 20 minutes.
  const ranges = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    const mood = createDirector(seed).mood;
    for (let t0 = 0; t0 + 1200 <= SPAN; t0 += 1200) {
      let lo = Infinity, hi = -Infinity;
      for (let t = t0; t <= t0 + 1200; t += 10) { const m = mood(t); lo = Math.min(lo, m); hi = Math.max(hi, m); }
      ranges.push(hi - lo);
    }
  }
  ranges.sort((a, b) => a - b);
  const q = (x) => ranges[Math.floor(x * (ranges.length - 1))].toFixed(0);
  out.push('', `The mood's range within 20 minutes (degrees of hue; its whole axis runs from aurora's hue to amber's), ${ranges.length} windows`,
    `  least ${q(0)}  10% ${q(0.1)}  median ${q(0.5)}  90% ${q(0.9)}  most ${q(1)}`);
  // The rain's direction: the share of the rain (weighted by how much rain falls) that
  // flows sideways, and that falls down, as main.js runs them (direction.js), each tenth of
  // a second; and the sideways passages (drift): how many, how long, and what comes next to them.
  let side = 0, down = 0, all = 0, steps = 0, drifts = 0, lengths = [], next = 0;
  let lit = 0, full = 0, two = 0;     // steps with a form's light (shown weight above 0), with one wholly there, with two at once
  const came = {}, stayed = {};       // per form: how many times it came, and for how many seconds it showed
  const eggAt = [];                   // when each egg came (s into its seed's show)
  for (let seed = 1; seed <= SEEDS; seed++) {
    const show = createShow({ ...DEFAULTS }, { feet: 0, seed });
    const dir = createDirection(show.flow(0).toward);
    for (let t = 0; t < SPAN; t += 0.1) {
      const now = show.update(t, 0.1);
      dir.update(0.1, now.flow.toward, t);
      side += dir.weights[1] * now.rain; down += dir.weights[0] * now.rain; all += now.rain; steps++;
      const ws = show.info(t).items.filter((i) => i.form !== 'layer' && i.w > 0).map((i) => i.w);
      if (ws.length) lit++;
      if (ws.some((w) => w > 0.999)) full++;
      if (ws.length > 1) two++;
    }
    let from = null, kind = null;
    let form = null;
    for (let t = 0; t < SPAN; t++) {
      const c = show.cast(t), k = c.kind;
      const f = c.items.find((i) => i.form !== 'layer')?.form;
      if (f) count(stayed, f);
      if (f && f !== form) { count(came, f); if (EGGS.some((e) => e.name === f)) eggAt.push(t); }
      form = f;
      if (k === kind) continue;
      if (k === 'drift') { drifts++; from = t; if (['rain', 'storm'].includes(kind)) next++; }
      if (kind === 'drift') { lengths.push(t - from); if (['rain', 'storm'].includes(k)) next++; }
      kind = k;
    }
  }
  lengths.sort((a, b) => a - b);
  out.push('', "The rain's direction (share of the rain, weighted by how much falls)",
    `  sideways ${pct(side, all)}  down ${pct(down, all)}  between the two ${pct(all - side - down, all)}`,
    `  sideways passages: ${(drifts / SEEDS / (SPAN / 3600)).toFixed(1)} an hour, ${lengths[0]} .. ${lengths.at(-1)} s (median ${lengths[lengths.length >> 1]} s);`
    + ` next to falling rain: ${next}`);
  const hours = SEEDS * SPAN / 3600;
  out.push('', `Rain: ${pct(all, steps)} of the full rain, over the whole show`,
    '', 'Forms (times each comes in an hour; share of the show it is there)');
  out.push(`  (a form's light shows ${pct(lit, steps)} of the time, wholly ${pct(full, steps)}; two forms at once ${pct(two, steps)})`);
  for (const f of [...FORMS, ...EGGS]) out.push(`  ${f.name.padEnd(10)} ${((came[f.name] || 0) / hours).toFixed(1).padStart(5)}  ${pct(stayed[f.name] || 0, SEEDS * SPAN)}`);
  const sum = (k) => Object.values(k).reduce((a, b) => a + b, 0);
  out.push(`  ${'all'.padEnd(10)} ${(sum(came) / hours).toFixed(1).padStart(5)}  ${pct(sum(stayed), SEEDS * SPAN)}`);
  const eggs = EGGS.reduce((n, e) => n + (came[e.name] || 0), 0);
  out.push('', `Eggs (the baked forms): ${eggs} in ${hours} h, one every ${eggs ? (hours / eggs).toFixed(1) : '-'} h;`
    + ` the earliest at ${eggAt.length ? Math.min(...eggAt) : '-'} s`);
  console.log(out.join('\n'));
}
