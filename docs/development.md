# Development

How to run the page locally, what each file is, and how the tests and the
tools work. How the app is built inside is in [design.md](design.md).

## Run locally

Any static file server will do, for example:

```sh
python3 -m http.server 8765
```

Then open <http://127.0.0.1:8765/>. Opening `index.html` as a file does not
work, because the scripts are ES modules.

There is no build step and there are no dependencies: edit a file and
reload.

## Files

| File | What |
| --- | --- |
| `index.html`, `style.css` | the viewer page, with a small settings panel |
| `lab.html` | the lab: the same page, with every setting in its panel (`data-page="lab"`) |
| `boot.js` | shows any error on the page, and registers the service worker |
| `main.js` | the frame loop: puts the directors' choices to work, the camera, the drawing |
| `director.js` | the rain's director: which weather, colour mode, density and camera move come when, from the seed; and the colour story's mood |
| `config.js` | palettes, colour modes, weathers, camera moves, forms, passages, the room, default settings and the panel's layout (`viewer: n` marks the viewer page's settings) |
| `show.js` | the show's director: the timeline of passages, how much rain falls and which way, which forms of light show, and how bright |
| `direction.js` | a change of the rain's direction: the old drops stop coming and fade out before the new ones set out |
| `forms.js` | how each form of light moves through its life: where it is, how large and how turned |
| `shaders.js` | the GLSL shaders: the points of light, bloom and tone mapping |
| `lattice.js` | the strands and LEDs, and the order in which they thin out |
| `gl.js` | WebGL helpers and vector maths |
| `controls.js` | the sound, volume and full-screen controls |
| `clock.js` | the lab's show clock: pause, step, speed, seek (see below) |
| `hud.js` | the lab's readout of the show's state (see below) |
| `rotate.js` | the landscape / portrait button |
| `audio.js` | the music: pad, bells, rain, the forms' voices, reverb |
| `sway.js` | 1/f fluctuation, used by the music and the rain |
| `wakelock.js` | keeps the screen awake while the page is showing |
| `tuner.js` | the settings panel, and reading the settings (saved, then URL) |
| `manifest.webmanifest`, `icons/` | the install information and the app icons |
| `og-image.jpg` | the picture shown when the link is shared (1200x630) |
| `sw.js` | the service worker: network first, cached files when offline (add new files to its list) |
| `docs/` | these documents; the README's GIFs; `img/`, the pictures of the settings guide |
| `tools/` | the capture tools for the GIFs and the docs' pictures, and `story-stats.mjs` (see below) |
| `test/smoke.mjs` | the smoke test (see Test) |
| `test/render-audio.mjs` | renders the page's sound to a WAV file, for listening and measuring (see Test) |
| `.github/workflows/` | `test.yml` runs the smoke test; `pages.yml` deploys the site |

## Version

The link to this repository and the short commit hash being served are at
the bottom of the settings panel. GitHub Pages deploys through
`.github/workflows/pages.yml`. It copies only what the page loads (the page,
the modules, the manifest, the icons, `og-image.jpg`, `sw.js`) and writes
`version.json` (the commit and its date) into the site. That file is not
committed, so a local server shows only the link.

## Test

```sh
node test/smoke.mjs
```

It needs Node 22 and Chrome (`google-chrome` or `chromium` on PATH, or set
`CHROME=/path/to/chrome`). It serves the repo and opens it in headless
Chrome with software GL. It fails on any error, a shown fallback message, a
frame loop that stops, or a black canvas. Software GL draws a frame in
seconds, so only the first visit uses the real default lattice; every other
visit adds `leds=20` (20 thousand LEDs) to its URL, which cuts a visit from
about 11 s to 3 s. It visits:

- the default page (the real lattice), with a click, the keys and turning the picture; it
  changes the scene in the panel (the page must not reload) and checks that
  Reset brings back the mix;
- every colour mode;
- both panels, the lab's (`lab.html#tune`) and then the viewer page's
  (`#tune`): the repository link and the commit link from a fake
  `version.json`, that the sliders let a finger scroll, which settings
  each panel shows (the viewer page: the items marked `viewer` in
  `config.js`), the link to the other page, and that the viewer page sees
  a setting the lab saved and its Reset clears it;
- the pinned scenes (`rain` in the lab, `crystal`, both with the click,
  keys and Reset), a time part-way through the show
  (with and without the colour story), four of the forms held, and
  `?jitter=pitch`, and the lab's clock (opened paused, it stands still;
  Space runs and stops it).

It then renders a few seconds of sound offline and checks that a held orb
sounds, a still room is much quieter, and nothing clips. GitHub Actions
runs it on every pull request and on every push to main. Software GL is
slow, so the test waits for the page rather than for a fixed time; give it
minutes, not seconds.

To hear (or measure) the sound without speakers:

```sh
node test/render-audio.mjs --query '?seed=4&t=118&weather=rain' --seconds 200 --out /tmp/sound
```

