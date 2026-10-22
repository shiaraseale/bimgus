/**
 * Clash of Clans Town Hall & Builder Hall Max Level Caps.
 * Enables displaying accurate "Level X/Y" for the player's CURRENT Town Hall / Builder Hall,
 * rather than the absolute game max level (TH17).
 */

import { EMOJIS } from '../constants/emojis';

export const SUPER_TROOPS = new Set([
  'Super Barbarian',
  'Super Archer',
  'Super Wall Breaker',
  'Super Giant',
  'Sneaky Goblin',
  'Super Miner',
  'Super Dragon',
  'Inferno Dragon',
  'Super Valkyrie',
  'Super Witch',
  'Ice Hound',
  'Super Bowler',
  'Super Hog Rider',
]);

export const EPIC_EQUIPMENT = new Set([
  'Giant Gauntlet',
  'Frozen Arrow',
  'Fireball',
  'Spiky Ball',
  'Rocket Spear',
  'Electro Boots',
  'Dark Crown',
  'Lavaloon Puppet',
]);

// Hero Caps per Town Hall
const HERO_CAPS_BY_TH: Record<string, Record<number, number>> = {
  'Barbarian King': { 7: 5, 8: 10, 9: 30, 10: 40, 11: 50, 12: 65, 13: 75, 14: 80, 15: 90, 16: 95, 17: 100 },
  'Archer Queen': { 9: 30, 10: 40, 11: 50, 12: 65, 13: 75, 14: 80, 15: 90, 16: 95, 17: 100 },
  'Grand Warden': { 11: 20, 12: 40, 13: 50, 14: 55, 15: 65, 16: 70, 17: 75 },
  'Royal Champion': { 13: 25, 14: 30, 15: 40, 16: 45, 17: 50 },
  'Minion Prince': { 9: 10, 10: 20, 11: 30, 12: 40, 13: 50, 14: 60, 15: 70, 16: 80, 17: 90 },
};

// Builder Base Hero Caps per Builder Hall
const HERO_CAPS_BY_BH: Record<string, Record<number, number>> = {
  'Battle Machine': { 5: 5, 6: 10, 7: 20, 8: 25, 9: 30, 10: 35 },
  'Battle Copter': { 8: 15, 9: 25, 10: 35 },
};

// Troop Caps per Town Hall
const TROOP_CAPS_BY_TH: Record<string, Record<number, number>> = {
  // Elixir Troops
  Barbarian: { 1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 3, 7: 4, 8: 5, 9: 6, 10: 7, 11: 8, 12: 9, 13: 9, 14: 10, 15: 11, 16: 12, 17: 13 },
  Archer: { 1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 3, 7: 4, 8: 5, 9: 6, 10: 7, 11: 8, 12: 9, 13: 9, 14: 10, 15: 11, 16: 12, 17: 13 },
  Giant: { 2: 1, 3: 1, 4: 2, 5: 2, 6: 3, 7: 4, 8: 5, 9: 6, 10: 7, 11: 8, 12: 9, 13: 10, 14: 10, 15: 11, 16: 12, 17: 13 },
  Goblin: { 2: 1, 3: 2, 4: 2, 5: 3, 6: 3, 7: 4, 8: 5, 9: 6, 10: 7, 11: 7, 12: 8, 13: 8, 14: 9, 15: 9, 16: 10, 17: 11 },
  'Wall Breaker': { 3: 1, 4: 2, 5: 2, 6: 3, 7: 4, 8: 5, 9: 5, 10: 6, 11: 7, 12: 8, 13: 9, 14: 10, 15: 11, 16: 12, 17: 13 },
  Balloon: { 4: 1, 5: 2, 6: 3, 7: 4, 8: 5, 9: 6, 10: 7, 11: 7, 12: 8, 13: 9, 14: 10, 15: 10, 16: 11, 17: 12 },
  Wizard: { 5: 1, 6: 2, 7: 4, 8: 5, 9: 6, 10: 7, 11: 8, 12: 9, 13: 10, 14: 10, 15: 11, 16: 12, 17: 13 },
  Healer: { 6: 1, 7: 2, 8: 3, 9: 4, 10: 4, 11: 5, 12: 5, 13: 6, 14: 7, 15: 8, 16: 9, 17: 10 },
  Dragon: { 7: 2, 8: 3, 9: 4, 10: 5, 11: 6, 12: 7, 13: 8, 14: 9, 15: 9, 16: 10, 17: 11 },
  'P.E.K.K.A': { 8: 3, 9: 4, 10: 6, 11: 7, 12: 8, 13: 9, 14: 9, 15: 10, 16: 11, 17: 12 },
  'Baby Dragon': { 9: 2, 10: 4, 11: 5, 12: 6, 13: 7, 14: 8, 15: 9, 16: 10, 17: 11 },
  Miner: { 10: 3, 11: 5, 12: 6, 13: 7, 14: 8, 15: 9, 16: 10, 17: 11 },
  'Electro Dragon': { 11: 2, 12: 3, 13: 4, 14: 5, 15: 6, 16: 7, 17: 8 },
  Yeti: { 12: 2, 13: 3, 14: 4, 15: 5, 16: 6, 17: 7 },
  'Dragon Rider': { 13: 2, 14: 3, 15: 3, 16: 4, 17: 5 },
  'Electro Titan': { 14: 2, 15: 3, 16: 4, 17: 5 },
  'Root Rider': { 15: 2, 16: 3, 17: 4 },
  Thrower: { 16: 3, 17: 4 },

  // Dark Elixir Troops
  Minion: { 7: 2, 8: 4, 9: 5, 10: 6, 11: 7, 12: 8, 13: 9, 14: 10, 15: 11, 16: 12, 17: 13 },
  'Hog Rider': { 7: 2, 8: 4, 9: 5, 10: 6, 11: 7, 12: 9, 13: 10, 14: 10, 15: 11, 16: 12, 17: 13 },
  Valkyrie: { 8: 2, 9: 4, 10: 5, 11: 6, 12: 7, 13: 8, 14: 9, 15: 10, 16: 11, 17: 12 },
  Golem: { 8: 2, 9: 4, 10: 5, 11: 7, 12: 9, 13: 10, 14: 11, 15: 12, 16: 13, 17: 14 },
  Witch: { 9: 2, 10: 3, 11: 4, 12: 5, 13: 5, 14: 5, 15: 6, 16: 7, 17: 8 },
  'Lava Hound': { 9: 2, 10: 3, 11: 4, 12: 5, 13: 6, 14: 6, 15: 6, 16: 7, 17: 8 },
  Bowler: { 10: 2, 11: 3, 12: 4, 13: 5, 14: 6, 15: 7, 16: 8, 17: 9 },
  'Ice Golem': { 11: 2, 12: 5, 13: 5, 14: 6, 15: 7, 16: 8, 17: 9 },
  Headhunter: { 12: 2, 13: 3, 14: 3, 15: 3, 16: 3, 17: 4 },
  'Apprentice Warden': { 13: 2, 14: 3, 15: 4, 16: 4, 17: 5 },
  Druid: { 14: 2, 15: 3, 16: 4, 17: 5 },
};

