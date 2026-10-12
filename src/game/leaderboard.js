/**
 * Builds the standings snapshot for /leaderboard send
 * (docs/superpowers/specs/2026-08-06-player-messaging-mobile-prep-design.md).
 * Pure — no Firebase, no React. Dead players are included, not filtered,
 * matching PlayersList's own display convention (everyone shown,
 * alive/dead visually distinguished, not everyone-alive-only).
 */
export const buildLeaderboardStandings = (players) =>
    [...players]
        .sort((a, b) => b.score - a.score)
        .map((player) => ({
            name: player.name,
            score: player.score,
            isAlive: player.isAlive,
        }));
