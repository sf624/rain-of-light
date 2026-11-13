// The lab's show clock: pause the picture, step it, run it faster.
// The page advances the show by `tick(dt)` each frame instead of by dt. On the
// viewer page (lab = false) this is dt itself and nothing is added.
// While paused the show stands still but every frame is still drawn, so a
// change in the settings panel shows on the frozen moment. Sound keeps running.

// The speed: from slow motion to fast forward. The slider runs on a log scale
// from MIN_RATE to SLIDER_MAX and sticks to the SNAPS; ?rate= may go up to MAX_RATE.
const SNAPS = [0.1, 0.25, 0.5, 1, 2, 4, 12, 30];
const MIN_RATE = 0.1, SLIDER_MAX = 30, MAX_RATE = 60;
const STEP = 0.1;   // seconds of the show per step, at rate 1
const SNAP_PULL = 0.008;   // how near (of the slider's length) a snap point takes the thumb
const SPAN_LOG = Math.log(SLIDER_MAX / MIN_RATE);
const toPos = (r) => Math.min(1, Math.max(0, Math.log(r / MIN_RATE) / SPAN_LOG));
const fromPos = (p) => MIN_RATE * Math.exp(p * SPAN_LOG);
const clampRate = (r) => Math.min(MAX_RATE, Math.max(MIN_RATE, r));
// 0.25, 1, 2.5, 12: at most two decimals below 1, one above, none from 10.
export const rateText = (r) => `x${r < 1 ? +r.toFixed(2) : r < 10 ? +r.toFixed(1) : Math.round(r)}`;

