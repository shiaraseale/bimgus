import {
  GameCategory,
  GameItem,
  Village,
  capFor,
  formatNextCost,
  getById,
  getLevel,
  getWeapon,
  nameForCode,
} from './gameDataService';
import type { InProgressUpgrade, VillageDataV2, VillageItem } from '../types/village';
import { log } from '../utils/log';
import { discordTime } from '../utils/discordTime';

export const VILLAGE_DATA_VERSION = 2;

export type { InProgressUpgrade, VillageDataV2, VillageItem } from '../types/village';

export interface ParsedDefenseGroup {
  code: number;
  name: string;
  count: number;
  currentLevel: number;
  maxLevel: number;
  nextCost: string;
  nextCostNumber: number;
  isMaxed: boolean;
  village: Village;
}

export interface ImportChange {
  kind: 'upgraded' | 'built';
  code: number;
  name: string;
  category: GameCategory;
  village: Village;
  oldLevel: number;
  newLevel: number;
  maxLevel: number;
  count: number;
}

// What an import lists as left to upgrade, per village: title, categories, and what one item is called
const IMPORT_SECTIONS: Record<Village, Array<[string, GameCategory[], string]>> = {
  home: [
    ['🛡️ Defenses', ['defense'], 'defense'],
    ['💣 Traps', ['trap'], 'trap'],
    ['🏛️ Resource & Army', ['resource', 'army', 'other'], 'building'],
    ['🧱 Walls', ['wall'], 'wall'],
    ['🗿 Guardians', ['guardian'], 'guardian'],
    ['🕯️ Crafted Defenses', ['craftedModule'], 'module'],
    ['🛠️ Helpers', ['helper'], 'helper'],
  ],
  builder: [
    ['🛡️ Defenses', ['defense'], 'defense'],
    ['💣 Traps', ['trap'], 'trap'],
    ['🏛️ Resource & Army', ['resource', 'army', 'other'], 'building'],
    ['🧱 Walls', ['wall'], 'wall'],
  ],
};

export interface ImportSection {
  title: string;
  lines: string[];
  village?: Village;
  noun?: string; // what one item is called, for the summary ("3 traps")
  count: number;
}

// A crafted defense's modules share a line, under the defense's name ("Inferno Candle Attack Module")
const MODULE_NAME = /^(.*) (?:Attack|Effect|HP) Module$/;

// Timers for the same upgrade that finish this close together share a line ("2x Spring Trap")
const SAME_TIMER_WINDOW_MS = 60 * 60 * 1000;

// Export sections, and the village each one belongs to (a "2" suffix is the Builder Base)
const SECTIONS: Array<[string, Village]> = [
  ['buildings', 'home'],
  ['traps', 'home'],
  ['units', 'home'],
  ['siege_machines', 'home'],
  ['heroes', 'home'],
  ['spells', 'home'],
  ['pets', 'home'],
  ['equipment', 'home'],
  ['helpers', 'home'],
  ['guardians', 'home'],
  ['buildings2', 'builder'],
  ['traps2', 'builder'],
  ['units2', 'builder'],
  ['heroes2', 'builder'],
];

// Which workshop's boosts speed up each home section; every Builder Base timer uses the Clock Tower
type Workshop = 'builder' | 'lab' | 'pet' | 'clockTower';
const HOME_WORKSHOPS: Record<string, Workshop> = {
  buildings: 'builder',
  traps: 'builder',
  heroes: 'builder',
  guardians: 'builder',
  units: 'lab',
  spells: 'lab',
  siege_machines: 'lab',
  pets: 'pet',
};

// Keys in the export's `boosts` (seconds left on each), and how many times faster each runs.
// Names and rates follow the ClashOfNotifications parser.
const BOOSTS: Record<string, { workshop: Workshop; rate: number }> = {
  builder_boost: { workshop: 'builder', rate: 10 }, // Builder Potion
  lab_boost: { workshop: 'lab', rate: 24 }, // Research Potion
  pet_boost: { workshop: 'pet', rate: 24 }, // Pet Potion
  clocktower_boost: { workshop: 'clockTower', rate: 10 }, // Clock Tower / Clock Tower Potion
  builder_consumable: { workshop: 'builder', rate: 2 },
  lab_consumable: { workshop: 'lab', rate: 4 },
};