// Spell Caps per Town Hall
const SPELL_CAPS_BY_TH: Record<string, Record<number, number>> = {
  // Elixir Spells
  'Lightning Spell': { 5: 4, 6: 4, 7: 4, 8: 5, 9: 6, 10: 7, 11: 8, 12: 9, 13: 9, 14: 10, 15: 11, 16: 11, 17: 12 },
  'Healing Spell': { 6: 3, 7: 4, 8: 5, 9: 6, 10: 7, 11: 7, 12: 7, 13: 8, 14: 8, 15: 9, 16: 10, 17: 11 },
  'Rage Spell': { 7: 4, 8: 5, 9: 5, 10: 5, 11: 5, 12: 6, 13: 6, 14: 6, 15: 6, 16: 6, 17: 6 },
  'Jump Spell': { 9: 2, 10: 2, 11: 3, 12: 3, 13: 4, 14: 4, 15: 5, 16: 5, 17: 5 },
  'Freeze Spell': { 9: 2, 10: 5, 11: 6, 12: 7, 13: 7, 14: 7, 15: 7, 16: 7, 17: 7 },
  'Clone Spell': { 10: 3, 11: 5, 12: 5, 13: 6, 14: 7, 15: 8, 16: 8, 17: 8 },
  'Invisibility Spell': { 11: 2, 12: 3, 13: 4, 14: 4, 15: 4, 16: 4, 17: 4 },
  'Recall Spell': { 13: 2, 14: 3, 15: 4, 16: 5, 17: 5 },
  'Revive Spell': { 16: 2, 17: 3 },

  // Dark Elixir Spells
  'Poison Spell': { 8: 2, 9: 3, 10: 4, 11: 5, 12: 6, 13: 7, 14: 8, 15: 9, 16: 10, 17: 11 },
  'Earthquake Spell': { 8: 2, 9: 3, 10: 4, 11: 5, 12: 5, 13: 5, 14: 5, 15: 5, 16: 5, 17: 5 },
  'Haste Spell': { 9: 2, 10: 4, 11: 5, 12: 5, 13: 5, 14: 5, 15: 5, 16: 5, 17: 5 },
  'Skeleton Spell': { 9: 1, 10: 3, 11: 4, 12: 6, 13: 7, 14: 7, 15: 8, 16: 8, 17: 8 },
  'Bat Spell': { 10: 3, 11: 4, 12: 5, 13: 5, 14: 5, 15: 6, 16: 6, 17: 6 },
  'Overgrowth Spell': { 12: 2, 13: 3, 14: 3, 15: 4, 16: 4, 17: 5 },
};

// Builder Base Troops Caps per Builder Hall
const BB_TROOP_CAPS_BY_BH: Record<string, Record<number, number>> = {
  'Raged Barbarian': { 3: 6, 4: 8, 5: 10, 6: 12, 7: 14, 8: 16, 9: 18, 10: 20 },
  'Sneaky Archer': { 3: 6, 4: 8, 5: 10, 6: 12, 7: 14, 8: 16, 9: 18, 10: 20 },
  'Boxer Giant': { 3: 6, 4: 8, 5: 10, 6: 12, 7: 14, 8: 16, 9: 18, 10: 20 },
  'Beta Minion': { 3: 6, 4: 8, 5: 10, 6: 12, 7: 14, 8: 16, 9: 18, 10: 20 },
  Bomber: { 4: 8, 5: 10, 6: 12, 7: 14, 8: 16, 9: 18, 10: 20 },
  'Baby Dragon': { 5: 10, 6: 12, 7: 14, 8: 16, 9: 18, 10: 20 },
  'Cannon Cart': { 5: 10, 6: 12, 7: 14, 8: 16, 9: 18, 10: 20 },
  'Night Witch': { 6: 12, 7: 14, 8: 16, 9: 18, 10: 20 },
  'Drop Ship': { 7: 14, 8: 16, 9: 18, 10: 20 },
  'Power P.E.K.K.A': { 8: 16, 9: 18, 10: 20 },
  'Hog Glider': { 8: 16, 9: 18, 10: 20 },
  'Electrofire Wizard': { 10: 20 },
};

/**
 * Returns the maximum level of a Hero for a given Town Hall / Builder Hall.
 */
export function getHeroMaxLevelForHall(name: string, isBuilder: boolean, hallLevel: number, apiMaxLevel: number): number {
  if (isBuilder) {
    const table = HERO_CAPS_BY_BH[name];
    if (table) {
      return table[hallLevel] || table[10] || apiMaxLevel;
    }
  } else {
    const table = HERO_CAPS_BY_TH[name];
    if (table) {
      return table[hallLevel] || table[17] || apiMaxLevel;
    }
  }
  return apiMaxLevel;
}

