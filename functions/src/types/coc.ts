export interface ClanMember {
  tag: string;
  name: string;
  role: 'member' | 'admin' | 'coLeader' | 'leader'; // 'admin' is Elder in CoC API
  expLevel: number;
  league?: {
    id: number;
    name: string;
    iconUrls?: {
      small?: string;
      tiny?: string;
      medium?: string;
    };
  };
  trophies: number;
  clanRank: number;
  previousClanRank: number;
  donations: number;
  donationsReceived: number;
  playerHouse?: any;
  townHallLevel?: number;
}

export interface ClanResponse {
  tag: string;
  name: string;
  type: string;
  description: string;
  location?: { id: number; name: string; isCountry: boolean };
  badgeUrls: { small: string; large: string; medium: string };
  clanLevel: number;
  clanPoints: number;
  clanVersusPoints?: number;
  clanCapitalPoints?: number;
  requiredTrophies: number;
  warFrequency: string;
  warWinStreak: number;
  warWins: number;
  warTies?: number;
  warLosses?: number;
  isWarLogPublic: boolean;
  members: number;
  memberList: ClanMember[];
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
  badgeUrls: { small: string; large: string; medium: string };
  clanLevel: number;
  attacks: number;
  stars: number;
  destructionPercentage: number;
  members: WarClanMember[];
}

export interface CurrentWarResponse {
  state: 'notInWar' | 'preparation' | 'inWar' | 'warEnded';
  teamSize: number;
  attacksPerMember?: number;
  battleModifier?: string;
  startTime?: string;
  endTime?: string;
  preparationStartTime?: string;
  clan: WarClan;
  opponent: WarClan;
}

export interface CapitalDistrictAttack {
  attacker: {
    tag: string;
    name: string;
  };
  destructionPercent: number;
  stars: number;
}

export interface CapitalDistrict {
  id: number;
  name: string;
  districtHallLevel: number;
  destructionPercent: number;
  stars: number;
  attackCount: number;
  totalLooted: number;
  attacks?: CapitalDistrictAttack[];
}

export interface CapitalRaidWeekend {
  state: 'ongoing' | 'ended';
  startTime: string;
  endTime: string;
  capitalTotalLoot: number;
  raidsCompleted: number;
  totalAttacks: number;
  enemyDistrictsDestroyed: number;
  offensiveReward: number;
  defensiveReward: number;
  attackLog?: Array<{
    defender: { tag: string; name: string; level: number; badgeUrls: any };
    attackCount: number;
    districtCount: number;
    districtsDestroyed: number;
    districts: CapitalDistrict[];
  }>;
}

export interface CapitalRaidResponse {
  items: CapitalRaidWeekend[];
}

export interface CwlClan {
  tag: string;
  name: string;
  clanLevel: number;
  badgeUrls: { small: string; large: string; medium: string };
  members: Array<{ tag: string; name: string; townHallLevel: number }>;
}

export interface CwlRound {
  warTags: string[];
}

export interface CwlGroupResponse {
  state: 'notInWar' | 'preparation' | 'inWar' | 'ended';
  season: string;
  clans: CwlClan[];
  rounds: CwlRound[];
}

export interface PlayerAchievement {
  name: string;
  stars: number;
  value: number;
  target: number;
  info: string;
  village: string;
}

/** A hero, troop, spell or equipment entry in a player response. */
export interface PlayerUnit {
  name: string;
  level: number;
  maxLevel: number;
  village: 'home' | 'builderBase';
  equipment?: PlayerUnit[];
}

export interface PlayerResponse {
  tag: string;
  name: string;
  townHallLevel: number;
  townHallWeaponLevel?: number;
  builderHallLevel?: number;
  expLevel: number;
  trophies: number;
  bestTrophies: number;
  warStars: number;
  attackWins?: number;
  defenseWins?: number;
  donations?: number;
  donationsReceived?: number;
  warPreference?: 'in' | 'out';
  achievements: PlayerAchievement[];
  heroes?: PlayerUnit[];
  troops?: PlayerUnit[];
  spells?: PlayerUnit[];
  heroEquipment?: PlayerUnit[];
  clan?: { tag: string; name: string };
  league?: { iconUrls?: Record<string, string> };
  leagueTier?: { iconUrls?: Record<string, string> };
}


/**
 * A live player, or one rebuilt from the last snapshot during maintenance (which lacks some fields).
 * Functions that accept either take this; anything needing the full response takes PlayerResponse.
 */
export type PlayerLike = Pick<PlayerResponse, 'tag' | 'name' | 'townHallLevel'> &
  Partial<Omit<PlayerResponse, 'tag' | 'name' | 'townHallLevel'>>;