// Builder's Apprentice and Lab Assistant: a level N helper adds N hours of work per hour
const HELPER_WORKSHOPS: Record<number, Workshop> = { 93000000: 'builder', 93000001: 'lab' };

/**
 * Real seconds until an upgrade with `timer` seconds of work left finishes, given boosts that each
 * run for a number of seconds from the export. Overlapping boosts add their extra speed together.
 */
export function boostedSeconds(timer: number, boosts: Array<{ seconds: number; rate: number }>): number {
  const active = boosts.filter((b) => b.seconds > 0 && b.rate > 1).sort((a, b) => a.seconds - b.seconds);
  let remaining = timer;
  let elapsed = 0;
  for (let i = 0; i < active.length && remaining > 0; i++) {
    // Between the previous boost ending and this one ending, this boost and every longer one run
    const rate = 1 + active.slice(i).reduce((sum, b) => sum + b.rate - 1, 0);
    const span = active[i].seconds - elapsed;
    if (span * rate >= remaining) return Math.ceil(elapsed + remaining / rate);
    remaining -= span * rate;
    elapsed = active[i].seconds;
  }
  return Math.ceil(elapsed + remaining);
}

const TOWN_HALL = 1000001;
const BUILDER_HALL = 1000034;
const STALE_EXPORT_MS = 24 * 60 * 60 * 1000;

// Categories whose completions the import is the source for; the live API covers the rest (2.4)
export const IMPORT_TRACKED_CATEGORIES: readonly GameCategory[] = [
  'defense',
  'resource',
  'army',
  'other',
  'trap',
  'wall',
  'guardian',
  'craftedModule',
  'helper',
];

function hallFor(
  data: VillageDataV2,
  village: Village,
  override?: { townHall?: number; builderHall?: number }
): number {
  return village === 'builder'
    ? Math.max(override?.builderHall ?? 0, data.builderHallLevel)
    : Math.max(override?.townHall ?? 0, data.townHallLevel);
}

export class VillageImportService {
  /**
   * Cleans and parses a raw JSON export string from Clash of Clans.
   */
  static parseRawJson(rawInput: string): any {
    let clean = rawInput.trim();
    // Strip markdown code fences if pasted like ```json ... ```
    if (clean.startsWith('```')) {
      clean = clean
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
    }

    try {
      return JSON.parse(clean);
    } catch (err: any) {
      throw new Error(`Invalid JSON format: ${err.message}`);
    }
  }

