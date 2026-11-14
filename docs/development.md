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
| `index.html`, `style.css` | the viewer page, with a small settings panel; it lists every module in `modulepreload` hints |
| `lab.html` | the lab: the same page, with every setting in its panel (`data-page="lab"`); opened by its address, the viewer page does not link to it |
| `boot.js` | shows any error on the page, and registers the service worker |
| `main.js` | the frame loop: puts the directors' choices to work, the camera, the drawing |
| `director.js` | the rain's director: which weather, colour mode, density and camera move come when, from the seed; and the colour story's mood |
| `config.js` | palettes, colour modes, weathers, camera moves, forms, passages, the room, default settings and the panel's layout (`viewer: n` marks the viewer page's settings) |
| `show.js` | the show's director: the timeline of passages, how much rain falls and which way, which forms of light show, and how bright |
| `direction.js` | a change of the rain's direction: the old drops stop coming and fade out before the new ones set out |
| `forms.js` | how each form of light moves through its life: where it is, how large and how turned |
| `fields.js`, `fields/` | the baked forms' fields of distance (`fields/*.bin`), fetched only when one is about to show (see Baking a form's field) |
| `figures.js` | the figures of the solid and the knot: their names, corners and edges, curves, sizes |
| `shaders.js` | the GLSL shaders: the points of light, bloom and tone mapping |
| `lattice.js` | the strands and LEDs, and the order in which they thin out |
| `gl.js` | WebGL helpers and vector maths |
| `controls.js` | the sound, volume and full-screen controls |
| `clock.js` | the lab's show clock: pause, step, speed, seek (see below) |
| `keys.js` | which keys a focused control keeps in the lab (see the clock's keys) |
| `hud.js` | the lab's readout of the show's state (see below) |
| `eggs.js`, `egg-kinds.js`, `egg-shaders.js` | the easter eggs: the registry and which egg shows, the eggs, their light (see Easter eggs) |
| `rotate.js` | the landscape / portrait button |
| `audio.js` | the music: pad, bells, rain, the forms' voices, reverb |
| `sway.js` | 1/f fluctuation, used by the music and the rain |
| `wakelock.js` | keeps the screen awake while the page is showing |
| `tuner.js` | the settings panel, and reading the settings (saved, then URL) |
| `manifest.webmanifest`, `icons/` | the install information and the app icons |
| `og-image.jpg` | the picture shown when the link is shared (1200x630) |
| `sw.js` | the service worker: network first, cached files when offline (add new files to its list) |
| `docs/` | these documents; the README's GIFs; `img/`, the pictures of the settings guide |
| `tools/` | the capture tools for the GIFs and the docs' pictures, `story-stats.mjs` (see below), `bake-field.py` and `fields.json` (see Baking a form's field), and `build-site.sh`, which assembles the Pages site (see Version) |
| `test/smoke.mjs` | the smoke test (see Test) |
| `test/site.mjs` | the site test: the assembled site, with a preview (see Previews of pull requests) |
| `test/render-audio.mjs` | renders the page's sound to a WAV file, for listening and measuring (see Test) |
| `.github/workflows/` | `test.yml` runs the smoke and site tests; `pages.yml` deploys the site; `pr-preview.yml` redeploys it when a pull request changes |

## Version

The link to this repository and the short commit hash being served are at
the bottom of the settings panel. GitHub Pages deploys through
`.github/workflows/pages.yml`, which assembles the site with
`tools/build-site.sh`. It copies only what the page loads (the page, the
modules, the manifest, the icons, `og-image.jpg`, `sw.js`, and the data
files in `fields/` if the commit has them) and writes `version.json` (the
commit and its date) into the site. Of `fields/` it copies only regular
`*.bin` files, none in a subfolder, each at most 256 KiB, and none at all
if they pass 2 MiB together (with a warning). That file is not
committed, so a local server shows only the link.

### Previews of pull requests

Each open pull request from a branch of this repository has a preview:
`https://sf624.github.io/rain-of-light/pr/<number>/` (the viewer) and
`…/pr/<number>/lab.html` (the lab). A comment on the pull request links
them; it is made once and then edited in place. Pull requests from forks
get none: their code would run on the site's origin.

- **What**: the pull request's head, copied by the same rule as main (so a
  new module is included), except `sw.js`. Its `version.json` also has the
  pull request's number; the panel links the head commit.
- **When**: every deploy builds main and every open pull request again. A
  pull request that opens, gets a push, reopens or closes runs
  `pr-preview.yml`, which runs `pages.yml` on main (the `github-pages`
  environment deploys only from main). A push to main deploys too. A
  preview goes away at the first deploy after its pull request closes. One
  deploy runs at a time; a newer one waits, and reads the pull requests
  when it starts, so the last deploy has the newest heads. A deploy takes
  about a minute.
