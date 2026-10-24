import {
  HeroesProgressSummary,
  HeroProgressItem,
  SixthBuilderProgress,
  OutstandingUpgradesSummary,
  OutstandingUpgradeItem,
  ActiveUpgrade,
  PlayerSnapshot,
} from '../types/user';
import {
  API_CATEGORIES,
  GameItem,
  MAX_BUILDER_HALL,
  MAX_TOWN_HALL,
  Resource,
  apiVillage,
  capFor,
  formatNextCost,
  getById,
  getByName,
  isSuperTroop,
} from './gameDataService';

type ApiListKind = keyof typeof API_CATEGORIES;
type OutstandingResource = OutstandingUpgradeItem['resourceType'];

const warnedUnknown = new Set<string>();

/** Looks up a live API hero/troop/spell/equipment entry in the game data. */
export function lookupApiItem(kind: ApiListKind, apiItem: { name: string; village?: string }): GameItem | undefined {
  const village = apiVillage(apiItem.village);
  const item = getByName(apiItem.name, village, API_CATEGORIES[kind]);
  if (!item && !warnedUnknown.has(`${kind}:${village}:${apiItem.name}`)) {
    warnedUnknown.add(`${kind}:${village}:${apiItem.name}`);
    console.warn(`[PlayerTracking] "${apiItem.name}" (${village} ${kind}) is not in the game data`);
  }
  return item;
}

/** The player's hall level for an item's village (0 if they have no Builder Hall yet). */
function hallFor(player: any, village: 'home' | 'builder'): number {
  return village === 'builder' ? player.builderHallLevel || 0 : player.townHallLevel || 0;
}

/** Cap for a live API entry at the player's current hall. Unknown items fall back to their own level. */
export function apiCap(kind: ApiListKind, apiItem: any, player: any): number {
  const item = lookupApiItem(kind, apiItem);
  if (!item) return Math.max(apiItem.level, 0);
  return capFor(item, hallFor(player, item.village), apiItem.level);
}

function outstandingResource(resource: Resource, village: 'home' | 'builder'): OutstandingResource {
  if (resource === 'gems' || resource === 'other') return village === 'builder' ? 'builderGold' : 'gold';
  return resource;
}

export class PlayerTrackingService {
  /**
   * Calculates hero progress towards max level for the current Town Hall or Builder Hall.
   */
  static calculateHeroesProgress(player: any): HeroesProgressSummary {
    const homeHeroes: HeroProgressItem[] = [];
    const builderHeroes: HeroProgressItem[] = [];

    for (const h of player.heroes || []) {
      const isBb = h.village === 'builderBase';
      const maxLvl = apiCap('heroes', h, player);
      const levelsRemaining = Math.max(0, maxLvl - h.level);
      const percentage = maxLvl > 0 ? Math.min(100, Math.round((h.level / maxLvl) * 100)) : 100;

      const item: HeroProgressItem = {
        name: lookupApiItem('heroes', h)?.displayName ?? h.name,
        level: h.level,
        maxLevel: maxLvl,
        levelsRemaining,
        village: isBb ? 'builder' : 'home',
        percentage,
      };

      if (isBb) {
        builderHeroes.push(item);
      } else {
        homeHeroes.push(item);
      }
    }

    const totalHomeLevelsRemaining = homeHeroes.reduce((acc, h) => acc + h.levelsRemaining, 0);
    const totalHomeMaxLevels = homeHeroes.reduce((acc, h) => acc + h.maxLevel, 0);
    const totalHomeCurrentLevels = homeHeroes.reduce((acc, h) => acc + h.level, 0);
    const overallHomePercentage =
      totalHomeMaxLevels > 0 ? Math.min(100, Math.round((totalHomeCurrentLevels / totalHomeMaxLevels) * 100)) : 100;

    const totalBuilderLevelsRemaining = builderHeroes.reduce((acc, h) => acc + h.levelsRemaining, 0);
    const totalBuilderMaxLevels = builderHeroes.reduce((acc, h) => acc + h.maxLevel, 0);
    const totalBuilderCurrentLevels = builderHeroes.reduce((acc, h) => acc + h.level, 0);
    const overallBuilderPercentage =
      totalBuilderMaxLevels > 0
        ? Math.min(100, Math.round((totalBuilderCurrentLevels / totalBuilderMaxLevels) * 100))
        : 100;

    return {
      playerTag: player.tag,
      playerName: player.name,
      townHallLevel: player.townHallLevel,
      builderHallLevel: player.builderHallLevel,
      homeHeroes,
      builderHeroes,
      homeMaxed: totalHomeLevelsRemaining === 0,
      builderMaxed: totalBuilderLevelsRemaining === 0,
      totalHomeLevelsRemaining,
      totalBuilderLevelsRemaining,
      overallHomePercentage,
      overallBuilderPercentage,
    };
  }

