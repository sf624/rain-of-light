// The lab's show clock: pause the picture, step it, run it faster.
// The page advances the show by `tick(dt)` each frame instead of by dt. On the
// viewer page (lab = false) this is dt itself and nothing is added.
// While paused the show stands still but every frame is still drawn, so a
// change in the settings panel shows on the frozen moment. Sound keeps running.

const RATES = [1, 4, 12, 30];
const STEP = 0.1;   // seconds of the show per step, at rate 1
const MAX_RATE = 60;

export function createClock({ lab, params }) {
  if (!lab) {
    return { paused: false, rate: 1, tick: (dt) => dt, show() {} };
  }
  // ?pause=1 opens paused; ?rate=12 opens fast (?t= is the start time).
  let paused = params.get('pause') === '1';
  let rate = Number(params.get('rate'));
  rate = Number.isFinite(rate) && rate > 0 ? Math.min(MAX_RATE, rate) : 1;
  let stepped = false, now = 0;

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
  const rateBtn = mk('clock-rate', 'Speed: click for the next ([ slower, ] faster)');
  const readout = mk('clock-time', 'Copy a link to this moment');
  bar.append(pauseBtn, stepBtn, rateBtn, readout);
  document.body.append(bar);

  const state = {
    get paused() { return paused; },
    get rate() { return rate; },
    tick(dt) {
      if (stepped) { stepped = false; return STEP * rate; }
      return paused ? 0 : dt * rate;
    },
    show(t) {
      now = t;
      const s = `t ${t.toFixed(1)} s`;
      if (readout.textContent !== s) readout.textContent = s;
    },
  };

  function render() {
    pauseBtn.textContent = paused ? '▶' : '❚❚';
    pauseBtn.setAttribute('aria-pressed', String(paused));
    rateBtn.textContent = `x${rate}`;
    bar.classList.toggle('paused', paused);
  }
  const togglePause = () => { paused = !paused; render(); };
  const step = () => { paused = true; stepped = true; render(); };
  const nearest = () => RATES.reduce((a, r, i) => (Math.abs(r - rate) < Math.abs(RATES[a] - rate) ? i : a), 0);
  const setRate = (i) => { rate = RATES[Math.max(0, Math.min(RATES.length - 1, i))]; render(); };

  pauseBtn.addEventListener('click', togglePause);
  stepBtn.addEventListener('click', step);
  rateBtn.addEventListener('click', () => setRate(rate >= RATES[RATES.length - 1] ? 0 : (RATES.findIndex((r) => r > rate))));
  readout.addEventListener('click', () => {
    const q = new URLSearchParams(location.search);
    q.set('t', now.toFixed(1));
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
    else if (e.key === '[') setRate(nearest() - 1);
    else if (e.key === ']') setRate(nearest() + 1);
  });

  render();
  return state;
}
