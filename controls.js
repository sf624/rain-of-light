// The page's sound and full screen controls: the note button, the volume bar
// and the full screen button.

// sound is the audio engine; S the settings; onVolume(v) hands a volume set
// with the bar to the settings panel.
export function createControls({ sound, S, onVolume }) {
  // ---------- sound: on unless turned off; browsers let it start only with the first click or key ----------
  const SOUND_KEY = 'rain-of-light:sound';
  const soundBtn = document.createElement('button');
  soundBtn.className = 'sound-toggle';
  soundBtn.type = 'button';
  soundBtn.title = 'Sound (m)';
  soundBtn.setAttribute('aria-label', 'Sound');
  // A note, struck through while the sound is off.
  soundBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">'
    + '<path d="M10 2.5v9"/><path d="M10 2.5c1.4.9 2.8 1.5 3.2 3.3"/>'
    + '<ellipse cx="7.7" cy="11.7" rx="2.4" ry="1.8" transform="rotate(-20 7.7 11.7)" fill="currentColor" stroke="none"/>'
    + '<path class="mute" d="M2.5 13.5 13.5 2.5" stroke-width="1.6"/></svg>';
  soundBtn.setAttribute('aria-pressed', 'false');
  // The volume bar beside the note button; it is the panel's Volume too.
  const volumeBar = document.createElement('input');
  volumeBar.className = 'volume-bar';
  volumeBar.type = 'range';
  volumeBar.min = 0;
  volumeBar.max = 1;
  volumeBar.step = 0.01;
  volumeBar.value = S.volume;
  volumeBar.title = 'Volume';
  volumeBar.setAttribute('aria-label', 'Volume');
  volumeBar.addEventListener('input', () => {
    onVolume(Number(volumeBar.value));
    if (!sound.on && Number(volumeBar.value) > 0) setSound(true); // turning it up turns it on
  });
  document.body.append(volumeBar, soundBtn);

  // Full screen: a button and the f key, where the browser allows it (not on iPhone).
  const fullBtn = document.createElement('button');
  fullBtn.className = 'full-toggle';
  fullBtn.type = 'button';
  fullBtn.title = 'Full screen (f)';
  fullBtn.setAttribute('aria-label', 'Full screen');
  fullBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">'
    + '<path d="M1 5V1h4M11 1h4v4M15 11v4h-4M5 15H1v-4"/></svg>';
  document.body.append(fullBtn);
  if (!document.fullscreenEnabled) document.body.classList.add('no-fullscreen');
  function toggleFullscreen() {
    if (!document.fullscreenEnabled) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => { /* refused: stay as is */ });
  }
  fullBtn.addEventListener('click', toggleFullscreen);
  fullBtn.setAttribute('aria-pressed', 'false');
  document.addEventListener('fullscreenchange', () => {
    fullBtn.setAttribute('aria-pressed', String(!!document.fullscreenElement));
  });
  function setSound(want) {
    if (want) sound.start(); else sound.stop();
    soundBtn.classList.toggle('active', sound.on);
    soundBtn.setAttribute('aria-pressed', String(sound.on));
    volumeBar.classList.toggle('active', sound.on);
    try { localStorage.setItem(SOUND_KEY, sound.on ? '1' : '0'); } catch { /* storage blocked */ }
  }
  soundBtn.addEventListener('click', () => setSound(!sound.on));
  let soundWanted = true;
  try { soundWanted = localStorage.getItem(SOUND_KEY) !== '0'; } catch { /* storage blocked */ }
  if (soundWanted) {
    const resume = (e) => {
      removeEventListener('pointerdown', resume, true);
      removeEventListener('keydown', resume, true);
      if (e.target !== soundBtn && e.target !== volumeBar && e.key !== 'm' && !sound.on) setSound(true);
    };
    addEventListener('pointerdown', resume, true);
    addEventListener('keydown', resume, true);
  }

  return {
    toggleFullscreen,
    // The m key: sound on and off.
    toggleSound() { setSound(!sound.on); },
    // The panel changed the volume: move the bar.
    setVolume(v) { volumeBar.value = v; },
  };
}
