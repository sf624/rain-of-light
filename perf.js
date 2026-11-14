// Switches for finding out what makes the page lighter, and the numbers that
// say how the sound and the frames are doing (the lab's readout, hud.js).
// Every switch is off by default, and each does one thing only (see
// docs/development.md, "Performance switches"):
//
//   ?latency=interactive|balanced|playback|<s>  the AudioContext's latencyHint
//   ?rate=<Hz>          the AudioContext's sample rate
//   ?ahead=<s>          the sound's events that begin "now" (a bell, a chord) begin this much later
//   ?reverb=off|short|<s>  no reverb, or a shorter room (short: 2 s; the room is 6 s)
//   ?voices=<n>         at most n notes at once: a note past that is not started
//   ?filters=krate      the pad's filters follow its brightness once per 128 samples
//   ?fps=<n>            draw at most n frames a second
//   ?scale=<x>          a fixed render scale (the adaptive step is not used)
//   ?guard=1            sound first: lower the picture's load while the sound is at risk
//   ?stall=<ms>[,<s>]   (a test) the main thread is busy for ms every s seconds (5)

const q = new URLSearchParams(location.search);
const num = (key) => (q.has(key) && Number.isFinite(Number(q.get(key))) ? Number(q.get(key)) : 0);

const latency = q.get('latency');
const reverb = q.get('reverb');
const [stallMs, stallEvery] = (q.get('stall') || '').split(',').map(Number);

export const PERF = {
  // The latencyHint, or null for the browser's default ('interactive').
  latency: ['interactive', 'balanced', 'playback'].includes(latency) ? latency : num('latency') > 0 ? num('latency') : null,
  rate: num('rate') >= 8000 ? num('rate') : 0,
  ahead: Math.max(0, num('ahead')),
  // The reverb's length in seconds; 0: no reverb.
  reverb: reverb === 'off' ? 0 : reverb === 'short' ? 2 : num('reverb') > 0 ? num('reverb') : 6,
  voices: Math.max(0, Math.floor(num('voices'))),
  krate: q.get('filters') === 'krate',
  fps: num('fps') > 0 ? num('fps') : 0,
  scale: num('scale') > 0 ? Math.min(1, num('scale')) : 0,
  guard: q.get('guard') === '1',
};

const WINDOW = 10000;          // ms: the readout's "last 10 s"
const LONG_MS = 50;            // a frame or a task this long is long
const now = () => performance.now();
const ms = (s) => (typeof s === 'number' ? `${(s * 1000).toFixed(1)}ms` : '?');

// Events in a window of time: [time, value]; count and worst of the last WINDOW ms,
// and of all time since the page loaded.
function createLog() {
  const items = [];
  let count = 0, worst = 0;
  return {
    add(v, at = now()) { items.push([at, v]); count++; worst = Math.max(worst, v); },
    read(at = now()) {
      while (items.length && items[0][0] < at - WINDOW) items.shift();
      return { n: items.length, worst: items.reduce((m, [, v]) => Math.max(m, v), 0), all: count, allWorst: worst };
    },
  };
}

// ---------- a log of events, to copy from the readout ----------
// What happened when (seconds since the page loaded): the sound's context
// changing state, its clock standing still, underruns, the page hidden or
// shown, long frames. The last LOG_N; the readout shows the last few.
const LOG_N = 60;
export const events = [];
let lastNote = null;   // the last entry, while long frames are counted into it
export function note(text) {
  events.push(`${(now() / 1000).toFixed(1)}s ${text}`);
  if (events.length > LOG_N) events.shift();
  lastNote = null;
}
// Long frames come in runs on a slow device: one entry for a run (gaps under 3 s apart).
function noteFrame(gap) {
  const t = now();
  if (lastNote && t - lastNote.at < 3000 && events.at(-1) === lastNote.text) {
    lastNote.n++; lastNote.worst = Math.max(lastNote.worst, gap); lastNote.at = t;
  } else {
    note('');
    lastNote = { from: (t / 1000).toFixed(1), n: 1, worst: gap, at: t };
  }
  const l = lastNote;
  l.text = `${l.from}s frames over 100ms: ${l.n}${l.n > 1 ? ` (to ${(t / 1000).toFixed(1)}s)` : ''}, worst ${l.worst.toFixed(0)}ms`;
  events[events.length - 1] = l.text;
}

