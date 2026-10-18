KawaCity
========

A city simulation game for the browser (JS/HTML5).

KawaCity is a modified version of [micropolisJS](https://github.com/graememcc/micropolisJS) by Graeme McCutcheon and contributors, itself a port of Micropolis to JS/HTML5. It is not the original micropolisJS, and is not affiliated with or endorsed by its authors, Micropolis GmbH or Electronic Arts.

## Deploying ##

The image is published as `ghcr.io/kawakode/kawacity` (amd64 and arm64): one server for the game, its accounts and multiplayer, on port 8080, which keeps its data in `/data`. With Docker Compose:

```sh
curl -O https://raw.githubusercontent.com/kawakode/micropolisJS-docker/main/docker-compose.yml
docker compose up -d
```

Then open <http://localhost:8080>. The settings are in [docker-compose.yml](docker-compose.yml), or in a `.env` file next to it ([.env.example](.env.example) lists them all, with their defaults):

- **PUBLIC_URL**: the address players open, such as `https://kawacity.example.com`, without a path. Mails link to it, and only pages from it may post to the server or join multiplayer: at any other address (a LAN address, another port) the game only links to it. Plain `http` is refused except for `localhost`, unless `ALLOW_INSECURE_HTTP=1`.
- **Mail** (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` or `SMTP_PASSWORD_FILE`, `MAIL_FROM`): players need it to create accounts and reset their passwords. On port 587 STARTTLS is required; set `SMTP_SECURE=true` for port 465. `OPERATOR_CONTACT` (who runs the server and how to reach them) is shown in the privacy notice.
- **Without mail**, the game looks as it always did: nobody can sign up, and logging in is only offered once an account has been made with the admin commands below. `REGISTRATION=closed` keeps sign-ups closed with mail too.
- **Shared addresses**: limits count requests per address (per /64 for IPv6). A class or an office behind one address can raise them with `IP_LIMIT_FACTOR` (such as `10`).

Commands:

- **Update**: `docker compose pull && docker compose up -d`
- **Stop**: `docker compose down` (the data stays in the `kawacity-data` volume)
- **Without Compose**: `docker run -d -p 8080:8080 -v kawacity-data:/data -e PUBLIC_URL=http://localhost:8080 --restart unless-stopped ghcr.io/kawakode/kawacity`
- **Accounts**, made and repaired by hand (the links printed are valid 24 h for a new account, 1 h for a reset; give them to their owners yourself):

  ```sh
  docker compose exec kawacity node server/main.cjs user add alice alice@example.com   # prints a link to choose a password (add fr for French emails)
  docker compose exec kawacity node server/main.cjs user reset alice                   # or her email address
  docker compose exec kawacity node server/main.cjs user list
  docker compose exec kawacity node server/main.cjs user delete alice
  docker compose exec kawacity node server/main.cjs mail-test you@example.com          # checks the mail settings
  ```

- **Backup**: `docker compose exec kawacity node server/main.cjs backup` copies the database to `/data/backups/kawacity-<time>.db`, safely while the game is played, and `docker compose cp kawacity:/data/backups .` takes the copies out. The server also makes a copy there before it upgrades the database to a new version.
- **Restore**: stop the server, put the copy in place of `kawacity.db` and delete `kawacity.db-wal` and `kawacity.db-shm`, then start it again:

  ```sh
  docker compose stop
  docker compose run --rm --no-deps -T --entrypoint sh kawacity \
    -c 'cat > /data/kawacity.db && rm -f /data/kawacity.db-wal /data/kawacity.db-shm' < kawacity-copy.db
  docker compose up -d
  ```

- Run **one container per volume**: the cities being played live in the server's memory.

**HTTPS and a domain name**: put the server behind a reverse proxy, publish its port on the host only (`"127.0.0.1:8080:8080"` in docker-compose.yml), and set `PUBLIC_URL=https://kawacity.example.com` and `TRUST_PROXY=1`. `TRUST_PROXY` is the number of proxies in front of the server (2 for a CDN, then nginx): the client's address is then read from `X-Forwarded-For`, from the addresses of `TRUSTED_PROXIES` only (the local and private networks by default, Docker's included; `TRUSTED_PROXIES=172.18.0.0/16` would trust only that Docker network). Never set it while players can reach the port directly, or they could choose their own address. With [Caddy](https://caddyserver.com):

```
kawacity.example.com {
	reverse_proxy 127.0.0.1:8080
}
```

With nginx, see [docker/nginx.example.conf](docker/nginx.example.conf): multiplayer needs the WebSocket upgrade it passes on.

**Upgrading from 1.x**: version 2 listens on port 8080 instead of 80, and keeps accounts and cities in a volume. Download the new docker-compose.yml (or change `"8080:80"` to `"8080:8080"`, and add `PUBLIC_URL` and the `kawacity-data:/data` volume), and point a reverse proxy that used port 80 to 8080.

**Without the server**: `npm run build` also makes the game a static site in `dist/`, which any web server can host. Single player works the same there; accounts and multiplayer need the image.

## Development ##

You need Node.js 22.13 or later.

```sh
npm ci
npm run build   # the game in dist/, and its server in build/server/
npm test        # unit tests, the server's included
npm run lint    # type check
```

`npm run dev` serves the game alone at <http://localhost:8080>. With the server too, copy `.env.example` to `.env` (the server on port 3000, behind `npm run dev`, printing its mails in its log), then run each of these in its own terminal:

```sh
npm run dev           # the game at http://localhost:8080, which passes /api on to the server
npm run dev:server    # builds the server again on every change
npm run start:server  # runs it (once built), and restarts it on every build
```

`docker compose -f docker-compose.yml -f compose.dev.yml up --build` runs the image built from this checkout instead, with [Mailpit](https://mailpit.axllent.org) showing the mails it sends at <http://localhost:8025>.

- `?debug=1` in the URL shows a debug menu and exposes the game as `window.kawaCity`, and the translations as `window.kawaI18n`.
- `docker build -t kawacity .` builds the image.
- The server is in `server/` (TypeScript, bundled with the game's modules it uses): its settings are read by `server/config.ts`, and its tests are in `server/test/`.
- The texts are written in English; `src/lang/fr.js` translates them into French (see `src/i18n.js`). `npm test` checks that every text has its translation.
- `python3 tools/pixelart/generate.py` regenerates the tiles and sprites in `images/` from the original artwork (needs Pillow and numpy).
- `python3 tools/icon/generate.py` draws, in pixel art, the favicon and the icons in `images/icons/`, and the interface's pictures in `images/ui/` with their places in `src/uiIcons.js` (needs Pillow).
- `python3 tools/icon/map_atlas.py` draws the isometric view of the map in the same style: the ground, buildings, vehicles and their night lights in `images/iso/`, with their places in `src/isoArt.js` (needs Pillow). `src/isoTiles.js` says what is drawn for each tile, and `src/isoView.js` draws the map. The view from above, drawn from the tiles of `tools/pixelart`, can still be chosen in the settings.

**Releasing**: push a version tag. The tests run, then the image is published with the tag's version (`1.2.3`, `1.2`, `1`) and as `latest` (except pre-releases such as `v1.2.3-rc.1`).

```sh
git tag v1.2.3
git push origin v1.2.3
```

## Security notes ##

- **Passwords**: 12 to 128 characters, any characters, spaces included, and no rules about what they mix; common passwords (a list of 20,000), passwords with the username or the email address in them, and passwords of fewer than 4 different characters are refused. They are hashed with scrypt (N = 2^15 by default, `PASSWORD_HASH_COST`), and hashed again with new settings at the next login.
- **Logging in**: after 5 failures in a row for one account from one address, that address waits (1 minute, then 2, 4... up to an hour); 100 failures in a day lock the account for a day, or until its password is reset, and its owner gets an email. Answers are the same whether an account exists or not, for logging in, signing up and resetting a password. A captcha, a proof of work computed by the browser (no third party, no tracking), guards signing up, logging in and resetting a password.
- **Sessions**: a random token in an `HttpOnly`, `SameSite=Strict` cookie (`__Host-` and `Secure` with https), stored hashed. A session ends after 7 days unused or 30 days in any case (`SESSION_IDLE_DAYS`, `SESSION_MAX_DAYS`): a deliberate choice for a game (NIST 800-63B AAL1), as changing the password or the email address and deleting the account always ask for the password. Changing or resetting the password ends the other sessions; "Log out everywhere" ends them all.
- **Emails**: sign-up is email-first (an account exists only once its address was confirmed), links in emails work once and expire (24 h to sign up or confirm an address, 1 h to reset a password), and an address gets at most 3 emails with a link an hour and 10 a day (`MAIL_MAX_PER_HOUR` in all). The notices that tell an account's owner about a change (password or address changed, account locked) have limits of their own, so that links anyone can ask for cannot silence them. With SMTP, STARTTLS with a valid certificate is required unless `SMTP_SECURE=true` or `SMTP_REQUIRE_TLS=false`.
- **Requests**: changes are only accepted from the page at `PUBLIC_URL` (`Origin` checked, JSON only, no CORS); limits per address on every route; strict security headers and Content-Security-Policy.
- **Privacy**: the server keeps the username, email address, password hash, sessions and cities of each account, and its log keeps addresses and account ids (never passwords, tokens or what was typed to log in). Players can download what is kept about them and delete their account from the game.

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
- Common passwords (`server/security/commonPasswordList1.ts` and `2.ts`): from [SecLists](https://github.com/danielmiessler/SecLists) by Daniel Miessler and contributors, under the MIT License.
- Fonts: [Press Start 2P](https://github.com/codeman38/PressStart2P) by Cody "CodeMan38" Boisclair and [DotGothic16](https://github.com/fontworks-fonts/DotGothic16) by Fontworks, under the SIL Open Font License (see `css/fonts/`).

## License ##
The code is licensed under the GPLv3 (see [COPYING](COPYING)), with some additional terms (see [LICENSE](LICENSE)) - please be mindful of these. Likewise, be aware that the code is additionally governed by the Micropolis Public Name License as detailed in the next paragraph; this too must be complied with.

## [Micropolis Public Name License](MicropolisPublicNameLicense.md) ##
Micropolis is a registered trademark of [Micropolis Corporation (Micropolis GmbH)](https://www.micropolis.com) and is licensed here as a courtesy of the owner under the [Micropolis Public Name License](MicropolisPublicNameLicense.md).

The name/term "MICROPOLIS" is a registered trademark of [Micropolis](https://www.micropolis.com) GmbH (Micropolis Corporation, the "licensor") and is licensed here to the authors/publishers of the "Micropolis" city simulation game and its source code (the project or "licensee(s)") as a courtesy of the owner.
