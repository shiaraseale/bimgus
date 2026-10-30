import { describe, it, expect, vi, afterEach } from 'vitest';
import exportFixture from './fixtures/export-th12-bh9.json';
import apiFixture from './fixtures/api-player-th12.json';
import {
  MAX_BUILDER_HALL,
  MAX_TOWN_HALL,
  capFor,
  formatNextCost,
  getById,
  getByName,
  getMaxLevelForHall,
  getWeapon,
  itemsIn,
  nameForCode,
  nextUpgradeRow,
} from '../src/services/gameDataService';
import { PlayerTrackingService, apiCap } from '../src/services/playerTrackingService';

const hero = (name: string) => getByName(name, name.startsWith('Battle') ? 'builder' : 'home', ['hero'])!;

describe('game data', () => {
  afterEach(() => vi.restoreAllMocks());

  it('covers Town Hall 18 and Builder Hall 10', () => {
    expect(MAX_TOWN_HALL).toBe(18);
    expect(MAX_BUILDER_HALL).toBe(10);
  });

  it('has the datamine hero caps, including the ones the old tables had wrong', () => {
    const caps = (name: string, halls: number[]) => halls.map((h) => getMaxLevelForHall(hero(name), h));
    expect(caps('Barbarian King', [7, 8, 12, 14, 18])).toEqual([10, 20, 65, 85, 110]);
    expect(caps('Archer Queen', [12, 14, 18])).toEqual([65, 85, 110]);
    expect(caps('Grand Warden', [12, 14, 18])).toEqual([40, 60, 85]);
    expect(caps('Royal Champion', [13, 18])).toEqual([25, 55]);
    expect(caps('Minion Prince', [12, 18])).toEqual([40, 95]);
    expect(caps('Dragon Duke', [14, 15, 18])).toEqual([0, 10, 25]);
    expect(caps('Battle Machine', [9])).toEqual([30]);
    expect(caps('Battle Copter', [9])).toEqual([30]);
  });

  it('gives a TH18 account TH18 caps for every hero, troop and spell (no TH17 fallback)', () => {
    for (const item of itemsIn('home', ['hero', 'troop', 'spell'])) {
      if (item.levels.length === 0 || item.event) continue;
      const top = Math.max(...item.levels.map((l) => l.level));
      expect(getMaxLevelForHall(item, 18), item.name).toBe(top);
    }
  });

  it('uses the highest data level and warns once when a hall is newer than the data', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(getMaxLevelForHall(hero('Barbarian King'), 19)).toBe(110);
    expect(getMaxLevelForHall(hero('Archer Queen'), 19)).toBe(110);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('never shows a cap below the current level', () => {
    expect(capFor(getByName('Barbarian', 'home', ['troop'])!, 1, 1)).toBeGreaterThanOrEqual(1);
  });

  it('resolves every code in the real export', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const unknown = new Set<number>();
    const sections = [
      'helpers',
      'buildings',
      'traps',
      'units',
      'siege_machines',
      'heroes',
      'spells',
      'pets',
      'equipment',
      'buildings2',
      'traps2',
      'units2',
      'heroes2',
    ];
    for (const section of sections) {
      for (const entry of (exportFixture as any)[section] ?? []) {
        if (!getById(entry.data)) unknown.add(entry.data);
        for (const t of entry.types ?? []) {
          if (!getById(t.data)) unknown.add(t.data);
          for (const m of t.modules ?? []) if (!getById(m.data)) unknown.add(m.data);
        }
      }
    }
    expect([...unknown]).toEqual([]);
    // Added by hand until the datamine has it (MANUAL_ITEMS in buildGameData.mts)
    expect(nameForCode(90000061)).toBe('Portal Pendant');
    expect(nameForCode(99999999)).toBe('Unknown (99999999)');
    expect(warn).toHaveBeenCalled();
  });

  it('puts every export item in the village its section implies', () => {
    for (const [section, village] of [
      ['buildings', 'home'],
      ['buildings2', 'builder'],
      ['units2', 'builder'],
      ['heroes2', 'builder'],
    ] as const) {
      for (const entry of (exportFixture as any)[section]) {
        expect(getById(entry.data)?.village, `${section} ${entry.data}`).toBe(village);
      }
    }
  });

  it('uses the correct names for codes the old data and spreadsheet got wrong', () => {
    expect(nameForCode(1000068)).toBe('Pet House');
    expect(nameForCode(1000070)).toBe('Blacksmith');
    expect(nameForCode(1000071)).toBe('Hero Hall');
    expect(nameForCode(28000003)).toBe('Battle Machine');
    expect(nameForCode(28000006)).toBe('Minion Prince');
    expect(nameForCode(28000007)).toBe('Dragon Duke');
    expect(nameForCode(90000013)).toBe('Rocket Spear');
    expect(nameForCode(1000059)).toBe('Workshop');
    expect(nameForCode(26000002)).toBe('Rage Spell');
  });

  it('adds "(BB)" to the 12 Builder Base names that also exist at home, and only those', () => {
    const bb = Object.values(
      itemsIn('builder', ['defense', 'resource', 'army', 'trap', 'wall', 'troop', 'hero', 'other', 'builderHall'])
    )
      .filter((i) => i.displayName.endsWith(' (BB)'))
      .map((i) => i.name)
      .sort();
    expect(bb).toEqual([
      'Archer Tower',
      'Army Camp',
      'Baby Dragon',
      'Cannon',
      'Elixir Collector',
      'Elixir Storage',
      'Gold Mine',
      'Gold Storage',
      'Hidden Tesla',
      'Spring Trap',
      'Wall',
      'X-Bow',
    ]);
    expect(getByName('Cannon', 'home')!.displayName).toBe('Cannon');
    expect(getByName('Crusher', 'builder')!.displayName).toBe('Crusher');
  });

  it('only has a Town Hall weapon at TH17', () => {
    expect(getWeapon(17)?.name).toBe('Inferno Artillery');
    expect(getWeapon(17)?.levels).toHaveLength(5);
    for (const th of [12, 13, 14, 15, 16, 18]) expect(getWeapon(th)).toBeUndefined();
  });

  it('formats real next-level costs', () => {
    expect(formatNextCost(getById(1000001)!, 12)).toMatch(/^9M /);
    expect(formatNextCost(getById(90000013)!, 1)).toContain('shiny_ore');
  });
});

