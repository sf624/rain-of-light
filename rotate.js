// Landscape or portrait on demand, also when the phone's rotation lock is on.
//
// Two ways, tried in this order by the button:
//  1. The Screen Orientation API (Android Chrome, in full screen or as an
//     installed app): full screen, then screen.orientation.lock().
//  2. Where that is missing or refused (iOS Safari, desktop): the page turns its
//     own picture by 90 degrees. <body> is rotated by CSS (body.turned in
//     style.css) with its width and height swapped, so the canvas, the panel and
//     the buttons are all laid out in the turned shape. The browser still reports
//     pointer positions in the real screen: view.point() maps them.

// The picture's size and the way from screen points to the picture's points.
// Turned a quarter clockwise, the picture's left edge is the screen's top and
// its top edge is the screen's right: x = clientY, y = innerWidth - clientX.
export const view = {
  turned: false,
  get w() { return this.turned ? innerHeight : innerWidth; },
  get h() { return this.turned ? innerWidth : innerHeight; },
  point(x, y) { return this.turned ? { x: y, y: innerWidth - x } : { x, y }; },
  delta(dx, dy) { return this.turned ? { x: dy, y: -dx } : { x: dx, y: dy }; },
};

export function createRotation() {
  const btn = document.createElement('button');
  btn.className = 'rotate-toggle';
  btn.type = 'button';
  btn.title = 'Landscape / portrait (r)';
  btn.setAttribute('aria-label', 'Landscape or portrait');
  btn.setAttribute('aria-pressed', 'false');
  // A phone with a curved arrow around it.
  btn.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">'
    + '<rect x="5" y="4.5" width="6" height="9" rx="1"/>'
    + '<path d="M2.5 6.5V4.2C2.5 2.9 3.4 2 4.7 2H8"/><path d="M6.7 .6 8.3 2 6.7 3.4"/></svg>';
  document.body.append(btn);

  let locked = false;            // the orientation API holds the orientation
  let enteredFullscreen = false; // and we made the page full screen for it
  let turnedFrom = false;        // was the screen wider than tall when we turned
  let busy = false;

  const orientation = () => (typeof screen.orientation?.lock === 'function' ? screen.orientation : null);

  // The classes the CSS asks: .turned (our own rotation) and .portrait (the picture is taller than wide).
  function sync() {
    document.body.classList.toggle('turned', view.turned);
    document.body.classList.toggle('portrait', view.w < view.h);
    const on = locked || view.turned;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  }

  function setTurned(on) {
    if (on) turnedFrom = innerWidth > innerHeight;
    view.turned = on;
    sync();
  }

  // Path 1. Resolves true when the orientation is held; never throws.
  async function lock(target) {
    const o = orientation();
    if (!o) return false;
    let entered = false;
    try {
      if (!document.fullscreenElement) {
        if (!document.fullscreenEnabled) return false;
        await document.documentElement.requestFullscreen();
        entered = true;
      }
      await o.lock(target);
      locked = true;
      enteredFullscreen = entered;
      return true;
    } catch { // refused (not a phone, not allowed here): the caller turns the picture itself
      if (entered) { try { await document.exitFullscreen(); } catch { /* already out */ } }
      return false;
    }
  }

  function unlock() {
    locked = false;
    try { orientation()?.unlock(); } catch { /* nothing held */ }
    if (enteredFullscreen && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    enteredFullscreen = false;
  }

  async function toggle() {
    if (busy) return;
    busy = true;
    try {
      if (locked) unlock();
      else if (view.turned) setTurned(false);
      else {
        // To the shape the picture does not have now.
        const target = view.w < view.h ? 'landscape' : 'portrait';
        if (!(await lock(target))) setTurned(true); // path 2
      }
    } finally {
      busy = false;
      sync();
    }
  }

  btn.addEventListener('click', toggle);
  // The browser let the lock go (leaving full screen does that): follow.
  document.addEventListener('fullscreenchange', () => {
    if (locked && !document.fullscreenElement) { locked = false; enteredFullscreen = false; sync(); }
  });
  // The phone really turned while our rotation was on: the real turn wins.
  const follow = () => {
    if (view.turned && (innerWidth > innerHeight) !== turnedFrom) view.turned = false;
    sync();
  };
  addEventListener('resize', follow);
  addEventListener('orientationchange', follow);
  sync();

  return { toggle };
}
