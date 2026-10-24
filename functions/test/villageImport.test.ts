import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import exportFixture from './fixtures/export-th12-bh9.json';
import { VillageDataV2, VillageImportService } from '../src/services/villageImportService';
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

  it('shows real names: the only unknown is the equipment newer than the datamine', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const text = VillageImportService.importSections(data)
      .map((s) => `${s.title}\n${s.lines.join('\n')}`)
      .join('\n');
    const ids = text.match(/\(\d{7,}\)/g) ?? [];
    expect(ids).toEqual(['(90000061)']);
    expect(text).toContain('Unknown (90000061)');
    expect(text).toContain('Cannon (BB)');
    expect(text).toContain('**Wall**');
    expect(text).toContain('**Workshop**');
    expect(text).toContain('**Hero Hall**');
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

  it('fits Discord limits when split into embeds', () => {
    const fields = VillageImportService.importSections(data).flatMap((s) =>
      VillageImportService.linesToFields(s.title, s.lines)
    );
    const embeds = VillageImportService.fieldsToEmbeds({ title: 'T', description: 'D', color: 0 }, fields);
    for (const e of embeds) {
      expect(e.fields.length).toBeLessThanOrEqual(25);
      const size =
        e.title.length +
        (e.description?.length ?? 0) +
        e.fields.reduce((n: number, f: any) => n + f.name.length + f.value.length, 0);
      expect(size).toBeLessThanOrEqual(6000);
      for (const f of e.fields) expect(f.value.length).toBeLessThanOrEqual(1024);
    }
  });

  it('discards stored data from before version 2', () => {
    expect(VillageImportService.read({ homeDefenses: [] })).toBeNull();
    expect(VillageImportService.read(data)).toBe(data);
  });

  it('warns when an export is over a day old', () => {
    expect(VillageImportService.isStale(data, data.exportTimestamp + 25 * 3600 * 1000)).toBe(true);
    expect(VillageImportService.isStale(data, data.exportTimestamp + 3600 * 1000)).toBe(false);
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