  /**
   * Reads one in-game export (which holds both villages) into the stored format.
   */
  static parseExport(exportJson: any, now: number = Date.now()): VillageDataV2 {
    if (!exportJson || typeof exportJson !== 'object' || !Array.isArray(exportJson.buildings)) {
      throw new Error('This doesn\'t look like a Clash of Clans village export (no "buildings" list).');
    }

    const rawTs = Number(exportJson.timestamp) || 0;
    const exportSec = rawTs > 1e12 ? Math.floor(rawTs / 1000) : rawTs;
    if (!exportSec) log.warn('[VillageImport] Export has no timestamp; using the import time');
    const exportTimestamp = exportSec ? exportSec * 1000 : now;

    const groups = new Map<string, VillageItem>();
    const inProgress: Array<Omit<InProgressUpgrade, 'maxLevel'>> = [];
    let townHallLevel = 0;
    let builderHallLevel = 0;
    let townHallWeaponLevel: number | undefined;

    const exportBoosts: Record<string, unknown> =
      exportJson.boosts && typeof exportJson.boosts === 'object' ? exportJson.boosts : {};
    const helperLevels = new Map<Workshop, number>();
    for (const h of Array.isArray(exportJson.helpers) ? exportJson.helpers : []) {
      const workshop = HELPER_WORKSHOPS[Number(h?.data)];
      if (workshop) helperLevels.set(workshop, Number(h.lvl) || 0);
    }
    const unknownBoosts = Object.keys(exportBoosts).filter((k) => !BOOSTS[k] && !k.endsWith('_cooldown'));
    if (unknownBoosts.length) log.warn(`[VillageImport] Unknown boosts in export: ${unknownBoosts.join(', ')}`);

    /** Seconds until an upgrade finishes once the potions, Clock Tower and helpers on it are counted. */
    const finishSeconds = (timer: number, workshop: Workshop | undefined, helperTimer: number): number => {
      if (!workshop) return timer;
      const active: Array<{ seconds: number; rate: number }> = [];
      for (const [key, seconds] of Object.entries(exportBoosts)) {
        if (BOOSTS[key]?.workshop === workshop) active.push({ seconds: Number(seconds) || 0, rate: BOOSTS[key].rate });
      }
      const helperLevel = helperLevels.get(workshop) ?? 0;
      if (helperTimer > 0 && helperLevel > 0) active.push({ seconds: helperTimer, rate: helperLevel + 1 });
      return boostedSeconds(timer, active);
    };

    const addItem = (
      code: number,
      village: Village,
      level: number,
      count: number,
      gearedUp: boolean,
      timer: number,
      workshop?: Workshop,
      helperTimer = 0
    ) => {
      const item = getById(code);
      if (!item) {
        nameForCode(code); // logs the unknown code once
      } else if (item.village !== village) {
        log.warn(
          `[VillageImport] ${item.name} (${code}) is listed in the ${village} village but the data says ${item.village}`
        );
      }
      const category = item?.category ?? 'unknown';
      // The export, like the API, already shows an upgrading hero at its new level (found 2026-10-28,
      // when import timers were a level above the API's and showed twice), so it's one level lower
      if (timer > 0 && category === 'hero') level -= 1;
      const key = `${village}:${code}:${level}:${gearedUp ? 1 : 0}`;
      const existing = groups.get(key);
      if (existing) existing.count += count;
      else groups.set(key, { code, category, village, level, count, ...(gearedUp ? { gearedUp: true } : {}) });

      if (timer > 0) {
        const seconds = finishSeconds(timer, workshop, helperTimer);
        inProgress.push({
          code,
          name: item?.displayName ?? nameForCode(code),
          category,
          village,
          currentLevel: level,
          targetLevel: level + 1,
          timerSeconds: seconds,
          finishesAtMs: exportTimestamp + seconds * 1000,
        });
      }
    };

    for (const [section, village] of SECTIONS) {
      const entries = exportJson[section];
      if (!Array.isArray(entries)) continue;
      const workshop = village === 'builder' ? 'clockTower' : HOME_WORKSHOPS[section];

      for (const entry of entries) {
        const code = Number(entry?.data);
        if (!code) continue;

        // The Crafting Station has no level of its own; each crafted defense's modules do
        if (Array.isArray(entry.types)) {
          for (const type of entry.types) {
            for (const m of type.modules ?? []) {
              addItem(
                Number(m.data),
                village,
                Number(m.lvl) || 0,
                1,
                false,
                Number(m.timer) || 0,
                workshop,
                Number(m.helper_timer) || 0
              );
            }
          }
          continue;
        }

        const level = Number(entry.lvl) || 0;
        if (code === TOWN_HALL) {
          townHallLevel = Math.max(townHallLevel, level);
          if (entry.weapon !== undefined) townHallWeaponLevel = Number(entry.weapon);
        }
        if (code === BUILDER_HALL) builderHallLevel = Math.max(builderHallLevel, level);

        // A missing cnt means 1; upgrading and geared-up items are listed on their own
        addItem(
          code,
          village,
          level,
          Number(entry.cnt) || 1,
          Boolean(entry.gear_up),
          Number(entry.timer) || 0,
          workshop,
          Number(entry.helper_timer) || 0
        );
      }
    }

    if (!townHallLevel) throw new Error("The export has no Town Hall, so it can't be read.");

    const data: VillageDataV2 = {
      version: VILLAGE_DATA_VERSION,
      tag: String(exportJson.tag || ''),
      exportTimestamp,
      importedAt: new Date(now).toISOString(),
      townHallLevel,
      builderHallLevel,
      ...(townHallWeaponLevel !== undefined ? { townHallWeaponLevel } : {}),
      items: [...groups.values()],
      inProgressUpgrades: [],
      boosts: exportBoosts,
      heroTimersFixed: true,
    };

    data.inProgressUpgrades = inProgress
      .map((u) => {
        const item = u.code ? getById(u.code) : undefined;
        const maxLevel = item ? capFor(item, hallFor(data, u.village), u.targetLevel) : u.targetLevel;
        return { ...u, maxLevel };
      })
      .sort((a, b) => a.finishesAtMs - b.finishesAtMs);

    return data;
  }