writes `/tmp/sound.wav` (and the samples as floats, and the show's state
over time as JSON). It runs the real page in headless Chrome on a fake
clock, with an OfflineAudioContext in place of the AudioContext, so the show
drives the sound exactly as it does live. The top of the file lists its
limits.

## The lab's clock

The show runs on a clock that `main.js` advances by the time between frames.
On `lab.html` a small bar at the top left (`clock.js`) sets how it advances,
to tune settings on one moment or to reach a late part of the show:

- **Pause** (`Space`): the show's clock stands still, and with it the drops,
  the forms, the sway, the twinkle, the ripples, the camera, the breath and
  the sky. Every frame is still drawn, so a change in the settings panel
  shows at once on the frozen moment: the settings that ease (weather,
  colours, direction, forms, camera move) settle in a moment instead of over
  seconds. The picture's render scale also stays as it is. Sound keeps
  running, following the frozen state.
- **Step** (`.`): the show goes on by 0.1 s (times the speed) and stays
  paused.
- **Speed** (`[` slower, `]` faster, or the button): the button shows the
  rate (`x0.25`, `x1`, `x12`) and opens a small popover with a slider on a
  log scale from x0.1 to x30, which sticks to the snap points 0.1, 0.25,
  0.5, 1, 2, 4, 12 and 30, and a reset to x1. The keys step through the snap
  points. A frame advances the show by at most 0.05 s times the speed, so
  in slow motion a frame is tiny but never zero: the easings, the waves
  and the sway all work on that dt, and the sound follows the state as it
  is. Above x4 the waves that come by themselves ring no bell; the pad's
  chords change at most every 6 s as always.
- **Seek** (`ArrowLeft` / `ArrowRight`: 5 s back / forward, with `Shift`
  30 s; the same as buttons in the speed popover, which also has a
  scrubber over the time played so far): the show goes to that time, and
  shows the same picture it had there (same forms, colours, weather,
  direction, camera). Paused, the frame is drawn at once. The arrow keys
  are ignored while a button, slider or field has the focus.
- **Time**: `t 123.4 s`, the show's clock. Clicking it copies a link to the
  lab at that moment (`t=`, `seed=` and `pause=1`), to note it.

`?pause=1` opens the lab paused, `?rate=0.25` opens it in slow motion
(0.1 to 60), and `?t=` sets the start time as on both pages. On the lab
`t=` makes the state of that time as a seek does (below), so the link shows
the same picture as the show had there with the same seed; on the viewer
page it starts the camera, the rain's fall and the sky from that time, and
weather and colours that were easing are at their goals instead. The viewer
page has no clock; its frame loop is unchanged.

### How a seek makes a moment again

The timeline (`show.js`) and the director's tracks (`director.js`) are
made from the seed, so what they hold at a time needs no history. What
carries from frame to frame is the state in `main.js`: the easings of the
weather, colours, direction, forms (`show.update`) and camera move, the
two sways (rain, and the gap between waves), the waves, the sky, the
breath and the rain's fall (`saveState`). `advance(dt)` steps all of
it without drawing or sound. In the lab every random number of the show
comes from the seed (`createRandom` in `sway.js`), so the state at a time
follows from the seed and the settings alone.

A seek back sets the state up at 0 (or loads the nearest snapshot) and
steps it on in steps of 0.05 s, the longest step a frame takes, leaving a
snapshot every 30 s of the show; a seek forward steps on from where the
show is. So each moment is made the same way however it is reached. The
cost is about 8 microseconds per step, measured in Chrome: a seek of 60 s
takes about 10 ms, of 10 min about 0.11 s, of 1 h about 0.6 s once, and
at most 30 s of steps (about 5 ms) from a snapshot after that (the HUD's `seek` row shows the last
one). The sound does not burst: the waves a seek makes ring no bell, and
the rain, the forms and the breath move to their new state as they always
do, over a second or so; the pad's chords go on by the real clock.

