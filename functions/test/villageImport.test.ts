import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import exportFixture from './fixtures/export-th12-bh9.json';
import { VillageDataV2, VillageImportService, boostedSeconds } from '../src/services/villageImportService';
import { getByName } from '../src/services/gameDataService';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const total = (data: VillageDataV2, code: number, village: 'home' | 'builder' = 'home') =>
  data.items.filter((i) => i.code === code && i.village === village).reduce((n, i) => n + i.count, 0);

describe('parseExport (one file, both villages)', () => {
  let data: VillageDataV2;
  beforeAll(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    data = VillageImportService.parseExport(exportFixture);
    vi.restoreAllMocks();
  });
  afterEach(() => vi.restoreAllMocks());

  it('reads both villages from one export', () => {
    expect(data.version).toBe(2);
    expect(data.townHallLevel).toBe(12);
    expect(data.builderHallLevel).toBe(9);
    expect(data.items.some((i) => i.village === 'home')).toBe(true);
    expect(data.items.some((i) => i.village === 'builder')).toBe(true);
    expect(data.exportTimestamp).toBe(1792648604 * 1000);
  });

  it('counts items listed separately (upgrading, geared up) and missing cnt as 1', () => {
    expect(total(data, 1000008)).toBe(7); // Cannons
    expect(total(data, 1000009)).toBe(8); // Archer Towers
    expect(total(data, 1000010)).toBe(300); // Walls
    expect(total(data, 1000015)).toBe(5); // Builder's Huts
    expect(
      data.items
        .filter((i) => i.gearedUp)
        .map((i) => i.code)
        .sort()
    ).toEqual([1000008, 1000009, 1000013]);
  });

  it('finds all 7 timers, including both Spring Traps, the Star Laboratory and the Rage Spell', () => {
    expect(data.inProgressUpgrades).toHaveLength(7);
    const names = data.inProgressUpgrades.map((u) => u.name);
    expect(names.filter((n) => n === 'Spring Trap')).toHaveLength(2);
    expect(names).toContain('Rage Spell');
    const starLab = getByName('Star Laboratory', 'builder')!;
    expect(data.inProgressUpgrades.some((u) => u.code === starLab.id && u.village === 'builder')).toBe(true);
    const rage = data.inProgressUpgrades.find((u) => u.name === 'Rage Spell')!;
    expect(rage.currentLevel).toBe(5);
    expect(rage.targetLevel).toBe(6);
    expect(rage.maxLevel).toBe(6); // TH12 cap from the datamine, not lvl + 1 by coincidence
  });

  it('uses real caps for in-progress buildings', () => {
    const cannon = data.inProgressUpgrades.find((u) => u.code === 1000008)!;
    expect(cannon.maxLevel).toBe(17); // TH12 Cannon cap
  });

  it('reads the Crafting Station as three crafted defenses with three modules each', () => {
    const modules = data.items.filter((i) => i.category === 'craftedModule');
    expect(modules).toHaveLength(9);
    expect(data.items.some((i) => i.code === 1000097)).toBe(false); // the station itself has no level
  });

  it('records the Town Hall weapon level, but only shows a weapon where the data has one (D9)', () => {
    expect(data.townHallWeaponLevel).toBe(1);
    expect(VillageImportService.weaponFor(data)).toBeNull();
  });

  it('summarises only what is left to upgrade, one line per item, with real names', () => {
    const sections = [
      ...VillageImportService.importSections(data, 'home'),
      ...VillageImportService.importSections(data, 'builder'),
    ];
    const text = sections.map((s) => `${s.title}\n${s.lines.join('\n')}`).join('\n');
    expect(text.match(/\(\d{7,}\)/g) ?? []).toEqual([]);
    expect(text).not.toContain('Maxed');
    expect(text).toContain('Cannon (BB)');
    expect(text).toContain('• 180x **Wall (BB)**: Lv 4–5 → 9');
    expect(text).toContain('• **Mega Tesla**: Lv 3 → 9'); // a single item has no count
    expect(text).not.toContain('**Wall**:'); // the home walls are maxed for TH12
    // Heroes, the lab and pets are left to /status, which reads them live
    expect(sections.map((s) => s.title).join(' ')).not.toMatch(/Heroes|Laboratory|Pets|Troops/);
    // One line per item: the 7 Cannons appear once, even though they're at different levels
    expect(text.match(/\*\*Cannon\*\*/g)?.length ?? 0).toBeLessThanOrEqual(1);
    // A crafted defense's three modules share a line
    expect(text).toContain('• **Inferno Candle** (3 modules): Lv 1 → 2');
    expect(text).not.toContain('Attack Module');
  });

  it('sums up what is left in one line per village', () => {
    expect(VillageImportService.importSummary(data, 'home')).toBe(
      '32 defenses · 10 traps · 19 buildings · 9 modules · 4 helpers'
    );
    expect(VillageImportService.importSummary(data, 'builder')).toBe(
      '24 defenses · 20 traps · 18 buildings · 180 walls'
    );
  });

  it('has hero caps for TH12 / BH9', () => {
    const heroes = [
      ...VillageImportService.groupsFor(data, 'home', ['hero']),
      ...VillageImportService.groupsFor(data, 'builder', ['hero']),
    ];
    const cap = (name: string) => heroes.find((h) => h.name === name)!.maxLevel;
    expect(cap('Barbarian King')).toBe(65);
    expect(cap('Archer Queen')).toBe(65);
    expect(cap('Grand Warden')).toBe(40);
    expect(cap('Minion Prince')).toBe(40);
    expect(cap('Battle Machine')).toBe(30);
    expect(cap('Battle Copter')).toBe(30);
  });

  it('trims the longest sections to fit a size budget, saying how many were left out', () => {
    const sections = [
      ...VillageImportService.importSections(data, 'home'),
      ...VillageImportService.importSections(data, 'builder'),
    ];
    const fitted = VillageImportService.fitSections(sections, 1500);
    const size = fitted.reduce((n, s) => n + s.title.length + s.lines.join('\n').length + 1, 0);
    expect(size).toBeLessThanOrEqual(1500);
    expect(fitted.map((s) => s.title)).toEqual(sections.map((s) => s.title));
    expect(fitted.some((s) => s.lines.some((l) => /…and \d+ more/.test(l)))).toBe(true);
    // A generous budget changes nothing
    expect(VillageImportService.fitSections(sections, 100_000).map((s) => s.lines)).toEqual(
      sections.map((s) => s.lines)
    );
  });

  it('discards stored data from before version 2', () => {
    expect(VillageImportService.read({ homeDefenses: [] })).toBeNull();
    expect(VillageImportService.read(data)).toBe(data);
  });

  it('warns when an export is over a day old', () => {
    expect(VillageImportService.isStale(data, data.exportTimestamp + 25 * 3600 * 1000)).toBe(true);
    expect(VillageImportService.isStale(data, data.exportTimestamp + 3600 * 1000)).toBe(false);
  });

  it('shows each timer on one short line, soonest first, as a countdown with its date', () => {
    const lines = VillageImportService.formatInProgressUpgrades(data.inProgressUpgrades, data.exportTimestamp).split(
      '\n'
    );
    const xBow = data.inProgressUpgrades.find((u) => u.name === 'X-Bow')!;
    const sec = Math.floor(xBow.finishesAtMs / 1000);
    expect(lines.at(-1)).toBe(`• **X-Bow** → Lv 6 · <t:${sec}:R> (<t:${sec}:s>)`);
    // The two Spring Traps finishing minutes apart share a line
    expect(lines[0]).toMatch(/^• \*\*Star Laboratory\*\* → Lv 9 · /);
    expect(lines[1]).toMatch(/^• 2x \*\*Spring Trap\*\* → Lv 6 · /);
    expect(lines).toHaveLength(6);
  });

  it('reads an upgrading hero at its current level: the export, like the API, shows the new one', () => {
    const upgrading = clone(exportFixture) as any;
    upgrading.heroes.find((h: any) => h.data === 28000001).timer = 3600; // Archer Queen, listed at 37
    const parsed = VillageImportService.parseExport(upgrading);
    const queen = parsed.inProgressUpgrades.find((u) => u.code === 28000001)!;
    expect([queen.currentLevel, queen.targetLevel]).toEqual([36, 37]);
    expect(parsed.items.find((i) => i.code === 28000001)?.level).toBe(36);
    expect(parsed.heroTimersFixed).toBe(true);
  });

  it('moves the upgrading heroes in imports from before that fix down a level, once', () => {
    const upgrading = clone(exportFixture) as any;
    upgrading.heroes.find((h: any) => h.data === 28000001).timer = 3600;
    const stored = clone(VillageImportService.parseExport(upgrading)) as any;
    // As an older import stored it: the hero and its timer a level too high
    delete stored.heroTimersFixed;
    stored.items.find((i: any) => i.code === 28000001).level = 37;
    Object.assign(
      stored.inProgressUpgrades.find((u: any) => u.code === 28000001),
      { currentLevel: 37, targetLevel: 38 }
    );
    const cannonTimer = { ...stored.inProgressUpgrades.find((u: any) => u.name === 'Cannon') };

    const read = VillageImportService.read(stored)!;
    const queen = read.inProgressUpgrades.find((u) => u.code === 28000001)!;
    expect([queen.currentLevel, queen.targetLevel]).toEqual([36, 37]);
    expect(read.items.find((i) => i.code === 28000001)?.level).toBe(36);
    expect(read.inProgressUpgrades.find((u) => u.name === 'Cannon')).toEqual(cannonTimer);
    // Reading it again changes nothing
    VillageImportService.read(read);
    expect(queen.targetLevel).toBe(37);
  });

  it('keeps the same upgrade on separate lines when the timers are hours apart', () => {
    const trap = data.inProgressUpgrades.find((u) => u.name === 'Spring Trap')!;
    const later = { ...trap, finishesAtMs: trap.finishesAtMs + 2 * 3600 * 1000 };
    const text = VillageImportService.formatInProgressUpgrades([trap, later], data.exportTimestamp);
    expect(text.split('\n')).toHaveLength(2);
    expect(text).not.toContain('2x');
  });
});

