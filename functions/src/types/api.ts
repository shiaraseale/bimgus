/**
 * Shapes of the dashboard API's responses. The frontend imports these (frontend/src/types.ts), so
 * there is one definition for both sides (4.3). Keep this file type-only: no runtime code, no enums.
 */
import type { ClanResponse, CurrentWarResponse } from './coc';
import type { BotConfigDoc } from './db';

export type { ClanMember, WarAttack, WarClanMember, WarClan } from './coc';

/** The post-war audit (who missed attacks, wasted hits, MVPs), as stored on the war snapshot. */
export interface WarAudit {
  zeroAttacks: Array<{ tag: string; name: string; mapPosition: number; townhallLevel: number }>;
  partialAttacks: Array<{
    tag: string;
    name: string;
    mapPosition: number;
    townhallLevel: number;
    attacksUsed: number;
    starsGained: number;
  }>;
  wastedAttacks: Array<{
    attackerName: string;
    attackerPos: number;
    defenderName: string;
    defenderPos: number;
    stars: number;
    destruction: number;
  }>;
  mvps: Array<{ name: string; mapPosition: number; townhallLevel: number; totalStars: number; avgDestruction: number }>;
}

/** GET /api/clan/:tag */
export type DashboardClan = ClanResponse;

/** GET /api/clan/:tag/war: a regular war, or the active CWL war with its round */
export type DashboardWar = Omit<CurrentWarResponse, 'teamSize'> & {
  teamSize?: number;
  isCwl?: boolean;
  cwlRound?: number;
  cwlSeason?: string;
  postWarAudit?: WarAudit;
};

/** GET /api/clan/:tag/config: webhook URLs are replaced by true/false, so they never leave the server */
export type DashboardConfig = Omit<BotConfigDoc, 'webhooks' | 'warReminderHours'> & {
  webhooks: { [K in keyof BotConfigDoc['webhooks']]?: string | boolean };
  warReminderHours?: number[];
};
