export interface ActiveUpgrade {
  id: string;
  name: string;
  village: 'home' | 'builder';
  targetLevel: number;
  maxLevelForTh: number;
  resourceType?: 'gold' | 'elixir' | 'darkElixir' | 'builderGold' | 'builderElixir' | 'ores';
  category: 'defense' | 'hero' | 'troop' | 'spell' | 'resource' | 'army' | 'equipment' | 'other';
  startedAt: string;
  finishesAt: string;
  completed: boolean;
}

export interface ApprenticeTimer {
  assignedAt: string;
  readyAt: string;
  target?: string;
  notified: boolean;
}

export interface PlayerSnapshot {
  tag: string;
  name: string;
  townHallLevel: number;
  builderHallLevel?: number;
  heroes: Record<string, { level: number; maxLevel: number; village: string }>;
  heroEquipment: Record<string, { level: number; maxLevel: number; village: string }>;
  troops: Record<string, { level: number; maxLevel: number; village: string }>;
  spells: Record<string, { level: number; maxLevel: number; village: string }>;
  updatedAt: string;
}

export interface LinkedAccount {
  playerTag: string;
  name: string;
  townHallLevel: number;
  builderHallLevel?: number;
  isPrimary: boolean;
  lastSnapshot?: PlayerSnapshot;
  activeUpgrades?: ActiveUpgrade[];
  apprenticeTimer?: ApprenticeTimer;
  dmsEnabled?: boolean;
  bobDefenseCompleted?: boolean;
  villageData?: any;
}

export interface UserDoc {
  discordUserId: string;
  dmChannelId?: string;
  activeAccountTag?: string;
  dmsEnabled?: boolean;
  accounts: LinkedAccount[];
  createdAt: string;
  updatedAt: string;
}

export interface OutstandingUpgradeItem {
  name: string;
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
