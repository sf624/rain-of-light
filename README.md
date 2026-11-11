# Rain of Light

A room of small points of light over a mirror floor. Rain of light falls
through it. Now and then the rain eases off, and a large form of light
gathers in the room: an orb, a spiral, a ring, or a veil
like an aurora; or a form of mathematics: a regular solid, the butterfly of
the Lorenz equations, a Lissajous knot, or a fractal pyramid. Sometimes the rain falls through the form. The show moves
between these on its own, with slow cross-fades. The weather, the colours
and the direction of the rain change on their own too, and the camera
circles the room slowly. Calm generative music follows the show, and every
ripple of light rings a bell.

<table>
  <tr>
    <td align="center"><img src="docs/rain.gif" alt="Rain of light: drops in drifting clouds of magenta, violet and teal fall along strands of light points, over their dimmer image in the mirror floor" width="100%"><br><sub>rain of light</sub></td>
    <td align="center"><img src="docs/storm.gif" alt="Amber rain of light falls around an orb of amber light and gives way to it; the floor mirrors both" width="100%"><br><sub>rain falling through a form</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/orb.gif" alt="An orb of amber light, pale at its heart, glows in the still room above a mirror floor, with a thin blue layer of light along the floor" width="100%"><br><sub>an orb in the still room, with the layer</sub></td>
    <td align="center"><img src="docs/spiral.gif" alt="A spiral of pale blue light turns slowly above a green layer of light and is mirrored in the floor" width="100%"><br><sub>a spiral</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/attractor.gif" alt="The path of the Lorenz equations in pink light, two wings with a dark eye each, lights travelling along it, above a layer of light and its image in the mirror floor" width="100%"><br><sub>an attractor</sub></td>
    <td align="center"><img src="docs/veil.gif" alt="A veil of green light like an aurora: rays of many heights rise from a bright wavy hem, above a blue layer of light and its image in the floor" width="100%"><br><sub>a veil</sub></td>
  </tr>
</table>

Plain WebGL2 and Web Audio: no build step, no dependencies, no media files.

Live: <https://sf624.github.io/rain-of-light/>

Inspired by teamLab's *Light Sculpture - Point*.

## Use

- **Click or tap**: a ripple of light, and a bell.
- **Drag**: look around.
- **Buttons**, bottom right: volume, sound ♪, full screen, settings ⚙. On a
  touch screen, a phone with an arrow turns the picture between landscape
  and portrait.
- **Keys**:

  | Key | Does |
  | --- | --- |
  | `p` | settings panel |
  | `c` | next colour |
  | `w` | next weather |
  | `d` | rain falling / sideways |
  | `v` | next camera move |
  | `m` | sound on / off |
  | `f` | full screen |
  | `r` | landscape / portrait |

The settings panel (⚙ or `p`) has a few settings: the scene, the colour,
the brightness, the quality and the sound's levels. Its link **All
settings** opens the lab, [`lab.html`](https://sf624.github.io/rain-of-light/lab.html):
the same page with every setting in its panel. Both pages keep what you
change in this browser; Reset brings back every default. Any setting can
also go in the URL, on either page. A few that people use:

| URL | Shows |
| --- | --- |
| `?scene=rain` | only the rain |
| `?scene=crystal` | only the forms of light |
| `?form=orb` | always the orb (also `spiral`, `ring`, `veil`, `solid`, `attractor`, `knot`, `fractal`, `none`) |
| `?color=cloud&weather=drizzle` | a colour mode and a weather |
| `?seed=7&t=120` | one order of the show, from 2 minutes in |
| `?breath=off` | no breathing swell of the light |
| `#tune` | the page with the settings panel open |
| `lab.html#tune` | the lab with its full panel open |

Every setting, key and URL parameter, with pictures:
[docs/settings.md](docs/settings.md).

The screen stays awake while the page is showing, where the browser allows it.

## Sound

Browsers start sound only after a click or a key, so the music begins with
your first one. (If you turned the sound off, that is remembered.) The music
follows what you see, with the same slow fades: the hush of rain and a slow
pad in D major; a voice for each form; near silence in a still room. The
Sound settings set the volume of each part.

## Install and offline

On a phone, or in Chrome or Edge, you can install it ("Add to Home Screen" /
"Install app"). It then opens full screen and works offline after the first
visit. Online you always get the newest files; offline, the last ones seen.

## Documents

- [docs/settings.md](docs/settings.md): what each setting does, with pictures.
- [docs/design.md](docs/design.md): how the app is built, explained plainly.
- [docs/development.md](docs/development.md): running it locally, the files,
  the tests and the tools.

## Licence

MIT, see [LICENSE](LICENSE).
