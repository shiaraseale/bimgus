import defenseDataRaw from '../data/cocDefensesData.json';
import { EMOJIS } from '../constants/emojis';

export interface DefenseLevelEntry {
  level: number;
  cost: number;
  resource: string;
  thRequired: number;
}

export interface DefenseMeta {
  id: string;
  name: string;
  base: 'home' | 'builder';
  category: string;
  levels: DefenseLevelEntry[];
}

const DEFENSE_DATA: Record<string, DefenseMeta> = defenseDataRaw as unknown as Record<string, DefenseMeta>;

export interface ParsedDefenseGroup {
  name: string;
  count: number;
  currentLevel: number;
  maxLevel: number;
  nextCostNumber: number;
  resource: string;
  isMaxed: boolean;
  base: 'home' | 'builder';
}

export interface InProgressUpgrade {
  name: string;
  dataId: string;
  category: 'defense' | 'building' | 'townHall' | 'builderHall' | 'hero' | 'troop' | 'spell';
  village: 'home' | 'builder';
  currentLevel: number;
  targetLevel: number;
  maxLevel: number;
  timerSeconds: number;
  finishesAtMs: number;
}

export interface VillageImportResult {
  tag?: string;
  timestamp?: number;
  townHallLevel?: number;
  builderHallLevel?: number;
  homeDefenses: ParsedDefenseGroup[];
  builderDefenses: ParsedDefenseGroup[];
  homeBuildings: ParsedDefenseGroup[];
  inProgressUpgrades: InProgressUpgrade[];
  totalParsedDefenses: number;
}

export class VillageImportService {
  /**
   * Cleans and parses a raw JSON export string from Clash of Clans.
   */
  static parseRawJson(rawInput: string): any {
    let clean = rawInput.trim();
    // Strip markdown code fences if pasted like ```json ... ```
    if (clean.startsWith('```')) {
      clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    }

    try {
      return JSON.parse(clean);
    } catch (err: any) {
      throw new Error(`Invalid JSON format: ${err.message}`);
    }
  }