  /**
   * Calculates progress towards unlocking the 6th builder (B.O.B).
   * 4 Tasks:
   * 1. Gear Up 3 buildings (High Gear achievement)
   * 2. Any BB troop to Level 18
   * 3. Any BB defense to Level 9 (Mega Tesla, Multi Mortar, etc. Note: BH is NOT a defense!)
   * 4. Combined BB Hero Level 45 (Battle Machine + Battle Copter)
   */
  static calculateSixthBuilderProgress(
    player: any,
    activeUpgrades: ActiveUpgrade[] = [],
    bobDefenseCompleted: boolean = false
  ): SixthBuilderProgress {
    const achievements: any[] = player.achievements || [];

    // Task 1: Gear ups (High Gear achievement, target: 3)
    const highGear = achievements.find((a) => a.name === 'High Gear');
    const gearUpsCount = highGear ? Math.min(3, highGear.value || 0) : 0;
    const gearUpsDone = gearUpsCount >= 3;

    // Task 2: BB Troop Level 18
    const bbTroops: any[] = (player.troops || []).filter((t: any) => t.village === 'builderBase');
    let highestTroopLvl = 0;
    let highestTroopName = 'None';
    for (const t of bbTroops) {
      if (t.level > highestTroopLvl) {
        highestTroopLvl = t.level;
        highestTroopName = t.name;
      }
    }
    const bbTroopDone = highestTroopLvl >= 18;

    // Task 3: BB Defense Level 9
    // NOTE: Builder Hall level is NOT a defense upgrade and must NOT be counted as such.
    // The official CoC API does not expose raw village defense levels.
    // We check if the user marked it completed or logged it in active upgrades.
    const bhLevel = player.builderHallLevel || 0;
    const hasLv9Defense =
      bobDefenseCompleted ||
      activeUpgrades.some(
        (u) =>
          u.village === 'builder' &&
          (u.category === 'defense' || (u.category as string) === 'building') &&
          (u.targetLevel >= 9 || (u.completed && u.targetLevel >= 9))
      );
    const defenseDone = hasLv9Defense;

    // Task 4: Combined BB Hero level 45
    const bm = (player.heroes || []).find((h: any) => h.name === 'Battle Machine');
    const bc = (player.heroes || []).find((h: any) => h.name === 'Battle Copter');
    const bmLevel = bm ? bm.level : 0;
    const bcLevel = bc ? bc.level : 0;
    const combinedHeroLevel = bmLevel + bcLevel;
    const heroesDone = combinedHeroLevel >= 45;

    let tasksCompleted = 0;
    if (gearUpsDone) tasksCompleted++;
    if (bbTroopDone) tasksCompleted++;
    if (defenseDone) tasksCompleted++;
    if (heroesDone) tasksCompleted++;

    const overallPercentage = Math.round((tasksCompleted / 4) * 100);

    return {
      playerTag: player.tag,
      playerName: player.name,
      builderHallLevel: bhLevel,
      overallPercentage,
      unlocked: tasksCompleted === 4,
      tasks: {
        gearUps: {
          name: 'Gear Up 3 Buildings',
          completed: gearUpsDone,
          current: gearUpsCount,
          target: 3,
          description: 'Gear up Cannon, Archer Tower, and Mortar in Home Village',
        },
        bbTroopLv18: {
          name: 'Upgrade BB Troop to Level 18',
          completed: bbTroopDone,
          current: highestTroopLvl,
          target: 18,
          highestTroopName,
          description: `Highest: ${highestTroopName} (Lv ${highestTroopLvl}/18)`,
        },
        bbDefenseLv9: {
          name: 'Upgrade BB Defense to Level 9',
          completed: defenseDone,
          current: defenseDone ? 1 : 0,
          target: 1,
          description: defenseDone
            ? 'Completed (BB defense upgraded to Lv 9)'
            : bhLevel < 9
            ? `Requires Builder Hall 9+ (Current: BH${bhLevel})`
            : 'Upgrade any BB defense to Lv 9 (e.g. Mega Tesla, Multi Mortar)',
        },
        bbHeroesLv45: {
          name: 'BB Heroes Total Level 45',
          completed: heroesDone,
          current: combinedHeroLevel,
          target: 45,
          battleMachineLevel: bmLevel,
          battleCopterLevel: bcLevel,
          description: `Battle Machine Lv ${bmLevel} + Battle Copter Lv ${bcLevel} = ${combinedHeroLevel}/45`,
        },
      },
    };
  }

