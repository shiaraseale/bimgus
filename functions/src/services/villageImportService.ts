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
import { EMOJIS } from '../constants/emojis';

export const VILLAGE_DATA_VERSION = 2;

/** One group of identical items (same code, village and level) from an export. */
export interface VillageItem {
  code: number;
  category: GameCategory | 'unknown';
  village: Village;
  level: number;
  count: number;
  gearedUp?: boolean;
}

export interface InProgressUpgrade {
  code?: number;
  name: string;
  category: GameCategory | 'unknown' | 'building' | 'townHall' | 'builderHall';
  village: Village;
  currentLevel: number;
  targetLevel: number;
  maxLevel: number;
  timerSeconds: number;
  finishesAtMs: number;
}

/** What one in-game export says about an account (both villages). Stored as `account.villageData`. */
export interface VillageDataV2 {
  version: 2;
  tag: string;
  exportTimestamp: number; // ms
  importedAt: string;
  townHallLevel: number;
  builderHallLevel: number;
  townHallWeaponLevel?: number;
  items: VillageItem[];
  inProgressUpgrades: InProgressUpgrade[];
  boosts: Record<string, unknown>;
}

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

const TOWN_HALL = 1000001;
const BUILDER_HALL = 1000034;
const STALE_EXPORT_MS = 24 * 60 * 60 * 1000;

// Categories whose completions the import is the source for; the live API covers the rest (2.4)
export const IMPORT_TRACKED_CATEGORIES: readonly GameCategory[] = [
  'defense', 'resource', 'army', 'other', 'trap', 'wall', 'guardian', 'craftedModule', 'helper',
];