  /**
   * Matches each export to a linked account by the tag inside it. Only an export without a tag falls
   * back to the `account` option or a single linked account, so one account's data never lands on
   * another. Two exports for one account keep the newer one.
   */
  static matchExportsToAccounts<A extends { playerTag: string; name: string }>(
    exports: Array<{ fileName: string; village: VillageDataV2 }>,
    accounts: A[],
    fallbackTag?: string
  ): {
    byAccount: Map<string, { account: A; village: VillageDataV2; fileName: string }>;
    unmapped: string[];
    notices: string[];
  } {
    const byAccount = new Map<string, { account: A; village: VillageDataV2; fileName: string }>();
    const unmapped: string[] = [];
    const notices: string[] = [];
    const normalise = (tag: string) => (tag.startsWith('#') ? tag : `#${tag}`).toUpperCase();

    for (const exp of exports) {
      let account: A | undefined;
      if (exp.village.tag) {
        account = accounts.find((a) => a.playerTag.toUpperCase() === normalise(exp.village.tag));
      } else if (fallbackTag) {
        account = accounts.find((a) => a.playerTag.toUpperCase() === normalise(fallbackTag));
      } else if (accounts.length === 1) {
        account = accounts[0];
      }

      if (!account) {
        unmapped.push(exp.village.tag ? `\`${exp.village.tag}\` (${exp.fileName})` : exp.fileName);
        continue;
      }

      const key = account.playerTag.toUpperCase();
      const existing = byAccount.get(key);
      if (!existing) {
        byAccount.set(key, { account, ...exp });
        continue;
      }
      const keepNew = exp.village.exportTimestamp > existing.village.exportTimestamp;
      const [kept, dropped] = keepNew ? [exp, existing] : [existing, exp];
      notices.push(
        `ℹ️ Two exports for **${account.name}**: used **${kept.fileName}** (newer) and skipped **${dropped.fileName}**.`
      );
      if (keepNew) byAccount.set(key, { account, ...exp });
    }

    return { byAccount, unmapped, notices };
  }

  /** Returns stored village data in the current format, or null (older formats are discarded). */
  static read(villageData: any): VillageDataV2 | null {
    if (!villageData || villageData.version !== VILLAGE_DATA_VERSION) return null;
    const data = villageData as VillageDataV2;
    if (!data.heroTimersFixed) VillageImportService.fixHeroTimers(data);
    return data;
  }

  /**
   * Imports from before 2026-10-28 put each upgrading hero, and its timer, one level too high; moves
   * them down once (the flag is saved with the data the next time it's written).
   */
  static fixHeroTimers(data: VillageDataV2): void {
    for (const up of data.inProgressUpgrades ?? []) {
      if (up.category !== 'hero') continue;
      const item = data.items?.find(
        (i) => i.code === up.code && i.village === up.village && i.level === up.currentLevel
      );
      if (item) item.level -= 1;
      up.currentLevel -= 1;
      up.targetLevel -= 1;
    }
    data.heroTimersFixed = true;
  }

  static isStale(data: VillageDataV2, now: number = Date.now()): boolean {
    return now - data.exportTimestamp > STALE_EXPORT_MS;
  }

