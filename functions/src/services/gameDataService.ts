/**
 * Single source of game data (codes, names, caps, costs), generated from the ClashKing datamine
 * by `npm run build:game-data`. Never hard-code hall levels or caps elsewhere; read them from here.
 */
import gameDataRaw from '../data/gameData.json';
import { EMOJIS } from '../constants/emojis';

export type Village = 'home' | 'builder';
export type Resource = 'gold' | 'elixir' | 'darkElixir' | 'builderGold' | 'builderElixir' | 'ores' | 'gems' | 'other';
export type GameCategory =
  | 'defense' | 'resource' | 'army' | 'other' | 'trap' | 'wall' | 'townHall' | 'builderHall'
  | 'hero' | 'troop' | 'superTroop' | 'siege' | 'spell' | 'pet' | 'equipment' | 'helper' | 'guardian'
  | 'craftedDefense' | 'craftedModule';

export interface GameLevel {
  level: number;
  cost: number;
  hallRequired: number;
  upgradeSeconds?: number;
  ores?: { shiny: number; glowy: number; starry: number };
}

export interface GameItem {
  id: number;
  name: string;
  displayName: string;
  category: GameCategory;
  village: Village;
  resource: Resource;
  event?: true;
  rarity?: 'Common' | 'Epic';
  hero?: string;
  parent?: number;
  levels: GameLevel[];
  countByHall?: Record<string, number>;
}

export interface GameWeapon {
  name: string;
  resource: Resource;
  levels: GameLevel[];
}

interface GameData {
  meta: { source: string; commit: string; maxTownHall: number; maxBuilderHall: number };
  items: Record<string, GameItem>;
  weapons: Record<string, GameWeapon>;
}

const DATA = gameDataRaw as unknown as GameData;

export const MAX_TOWN_HALL = DATA.meta.maxTownHall;
export const MAX_BUILDER_HALL = DATA.meta.maxBuilderHall;

// The live API names units and equipment the same way the datamine does; these categories cover
// everything the API returns in its heroes/troops/spells/heroEquipment lists (pets and sieges come in `troops`)
export const API_CATEGORIES = {
  heroes: ['hero'],
  troops: ['troop', 'superTroop', 'siege', 'pet'],
  spells: ['spell'],
  heroEquipment: ['equipment'],
} as const satisfies Record<string, readonly GameCategory[]>;

const byName = new Map<string, GameItem[]>();
for (const item of Object.values(DATA.items)) {
  const key = `${item.village}:${item.name.toLowerCase()}`;
  const list = byName.get(key) ?? [];
  list.push(item);
  byName.set(key, list);
}

const warned = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[GameData] ${message}`);
}

/** Converts the API's `village` value ('home' / 'builderBase') to ours. */
export function apiVillage(village: string | undefined): Village {
  return village === 'builderBase' ? 'builder' : 'home';
}

export function getById(id: number | string): GameItem | undefined {
  return DATA.items[String(id)];
}

/**
 * Finds an item by its game name. Some names repeat (e.g. Meteor Golem has two codes, and
 * "Battle Machine" is both a hero and a building), so pass the categories you expect.
 */
export function getByName(name: string, village: Village, categories?: readonly GameCategory[]): GameItem | undefined {
  const list = byName.get(`${village}:${name.toLowerCase()}`) ?? [];
  return categories ? list.find((i) => categories.includes(i.category)) : list[0];
}

/** Display name for a code, or `Unknown (code)` (logged once) when the data doesn't have it yet. */
export function nameForCode(code: number | string): string {
  const item = getById(code);
  if (item) return item.displayName;
  warnOnce(`code:${code}`, `Unknown game code ${code}; the datamine pin may need updating`);
  return `Unknown (${code})`;
}

function clampHall(hallLevel: number, village: Village): number {
  const max = village === 'builder' ? MAX_BUILDER_HALL : MAX_TOWN_HALL;
  if (hallLevel > max) {
    warnOnce(`hall:${village}:${hallLevel}`, `${village === 'builder' ? 'Builder Hall' : 'Town Hall'} ${hallLevel} is above the game data (max ${max}); using ${max}`);
    return max;
  }
  return hallLevel;
}

/** Highest level whose hall requirement is met (0 if none yet). */
export function getMaxLevelForHall(item: GameItem, hallLevel: number): number {
  const hall = clampHall(hallLevel, item.village);
  let max = 0;
  for (const l of item.levels) {
    if (l.hallRequired <= hall && l.level > max) max = l.level;
  }
  return max;
}

/**
 * Cap to show next to a player's current level. Never below the current level: level 1 can carry
 * a higher hall requirement than the hall where the unit actually unlocks, and the data can lag a game update.
 */
export function capFor(item: GameItem, hallLevel: number, currentLevel: number): number {
  return Math.max(getMaxLevelForHall(item, hallLevel), currentLevel);
}

export function getLevel(item: GameItem, level: number): GameLevel | undefined {
  return item.levels.find((l) => l.level === level);
}

/** The Town Hall weapon available at this Town Hall level, if the data has one (only TH17 today). */
export function getWeapon(townHallLevel: number): GameWeapon | undefined {
  return DATA.weapons[String(townHallLevel)];
}

export function isSuperTroop(item: GameItem | undefined): boolean {
  return item?.category === 'superTroop';
}

/** How many of this building or trap the hall level allows (0 if not unlocked yet). */
export function countForHall(item: GameItem, hallLevel: number): number {
  return item.countByHall?.[String(clampHall(hallLevel, item.village))] ?? 0;
}

/** Every item of the given categories in a village. */
export function itemsIn(village: Village, categories: readonly GameCategory[]): GameItem[] {
  return Object.values(DATA.items).filter((i) => i.village === village && categories.includes(i.category));
}

const RESOURCE_EMOJIS: Partial<Record<Resource, string>> = {
  gold: EMOJIS.GOLD,
  elixir: EMOJIS.ELIXIR,
  darkElixir: EMOJIS.DARK_ELIXIR,
  builderGold: EMOJIS.BUILDER_GOLD,
  builderElixir: EMOJIS.BUILDER_ELIXIR,
};

/** Formats an amount as e.g. "4.5M <gold>", "350K <dark elixir>" or "Free". */
export function formatAmount(amount: number, resource: Resource): string {
  if (amount <= 0) return 'Free';
  let formatted: string;
  if (amount >= 1_000_000) formatted = (amount / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  else if (amount >= 1_000) formatted = Math.round(amount / 1_000) + 'K';
  else formatted = amount.toLocaleString('en-US');
  const emoji = RESOURCE_EMOJIS[resource];
  return emoji ? `${formatted} ${emoji}` : formatted;
}

/** Cost of one level (e.g. "4.5M <gold>", or the ores for equipment). */
export function formatLevelCost(item: GameItem | GameWeapon, level: GameLevel): string {
  if (level.ores) {
    const parts = [
      level.ores.shiny > 0 ? `${level.ores.shiny} ${EMOJIS.SHINY_ORE}` : '',
      level.ores.glowy > 0 ? `${level.ores.glowy} ${EMOJIS.GLOWY_ORE}` : '',
      level.ores.starry > 0 ? `${level.ores.starry} ${EMOJIS.STARRY_ORE}` : '',
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : 'Free';
  }
  return formatAmount(level.cost, item.resource);
}

/** Cost of the next level after `currentLevel`, or '' if there isn't one in the data. */
export function formatNextCost(item: GameItem, currentLevel: number): string {
  const next = getLevel(item, currentLevel + 1);
  return next ? formatLevelCost(item, next) : '';
}

export const GAME_DATA_COMMIT = DATA.meta.commit;