/**
 * Returns the maximum level of Hero Equipment for a given Town Hall.
 */
export function getEquipmentMaxLevelForTh(name: string, townHallLevel: number, _apiMaxLevel?: number): number {
  const isEpic = EPIC_EQUIPMENT.has(name);
  if (isEpic) {
    const epicCaps: Record<number, number> = {
      8: 12, 9: 15, 10: 15, 11: 18, 12: 21, 13: 21, 14: 24, 15: 24, 16: 27, 17: 27,
    };
    return epicCaps[townHallLevel] || (townHallLevel >= 16 ? 27 : 21);
  } else {
    const commonCaps: Record<number, number> = {
      8: 9, 9: 12, 10: 12, 11: 15, 12: 15, 13: 15, 14: 18, 15: 18, 16: 18, 17: 18,
    };
    return commonCaps[townHallLevel] || (townHallLevel >= 14 ? 18 : 15);
  }
}

/**
 * Returns the maximum level of a Troop for a given Town Hall / Builder Hall.
 */
export function getTroopMaxLevelForHall(name: string, isBuilder: boolean, hallLevel: number, apiMaxLevel: number): number {
  if (isBuilder) {
    const table = BB_TROOP_CAPS_BY_BH[name];
    if (table) {
      return table[hallLevel] || table[10] || apiMaxLevel;
    }
  } else {
    const table = TROOP_CAPS_BY_TH[name];
    if (table) {
      return table[hallLevel] || table[17] || apiMaxLevel;
    }
  }
  return apiMaxLevel;
}

/**
 * Returns the maximum level of a Spell for a given Town Hall.
 */
export function getSpellMaxLevelForTh(name: string, townHallLevel: number, apiMaxLevel: number): number {
  const table = SPELL_CAPS_BY_TH[name];
  if (table) {
    return table[townHallLevel] || table[17] || apiMaxLevel;
  }
  return apiMaxLevel;
}

// Detailed Defenses per Town Hall (Count, PrevLevel, MaxLevel, Cost)
export interface DefenseDetail {
  count: number;
  prevLevel: number;
  maxLevel: number;
  cost: string;
}