// ---------- the frames ----------
const longFrames = createLog();
const longTasks = createLog();
let lastFrame = 0, lastDrawn = 0, cpuSum = 0, cpuMax = 0, cpuN = 0, beganAt = 0;
let gpu = null;                // the timer queries, made when the readout first asks
let wantedAt = -1e9;           // when the readout last asked (the GPU is timed only while it does)
let gpuSum = 0, gpuN = 0, gpuMax = 0, gpuNote = 'not timed';

function observeTasks() {
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) longTasks.add(e.duration, e.startTime);
    }).observe({ type: 'longtask', buffered: true });
    return true;
  } catch { return false; }
}
let tasksSeen = null;          // null: not asked yet; false: the browser does not tell
// A hidden page draws no frames: the gap after it is not a long frame.
document.addEventListener('visibilitychange', () => { lastFrame = 0; note(`page ${document.hidden ? 'hidden' : 'shown'}`); });
addEventListener('pagehide', () => note('page hide'));
addEventListener('pageshow', () => note('page show'));

// ---------- the sound's numbers (audio.js reports them here) ----------
const nowEvents = createLog(); // sound events begun "now": less than NOW_MS ahead of the context's time
const tickLate = createLog();  // the sound's timer, late by ms (more than 100 ms)
const NOW_MS = 10;
let minLead = Infinity;
let slip0 = null;              // the output's first [performance time, context time] while running
const slipLog = [];            // [performance time, slip so far in ms], a few a second
let audio = null;              // the AudioContext, once there is one
let capacity = null;           // AudioRenderCapacity's last update, where there is one

export const soundLog = {
  context(ctx) {
    audio = ctx;
    note(`sound: context made, ${ctx.state}, ${ctx.sampleRate} Hz, base ${ms(ctx.baseLatency)}, hint ${PERF.latency ?? 'default'}`);
    ctx.addEventListener('statechange', () => note(`sound: state ${ctx.state} (out ${ms(ctx.outputLatency)})`));
    ctx.addEventListener('error', (e) => note(`sound: error ${e.message || e.error || ''}`));
    ctx.addEventListener('sinkchange', () => note('sound: output device changed'));
    const rc = ctx.renderCapacity;
    if (rc && typeof rc.start === 'function') {
      try {
        rc.addEventListener('update', (e) => { capacity = { average: e.averageLoad, peak: e.peakLoad, underrun: e.underrunRatio }; });
        rc.start({ updateInterval: 1 });
      } catch { /* not there after all */ }
    }
  },
  // A sound scheduled at context time `at`, asked for at context time `t`.
  scheduled(at, t) {
    const lead = (at - t) * 1000;
    minLead = Math.min(minLead, lead);
    if (lead < NOW_MS) nowEvents.add(lead);
  },
  tick(late) { if (late > 100) tickLate.add(late); },
};

// The output's clock against the page's: how much the context's time fell
// behind (the sound lost, or the two clocks drift apart), in ms: in all
// since the sound began to run, and over the last WINDOW.
function slipNow() {
  if (!audio || audio.state !== 'running' || typeof audio.getOutputTimestamp !== 'function') { slip0 = null; slipLog.length = 0; return null; }
  const { contextTime, performanceTime } = audio.getOutputTimestamp();
  if (!(performanceTime > 0) || !(contextTime > 0)) return null;
  if (!slip0) slip0 = [performanceTime, contextTime];
  const total = (performanceTime - slip0[0]) - (contextTime - slip0[1]) * 1000;
  slipLog.push([performanceTime, total]);
  while (slipLog.length > 2 && slipLog[0][0] < performanceTime - WINDOW) slipLog.shift();
  return { total, recent: total - slipLog[0][1] };
}

function playback() {
  const s = audio && audio.playbackStats;
  if (!s) return null;
  return { underruns: s.underrunEvents, underrunS: s.underrunDuration, avgLatency: s.averageLatency, maxLatency: s.maximumLatency, total: s.totalDuration };
}