Limits: a seek uses the settings as they are now (changing the scene,
the colour story or a form while playing, and seeking back, shows the show
with the new setting from the start), and the keys `w`, `c`, `v`, `d` and
the clicks are not replayed (the waves from clicks are gone after a seek
back). A moment reached by playing frames of 0.05 s (as the capture tools step)
is the same as the one a seek makes, number for number. With other frame
lengths the easings agree closely but not to the last digit: they do not
depend on the step for a goal that holds, and a goal changes at a step's
edge. `window.__lab.state()` and `window.__lab.seek(t)` give the
tests the whole state as text and a seek.
Playing backwards is not offered: it would mean a seek every frame, and
the eased state (a form's weight, the colours going over) has no inverse.

### The readout (HUD)

The **HUD** button in the clock bar, the `h` key or `?hud=1` shows the
state of the show as short lines of text at the top left, a few times a
second (`hud.js`; `?hud=0` forces it off, and the choice is kept in this
browser). `main.js` hands it `hudSnapshot()`, which reads the real state;
hidden, the HUD costs one test per frame, and the viewer page has none. The
lines:

- `time`: the show's time, the speed, paused or running, the seed.
- `frame`: fps and frame time, the render scale (the adaptive quality
  step), the canvas size; `seek`: the last seek's steps and time.
- `lattice`: strands, LEDs per strand, LEDs in all.
- `show`: the scene (with a held form or layer), the passage now (rain,
  form, storm, still, drift) and the time to the next one.
- `rain`: how much rain the show has now (0 .. 1), and `storm`, the rain
  through a form. `forms`: each form with its weight (0 .. 1), its palette,
  its age and whether it comes or goes, with swatches of its colours;
  `layer`: the layer of light.
- `weather`: the weather's name and the eased rain and fall values, the
  density, the share of strands with rain.
- `flow`: how much of the rain falls down and how much flows across, and
  the show's goal. `colour`: the colour mode, the palette, swatches.
- `bright`: the exposure setting times the breath, the exposure applied;
  `light`: the lattice light scale (`uLight`), the falling rain's light,
  the gain a form gets among rain; `glow`: glow, haze, burn-out, rays, and
  whether float buffers are there.
- `camera`: the move or the blend of two, the eye; `ripples`: waves alive.

On a screen narrower than 700 px only the main lines show, and with the
settings panel open the HUD steps aside.

## Capturing the page

The capture tools load the page in Chrome on a fake clock: a seeded
`Math.random`, and a `performance.now` and `requestAnimationFrame` that move
only when the tool steps them. So a run is repeatable. `tools/page.mjs`
holds what they share: it serves the repo, starts Chrome, opens the page
(`index.html`, or `lab.html`) and hides the page's buttons.

By default Chrome runs with a window, on the GPU (written for WSLg on WSL2
with an NVIDIA card: about 50 ms per frame). `CAP_MODE=swiftshader` uses
headless software GL instead, several seconds per frame. `CHROME=` names the
browser; `LD_LIBRARY_PATH` may need its libraries. Each tool kills its
Chrome at the end.

### The GIFs

`docs/*.gif` (in the README) are made in two steps. `tools/scenes.json`
lists the scenes (URL parameters, size, length). `tools/capture-frames.mjs`
saves their frames. `tools/make-gifs.py` (Pillow, numpy) scales them to
480x270, cross-fades the loop and writes the GIFs. They are not precached
by the service worker.

```sh
node tools/capture-frames.mjs /tmp/frames
python3 -I tools/make-gifs.py /tmp/frames docs
```

### The pictures of the docs

`docs/img/*.jpg` (in [settings.md](settings.md) and [design.md](design.md))
are made the same way. `tools/doc-shots.json` lists the figures: each has
cells, and each cell a URL query and a label. `tools/doc-shots.mjs` saves
one PNG per cell. `tools/doc-images.py` (Pillow) puts each figure together:
one cell becomes a 960 px picture, several become a grid, 1600 px wide by
default, each cell labelled. It writes JPEG at quality 82, lower if a
picture would pass 200 KB.

```sh
node tools/doc-shots.mjs /tmp/shots              # all figures, or name some
python3 -I tools/doc-images.py /tmp/shots docs/img
```

After a change that shows, make the pictures again and look at each one:
a form or a passage may then be off screen at the time a cell names.
`show.cast(t)` (see `tools/story-stats.mjs` for how to load `show.js` in
Node) tells which passage and forms show at a time of a seed. A cell can
also give `click`, `keys`, `crop`, `ui` (keep the buttons), `page`
(`lab.html` for the full panel) and `touch` (as on a phone); the top of
`tools/doc-shots.mjs` lists them. `DOC_SHOTS=other.json` tries out another
list.

The share picture, `og-image.jpg` (1200x630, named in `index.html`), is
made with the same tool, from a list of its own given by `DOC_SHOTS=`: one
figure, `"w": 1200, "h": 675`, one cell with the query
`scene=mix&form=orb&layer=on&weather=drizzle&color=cloud&seed=7&t=30`
(plus `dpr=1&quality=full&ripples=0&breath=off`), cut to its middle 630
rows. A bigger capture looks sparser, not sharper: near LEDs are capped at
Largest size, which is in pixels.

### The colour story in numbers

```sh
node tools/story-stats.mjs [seeds=50] [hours=1]
```

measures the colour story without rendering, in Node. Over many seeds it
counts how often neighbouring passages differ in hue, how often each colour
mode and palette comes, how far the mood wanders, how long the picture
stays in one colour family, how much of the rain flows sideways, and how
often each form comes. With and without the story.

## The service worker

`sw.js` fetches from the network first and keeps a copy of each answer. When
the network fails, it answers from that copy. It precaches a list of files
on install, so that one visit is enough to work offline: add a new module or
asset to that list. The docs and the GIFs are not on it; the page does not
load them.
