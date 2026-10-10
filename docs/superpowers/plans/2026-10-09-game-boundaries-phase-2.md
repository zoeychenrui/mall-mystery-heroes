# Game Boundaries Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the moderator a map-based editor to draw, publish, and disable the room's game-area boundary, building entirely on the server and pure-logic foundation Phase 1 already shipped.

**Architecture:** A shared `GameMap` renderer (Mapbox GL JS via `react-map-gl`) displays satellite/standard tiles and a boundary overlay. `BoundaryEditorModal` adds drawing interaction on top of it — local draft state, four shape tools, undo/clear, and publish/disable calling the Phase-1 Cloud Functions. A tiny pure helper (`src/game/boundaryDraft.js`) turns whatever a drawing gesture produces into the canonical polygon + validation, reusing Phase 1's `gameBoundary.js` math untouched. A small button component wires the editor into `Lobby.js` and `GameMasterView.js`.

**Tech Stack:** React 18 + Chakra UI 2 (existing), Mapbox GL JS + `react-map-gl` v7 (new), Firebase callables (existing pattern).

**Spec:** `docs/superpowers/specs/2026-09-30-game-boundaries-design.md` — this plan implements the "Moderator experience" and editor half of "Components"; the player-tracking half (`useBoundaryLocation.js`, `PlayerMapModal.js`, `PlayerGame.js` UI) and the roster-badge half (`PlayersList.js`) are separate, later plans, exactly as Phase 1's plan recorded.

## Global Constraints