  /**
   * Computes outstanding upgrades grouped by resource type.
   */
  static calculateOutstandingUpgrades(
    player: any,
    activeUpgrades: ActiveUpgrade[] = [],
    bobDefenseCompleted: boolean = false
  ): OutstandingUpgradesSummary {
    const byResource: OutstandingUpgradesSummary['byResource'] = {
      darkElixir: [],
      elixir: [],
      ores: [],
      builderElixir: [],
      builderGold: [],
      gold: [],
    };

    const byCategory: OutstandingUpgradesSummary['byCategory'] = {
      home: {
        buildings: [],
        heroes: [],
        equipment: [],
        spells: [],
        troops: [],
      },
      builder: {
        buildings: [],
        heroes: [],
        troops: [],
        sixthBuilder: PlayerTrackingService.calculateSixthBuilderProgress(player, activeUpgrades, bobDefenseCompleted),
      },
    };

    let totalRemainingLevels = 0;

    // 1. Heroes
    for (const h of player.heroes || []) {
      const isBb = h.village === 'builderBase';
      const data = lookupApiItem('heroes', h);
      const maxLvl = apiCap('heroes', h, player);
      const remaining = Math.max(0, maxLvl - h.level);
      if (remaining > 0) {
        totalRemainingLevels += remaining;
        const resType = outstandingResource(data?.resource ?? (isBb ? 'builderElixir' : 'darkElixir'), isBb ? 'builder' : 'home');

        const item: OutstandingUpgradeItem = {
          name: data?.displayName ?? h.name,
          code: data?.id,
          nextCost: data ? formatNextCost(data, h.level) : undefined,
          currentLevel: h.level,
          maxLevel: maxLvl,
          levelsRemaining: remaining,
          village: isBb ? ('builder' as const) : ('home' as const),
          resourceType: resType,
          category: 'hero' as const,
        };

        byResource[resType].push(item);
        if (isBb) {
          byCategory.builder.heroes.push(item);
        } else {
          byCategory.home.heroes.push(item);
        }
      }
    }

    // 2. Hero Equipment (Ores)
    for (const eq of player.heroEquipment || []) {
      const data = lookupApiItem('heroEquipment', eq);
      const maxLvl = apiCap('heroEquipment', eq, player);
      const remaining = Math.max(0, maxLvl - eq.level);
      if (remaining > 0) {
        totalRemainingLevels += remaining;
        const item: OutstandingUpgradeItem = {
          name: data?.displayName ?? eq.name,
          code: data?.id,
          nextCost: data ? formatNextCost(data, eq.level) : undefined,
          currentLevel: eq.level,
          maxLevel: maxLvl,
          levelsRemaining: remaining,
          village: 'home' as const,
          resourceType: 'ores' as const,
          category: 'equipment' as const,
        };
        byResource.ores.push(item);
        byCategory.home.equipment.push(item);
      }
    }

    // 3. Troops
    for (const tr of player.troops || []) {
      const data = lookupApiItem('troops', tr);
      // Super troops show at level 1 even when inactive, and event units can't be upgraded for good
      if (isSuperTroop(data) || data?.event) continue;
      const isBb = tr.village === 'builderBase';
      const maxLvl = apiCap('troops', tr, player);
      const remaining = Math.max(0, maxLvl - tr.level);
      if (remaining > 0) {
        totalRemainingLevels += remaining;
        const resType = outstandingResource(data?.resource ?? (isBb ? 'builderElixir' : 'elixir'), isBb ? 'builder' : 'home');

        const item: OutstandingUpgradeItem = {
          name: data?.displayName ?? tr.name,
          code: data?.id,
          nextCost: data ? formatNextCost(data, tr.level) : undefined,
          currentLevel: tr.level,
          maxLevel: maxLvl,
          levelsRemaining: remaining,
          village: isBb ? ('builder' as const) : ('home' as const),
          resourceType: resType,
          category: 'troop' as const,
        };

        byResource[resType].push(item);
        if (isBb) {
          byCategory.builder.troops.push(item);
        } else {
          byCategory.home.troops.push(item);
        }
      }
    }

    // 4. Spells
    for (const sp of player.spells || []) {
      const data = lookupApiItem('spells', sp);
      if (data?.event) continue;
      const maxLvl = apiCap('spells', sp, player);
      const remaining = Math.max(0, maxLvl - sp.level);
      if (remaining > 0) {
        totalRemainingLevels += remaining;
        const resType = outstandingResource(data?.resource ?? 'elixir', 'home');

        const item: OutstandingUpgradeItem = {
          name: data?.displayName ?? sp.name,
          code: data?.id,
          nextCost: data ? formatNextCost(data, sp.level) : undefined,
          currentLevel: sp.level,
          maxLevel: maxLvl,
          levelsRemaining: remaining,
          village: 'home' as const,
          resourceType: resType,
          category: 'spell' as const,
        };

        byResource[resType].push(item);
        byCategory.home.spells.push(item);
      }
    }

    // 5. Buildings & Defenses
    // Town Hall always only has 1 upgrade (0/1) to reach the next Town Hall level
    if (player.townHallLevel < MAX_TOWN_HALL) {
      const townHall = getById(1000001);
      const item: OutstandingUpgradeItem = {
        name: 'Town Hall',
        code: 1000001,
        nextCost: townHall ? formatNextCost(townHall, player.townHallLevel) : undefined,
        currentLevel: 0,
        maxLevel: 1,
        levelsRemaining: 1,
        village: 'home' as const,
        resourceType: 'gold' as const,
        category: 'building' as const,
      };
      byResource.gold.push(item);
      byCategory.home.buildings.push(item);
      totalRemainingLevels += 1;
    }

    const highGear = (player.achievements || []).find((a: any) => a.name === 'High Gear');
    const gearUpsCount = highGear ? Math.min(3, highGear.value || 0) : 0;
    if (gearUpsCount < 3) {
      const item: OutstandingUpgradeItem = {
        name: 'Home Defense Gear-Ups (Cannon/Archer Tower/Mortar)',
        currentLevel: gearUpsCount,
        maxLevel: 3,
        levelsRemaining: 3 - gearUpsCount,
        village: 'home' as const,
        resourceType: 'gold' as const,
        category: 'building' as const,
      };
      byResource.gold.push(item);
      byCategory.home.buildings.push(item);
      totalRemainingLevels += (3 - gearUpsCount);
    }

    // Builder Hall always only has 1 upgrade (0/1) to reach the next Builder Hall level
    if (player.builderHallLevel && player.builderHallLevel < MAX_BUILDER_HALL) {
      const builderHall = getById(1000034);
      const item: OutstandingUpgradeItem = {
        name: 'Builder Hall',
        code: 1000034,
        nextCost: builderHall ? formatNextCost(builderHall, player.builderHallLevel) : undefined,
        currentLevel: 0,
        maxLevel: 1,
        levelsRemaining: 1,
        village: 'builder' as const,
        resourceType: 'builderGold' as const,
        category: 'building' as const,
      };
      byResource.builderGold.push(item);
      byCategory.builder.buildings.push(item);
      totalRemainingLevels += 1;
    }

    // 6. Active Building / Custom Upgrades logged by user
    for (const au of activeUpgrades) {
      if (!au.completed) {
        const remaining = Math.max(1, au.maxLevelForTh - au.targetLevel);
        const resType = au.resourceType || (au.village === 'builder' ? 'builderGold' : 'gold');
        const item = {
          name: au.name,
          currentLevel: au.targetLevel - 1,
          maxLevel: au.maxLevelForTh,
          levelsRemaining: remaining,
          village: au.village,
          resourceType: resType,
          category: 'building' as const,
        };
        byResource[resType].push(item);
        if (au.village === 'builder') {
          byCategory.builder.buildings.push(item);
        } else {
          byCategory.home.buildings.push(item);
        }
      }
    }

    return {
      playerTag: player.tag,
      playerName: player.name,
      townHallLevel: player.townHallLevel,
      builderHallLevel: player.builderHallLevel,
      byResource,
      byCategory,
      totalRemainingLevels,
    };
  }