describe('next upgrade costs', () => {
  const byName = (name: string) =>
    itemsIn('home', ['hero', 'resource', 'craftedModule', 'spell', 'troop', 'wall']).find((i) => i.name === name)!;
  const boost = { builder: 20, research: 0 };

  it('reads each category from the right row: units from their level, buildings to the next', () => {
    expect(formatNextCost(byName('Grand Warden'), 16)).toMatch(/^4\.8M /); // row 16, not 5.1M from row 17
    expect(formatNextCost(byName('Barbarian King'), 39)).toMatch(/^55K /);
    expect(formatNextCost(byName('Elixir Collector'), 13)).toMatch(/^800K /); // row 14
    expect(formatNextCost(byName('Grand Warden'), byName('Grand Warden').levels.at(-1)!.level)).toBe('');
  });

  it('matches the prices shown in game with 20% boosts (2026-10-30)', () => {
    const prices: Array<[string, number, number]> = [
      ['Grand Warden', 16, 3_840_000],
      ['Dark Elixir Drill', 7, 1_920_000],
      ['Elixir Collector', 13, 640_000],
      ['Inferno Candle Effect Module', 1, 24_000],
      ['Headhunter Tower HP Module', 1, 32_000],
      ['Wall', 13, 1_600_000],
      ['Barbarian', 8, 2_000_000],
      ['Giant', 8, 2_720_000],
      ['Wall Breaker', 7, 3_040_000],
      ['Wizard', 7, 2_480_000],
      ['Baby Dragon', 5, 3_840_000],
      ['Archer', 8, 2_400_000],
      ['Goblin', 7, 2_960_000],
      ['Healer', 4, 3_200_000],
      ['P.E.K.K.A', 5, 2_000_000],
      ['Miner', 4, 3_200_000],
    ];
    for (const [name, level, price] of prices) {
      expect((nextUpgradeRow(byName(name), level)!.cost * 80) / 100, name).toBe(price);
    }
    expect(formatNextCost(byName('Grand Warden'), 16, boost)).toMatch(/^3\.8M /);
    expect(formatNextCost(byName('Wall'), 13, boost)).toMatch(/^1\.6M /);
    expect(formatNextCost(byName('Barbarian'), 8, { builder: 0, research: 20 })).toMatch(/^2M /);
  });

  it('keeps each boost to what it covers', () => {
    const rage = byName('Rage Spell');
    expect(formatNextCost(rage, 5, boost)).toBe(formatNextCost(rage, 5));
    expect(formatNextCost(rage, 5, { builder: 0, research: 20 })).not.toBe(formatNextCost(rage, 5));
    const both = { builder: 20, research: 20 };
    const pet = itemsIn('home', ['pet'])[0];
    expect(formatNextCost(pet, 1, both)).toBe(formatNextCost(pet, 1));
    const cannon = itemsIn('builder', ['defense'])[0];
    expect(formatNextCost(cannon, 1, both)).toBe(formatNextCost(cannon, 1));
  });
});

describe('caps from the live API fixture (TH12 / BH9)', () => {
  const player = apiFixture as any;
  const capOf = (list: 'heroes' | 'troops' | 'spells', name: string) =>
    apiCap(
      list,
      player[list].find((x: any) => x.name === name),
      player
    );

  it('matches the datamine for heroes', () => {
    expect(capOf('heroes', 'Barbarian King')).toBe(65);
    expect(capOf('heroes', 'Archer Queen')).toBe(65);
    expect(capOf('heroes', 'Grand Warden')).toBe(40);
    expect(capOf('heroes', 'Minion Prince')).toBe(40);
    expect(capOf('heroes', 'Battle Machine')).toBe(30);
    expect(capOf('heroes', 'Battle Copter')).toBe(30);
  });

  it('resolves every hero, troop, spell and equipment name', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    PlayerTrackingService.calculateOutstandingUpgrades(player);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('leaves super troops out of outstanding upgrades', () => {
    const outstanding = PlayerTrackingService.calculateOutstandingUpgrades(player);
    const names = outstanding.byCategory.home.troops.map((t) => t.name);
    expect(names.some((n) => /^Super |Sneaky Goblin|Inferno Dragon|Ice Hound|Rocket Balloon/.test(n))).toBe(false);
    expect(outstanding.byCategory.home.troops.every((t) => t.nextCost)).toBe(true);
  });
});