  /**
   * Groups stored items by code and level for display, with caps for the current hall and the next cost.
   * Sorted by next cost (most expensive first), maxed items last.
   */
  static groupsFor(
    data: VillageDataV2,
    village: Village,
    categories: readonly GameCategory[],
    hallOverride?: { townHall?: number; builderHall?: number }
  ): ParsedDefenseGroup[] {
    const hall = hallFor(data, village, hallOverride);
    const merged = new Map<string, ParsedDefenseGroup>();

    for (const vi of data.items) {
      if (vi.village !== village || !categories.includes(vi.category as GameCategory)) continue;
      const item = getById(vi.code) as GameItem;
      const key = `${vi.code}:${vi.level}`;
      const existing = merged.get(key);
      if (existing) {
        existing.count += vi.count;
        continue;
      }
      const maxLevel = capFor(item, hall, vi.level);
      const isMaxed = vi.level >= maxLevel;
      const next = isMaxed ? undefined : getLevel(item, vi.level + 1);
      merged.set(key, {
        code: vi.code,
        name: item.displayName,
        count: vi.count,
        currentLevel: vi.level,
        maxLevel,
        nextCost: next ? formatNextCost(item, vi.level) : '',
        nextCostNumber: next ? next.cost : 0,
        isMaxed,
        village,
      });
    }

    return [...merged.values()].sort((a, b) => {
      if (a.isMaxed !== b.isMaxed) return a.isMaxed ? 1 : -1;
      if (b.nextCostNumber !== a.nextCostNumber) return b.nextCostNumber - a.nextCostNumber;
      if (a.name !== b.name) return a.name.localeCompare(b.name);
      return b.currentLevel - a.currentLevel;
    });
  }

  /** Items whose code isn't in the game data yet (shown as `Unknown (code)`). */
  static unknownItems(data: VillageDataV2): VillageItem[] {
    return data.items.filter((i) => i.category === 'unknown');
  }

  /** "• 3x **Cannon**: Lv 13/17 — 1M Gold" (no count for a single item). */
  static formatGroupLine(d: ParsedDefenseGroup): string {
    const levelStr = `Lv ${d.currentLevel}/${d.maxLevel}`;
    const count = d.count > 1 ? `${d.count}x ` : '';
    if (d.isMaxed) return `• ${count}**${d.name}**: ${levelStr} — Maxed ✨`;
    return `• ${count}**${d.name}**: ${levelStr}${d.nextCost ? ` — ${d.nextCost}` : ''}`;
  }

  /**
   * One short line per item that still has upgrades left, e.g. "3x **Cannon**: Lv 12–13 → 17" (no count
   * for a single item), with a crafted defense's modules together: "**Inferno Candle** (3 modules): Lv 1 → 2".
   * Maxed items are left out; `/upgrades` and `/defenses` show everything, with costs. `count` is how
   * many items the lines cover.
   */
  static outstanding(
    data: VillageDataV2,
    village: Village,
    categories: readonly GameCategory[]
  ): { lines: string[]; count: number } {
    const byKey = new Map<
      string,
      { name: string; modules: boolean; count: number; lo: number; hi: number; cap: number }
    >();
    for (const g of VillageImportService.groupsFor(data, village, categories)) {
      if (g.isMaxed) continue;
      const parent = g.name.match(MODULE_NAME)?.[1];
      const key = parent ? `module:${parent}` : String(g.code);
      const e = byKey.get(key) ?? {
        name: parent ?? g.name,
        modules: Boolean(parent),
        count: 0,
        lo: g.currentLevel,
        hi: g.currentLevel,
        cap: g.maxLevel,
      };
      e.count += g.count;
      e.lo = Math.min(e.lo, g.currentLevel);
      e.hi = Math.max(e.hi, g.currentLevel);
      e.cap = Math.max(e.cap, g.maxLevel);
      byKey.set(key, e);
    }
    const entries = [...byKey.values()];
    return {
      count: entries.reduce((n, e) => n + e.count, 0),
      lines: entries.map((e) => {
        const levels = `Lv ${e.lo === e.hi ? e.lo : `${e.lo}–${e.hi}`} → ${e.cap}`;
        if (e.modules) return `• **${e.name}** (${e.count} module${e.count === 1 ? '' : 's'}): ${levels}`;
        return `• ${e.count > 1 ? `${e.count}x ` : ''}**${e.name}**: ${levels}`;
      }),
    };
  }