  /**
   * Compares a previous snapshot with live player data to detect completed upgrades.
   */
  static detectCompletedUpgrades(
    oldSnapshot: PlayerSnapshot,
    newPlayer: any
  ): Array<{
    name: string;
    category: 'hero' | 'equipment' | 'troop' | 'spell' | 'townHall' | 'builderHall';
    village: 'home' | 'builder';
    oldLevel: number;
    newLevel: number;
    maxLevel: number;
    levelsRemaining: number;
  }> {
    const completed: Array<{
      name: string;
      category: 'hero' | 'equipment' | 'troop' | 'spell' | 'townHall' | 'builderHall';
      village: 'home' | 'builder';
      oldLevel: number;
      newLevel: number;
      maxLevel: number;
      levelsRemaining: number;
    }> = [];

    // Town Hall
    if (newPlayer.townHallLevel > oldSnapshot.townHallLevel) {
      completed.push({
        name: 'Town Hall',
        category: 'townHall',
        village: 'home',
        oldLevel: oldSnapshot.townHallLevel,
        newLevel: newPlayer.townHallLevel,
        maxLevel: MAX_TOWN_HALL,
        levelsRemaining: Math.max(0, MAX_TOWN_HALL - newPlayer.townHallLevel),
      });
    }

    // Builder Hall
    if (newPlayer.builderHallLevel && oldSnapshot.builderHallLevel && newPlayer.builderHallLevel > oldSnapshot.builderHallLevel) {
      completed.push({
        name: 'Builder Hall',
        category: 'builderHall',
        village: 'builder',
        oldLevel: oldSnapshot.builderHallLevel,
        newLevel: newPlayer.builderHallLevel,
        maxLevel: MAX_BUILDER_HALL,
        levelsRemaining: Math.max(0, MAX_BUILDER_HALL - newPlayer.builderHallLevel),
      });
    }

    // Heroes
    for (const h of newPlayer.heroes || []) {
      const prev = oldSnapshot.heroes[h.name];
      const prevLevel = prev ? prev.level : 0;
      if (h.level > prevLevel) {
        const isBb = h.village === 'builderBase';
        const maxLvl = apiCap('heroes', h, newPlayer);
        completed.push({
          name: h.name,
          category: 'hero',
          village: isBb ? 'builder' : 'home',
          oldLevel: prevLevel,
          newLevel: h.level,
          maxLevel: maxLvl,
          levelsRemaining: Math.max(0, maxLvl - h.level),
        });
      }
    }

    // Hero Equipment
    for (const eq of newPlayer.heroEquipment || []) {
      const prev = oldSnapshot.heroEquipment[eq.name];
      const prevLevel = prev ? prev.level : 0;
      if (eq.level > prevLevel) {
        const maxLvl = apiCap('heroEquipment', eq, newPlayer);
        completed.push({
          name: eq.name,
          category: 'equipment',
          village: 'home',
          oldLevel: prevLevel,
          newLevel: eq.level,
          maxLevel: maxLvl,
          levelsRemaining: Math.max(0, maxLvl - eq.level),
        });
      }
    }

    // Troops
    for (const tr of newPlayer.troops || []) {
      const data = lookupApiItem('troops', tr);
      if (isSuperTroop(data) || data?.event) continue;
      const prev = oldSnapshot.troops[tr.name];
      const prevLevel = prev ? prev.level : 0;
      if (tr.level > prevLevel) {
        const isBb = tr.village === 'builderBase';
        const maxLvl = apiCap('troops', tr, newPlayer);
        completed.push({
          name: tr.name,
          category: 'troop',
          village: isBb ? 'builder' : 'home',
          oldLevel: prevLevel,
          newLevel: tr.level,
          maxLevel: maxLvl,
          levelsRemaining: Math.max(0, maxLvl - tr.level),
        });
      }
    }

    // Spells
    for (const sp of newPlayer.spells || []) {
      const prev = oldSnapshot.spells[sp.name];
      const prevLevel = prev ? prev.level : 0;
      if (sp.level > prevLevel) {
        const maxLvl = apiCap('spells', sp, newPlayer);
        completed.push({
          name: sp.name,
          category: 'spell',
          village: 'home',
          oldLevel: prevLevel,
          newLevel: sp.level,
          maxLevel: maxLvl,
          levelsRemaining: Math.max(0, maxLvl - sp.level),
        });
      }
    }

    return completed;
  }

