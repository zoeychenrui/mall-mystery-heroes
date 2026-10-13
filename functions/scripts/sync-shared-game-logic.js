// Cloud Functions deploy uploads only the functions/ directory in
// isolation (firebase.json's functions[0].source) — a require() reaching
// outside it, like '../../src/game/...', resolves fine locally and under
// the emulator (both run from the full repo checkout) but cannot resolve
// in the actual deployed bundle. This copies the specific src/game/
// modules killPlayer.js and joinRoom.js depend on into functions/vendor/
// so the deployed package is self-contained. Run before every deploy
// (firebase.json's functions[0].predeploy) and before local emulator
// tests, which exercise the same require paths the real deploy uses.
//
// functions/vendor/ is gitignored — src/game/ stays the single source of
// truth; this is a regenerated build artifact, not a second copy to keep
// in sync by hand.
const fs = require('fs');
const path = require('path');

const SOURCE_DIR = path.join(__dirname, '..', '..', 'src', 'game');
const DEST_DIR = path.join(__dirname, '..', 'vendor', 'game');
// remapPlan.js itself requires ./targetGraph — its full dependency closure,
// not just what killPlayer.js/joinRoom.js import directly.
const FILES = [
    'remapPlan.js',
    'playerNames.js',
    'targetGraph.js',
    'rateLimit.js',
    'killPhotoUrl.js',
    'missionCompletion.js',
    'gameBoundary.js',
    'powerUps.js',
    'powerUpEffects.js',
];

fs.mkdirSync(DEST_DIR, { recursive: true });
for (const file of FILES) {
    fs.copyFileSync(path.join(SOURCE_DIR, file), path.join(DEST_DIR, file));
}
console.log(`Synced ${FILES.join(', ')} into functions/vendor/game/`);