- A public Mapbox access token, restricted to this app's origins, is required to see a live map and is configured outside this repository (spec, "Open implementation choice"). No token exists in this repo today. **No task in this plan may assume a live token during automated tests.** Every test touching `GameMap.js` or `BoundaryEditorModal.js` mocks `react-map-gl` and `mapbox-gl` completely — the spec's own Testing section calls for exactly this ("UI tests with map/geolocation adapters mocked"). Manually confirming a real map renders is the user's job once they supply a token; it is not part of `npm test`/`npm run build`.
- **Implementation-detail substitution, noted for the user's review:** the spec's "Open implementation choice" names `@mapbox/mapbox-gl-draw` as a candidate library for freehand/polygon editing, but frames the whole choice as a default to verify, not an approved product decision. This plan does **not** add that dependency. All four tools (freehand, rectangle, circle, oval) are built from one shared drag gesture — mapbox-gl's own `mousedown`/`mousemove`/`mouseup` map events, which hand back `lngLat` directly — interpreted differently per tool, plus Phase 1's own `projectToMeters`/`shapeToPolygon` math. Fewer moving parts, one gesture to get right instead of a second library's event model, and it delivers the same four tools with real drag-to-resize. If this substitution isn't acceptable, say so before implementation starts; swapping in `mapbox-gl-draw` later would touch only Task 5.
- **Deliberate scope cut, noted for the user's review:** this plan does not implement "Use My Location" or address/place search for centering a fresh map (spec, "Moderator experience"). The moderator positions a fresh boundary by panning/zooming manually — explicitly allowed by the spec ("The moderator can also pan and zoom manually; denying their own location permission does not prevent drawing") — and an _existing_ boundary still auto-fits on open. Geolocation plumbing belongs with Phase 3's `useBoundaryLocation.js` work; duplicating a slice of it here for one button was judged not worth it. Flag if this should be pulled into this phase instead.
- Canonical field names and shapes, from `docs/data-model.md`'s `gameBoundary` row (Phase 1): `{ enabled: boolean, revision: number, shapeType: 'freehand'|'rectangle'|'circle'|'oval', vertices: Array<{lat, lng}>, shapeParameters: object|null, updatedAt: Timestamp }`.
- `publishGameBoundary` callable: `{ roomId, expectedRevision, shapeType, vertices, shapeParameters }` → `{ revision }`. Errors: `unauthenticated`; `invalid-argument` (missing fields, failed `validateBoundaryShape`, or shape parameters that don't match the vertices); `not-found` (`'Room not found.'`); `permission-denied` (`'Only the room host can change the game area.'`); `failed-precondition` `'This game has ended.'`; `failed-precondition` `'revision_conflict'`.
- `disableGameBoundary` callable: `{ roomId, expectedRevision }` → `{ revision }`. Same error set, plus `failed-precondition` `'There is no game area to disable.'` when the room never had one.
- `shapeToPolygon(shapeType, shapeParameters)`, `validateBoundaryShape(shapeType, vertices)`, and `projectToMeters(point, origin)` are exported from `src/game/gameBoundary.js` and throw/return reasons exactly as Phase 1 built and tested them. This plan does not modify that file at all — Task 2 only adds a new, separate pure module (`boundaryDraft.js`) that calls into it.
- Every file touching the client Firestore/Auth/Functions SDKs follows this repo's existing seams: Firestore reads/writes through `src/components/firebase_calls/dbCalls.js`; a Cloud Function callable gets its own thin wrapper file directly under `src/components/` (e.g. `submitChatMessage.js`, `executeKill.js` — **not** inside `dbCalls.js`; that file is for Firestore only). `react-map-gl`/`mapbox-gl` imports stay inside `src/components/map_components/`.
- Test routing follows `jest.config.js`: `src/game/**/*.test.js` → **unit** (node, pure). `src/**/*.test.jsx` → **dom** (jsdom + Testing Library, map library mocked). No new `.integration.test.js` files are needed in this plan — the two Cloud Functions these wrappers call already have full emulator coverage from Phase 1, and this repo's own precedent (`submitChatMessage.js`, `executeKill.js`) ships thin callable wrappers with no dedicated test file of their own; their only coverage is the consuming component's mocked test plus the function's own emulator tests.
- Run `npm run format`, `npm run lint`, and `npm test` after every task's implementation step, before committing.

## Review Focus

- A moderator reopening an existing boundary to edit it must get back the exact `shapeType` and `shapeParameters` it was published with, not just the vertices — otherwise a circle becomes an uneditable blob of points the moment someone reopens it. (Task 2's `draftFromPublished` test; Task 5's "reopens an existing boundary" test.)
- Publish must be functionally disabled — not merely styled to look disabled — whenever the draft fails `validateBoundaryShape`, and the moderator should see _why_ (the validator's own reason string), not a generic "invalid shape." (Task 5's publish-gating tests.)
- A revision conflict (another moderator tab published first) must retain the draft and show the conflict, never silently retry or discard what the moderator drew. (Task 6's conflict test.)
- Switching drawing tools, or clicking Clear Draft, must fully detach the previous tool's map listeners before the next tool attaches its own — a leftover `mousedown`/`mousemove`/`mouseup` handler from the last tool firing during the next one's gesture is the single easiest bug to ship here. (Task 5's tool-switch test.)
- Closing the editor (Cancel/X) must discard the local draft outright; reopening starts from the last _published_ boundary, never from whatever was abandoned last time. (Task 6's cancel-then-reopen test.)

---

### Task 1: Mapbox dependencies and the token's documentation

**Files:**

- Modify: `package.json` (via `npm install`, not hand-edited)
- Modify: `README.md:58-70`

**Interfaces:**

- Produces: `mapbox-gl` and `react-map-gl` available to import anywhere under `src/`; `process.env.REACT_APP_MAPBOX_TOKEN` as the documented env var name every later task reads.

- [ ] **Step 1: Install the dependencies**

```bash
npm install mapbox-gl@^3 react-map-gl@^7
```

Do not hand-edit `package.json`'s version ranges — let `npm install` resolve and write both `package.json` and `package-lock.json` together, or `npm ci` will fail later.

- [ ] **Step 2: Confirm the installed package's real export names**

`react-map-gl` v7's exact export surface (default vs. named `Map`, which subpath) has moved between minor versions. Before writing any code in a later task that imports from it, run:

```bash
node -e "console.log(Object.keys(require('react-map-gl')))"
```

Record the actual exported names in this task's report. Task 4 is written against `import { Map, Source, Layer } from 'react-map-gl';` — if the installed version's real exports differ, Task 4's implementer adjusts the import line to match and notes the substitution; nothing else in this plan depends on which exact form it takes.

- [ ] **Step 3: Verify nothing broke**

```bash
npm run lint
npm run build
```

Expected: both still pass — the new packages are installed but not yet imported anywhere, so this just confirms CRA's build tolerates the new `node_modules` entries.

- [ ] **Step 4: Document the required token**

In `README.md`, extend the existing `.env` block (around line 58-70) from:

```
REACT_APP_APIKEY=
REACT_APP_AUTHDOMAIN=
REACT_APP_PROJECTID=
REACT_APP_STORAGEBUCKET=
REACT_APP_MESSAGINGSENDERID=
REACT_APP_APPID=
```

to:

```
REACT_APP_APIKEY=
REACT_APP_AUTHDOMAIN=
REACT_APP_PROJECTID=
REACT_APP_STORAGEBUCKET=
REACT_APP_MESSAGINGSENDERID=
REACT_APP_APPID=
REACT_APP_MAPBOX_TOKEN=
```

and add one paragraph directly after the existing "`.env` is gitignored." line:

```markdown
`REACT_APP_MAPBOX_TOKEN` is a public Mapbox access token, restricted to
this app's origins in your Mapbox account's token settings
(https://console.mapbox.com/account/access-tokens/). It is required for
the game-boundary map (moderator editor and, later, player map) to
render; without it, those screens show a "Map is not configured"
message instead of a map, and every other feature works normally.
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json README.md
git commit -m "Add Mapbox map dependencies and document REACT_APP_MAPBOX_TOKEN

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Pure boundary-draft helper

**Files:**

- Create: `src/game/boundaryDraft.js`
- Test: `src/game/boundaryDraft.test.js`

**Interfaces:**

- Consumes: `shapeToPolygon`, `validateBoundaryShape` (already exported from `src/game/gameBoundary.js`).
- Produces: `emptyDraft()`, `draftFromPublished(published)`, `draftFromFreehand(points)`, `draftFromParameters(shapeType, shapeParameters)`, `isDraftPublishable(draft)`. Every draft object has the shape `{ shapeType: string|null, shapeParameters: object|null, vertices: Array<{lat,lng}>|null, validation: {ok: true} | {ok: false, reason: string} }`.

- [ ] **Step 1: Write the failing tests for the draft helper**

Create `src/game/boundaryDraft.test.js`:

```javascript
const {
    emptyDraft,
    draftFromPublished,
    draftFromFreehand,
    draftFromParameters,
    isDraftPublishable,
} = require('./boundaryDraft');

const RECTANGLE_CORNERS = [
    { lat: 40, lng: -74 },
    { lat: 40.01, lng: -73.99 },
];

describe('emptyDraft', () => {
    it('has no shape and is not publishable', () => {
        const draft = emptyDraft();
        expect(draft.shapeType).toBeNull();
        expect(draft.vertices).toBeNull();
        expect(draft.validation).toEqual({ ok: false, reason: 'Draw a shape to begin.' });
        expect(isDraftPublishable(draft)).toBe(false);
    });
});

describe('draftFromPublished', () => {
    it('returns an empty draft when there is nothing published', () => {
        expect(draftFromPublished(null)).toEqual(emptyDraft());
        expect(draftFromPublished(undefined)).toEqual(emptyDraft());
    });

    it('carries over the exact shapeType and shapeParameters of a published boundary', () => {
        const published = {
            shapeType: 'circle',
            shapeParameters: { center: { lat: 40, lng: -74 }, radiusMeters: 500 },
            vertices: [{ lat: 40.001, lng: -74 }],
        };
        const draft = draftFromPublished(published);
        expect(draft.shapeType).toBe('circle');
        expect(draft.shapeParameters).toEqual(published.shapeParameters);
        expect(draft.vertices).toBe(published.vertices);
        expect(isDraftPublishable(draft)).toBe(true);
    });
});

describe('draftFromFreehand', () => {
    it('is not publishable for an empty stroke', () => {
        const draft = draftFromFreehand([]);
        expect(draft.vertices).toBeNull();
        expect(isDraftPublishable(draft)).toBe(false);
    });

    it('closes an open stroke into a ring', () => {
        const open = [
            { lat: 40, lng: -74 },
            { lat: 40.001, lng: -74 },
            { lat: 40.001, lng: -73.999 },
            { lat: 40, lng: -73.999 },
        ];
        const draft = draftFromFreehand(open);
        expect(draft.shapeType).toBe('freehand');
        expect(draft.shapeParameters).toBeNull();
        expect(draft.vertices).toHaveLength(5);
        expect(draft.vertices[4]).toEqual(open[0]);
        expect(isDraftPublishable(draft)).toBe(true);
    });

    it('does not double-close an already-closed stroke', () => {
        const closed = [
            { lat: 40, lng: -74 },
            { lat: 40.001, lng: -74 },
            { lat: 40.001, lng: -73.999 },
            { lat: 40, lng: -74 },
        ];
        const draft = draftFromFreehand(closed);
        expect(draft.vertices).toHaveLength(4);
    });

    it('still returns the drawn vertices even when they are invalid, so the UI can show what is wrong', () => {
        // Three distinct points plus closure — below the 4-distinct-corner
        // minimum validateBoundaryShape enforces.
        const tooFew = [
            { lat: 40, lng: -74 },
            { lat: 40.001, lng: -74 },
            { lat: 40, lng: -74 },
        ];
        const draft = draftFromFreehand(tooFew);
        expect(draft.vertices).not.toBeNull();
        expect(isDraftPublishable(draft)).toBe(false);
    });
});

describe('draftFromParameters', () => {
    it('derives vertices and validation for a valid rectangle', () => {
        const draft = draftFromParameters('rectangle', { corners: RECTANGLE_CORNERS });
        expect(draft.shapeType).toBe('rectangle');
        expect(draft.shapeParameters).toEqual({ corners: RECTANGLE_CORNERS });
        expect(draft.vertices.length).toBeGreaterThan(0);
        expect(isDraftPublishable(draft)).toBe(true);
    });

    it('derives vertices and validation for a valid circle', () => {
        const draft = draftFromParameters('circle', {
            center: { lat: 40, lng: -74 },
            radiusMeters: 200,
        });
        expect(isDraftPublishable(draft)).toBe(true);
    });

    it('is not publishable, with no thrown error, for a shape mid-gesture (e.g. zero radius)', () => {
        const draft = draftFromParameters('circle', {
            center: { lat: 40, lng: -74 },
            radiusMeters: 0,
        });
        expect(draft.vertices).toBeNull();
        expect(isDraftPublishable(draft)).toBe(false);
    });

    it("surfaces the geometry validator's own reason for a degenerate shape", () => {
        const draft = draftFromParameters('rectangle', {
            corners: [
                { lat: 40, lng: -74 },
                { lat: 40, lng: -74 },
            ],
        });
        expect(draft.validation.ok).toBe(false);
        expect(typeof draft.validation.reason).toBe('string');
        expect(draft.validation.reason.length).toBeGreaterThan(0);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/game/boundaryDraft.test.js`
Expected: FAIL — `./boundaryDraft` does not exist.

- [ ] **Step 3: Implement**

Create `src/game/boundaryDraft.js`:

```javascript
/**
 * Pure helper that turns a drawing gesture's raw geometry into a
 * publishable draft: the canonical polygon plus validation, reusing the
 * shape math gameBoundary.js already has. No Firebase, no React, no map
 * library — BoundaryEditorModal.js owns *how* a shape got drawn (one
 * shared drag gesture per tool); this module only knows the shapeType
 * and shapeParameters that come out of that.
 *
 * `vertices` is populated whenever geometry could be computed at all,
 * even when `validation.ok` is false, so the editor can still show the
 * moderator the invalid shape they drew instead of nothing.
 */
const { shapeToPolygon, validateBoundaryShape } = require('./gameBoundary');

const NO_SHAPE_REASON = 'Draw a shape to begin.';

const emptyDraft = () => ({
    shapeType: null,
    shapeParameters: null,
    vertices: null,
    validation: { ok: false, reason: NO_SHAPE_REASON },
});

/**
 * @param {{shapeType: string, vertices: Array<{lat:number,lng:number}>, shapeParameters: object|null}|null|undefined} published
 */
const draftFromPublished = (published) => {
    if (!published) return emptyDraft();
    return {
        shapeType: published.shapeType,
        shapeParameters: published.shapeParameters ?? null,
        vertices: published.vertices,
        validation: { ok: true },
    };
};

/**
 * Freehand carries no reopenable shapeParameters — the vertices
 * themselves are the only record (publishGameBoundary requires
 * shapeParameters to be null for a freehand shape).
 *
 * @param {Array<{lat:number,lng:number}>} points raw stroke points, open or closed
 */
const draftFromFreehand = (points) => {
    if (!Array.isArray(points) || points.length === 0) {
        return {
            shapeType: 'freehand',
            shapeParameters: null,
            vertices: null,
            validation: { ok: false, reason: NO_SHAPE_REASON },
        };
    }
    const first = points[0];
    const last = points[points.length - 1];
    const closed =
        first.lat === last.lat && first.lng === last.lng ? points : [...points, { ...first }];
    return {
        shapeType: 'freehand',
        shapeParameters: null,
        vertices: closed,
        validation: validateBoundaryShape('freehand', closed),
    };
};

/**
 * Rectangle/circle/oval: shapeParameters describes the shape, vertices
 * are derived via shapeToPolygon. A gesture still in progress (e.g. a
 * circle with radiusMeters 0 right after the first click) throws out of
 * shapeToPolygon — that is "nothing to show yet," not a validation
 * error, so it is caught here rather than surfaced as one.
 *
 * @param {'rectangle'|'circle'|'oval'} shapeType
 * @param {object} shapeParameters
 */
const draftFromParameters = (shapeType, shapeParameters) => {
    let vertices = null;
    let validation = { ok: false, reason: NO_SHAPE_REASON };
    try {
        vertices = shapeToPolygon(shapeType, shapeParameters);
        validation = validateBoundaryShape(shapeType, vertices);
    } catch {
        // Mid-gesture; leave vertices null and validation as the default.
    }
    return { shapeType, shapeParameters, vertices, validation };
};

const isDraftPublishable = (draft) => Boolean(draft && draft.validation && draft.validation.ok);

module.exports = {
    emptyDraft,
    draftFromPublished,
    draftFromFreehand,
    draftFromParameters,
    isDraftPublishable,
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/game/boundaryDraft.test.js`
Expected: all pass.

- [ ] **Step 5: Format, lint, commit**

```bash
npx prettier --write src/game/boundaryDraft.js src/game/boundaryDraft.test.js
npx eslint src/game/boundaryDraft.js src/game/boundaryDraft.test.js --max-warnings=0
git add src/game/boundaryDraft.js src/game/boundaryDraft.test.js
git commit -m "Add a pure boundary-draft helper for the editor's drawing tools

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Callable wrapper files

**Files:**

- Create: `src/components/publishGameBoundary.js`
- Create: `src/components/disableGameBoundary.js`

**Interfaces:**

- Consumes: the `publishGameBoundary`/`disableGameBoundary` Cloud Functions (Phase 1, registered in `functions/index.js`).
- Produces: `publishGameBoundary({ roomId, expectedRevision, shapeType, vertices, shapeParameters })` → `Promise<{ revision: number }>`. `disableGameBoundary({ roomId, expectedRevision })` → `Promise<{ revision: number }>`. Both throw on rejection, carrying `.message`, same as every other callable wrapper in this repo.

This task is mechanical: two four-line files mirroring an existing pattern exactly. No dedicated test file — see Global Constraints for why; Task 5/6 mock these two files directly when testing `BoundaryEditorModal.js`, the same way `Lobby.test.jsx` mocks `dbCalls.js`.

- [ ] **Step 1: Create the publish wrapper**

Create `src/components/publishGameBoundary.js`:

```javascript
import { httpsCallable } from 'firebase/functions';
import { functions } from '../utils/firebase';

const publishGameBoundaryCallable = httpsCallable(functions, 'publishGameBoundary');

/**
 * Publishes a new game-area boundary for the room, host-only, with an
 * expected-revision check to reject a conflicting concurrent edit.
 *
 * @throws if the caller isn't the room's host, the geometry is invalid,
 *   the game has ended, or expectedRevision no longer matches — surfaces
 *   as a rejected promise carrying `.message`, same as executeKill.js.
 */
export const publishGameBoundary = async ({
    roomId,
    expectedRevision,
    shapeType,
    vertices,
    shapeParameters,
}) => {
    const { data } = await publishGameBoundaryCallable({
        roomId,
        expectedRevision,
        shapeType,
        vertices,
        shapeParameters,
    });
    return data;
};
```

- [ ] **Step 2: Create the disable wrapper**

Create `src/components/disableGameBoundary.js`:

```javascript
import { httpsCallable } from 'firebase/functions';
import { functions } from '../utils/firebase';

const disableGameBoundaryCallable = httpsCallable(functions, 'disableGameBoundary');

/**
 * Turns off enforcement of the room's current game-area boundary,
 * host-only. Does not clear the stored shape — a disabled boundary can
 * still be reopened and republished later.
 *
 * @throws if the caller isn't the room's host, there is no boundary to
 *   disable, or expectedRevision no longer matches.
 */
export const disableGameBoundary = async ({ roomId, expectedRevision }) => {
    const { data } = await disableGameBoundaryCallable({ roomId, expectedRevision });
    return data;
};
```

- [ ] **Step 3: Format, lint, commit**

```bash
npx prettier --write src/components/publishGameBoundary.js src/components/disableGameBoundary.js
npx eslint src/components/publishGameBoundary.js src/components/disableGameBoundary.js --max-warnings=0
git add src/components/publishGameBoundary.js src/components/disableGameBoundary.js
git commit -m "Add client wrappers for the publish/disable boundary callables

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Shared map renderer

**Files:**

- Create: `src/components/map_components/GameMap.js`
- Test: `src/components/map_components/GameMap.test.jsx`

**Interfaces:**

- Consumes: `react-map-gl`'s `Map`/`Source`/`Layer` (confirm exact export form against Task 1's recorded result before writing — adjust the import line if the installed version differs, and note the substitution in this task's report), `process.env.REACT_APP_MAPBOX_TOKEN`.
- Produces: `GameMap` component. Props: `boundaryVertices: Array<{lat,lng}>|null`, `fitTo: {longitude:number, latitude:number}|null`, `dragPan?: boolean` (default `true` — `BoundaryEditorModal.js` sets this `false` while a drawing tool other than Move Map is active, per spec: "Drawing mode captures the drawing gesture instead of panning the map"), `onMapLoad?: (map) => void`, `onMapError?: () => void`. No drawing tools live here — this component only renders a map and an optional boundary outline, and reports load/error events up; `BoundaryEditorModal.js` (Tasks 5-6) is the only thing that attaches drawing interaction, via the `map` instance handed to `onMapLoad`.

- [ ] **Step 1: Write the failing tests**

Create `src/components/map_components/GameMap.test.jsx`:

```jsx
/**
 * Layer 2 — React Testing Library, the map library fully mocked.
 * mapbox-gl needs a real WebGL canvas, which jsdom has no analog for;
 * see docs/testing.md's device-testing note for this feature. Every
 * test here exercises GameMap's own logic (token gating, style toggle,
 * boundary overlay shape, fit/jump-on-load, error fallback) against a
 * mock Map/Source/Layer, never a real map.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChakraProvider } from '@chakra-ui/react';
import GameMap from './GameMap';

const mockMapInstance = { fitBounds: jest.fn(), jumpTo: jest.fn() };
const mockShouldError = { current: false };

jest.mock('react-map-gl', () => {
    const ReactForMock = require('react');
    return {
        Map: (props) => {
            ReactForMock.useEffect(() => {
                if (mockShouldError.current) {
                    props.onError();
                } else {
                    props.onLoad({ target: mockMapInstance });
                }
                // eslint-disable-next-line react-hooks/exhaustive-deps
            }, []);
            return (
                <div
                    data-testid="mock-map"
                    data-style={props.mapStyle}
                    data-drag-pan={String(props.dragPan)}
                >
                    {props.children}
                </div>
            );
        },
        Source: ({ children, data }) => (
            <div data-testid="mock-source" data-geojson={JSON.stringify(data)}>
                {children}
            </div>
        ),
        Layer: () => null,
    };
});
jest.mock('mapbox-gl/dist/mapbox-gl.css', () => ({}), { virtual: true });

const RING = [
    { lat: 10, lng: 20 },
    { lat: 10, lng: 21 },
    { lat: 11, lng: 21 },
    { lat: 10, lng: 20 },
];

const renderMap = (props = {}) =>
    render(
        <ChakraProvider>
            <GameMap boundaryVertices={null} fitTo={null} {...props} />
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
    mockShouldError.current = false;
    process.env.REACT_APP_MAPBOX_TOKEN = 'test-token';
});

afterEach(() => {
    delete process.env.REACT_APP_MAPBOX_TOKEN;
});

describe('GameMap', () => {
    it('shows an unconfigured message instead of a map when no token is set', () => {
        delete process.env.REACT_APP_MAPBOX_TOKEN;
        renderMap();
        expect(screen.getByTestId('game-map-unconfigured')).toBeInTheDocument();
        expect(screen.queryByTestId('mock-map')).not.toBeInTheDocument();
    });

    it('renders no boundary overlay when boundaryVertices is null', () => {
        renderMap({ boundaryVertices: null });
        expect(screen.queryByTestId('mock-source')).not.toBeInTheDocument();
    });

    it('renders the boundary as a GeoJSON polygon with coordinate order flipped to [lng, lat]', () => {
        renderMap({ boundaryVertices: RING });
        const geojson = JSON.parse(screen.getByTestId('mock-source').getAttribute('data-geojson'));
        expect(geojson.geometry.coordinates[0][0]).toEqual([20, 10]);
    });

    it('fits the map to the boundary bounds on load when a boundary is given', () => {
        renderMap({ boundaryVertices: RING });
        expect(mockMapInstance.fitBounds).toHaveBeenCalledWith(
            [
                [20, 10],
                [21, 11],
            ],
            expect.objectContaining({ padding: 48 })
        );
    });

    it('jumps to fitTo on load when there is no boundary', () => {
        renderMap({ boundaryVertices: null, fitTo: { longitude: 5, latitude: 6 } });
        expect(mockMapInstance.jumpTo).toHaveBeenCalledWith(
            expect.objectContaining({ center: [5, 6] })
        );
    });

    it('calls onMapLoad with the underlying map instance', () => {
        const onMapLoad = jest.fn();
        renderMap({ onMapLoad });
        expect(onMapLoad).toHaveBeenCalledWith(mockMapInstance);
    });

    it('toggles between satellite and standard styles', () => {
        renderMap();
        expect(screen.getByTestId('mock-map')).toHaveAttribute(
            'data-style',
            'mapbox://styles/mapbox/satellite-streets-v12'
        );
        fireEvent.click(screen.getByRole('button', { name: 'Standard map' }));
        expect(screen.getByTestId('mock-map')).toHaveAttribute(
            'data-style',
            'mapbox://styles/mapbox/streets-v12'
        );
    });

    it('shows Retry and calls onMapError when the map fails to load, and Retry clears the error', () => {
        mockShouldError.current = true;
        const onMapError = jest.fn();
        renderMap({ onMapError });
        expect(onMapError).toHaveBeenCalled();
        expect(screen.getByTestId('game-map-error')).toBeInTheDocument();

        mockShouldError.current = false;
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(screen.getByTestId('mock-map')).toBeInTheDocument();
    });

    it('defaults dragPan to true, and passes false through once the caller sets it', () => {
        const { rerender } = renderMap();
        expect(screen.getByTestId('mock-map')).toHaveAttribute('data-drag-pan', 'true');

        rerender(
            <ChakraProvider>
                <GameMap boundaryVertices={null} fitTo={null} dragPan={false} />
            </ChakraProvider>
        );
        expect(screen.getByTestId('mock-map')).toHaveAttribute('data-drag-pan', 'false');
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/components/map_components/GameMap.test.jsx`
Expected: FAIL — `./GameMap` does not exist.

- [ ] **Step 3: Implement**

Create `src/components/map_components/GameMap.js`:

```jsx
import React, { useCallback, useRef, useState } from 'react';
import { Box, Button, Text } from '@chakra-ui/react';
import { Map, Source, Layer } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

// One provider, kept behind this component (docs/superpowers/specs/
// 2026-09-30-game-boundaries-design.md, "Open implementation choice").
// Nothing outside map_components/ should import 'react-map-gl' or
// 'mapbox-gl' directly.
const MAPBOX_TOKEN = process.env.REACT_APP_MAPBOX_TOKEN;

const SATELLITE_STYLE = 'mapbox://styles/mapbox/satellite-streets-v12';
const STANDARD_STYLE = 'mapbox://styles/mapbox/streets-v12';

// A workable default when there is no existing boundary and no fitTo —
// mid-latitude, zoomed out enough to orient from. The moderator can
// always pan/zoom manually from here (spec, "Moderator experience").
const FALLBACK_VIEW_STATE = { longitude: 0, latitude: 20, zoom: 1.5 };

const toGeoJson = (vertices) => ({
    type: 'Feature',
    geometry: {
        type: 'Polygon',
        // GeoJSON coordinate order is [lng, lat] — the opposite of this
        // app's {lat, lng} everywhere else.
        coordinates: [vertices.map((point) => [point.lng, point.lat])],
    },
    properties: {},
});

/**
 * Shared map renderer: satellite/standard Mapbox layers, an optional
 * boundary overlay, and (via react-map-gl's default AttributionControl,
 * left enabled) provider attribution. No drawing tools here — but it
 * does expose `dragPan` so a caller mid-gesture (BoundaryEditorModal)
 * can stop the map from panning out from under a drawing tool.
 */
const GameMap = ({ boundaryVertices, fitTo, dragPan = true, onMapLoad, onMapError }) => {
    const [styleMode, setStyleMode] = useState('satellite');
    const [hasError, setHasError] = useState(false);
    const hasFitRef = useRef(false);

    const handleLoad = useCallback(
        (event) => {
            const map = event.target;
            if (!hasFitRef.current && boundaryVertices && boundaryVertices.length > 0) {
                const lats = boundaryVertices.map((p) => p.lat);
                const lngs = boundaryVertices.map((p) => p.lng);
                map.fitBounds(
                    [
                        [Math.min(...lngs), Math.min(...lats)],
                        [Math.max(...lngs), Math.max(...lats)],
                    ],
                    { padding: 48, duration: 0 }
                );
                hasFitRef.current = true;
            } else if (!hasFitRef.current && fitTo) {
                map.jumpTo({ center: [fitTo.longitude, fitTo.latitude], zoom: 15 });
                hasFitRef.current = true;
            }
            if (onMapLoad) onMapLoad(map);
        },
        [boundaryVertices, fitTo, onMapLoad]
    );

    const handleError = useCallback(() => {
        setHasError(true);
        if (onMapError) onMapError();
    }, [onMapError]);

    const handleRetry = () => {
        hasFitRef.current = false;
        setHasError(false);
    };

    if (!MAPBOX_TOKEN) {
        return (
            <Box
                data-testid="game-map-unconfigured"
                h="100%"
                w="100%"
                bg="gray.800"
                color="white"
                display="flex"
                alignItems="center"
                justifyContent="center"
                p="24px"
                textAlign="center"
            >
                <Text>
                    Map is not configured. Ask whoever runs this app to set REACT_APP_MAPBOX_TOKEN.
                </Text>
            </Box>
        );
    }

    if (hasError) {
        return (
            <Box
                data-testid="game-map-error"
                h="100%"
                w="100%"
                bg="gray.800"
                color="white"
                display="flex"
                flexDirection="column"
                alignItems="center"
                justifyContent="center"
                gap="12px"
            >
                <Text>Map failed to load.</Text>
                <Button onClick={handleRetry}>Retry</Button>
            </Box>
        );
    }

    return (
        <Box h="100%" w="100%" position="relative" data-testid="game-map">
            <Map
                mapboxAccessToken={MAPBOX_TOKEN}
                initialViewState={FALLBACK_VIEW_STATE}
                mapStyle={styleMode === 'satellite' ? SATELLITE_STYLE : STANDARD_STYLE}
                dragPan={dragPan}
                onLoad={handleLoad}
                onError={handleError}
                reuseMaps
            >
                {boundaryVertices && boundaryVertices.length > 0 && (
                    <Source id="game-boundary" type="geojson" data={toGeoJson(boundaryVertices)}>
                        <Layer
                            id="game-boundary-fill"
                            type="fill"
                            paint={{ 'fill-color': '#38B2AC', 'fill-opacity': 0.2 }}
                        />
                        <Layer
                            id="game-boundary-line"
                            type="line"
                            paint={{ 'line-color': '#38B2AC', 'line-width': 3 }}
                        />
                    </Source>
                )}
            </Map>
            <Button
                position="absolute"
                top="12px"
                right="12px"
                size="sm"
                onClick={() =>
                    setStyleMode((mode) => (mode === 'satellite' ? 'standard' : 'satellite'))
                }
            >
                {styleMode === 'satellite' ? 'Standard map' : 'Satellite'}
            </Button>
        </Box>
    );
};

export default GameMap;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/components/map_components/GameMap.test.jsx`
Expected: all pass.

- [ ] **Step 5: Format, lint, commit**

```bash
npx prettier --write src/components/map_components/GameMap.js src/components/map_components/GameMap.test.jsx
npx eslint src/components/map_components/GameMap.js src/components/map_components/GameMap.test.jsx --max-warnings=0
git add src/components/map_components/GameMap.js src/components/map_components/GameMap.test.jsx
git commit -m "Add GameMap, the shared Mapbox renderer

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Boundary editor — drawing tools

**Files:**

- Create: `src/components/map_components/BoundaryEditorModal.js`
- Test: `src/components/map_components/BoundaryEditorModal.test.jsx`

**Interfaces:**

- Consumes: `GameMap` (Task 4); `emptyDraft`, `draftFromPublished`, `draftFromFreehand`, `draftFromParameters`, `isDraftPublishable` (Task 2); `projectToMeters` (Phase 1, Task 2).
- Produces: `BoundaryEditorModal` component. Props so far: `isOpen: boolean`, `onClose: () => void`, `currentBoundary: {shapeType, vertices, shapeParameters, enabled, revision}|undefined`. This task delivers drawing, undo, and clear — Cancel/Close discards the draft and calls `onClose()`. **No Publish/Disable buttons yet** — Task 6 adds them to this same file. That split is deliberate: this task's deliverable ("open the editor, draw with all four tools, undo, clear, close discards") is independently testable and already useful on its own.

All four tools share one interaction: **drag** from a start point to an end point. mapbox-gl's own `'mousedown'`/`'mousemove'`/`'mouseup'` map events each carry `event.lngLat` directly (no manual pixel-to-geo conversion needed) and `event.point` (pixel coordinates, used only to decimate a fast `mousemove` stream). Rectangle uses the two endpoints as opposite corners; circle uses the start as center and the live drag distance (via `projectToMeters`) as the radius; oval uses the start as center and the drag's separate east/west and north/south distances as its two radii; freehand collects every decimated point along the drag into a stroke. This is why the spec's "Rectangle uses opposite corners; circle uses a center and radius; oval uses a center and separate horizontal/vertical radii" maps naturally onto one gesture instead of needing a different interaction per tool.

- [ ] **Step 1: Write the failing tests**

Create `src/components/map_components/BoundaryEditorModal.test.jsx`:

```jsx
/**
 * Layer 2 — React Testing Library. GameMap is replaced with a thin mock
 * that exposes the real `map` instance handed to onMapLoad (a fake
 * mapbox-gl Map whose `on`/`off` just record handlers by event name),
 * so these tests exercise BoundaryEditorModal's own drawing logic, not
 * GameMap's (GameMap.test.jsx already covers that).
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ChakraProvider } from '@chakra-ui/react';
import BoundaryEditorModal from './BoundaryEditorModal';

let lastProps;
const mapEventHandlers = {};
const fakeMap = {
    on: (event, handler) => {
        mapEventHandlers[event] = handler;
    },
    off: (event) => {
        delete mapEventHandlers[event];
    },
};

jest.mock('./GameMap', () => (props) => {
    lastProps = props;
    const React = require('react');
    React.useEffect(() => {
        if (props.onMapLoad) props.onMapLoad(fakeMap);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.onMapLoad]);
    return <div data-testid="mock-game-map" />;
});

const renderModal = (props = {}) =>
    render(
        <ChakraProvider>
            <BoundaryEditorModal
                isOpen
                onClose={jest.fn()}
                currentBoundary={undefined}
                {...props}
            />
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mapEventHandlers).forEach((key) => delete mapEventHandlers[key]);
});

// Fake lng/lat -> pixel mapping, just distinct enough per point that the
// drag-decimation check (6px minimum) never swallows these test moves.
const pointFor = (lat, lng) => ({ x: (lng + 74) * 100000, y: (lat - 40) * 100000 });

const dragMap = (from, to) => {
    act(() => {
        mapEventHandlers.mousedown({ lngLat: from, point: pointFor(from.lat, from.lng) });
        mapEventHandlers.mousemove({ lngLat: to, point: pointFor(to.lat, to.lng) });
        mapEventHandlers.mouseup({ lngLat: to, point: pointFor(to.lat, to.lng) });
    });
};

describe('BoundaryEditorModal — drawing tools', () => {
    it('starts with Publish absent until a shape exists (Task 6 adds Publish)', () => {
        renderModal();
        expect(screen.queryByRole('button', { name: /publish/i })).not.toBeInTheDocument();
    });

    it('reopens an existing boundary with its exact shapeType and shapeParameters, fed to GameMap as the current draft', () => {
        const currentBoundary = {
            enabled: true,
            revision: 3,
            shapeType: 'circle',
            shapeParameters: { center: { lat: 40, lng: -74 }, radiusMeters: 500 },
            vertices: [{ lat: 40.001, lng: -74 }],
        };
        renderModal({ currentBoundary });
        expect(lastProps.boundaryVertices).toEqual(currentBoundary.vertices);
    });

    it('draws a rectangle by dragging from one corner to the other', () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Rectangle' }));
        dragMap({ lat: 40, lng: -74 }, { lat: 40.01, lng: -73.99 });
        expect(lastProps.boundaryVertices).not.toBeNull();
        expect(lastProps.boundaryVertices.length).toBeGreaterThan(0);
    });

    it('draws a circle centered on the drag start, sized by the drag distance', () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Circle' }));

        // A very short drag leaves a near-zero radius — not a publishable shape yet.
        dragMap({ lat: 40, lng: -74 }, { lat: 40.00001, lng: -74 });
        expect(screen.queryByRole('button', { name: /publish/i })).not.toBeInTheDocument();

        // A real drag produces a real, publishable circle.
        dragMap({ lat: 40, lng: -74 }, { lat: 40.01, lng: -74 });
        expect(lastProps.boundaryVertices).not.toBeNull();
    });

    it('draws a freehand stroke as a trail of dragged points', () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Freehand' }));
        act(() => {
            mapEventHandlers.mousedown({ lngLat: { lat: 40, lng: -74 }, point: pointFor(40, -74) });
            mapEventHandlers.mousemove({
                lngLat: { lat: 40.001, lng: -74 },
                point: pointFor(40.001, -74),
            });
            mapEventHandlers.mousemove({
                lngLat: { lat: 40.001, lng: -73.999 },
                point: pointFor(40.001, -73.999),
            });
            mapEventHandlers.mouseup({
                lngLat: { lat: 40, lng: -73.999 },
                point: pointFor(40, -73.999),
            });
        });
        expect(lastProps.boundaryVertices.length).toBeGreaterThanOrEqual(4);
    });

    it("Clear Draft removes the shape and detaches the active tool's listeners", () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Circle' }));
        dragMap({ lat: 40, lng: -74 }, { lat: 40.01, lng: -74 });
        expect(lastProps.boundaryVertices).not.toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Clear Draft' }));
        expect(lastProps.boundaryVertices).toBeNull();
        expect(mapEventHandlers.mousedown).toBeUndefined();
    });

    it("switching tools tears down the previous tool's listeners before the new one attaches", () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Circle' }));
        const circleHandler = mapEventHandlers.mousedown;
        fireEvent.click(screen.getByRole('button', { name: 'Rectangle' }));
        expect(mapEventHandlers.mousedown).not.toBe(circleHandler);
    });

    it('Undo restores the draft from before the last completed drag', () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Circle' }));
        dragMap({ lat: 40, lng: -74 }, { lat: 40.01, lng: -74 });
        const afterFirstDrag = lastProps.boundaryVertices;

        dragMap({ lat: 41, lng: -75 }, { lat: 41.02, lng: -75 });
        expect(lastProps.boundaryVertices).not.toEqual(afterFirstDrag);

        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        expect(lastProps.boundaryVertices).toEqual(afterFirstDrag);
    });

    it('Move Map tool attaches no drag listeners, leaving normal map navigation alone', () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Circle' }));
        expect(mapEventHandlers.mousedown).toBeDefined();
        fireEvent.click(screen.getByRole('button', { name: 'Move Map' }));
        expect(mapEventHandlers.mousedown).toBeUndefined();
    });

    it('disables map panning while any drawing tool is active, and restores it for Move Map', () => {
        renderModal();
        expect(lastProps.dragPan).toBe(true);

        fireEvent.click(screen.getByRole('button', { name: 'Circle' }));
        expect(lastProps.dragPan).toBe(false);

        fireEvent.click(screen.getByRole('button', { name: 'Move Map' }));
        expect(lastProps.dragPan).toBe(true);
    });

    it('Cancel discards the draft and calls onClose without publishing', () => {
        const onClose = jest.fn();
        renderModal({ onClose });
        fireEvent.click(screen.getByRole('button', { name: 'Circle' }));
        dragMap({ lat: 40, lng: -74 }, { lat: 40.01, lng: -74 });

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onClose).toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/components/map_components/BoundaryEditorModal.test.jsx`
Expected: FAIL — `./BoundaryEditorModal` does not exist.

- [ ] **Step 3: Implement**

Create `src/components/map_components/BoundaryEditorModal.js`:

```jsx
import React, { useEffect, useRef, useState } from 'react';
import {
    Button,
    HStack,
    Modal,
    ModalBody,
    ModalContent,
    ModalFooter,
    ModalHeader,
    ModalOverlay,
    Text,
} from '@chakra-ui/react';
import GameMap from './GameMap';
import {
    emptyDraft,
    draftFromPublished,
    draftFromFreehand,
    draftFromParameters,
    isDraftPublishable,
} from '../../game/boundaryDraft';
import { projectToMeters } from '../../game/gameBoundary';

const TOOLS = ['move', 'freehand', 'rectangle', 'circle', 'oval'];

// Minimum pixel movement between accepted mousemove samples, so a fast
// drag doesn't flood the draft with near-duplicate points (freehand) or
// near-identical radius recomputations (circle/oval/rectangle).
const MIN_DRAG_PIXEL_DISTANCE = 6;

/**
 * Attaches one drag gesture (mousedown -> decimated mousemove* ->
 * mouseup) to the map, shared by all four drawing tools — each tool
 * only supplies what a start/move/end lngLat means for its own shape.
 */
const attachDragTool = (map, { onStart, onMove, onEnd }) => {
    let isDragging = false;
    let lastPoint = null;
    const handleDown = (event) => {
        isDragging = true;
        lastPoint = event.point;
        onStart(event.lngLat);
    };
    const handleMove = (event) => {
        if (!isDragging) return;
        if (
            lastPoint &&
            Math.hypot(event.point.x - lastPoint.x, event.point.y - lastPoint.y) <
                MIN_DRAG_PIXEL_DISTANCE
        ) {
            return;
        }
        lastPoint = event.point;
        onMove(event.lngLat);
    };
    const handleUp = (event) => {
        if (!isDragging) return;
        isDragging = false;
        onEnd(event.lngLat);
    };
    map.on('mousedown', handleDown);
    map.on('mousemove', handleMove);
    map.on('mouseup', handleUp);
};

/**
 * Local drawing surface for the room's game-area boundary. Draws with
 * four tools against GameMap's boundary overlay, keeps an undo history
 * of drafts, and lets the moderator Clear Draft or Cancel. Does not
 * publish anything yet (see Task 6, which adds Publish/Disable to this
 * same component).
 */
const BoundaryEditorModal = ({ isOpen, onClose, currentBoundary }) => {
    const [draft, setDraft] = useState(() => draftFromPublished(currentBoundary));
    const [history, setHistory] = useState([]);
    const [activeTool, setActiveTool] = useState('move');
    const [mapError, setMapError] = useState(false);
    const mapRef = useRef(null);

    // Reopening always starts from the latest published state, never a
    // previously abandoned draft (Review Focus: reopen fidelity).
    useEffect(() => {
        if (isOpen) {
            setDraft(draftFromPublished(currentBoundary));
            setHistory([]);
            setActiveTool('move');
            setMapError(false);
        }
    }, [isOpen, currentBoundary]);

    const commitDraft = (nextDraft) => {
        setHistory((prev) => [...prev, draft]);
        setDraft(nextDraft);
    };

    const handleUndo = () => {
        setHistory((prev) => {
            if (prev.length === 0) return prev;
            setDraft(prev[prev.length - 1]);
            return prev.slice(0, -1);
        });
    };

    const handleClearDraft = () => {
        commitDraft(emptyDraft());
    };

    // --- tool-specific drag interaction -------------------------------

    const detachToolListeners = () => {
        const map = mapRef.current;
        if (!map) return;
        map.off('mousedown');
        map.off('mousemove');
        map.off('mouseup');
    };

    const attachRectangleTool = (map) => {
        let cornerA = null;
        attachDragTool(map, {
            onStart: (lngLat) => {
                cornerA = lngLat;
                setDraft(draftFromParameters('rectangle', { corners: [cornerA, lngLat] }));
            },
            onMove: (lngLat) => {
                setDraft(draftFromParameters('rectangle', { corners: [cornerA, lngLat] }));
            },
            onEnd: (lngLat) => {
                commitDraft(draftFromParameters('rectangle', { corners: [cornerA, lngLat] }));
            },
        });
    };

    const attachCircleTool = (map) => {
        let center = null;
        const radiusMetersTo = (lngLat) => {
            const { x, y } = projectToMeters(lngLat, center);
            return Math.hypot(x, y);
        };
        attachDragTool(map, {
            onStart: (lngLat) => {
                center = lngLat;
                setDraft(draftFromParameters('circle', { center, radiusMeters: 0 }));
            },
            onMove: (lngLat) => {
                setDraft(
                    draftFromParameters('circle', { center, radiusMeters: radiusMetersTo(lngLat) })
                );
            },
            onEnd: (lngLat) => {
                commitDraft(
                    draftFromParameters('circle', { center, radiusMeters: radiusMetersTo(lngLat) })
                );
            },
        });
    };

    const attachOvalTool = (map) => {
        let center = null;
        const radiiMetersTo = (lngLat) => {
            const { x, y } = projectToMeters(lngLat, center);
            return { radiusXMeters: Math.abs(x), radiusYMeters: Math.abs(y) };
        };
        attachDragTool(map, {
            onStart: (lngLat) => {
                center = lngLat;
                setDraft(
                    draftFromParameters('oval', { center, radiusXMeters: 0, radiusYMeters: 0 })
                );
            },
            onMove: (lngLat) => {
                setDraft(draftFromParameters('oval', { center, ...radiiMetersTo(lngLat) }));
            },
            onEnd: (lngLat) => {
                commitDraft(draftFromParameters('oval', { center, ...radiiMetersTo(lngLat) }));
            },
        });
    };

    const attachFreehandTool = (map) => {
        let points = [];
        attachDragTool(map, {
            onStart: (lngLat) => {
                points = [lngLat];
                setDraft(draftFromFreehand(points));
            },
            onMove: (lngLat) => {
                points = [...points, lngLat];
                setDraft(draftFromFreehand(points));
            },
            onEnd: (lngLat) => {
                points = [...points, lngLat];
                commitDraft(draftFromFreehand(points));
            },
        });
    };

    const applyTool = (tool, map) => {
        detachToolListeners();
        if (!map) return;
        if (tool === 'rectangle') attachRectangleTool(map);
        else if (tool === 'circle') attachCircleTool(map);
        else if (tool === 'oval') attachOvalTool(map);
        else if (tool === 'freehand') attachFreehandTool(map);
        // 'move': no listeners — normal map navigation.
    };

    const handleToolChange = (tool) => {
        setActiveTool(tool);
        applyTool(tool, mapRef.current);
    };

    const handleMapLoad = (map) => {
        mapRef.current = map;
        applyTool(activeTool, map);
    };

    const handleCancel = () => {
        detachToolListeners();
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={handleCancel} size={{ base: 'full', md: '6xl' }}>
            <ModalOverlay />
            <ModalContent bg="#202030" h={{ base: '100%', md: '85vh' }}>
                <ModalHeader color="#ffffff">Game Area</ModalHeader>
                <ModalBody display="flex" flexDirection="column" gap="8px">
                    <HStack wrap="wrap">
                        {TOOLS.map((tool) => (
                            <Button
                                key={tool}
                                size="sm"
                                colorScheme={activeTool === tool ? 'teal' : 'gray'}
                                onClick={() => handleToolChange(tool)}
                            >
                                {tool === 'move'
                                    ? 'Move Map'
                                    : tool.charAt(0).toUpperCase() + tool.slice(1)}
                            </Button>
                        ))}
                        <Button size="sm" onClick={handleUndo} isDisabled={history.length === 0}>
                            Undo
                        </Button>
                        <Button size="sm" onClick={handleClearDraft}>
                            Clear Draft
                        </Button>
                    </HStack>
                    {!draft.validation.ok && draft.vertices && (
                        <Text color="orange.300" fontSize="sm">
                            {draft.validation.reason}
                        </Text>
                    )}
                    <GameMap
                        boundaryVertices={draft.vertices}
                        fitTo={null}
                        dragPan={activeTool === 'move'}
                        onMapLoad={handleMapLoad}
                        onMapError={() => setMapError(true)}
                    />
                </ModalBody>
                <ModalFooter>
                    <Button onClick={handleCancel}>Cancel</Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
};

export default BoundaryEditorModal;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/components/map_components/BoundaryEditorModal.test.jsx`
Expected: all pass.

- [ ] **Step 5: Format, lint, commit**

```bash
npx prettier --write src/components/map_components/BoundaryEditorModal.js src/components/map_components/BoundaryEditorModal.test.jsx
npx eslint src/components/map_components/BoundaryEditorModal.js src/components/map_components/BoundaryEditorModal.test.jsx --max-warnings=0
git add src/components/map_components/BoundaryEditorModal.js src/components/map_components/BoundaryEditorModal.test.jsx
git commit -m "Add BoundaryEditorModal drawing tools (no publish yet)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Boundary editor — publish and disable

**Files:**

- Modify: `src/components/map_components/BoundaryEditorModal.js` (Task 5)
- Modify: `src/components/map_components/BoundaryEditorModal.test.jsx` (Task 5)

**Interfaces:**

- Consumes: `publishGameBoundary`, `disableGameBoundary` (Task 3); `isDraftPublishable` (Task 2, already imported in Task 5).
- Produces: `BoundaryEditorModal` additionally takes `roomID: string`. Adds a `Publish Boundary`/`Publish Changes` button (label depends on whether `currentBoundary` already exists) and, when `currentBoundary?.enabled`, a `Disable Boundary` button.

- [ ] **Step 1: Write the failing tests**

Add to `src/components/map_components/BoundaryEditorModal.test.jsx`, alongside the existing mocks:

```jsx
jest.mock('../publishGameBoundary', () => ({ publishGameBoundary: jest.fn() }));
jest.mock('../disableGameBoundary', () => ({ disableGameBoundary: jest.fn() }));

import { publishGameBoundary } from '../publishGameBoundary';
import { disableGameBoundary } from '../disableGameBoundary';
```

and this new `describe` block:

```jsx
describe('BoundaryEditorModal — publish and disable', () => {
    it('Publish Boundary is disabled until the draft is valid, and calls the callable with the draft once it is', async () => {
        publishGameBoundary.mockResolvedValue({ revision: 1 });
        const onClose = jest.fn();
        renderModal({ roomID: 'room-a', onClose });

        expect(screen.queryByRole('button', { name: 'Publish Boundary' })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Circle' }));
        dragMap({ lat: 40, lng: -74 }, { lat: 40.01, lng: -74 });

        const publishButton = screen.getByRole('button', { name: 'Publish Boundary' });
        expect(publishButton).toBeEnabled();

        await act(async () => {
            fireEvent.click(publishButton);
        });

        expect(publishGameBoundary).toHaveBeenCalledWith(
            expect.objectContaining({ roomId: 'room-a', expectedRevision: 0, shapeType: 'circle' })
        );
        expect(onClose).toHaveBeenCalled();
    });

    it('labels the button Publish Changes, and uses the current revision, when a boundary already exists', () => {
        renderModal({
            roomID: 'room-a',
            currentBoundary: {
                enabled: true,
                revision: 4,
                shapeType: 'circle',
                shapeParameters: { center: { lat: 40, lng: -74 }, radiusMeters: 100 },
                vertices: [{ lat: 40.001, lng: -74 }],
            },
        });
        expect(screen.getByRole('button', { name: 'Publish Changes' })).toBeEnabled();
    });

    it('a revision conflict keeps the draft open and shows the conflict instead of closing', async () => {
        publishGameBoundary.mockRejectedValue(new Error('revision_conflict'));
        const onClose = jest.fn();
        renderModal({ roomID: 'room-a', onClose });
        fireEvent.click(screen.getByRole('button', { name: 'Circle' }));
        dragMap({ lat: 40, lng: -74 }, { lat: 40.01, lng: -74 });

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Publish Boundary' }));
        });

        expect(onClose).not.toHaveBeenCalled();
        expect(lastProps.boundaryVertices).not.toBeNull();
        expect(screen.getByText(/someone else published a change/i)).toBeInTheDocument();
    });

    it('Disable Boundary is shown only when the current boundary is enabled, and calls the callable', async () => {
        disableGameBoundary.mockResolvedValue({ revision: 5 });
        const onClose = jest.fn();
        renderModal({
            roomID: 'room-a',
            onClose,
            currentBoundary: { enabled: true, revision: 4, shapeType: 'circle', vertices: [] },
        });

        const disableButton = screen.getByRole('button', { name: 'Disable Boundary' });
        await act(async () => {
            fireEvent.click(disableButton);
        });

        expect(disableGameBoundary).toHaveBeenCalledWith({ roomId: 'room-a', expectedRevision: 4 });
        expect(onClose).toHaveBeenCalled();
    });

    it('does not show Disable Boundary when there is no current boundary', () => {
        renderModal({ roomID: 'room-a', currentBoundary: undefined });
        expect(screen.queryByRole('button', { name: 'Disable Boundary' })).not.toBeInTheDocument();
    });

    it('hides Publish once the map fails to load, even with an otherwise-valid draft', () => {
        renderModal({ roomID: 'room-a' });
        fireEvent.click(screen.getByRole('button', { name: 'Circle' }));
        dragMap({ lat: 40, lng: -74 }, { lat: 40.01, lng: -74 });
        expect(screen.getByRole('button', { name: 'Publish Boundary' })).toBeInTheDocument();

        act(() => {
            lastProps.onMapError();
        });
        expect(screen.queryByRole('button', { name: 'Publish Boundary' })).not.toBeInTheDocument();
    });

    it('Cancel after drawing discards the draft; reopening starts from the last published boundary, not the abandoned draft', () => {
        const { rerender } = renderModal({ roomID: 'room-a', isOpen: true, onClose: jest.fn() });
        fireEvent.click(screen.getByRole('button', { name: 'Circle' }));
        dragMap({ lat: 40, lng: -74 }, { lat: 40.01, lng: -74 });
        expect(lastProps.boundaryVertices).not.toBeNull();

        rerender(
            <ChakraProvider>
                <BoundaryEditorModal
                    isOpen={false}
                    onClose={jest.fn()}
                    roomID="room-a"
                    currentBoundary={undefined}
                />
            </ChakraProvider>
        );
        rerender(
            <ChakraProvider>
                <BoundaryEditorModal
                    isOpen
                    onClose={jest.fn()}
                    roomID="room-a"
                    currentBoundary={undefined}
                />
            </ChakraProvider>
        );
        expect(lastProps.boundaryVertices).toBeNull();
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/components/map_components/BoundaryEditorModal.test.jsx`
Expected: FAIL — no `Publish Boundary`/`Disable Boundary` buttons exist yet.

- [ ] **Step 3: Implement**

In `src/components/map_components/BoundaryEditorModal.js`:

Add imports:

```javascript
import { publishGameBoundary } from '../publishGameBoundary';
import { disableGameBoundary } from '../disableGameBoundary';
```

Add `roomID` to the component's props, and inside the component body add:

```javascript
const [isPublishing, setIsPublishing] = useState(false);
const [isDisabling, setIsDisabling] = useState(false);
const [conflictMessage, setConflictMessage] = useState(null);

const expectedRevision = currentBoundary?.revision ?? 0;

const handlePublish = async () => {
    setConflictMessage(null);
    setIsPublishing(true);
    try {
        await publishGameBoundary({
            roomId: roomID,
            expectedRevision,
            shapeType: draft.shapeType,
            vertices: draft.vertices,
            shapeParameters: draft.shapeParameters,
        });
        onClose();
    } catch (error) {
        if (error.message === 'revision_conflict') {
            setConflictMessage(
                'Someone else published a change to this game area. Close and reopen to see the current one before trying again.'
            );
        } else {
            setConflictMessage(error.message);
        }
    } finally {
        setIsPublishing(false);
    }
};

const handleDisable = async () => {
    setIsDisabling(true);
    try {
        await disableGameBoundary({ roomId: roomID, expectedRevision });
        onClose();
    } catch (error) {
        setConflictMessage(error.message);
    } finally {
        setIsDisabling(false);
    }
};
```

Also clear `conflictMessage` in the existing reopen `useEffect` (the one that resets `draft`/`history`/`activeTool` when `isOpen` becomes true), so a stale conflict from a previous open doesn't linger.

Add to the toolbar's `HStack` (after Clear Draft) and the footer:

```jsx
{
    isDraftPublishable(draft) && !mapError && (
        <Button colorScheme="teal" isLoading={isPublishing} onClick={handlePublish}>
            {currentBoundary ? 'Publish Changes' : 'Publish Boundary'}
        </Button>
    );
}
```

The `!mapError` guard is the spec's "block new publication if the moderator cannot review it" (Error handling) — `mapError` is the state Task 5 already wired to `GameMap`'s `onMapError`.

and, in `ModalFooter`, before the existing Cancel button:

```jsx
{
    currentBoundary?.enabled && (
        <Button colorScheme="red" isLoading={isDisabling} onClick={handleDisable} mr="8px">
            Disable Boundary
        </Button>
    );
}
```

and render `conflictMessage` (when set) the same way the existing validation-reason `<Text>` is rendered, just above it:

```jsx
{
    conflictMessage && (
        <Text color="red.300" fontSize="sm">
            {conflictMessage}
        </Text>
    );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/components/map_components/BoundaryEditorModal.test.jsx`
Expected: all pass.

- [ ] **Step 5: Format, lint, commit**

```bash
npx prettier --write src/components/map_components/BoundaryEditorModal.js src/components/map_components/BoundaryEditorModal.test.jsx
npx eslint src/components/map_components/BoundaryEditorModal.js src/components/map_components/BoundaryEditorModal.test.jsx --max-warnings=0
git add src/components/map_components/BoundaryEditorModal.js src/components/map_components/BoundaryEditorModal.test.jsx
git commit -m "Add publish/disable actions to BoundaryEditorModal

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Entry point in Lobby and GameMasterView

**Files:**

- Create: `src/components/map_components/GameBoundaryButton.js`
- Test: `src/components/map_components/GameBoundaryButton.test.jsx`
- Modify: `src/pages/Lobby.js`
- Modify: `src/pages/Lobby.test.jsx`
- Modify: `src/components/header_components/HeaderExecution.js`
- Modify: `src/pages/GameMasterView.js`
- Modify: `src/pages/GameMasterView.test.jsx`

**Interfaces:**

- Consumes: `BoundaryEditorModal` (Tasks 5-6), `fetchRoomReferenceForRoom` (existing, `dbCalls.js`).
- Produces: `GameBoundaryButton` component, props `{ roomID: string, gameBoundary: object|undefined }` — self-contained, owns its own open/closed state, same shape as `AbandonRoomButton.js`.

- [ ] **Step 1: Write the failing test for the button**

Create `src/components/map_components/GameBoundaryButton.test.jsx`:

```jsx
/**
 * Layer 2 — React Testing Library. BoundaryEditorModal is stubbed (it
 * has its own thorough tests) so this stays focused on the button's own
 * job: opening/closing the modal and picking its own label.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChakraProvider } from '@chakra-ui/react';
import GameBoundaryButton from './GameBoundaryButton';

jest.mock(
    './BoundaryEditorModal',
    () =>
        ({ isOpen, onClose }) =>
            isOpen ? (
                <div data-testid="mock-boundary-editor">
                    <button onClick={onClose}>mock-close</button>
                </div>
            ) : null
);

const renderButton = (props = {}) =>
    render(
        <ChakraProvider>
            <GameBoundaryButton roomID="room-a" gameBoundary={undefined} {...props} />
        </ChakraProvider>
    );

describe('GameBoundaryButton', () => {
    it('shows "Set Game Area" when no boundary has been published', () => {
        renderButton({ gameBoundary: undefined });
        expect(screen.getByRole('button', { name: 'Set Game Area' })).toBeInTheDocument();
    });

    it('shows "Edit Game Area" once a boundary exists, even if disabled', () => {
        renderButton({ gameBoundary: { enabled: false, revision: 2 } });
        expect(screen.getByRole('button', { name: 'Edit Game Area' })).toBeInTheDocument();
    });

    it('opens the editor on click and closes it when the editor closes', () => {
        renderButton();
        fireEvent.click(screen.getByRole('button', { name: 'Set Game Area' }));
        expect(screen.getByTestId('mock-boundary-editor')).toBeInTheDocument();

        fireEvent.click(screen.getByText('mock-close'));
        expect(screen.queryByTestId('mock-boundary-editor')).not.toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/components/map_components/GameBoundaryButton.test.jsx`
Expected: FAIL — `./GameBoundaryButton` does not exist.

- [ ] **Step 3: Implement the button**

Create `src/components/map_components/GameBoundaryButton.js`:

```jsx
import React, { useState } from 'react';
import { Button } from '@chakra-ui/react';
import BoundaryEditorModal from './BoundaryEditorModal';

/**
 * Entry point for the moderator's game-area editor — self-contained,
 * same shape as AbandonRoomButton.js: owns its own open/closed state,
 * takes just the props it needs.
 */
const GameBoundaryButton = ({ roomID, gameBoundary }) => {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <>
            <Button
                colorScheme="teal"
                variant="outline"
                borderRadius="3xl"
                onClick={() => setIsOpen(true)}
            >
                {gameBoundary ? 'Edit Game Area' : 'Set Game Area'}
            </Button>
            <BoundaryEditorModal
                isOpen={isOpen}
                onClose={() => setIsOpen(false)}
                roomID={roomID}
                currentBoundary={gameBoundary}
            />
        </>
    );
};

export default GameBoundaryButton;
```

- [ ] **Step 4: Run to verify the button test passes**

Run: `npx jest src/components/map_components/GameBoundaryButton.test.jsx`
Expected: pass.

- [ ] **Step 5: Wire a live `gameBoundary` subscription and the button into Lobby.js**

Read `src/pages/Lobby.js` in full (it has no room-level subscription today, only the players query). Add, mirroring the existing players-query `useEffect` exactly in structure:

```javascript
import { fetchRoomReferenceForRoom } from '../components/firebase_calls/dbCalls';
import GameBoundaryButton from '../components/map_components/GameBoundaryButton';
```

```javascript
const [gameBoundary, setGameBoundary] = useState(undefined);

useEffect(() => {
    if (!roomID) return undefined;
    const roomRef = fetchRoomReferenceForRoom(roomID);
    const unsubscribe = onSnapshot(roomRef, (snapshot) => {
        setGameBoundary(snapshot.data()?.gameBoundary);
    });
    return () => unsubscribe();
}, [roomID]);
```

Add `<GameBoundaryButton roomID={roomID} gameBoundary={gameBoundary} />` next to the existing `<AbandonRoomButton roomID={roomID} />` in the same `Flex` row.

- [ ] **Step 6: Write the failing Lobby test for the new button**

In `src/pages/Lobby.test.jsx`, add `fetchRoomReferenceForRoom: jest.fn(() => 'room-ref')` to the existing `jest.mock('../components/firebase_calls/dbCalls', ...)` factory, and extend the shared `onSnapshot.mockImplementation` used by the existing tests so it also answers a room-doc subscription — the simplest correct way is to branch on which query/ref was passed:

```javascript
onSnapshot.mockImplementation((queryOrRef, onNext) => {
    if (queryOrRef === 'room-ref') {
        onNext({ data: () => ({ gameBoundary: undefined }) });
    } else {
        onNext({ docs: [] });
    }
    return () => {};
});
```

Apply that same branching update to every existing test in the file that currently does `onSnapshot.mockImplementation((query, onNext) => { onNext({ docs: ... }); return () => {}; })`, so the room-doc subscription this task adds doesn't leave `gameBoundary` stuck at its initial `undefined` in a way that breaks nothing today, but is explicit. Then add:

```javascript
it('shows Set Game Area, and Edit Game Area once a boundary exists', () => {
    onSnapshot.mockImplementation((queryOrRef, onNext) => {
        if (queryOrRef === 'room-ref') {
            onNext({ data: () => ({ gameBoundary: { enabled: true, revision: 1 } }) });
        } else {
            onNext({ docs: [] });
        }
        return () => {};
    });

    mountLobby();

    expect(screen.getByRole('button', { name: 'Edit Game Area' })).toBeInTheDocument();
});
```

- [ ] **Step 7: Run to verify it fails, then passes**

Run: `npx jest src/pages/Lobby.test.jsx`
Expected: FAIL first (no button, `fetchRoomReferenceForRoom` not mocked), then PASS after Step 5.

- [ ] **Step 8: Wire the button into GameMasterView.js / HeaderExecution.js**

In `src/pages/GameMasterView.js`, the existing room subscription (the one that currently only reads `isGameActive`) already reads the whole room doc each snapshot — extend its handler to also capture `gameBoundary`:

```javascript
const [gameBoundary, setGameBoundary] = useState(undefined);
// ...
const unsubscribe = onSnapshot(roomRef, (snapshot) => {
    setIsGameActive(snapshot.data()?.isGameActive ?? true);
    setGameBoundary(snapshot.data()?.gameBoundary);
});
```

Pass it down: `<HeaderExecution addLog={addLog} arrayOfAlivePlayers={aliveNames} roomID={roomID} gameBoundary={gameBoundary} />` (note `roomID` isn't currently a `HeaderExecution` prop either — it reads it from `gameContext` today; keep that for the existing heading, and add `gameBoundary` as a new, separate prop rather than disturbing the existing context read).

In `src/components/header_components/HeaderExecution.js`, import and render the button next to the other action buttons:

```jsx
import GameBoundaryButton from '../map_components/GameBoundaryButton';
```

```jsx
<GameBoundaryButton roomID={roomID} gameBoundary={gameBoundary} />
```

(placed in the `HStack`, e.g. right after `<PlaybookLink />` and before `<ResetTargetsButton .../>`), and add `gameBoundary` to the destructured props.

- [ ] **Step 9: Write the failing GameMasterView test for the new button**

`GameMasterView.test.jsx` already branches its shared `onSnapshot.mockImplementation` on `query === 'room-ref'` to answer the room-doc subscription (see its `mockPlayersSnapshot` helper and the "isGameActive is read" describe block) — follow that exact existing pattern rather than introducing a new one. Add, near the other GameMasterView-level rendering tests:

```javascript
it("shows the Game Boundary entry point with the room's current boundary", () => {
    onSnapshot.mockImplementation((query, onNext) => {
        if (query === 'room-ref') {
            onNext({
                data: () => ({ isGameActive: true, gameBoundary: { enabled: true, revision: 1 } }),
            });
        } else {
            onNext({ docs: [] });
        }
        return () => {};
    });

    mountGameMasterView();

    expect(screen.getByRole('button', { name: 'Edit Game Area' })).toBeInTheDocument();
});

it('shows Set Game Area when the room has no boundary yet', () => {
    onSnapshot.mockImplementation((query, onNext) => {
        if (query === 'room-ref') {
            onNext({ data: () => ({ isGameActive: true }) });
        } else {
            onNext({ docs: [] });
        }
        return () => {};
    });

    mountGameMasterView();

    expect(screen.getByRole('button', { name: 'Set Game Area' })).toBeInTheDocument();
});
```

`mountGameMasterView` is the file's real existing render helper (confirmed by reading the file), used as-is above.

- [ ] **Step 10: Run everything to verify it passes**

```bash
npx jest src/pages/Lobby.test.jsx src/pages/GameMasterView.test.jsx src/components/map_components/GameBoundaryButton.test.jsx
```

Expected: all pass.

- [ ] **Step 11: Format, lint, full test run, build, commit**

```bash
npm run format
npm run lint
npm test
npm run build
git add src/components/map_components/GameBoundaryButton.js src/components/map_components/GameBoundaryButton.test.jsx src/pages/Lobby.js src/pages/Lobby.test.jsx src/components/header_components/HeaderExecution.js src/pages/GameMasterView.js src/pages/GameMasterView.test.jsx
git commit -m "Wire the Game Area editor into Lobby and GameMasterView

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 12: Update documentation**

Per the spec's Documentation section: add a short paragraph to `docs/architecture.md` naming `GameMap.js`, `BoundaryEditorModal.js`, and `GameBoundaryButton.js` under the component inventory, and a short paragraph to `docs/game-flows.md` describing "moderator opens the editor from Lobby or GameMasterView → draws → Publish calls the host-authorized callable → every player's room listener receives the new boundary" (the publish/disable mechanics themselves are already documented from Phase 1; this just adds the UI entry point). Read both files first and match their existing section style. Commit alongside Step 11's changes or as its own small commit — either is fine.

---

## Final gate

Before calling Phase 2 done, run the full gate from `CLAUDE.md`:

```bash
npm run format
npm run lint
npm test
npm run build
```

`npm run test:emulator` and `npm run test:rules` are unaffected by this plan (no new Cloud Functions or rules) but running them is still part of the standing gate and costs nothing extra to confirm.

A live map cannot be verified by this gate — that needs a real `REACT_APP_MAPBOX_TOKEN` in a local `.env` and a manual `npm start`, which is the user's step once they have a token (see Task 1, Step 4's README text).