- **Service worker**: a preview registers none (`boot.js` skips it on a
  page in `pr/<n>/`, and the preview has no `sw.js`), and the site's
  service worker leaves `pr/` to the network (`sw.js`). So no service
  worker serves or keeps a preview's files, and a preview leaves none
  behind. A change to `sw.js` can only be tried locally. A branch made
  before this rule still tries to register `sw.js` there: that fails (404,
  shown in the console) and does no harm.
- **Shared origin**: a preview runs on the same origin as the site, so it
  shares its saved settings (local storage) with the live pages.
- **Size**: each copy is about 0.5 MB; the Pages limit (1 GB) is far away.

`node test/site.mjs [ROOT_COMMIT [N=COMMIT ...]]` (default: `HEAD 1=HEAD`)
builds the site from those commits, checks the tree (the files, the
links, `version.json`, each page's `modulepreload` hints against the
modules it imports, and that `sw.js` precaches every module), and opens it under `/rain-of-light/` in headless
Chrome: the root's service worker installs, and each preview loads with no
error, loads only its own files, registers no service worker and is not
cached. It reads commits, not the working tree: commit first. Keep `TMPDIR`
short (Chrome's socket path is limited to 107 bytes). GitHub Actions runs it
with the smoke test.

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
  turns the rain off in the panel (the page must not reload) and checks that
  Reset brings back Rain `auto`;
- every colour mode;
- both panels, the lab's (`lab.html#tune`) and then the viewer page's
  (`#tune`): the repository link and the commit link from a fake
  `version.json`, that the sliders let a finger scroll, which settings
  each panel shows (the viewer page: the items marked `viewer` in
  `config.js`), the lab's link to the viewer page (the viewer page has no link to the lab), and that the viewer page sees
  a setting the lab saved and its Reset clears it;
- rain alone (`rain=on&form=none&layer=off`, in the lab) and no rain
  (`rain=off`), both with the click, keys and Reset; rain that never ends
  with a form through it (`rain=on&seed=1&t=60`); a time part-way through the show
  (with and without the colour story), four of the forms held,
  `?jitter=pitch`, two easter eggs pinned (penrose, and the teapot with its
  field; `form=teapot` falls back to `auto`), and the lab's clock (opened paused, it stands still;
  Space runs and stops it, also with the focus in the panel; the arrows seek
  after a mouse drag on a slider and move a slider the focus came to by Tab;
  and part-way through a form's coming, a change of exposure, twinkle, colour
  mode, weather or layout leaves the HUD's forms row as it was);
- a `scene=` in a link or in saved settings: each is read as the settings
  it stands for (`config.js: SCENES`), and a saved one is no more kept.

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
  shows at once on the frozen moment, and it is the same moment: a setting
  that only the picture reads (exposure, twinkle, glow, haze, the mirrors,
  the LEDs' size, rays, the lattice and the like; `DRAW_ONLY` and `LATTICE`
  in `main.js`) leaves the show's state as it is, and any other (rain,
  form, layer, weather, colour, speed, camera ...; also the `c` key and a skipped
  episode) makes that moment again with the new setting, by a seek to it
  (see below), so it has the forms at the weights a seek to this time with
  the setting gives. A running show blends into a change instead. The
  picture's render scale also stays as it is. Sound keeps running,
  following the frozen state.
- **Step** (`.`): the show goes on by 0.1 s (times the speed) and stays
  paused.