  /**
   * What's left to upgrade in one village of an import, by category, e.g. "🛡️ Defenses (32)". Heroes,
   * troops, spells and pets aren't listed, because `/upgrades` reads those live from the game.
   */
  static importSections(data: VillageDataV2, village: Village): ImportSection[] {
    const sections: ImportSection[] = IMPORT_SECTIONS[village].map(([title, categories, noun]) => {
      const { lines, count } = VillageImportService.outstanding(data, village, categories);
      return { title: `${title} (${count})`, village, noun, lines, count };
    });

    const unknown = VillageImportService.unknownItems(data).filter((u) => u.village === village);
    if (unknown.length > 0) {
      sections.push({
        title: '❔ Not in the game data yet',
        lines: unknown.map((u) => `• ${u.count}x **${nameForCode(u.code)}**: Lv ${u.level}`),
        count: unknown.reduce((n, u) => n + u.count, 0),
      });
    }
    return sections.filter((s) => s.lines.length > 0);
  }

  /** What's left in one village, in a line: "32 defenses · 10 traps · 19 buildings". */
  static importSummary(data: VillageDataV2, village: Village): string {
    const parts = VillageImportService.importSections(data, village)
      .filter((s) => s.noun)
      .map((s) => `${s.count} ${s.noun}${s.count === 1 ? '' : 's'}`);
    return parts.length > 0 ? parts.join(' · ') : '✨ All maxed';
  }

  /**
   * Shortens sections until they fit `budget` characters, trimming the longest first and ending each
   * trimmed one with "…and N more", so a whole import fits in one Discord message.
   */
  static fitSections(
    sections: Array<{ title: string; lines: string[] }>,
    budget: number,
    more: (hidden: number) => string = (hidden) => `…and ${hidden} more (see \`/upgrades\`)`
  ) {
    const out = sections.map((s) => ({ title: s.title, lines: [...s.lines], hidden: 0 }));
    const MORE_LINE = 45; // room for the "…and N more" line
    const size = () =>
      out.reduce(
        (n, s) => n + s.title.length + s.lines.reduce((m, l) => m + l.length + 1, 0) + (s.hidden ? MORE_LINE : 0),
        0
      );
    while (size() > budget) {
      const longest = out.filter((s) => s.lines.length > 1).sort((a, b) => b.lines.length - a.lines.length)[0];
      if (!longest) break;
      longest.lines.pop();
      longest.hidden++;
    }
    return out.map((s) => ({
      title: s.title,
      lines: s.hidden ? [...s.lines, more(s.hidden)] : s.lines,
    }));
  }

  /** Characters Discord counts towards its limit for one embed. */
  static embedSize(embed: any): number {
    return (
      (embed.title?.length ?? 0) +
      (embed.description?.length ?? 0) +
      (embed.footer?.text?.length ?? 0) +
      (embed.fields ?? []).reduce((n: number, f: any) => n + f.name.length + f.value.length, 0)
    );
  }

  /**
   * One line per running upgrade, soonest first, with a countdown and the date:
   * "• 2x **Spring Trap** → Lv 6 · in 5 hours (22/10/2026, 11:11)". The same upgrade finishing within an
   * hour shares a line. Callers list each village under its own heading.
   */
  static formatInProgressUpgrades(upgrades: InProgressUpgrade[], now: number = Date.now()): string {
    const rows: Array<{ up: InProgressUpgrade; count: number }> = [];
    const active = upgrades.filter((u) => u.finishesAtMs > now).sort((a, b) => a.finishesAtMs - b.finishesAtMs);
    for (const up of active) {
      const same = rows.find(
        (r) =>
          r.up.code !== undefined &&
          r.up.code === up.code &&
          r.up.village === up.village &&
          r.up.targetLevel === up.targetLevel &&
          up.finishesAtMs - r.up.finishesAtMs <= SAME_TIMER_WINDOW_MS
      );
      if (same) same.count++;
      else rows.push({ up, count: 1 });
    }
    return rows
      .map(({ up, count }) => {
        const name = up.code ? nameForCode(up.code) : up.name;
        return `• ${count > 1 ? `${count}x ` : ''}**${name}** → Lv ${up.targetLevel} · ${discordTime(up.finishesAtMs)}`;
      })
      .join('\n');
  }

