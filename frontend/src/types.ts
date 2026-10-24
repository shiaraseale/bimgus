export interface Member {
  tag: string;
  name: string;
  role: 'member' | 'admin' | 'coLeader' | 'leader';
  expLevel: number;
  trophies: number;
  clanRank: number;
  donations: number;
  donationsReceived: number;
  townHallLevel?: number;
  league?: {
    name: string;
    iconUrls?: { small?: string };
  };
}

export interface ClanData {
  tag: string;
  name: string;
  clanLevel: number;
  clanPoints: number;
  members: number;
  description?: string;
  warWinStreak?: number;
  warWins?: number;
  memberList: Member[];
  badgeUrls?: { small?: string; large?: string; medium?: string };
  clanCapital?: {
    capitalHallLevel: number;
    districts: Array<{ id: number; name: string; districtHallLevel: number }>;
  };
}

export interface WarAttack {
  attackerTag: string;
  defenderTag: string;
  stars: number;
  destructionPercentage: number;
  order: number;
  duration?: number;
}

export interface WarClanMember {
  tag: string;
  name: string;
  townhallLevel: number;
  mapPosition: number;
  attacks?: WarAttack[];
  opponentAttacks?: number;
  bestOpponentAttack?: WarAttack;
}

export interface WarClan {
  tag: string;
  name: string;
  badgeUrls?: { small: string; large: string; medium: string };
  clanLevel: number;
  attacks: number;
  stars: number;
  destructionPercentage: number;
  members: WarClanMember[];
}

export interface WarAudit {
  zeroAttacks: Array<{ tag: string; name: string; mapPosition: number; townhallLevel: number }>;
  partialAttacks: Array<{ tag: string; name: string; mapPosition: number; townhallLevel: number; attacksUsed: number; starsGained: number }>;
  wastedAttacks: Array<{ attackerName: string; attackerPos: number; defenderName: string; defenderPos: number; stars: number; destruction: number }>;
  mvps: Array<{ name: string; mapPosition: number; townhallLevel: number; totalStars: number; avgDestruction: number }>;
}

export interface WarData {
  state: 'notInWar' | 'preparation' | 'inWar' | 'warEnded';
  teamSize?: number;
  attacksPerMember?: number;
  isCwl?: boolean;
  cwlRound?: number;
  startTime?: string;
  endTime?: string;
  clan: WarClan;
  opponent: WarClan;
  postWarAudit?: WarAudit;
}

export interface BotConfig {
  clanTag: string;
  webhooks: {
    clanActivity?: string | boolean;
    warRoom?: string | boolean;
    cwlHub?: string | boolean;
    raidWeekend?: string | boolean;
    clanGames?: string | boolean;
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
}
