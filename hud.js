// The lab's readout (HUD): the show's state at a glance, a few times a second.
// main.js hands over `snapshot()`, a read-only description of the real state
// objects; this file only lays it out. Hidden, it costs one boolean test per
// frame; on the viewer page there is none (createHud returns a stub).
// Toggled by the HUD button in the clock bar, the `h` key or ?hud=1 (?hud=0
// forces it off); the choice is kept in this browser. ?hud=perf shows only
// the rows of the sound and the timing (perf.js), on a phone too; the copy
// button beside the HUD button copies every row as text.

import { isTyping } from './keys.js';

const KEY = 'rain-of-light-hud';
const SAMPLE_MS = 250;   // the readout's rate

const f2 = (v) => v.toFixed(2);
const pct = (v) => `${Math.round(v * 100)}%`;
const rgb = (c) => `rgb(${c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)).join(',')})`;
const sec = (s) => (s < 100 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`);
const msOf = (s) => (typeof s === 'number' ? `${(s * 1000).toFixed(1)}ms` : '?');
const ms1 = (v) => (v === Infinity ? '-' : `${v.toFixed(1)}`);
// A log of perf.js: n and worst in the last 10 s, and since the page loaded.
const logText = (l) => `${l.n} (worst ${Math.round(l.worst)}ms), all ${l.all} (worst ${Math.round(l.allWorst)}ms)`;

// The rows, top to bottom. core: kept on a narrow screen (see style.css).
// text(s) gives the row's value; colors(s) the swatches after it.
const ROWS = [
  ['time', 'time', true, (s) => `t ${s.time.toFixed(1)}s  ${s.rateText}  ${s.paused ? 'paused' : 'running'}  seed ${s.seed}`],
  ['perf', 'frame', true, (s) => `${s.fps.toFixed(0)} fps  ${s.ms.toFixed(1)} ms  scale ${f2(s.scale)}${s.adaptive ? '' : ' (full)'}  ${s.canvas[0]}x${s.canvas[1]}`],
  ['seek', 'seek', false, (s) => `last seek: ${s.seek.steps} steps, ${s.seek.ms.toFixed(1)} ms  snapshots ${s.seek.snaps}`],
  ['lattice', 'lattice', false, (s) => `${s.grid}x${s.grid} strands x ${s.rows} LEDs = ${s.leds}`],
  // The settings that choose what plays, what plays now, and the timeline's passage where that differs.
  ['show', 'show', true, (s) => {
    const w = s.show;
    return `rain ${s.rain} form ${s.form} layer ${s.layer}  ${w.playing}${w.playing === w.passage ? ''
      : ` (passage ${w.passage})`}, next in ${sec(Math.max(0, w.next))}${s.egg ? `  egg ${s.egg}` : ''}`;
  }],
  ['rain', 'rain', true, (s) => `${f2(s.show.rain)}  storm ${f2(s.show.storm)} (rain through a form)`],
  ['forms', 'forms', true, (s) => {
    const sky = s.show.items.filter((i) => i.form !== 'layer');
    const one = (i) => `${i.form}${i.figure ? ` (${i.figure})` : ''} ${f2(i.w)} ${i.palette} age ${sec(i.age)} ${i.out ? 'going' : i.w < 0.99 ? 'coming' : 'in'}`;
    return sky.length ? sky.map(one).join('  |  ') : 'none';
  }, (s) => s.show.items.filter((i) => i.form !== 'layer').flatMap((i) => i.colors)],
  ['layer', 'layer', false, (s) => {
    const l = s.show.items.find((i) => i.form === 'layer');
    return l ? `on ${f2(l.w)} ${l.palette}` : 'off';
  }, (s) => s.show.items.filter((i) => i.form === 'layer').flatMap((i) => i.colors)],
  ['weather', 'weather', true, (s) => `${s.weather.name}  rain ${f2(s.weather.rain)}  fall ${f2(s.weather.fall)}  density ${f2(s.density[0])}/${f2(s.density[1])}  share ${f2(s.rainShare)}`],
  ['flow', 'flow', false, (s) => `down ${pct(s.flow.down)}  across ${pct(s.flow.across)}  blend ${f2(s.flow.mix)}  ${s.flow.goal ? 'goal across' : 'goal down'}`],
  ['color', 'colour', false, (s) => `${s.color.mode}  ${s.color.palette ?? ''}`, (s) => s.color.swatches],
  ['bright', 'bright', true, (s) => `exposure ${f2(s.light.exposure)} x breath ${s.light.breath === null ? 'off' : f2(s.light.glow)} = ${f2(s.light.applied)}`],
  ['light', 'light', false, (s) => `room ${f2(s.light.room)}  wire ${f2(s.light.wire)}  twinkle ${f2(s.light.twinkle)}  fall light ${f2(s.light.fall)}  form gain x${f2(s.light.stormGain)}`],
  ['glow', 'glow', false, (s) => `${s.light.bloom > 0 ? `glow ${f2(s.light.bloom)}` : 'glow off'}  haze ${s.light.haze > 0 ? f2(s.light.haze) : 'off'}  burn ${s.light.burn > 0 ? f2(s.light.burn) : 'off'}  rays ${s.light.rays}  float buffers ${s.light.float ? 'yes' : 'no'}`],
  ['camera', 'camera', false, (s) => `${s.camera.moves}  eye ${s.camera.eye.map((v) => v.toFixed(1)).join(' ')}${Math.abs(s.camera.turn) >= 0.5 ? `  turn ${Math.round(s.camera.turn)}°` : ''}`],
  ['ripples', 'ripples', false, (s) => `${s.ripples} alive`],
  // The sound and the timing (perf.js): with ?hud=perf the only rows beside time, frame and show.
  ['sound', 'sound', 'perf', (s) => {
    const a = s.perf.sound;
    return a ? `${a.state}  ${a.rate} Hz  base ${msOf(a.base)}  out ${msOf(a.out)}  hint ${a.hint}` : 'not started (a tap or a key starts it)';
  }],
  ['voices', 'voices', 'perf', (s) => {
    const v = s.perf.voices;
    return v ? `${v.notes} notes, about ${v.nodes} nodes in them` : '-';
  }],
  ['sched', 'sched', 'perf', (s) => {
    const a = s.perf.sound;
    return a ? `begun now (under 10ms ahead): ${a.now.n}, all ${a.now.all}  least lead ${ms1(a.minLead)}ms  timer late: ${logText(a.tick)}` : '-';
  }],
  ['render', 'render', 'perf', (s) => {
    const a = s.perf.sound;
    if (!a) return '-';
    const p = a.playback, c = a.capacity, sl = a.slip;
    return [
      p ? `underruns ${p.underruns} (${msOf(p.underrunS)})  latency avg ${msOf(p.avgLatency)} max ${msOf(p.maxLatency)}` : 'no playbackStats',
      c ? `load ${pct(c.average)} peak ${pct(c.peak)} underrun ${pct(c.underrun)}` : 'no renderCapacity',
      sl ? `clock slip 10s ${sl.recent.toFixed(0)}ms, all ${sl.total.toFixed(0)}ms` : 'no clock slip',
      `clock stood still ${a.stalls}x${a.stalls ? ` (longest ${Math.round(a.stallMax)}ms, last at ${a.stallLast})` : ''}`,
    ].join('  ');
  }],
  ['timing', 'timing', 'perf', (s) => {
    const p = s.perf;
    const cpu = p.cpu ? `cpu ${p.cpu.avg.toFixed(1)}/${p.cpu.max.toFixed(1)}ms` : 'cpu -';
    const gpu = p.gpu ? `gpu ${p.gpu.avg.toFixed(1)}/${p.gpu.max.toFixed(1)}ms` : `gpu ${p.gpuNote || '-'}`;
    return `device dpr ${p.dpr}  ${cpu}  ${gpu}  long frames ${logText(p.frames)}${p.tasks ? `  long tasks ${logText(p.tasks)}` : ''}`;
  }],
  ['events', 'events', 'perf', (s) => (s.perf.events.length ? s.perf.events.slice(-3).join('  |  ') : 'none')],
  ['guard', 'guard', 'perf', (s) => {
    const g = s.perf.guard;
    return g ? `level ${g.level} (fps cap ${g.fps || 'none'}, scale cap ${g.scale})${g.why ? `  last: ${g.why}` : ''}` : 'off (?guard=1)';
  }],
];
const PERF_ROWS = ['time', 'perf', 'show'];   // shown with ?hud=perf, besides the rows marked 'perf'

export function createHud({ lab, params, bar, snapshot }) {
  if (!lab || !bar) return { frame() {} };

  let on = false;
  try { on = localStorage.getItem(KEY) === '1'; } catch { /* no storage: off */ }
  if (params.has('hud')) on = params.get('hud') === '1' || params.get('hud') === 'perf';
  const perfOnly = params.get('hud') === 'perf';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'clock-hud';
  btn.title = 'Readout of the show\'s state (h)';
  btn.textContent = 'HUD';
  // Copy every row as text, to paste the numbers somewhere (from a phone too).
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'clock-hud-copy';
  copy.title = 'Copy the readout as text';
  copy.textContent = 'copy';
  bar.append(btn, copy);

  const root = document.createElement('div');
  root.className = perfOnly ? 'hud perf-only' : 'hud';
  root.hidden = true;
  root.setAttribute('aria-hidden', 'true');
  const rows = ROWS.map(([id, label, core, text, colors]) => {
    const row = document.createElement('div');
    // With ?hud=perf: only its rows, all of them on a narrow screen too.
    const shown = !perfOnly || core === 'perf' || PERF_ROWS.includes(id);
    row.className = perfOnly ? 'hud-row' : core === true ? 'hud-row' : 'hud-row more';
    row.hidden = !shown;
    const k = document.createElement('span');
    k.className = 'hud-k';
    k.textContent = label;
    const v = document.createElement('span');
    const sw = document.createElement('span');
    sw.className = 'hud-sw';
    row.append(k, v, sw);
    root.append(row);
    return { id, label, text, colors, v, sw, shown: '', tint: '' };
  });
  document.body.append(root);
  let last = null;   // the last snapshot shown
  copy.addEventListener('click', () => {
    if (!last) return;
    const lines = [`${new Date().toISOString()}  ${location.href}`, navigator.userAgent,
      `screen ${screen.width}x${screen.height} dpr ${devicePixelRatio} window ${innerWidth}x${innerHeight}`,
      ...rows.map((r) => `${r.label}: ${r.text(last)}`),
      'event log:', ...last.perf.events];
    const text = lines.join('\n');
    const done = () => { copy.classList.add('copied'); setTimeout(() => copy.classList.remove('copied'), 1200); };
    // The clipboard (a secure page), else a text area to copy by hand.
    navigator.clipboard?.writeText(text).then(done, () => byHand(text)) ?? byHand(text);
  });
  function byHand(text) {
    const area = document.createElement('textarea');
    area.className = 'hud-copy';
    area.value = text;
    area.readOnly = true;
    area.addEventListener('blur', () => area.remove());
    document.body.append(area);
    area.focus();
    area.select();
  }

  let frames = 0, since = 0, fps = 0, ms = 0;   // frames drawn since the last sample, and since when (rAF time)
  const draw = () => {
    const s = last = snapshot();
    s.fps = fps; s.ms = ms;
    for (const r of rows) {
      if (r.v.parentNode.hidden) continue;
      const t = r.text(s);
      if (t !== r.shown) { r.v.textContent = t; r.shown = t; }
      if (r.colors) {
        const cs = r.colors(s).map(rgb).join(' ');
        if (cs !== r.tint) {
          r.tint = cs;
          r.sw.replaceChildren(...cs.split(' ').filter(Boolean).map((c) => {
            const i = document.createElement('i');
            i.style.background = c;
            return i;
          }));
        }
      }
    }
  };

  function set(value, save = true) {
    on = value;
    root.hidden = !on;
    btn.setAttribute('aria-pressed', String(on));
    btn.classList.toggle('active', on);
    copy.hidden = !on;
    if (on) { frames = 0; since = 0; draw(); }
    if (save) try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* not saved */ }
  }
  btn.addEventListener('click', () => set(!on));
  addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.key === 'h' && !isTyping(e.target)) set(!on);
  });
  set(on, false);

  return {
    // Per frame: when hidden, nothing. Else count the frame, and a few times a second lay the readout out.
    frame(now) {
      if (!on) return;
      if (since === 0) { since = now; return; }
      frames++;
      if (now - since < SAMPLE_MS) return;
      ms = (now - since) / frames;
      fps = 1000 / ms;
      frames = 0; since = now;
      draw();
    },
  };
}