  /**
   * Compares the previous import with a new one for the categories the import is the source for.
   * Items of one code are matched highest level first, so "3 Cannons went from 12 to 13" is found
   * even when the export lists them in a different order.
   */
  static detectImportChanges(oldData: VillageDataV2 | null, newData: VillageDataV2): ImportChange[] {
    if (!oldData) return [];
    const levelsByCode = (data: VillageDataV2) => {
      const map = new Map<string, number[]>();
      for (const vi of data.items) {
        if (!IMPORT_TRACKED_CATEGORIES.includes(vi.category as GameCategory)) continue;
        const key = `${vi.village}:${vi.code}`;
        const list = map.get(key) ?? [];
        for (let i = 0; i < vi.count; i++) list.push(vi.level);
        map.set(key, list);
      }
      for (const list of map.values()) list.sort((a, b) => b - a);
      return map;
    };

    const oldLevels = levelsByCode(oldData);
    const newLevels = levelsByCode(newData);
    const changes = new Map<string, ImportChange>();
    const record = (kind: ImportChange['kind'], item: GameItem, oldLevel: number, newLevel: number) => {
      const key = `${kind}:${item.village}:${item.id}:${oldLevel}:${newLevel}`;
      const existing = changes.get(key);
      if (existing) {
        existing.count += 1;
        return;
      }
      changes.set(key, {
        kind,
        code: item.id,
        name: item.displayName,
        category: item.category,
        village: item.village,
        oldLevel,
        newLevel,
        maxLevel: capFor(item, hallFor(newData, item.village), newLevel),
        count: 1,
      });
    };

    for (const [key, newList] of newLevels) {
      const item = getById(key.split(':')[1]);
      if (!item) continue;
      const oldList = oldLevels.get(key) ?? [];

      if (newList.length < oldList.length) {
        // Fewer than before, e.g. two Archer Towers merged into a Multi-Archer Tower; levels can't be paired
        continue;
      }

      // Extra items are new builds; they're the lowest-levelled ones
      const built = newList.slice(oldList.length);
      const kept = newList.slice(0, oldList.length);
      for (const level of built) {
        if (level === 1) record('built', item, 0, 1);
      }
      kept.forEach((level, i) => {
        if (level > oldList[i]) record('upgraded', item, oldList[i], level);
      });
    }

    return [...changes.values()];
  }

  /** Moves one item up a level when its timer runs out, so stored levels stay current until the next import. */
  static applyCompletedTimer(data: VillageDataV2, up: InProgressUpgrade): void {
    if (!up.code) return;
    const from = data.items.find((i) => i.code === up.code && i.village === up.village && i.level === up.currentLevel);
    if (from) {
      from.count -= 1;
      if (from.count <= 0) data.items.splice(data.items.indexOf(from), 1);
    }
    const to = data.items.find(
      (i) => i.code === up.code && i.village === up.village && i.level === up.targetLevel && !i.gearedUp
    );
    if (to) to.count += 1;
    else
      data.items.push({
        code: up.code,
        category: from?.category ?? getById(up.code)?.category ?? 'unknown',
        village: up.village,
        level: up.targetLevel,
        count: 1,
      });
  }

  /** B.O.B task 3: any Builder Base defense at level 9 or above in the latest import. */
  static hasBuilderDefenseAtLevel9(data: VillageDataV2 | null): boolean {
    return Boolean(data?.items.some((i) => i.village === 'builder' && i.category === 'defense' && i.level >= 9));
  }

  /** The Town Hall weapon level from the export, when the data has a weapon for that Town Hall (D9). */
  static weaponFor(data: VillageDataV2): { name: string; level: number; maxLevel: number } | null {
    const weapon = getWeapon(data.townHallLevel);
    if (!weapon || data.townHallWeaponLevel === undefined) return null;
    return { name: weapon.name, level: data.townHallWeaponLevel, maxLevel: weapon.levels.length };
  }
}