// The context's clock, watched every frame: while it runs, currentTime
// should move on with the page's clock (in steps of the output buffer). A
// clock that stands still over STALL_MS is a stall: the sound stopped. And
// once a second: new underruns, and the output clock's slip.
const STALL_MS = 150;
let ctxT = -1, ctxFirst = 0, ctxSame = 0, stalls = 0, stallMax = 0, stallLast = '', sampledAt = 0, underrunsSeen = 0, slipSeen = null;
function watchClock(t) {
  if (!audio) return;
  if (audio.state !== 'running' || document.hidden) { ctxT = -1; return; }
  const c = audio.currentTime;
  if (c === ctxT) ctxSame = t;   // the same time as the frame before: standing still since ctxFirst
  else {
    // From the first frame that saw the old time to the last: it stood still
    // at least that long (a large output buffer moves it in large steps).
    const still = ctxSame - ctxFirst;
    if (ctxT >= 0 && still > Math.max(STALL_MS, 2.5 * (audio.baseLatency || 0) * 1000)) {
      stalls++; stallMax = Math.max(stallMax, still);
      stallLast = `${(t / 1000).toFixed(1)}s`;
      note(`sound: clock stood still ${still.toFixed(0)}ms`);
    }
    ctxT = c; ctxFirst = ctxSame = t;
  }
  if (t - sampledAt < 1000) return;
  sampledAt = t;
  const p = playback();
  if (p && p.underruns > underrunsSeen) note(`sound: underruns +${p.underruns - underrunsSeen} (all ${p.underruns}, ${ms(p.underrunS)})`);
  if (p) underrunsSeen = p.underruns;
  const sl = slipNow();
  if (sl && slipSeen !== null && sl.total - slipSeen > 20) note(`sound: output clock slipped ${(sl.total - slipSeen).toFixed(0)}ms`);
  slipSeen = sl ? sl.total : null;
}

// ---------- sound first (?guard=1) ----------
// Each level lowers the picture's load more: 1 draws at most 60 frames a
// second (a 120 Hz screen draws every other frame), 2 at most 30, 3 also caps
// the render scale at 0.7, 4 at 0.5. A sign of trouble
// for the sound (an underrun or a high render load where the browser tells;
// the sound's clock falling behind; long frames or a late sound timer) steps
// one level down; GUARD_UP s without one steps one level back up, a wait
// that doubles each time the sound is troubled again soon after.
const GUARD_CAPS = [[0, 1], [60, 1], [30, 1], [30, 0.7], [30, 0.5]];  // [fps, largest scale]
const GUARD_UP = 30, GUARD_MAX = 300, GUARD_GAP = 4, GUARD_FRAME = 100, GUARD_SLIP = 30;
let level = 0, levelAt = 0, upWait = GUARD_UP, lastRaised = -1e9, why = '', checkedAt = 0, veryLong = 0;
let seen = { underruns: 0, frames: 0, ticks: 0, slip: 0 };

function trouble(at) {
  const p = playback(), k = tickLate.read(at), sl = slipNow();
  const signs = [];
  if (p && p.underruns > seen.underruns) signs.push('underrun');
  if (capacity && (capacity.peak > 0.9 || capacity.underrun > 0)) signs.push('render load');
  if (sl && sl.total - seen.slip > GUARD_SLIP) signs.push(`clock ${(sl.total - seen.slip).toFixed(0)} ms`);
  if (veryLong > seen.frames) signs.push('long frames');
  if (k.all > seen.ticks) signs.push('late timer');
  seen = { underruns: p ? p.underruns : 0, frames: veryLong, ticks: k.all, slip: sl ? sl.total : 0 };
  return signs;
}

function govern(at) {
  if (!PERF.guard || at - checkedAt < 1000) return;
  checkedAt = at;
  const s = trouble(at);
  const since = (at - levelAt) / 1000;
  if (s.length) {
    why = s.join(', ');
    if (level < GUARD_CAPS.length - 1 && since > GUARD_GAP) {
      if (at - lastRaised < 10000) upWait = Math.min(GUARD_MAX, upWait * 2);
      level++; levelAt = at;
    }
  } else if (level > 0 && since > upWait) {
    level--; levelAt = lastRaised = at;
  }
}