  /**
   * Format cost with appropriate resource emoji
   */
  static formatCost(amount: number, resource: string): string {
    if (amount <= 0) return 'Free';

    let formattedNum: string;
    if (amount >= 1_000_000) {
      formattedNum = (amount / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    } else if (amount >= 1_000) {
      formattedNum = Math.round(amount / 1_000) + 'K';
    } else {
      formattedNum = amount.toLocaleString();
    }

    const resLower = (resource || '').toLowerCase();
    let emoji = '';
    if (resLower.includes('builder') && resLower.includes('gold')) {
      emoji = ` ${EMOJIS.BUILDER_GOLD}`;
    } else if (resLower.includes('builder') && resLower.includes('elixir')) {
      emoji = ` ${EMOJIS.BUILDER_ELIXIR}`;
    } else if (resLower.includes('dark')) {
      emoji = ` ${EMOJIS.DARK_ELIXIR}`;
    } else if (resLower.includes('elixir')) {
      emoji = ` ${EMOJIS.ELIXIR}`;
    } else if (resLower.includes('gold')) {
      emoji = ` ${EMOJIS.GOLD}`;
    }

    return `${formattedNum}${emoji}`;
  }

  /**
   * Processes raw village JSON export into sorted defense lists
   */
  static processVillageData(
    villageJson: any,
    fallbackTh: number = 0,
    fallbackBh: number = 0
  ): VillageImportResult {
    let buildings: any[] = [];
    if (Array.isArray(villageJson)) {
      buildings = villageJson;
    } else if (villageJson && Array.isArray(villageJson.buildings)) {
      buildings = villageJson.buildings;
    } else {
      throw new Error('Export JSON must contain a "buildings" array.');
    }

    const tag: string | undefined = villageJson.tag || villageJson.playerTag;

    // Detect Town Hall and Builder Hall levels from structures if present
    let detectedTh = fallbackTh;
    let detectedBh = fallbackBh;

    for (const b of buildings) {
      const dataId = String(b.data || b.dataId);
      const lvl = Number(b.lvl !== undefined ? b.lvl : b.level || 0);
      if (dataId === '1000001' && lvl > 0) {
        detectedTh = Math.max(detectedTh, lvl);
      } else if (dataId === '1000034' && lvl > 0) {
        detectedBh = Math.max(detectedBh, lvl);
      }
    }

    // Default sensible limits if completely unspecified
    if (detectedTh <= 0) detectedTh = 12;
    if (detectedBh <= 0) detectedBh = 9;

    // Group defenses by dataId and current level, and track in-progress upgrades
    const homeMap = new Map<string, { def: DefenseMeta; level: number; count: number }>();
    const builderMap = new Map<string, { def: DefenseMeta; level: number; count: number }>();
    const homeBuildingsMap = new Map<string, { def: DefenseMeta; level: number; count: number }>();
    const inProgressUpgrades: InProgressUpgrade[] = [];
    const exportTimestampSec = Number(villageJson.timestamp) || Math.floor(Date.now() / 1000);
    const safeTimestampSec = exportTimestampSec > 1e12 ? Math.floor(exportTimestampSec / 1000) : exportTimestampSec;

    for (const b of buildings) {
      const dataId = String(b.data || b.dataId);
      const timer = Number(b.timer ?? b.t ?? b.time ?? b.upgrade_timer ?? 0);
      const lvl = Number(b.lvl !== undefined ? b.lvl : b.level || 0);
      const def = DEFENSE_DATA[dataId];

      if (timer > 0) {
        let name = def ? def.name : '';
        let village: 'home' | 'builder' = def?.base || 'home';
        let maxLvl = lvl + 1;
        let category: 'defense' | 'building' | 'townHall' | 'builderHall' | 'hero' | 'troop' | 'spell' = (def?.category as any) || 'defense';

        if (dataId === '1000001') {
          name = 'Town Hall';
          village = 'home';
          category = 'townHall';
          maxLvl = 17;
        } else if (dataId === '1000034') {
          name = 'Builder Hall';
          village = 'builder';
          category = 'builderHall';
          maxLvl = 10;
        } else if (def) {
          name = def.name;
          village = def.base;
          category = (def.category as any) || 'defense';
          const hallLevel = village === 'builder' ? detectedBh : detectedTh;
          for (const l of def.levels) {
            if (l.thRequired <= hallLevel && l.level > maxLvl) {
              maxLvl = l.level;
            }
          }
          maxLvl = Math.max(maxLvl, lvl + 1);
        } else {
          name = `Building (${dataId})`;
          category = 'building';
        }

        if (name) {
          const finishesAtMs = (safeTimestampSec + timer) * 1000;
          inProgressUpgrades.push({
            name,
            dataId,
            category,
            village,
            currentLevel: lvl,
            targetLevel: lvl + 1,
            maxLevel: maxLvl,
            timerSeconds: timer,
            finishesAtMs,
          });
        }
      }

      if (!def) continue;

      const count = Number(b.cnt || 1);
      const key = `${dataId}_${lvl}`;

      if (def.category === 'defense') {
        const targetMap = def.base === 'builder' ? builderMap : homeMap;
        if (!targetMap.has(key)) {
          targetMap.set(key, { def, level: lvl, count: 0 });
        }
        targetMap.get(key)!.count += count;
      } else if (def.category === 'building') {
        if (!homeBuildingsMap.has(key)) {
          homeBuildingsMap.set(key, { def, level: lvl, count: 0 });
        }
        homeBuildingsMap.get(key)!.count += count;
      }
    }

    // Also check heroes for active upgrade timers
    const HERO_MAP: Record<string, { name: string; village: 'home' | 'builder' }> = {
      '28000000': { name: 'Barbarian King', village: 'home' },
      '28000001': { name: 'Archer Queen', village: 'home' },
      '28000002': { name: 'Grand Warden', village: 'home' },
      '28000003': { name: 'Royal Champion', village: 'home' },
      '28000004': { name: 'Minion Prince', village: 'home' },
      '28000005': { name: 'Battle Machine', village: 'builder' },
      '28000006': { name: 'Battle Copter', village: 'builder' },
    };

    if (Array.isArray(villageJson.heroes)) {
      for (const h of villageJson.heroes) {
        const dataId = String(h.data || h.dataId || '');
        const timer = Number(h.timer ?? h.t ?? h.time ?? 0);
        const lvl = Number(h.lvl !== undefined ? h.lvl : h.level || 0);
        if (timer > 0) {
          const meta = HERO_MAP[dataId];
          const name = meta ? meta.name : (h.name || `Hero (${dataId})`);
          const village = meta ? meta.village : 'home';
          const finishesAtMs = (safeTimestampSec + timer) * 1000;
          inProgressUpgrades.push({
            name,
            dataId,
            category: 'hero',
            village,
            currentLevel: lvl,
            targetLevel: lvl + 1,
            maxLevel: lvl + 1,
            timerSeconds: timer,
            finishesAtMs,
          });
        }
      }
    }

    // Check spells and laboratory units for active research timers
    if (Array.isArray(villageJson.spells)) {
      for (const s of villageJson.spells) {
        const dataId = String(s.data || s.dataId || '');
        const timer = Number(s.timer ?? s.t ?? s.time ?? 0);
        const lvl = Number(s.lvl !== undefined ? s.lvl : s.level || 0);
        if (timer > 0) {
          const finishesAtMs = (safeTimestampSec + timer) * 1000;
          inProgressUpgrades.push({
            name: s.name || `Spell (${dataId})`,
            dataId,
            category: 'spell',
            village: 'home',
            currentLevel: lvl,
            targetLevel: lvl + 1,
            maxLevel: lvl + 1,
            timerSeconds: timer,
            finishesAtMs,
          });
        }
      }
    }

    const unitList = Array.isArray(villageJson.units)
      ? villageJson.units
      : Array.isArray(villageJson.troops)
      ? villageJson.troops
      : [];
    for (const u of unitList) {
      const dataId = String(u.data || u.dataId || '');
      const timer = Number(u.timer ?? u.t ?? u.time ?? 0);
      const lvl = Number(u.lvl !== undefined ? u.lvl : u.level || 0);
      if (timer > 0) {
        const finishesAtMs = (safeTimestampSec + timer) * 1000;
        inProgressUpgrades.push({
          name: u.name || `Troop (${dataId})`,
          dataId,
          category: 'troop',
          village: 'home',
          currentLevel: lvl,
          targetLevel: lvl + 1,
          maxLevel: lvl + 1,
          timerSeconds: timer,
          finishesAtMs,
        });
      }
    }

    inProgressUpgrades.sort((a, b) => a.finishesAtMs - b.finishesAtMs);

    const mapToGroups = (
      sourceMap: Map<string, { def: DefenseMeta; level: number; count: number }>,
      hallLevel: number
    ): ParsedDefenseGroup[] => {
      const entries: ParsedDefenseGroup[] = [];

      for (const item of sourceMap.values()) {
        const { def, level, count } = item;

        // Calculate max allowed level for this hall level
        let maxLevel = 1;
        for (const l of def.levels) {
          if (l.thRequired <= hallLevel && l.level > maxLevel) {
            maxLevel = l.level;
          }
        }
        maxLevel = Math.max(maxLevel, level);

        const isMaxed = level >= maxLevel;
        const nextLvl = level + 1;
        const nextData = def.levels.find((l) => l.level === nextLvl);
        const nextCostNumber = !isMaxed && nextData ? nextData.cost : 0;
        const resource = !isMaxed && nextData ? nextData.resource : '';

        entries.push({
          name: def.name,
          count,
          currentLevel: level,
          maxLevel,
          nextCostNumber,
          resource,
          isMaxed,
          base: def.base,
        });
      }

      // Sort strictly in descending order based on numerical cost for gold, elixir, dark elixir
      entries.sort((a, b) => {
        if (b.nextCostNumber !== a.nextCostNumber) {
          return b.nextCostNumber - a.nextCostNumber;
        }
        if (a.name !== b.name) {
          return a.name.localeCompare(b.name);
        }
        return b.currentLevel - a.currentLevel;
      });

      return entries;
    };

    const homeDefenses = mapToGroups(homeMap, detectedTh);
    const builderDefenses = mapToGroups(builderMap, detectedBh);
    const homeBuildings = mapToGroups(homeBuildingsMap, detectedTh);

    return {
      tag,
      timestamp: safeTimestampSec * 1000,
      townHallLevel: detectedTh,
      builderHallLevel: detectedBh,
      homeDefenses,
      builderDefenses,
      homeBuildings,
      inProgressUpgrades,
      totalParsedDefenses: homeDefenses.length + builderDefenses.length + homeBuildings.length,
    };
  }

  /**
   * Formats in-progress upgrades with dynamic Discord countdown timers.
   */
  static formatInProgressUpgrades(upgrades: InProgressUpgrade[]): string {
    const active = upgrades.filter((u) => u.finishesAtMs > Date.now());
    if (active.length === 0) return '';

    return active
      .map((u) => {
        let prefix = '🏰 ';
        if (u.village === 'builder') {
          prefix = '🔨 [BB] ';
        } else if (u.category === 'hero') {
          prefix = `${EMOJIS.CROWN} `;
        } else if (u.category === 'troop' || u.category === 'spell') {
          prefix = '🧪 ';
        }
        const targetStr = u.maxLevel > 0 ? `Lv ${u.targetLevel}/${u.maxLevel}` : `Lv ${u.targetLevel}`;
        const finishesSec = Math.floor(u.finishesAtMs / 1000);
        return `• ${prefix}**${u.name}**: Upgrading to **${targetStr}** — finishes <t:${finishesSec}:R> (<t:${finishesSec}:t>)`;
      })
      .join('\n');
  }

  /**
   * Formats the parsed defense groups into Discord embed fields.
   * Splits across multiple fields if character limit (1024) is approached.
   */
  static formatDefenseFields(
    defenses: ParsedDefenseGroup[],
    titlePrefix: string = '🛡️ Defense Upgrades'
  ): Array<{ name: string; value: string; inline: boolean }> {
    if (defenses.length === 0) {
      return [{ name: titlePrefix, value: 'No defenses detected in export.', inline: false }];
    }

    const lines = defenses.map((d) => {
      if (d.isMaxed) {
        return `• ${d.count}x **${d.name}**: Lv ${d.currentLevel}/${d.maxLevel} — Maxed ✨`;
      }
      const costStr = VillageImportService.formatCost(d.nextCostNumber, d.resource);
      return `• ${d.count}x **${d.name}**: Lv ${d.currentLevel}/${d.maxLevel} — ${costStr}`;
    });

    const fields: Array<{ name: string; value: string; inline: boolean }> = [];
    let currentLines: string[] = [];
    let currentLength = 0;
    let part = 1;

    for (const line of lines) {
      // Discord field value limit is 1024 characters
      if (currentLength + line.length + 1 > 950 && currentLines.length > 0) {
        fields.push({
          name: part === 1 ? titlePrefix : `${titlePrefix} (Part ${part})`,
          value: currentLines.join('\n'),
          inline: false,
        });
        currentLines = [];
        currentLength = 0;
        part++;
      }
      currentLines.push(line);
      currentLength += line.length + 1;
    }

    if (currentLines.length > 0) {
      fields.push({
        name: part === 1 ? titlePrefix : `${titlePrefix} (Part ${part})`,
        value: currentLines.join('\n'),
        inline: false,
      });
    }

    return fields;
  }

  /**
   * Compares previously stored village data with newly imported village data
   * to detect completed defense upgrades.
   */
  static detectCompletedDefenseUpgrades(
    oldVillageData: any,
    newResult: {
      homeDefenses?: ParsedDefenseGroup[];
      builderDefenses?: ParsedDefenseGroup[];
      homeBuildings?: ParsedDefenseGroup[];
    }
  ): Array<{
    name: string;
    category: 'defense';
    village: 'home' | 'builder';
    oldLevel: number;
    newLevel: number;
    maxLevel: number;
    count: number;
  }> {
    if (!oldVillageData) return [];

    const completed: Array<{
      name: string;
      category: 'defense';
      village: 'home' | 'builder';
      oldLevel: number;
      newLevel: number;
      maxLevel: number;
      count: number;
    }> = [];

    const checkList = (
      oldList: ParsedDefenseGroup[] = [],
      newList: ParsedDefenseGroup[] = [],
      village: 'home' | 'builder'
    ) => {
      // Map: defenseName -> Map<level, count>
      const oldMap = new Map<string, Map<number, number>>();
      for (const item of oldList) {
        if (!oldMap.has(item.name)) {
          oldMap.set(item.name, new Map());
        }
        oldMap.get(item.name)!.set(
          item.currentLevel,
          (oldMap.get(item.name)!.get(item.currentLevel) || 0) + item.count
        );
      }

      const newMap = new Map<string, Map<number, { count: number; maxLevel: number }>>();
      for (const item of newList) {
        if (!newMap.has(item.name)) {
          newMap.set(item.name, new Map());
        }
        const existing = newMap.get(item.name)!.get(item.currentLevel);
        const count = (existing ? existing.count : 0) + item.count;
        newMap.get(item.name)!.set(item.currentLevel, { count, maxLevel: item.maxLevel });
      }

      for (const [name, newLevels] of newMap.entries()) {
        const oldLevels = oldMap.get(name) || new Map<number, number>();

        for (const [newLevel, info] of newLevels.entries()) {
          const oldCountAtLevel = oldLevels.get(newLevel) || 0;
          if (info.count > oldCountAtLevel && newLevel > 1) {
            const upgradedCount = info.count - oldCountAtLevel;
            completed.push({
              name,
              category: 'defense',
              village,
              oldLevel: newLevel - 1,
              newLevel,
              maxLevel: info.maxLevel,
              count: upgradedCount,
            });
          }
        }
      }
    };

    checkList(oldVillageData.homeDefenses || [], newResult.homeDefenses || [], 'home');
    checkList(oldVillageData.builderDefenses || [], newResult.builderDefenses || [], 'builder');
    checkList(oldVillageData.homeBuildings || [], newResult.homeBuildings || [], 'home');

    return completed;
  }
}