describe('matching exports to accounts', () => {
  const parse = (tag: string, ts: number) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const json = { ...clone(exportFixture), tag, timestamp: ts };
    return VillageImportService.parseExport(json);
  };
  const accounts = [
    { playerTag: '#AAA', name: 'Main' },
    { playerTag: '#BBB', name: 'Mini' },
  ];

  it('keeps the newer of two exports for the same account and says so', () => {
    const result = VillageImportService.matchExportsToAccounts(
      [
        { fileName: 'old.json', village: parse('#AAA', 1000) },
        { fileName: 'new.json', village: parse('#AAA', 2000) },
        { fileName: 'mini.json', village: parse('#BBB', 1500) },
      ],
      accounts
    );
    expect(result.byAccount.get('#AAA')!.fileName).toBe('new.json');
    expect(result.byAccount.get('#BBB')!.fileName).toBe('mini.json');
    expect(result.notices[0]).toContain('new.json');
  });

  it('never puts an export with another tag on a linked account', () => {
    const result = VillageImportService.matchExportsToAccounts(
      [{ fileName: 'x.json', village: parse('#ZZZ', 1) }],
      [accounts[0]]
    );
    expect(result.byAccount.size).toBe(0);
    expect(result.unmapped).toHaveLength(1);
  });
});