export function createClock({ lab, params, seed }) {
  if (!lab) {
    return { paused: false, rate: 1, bar: null, tick: (dt) => dt, show() {}, onSeek: null };
  }
  // ?pause=1 opens paused; ?rate=12 opens fast, ?rate=0.25 slow (?t= is the start time).
  let paused = params.get('pause') === '1';
  let rate = Number(params.get('rate'));
  rate = Number.isFinite(rate) && rate > 0 ? clampRate(rate) : 1;
  let stepped = false, now = 0, top = 0;   // top: the furthest time shown

  const bar = document.createElement('div');
  bar.className = 'clock';
  const mk = (cls, title) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.title = title;
    return b;
  };
  const pauseBtn = mk('clock-pause', 'Pause / resume the show (Space)');
  const stepBtn = mk('clock-step', 'One step forward (.)');
  stepBtn.textContent = '▶|';
  const rateBtn = mk('clock-rate', 'Speed ([ slower, ] faster)');
  rateBtn.setAttribute('aria-haspopup', 'true');
  const readout = mk('clock-time', 'Copy a link to this moment');
  // The speed button opens a small popover: a slider (log scale, with snap points) and a reset to x1.
  const speed = document.createElement('div');
  speed.className = 'clock-speed';
  const pop = document.createElement('div');
  pop.className = 'clock-pop';
  pop.hidden = true;
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0'; slider.max = '1'; slider.step = 'any';
  slider.setAttribute('list', 'clock-snaps');
  slider.setAttribute('aria-label', 'Speed');
  const marks = document.createElement('datalist');
  marks.id = 'clock-snaps';
  for (const r of SNAPS) { const o = document.createElement('option'); o.value = String(toPos(r)); marks.append(o); }
  const resetBtn = mk('clock-one', 'Back to normal speed');
  resetBtn.textContent = 'x1';
  // Seek: back and forward by 5 s and 30 s (the arrow keys, Shift for 30 s), and a scrubber over the time played so far.
  const seeks = document.createElement('div');
  seeks.className = 'clock-seek';
  const seekBtns = [-30, -5, 5, 30].map((d) => {
    const b = mk('clock-jump', `${d < 0 ? 'Back' : 'Forward'} ${Math.abs(d)} s (${Math.abs(d) === 5 ? '' : 'Shift + '}arrow ${d < 0 ? 'left' : 'right'})`);
    b.textContent = `${d > 0 ? '+' : '\u2212'}${Math.abs(d)}`;
    b.addEventListener('click', () => seekBy(d));
    return b;
  });
  const scrub = document.createElement('input');
  scrub.type = 'range';
  scrub.className = 'clock-scrub';
  scrub.min = '0'; scrub.max = '1'; scrub.step = 'any'; scrub.value = '0';
  scrub.setAttribute('aria-label', 'Time');
  scrub.addEventListener('input', () => state.onSeek?.(Number(scrub.value)));
  seeks.append(...seekBtns, scrub);
  pop.append(slider, resetBtn, marks, seeks);
  speed.append(rateBtn, pop);
  bar.append(pauseBtn, stepBtn, speed, readout);
  document.body.append(bar);

  const state = {
    bar,
    onSeek: null,   // set by the page: seek to a time
    get paused() { return paused; },
    get rate() { return rate; },
    tick(dt) {
      if (stepped) { stepped = false; return STEP * rate; }
      return paused ? 0 : dt * rate;
    },
    show(t, note = '') {
      now = t;
      if (t > top) top = t;
      const s = `t ${t.toFixed(1)} s${note ? `  ${note}` : ''}`;
      if (readout.textContent !== s) readout.textContent = s;
      if (!pop.hidden && document.activeElement !== scrub) { scrub.max = String(Math.max(1, top)); scrub.value = String(t); }
    },
  };

  function render() {
    pauseBtn.textContent = paused ? '▶' : '❚❚';
    pauseBtn.setAttribute('aria-pressed', String(paused));
    rateBtn.textContent = rateText(rate);
    resetBtn.disabled = rate === 1;
    if (document.activeElement !== slider || toPos(rate) !== Number(slider.value)) slider.value = String(toPos(rate));
    slider.setAttribute('aria-valuetext', rateText(rate));
    bar.classList.toggle('paused', paused);
  }
  const togglePause = () => { paused = !paused; render(); };
  const step = () => { paused = true; stepped = true; render(); };
  const seekBy = (d) => state.onSeek?.(Math.max(0, now + d));
  const EPS = 1e-6;
  // The next snap point above (dir 1) or below (-1) the rate; none past the ends.
  const stepRate = (dir) => {
    const next = dir > 0 ? SNAPS.find((r) => r > rate * (1 + EPS)) : SNAPS.findLast((r) => r < rate * (1 - EPS));
    if (next !== undefined) { rate = next; render(); }
  };
  const setOpen = (open) => { pop.hidden = !open; rateBtn.setAttribute('aria-expanded', String(open)); };

  pauseBtn.addEventListener('click', togglePause);
  stepBtn.addEventListener('click', step);
  rateBtn.addEventListener('click', () => setOpen(pop.hidden));
  resetBtn.addEventListener('click', () => { rate = 1; render(); });
  slider.addEventListener('input', () => {
    let p = Number(slider.value);
    const near = SNAPS.map(toPos).find((q) => Math.abs(q - p) < SNAP_PULL);
    if (near !== undefined) { p = near; slider.value = String(p); }
    rate = near === undefined ? clampRate(fromPos(p)) : SNAPS[SNAPS.map(toPos).indexOf(near)];
    render();
  });
  // Any click outside the popover and its button closes it.
  addEventListener('pointerdown', (e) => { if (!pop.hidden && !speed.contains(e.target)) setOpen(false); });
  readout.addEventListener('click', () => {
    const q = new URLSearchParams(location.search);
    q.set('t', now.toFixed(1));
    if (seed !== undefined) q.set('seed', String(seed));   // (the show of this seed: a link brings the same moment)
    q.set('pause', '1');
    q.delete('rate');
    const url = `${location.origin}${location.pathname}?${q}`;
    navigator.clipboard?.writeText(url).then(() => {
      readout.classList.add('copied');
      setTimeout(() => readout.classList.remove('copied'), 1200);
    }, () => {});
  });

  addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === ' ') {
      if (e.target instanceof HTMLElement && e.target.closest('button, a, input, select, textarea')) return; // Space belongs to a focused control
      e.preventDefault();
      if (!e.repeat) togglePause();
    } else if (e.key === '.') step();   // held, it steps on
    else if (e.key === '[') stepRate(-1);
    else if (e.key === ']') stepRate(1);
    else if (e.key === 'Escape' && !pop.hidden) {
      const inside = pop.contains(document.activeElement);
      setOpen(false);
      if (inside) rateBtn.focus();   // the focus goes back to the button, not to nowhere
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !(e.target instanceof HTMLElement && e.target.closest('input, select, textarea'))) {   // (a button keeps the arrows for the seek; a slider, select or field has them for itself)
      e.preventDefault();
      seekBy((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 30 : 5));
    }
  });

  render();
  return state;
}
