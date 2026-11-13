// The lab's keys while a control has the focus (the settings panel, the clock bar).
// The clock's keys (Space . [ ] and the arrows) and h work wherever the focus is,
// except in a text field. The arrows are a control's own only where a keyboard
// user needs them there: a slider or a select the focus came to by Tab. A
// control that a pointer has used lets go of the focus (see letGo), so that the
// arrows seek again after a drag.

export const CLOCK_KEYS = new Set([' ', '.', '[', ']', 'h', 'ArrowLeft', 'ArrowRight']);

const TEXT = 'textarea, input:not([type="range"]):not([type="checkbox"]):not([type="radio"]):not([type="button"])';
export const isTyping = (el) => el instanceof HTMLElement && el.matches(TEXT);

let byKey = false;   // the focus came by a key (Tab), not by a pointer
let watching = false;
function watch() {
  if (watching) return;
  watching = true;
  addEventListener('keydown', (e) => { if (e.key === 'Tab') byKey = true; }, true);
  addEventListener('pointerdown', () => { byKey = false; }, true);
}

// Do the arrow keys belong to the focused control (to move it), not to the clock?
export function ownsArrows(el) {
  return el instanceof HTMLElement && (isTyping(el) || (byKey && el.matches('input[type="range"], select')));
}

// Controls inside `root` that a pointer used give the focus back to the page: a slider or a button
// when the pointer is lifted, a select once it has changed (its list opens on the press and must
// stay open: blurring then closes it).
export function letGo(root) {
  watch();
  const drop = (el) => { if (!byKey && root.contains(el)) el.blur(); };
  root.addEventListener('pointerup', () => {
    const el = document.activeElement;
    if (el instanceof HTMLElement && el.matches('input[type="range"], button')) drop(el);
  }, true);
  root.addEventListener('change', (e) => { if (e.target instanceof HTMLSelectElement) drop(e.target); }, true);
}
