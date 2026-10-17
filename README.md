KawaCity
========

A city simulation game for the browser (JS/HTML5).

KawaCity is a modified version of [micropolisJS](https://github.com/graememcc/micropolisJS) by Graeme McCutcheon and contributors, itself a port of Micropolis to JS/HTML5. It is not the original micropolisJS, and is not affiliated with or endorsed by its authors, Micropolis GmbH or Electronic Arts.

## Deploying ##

The image is published as `ghcr.io/kawakode/kawacity` (amd64 and arm64). With Docker Compose:

```sh
curl -O https://raw.githubusercontent.com/kawakode/micropolisJS-docker/main/docker-compose.yml
docker compose up -d
```

Then open <http://localhost:8080>. The port and the version can be changed in [docker-compose.yml](docker-compose.yml).

- **Update**: `docker compose pull && docker compose up -d`
- **Stop**: `docker compose down`
- **Without Compose**: `docker run -d -p 8080:80 --restart unless-stopped ghcr.io/kawakode/kawacity`

The game is a static site: for HTTPS or a domain name, put it behind your usual reverse proxy.

## Development ##

You need Node.js 22 or later.

```sh
npm ci
npm run dev     # development build at http://localhost:8080
npm run build   # static site in dist/
npm test        # unit tests
npm run lint    # type check
```

- `?debug=1` in the URL shows a debug menu and exposes the game as `window.kawaCity`, and the translations as `window.kawaI18n`.
- `docker build -t kawacity .` builds the image.
- The texts are written in English; `src/lang/fr.js` translates them into French (see `src/i18n.js`). `npm test` checks that every text has its translation.
- `python3 tools/pixelart/generate.py` regenerates the tiles and sprites in `images/` from the original artwork (needs Pillow and numpy).
- `python3 tools/icon/generate.py` draws, in pixel art, the favicon and the icons in `images/icons/`, and the interface's pictures in `images/ui/` with their places in `src/uiIcons.js` (needs Pillow).
- `python3 tools/icon/map_atlas.py` draws the isometric view of the map in the same style: the ground, buildings, vehicles and their night lights in `images/iso/`, with their places in `src/isoArt.js` (needs Pillow). `src/isoTiles.js` says what is drawn for each tile, and `src/isoView.js` draws the map. The view from above, drawn from the tiles of `tools/pixelart`, can still be chosen in the settings.

**Releasing**: push a version tag. The tests run, then the image is published with the tag's version (`1.2.3`, `1.2`, `1`) and as `latest` (except pre-releases such as `v1.2.3-rc.1`).

```sh
git tag v1.2.3
git push origin v1.2.3
```

## Playing ##

- **Start**: a new city, one of the eight scenarios of the original game, a sample city, or a saved file (`.kawacity`, or `.cty` from the original game).
- **Build**: zones, transport, power, services, leisure and terrain tools. The budget, evaluation, graphs (the last 10 or 120 years, the year to date, or the years you choose: drag across the graph) and map overlays show how the city is doing.
- **Neighbours**: a city lies beyond each edge of the map. Sign trade agreements, buy or sell electricity, or twin your city with them: most deals need a road, railway or power line reaching their edge, and are paid with the yearly budget.
- **Pictures**: take a picture of the visible map or of the whole map, captioned with the city's name and figures, and share, copy or download it (sharing and copying need the game to be served over HTTPS).
- **Languages**: English and French. The game starts in the browser's language, and Settings change it.
- **News**: the ticker along the bottom of the screen tells how the city is doing (at least one item in three: disasters, what needs fixing), between jokes about what the mayor has been doing.
- **Controls**: click to build, drag for roads, lines and areas. Right-drag, arrows or WASD to move; wheel, pinch or `+`/`-` to zoom.
- **Shortcuts**: `1`–`9` tools, `B` bulldozer (again for the next size), `Q` query, `Space` pause, `Esc` cancel.

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
