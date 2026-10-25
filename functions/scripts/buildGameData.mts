/**
 * Builds functions/src/data/gameData.json from the ClashKing datamine at a pinned commit.
 *
 *   npm run build:game-data              # download the pinned commit
 *   npm run build:game-data -- --from <dir>   # use already-downloaded datamine files
 *
 * Update DATAMINE_COMMIT on purpose after a game update, then rerun and review the diff.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATAMINE_REPO = 'ClashKingInc/ClashKingAssets';
const DATAMINE_COMMIT = 'b8f42a707fe92d5293d46088bf536450ae422e7b'; // 2026-09-28 "september update contents"
const FILES = [
  'buildings',
  'traps',
  'heroes',
  'troops',
  'spells',
  'pets',
  'equipment',
  'helpers',
  'guardians',
] as const;

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.resolve(here, '../src/data/gameData.json');
const DISPLAY_NAMES_FILE = path.resolve(here, '../src/data/displayNames.json');
// A browsable copy for people (opens in Excel or Google Sheets); the bot never reads it
const REFERENCE_SHEET = path.resolve(here, '../../docs/Clash of Clans Codes (generated).csv');

type Village = 'home' | 'builder';
type Resource = 'gold' | 'elixir' | 'darkElixir' | 'builderGold' | 'builderElixir' | 'ores' | 'gems' | 'other';

interface Level {
  level: number;
  cost: number;
  hallRequired: number;
  upgradeSeconds?: number;
  ores?: { shiny: number; glowy: number; starry: number };
}

interface Item {
  id: number;
  name: string;
  displayName: string;
  category: string;
  village: Village;
  resource: Resource;
  event?: true;
  rarity?: 'Common' | 'Epic';
  hero?: string;
  parent?: number;
  levels: Level[];
  countByHall?: Record<number, number>;
}

const RESOURCES: Record<string, Resource> = {
  Gold: 'gold',
  Elixir: 'elixir',
  'Dark Elixir': 'darkElixir',
  'Builder Gold': 'builderGold',
  'Builder Elixir': 'builderElixir',
  Gems: 'gems',
};

// Items the game has but the pinned datamine doesn't yet. Each is replaced by the datamine's own entry
// once it has one (the generator then says so, and the entry here should be deleted). Caps are
// unknown until then, so these show the player's own level as the cap.
const MANUAL_ITEMS: Array<Omit<Item, 'displayName' | 'levels'> & { note: string }> = [
  {
    id: 90000061,
    name: 'Portal Pendant',
    category: 'equipment',
    village: 'home',
    resource: 'ores',
    rarity: 'Epic',
    hero: 'Minion Prince',
    note: 'Minion Prince Epic equipment from the October 2026 season; the datamine stops at 90000060 (checked 2026-10-25)',
  },
];

const BUILDING_CATEGORIES: Record<string, string> = {
  Defense: 'defense',
  Army: 'army',
  Resource: 'resource',
  'Town Hall': 'townHall',
  Wall: 'wall',
};

function fail(message: string): never {
  throw new Error(`[buildGameData] ${message}`);
}

function toResource(value: unknown, fallback: Resource): Resource {
  if (value === undefined) return fallback;
  return RESOURCES[String(value)] ?? 'other';
}

function toVillage(value: unknown): Village {
  if (value === undefined || value === 'home') return 'home';
  if (value === 'builderBase') return 'builder';
  return fail(`unknown village "${value}"`);
}

async function loadDatamine(fromDir?: string): Promise<Record<string, any[]>> {
  const out: Record<string, any[]> = {};
  for (const file of FILES) {
    let text: string;
    if (fromDir) {
      text = await readFile(path.join(fromDir, `${file}.json`), 'utf8');
    } else {
      const url = `https://raw.githubusercontent.com/${DATAMINE_REPO}/${DATAMINE_COMMIT}/assets/static_data/${file}.json`;
      const res = await fetch(url);
      if (!res.ok) fail(`download failed for ${url}: HTTP ${res.status}`);
      text = await res.text();
    }
    out[file] = JSON.parse(text).items;
  }
  return out;
}

function buildingLevels(levels: any[]): Level[] {
  return levels.map((l) => ({
    level: l.level,
    cost: l.build_cost ?? 0,
    hallRequired: l.required_townhall ?? 0,
    ...(l.build_time ? { upgradeSeconds: l.build_time } : {}),
  }));
}

function unitLevels(levels: any[]): Level[] {
  return levels.map((l) => {
    const ores = typeof l.upgrade_cost === 'object' && l.upgrade_cost !== null ? l.upgrade_cost : null;
    return {
      level: l.level,
      cost: ores ? 0 : (l.upgrade_cost ?? 0),
      hallRequired: l.required_townhall ?? 0,
      ...(l.upgrade_time ? { upgradeSeconds: l.upgrade_time } : {}),
      ...(ores
        ? { ores: { shiny: ores.shiny_ore ?? 0, glowy: ores.glowy_ore ?? 0, starry: ores.starry_ore ?? 0 } }
        : {}),
    };
  });
}

function buildingCategory(b: any): string {
  if (b.seasonal_defenses) return 'other'; // the Crafting Station has no levels of its own; its modules do
  if (b.type === 'BB Builder Hall') return b._id === 1000034 ? 'builderHall' : 'other';
  if (b.type === 'Worker') return b.levels.length > 0 ? 'defense' : 'other'; // Builder's Hut is upgradeable and attacks
  return BUILDING_CATEGORIES[b.type] ?? 'other';
}

function build(
  data: Record<string, any[]>,
  displayOverrides: Array<{ gameName: string; village: Village; displayName: string }>
) {
  const items: Record<string, Item> = {};
  const weapons: Record<number, { name: string; resource: Resource; levels: Level[] }> = {};

  const add = (item: Omit<Item, 'displayName'>) => {
    if (items[item.id]) fail(`duplicate code ${item.id}`);
    items[item.id] = { ...item, displayName: item.name };
  };

  for (const b of data.buildings) {
    add({
      id: b._id,
      name: b.name,
      category: buildingCategory(b),
      village: toVillage(b.village),
      resource: toResource(b.upgrade_resource, 'other'),
      levels: buildingLevels(b.levels),
    });

    // Town Hall weapons live on the hall level that has them (currently TH17's Inferno Artillery only)
    if (b._id === 1000001) {
      for (const l of b.levels) {
        if (!l.weapon) continue;
        weapons[l.level] = {
          name: l.weapon.name,
          resource: toResource(l.weapon.upgrade_resource, 'gold'),
          levels: buildingLevels(l.weapon.levels).map((wl) => ({ ...wl, hallRequired: l.level })),
        };
      }
    }

    // Crafted defenses and their modules are nested under the Crafting Station
    for (const defense of b.seasonal_defenses ?? []) {
      add({
        id: defense._id,
        name: defense.name,
        category: 'craftedDefense',
        village: 'home',
        resource: 'other',
        levels: [],
      });
      for (const m of defense.modules ?? []) {
        add({
          id: m._id,
          name: m.name,
          category: 'craftedModule',
          village: 'home',
          resource: toResource(m.upgrade_resource, 'other'),
          parent: defense._id,
          levels: buildingLevels(m.levels),
        });
      }
    }
  }

  for (const t of data.traps) {
    add({
      id: t._id,
      name: t.name,
      category: 'trap',
      village: toVillage(t.village),
      resource: toResource(t.upgrade_resource, 'other'),
      levels: buildingLevels(t.levels),
    });
  }

  for (const h of data.heroes) {
    add({
      id: h._id,
      name: h.name,
      category: 'hero',
      village: toVillage(h.village),
      resource: toResource(h.upgrade_resource, 'other'),
      levels: unitLevels(h.levels),
    });
  }

  for (const t of data.troops) {
    const category = t.super_troop ? 'superTroop' : t.production_building === 'Workshop' ? 'siege' : 'troop';
    add({
      id: t._id,
      name: t.name,
      category,
      village: toVillage(t.village),
      resource: toResource(t.upgrade_resource, 'other'),
      ...(t.is_seasonal ? { event: true as const } : {}),
      levels: unitLevels(t.levels),
    });
  }

  for (const s of data.spells) {
    add({
      id: s._id,
      name: s.name,
      category: 'spell',
      village: 'home',
      resource: toResource(s.upgrade_resource, 'other'),
      ...(s.is_seasonal ? { event: true as const } : {}),
      levels: unitLevels(s.levels),
    });
  }

  for (const p of data.pets) {
    add({
      id: p._id,
      name: p.name,
      category: 'pet',
      village: 'home',
      resource: toResource(p.upgrade_resource, 'darkElixir'),
      levels: unitLevels(p.levels),
    });
  }

  for (const e of data.equipment) {
    if (e.rarity !== 'Common' && e.rarity !== 'Epic') fail(`unknown equipment rarity "${e.rarity}" on ${e.name}`);
    add({
      id: e._id,
      name: e.name,
      category: 'equipment',
      village: 'home',
      resource: 'ores',
      rarity: e.rarity,
      hero: e.hero,
      levels: unitLevels(e.levels),
    });
  }

  for (const h of data.helpers) {
    add({
      id: h._id,
      name: h.name,
      category: 'helper',
      village: 'home',
      resource: toResource(h.upgrade_resource, 'gems'),
      levels: unitLevels(h.levels),
    });
  }

  for (const g of data.guardians) {
    add({
      id: g._id,
      name: g.name,
      category: 'guardian',
      village: 'home',
      resource: toResource(g.upgrade_resource, 'other'),
      levels: unitLevels(g.levels),
    });
  }

  for (const { note: _note, ...manual } of MANUAL_ITEMS) {
    if (items[manual.id]) {
      console.warn(
        `[buildGameData] ${manual.id} is now in the datamine as "${items[manual.id].name}"; delete it from MANUAL_ITEMS`
      );
      continue;
    }
    add({ ...manual, levels: [] });
  }

  // How many of each building and trap a hall level allows: the halls list what each level adds
  for (const [hallId, village] of [
    [1000001, 'home'],
    [1000034, 'builder'],
  ] as const) {
    const hall = data.buildings.find((b) => b._id === hallId) ?? fail(`hall ${hallId} missing`);
    const running: Record<number, number> = {};
    for (const l of hall.levels) {
      for (const u of l.unlocks ?? []) {
        const target = items[u._id];
        if (!target) fail(`hall ${hallId} level ${l.level} unlocks unknown code ${u._id}`);
        if (target.village !== village) fail(`${target.name} (${u._id}) unlocked by the wrong village's hall`);
        running[u._id] = (running[u._id] ?? 0) + u.quantity;
      }
      for (const [id, count] of Object.entries(running)) {
        (items[id].countByHall ??= {})[l.level] = count;
      }
    }
  }

  // Display names (D3): a Builder Base item whose name also exists in the home village gets " (BB)"
  const homeNames = new Set(
    Object.values(items)
      .filter((i) => i.village === 'home')
      .map((i) => i.name)
  );
  for (const item of Object.values(items)) {
    if (item.village === 'builder' && homeNames.has(item.name)) item.displayName = `${item.name} (BB)`;
  }
  for (const o of displayOverrides) {
    const matches = Object.values(items).filter((i) => i.name === o.gameName && i.village === o.village);
    if (matches.length === 0) fail(`displayNames.json: no "${o.gameName}" in the ${o.village} village`);
    for (const m of matches) m.displayName = o.displayName;
  }

  const hallLevels = (id: number) => items[id]?.levels.length ?? fail(`hall ${id} missing`);
  return {
    meta: {
      source: `https://github.com/${DATAMINE_REPO}/tree/${DATAMINE_COMMIT}/assets/static_data`,
      commit: DATAMINE_COMMIT,
      maxTownHall: hallLevels(1000001),
      maxBuilderHall: hallLevels(1000034),
    },
    items,
    weapons,
  };
}

/** Every code with its names, category, village and maximum level, as CSV (2.6 step 2.5). */
function referenceSheet(items: Record<string, Item>): string {
  const cell = (v: unknown) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = Object.values(items)
    .sort(
      (a, b) =>
        a.village.localeCompare(b.village) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name)
    )
    .map((i) => [
      i.id,
      i.name,
      i.displayName,
      i.category,
      i.village,
      i.levels.length ? Math.max(...i.levels.map((l) => l.level)) : '',
      i.event ? 'yes' : '',
    ]);
  return (
    [['Code', 'Game Name', 'Display Name', 'Category', 'Village', 'Max Level', 'Event Only'], ...rows]
      .map((r) => r.map(cell).join(','))
      .join('\n') + '\n'
  );
}

async function main() {
  const fromIdx = process.argv.indexOf('--from');
  const fromDir = fromIdx > 0 ? process.argv[fromIdx + 1] : undefined;
  const data = await loadDatamine(fromDir);
  const overrides = JSON.parse(await readFile(DISPLAY_NAMES_FILE, 'utf8'));
  const gameData = build(data, overrides);
  await writeFile(OUT_FILE, JSON.stringify(gameData) + '\n');
  await writeFile(REFERENCE_SHEET, referenceSheet(gameData.items));
  const counts: Record<string, number> = {};
  for (const i of Object.values(gameData.items)) counts[i.category] = (counts[i.category] ?? 0) + 1;
  console.log(
    `Wrote ${OUT_FILE}: ${Object.keys(gameData.items).length} items`,
    counts,
    `TH${gameData.meta.maxTownHall} / BH${gameData.meta.maxBuilderHall}`
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