  /**
   * Builds a PlayerSnapshot object from live player API data.
   */
  static createSnapshot(player: any): PlayerSnapshot {
    const heroes: PlayerSnapshot['heroes'] = {};
    for (const h of player.heroes || []) {
      heroes[h.name] = { level: h.level, maxLevel: h.maxLevel || h.level, village: h.village };
    }

    const heroEquipment: PlayerSnapshot['heroEquipment'] = {};
    for (const eq of player.heroEquipment || []) {
      heroEquipment[eq.name] = { level: eq.level, maxLevel: eq.maxLevel || eq.level, village: eq.village };
    }

    const troops: PlayerSnapshot['troops'] = {};
    for (const tr of player.troops || []) {
      troops[tr.name] = { level: tr.level, maxLevel: tr.maxLevel || tr.level, village: tr.village };
    }

    const spells: PlayerSnapshot['spells'] = {};
    for (const sp of player.spells || []) {
      spells[sp.name] = { level: sp.level, maxLevel: sp.maxLevel || sp.level, village: sp.village };
    }

    return {
      tag: player.tag,
      name: player.name,
      townHallLevel: player.townHallLevel,
      builderHallLevel: player.builderHallLevel,
      heroes,
      heroEquipment,
      troops,
      spells,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Helper to parse user duration strings like "12d", "14h 30m", "3d 4h".
   * Returns milliseconds.
   */
  static parseDuration(input: string): number | null {
    const cleaned = input.toLowerCase().trim();
    let totalMs = 0;

    const daysMatch = cleaned.match(/(\d+)\s*d/);
    if (daysMatch) totalMs += parseInt(daysMatch[1], 10) * 24 * 60 * 60 * 1000;

    const hoursMatch = cleaned.match(/(\d+)\s*h/);
    if (hoursMatch) totalMs += parseInt(hoursMatch[1], 10) * 60 * 60 * 1000;

    const minsMatch = cleaned.match(/(\d+)\s*m(?!s)/);
    if (minsMatch) totalMs += parseInt(minsMatch[1], 10) * 60 * 1000;

    const secsMatch = cleaned.match(/(\d+)\s*s/);
    if (secsMatch) totalMs += parseInt(secsMatch[1], 10) * 1000;

    return totalMs > 0 ? totalMs : null;
  }
}
