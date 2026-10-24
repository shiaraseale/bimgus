import type { ClanMember, CurrentWarResponse } from './coc';

export interface ClanSnapshotDoc {
  tag: string;
  name: string;
  clanLevel: number;
  membersCount: number;
  memberTags: string[];
  membersMap: Record<string, ClanMember>;
  updatedAt: string;
}

export interface WarSnapshotDoc {
  warId: string;
  state: CurrentWarResponse['state'];
  startTime?: string;
  endTime?: string;
  preparationStartTime?: string;
  clanTag: string;
  clanName: string;
  clanStars: number;
  clanDestruction: number;
  clanAttacksCount: number;
  opponentTag: string;
  opponentName: string;
  opponentStars: number;
  opponentDestruction: number;
  opponentAttacksCount: number;
  // Keyed by order or unique attack id
  loggedAttackOrders: number[];
  pingedMissedAttacks?: boolean;
  matchupAnnounced?: boolean;
  rosterNotified?: boolean;
  postWarAudit?: {
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
    mvps: Array<{
      name: string;
      mapPosition: number;
      townhallLevel: number;
      totalStars: number;
      avgDestruction: number;
    }>;
  };
  members?: any[];
  updatedAt: string;
}

export interface RaidSnapshotDoc {
  weekendId: string; // e.g. "2026-09-26"
  state: 'ongoing' | 'ended';
  totalLoot: number;
  districtsDestroyed: number;
  completedDistrictIds: string[];
  completedCapitalTags?: string[];
  announcedWeekendEnd?: boolean;
  updatedAt: string;
}

export interface CwlUnderdogHit {
  round: number;
  attackerTag: string;
  attackerName: string;
  attackerTh: number;
  defenderTag: string;
  defenderName: string;
  defenderTh: number;
  thDiff: number;
  stars: number;
  destruction: number;
}

export interface CwlPlayerSummary {
  tag: string;
  name: string;
  townhallLevel: number;
  roundsRostered: number;
  attacksUsed: number;
  missedAttacks: number;
  totalStars: number;
  totalDestruction: number;
  avgDestruction: number;
  perfectHits: number;
  underdogHits: CwlUnderdogHit[];
}

export interface CwlSeasonSummary {
  season: string;
  clanTag: string;
  clanName: string;
  roundsPlayed: number;
  wins: number;
  losses: number;
  ties: number;
  totalClanStars: number;
  winBonusStars: number;
  avgClanDestruction: number;
  playerSummaries: CwlPlayerSummary[];
  topPerformers: CwlPlayerSummary[];
  missedAttacksList: Array<{
    tag: string;
    name: string;
    townhallLevel: number;
    missedAttacks: number;
    roundsRostered: number;
  }>;
  underdogHits: CwlUnderdogHit[];
}

export interface CwlSnapshotDoc {
  season: string;
  state: string;
  clans: Array<{ tag: string; name: string; clanLevel: number }>;
  announcedGroup: boolean;
  announcedMatchupRounds?: number[];
  announcedBattleDayRounds?: number[];
  loggedAttackOrders?: Record<string, number[]>; // warTag -> array of logged orders
  loggedRoundIndices: number[];
  // Round index -> our war's tag, so later polls fetch one war per round instead of all four (3.3)
  ourWarTags?: Record<number, string>;
  pingedMissedAttacksRounds?: number[];
  currentRoundIndex?: number;
  currentWarTag?: string;
  announcedSeasonSummary?: boolean;
  seasonSummary?: CwlSeasonSummary;
  updatedAt: string;
}

export interface ClanGamesSnapshotDoc {
  month: string; // e.g. "2026-09"
  isActive: boolean;
  totalPoints: number;
  unlockedTiers: number[]; // e.g. [1, 2, 3]
  maxedMemberTags: string[]; // members with >= 4000 pts
  memberBaselinePoints: Record<string, number>; // tag -> starting achievement value
  announcedStart: boolean;
  updatedAt: string;
}

export interface BotConfigDoc {
  clanTag: string;
  webhooks: {
    clanActivity?: string;
    warRoom?: string;
    cwlHub?: string;
    raidWeekend?: string;
    clanGames?: string;
  };
  notificationsEnabled: {
    memberJoinedLeft: boolean;
    roleChanges: boolean;
    thUpgrades: boolean;
    warAttacks: boolean;
    warEndSummary: boolean;
    warAttackReminders: boolean;
    raidDistricts: boolean;
    cwlGroup: boolean;
    cwlRoundSummary: boolean;
    clanGamesStart: boolean;
    clanGamesTiers: boolean;
    clanGamesMaxers: boolean;
  };
  warReminderHours: number[]; // e.g. [4, 1]
}