describe('detectImportChanges', () => {
  const base = () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    return VillageImportService.parseExport(clone(exportFixture));
  };
  const bump = (data: VillageDataV2, code: number, fromLevel: number, count: number) => {
    const from = data.items.find(
      (i) => i.code === code && i.level === fromLevel && i.village === 'home' && i.count >= count
    )!;
    from.count -= count;
    data.items.push({ ...from, level: fromLevel + 1, count, gearedUp: undefined });
  };

  it('finds one upgraded cannon', () => {
    const before = base();
    const after = base();
    bump(after, 1000008, 13, 1);
    const changes = VillageImportService.detectImportChanges(before, after);
    expect(changes).toEqual([
      expect.objectContaining({ kind: 'upgraded', code: 1000008, oldLevel: 13, newLevel: 14, count: 1, maxLevel: 17 }),
    ]);
  });

  it('reports 40 walls going up a level as one change', () => {
    const before = base();
    const after = base();
    const wallLevel = after.items.find((i) => i.code === 1000010 && i.count >= 40)!.level;
    bump(after, 1000010, wallLevel, 40);
    const changes = VillageImportService.detectImportChanges(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ category: 'wall', count: 40, newLevel: wallLevel + 1 });
  });

  it('reports a newly built level-1 building as built', () => {
    const before = base();
    const after = base();
    after.items.push({ code: 1000008, category: 'defense', village: 'home', level: 1, count: 1 });
    const changes = VillageImportService.detectImportChanges(before, after);
    expect(changes).toEqual([expect.objectContaining({ kind: 'built', code: 1000008, newLevel: 1 })]);
  });

  it('never reports equipment, heroes or lab items (the live API covers those)', () => {
    const before = base();
    const after = base();
    for (const i of after.items) if (['equipment', 'hero', 'troop', 'spell'].includes(i.category)) i.level += 1;
    expect(VillageImportService.detectImportChanges(before, after)).toEqual([]);
  });

  it('finds nothing without a previous import', () => {
    expect(VillageImportService.detectImportChanges(null, base())).toEqual([]);
  });

  it('moves one item up a level when a timer completes', () => {
    const data = base();
    const up = data.inProgressUpgrades.find((u) => u.code === 1000008)!;
    VillageImportService.applyCompletedTimer(data, up);
    expect(total(data, 1000008)).toBe(7);
    expect(data.items.some((i) => i.code === 1000008 && i.level === 14 && i.count === 1)).toBe(true);
  });
});