- **Speed** (`[` slower, `]` faster, or the button): the button shows the
  rate (`x0.25`, `x1`, `x12`) and opens a small popover with a slider on a
  log scale from x0.1 to x30, which sticks to the snap points 0.1, 0.25,
  0.5, 1, 2, 4, 12 and 30, and a button for each of them (two rows on a
  narrow screen; the current rate's is marked). The keys step through the
  snap points. A frame advances the show by at most 0.05 s times the speed, so
  in slow motion a frame is tiny but never zero: the easings, the waves
  and the sway all work on that dt, and the sound follows the state as it
  is. Above x4 the waves that come by themselves ring no bell; the pad's
  chords change at most every 6 s as always.
- **Seek** (`ArrowLeft` / `ArrowRight`: 5 s back / forward, with `Shift`
  30 s; the same as buttons in the speed popover, which also has a
  scrubber over the time played so far): the show goes to that time, and
  shows the same picture it had there (same forms, colours, weather,
  direction, camera), within the limits below. A key pressed while a seek
  is still going on moves from where that seek is heading (its target), so
  two presses in a row add up. Paused, the frame is drawn
  at once. The clock's keys (`Space`, `.`, `[`, `]`, `h`, the arrows) work wherever
  the focus is, the settings panel too, and do not scroll it: Space pauses
  and does not press a focused button or open a focused select (`Enter`
  does), except in a text field. The arrows are left to a control only where
  a keyboard user needs them: a slider or select that the focus came to by
  Tab. A control that a pointer has used lets go of the focus (`letGo` in
  `keys.js`), so after dragging a slider with the mouse the arrows seek
  again. `Escape`
  closes the speed popover and gives the focus back to its button.
- **Time**: `t 123.4 s`, the show's clock. Clicking it copies a link to the
  lab at that moment (`t=`, `seed=` and `pause=1`), to note it.

`?pause=1` opens the lab paused, `?rate=0.25` opens it in slow motion
(0.1 to 60), and `?t=` sets the start time as on both pages. On the lab
`t=` makes the state of that time as a seek does (below), so the link shows
the same picture as the show had there with the same seed; on the viewer
page it starts the camera, the rain's fall and the sky from that time, and
weather and colours that were easing are at their goals instead. The lab's
times run from 0 to 24 h (86400 s): a later `t=` or seek goes to 24 h, and
one that is not a number (`t=Infinity`) is no time (0 for `t=`, ignored for
a seek). The viewer page has no clock; its frame loop is unchanged.

### How a seek makes a moment again

The timeline (`show.js`) and the director's tracks (`director.js`) are
made from the seed, so what they hold at a time needs no history. What
carries from frame to frame is the state in `main.js`: the easings of the
weather, colours, direction, forms (`show.update`) and camera move, the
two sways (rain, and the gap between waves), the waves, the sky, the
breath, the rain's fall and the count of the rain's sideways turns
(`saveState`). `advance(dt)` steps all of it without drawing or sound. In
the lab every random number of the show comes from the seed
(`createRandom` in `sway.js`; the way sideways rain takes comes from the
count of turns, not from the time), so the state at a time follows from the
seed and the settings alone. With no `seed=` the page picks one at random
once, and keeps it for the session; the HUD shows it, and the time link
carries it.

A seek sets the state up at 0, or loads the latest snapshot at or before
its time, and steps on in steps of 0.05 s (the longest step a frame takes;
the last step is shorter when less is left) without drawing; a seek forward
steps on from the state as it is. A snapshot is taken the first time the
show's time passes each 60 s, while playing or in a replay, up to 1500 of
them (24 h; about 25 MB at most), so a seek takes at most 60 s of steps,
about 10 ms. Without one (after a change of setting, which drops them) it takes
8 microseconds per step, measured in
Chrome: about 0.11 s for 10 min, 0.6 s for 1 h. A seek is done in slices of
about 8 ms per frame (more when the frames are slow), so the page never
freezes: the readout shows `seeking 40%` when one takes over 100 ms, and a
new seek or a change of setting begins it anew. Changing a setting, the
colour key (`c`) or skipping an episode with a key (`w`, `c`, `v` while
the setting is auto) drops the snapshots.

Equality: seeking to a time twice gives the same state number for number
(checked on the whole saved state, for a rain moment, a form moment, one
in a transition, with Direction = across, after a colour key, and with the
mouse dragged between the two seeks), and seeking forward from a moment
equals seeking there from 0. A moment reached by playing frames of 0.05 s
(as the capture tools step) equals the seek's number for number; at other
frame lengths the easings agree closely but not to the last digit (they do
not depend on the step for a goal that holds, and a goal changes at a
step's edge), and a snapshot taken while playing carries that difference.
The sound does not burst: the waves a seek makes ring no bell, and the
rain, the forms and the breath move to their new state as they always do,
over a second or so; the pad's chords go on by the real clock.
`window.__lab.state()` and `window.__lab.seek(t)` give the tests the whole
state as text and a seek.

Limits: a seek uses the settings as they are now (change the rain, the
colour story or a form, and a seek back shows the show with the new
setting from the start), and the colour key counts as a setting: all of
the show, past and future, has its colours after a key press. The pointer
(its turn too: `__lab.turn()` reads it, in radians) is not replayed: a seek steps with a neutral pointer (and with the canvas
as it is now, whose shape sets the camera's distance), so a view dragged
with the mouse is only seen again as the live frames apply it. A skipped
episode stays skipped. Clicks make waves that a seek back does not bring
back. Playing backwards is not offered: it would mean a seek every
frame, and the eased state (a form's weight, the colours going over) has
no inverse.

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
- `show`: the Rain, Form and Layer settings; what plays now (rain, form,
  storm or still: a held form in rain plays a storm whatever the passage),
  with the timeline's passage after it where that differs (rain, form,
  storm, still, drift), and the time to the next passage.
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

## Easter eggs

Rare scenes that the page does not announce. `eggs.js` holds the registry
and decides which egg shows; `egg-kinds.js` registers the eggs and works
out each one's uniforms per frame; `egg-shaders.js` is their light, a chunk
of `POINT_VS` (`eggAt`, added to the forms' light).

| Egg | What | Comes |
| --- | --- | --- |
| `teapot` | the Utah teapot, a baked form (`config.js: BAKED`) | rare slot, secret, pin |
| `penrose` | the impossible triangle, drawn in light: a thin slab of LEDs (2.5 LED spacings thick) that faces the eye, at one distance from it, with the classic figure drawn in it (three bars of three tones, each band of one tone an L over two bars, each band lying over the next in turn); it turns slowly in its plane, breathes a little, its tones travel round; it comes LED by LED round the figure, as a pen would draw it, and goes back the same way; the floor shows the slab's true reflection | rare slot, secret, pin |
| `clock` | the time of day, HH:MM in 5 x 7 dot glyphs facing the eye (two lines in a tall view), whole above the floor and the layer of light | rare slot, secret, pin |
| `fireworks` | shells rise along the strands and burst into spheres of sparks that fall and fade; no sound | rare slot, secret, pin |
| `tanabata` | the Milky Way rising slantwise over the room, with a dark rift, Vega and Altair on either side | rare slot, secret, pin |
| `snow` | slow snow in place of the rain, and a tree of light with a garland and a star | 24 and 25 December, secret, pin |

- **The rare slot** (`show.js: rareOf`; `eggs.js: RARE` is the one place
  to tune it): from 10 minutes on (`after`), the passage's random number
  of each form cast picks the nth egg of the slot when it falls between n
  and n + 1 times `chance` (1.2%). So each egg comes as often as the
  teapot did alone, and the teapot on the same passages: each about once
  in 2.5 hours, all of them about twice an hour (`tools/story-stats.mjs`,
  50 seeds of 4 hours); the regular forms come about 34 times an hour
  instead of 36. At least `apart` (3) forms come between two eggs: one drawn
  sooner waits, and takes the place of the first form cast after them; an
  egg with a light of its own (all but the teapot) also waits for a passage
  without rain, where it would hardly show. An egg of the slot is a form to the timeline: it takes the place of the
  form that was cast (that form counts as seen, and its palette as told,
  so the other forms keep their frequencies), comes and goes as a form
  does (the teapot as slowly as the orb), alone in its passage, as the
  forms are (see One form at a time); the layer stays. It comes from the seed, so
  the lab's seek finds it again.
- **The date**: snow on 24 and 25 December (local time). In the lab,
  `?date=2026-12-24T20:00` sets the wall clock at load.
- **The secret** (both pages): typing `glint` (no letter of it is a key of
  the page), or five quick taps (or clicks) in the top right corner of the
  picture, summons the next egg of the registry at once, for its `hold`
  seconds.
- **Pins** (the lab only): `?egg=<name>` shows that egg for as long as the
  page is open; `?egg=off` no egg at all. The select *Easter egg* at the
  end of the lab's panel does the same and puts it in the URL; it is not a
  setting, so it is never saved and the viewer page never sees it. The
  Form setting lists only the show's forms: a `form=teapot` left in a link
  or in saved settings falls back to `auto`.
- **One at a time** (`eggs.js: eggOrder`): a pin shows its egg alone.
  Otherwise, of the eggs whose time it is, the first in this order shows:
  the summoned, snow (the date's), the rare slot's. One that comes while a
  later one shows waits 5 s (`HAND`): the later one fades out first, and
  comes back once the first has gone, if its time lasts (a rare slot's egg
  goes and comes back as a form does). One whose time comes while an
  earlier one shows waits until it has gone.
- **What an egg does to the show**: a summoned or pinned egg of the form
  slot (`slot: 'form'`) makes the show's forms give way while it shows (and
  the layer, with `layer: false`), and the rain goes to what it asks
  (`rain`: 0 none, not even the pale drops); an overlay (`slot:
  'overlay'`: the clock, tanabata) lays its light over whatever the show
  plays and leaves the show alone.
- **Time**: an egg's weight and age are a function of the show's time:
  pinned, its age is the show's time; summoned, the time since; by date,
  the wall clock, which is the clock at page load plus the show's time
  since; in the rare slot, the timeline's. So the lab's pause, step and
  seek show every egg as it was. A pin or a summons counts as a change of
  setting (the snapshots go); a seek back before a summons shows no egg, as
  with a click's wave. `window.__lab.eggs()` gives the tests the egg that
  shows and its uniforms.
- **Registry**: `registerEgg({ name, slot, type, form, rain, layer, hold, fade,
  steady, hush, params, secret, when, rare })` (the top of `eggs.js`
  describes the fields). A baked form becomes an egg with one line,
  `registerEgg({ name: 'teapot', form: 'teapot', rare: true })`: the show
  holds that form while the egg shows (its field loads first).
- **Cost**: none while no egg shows: the LEDs and wires are drawn by
  programs without the eggs' code (`POINT_VS` holds it behind `#ifdef
  EGGS`, and each egg's function behind `EGG_<type>`). The first time an
  egg shows, the page builds programs with its function only
  (`eggShader`), without waiting for them (`gl.js: program`, used once
  `ready()`; the plain programs draw until then), and draws with them while
  it shows.
  Each egg skips the LEDs far from it first (the penrose's reach; the glyph
  panel's slab; a shell's sphere).
- **Where a figure stands** (`egg-kinds.js: facing`, the penrose and the
  clock): ahead of the eye, facing it, 18 units away (nearer where a wall
  is), inside the view and inside the lattice, above its feet (the clock
  also above the layer of light while it shows), as large as it wants to
  be or as the view and the room leave room for. All of it comes from the
  camera, so a time shows one picture. Looking down, the view leaves only a
  thin band of lattice above the floor: while an egg with `steady` shows
  (both of these), the camera's gaze looks only 40% as far up and down
  (`main.js: cameraPose`), and the figure is still a little smaller there.
- **When an egg cannot be built**: if its programs fail, the egg is
  dropped for the rest of the visit (`eggs.drop`) and the show goes on
  without it. A WebGL context may be lost at any time (a GPU reset; Chrome
  on WSL loses it once as it starts, while its compositor falls back to
  software): a build that fails then is no fault of the egg's (an empty
  log), so it is built again, and the page starts afresh when the context
  comes back (`webglcontextrestored`).

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
`form=orb&layer=on&weather=drizzle&color=cloud&seed=7&t=30`
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
stays in one colour family, how much of the rain flows sideways, how
often each form comes, how much of the time a form's light shows (and
wholly), how much of it two forms show at once (0: one form at a time),
and how often each easter egg of the rare slot comes (never in the first
10 minutes; the first seed and time of each, to watch in the lab). With
and without the story.

### Baking a form's field

The baked forms (`BAKED` in `config.js`) draw a shape from a field of
signed distances, one file each in `fields/` (see "Baked forms" in
[design.md](design.md)). `tools/bake-field.py` (numpy; Pillow for
`--preview`) makes one from a closed mesh or a set of Bezier patches.
`tools/fields.json` lists each shape: where it comes from and on what
terms, the file to read in its archive, its format (`ply`, `obj`, or
`patches`: a C file's tables of bicubic patches), its up axis, a turn so
that its side faces +z and its front +x, and how many fine cells of gap
to close. `grid` sets the fine grid, the cells of the field (40 a side)
and the reach of its distances; `fields.js: FIELD` must say the same (the
page refuses a file whose header differs).

Download the source into an empty folder of its own and read it as data:
the tool parses it, nothing in it is run. The meshes themselves are not
in the repository.

```sh
python3 -I tools/bake-field.py teapot /path/to/src/teapot.c --preview /tmp/teapot.png
```

It takes about 8 s and writes `fields/<name>.bin` (64,016 bytes). The
preview shows the solid from the side, from the front and from above, and
a slice of its distances: check the pose there. A new shape needs an
entry in `fields.json`, one in `BAKED` (its `field` is its slab in the
shader's texture, the next free one), and its terms in the README's
credits.

## The service worker

`sw.js` fetches from the network first and keeps a copy of each answer. When
the network fails, it answers from that copy. It precaches a list of files
on install, so that one visit is enough to work offline: add a new module or
asset to that list. A new module also needs its
`<link rel="modulepreload">` in `index.html` and `lab.html` (see Start-up in
[design.md](design.md)); `test/site.mjs` checks both lists. The docs and the GIFs are not on it; the page does not
load them. Nor are the baked forms' fields (`fields/*.bin`): each is fetched
only when its form is about to show, and kept from then on like every file
fetched. It leaves the previews of pull requests (`pr/`) to the network
(see Previews of pull requests).
