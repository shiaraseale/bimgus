import type { GameCategory, Village } from '../services/gameDataService';

/** One group of identical items (same code, village and level) from an export. */
export interface VillageItem {
  code: number;
  category: GameCategory | 'unknown';
  village: Village;
  level: number;
  count: number;
  gearedUp?: boolean;
}

export interface InProgressUpgrade {
  code?: number;
  name: string;
  category: GameCategory | 'unknown' | 'building' | 'townHall' | 'builderHall';
  village: Village;
  currentLevel: number;
  targetLevel: number;
  maxLevel: number;
  timerSeconds: number;
  finishesAtMs: number;
}

/** What one in-game export says about an account (both villages). Stored as `account.villageData`. */
export interface VillageDataV2 {
  version: 2;
  tag: string;
  exportTimestamp: number; // ms
  importedAt: string;
  townHallLevel: number;
  builderHallLevel: number;
  townHallWeaponLevel?: number;
  items: VillageItem[];
  inProgressUpgrades: InProgressUpgrade[];
  boosts: Record<string, unknown>;
}
