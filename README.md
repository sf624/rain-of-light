# Rain of Light

A room of small points of light over a mirror floor. Rain of light falls
through it; now and then the rain eases off and a large form of light gathers
in the room (an orb, a spiral, a cloud), or glows while the rain falls through
it. The show moves between these on its own, with slow cross-fades. The
weather, the colours and the camera change on their own too. Calm generative
music plays along, and every ripple of light rings a bell.

![A short clip of the piece: strands of amber light points, with drops of light falling through them as the camera walks among the strands](demo.gif)

Plain WebGL2 and Web Audio: no build step, no dependencies, no media files.

Live: <https://sf624.github.io/rain-of-light/>

Inspired by teamLab's *Light Sculpture - Point*.

## Use

- **Click or tap**: a ripple of light (and a bell). **Drag** to look around.
- **Buttons, bottom right**: settings ⚙, full screen, sound ♪, volume.
- **Keys**:

  | Key | Does |
  | --- | --- |
  | `p` | settings panel |
  | `c` | next colour |
  | `w` | next weather |
  | `d` | switch direction (falling / sideways) |
  | `v` | next camera move |
  | `m` | sound on / off |
  | `f` | full screen |

The screen stays awake while the page is showing (where the browser allows it).

Browsers start sound only after a click or a key, so the music begins with
your first click. The settings panel keeps what you change in this browser
(Reset brings back the defaults). Any setting can also be given in the URL,
such as `?color=cloud&weather=drizzle`; `#tune` opens the panel.

The strands hang a little above the mirror floor, so a thin dark line runs
between each strand and its image; light that runs down a strand runs up its
image, towards that line. The show passes through:

- **rain**: rain of light, in the colour modes; while it falls the far
  strands fade into a mist;
- **a form**: the rain stops, and a form of light glows in the still room,
  with a few pale drops and a sparse twinkle;
- **rain through a form**: drops that pass through the form take its colour;
- **a still room**: only a layer of light near the floor, which also comes
  and goes beside the others.

A form that comes or goes while rain falls does so from the top down, as if
rain gathered into it or it ran off as rain. Each passage lasts from about
20 seconds to over a minute, and each visit has its own order. `?seed=` (any
number) gives one order, and `?t=` (seconds) starts at that time in it.

Scene in the panel (or `?scene=`) pins the content: `mix` (the default, the
whole show), `rain` (only the rain) or `crystal` (only the forms). It changes
without a reload. `?form=orb` (spiral, cloud, none) and `?layer=on` (off)
hold one form or the layer. `c` turns both the rain's colours and the forms'
colours; `w` changes the weather, which also sets how many pale drops fall in
a still room. The sound of rain follows how much rain falls: in a still room
it is almost silent.

Quality is automatic: if frames are slow, the canvas is drawn at a lower
resolution (down to half), and raised again when the device keeps up. Set
`Quality` to `full` in the panel (or `?quality=full`) to always draw at the
screen's full sharpness; `?dpr=` still sets the upper limit.

## Install and offline

On a phone or in Chrome / Edge you can install it ("Add to Home Screen" /
"Install app"): it opens full screen, and works offline after the first
visit. Online, you always get the newest files; offline, the last ones seen.

## Run locally

Any static file server will do, for example:

```sh
python3 -m http.server 8765
```

Then open <http://127.0.0.1:8765/>. Opening `index.html` as a file does not
work, because the scripts are ES modules.

## Files

| File | What |
| --- | --- |
| `index.html`, `style.css` | the page |
| `main.js` | the director that changes weather, colour, flow and camera, and the frame loop |
| `config.js` | palettes, colour modes, weathers, camera moves, forms, passages, the room, default settings and the panel's layout |
| `show.js` | the show's director: the timeline of passages, how much rain falls, which forms of light show, where, and how bright |
| `shaders.js` | the GLSL shaders: the points of light, bloom and tone mapping |
| `lattice.js` | the strands and LEDs, and the order in which they thin out |
| `gl.js` | WebGL helpers and vector maths |
| `controls.js` | the sound, volume and full screen controls |
| `audio.js` | the music: pad, bells, rain, reverb |
| `sway.js` | 1/f fluctuation, used by the music and the rain |
| `wakelock.js` | keeps the screen awake while the page is showing |
| `tuner.js` | the settings panel |
| `manifest.webmanifest`, `icons/` | the install information and the app icons |
| `sw.js` | the service worker: network first, cached files when offline (add new files to its list) |
| `test/smoke.mjs` | the smoke test (see Test) |

## Test

```sh
node test/smoke.mjs
```

Needs Node 22 and Chrome (`google-chrome` or `chromium` on PATH, or set
`CHROME=/path/to/chrome`). It serves the repo, opens it in headless Chrome with
software GL, and fails on any error, a shown fallback message, a stalled frame
loop or a black canvas. It also clicks, presses the keys and tries every colour
mode, the pinned scenes (`rain`, `crystal`) and a time part-way through the
show, changes the scene in the panel (it must not reload) and checks that
Reset brings back the mix. GitHub Actions runs it on every pull request and push to main.

## Licence

MIT, see [LICENSE](LICENSE).
