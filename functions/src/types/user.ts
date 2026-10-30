import type { VillageDataV2 } from './village';

export interface SnapshotEntry {
  name?: string;
  level: number;
  maxLevel: number;
  village: string;
}

/**
 * The account's live API data as of the last poll. Version 2 keys each list by `village:name`,
 * because some names exist in both villages (e.g. Baby Dragon).
 */
export interface PlayerSnapshot {
  version?: 2;
  tag: string;
  name: string;
  townHallLevel: number;
  townHallWeaponLevel?: number;
  builderHallLevel?: number;
  heroes: Record<string, SnapshotEntry>;
  heroEquipment: Record<string, SnapshotEntry>;
  troops: Record<string, SnapshotEntry>;
  spells: Record<string, SnapshotEntry>;
  // Profile stats for /roast (2.7), so it doesn't need a live API call
  stats?: {
    trophies: number;
    warStars: number;
    donations: number;
    donationsReceived: number;
    attackWins: number;
    defenseWins: number;
    warPreference?: string;
  };
  updatedAt: string;
}

export interface LinkedAccount {
  playerTag: string;
  name: string;
  townHallLevel: number;
  builderHallLevel?: number;
  isPrimary: boolean;
  lastSnapshot?: PlayerSnapshot;
  dmsEnabled?: boolean;
  bobDefenseCompleted?: boolean;
  // The latest import (2.3); data from before version 2 may still be stored and is ignored on read
  villageData?: VillageDataV2 | { version?: undefined; [key: string]: unknown };
  // Recent notifications already sent (timer and API keys), so a retry never sends one twice
  notifiedKeys?: string[];
}

export interface UserDoc {
  discordUserId: string;
  dmChannelId?: string;
  dmsEnabled?: boolean;
  // Set when Discord refuses DMs to this user (50007); DMs pause for 7 days
  dmsBlockedAt?: string;
  dmsBlockedNoticeShown?: boolean;
  accounts: LinkedAccount[];
  createdAt: string;
  updatedAt: string;
}

export interface OutstandingUpgradeItem {
  name: string;
  code?: number;
  nextCost?: string;
  currentLevel: number;
  maxLevel: number;
  levelsRemaining: number;
  village: 'home' | 'builder';
  resourceType: 'gold' | 'elixir' | 'darkElixir' | 'builderGold' | 'builderElixir' | 'ores';
  category: 'hero' | 'equipment' | 'troop' | 'spell' | 'building';
}

export interface OutstandingUpgradesSummary {
  playerTag: string;
  playerName: string;
  townHallLevel: number;
  builderHallLevel?: number;
  byResource: {
    darkElixir: OutstandingUpgradeItem[];
    elixir: OutstandingUpgradeItem[];
    ores: OutstandingUpgradeItem[];
    builderElixir: OutstandingUpgradeItem[];
    builderGold: OutstandingUpgradeItem[];
    gold: OutstandingUpgradeItem[];
  };
  byCategory: {
    home: {
      buildings: OutstandingUpgradeItem[];
      heroes: OutstandingUpgradeItem[];
      equipment: OutstandingUpgradeItem[];
      spells: OutstandingUpgradeItem[];
      troops: OutstandingUpgradeItem[];
    };
    builder: {
      buildings: OutstandingUpgradeItem[];
      heroes: OutstandingUpgradeItem[];
      troops: OutstandingUpgradeItem[];
      sixthBuilder: SixthBuilderProgress;
    };
  };
  totalRemainingLevels: number;
}

export interface SixthBuilderProgress {
  playerTag: string;
  playerName: string;
  builderHallLevel: number;
  overallPercentage: number;
  unlocked: boolean;
  tasks: {
    gearUps: {
      name: string;
      completed: boolean;
      current: number;
      target: number;
      description: string;
    };
    bbTroopLv18: {
      name: string;
      completed: boolean;
      current: number;
      target: number;
      highestTroopName: string;
      description: string;
    };
    bbDefenseLv9: {
      name: string;
      completed: boolean;
      current: number;
      target: number;
      description: string;
    };
    bbHeroesLv45: {
      name: string;
      completed: boolean;
      current: number;
      target: number;
      battleMachineLevel: number;
      battleCopterLevel: number;
      description: string;
    };
  };
}

export interface HeroProgressItem {
  name: string;
  level: number;
  maxLevel: number;
  levelsRemaining: number;
  village: 'home' | 'builder';
  percentage: number;
}

export interface HeroesProgressSummary {
  playerTag: string;
  playerName: string;
  townHallLevel: number;
  builderHallLevel?: number;
  homeHeroes: HeroProgressItem[];
  builderHeroes: HeroProgressItem[];
  homeMaxed: boolean;
  builderMaxed: boolean;
  totalHomeLevelsRemaining: number;
  totalBuilderLevelsRemaining: number;
  overallHomePercentage: number;
  overallBuilderPercentage: number;
}