export const TH_DEFENSES: Record<number, Record<string, DefenseDetail>> = {
  1: {
    Cannon: { count: 2, prevLevel: 1, maxLevel: 2, cost: `1K ${EMOJIS.GOLD}` },
  },
  2: {
    Cannon: { count: 2, prevLevel: 2, maxLevel: 3, cost: `4K ${EMOJIS.GOLD}` },
    'Archer Tower': { count: 1, prevLevel: 1, maxLevel: 2, cost: `2K ${EMOJIS.GOLD}` },
  },
  3: {
    Cannon: { count: 2, prevLevel: 3, maxLevel: 4, cost: `16K ${EMOJIS.GOLD}` },
    'Archer Tower': { count: 1, prevLevel: 2, maxLevel: 3, cost: `5K ${EMOJIS.GOLD}` },
    Mortar: { count: 1, prevLevel: 1, maxLevel: 1, cost: `8K ${EMOJIS.GOLD}` },
    'Clan Castle': { count: 1, prevLevel: 0, maxLevel: 1, cost: `10K ${EMOJIS.GOLD}` },
  },
  4: {
    Cannon: { count: 2, prevLevel: 4, maxLevel: 5, cost: `50K ${EMOJIS.GOLD}` },
    'Archer Tower': { count: 2, prevLevel: 3, maxLevel: 4, cost: `20K ${EMOJIS.GOLD}` },
    Mortar: { count: 1, prevLevel: 1, maxLevel: 2, cost: `25K ${EMOJIS.GOLD}` },
    'Air Defense': { count: 1, prevLevel: 1, maxLevel: 2, cost: `45K ${EMOJIS.GOLD}` },
    'Clan Castle': { count: 1, prevLevel: 1, maxLevel: 2, cost: `100K ${EMOJIS.GOLD}` },
  },
  5: {
    Cannon: { count: 3, prevLevel: 5, maxLevel: 6, cost: `100K ${EMOJIS.GOLD}` },
    'Archer Tower': { count: 3, prevLevel: 4, maxLevel: 6, cost: `180K ${EMOJIS.GOLD}` },
    Mortar: { count: 1, prevLevel: 2, maxLevel: 3, cost: `125K ${EMOJIS.GOLD}` },
    'Air Defense': { count: 1, prevLevel: 2, maxLevel: 3, cost: `225K ${EMOJIS.GOLD}` },
    'Wizard Tower': { count: 1, prevLevel: 1, maxLevel: 2, cost: `320K ${EMOJIS.GOLD}` },
    'Clan Castle': { count: 1, prevLevel: 1, maxLevel: 2, cost: `100K ${EMOJIS.GOLD}` },
  },
  6: {
    Cannon: { count: 3, prevLevel: 6, maxLevel: 7, cost: `200K ${EMOJIS.GOLD}` },
    'Archer Tower': { count: 3, prevLevel: 6, maxLevel: 7, cost: `360K ${EMOJIS.GOLD}` },
    Mortar: { count: 2, prevLevel: 3, maxLevel: 4, cost: `400K ${EMOJIS.GOLD}` },
    'Air Defense': { count: 2, prevLevel: 3, maxLevel: 4, cost: `500K ${EMOJIS.GOLD}` },
    'Wizard Tower': { count: 2, prevLevel: 2, maxLevel: 3, cost: `600K ${EMOJIS.GOLD}` },
    'Air Sweeper': { count: 1, prevLevel: 1, maxLevel: 2, cost: `375K ${EMOJIS.GOLD}` },
    'Clan Castle': { count: 1, prevLevel: 2, maxLevel: 3, cost: `400K ${EMOJIS.GOLD}` },
  },
  7: {
    Cannon: { count: 5, prevLevel: 7, maxLevel: 8, cost: `400K ${EMOJIS.GOLD}` },
    'Archer Tower': { count: 4, prevLevel: 7, maxLevel: 8, cost: `500K ${EMOJIS.GOLD}` },
    Mortar: { count: 3, prevLevel: 4, maxLevel: 5, cost: `800K ${EMOJIS.GOLD}` },
    'Air Defense': { count: 3, prevLevel: 4, maxLevel: 5, cost: `1.0M ${EMOJIS.GOLD}` },
    'Wizard Tower': { count: 2, prevLevel: 3, maxLevel: 4, cost: `1.2M ${EMOJIS.GOLD}` },
    'Air Sweeper': { count: 1, prevLevel: 2, maxLevel: 3, cost: `750K ${EMOJIS.GOLD}` },
    'Hidden Tesla': { count: 2, prevLevel: 2, maxLevel: 3, cost: `1.0M ${EMOJIS.GOLD}` },
    'Clan Castle': { count: 1, prevLevel: 2, maxLevel: 3, cost: `800K ${EMOJIS.GOLD}` },
  },
  8: {
    Cannon: { count: 5, prevLevel: 9, maxLevel: 10, cost: `800K ${EMOJIS.GOLD}` },
    'Archer Tower': { count: 5, prevLevel: 9, maxLevel: 10, cost: `1.0M ${EMOJIS.GOLD}` },
    Mortar: { count: 4, prevLevel: 5, maxLevel: 6, cost: `1.2M ${EMOJIS.GOLD}` },
    'Air Defense': { count: 3, prevLevel: 5, maxLevel: 6, cost: `1.5M ${EMOJIS.GOLD}` },
    'Wizard Tower': { count: 3, prevLevel: 5, maxLevel: 6, cost: `1.8M ${EMOJIS.GOLD}` },
    'Air Sweeper': { count: 1, prevLevel: 3, maxLevel: 4, cost: `1.4M ${EMOJIS.GOLD}` },
    'Hidden Tesla': { count: 3, prevLevel: 5, maxLevel: 6, cost: `1.5M ${EMOJIS.GOLD}` },
    'Bomb Tower': { count: 1, prevLevel: 1, maxLevel: 2, cost: `1.5M ${EMOJIS.GOLD}` },
    'Clan Castle': { count: 1, prevLevel: 3, maxLevel: 4, cost: `1.8M ${EMOJIS.GOLD}` },
  },
  9: {
    Cannon: { count: 5, prevLevel: 10, maxLevel: 11, cost: `1.2M ${EMOJIS.GOLD}` },
    'Archer Tower': { count: 6, prevLevel: 10, maxLevel: 11, cost: `1.5M ${EMOJIS.GOLD}` },
    Mortar: { count: 4, prevLevel: 6, maxLevel: 7, cost: `1.8M ${EMOJIS.GOLD}` },
    'Air Defense': { count: 4, prevLevel: 6, maxLevel: 7, cost: `2.2M ${EMOJIS.GOLD}` },
    'Wizard Tower': { count: 4, prevLevel: 6, maxLevel: 7, cost: `2.4M ${EMOJIS.GOLD}` },
    'Air Sweeper': { count: 2, prevLevel: 4, maxLevel: 5, cost: `2.4M ${EMOJIS.GOLD}` },
    'Hidden Tesla': { count: 4, prevLevel: 6, maxLevel: 7, cost: `2.0M ${EMOJIS.GOLD}` },
    'Bomb Tower': { count: 2, prevLevel: 1, maxLevel: 2, cost: `1.5M ${EMOJIS.GOLD}` },
    'X-Bow': { count: 2, prevLevel: 2, maxLevel: 3, cost: `3.0M ${EMOJIS.GOLD}` },
    'Clan Castle': { count: 1, prevLevel: 4, maxLevel: 5, cost: `2.7M ${EMOJIS.GOLD}` },
  },
  10: {
    Cannon: { count: 6, prevLevel: 11, maxLevel: 12, cost: `2.0M ${EMOJIS.GOLD}` },
    'Archer Tower': { count: 7, prevLevel: 11, maxLevel: 12, cost: `2.2M ${EMOJIS.GOLD}` },
    Mortar: { count: 4, prevLevel: 7, maxLevel: 8, cost: `2.5M ${EMOJIS.GOLD}` },
    'Air Defense': { count: 4, prevLevel: 7, maxLevel: 8, cost: `3.0M ${EMOJIS.GOLD}` },
    'Wizard Tower': { count: 4, prevLevel: 7, maxLevel: 8, cost: `3.2M ${EMOJIS.GOLD}` },
    'Air Sweeper': { count: 2, prevLevel: 5, maxLevel: 6, cost: `3.2M ${EMOJIS.GOLD}` },
    'Hidden Tesla': { count: 4, prevLevel: 7, maxLevel: 8, cost: `2.8M ${EMOJIS.GOLD}` },
    'Bomb Tower': { count: 2, prevLevel: 2, maxLevel: 4, cost: `3.0M ${EMOJIS.GOLD}` },
    'X-Bow': { count: 3, prevLevel: 3, maxLevel: 4, cost: `4.2M ${EMOJIS.GOLD}` },
    'Inferno Tower': { count: 2, prevLevel: 2, maxLevel: 3, cost: `5.5M ${EMOJIS.GOLD}` },
    'Clan Castle': { count: 1, prevLevel: 5, maxLevel: 6, cost: `4.0M ${EMOJIS.GOLD}` },
  },
  11: {
    Cannon: { count: 7, prevLevel: 12, maxLevel: 14, cost: `3.6M ${EMOJIS.GOLD}` },
    'Archer Tower': { count: 8, prevLevel: 12, maxLevel: 14, cost: `3.8M ${EMOJIS.GOLD}` },
    Mortar: { count: 4, prevLevel: 8, maxLevel: 9, cost: `4.0M ${EMOJIS.GOLD}` },
    'Air Defense': { count: 4, prevLevel: 8, maxLevel: 9, cost: `4.5M ${EMOJIS.GOLD}` },
    'Wizard Tower': { count: 5, prevLevel: 8, maxLevel: 9, cost: `4.8M ${EMOJIS.GOLD}` },
    'Air Sweeper': { count: 2, prevLevel: 5, maxLevel: 6, cost: `3.2M ${EMOJIS.GOLD}` },
    'Hidden Tesla': { count: 4, prevLevel: 8, maxLevel: 9, cost: `4.2M ${EMOJIS.GOLD}` },
    'Bomb Tower': { count: 2, prevLevel: 4, maxLevel: 5, cost: `4.4M ${EMOJIS.GOLD}` },
    'X-Bow': { count: 4, prevLevel: 4, maxLevel: 5, cost: `5.5M ${EMOJIS.GOLD}` },
    'Inferno Tower': { count: 2, prevLevel: 3, maxLevel: 5, cost: `6.8M ${EMOJIS.GOLD}` },
    'Eagle Artillery': { count: 1, prevLevel: 1, maxLevel: 2, cost: `8.0M ${EMOJIS.GOLD}` },
    'Clan Castle': { count: 1, prevLevel: 6, maxLevel: 7, cost: `6.5M ${EMOJIS.GOLD}` },
  },
  12: {
    Cannon: { count: 7, prevLevel: 14, maxLevel: 17, cost: `4.8M ${EMOJIS.GOLD}` },
    'Archer Tower': { count: 8, prevLevel: 14, maxLevel: 17, cost: `4.8M ${EMOJIS.GOLD}` },
    Mortar: { count: 4, prevLevel: 9, maxLevel: 10, cost: `5.2M ${EMOJIS.GOLD}` },
    'Air Defense': { count: 4, prevLevel: 9, maxLevel: 10, cost: `6.4M ${EMOJIS.GOLD}` },
    'Wizard Tower': { count: 5, prevLevel: 9, maxLevel: 11, cost: `6.8M ${EMOJIS.GOLD}` },
    'Air Sweeper': { count: 2, prevLevel: 6, maxLevel: 7, cost: `4.8M ${EMOJIS.GOLD}` },
    'Hidden Tesla': { count: 5, prevLevel: 9, maxLevel: 10, cost: `6.0M ${EMOJIS.GOLD}` },
    'Bomb Tower': { count: 2, prevLevel: 5, maxLevel: 7, cost: `5.6M ${EMOJIS.GOLD}` },
    'X-Bow': { count: 4, prevLevel: 5, maxLevel: 6, cost: `7.2M ${EMOJIS.GOLD}` },
    'Inferno Tower': { count: 3, prevLevel: 5, maxLevel: 6, cost: `8.0M ${EMOJIS.GOLD}` },
    'Eagle Artillery': { count: 1, prevLevel: 2, maxLevel: 3, cost: `9.6M ${EMOJIS.GOLD}` },
    'Clan Castle': { count: 1, prevLevel: 7, maxLevel: 8, cost: `8.5M ${EMOJIS.GOLD}` },
  },
  13: {
    Cannon: { count: 7, prevLevel: 17, maxLevel: 18, cost: `6.0M ${EMOJIS.GOLD}` },
    'Archer Tower': { count: 8, prevLevel: 17, maxLevel: 18, cost: `6.0M ${EMOJIS.GOLD}` },
    Mortar: { count: 4, prevLevel: 10, maxLevel: 11, cost: `6.5M ${EMOJIS.GOLD}` },
    'Air Defense': { count: 4, prevLevel: 10, maxLevel: 11, cost: `7.5M ${EMOJIS.GOLD}` },
    'Wizard Tower': { count: 5, prevLevel: 11, maxLevel: 12, cost: `8.0M ${EMOJIS.GOLD}` },
    'Air Sweeper': { count: 2, prevLevel: 6, maxLevel: 7, cost: `4.8M ${EMOJIS.GOLD}` },
    'Hidden Tesla': { count: 5, prevLevel: 10, maxLevel: 11, cost: `7.2M ${EMOJIS.GOLD}` },
    'Bomb Tower': { count: 2, prevLevel: 7, maxLevel: 8, cost: `7.0M ${EMOJIS.GOLD}` },
    'X-Bow': { count: 4, prevLevel: 6, maxLevel: 7, cost: `8.8M ${EMOJIS.GOLD}` },
    'Inferno Tower': { count: 3, prevLevel: 6, maxLevel: 7, cost: `9.5M ${EMOJIS.GOLD}` },
    'Eagle Artillery': { count: 1, prevLevel: 3, maxLevel: 4, cost: `12.0M ${EMOJIS.GOLD}` },
    Scattershot: { count: 2, prevLevel: 1, maxLevel: 2, cost: `13.0M ${EMOJIS.GOLD}` },
    'Clan Castle': { count: 1, prevLevel: 8, maxLevel: 9, cost: `10.5M ${EMOJIS.GOLD}` },
  },
  14: {
    Cannon: { count: 7, prevLevel: 18, maxLevel: 19, cost: `7.5M ${EMOJIS.GOLD}` },
    'Archer Tower': { count: 8, prevLevel: 18, maxLevel: 19, cost: `7.5M ${EMOJIS.GOLD}` },
    Mortar: { count: 4, prevLevel: 11, maxLevel: 12, cost: `8.0M ${EMOJIS.GOLD}` },
    'Air Defense': { count: 4, prevLevel: 11, maxLevel: 12, cost: `9.5M ${EMOJIS.GOLD}` },
    'Wizard Tower': { count: 5, prevLevel: 12, maxLevel: 13, cost: `10.5M ${EMOJIS.GOLD}` },
    'Hidden Tesla': { count: 5, prevLevel: 11, maxLevel: 12, cost: `9.0M ${EMOJIS.GOLD}` },
    'Bomb Tower': { count: 2, prevLevel: 8, maxLevel: 9, cost: `9.2M ${EMOJIS.GOLD}` },
    'X-Bow': { count: 4, prevLevel: 7, maxLevel: 8, cost: `11.0M ${EMOJIS.GOLD}` },
    'Inferno Tower': { count: 3, prevLevel: 7, maxLevel: 8, cost: `12.0M ${EMOJIS.GOLD}` },
    'Eagle Artillery': { count: 1, prevLevel: 4, maxLevel: 5, cost: `15.0M ${EMOJIS.GOLD}` },
    Scattershot: { count: 2, prevLevel: 2, maxLevel: 3, cost: `15.5M ${EMOJIS.GOLD}` },
    "Builder's Hut": { count: 4, prevLevel: 1, maxLevel: 4, cost: `12.5M ${EMOJIS.GOLD}` },
    'Clan Castle': { count: 1, prevLevel: 9, maxLevel: 10, cost: `13.0M ${EMOJIS.GOLD}` },
  },
  15: {
    Cannon: { count: 7, prevLevel: 19, maxLevel: 20, cost: `9.5M ${EMOJIS.GOLD}` },
    'Archer Tower': { count: 8, prevLevel: 19, maxLevel: 20, cost: `9.5M ${EMOJIS.GOLD}` },
    Mortar: { count: 4, prevLevel: 12, maxLevel: 13, cost: `10.0M ${EMOJIS.GOLD}` },
    'Air Defense': { count: 4, prevLevel: 12, maxLevel: 13, cost: `11.5M ${EMOJIS.GOLD}` },
    'Wizard Tower': { count: 5, prevLevel: 13, maxLevel: 14, cost: `13.0M ${EMOJIS.GOLD}` },
    'Hidden Tesla': { count: 5, prevLevel: 12, maxLevel: 13, cost: `11.0M ${EMOJIS.GOLD}` },
    'Bomb Tower': { count: 2, prevLevel: 9, maxLevel: 10, cost: `11.5M ${EMOJIS.GOLD}` },
    'X-Bow': { count: 4, prevLevel: 8, maxLevel: 9, cost: `14.0M ${EMOJIS.GOLD}` },
    'Inferno Tower': { count: 3, prevLevel: 8, maxLevel: 9, cost: `15.0M ${EMOJIS.GOLD}` },
    'Eagle Artillery': { count: 1, prevLevel: 5, maxLevel: 6, cost: `17.5M ${EMOJIS.GOLD}` },
    Scattershot: { count: 2, prevLevel: 3, maxLevel: 4, cost: `18.0M ${EMOJIS.GOLD}` },
    'Spell Tower': { count: 2, prevLevel: 1, maxLevel: 3, cost: `16.0M ${EMOJIS.GOLD}` },
    Monolith: { count: 1, prevLevel: 1, maxLevel: 2, cost: `300K ${EMOJIS.DARK_ELIXIR}` },
    'Clan Castle': { count: 1, prevLevel: 10, maxLevel: 11, cost: `16.0M ${EMOJIS.GOLD}` },
  },
  16: {
    'Ricochet Cannon': { count: 2, prevLevel: 1, maxLevel: 2, cost: `19.0M ${EMOJIS.GOLD}` },
    'Multi-Archer Tower': { count: 2, prevLevel: 1, maxLevel: 2, cost: `19.0M ${EMOJIS.GOLD}` },
    'Air Defense': { count: 4, prevLevel: 13, maxLevel: 14, cost: `14.0M ${EMOJIS.GOLD}` },
    'Wizard Tower': { count: 5, prevLevel: 14, maxLevel: 15, cost: `15.5M ${EMOJIS.GOLD}` },
    'Hidden Tesla': { count: 5, prevLevel: 13, maxLevel: 14, cost: `13.5M ${EMOJIS.GOLD}` },
    'X-Bow': { count: 4, prevLevel: 9, maxLevel: 10, cost: `17.0M ${EMOJIS.GOLD}` },
    'Inferno Tower': { count: 3, prevLevel: 9, maxLevel: 10, cost: `18.0M ${EMOJIS.GOLD}` },
    'Eagle Artillery': { count: 1, prevLevel: 6, maxLevel: 7, cost: `20.0M ${EMOJIS.GOLD}` },
    Monolith: { count: 1, prevLevel: 2, maxLevel: 3, cost: `360K ${EMOJIS.DARK_ELIXIR}` },
    'Clan Castle': { count: 1, prevLevel: 11, maxLevel: 12, cost: `19.5M ${EMOJIS.GOLD}` },
  },
  17: {
    'Ricochet Cannon': { count: 2, prevLevel: 2, maxLevel: 3, cost: `21.0M ${EMOJIS.GOLD}` },
    'Multi-Archer Tower': { count: 2, prevLevel: 2, maxLevel: 3, cost: `21.0M ${EMOJIS.GOLD}` },
    'Air Defense': { count: 4, prevLevel: 14, maxLevel: 15, cost: `16.5M ${EMOJIS.GOLD}` },
    'Wizard Tower': { count: 5, prevLevel: 15, maxLevel: 16, cost: `17.5M ${EMOJIS.GOLD}` },
    'Hidden Tesla': { count: 5, prevLevel: 14, maxLevel: 15, cost: `15.5M ${EMOJIS.GOLD}` },
    'X-Bow': { count: 4, prevLevel: 10, maxLevel: 11, cost: `19.5M ${EMOJIS.GOLD}` },
    'Inferno Tower': { count: 3, prevLevel: 10, maxLevel: 11, cost: `21.0M ${EMOJIS.GOLD}` },
    'Eagle Artillery': { count: 1, prevLevel: 7, maxLevel: 8, cost: `23.0M ${EMOJIS.GOLD}` },
    'Spell Tower': { count: 2, prevLevel: 3, maxLevel: 4, cost: `21.5M ${EMOJIS.GOLD}` },
    Monolith: { count: 1, prevLevel: 3, maxLevel: 4, cost: `410K ${EMOJIS.DARK_ELIXIR}` },
    'Clan Castle': { count: 1, prevLevel: 12, maxLevel: 13, cost: `22.0M ${EMOJIS.GOLD}` },
  },
};