// ---------- what main.js asks ----------
export const perf = {
  // Draw this frame? With a frame rate cap (?fps= or the guard), a frame
  // that comes sooner than the cap allows is skipped (a little early is
  // allowed, so 30 fps on a 60 Hz screen draws every other frame).
  skip(t) {
    const fps = Math.max(PERF.fps, GUARD_CAPS[level][0]);
    if (!fps || !lastDrawn) return false;
    return t - lastDrawn < 1000 / fps - 4;
  },
  // The frame time adaptive quality should judge: with a cap, the frame is
  // given that much longer, so the cap alone does not read as slow.
  adaptDt(rawDt) {
    const fps = Math.max(PERF.fps, GUARD_CAPS[level][0]);
    return fps && fps < 60 ? rawDt * fps / 60 : rawDt;
  },
  // The render scale: fixed (?scale=), else the adaptive step's, capped by the guard.
  scale(step) { return PERF.scale || Math.min(step, GUARD_CAPS[level][1]); },
  get fixedScale() { return PERF.scale > 0; },
  begin(t, gl) {
    const gap = t - lastFrame;
    if (lastFrame && gap > LONG_MS && !document.hidden) {
      longFrames.add(gap);
      if (gap > GUARD_FRAME) { veryLong++; noteFrame(gap); }
    }
    watchClock(t);
    lastFrame = lastDrawn = t;
    beganAt = now();
    govern(beganAt);
    if (beganAt - wantedAt < 1000) gpuBegin(gl);
  },
  end(gl) {
    const ms = now() - beganAt;
    cpuSum += ms; cpuN++; cpuMax = Math.max(cpuMax, ms);
    if (gpu && gpu.open) gpuEnd(gl);
  },
  // For the readout, a few times a second.
  read() {
    const t = now();
    wantedAt = t;
    if (tasksSeen === null) tasksSeen = observeTasks();
    const out = {
      cpu: cpuN ? { avg: cpuSum / cpuN, max: cpuMax } : null,
      gpu: gpuN ? { avg: gpuSum / gpuN, max: gpuMax } : null, gpuNote,
      frames: longFrames.read(t),
      tasks: tasksSeen ? longTasks.read(t) : null,
      voices: soundLog.voices ? soundLog.voices() : null,
      events,
      dpr: devicePixelRatio,
      guard: PERF.guard ? { level, why, fps: GUARD_CAPS[level][0], scale: GUARD_CAPS[level][1] } : null,
      sound: audio ? {
        state: audio.state, rate: audio.sampleRate, base: audio.baseLatency, out: audio.outputLatency,
        hint: PERF.latency ?? 'default', now: nowEvents.read(t), minLead, tick: tickLate.read(t),
        slip: slipNow(), playback: playback(), capacity, stalls, stallMax, stallLast,
      } : null,
    };
    cpuSum = cpuN = cpuMax = 0;
    gpuSum = gpuN = gpuMax = 0;
    return out;
  },
};

// ---------- the GPU's time per frame (EXT_disjoint_timer_query_webgl2) ----------
function gpuBegin(gl) {
  if (!gpu) {
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    gpu = { ext, pool: [], waiting: [], open: null };
    if (!ext) gpuNote = 'no timer query';
  }
  if (!gpu.ext) return;
  // Results come some frames later.
  while (gpu.waiting.length) {
    const qy = gpu.waiting[0];
    if (!gl.getQueryParameter(qy, gl.QUERY_RESULT_AVAILABLE)) break;
    gpu.waiting.shift();
    const ns = gl.getQueryParameter(qy, gl.QUERY_RESULT);
    if (!gl.getParameter(gpu.ext.GPU_DISJOINT_EXT)) {
      const ms = ns / 1e6;
      gpuSum += ms; gpuN++; gpuMax = Math.max(gpuMax, ms);
      gpuNote = '';
    }
    gpu.pool.push(qy);
  }
  if (gpu.waiting.length > 8) return;
  const qy = gpu.pool.pop() || gl.createQuery();
  gl.beginQuery(gpu.ext.TIME_ELAPSED_EXT, qy);
  gpu.open = qy;
}

function gpuEnd(gl) {
  gl.endQuery(gpu.ext.TIME_ELAPSED_EXT);
  gpu.waiting.push(gpu.open);
  gpu.open = null;
}

// ---------- a test: the main thread busy on purpose ----------
if (stallMs > 0) {
  setInterval(() => {
    const end = now() + stallMs;
    while (now() < end) { /* busy */ }
  }, (stallEvery > 0 ? stallEvery : 5) * 1000);
}
