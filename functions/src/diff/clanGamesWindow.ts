// Clan Games run from the 22nd at 08:00 UTC; Bimgus tracks them until the end of the 28th
export const CLAN_GAMES_START_DAY = 22;
export const CLAN_GAMES_START_HOUR_UTC = 8;
export const CLAN_GAMES_END_DAY = 28;

/**
 * Returns true while Clan Games are running, from the 22nd at 08:00 UTC until the end of the 28th (UTC).
 */
export function isClanGamesActive(now: Date): boolean {
  const day = now.getUTCDate();
  if (day < CLAN_GAMES_START_DAY || day > CLAN_GAMES_END_DAY) {
    return false;
  }
  if (day === CLAN_GAMES_START_DAY) {
    return now.getUTCHours() >= CLAN_GAMES_START_HOUR_UTC;
  }
  return true;
}