export const BH_DEFENSES: Record<number, Record<string, DefenseDetail>> = {
  3: {
    Cannon: { count: 2, prevLevel: 2, maxLevel: 3, cost: `25K ${EMOJIS.BUILDER_GOLD}` },
    'Double Cannon': { count: 1, prevLevel: 2, maxLevel: 3, cost: `40K ${EMOJIS.BUILDER_GOLD}` },
    'Archer Tower': { count: 1, prevLevel: 2, maxLevel: 3, cost: `30K ${EMOJIS.BUILDER_GOLD}` },
    'Hidden Tesla': { count: 1, prevLevel: 2, maxLevel: 3, cost: `50K ${EMOJIS.BUILDER_GOLD}` },
    Crusher: { count: 1, prevLevel: 2, maxLevel: 3, cost: `60K ${EMOJIS.BUILDER_GOLD}` },
  },
  4: {
    Cannon: { count: 2, prevLevel: 3, maxLevel: 4, cost: `80K ${EMOJIS.BUILDER_GOLD}` },
    'Double Cannon': { count: 1, prevLevel: 3, maxLevel: 4, cost: `120K ${EMOJIS.BUILDER_GOLD}` },
    'Archer Tower': { count: 2, prevLevel: 3, maxLevel: 4, cost: `100K ${EMOJIS.BUILDER_GOLD}` },
    'Hidden Tesla': { count: 1, prevLevel: 3, maxLevel: 4, cost: `140K ${EMOJIS.BUILDER_GOLD}` },
    Crusher: { count: 1, prevLevel: 3, maxLevel: 4, cost: `160K ${EMOJIS.BUILDER_GOLD}` },
    'Air Bombs': { count: 1, prevLevel: 3, maxLevel: 4, cost: `180K ${EMOJIS.BUILDER_GOLD}` },
  },
  5: {
    Cannon: { count: 2, prevLevel: 4, maxLevel: 5, cost: `250K ${EMOJIS.BUILDER_GOLD}` },
    'Double Cannon': { count: 2, prevLevel: 4, maxLevel: 5, cost: `350K ${EMOJIS.BUILDER_GOLD}` },
    'Archer Tower': { count: 2, prevLevel: 4, maxLevel: 5, cost: `300K ${EMOJIS.BUILDER_GOLD}` },
    'Hidden Tesla': { count: 1, prevLevel: 4, maxLevel: 5, cost: `400K ${EMOJIS.BUILDER_GOLD}` },
    Crusher: { count: 1, prevLevel: 4, maxLevel: 5, cost: `450K ${EMOJIS.BUILDER_GOLD}` },
    'Air Bombs': { count: 1, prevLevel: 4, maxLevel: 5, cost: `500K ${EMOJIS.BUILDER_GOLD}` },
    'Multi Mortar': { count: 1, prevLevel: 4, maxLevel: 5, cost: `800K ${EMOJIS.BUILDER_GOLD}` },
  },
  6: {
    Cannon: { count: 3, prevLevel: 5, maxLevel: 6, cost: `800K ${EMOJIS.BUILDER_GOLD}` },
    'Double Cannon': { count: 2, prevLevel: 5, maxLevel: 6, cost: `1.0M ${EMOJIS.BUILDER_GOLD}` },
    'Archer Tower': { count: 3, prevLevel: 5, maxLevel: 6, cost: `900K ${EMOJIS.BUILDER_GOLD}` },
    'Hidden Tesla': { count: 1, prevLevel: 5, maxLevel: 6, cost: `1.1M ${EMOJIS.BUILDER_GOLD}` },
    Crusher: { count: 2, prevLevel: 5, maxLevel: 6, cost: `1.2M ${EMOJIS.BUILDER_GOLD}` },
    'Air Bombs': { count: 1, prevLevel: 5, maxLevel: 6, cost: `1.2M ${EMOJIS.BUILDER_GOLD}` },
    'Multi Mortar': { count: 1, prevLevel: 5, maxLevel: 6, cost: `1.4M ${EMOJIS.BUILDER_GOLD}` },
    Roaster: { count: 1, prevLevel: 5, maxLevel: 6, cost: `1.5M ${EMOJIS.BUILDER_GOLD}` },
  },
  7: {
    Cannon: { count: 3, prevLevel: 6, maxLevel: 7, cost: `1.4M ${EMOJIS.BUILDER_GOLD}` },
    'Double Cannon': { count: 2, prevLevel: 6, maxLevel: 7, cost: `1.8M ${EMOJIS.BUILDER_GOLD}` },
    'Archer Tower': { count: 3, prevLevel: 6, maxLevel: 7, cost: `1.6M ${EMOJIS.BUILDER_GOLD}` },
    'Hidden Tesla': { count: 1, prevLevel: 6, maxLevel: 7, cost: `1.9M ${EMOJIS.BUILDER_GOLD}` },
    Crusher: { count: 2, prevLevel: 6, maxLevel: 7, cost: `2.0M ${EMOJIS.BUILDER_GOLD}` },
    'Air Bombs': { count: 1, prevLevel: 6, maxLevel: 7, cost: `2.0M ${EMOJIS.BUILDER_GOLD}` },
    'Multi Mortar': { count: 1, prevLevel: 6, maxLevel: 7, cost: `2.2M ${EMOJIS.BUILDER_GOLD}` },
    Roaster: { count: 1, prevLevel: 6, maxLevel: 7, cost: `2.2M ${EMOJIS.BUILDER_GOLD}` },
    'Giant Cannon': { count: 1, prevLevel: 6, maxLevel: 7, cost: `2.4M ${EMOJIS.BUILDER_GOLD}` },
  },
  8: {
    'Mega Tesla': { count: 1, prevLevel: 7, maxLevel: 8, cost: `3.0M ${EMOJIS.BUILDER_GOLD}` },
    'Multi Mortar': { count: 1, prevLevel: 7, maxLevel: 8, cost: `2.8M ${EMOJIS.BUILDER_GOLD}` },
    Roaster: { count: 1, prevLevel: 7, maxLevel: 8, cost: `2.8M ${EMOJIS.BUILDER_GOLD}` },
    'Giant Cannon': { count: 1, prevLevel: 7, maxLevel: 8, cost: `2.9M ${EMOJIS.BUILDER_GOLD}` },
    Crusher: { count: 2, prevLevel: 7, maxLevel: 8, cost: `2.5M ${EMOJIS.BUILDER_GOLD}` },
    'Air Bombs': { count: 1, prevLevel: 7, maxLevel: 8, cost: `2.6M ${EMOJIS.BUILDER_GOLD}` },
    'Double Cannon': { count: 2, prevLevel: 7, maxLevel: 8, cost: `2.4M ${EMOJIS.BUILDER_GOLD}` },
    'Archer Tower': { count: 3, prevLevel: 7, maxLevel: 8, cost: `2.2M ${EMOJIS.BUILDER_GOLD}` },
    Cannon: { count: 3, prevLevel: 7, maxLevel: 8, cost: `2.0M ${EMOJIS.BUILDER_GOLD}` },
  },
  9: {
    'Mega Tesla': { count: 1, prevLevel: 8, maxLevel: 9, cost: `3.8M ${EMOJIS.BUILDER_GOLD}` },
    'Multi Mortar': { count: 1, prevLevel: 8, maxLevel: 9, cost: `3.5M ${EMOJIS.BUILDER_GOLD}` },
    Roaster: { count: 1, prevLevel: 8, maxLevel: 9, cost: `3.6M ${EMOJIS.BUILDER_GOLD}` },
    'Giant Cannon': { count: 1, prevLevel: 8, maxLevel: 9, cost: `3.7M ${EMOJIS.BUILDER_GOLD}` },
    'Lava Launcher': { count: 1, prevLevel: 8, maxLevel: 9, cost: `3.8M ${EMOJIS.BUILDER_GOLD}` },
    Crusher: { count: 2, prevLevel: 8, maxLevel: 9, cost: `3.2M ${EMOJIS.BUILDER_GOLD}` },
    'Air Bombs': { count: 1, prevLevel: 8, maxLevel: 9, cost: `3.4M ${EMOJIS.BUILDER_GOLD}` },
    'Double Cannon': { count: 2, prevLevel: 8, maxLevel: 9, cost: `3.0M ${EMOJIS.BUILDER_GOLD}` },
    'Archer Tower': { count: 3, prevLevel: 8, maxLevel: 9, cost: `2.8M ${EMOJIS.BUILDER_GOLD}` },
    Cannon: { count: 3, prevLevel: 8, maxLevel: 9, cost: `2.5M ${EMOJIS.BUILDER_GOLD}` },
  },
  10: {
    'X-Bow': { count: 1, prevLevel: 4, maxLevel: 5, cost: `4.8M ${EMOJIS.BUILDER_GOLD}` },
    'Mega Tesla': { count: 1, prevLevel: 9, maxLevel: 10, cost: `4.8M ${EMOJIS.BUILDER_GOLD}` },
    'Multi Mortar': { count: 1, prevLevel: 9, maxLevel: 10, cost: `4.6M ${EMOJIS.BUILDER_GOLD}` },
    Roaster: { count: 1, prevLevel: 9, maxLevel: 10, cost: `4.7M ${EMOJIS.BUILDER_GOLD}` },
    'Giant Cannon': { count: 1, prevLevel: 9, maxLevel: 10, cost: `4.8M ${EMOJIS.BUILDER_GOLD}` },
    'Lava Launcher': { count: 1, prevLevel: 9, maxLevel: 10, cost: `4.8M ${EMOJIS.BUILDER_GOLD}` },
    Crusher: { count: 2, prevLevel: 9, maxLevel: 10, cost: `4.2M ${EMOJIS.BUILDER_GOLD}` },
    'Air Bombs': { count: 1, prevLevel: 9, maxLevel: 10, cost: `4.4M ${EMOJIS.BUILDER_GOLD}` },
    'Double Cannon': { count: 2, prevLevel: 9, maxLevel: 10, cost: `4.0M ${EMOJIS.BUILDER_GOLD}` },
    'Archer Tower': { count: 3, prevLevel: 9, maxLevel: 10, cost: `3.8M ${EMOJIS.BUILDER_GOLD}` },
    Cannon: { count: 3, prevLevel: 9, maxLevel: 10, cost: `3.5M ${EMOJIS.BUILDER_GOLD}` },
  },
};

export function getDetailedDefensesForTh(thLevel: number): Record<string, DefenseDetail> {
  if (TH_DEFENSES[thLevel]) return TH_DEFENSES[thLevel];
  const keys = Object.keys(TH_DEFENSES).map(Number).sort((a, b) => b - a);
  const match = keys.find((k) => k <= thLevel) || keys[keys.length - 1];
  return TH_DEFENSES[match] || {};
}

export function getDetailedDefensesForBh(bhLevel: number): Record<string, DefenseDetail> {
  if (BH_DEFENSES[bhLevel]) return BH_DEFENSES[bhLevel];
  const keys = Object.keys(BH_DEFENSES).map(Number).sort((a, b) => b - a);
  const match = keys.find((k) => k <= bhLevel) || keys[keys.length - 1];
  return BH_DEFENSES[match] || {};
}

