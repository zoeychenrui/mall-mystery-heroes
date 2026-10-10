# Mall Mystery Heroes

A Game Master console for running a live-action "assassin" game. Players are
assigned targets, hunt each other in the real world, submit photo proof of their
kills, and earn points. This app is what the Game Master (GM) runs on a laptop to
drive the whole game.

It is a Create React App single-page application backed entirely by Firebase —
Auth, Firestore, and Storage. There is no backend of our own.

> **Companion apps.** A player-facing mobile app is meant to upload kill
> photos, but does not currently exist — aspirational, not "elsewhere."
> Something Discord-related is implied by a stray env var, unconfirmed. See
> [docs/architecture.md](docs/architecture.md#system-context).

## Documentation

| Document                                     | Contents                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| [docs/architecture.md](docs/architecture.md) | Layers, routing, state management, auth, configuration                    |
| [docs/data-model.md](docs/data-model.md)     | Firestore collections field by field — the only schema record that exists |
| [docs/game-flows.md](docs/game-flows.md)     | Sequence diagrams for hosting, killing, photo moderation, reviving        |
| [docs/commands.md](docs/commands.md)         | The GM command bar reference                                              |
| [docs/improvements.md](docs/improvements.md) | Known issues and prioritized backlog                                      |
| [docs/testing.md](docs/testing.md)           | Testing strategy — what is implemented, what the layers are, what is next |

New to the codebase? Read `architecture.md`, then `data-model.md`. The data
model is reconstructed from call sites and is not declared anywhere in code, so
it is the piece least recoverable by reading source.

Not writing code and just need to _run_ a game? The docs above are for
developers. The [Moderator Playbook](https://claude.ai/code/artifact/350e07aa-21ea-4cf3-a53a-10f1cc29d923)
is the plain-language operating guide instead — hosting, the console, judging
photos, and the full command list — also linked from the console header
itself once a game is underway.

## Prerequisites

- Node.js 18 (matches the `engines` field in `functions/package.json`)
- [Firebase CLI](https://firebase.google.com/docs/cli) — `npm install -g firebase-tools`
- Java runtime (required by the Firestore emulator)

You do **not** need access to the `mall-mystery-heroes` Firebase project to run
this locally. The emulators serve everything, and `npm run firebase:emulate`
passes the project id with `--project` rather than selecting it with
`firebase use`, which would try to verify your access and fail.

## Setup

```bash
npm install
```

`functions/` is an npm workspace of the root package, so this one install
covers both packages' dependencies — no separate `cd functions && npm
install` step needed.

Create a `.env` in the repository root with the Firebase web config for your
project (Firebase console → Project settings → Your apps → SDK setup):

```
REACT_APP_APIKEY=
REACT_APP_AUTHDOMAIN=
REACT_APP_PROJECTID=
REACT_APP_STORAGEBUCKET=
REACT_APP_MESSAGINGSENDERID=
REACT_APP_APPID=
REACT_APP_MAPBOX_TOKEN=
```

`.env` is gitignored.

`REACT_APP_MAPBOX_TOKEN` is a public Mapbox access token, restricted to
this app's origins in your Mapbox account's token settings
(https://console.mapbox.com/account/access-tokens/). It is required for
the game-boundary map (moderator editor and, later, player map) to
render; without it, those screens show a "Map is not configured"
message instead of a map, and every other feature works normally.

## Running locally

Two terminals:

```bash
npm run firebase:emulate   # terminal 1 — emulator suite
npm start                  # terminal 2 — dev server on :3000
```

**`npm start` targets the emulators** because `.env.development` sets
`REACT_APP_USE_EMULATORS=true`, and `react-scripts start` reads that file. To
point the dev server at the real project instead, set the flag to anything else
(or delete the line) — no code change needed.

`npm run build` never reads `.env.development`, so a production bundle cannot
carry the flag. Under `NODE_ENV=test` the flag is absent and
`src/utils/firebaseEnv.js` throws rather than let a test run reach a live
project. See [docs/testing.md](docs/testing.md).

| Emulator    | Port           |
| ----------- | -------------- |
| Auth        | 9099           |
| Functions   | 5001           |
| Firestore   | 8081           |
| Storage     | 9199           |
| Emulator UI | 4000 (default) |

Since the emulator starts empty, a local run needs an account created through
`/signup` before you can host a room.

### Walking through a game locally

1. Sign up at `/signup`, which lands on `/dashboard`.
2. **Host Room** — generates an ID like `Fluffy42317` and opens the lobby.
3. Add at least two players. **Enter names in all lowercase** — see the caveat
   below.
4. **Begin Game** — review the generated target assignments, confirm, and you
   land on the GM console.
5. Drive the game from the command bar: `/kill <target> <assassin>`,
   `/add <player> <points>`, `/revive <player>`,
   `/openseason <player> start|end`. Full reference in
   [docs/commands.md](docs/commands.md).

> **Caveat: player names must be lowercase.** Commands lowercase their arguments
> but Firestore lookups query the case-preserved `name` field, so any player
> entered with a capital letter cannot be referenced from the command bar —
> usually failing with a misleading "not a valid target" message, or with no
> feedback at all. This is a known bug, documented as
> [improvements item 1](docs/improvements.md#1-player-names-must-be-all-lowercase-or-commands-silently-fail).

## Scripts

| Command                    | Description                                                       |
| -------------------------- | ----------------------------------------------------------------- |
| `npm start`                | Dev server on port 3000, wired to emulators                       |
| `npm run build`            | Production bundle to `build/`, wired to the real project          |
| `npm test`                 | Jest, configured in `jest.config.js`                              |
| `npm run lint`             | ESLint, fails on any warning                                      |
| `npm run lint:fix`         | ESLint with autofix                                               |
| `npm run format`           | Prettier, rewrites files in place                                 |
| `npm run format:check`     | Prettier in check mode, as CI runs it                             |
| `npm run firebase:emulate` | Selects the `default` project alias and starts the emulator suite |

Inside `functions/`: `npm run serve`, `npm run deploy`, `npm run logs`, `npm run lint`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for conventions, the repo-specific rules
worth knowing before you change anything, and what CI checks.

## Project layout

```
src/
  pages/                        one component per route
  components/
    firebase_calls/dbCalls.js   the data-access layer — all Firestore reads/writes
    lobby_components/           roster management
    header_components/          console header, reset-targets, end-game
    logs_components/            log panel and the GM command bar
    photos_display_component/   kill-photo moderation queue
    player_listing/             live player list
    task_components/            mission creation and listing panel
  utils/firebase.js             SDK init and emulator wiring
  Contexts.js, theme.js
functions/                      killPlayer (atomic kill transaction) + a callable stub
docs/                           architecture documentation
```

## Known gaps

Worth knowing before you start changing things — all detailed in
[docs/improvements.md](docs/improvements.md):

- **`firestore.rules` scopes access to a room's host**, and the three
  authenticated routes are wrapped in `RequireAuth`, but `storage.rules` still
  allows unauthenticated read/write on every path.
- **Most game logic is still client-side.** Kills are the one exception —
  validation, scoring, unmapping, and remapping all run server-side inside
  the `killPlayer` Cloud Function's transaction. Target assignment,
  open-season toggling, and task-completion scoring still run in the
  browser — a signed-in host can still write any of those fields directly
  to their own room.
- **Test coverage is thin outside `src/game/` and the kill path.** The
  harness is in place and CI runs it, but plenty of game logic is still
  untested — see [docs/testing.md](docs/testing.md).
- **`.firebaserc` maps `dev` and `prod` to the same project.** There is no
  staging environment.
- **Deployment is not captured here** — `firebase.json` has no `hosting` block,
  so how the built SPA reaches users is not reproducible from this repo.
