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

  it('resolves every code in the real export except equipment newer than the datamine', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const unknown = new Set<number>();
    const sections = ['helpers', 'buildings', 'traps', 'units', 'siege_machines', 'heroes', 'spells', 'pets', 'equipment', 'buildings2', 'traps2', 'units2', 'heroes2'];
    for (const section of sections) {
      for (const entry of (exportFixture as any)[section] ?? []) {
        if (!getById(entry.data)) unknown.add(entry.data);
        for (const t of entry.types ?? []) {
          if (!getById(t.data)) unknown.add(t.data);
          for (const m of t.modules ?? []) if (!getById(m.data)) unknown.add(m.data);
        }
      }
    }
    expect([...unknown]).toEqual([90000061]);
    expect(nameForCode(90000061)).toBe('Unknown (90000061)');
    expect(warn).toHaveBeenCalled();
  });

  it('puts every export item in the village its section implies', () => {
    for (const [section, village] of [['buildings', 'home'], ['buildings2', 'builder'], ['units2', 'builder'], ['heroes2', 'builder']] as const) {
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
    const bb = Object.values(itemsIn('builder', ['defense', 'resource', 'army', 'trap', 'wall', 'troop', 'hero', 'other', 'builderHall']))
      .filter((i) => i.displayName.endsWith(' (BB)'))
      .map((i) => i.name)
      .sort();
    expect(bb).toEqual(['Archer Tower', 'Army Camp', 'Baby Dragon', 'Cannon', 'Elixir Collector', 'Elixir Storage', 'Gold Mine', 'Gold Storage', 'Hidden Tesla', 'Spring Trap', 'Wall', 'X-Bow']);
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

describe('caps from the live API fixture (TH12 / BH9)', () => {
  const player = apiFixture as any;
  const capOf = (list: 'heroes' | 'troops' | 'spells', name: string) =>
    apiCap(list, player[list].find((x: any) => x.name === name), player);

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