describe('boosted timers', () => {
  const HOUR = 3600;
  afterEach(() => vi.restoreAllMocks());

  it('works out real time left with one or more boosts', () => {
    expect(boostedSeconds(5 * HOUR, [])).toBe(5 * HOUR);
    // A 10x potion for 1 hour does 10 hours of work, so a 5 hour upgrade finishes in 30 minutes
    expect(boostedSeconds(5 * HOUR, [{ seconds: HOUR, rate: 10 }])).toBe(HOUR / 2);
    // 20 hours left: 10 in the potion's hour, then 10 more at normal speed
    expect(boostedSeconds(20 * HOUR, [{ seconds: HOUR, rate: 10 }])).toBe(11 * HOUR);
    // Potion (10x, 1h) with a level 4 apprentice (5x, 1h) overlapping: 14x for the hour
    expect(
      boostedSeconds(20 * HOUR, [
        { seconds: HOUR, rate: 10 },
        { seconds: HOUR, rate: 5 },
      ])
    ).toBe(7 * HOUR);
    // Different lengths: 14 h of work in the first hour, 10 h in the second, then 6 h at normal speed
    expect(
      boostedSeconds(30 * HOUR, [
        { seconds: 2 * HOUR, rate: 10 },
        { seconds: HOUR, rate: 5 },
      ])
    ).toBe(8 * HOUR);
  });

  it("applies the export's boosts and helper timers to the matching upgrades only", () => {
    const exp = clone(exportFixture) as any;
    exp.boosts = { builder_boost: HOUR, lab_boost: HOUR, clocktower_boost: 1800, clocktower_cooldown: 9999 };
    const cannon = exp.buildings.find((b: any) => b.data === 1000008 && b.timer); // 22680 s
    cannon.helper_timer = HOUR;
    const data = VillageImportService.parseExport(exp);
    const find = (code: number, village = 'home') =>
      data.inProgressUpgrades.find((u) => u.code === code && u.village === village)!;
    const exportMs = data.exportTimestamp;

    // Cannon: builder potion (10x) plus a level 4 apprentice (5x) for an hour = 14x
    expect(find(1000008).timerSeconds).toBe(Math.ceil(22680 / 14));
    // Rage Spell: 24x research potion for an hour does 24 h; 122052 s needs a little more
    expect(find(26000002).timerSeconds).toBe(HOUR + (122052 - 24 * HOUR));
    // Builder Base: Clock Tower 10x for 30 minutes
    expect(find(1000046, 'builder').timerSeconds).toBe(Math.ceil(9726 / 10));
    expect(find(1000046, 'builder').finishesAtMs).toBe(exportMs + Math.ceil(9726 / 10) * 1000);
    expect(data.boosts).toEqual(exp.boosts);
  });

  it('leaves timers alone without boosts, and warns about boosts it does not know', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const exp = clone(exportFixture) as any;
    exp.boosts = { mystery_boost: 100 };
    const data = VillageImportService.parseExport(exp);
    expect(data.inProgressUpgrades.find((u) => u.code === 1000008)!.timerSeconds).toBe(22680);
    expect(warn.mock.calls.flat().join(' ')).toContain('mystery_boost');
  });
});
