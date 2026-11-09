# Rain of Light

A field of small points of light, with rain of light falling through it.
The weather, the colours, the direction of the rain and the camera change on
their own, slowly. Calm generative music plays along, and every ripple of
light rings a bell.

Plain WebGL2 and Web Audio: no build step, no dependencies, no media files.

Live: <https://sf624.github.io/rain-of-light/>

Inspired by teamLab's *Light Sculpture - Point*.

## Use

- **Click or tap**: a ripple of light (and a bell).
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

Browsers start sound only after a click or a key, so the music begins with
your first click. The settings panel keeps what you change in this browser
(Reset brings back the defaults). Any setting can also be given in the URL,
such as `?color=cloud&weather=drizzle`; `#tune` opens the panel.

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
| `main.js` | the lattice of lights, its shaders, and the director that changes weather, colour, flow and camera |
| `audio.js` | the music: pad, bells, rain, reverb |
| `sway.js` | 1/f fluctuation, used by the music and the rain |
| `tuner.js` | the settings panel |

## Licence

MIT, see [LICENSE](LICENSE).