function hallFor(data: VillageDataV2, village: Village, override?: { townHall?: number; builderHall?: number }): number {
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
      clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
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
    if (!exportSec) console.warn('[VillageImport] Export has no timestamp; using the import time');
    const exportTimestamp = exportSec ? exportSec * 1000 : now;

    const groups = new Map<string, VillageItem>();
    const inProgress: Array<Omit<InProgressUpgrade, 'maxLevel'>> = [];
    let townHallLevel = 0;
    let builderHallLevel = 0;
    let townHallWeaponLevel: number | undefined;

    const addItem = (code: number, village: Village, level: number, count: number, gearedUp: boolean, timer: number) => {
      const item = getById(code);
      if (!item) {
        nameForCode(code); // logs the unknown code once
      } else if (item.village !== village) {
        console.warn(`[VillageImport] ${item.name} (${code}) is listed in the ${village} village but the data says ${item.village}`);
      }
      const category = item?.category ?? 'unknown';
      const key = `${village}:${code}:${level}:${gearedUp ? 1 : 0}`;
      const existing = groups.get(key);
      if (existing) existing.count += count;
      else groups.set(key, { code, category, village, level, count, ...(gearedUp ? { gearedUp: true } : {}) });

      if (timer > 0) {
        inProgress.push({
          code,
          name: item?.displayName ?? nameForCode(code),
          category,
          village,
          currentLevel: level,
          targetLevel: level + 1,
          timerSeconds: timer,
          finishesAtMs: exportTimestamp + timer * 1000,
        });
      }
    };

    for (const [section, village] of SECTIONS) {
      const entries = exportJson[section];
      if (!Array.isArray(entries)) continue;

      for (const entry of entries) {
        const code = Number(entry?.data);
        if (!code) continue;

        // The Crafting Station has no level of its own; each crafted defense's modules do
        if (Array.isArray(entry.types)) {
          for (const type of entry.types) {
            for (const m of type.modules ?? []) {
              addItem(Number(m.data), village, Number(m.lvl) || 0, 1, false, Number(m.timer) || 0);
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
        addItem(code, village, level, Number(entry.cnt) || 1, Boolean(entry.gear_up), Number(entry.timer) || 0);
      }
    }

    if (!townHallLevel) throw new Error('The export has no Town Hall, so it can\'t be read.');

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
      boosts: exportJson.boosts && typeof exportJson.boosts === 'object' ? exportJson.boosts : {},
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
      notices.push(`ℹ️ Two exports for **${account.name}**: used **${kept.fileName}** (newer) and skipped **${dropped.fileName}**.`);
      if (keepNew) byAccount.set(key, { account, ...exp });
    }

    return { byAccount, unmapped, notices };
  }

  /** Returns stored village data in the current format, or null (older formats are discarded). */
  static read(villageData: any): VillageDataV2 | null {
    return villageData && villageData.version === VILLAGE_DATA_VERSION ? (villageData as VillageDataV2) : null;
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

  static formatGroupLine(d: ParsedDefenseGroup): string {
    const levelStr = `Lv ${d.currentLevel}/${d.maxLevel}`;
    if (d.isMaxed) return `• ${d.count}x **${d.name}**: ${levelStr} — Maxed ✨`;
    return `• ${d.count}x **${d.name}**: ${levelStr}${d.nextCost ? ` — ${d.nextCost}` : ''}`;
  }

  /**
   * The import result for one account, one section per category for each village.
   */
  static importSections(data: VillageDataV2): Array<{ title: string; lines: string[] }> {
    const th = data.townHallLevel;
    const bh = data.builderHallLevel;
    const section = (title: string, village: Village, categories: GameCategory[]) => ({
      title,
      lines: VillageImportService.groupsFor(data, village, categories).map(VillageImportService.formatGroupLine),
    });

    const sections = [
      section(`🛡️ Defenses (TH${th})`, 'home', ['defense']),
      section(`💣 Traps (TH${th})`, 'home', ['trap']),
      section(`🏛️ Resource & Army (TH${th})`, 'home', ['resource', 'army', 'other']),
      section(`🧱 Walls (TH${th})`, 'home', ['wall']),
      section(`🗿 Guardians (TH${th})`, 'home', ['guardian']),
      section(`🕯️ Crafted Defenses (TH${th})`, 'home', ['craftedModule']),
      section(`${EMOJIS.CROWN} Heroes (TH${th})`, 'home', ['hero']),
      section(`🧪 Laboratory (TH${th})`, 'home', ['troop', 'siege', 'spell']),
      section(`🐾 Pets (TH${th})`, 'home', ['pet']),
      section(`🛠️ Helpers (TH${th})`, 'home', ['helper']),
    ];
    if (bh > 0) {
      sections.push(
        section(`🔨 BB Defenses (BH${bh})`, 'builder', ['defense']),
        section(`💣 BB Traps (BH${bh})`, 'builder', ['trap']),
        section(`🏛️ BB Resource & Army (BH${bh})`, 'builder', ['resource', 'army', 'other']),
        section(`🧱 BB Walls (BH${bh})`, 'builder', ['wall']),
        section(`${EMOJIS.CROWN} BB Heroes (BH${bh})`, 'builder', ['hero']),
        section(`⚔️ BB Troops (BH${bh})`, 'builder', ['troop'])
      );
    }

    const unknown = VillageImportService.unknownItems(data);
    if (unknown.length > 0) {
      sections.push({
        title: '❔ Not in the game data yet',
        lines: unknown.map((u) => `• ${u.count}x **${nameForCode(u.code)}**: Lv ${u.level}`),
      });
    }
    return sections.filter((s) => s.lines.length > 0);
  }

  /** Splits lines into embed fields under Discord's 1,024-character field limit. */
  static linesToFields(title: string, lines: string[]): Array<{ name: string; value: string; inline: boolean }> {
    const fields: Array<{ name: string; value: string; inline: boolean }> = [];
    let current: string[] = [];
    let length = 0;
    const flush = () => {
      if (current.length === 0) return;
      fields.push({ name: fields.length === 0 ? title : `${title} (cont.)`, value: current.join('\n'), inline: false });
      current = [];
      length = 0;
    };
    for (const line of lines) {
      if (length + line.length + 1 > 1000) flush();
      current.push(line.length > 1000 ? line.slice(0, 997) + '...' : line);
      length += line.length + 1;
    }
    flush();
    return fields;
  }

  /**
   * Builds as many embeds as needed: Discord allows 25 fields and 6,000 characters per embed.
   */
  static fieldsToEmbeds(
    base: { title: string; description: string; color: number; thumbnail?: { url: string }; footer?: { text: string } },
    fields: Array<{ name: string; value: string; inline: boolean }>
  ): any[] {
    const embeds: any[] = [];
    let current: any[] = [];
    let size = base.title.length + base.description.length + (base.footer?.text.length ?? 0);
    const flush = () => {
      const first = embeds.length === 0;
      embeds.push({
        ...base,
        title: first ? base.title : `${base.title} (cont.)`,
        description: first ? base.description : undefined,
        fields: current,
        timestamp: new Date().toISOString(),
      });
      current = [];
      size = base.title.length + 10 + (base.footer?.text.length ?? 0);
    };
    for (const f of fields) {
      const fieldSize = f.name.length + f.value.length;
      if (current.length > 0 && (current.length >= 25 || size + fieldSize > 5500)) flush();
      current.push(f);
      size += fieldSize;
    }
    if (current.length > 0 || embeds.length === 0) flush();
    return embeds;
  }

  /**
   * Formats in-progress upgrades with dynamic Discord countdown timers.
   */
  static formatInProgressUpgrades(upgrades: InProgressUpgrade[], now: number = Date.now()): string {
    const active = upgrades.filter((u) => u.finishesAtMs > now);
    if (active.length === 0) return '';

    return active
      .map((u) => {
        let prefix = '🏰 ';
        if (u.village === 'builder') {
          prefix = '🔨 [BB] ';
        } else if (u.category === 'hero') {
          prefix = `${EMOJIS.CROWN} `;
        } else if (u.category === 'troop' || u.category === 'spell' || u.category === 'siege') {
          prefix = '🧪 ';
        }
        const name = u.code ? nameForCode(u.code) : u.name;
        const targetStr = u.maxLevel > 0 ? `Lv ${u.targetLevel}/${u.maxLevel}` : `Lv ${u.targetLevel}`;
        const finishesSec = Math.floor(u.finishesAtMs / 1000);
        return `• ${prefix}**${name}**: Upgrading to **${targetStr}** — finishes <t:${finishesSec}:R> (<t:${finishesSec}:t>)`;
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
    const to = data.items.find((i) => i.code === up.code && i.village === up.village && i.level === up.targetLevel && !i.gearedUp);
    if (to) to.count += 1;
    else data.items.push({ code: up.code, category: from?.category ?? (getById(up.code)?.category ?? 'unknown'), village: up.village, level: up.targetLevel, count: 1 });
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
