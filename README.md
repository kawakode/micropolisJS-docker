KawaCity
========

A city simulation game for the browser (JS/HTML5).

KawaCity is a modified version of [micropolisJS](https://github.com/graememcc/micropolisJS) by Graeme McCutcheon and contributors, itself a port of Micropolis to JS/HTML5. KawaCity is not the original micropolisJS, and is not affiliated with or endorsed by its authors, Micropolis GmbH or Electronic Arts.

## Running the game ##

### With Docker ###

```sh
docker build -t kawacity .
docker run --rm -p 8080:80 kawacity
```

Then open <http://localhost:8080>.

### With Node.js ###

You need Node.js 22 or later.

```sh
npm ci
npm run build   # builds the static site into dist/
npm run dev     # or: serves a development build at http://localhost:8080
```

The contents of `dist/` can be hosted on any static web server. Note that the game must be built: the `index.html` at the root of the repository is only a template.

### Checks ###

```sh
npm test        # unit tests
npm run lint    # type check
```

Adding `?debug=1` to the game's URL shows the frame rate and a debug menu, and exposes the game as `window.kawaCity` in the browser console.

## Playing ##

- **New city**: generate maps until you find one you like (the map options choose an island or mainland, how much water and how many forests), then name your city and pick a difficulty.
- **Scenarios & cities**: the eight scenarios of the original game (Dullsville, San Francisco, Hamburg, Bern, Tokyo, Detroit, Boston, Rio de Janeiro), each with its disaster, its time limit and its goal, and the sample cities of the original game (`cities/`, read by `src/cityFile.js`).
- **Saving**: "Save" keeps the game in the browser, and can also download it as a `.kawacity` file. "Open a city file" on the title screen opens these files, and the city files (`.cty`) of the original game.
- **Building**: zones (residential, commercial, industrial) and the query tool are always at hand; the rest is grouped in categories, each with a palette of tools:
  - **Bulldozer**: 1x1, 3x3, 5x5 and 7x7 (press `B` again to change size). Wider bulldozers clear the area around the pointer, like a brush; any tile of a building demolishes all of it, and the preview shows the whole building;
  - **Transport**: streets, dirt roads (cheap, but they jam and slow trips down), avenues (twice the traffic), highways (four times the traffic and longer trips, but no access to the buildings beside them), rail, seaports and airports;
  - **Power**: power lines, wind turbines, solar farms, gas plants, coal and nuclear plants;
  - **Services**: police and fire stations, schools and universities (higher land values and less crime around them);
  - **Leisure**: parks, gardens, plazas, big parks and stadiums;
  - **Terrain**: plant forests, dig lakes and canals, fill water in.
- **Running the city**: the budget, the evaluation (with what the citizens complain about), the graphs of the city's history, the minimap's data overlays (power, population, traffic, pollution, crime, land value, police and fire coverage, rate of growth) and the query tool tell you how the city is doing. Disasters can be unleashed from the menu, or turned off in the settings, where the difficulty can also be changed.

## Graphics ##

The tiles and sprites in `images/` are generated from the original Micropolis artwork (kept in `art/micropolis/`) by `tools/pixelart/generate.py`, which repaints the terrain and remasters everything else in a 16-bit console style. KawaCity's own buildings (tile numbers 1024 and up) are drawn in `tools/pixelart/kawa.py` and remastered the same way, as are the looks of dirt roads, avenues and highways (`images/tiles-roads.png`). It also renders the frames of the water animation (`images/tiles-water.png` and `src/waterTiles.js`) and the lights that come on at night (`images/tiles-lights.png` and `src/lightTiles.js`). To regenerate them (requires Python 3 with Pillow and numpy):

```sh
python3 tools/pixelart/generate.py
```

The map is also brought to life by purely decorative effects (`src/ambientLife.js`), which follow the simulation and stop when the game is paused:

- cars, pedestrians, sailing boats, birds and cloud shadows: traffic grows with the population;
- smoke from factories, the coal power plant and fires, steam from the nuclear power plant's cooling towers, and dust where buildings go up;
- a day and night cycle (a day lasts six minutes), during which windows, street lamps, headlights and boat lanterns light up; it can be turned off in the settings;
- fireworks when the city reaches a milestone.

## Controls ##

- **Build**: pick a tool, then click on the map. Drag to lay roads, rails and power lines along a path, to place a grid of zones or buildings, or to bulldoze or plant parks over an area. The preview shows where the tool will act and what it will cost.
- **Move around**: right- or middle-drag (or left-drag with no tool selected), arrow keys or WASD, two-finger scrolling on a touchpad, or click on the minimap.
- **Zoom**: mouse wheel, pinch, `+`/`-`, or the buttons in the corner of the map.
- **Shortcuts**: `1`–`9` select tools, `B` bulldozer (again for the next size), `Q` query, `Space` pause, `Esc` cancel/close/deselect.
- **Automatic bulldozing** (settings): when on, building on trees, rubble or the debris of an explosion clears them for $1 a tile, whatever the tool (roads, rails and power lines also fill shores in, and buildings clear power lines away). When off, the land must be bulldozed first: the preview says so.

## Credits ##
- [micropolisJS](https://github.com/graememcc/micropolisJS): Copyright (C) Graeme McCutcheon, 2013, and [contributors](https://github.com/graememcc/micropolisJS/graphs/contributors).
- Micropolis: the open-source release of a city simulation game once sold by Electronic Arts.
- KawaCity: renamed and modified from micropolisJS by [kawakode](https://github.com/kawakode) in 2026.
- Scenarios and sample cities (`cities/`): from the Micropolis release, Copyright (C) 1989 - 2007 Electronic Arts Inc., under the GPLv3 with the additional terms in [LICENSE](LICENSE).
- Fonts: [Press Start 2P](https://github.com/codeman38/PressStart2P) by Cody "CodeMan38" Boisclair and [DotGothic16](https://github.com/fontworks-fonts/DotGothic16) by Fontworks, under the SIL Open Font License (see `css/fonts/`).

## License ##
The code is licensed under the GPLv3 (see [COPYING](COPYING)), with some additional terms (see [LICENSE](LICENSE)) - please be mindful of these. Likewise, be aware that the code is additionally governed by the Micropolis Public Name License as detailed in the next paragraph; this too must be complied with.

## [Micropolis Public Name License](MicropolisPublicNameLicense.md) ##
Micropolis is a registered trademark of [Micropolis Corporation (Micropolis GmbH)](https://www.micropolis.com) and is licensed here as a courtesy of the owner under the [Micropolis Public Name License](MicropolisPublicNameLicense.md).

The name/term "MICROPOLIS" is a registered trademark of [Micropolis](https://www.micropolis.com) GmbH (Micropolis Corporation, the "licensor") and is licensed here to the authors/publishers of the "Micropolis" city simulation game and its source code (the project or "licensee(s)") as a courtesy of the owner.
