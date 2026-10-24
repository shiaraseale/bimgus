import { describe, it, expect, vi, beforeEach } from 'vitest';
import apiFixture from './fixtures/api-player-th12.json';
import exportFixture from './fixtures/export-th12-bh9.json';
import { DiscordService } from '../src/services/discordService';
import { PlayerTrackingService } from '../src/services/playerTrackingService';
import { VillageImportService } from '../src/services/villageImportService';
import {
  UpgradeEvent,
  eventFromTimer,
  eventsFromImportChanges,
  groupWalls,
  notifyUpgrades,
} from '../src/services/upgradeNotifier';
import { LinkedAccount, UserDoc } from '../src/types/user';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

const newUser = (): { user: UserDoc; account: LinkedAccount } => {
  const account: LinkedAccount = { playerTag: '#ANON12345', name: 'Tester', townHallLevel: 12, builderHallLevel: 9, isPrimary: true };
  const user: UserDoc = { discordUserId: '42', accounts: [account], createdAt: '', updatedAt: '' };
  return { user, account };
};

const event = (over: Partial<UpgradeEvent> = {}): UpgradeEvent => ({
  kind: 'upgraded', code: 1000008, name: 'Cannon', assetName: 'Cannon', category: 'defense', village: 'home',
  oldLevel: 13, newLevel: 14, maxLevel: 17, count: 1, ...over,
});

describe('detectApiUpgrades (2.5 level rules)', () => {
  const player = clone(apiFixture) as any;
  const snapshot = () => PlayerTrackingService.createSnapshot(player);

  beforeEach(() => vi.restoreAllMocks());

  it('keys snapshots by village and name, so Baby Dragon home and builder do not collide', () => {
    const snap = snapshot();
    expect(snap.version).toBe(2);
    expect(Object.keys(snap.troops)).toContain('home:Baby Dragon');
    expect(Object.keys(snap.troops)).toContain('builder:Baby Dragon');
  });

  it('replaces an old-format snapshot without sending anything', () => {
    const old = { ...snapshot(), version: undefined, troops: {} } as any;
    expect(PlayerTrackingService.detectApiUpgrades(old, player)).toEqual([]);
  });

  it('reports 0 → 1 as unlocked and 1 → 2 as upgraded', () => {
    const old = snapshot();
    const next = clone(player);
    const druidish = next.troops.find((t: any) => t.village === 'home' && t.level === 1 && !/Super|Sneaky|Inferno|Ice Hound|Rocket Balloon/.test(t.name));
    expect(druidish, 'fixture has a non-super level-1 troop').toBeTruthy();
    delete old.troops[`home:${druidish.name}`];
    const hero = next.heroes.find((h: any) => h.name === 'Barbarian King');
    hero.level += 1;

    const events = PlayerTrackingService.detectApiUpgrades(old, next);
    expect(events).toContainEqual(expect.objectContaining({ kind: 'unlocked', name: druidish.name, oldLevel: 0, newLevel: 1 }));
    expect(events).toContainEqual(expect.objectContaining({ kind: 'upgraded', name: 'Barbarian King', newLevel: hero.level, maxLevel: 65 }));
    expect(events).toHaveLength(2);
  });

  it('records something new above level 1 silently', () => {
    const old = snapshot();
    delete old.heroes['home:Archer Queen'];
    expect(PlayerTrackingService.detectApiUpgrades(old, player)).toEqual([]);
  });

  it('never reports super troops', () => {
    const old = snapshot();
    const next = clone(player);
    for (const t of next.troops) if (t.name.startsWith('Super ')) t.level = 2;
    expect(PlayerTrackingService.detectApiUpgrades(old, next)).toEqual([]);
  });

  it('only tracks the Town Hall weapon at TH17, and not in the poll where the Town Hall changed', () => {
    const th16 = { ...clone(player), townHallLevel: 16, townHallWeaponLevel: 0 };
    const th17 = { ...clone(player), townHallLevel: 17, townHallWeaponLevel: 1 };
    // TH16 → TH17 with a weapon value: only the Town Hall event
    const thEvents = PlayerTrackingService.detectApiUpgrades(PlayerTrackingService.createSnapshot(th16), th17);
    expect(thEvents.map((e) => e.name)).toEqual(['Town Hall']);

    // Same TH17: 0 → 1 is unlocked, 1 → 2 is upgraded, with the weapon's own cap
    const before = PlayerTrackingService.createSnapshot({ ...th17, townHallWeaponLevel: 0 });
    expect(PlayerTrackingService.detectApiUpgrades(before, th17)).toEqual([
      expect.objectContaining({ kind: 'unlocked', name: 'Inferno Artillery', newLevel: 1, maxLevel: 5 }),
    ]);
    const lvl2 = { ...th17, townHallWeaponLevel: 2 };
    expect(PlayerTrackingService.detectApiUpgrades(PlayerTrackingService.createSnapshot(th17), lvl2)[0]).toMatchObject({ kind: 'upgraded', newLevel: 2 });

    // A TH12 weapon change is ignored (D9)
    const th12 = { ...clone(player), townHallWeaponLevel: 2 };
    expect(PlayerTrackingService.detectApiUpgrades(snapshot(), th12)).toEqual([]);
  });
});

describe('timers and imports', () => {
  it('turns a finished building timer into exactly one "expected" event, and skips API-covered ones', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const data = VillageImportService.parseExport(clone(exportFixture));
    const events = data.inProgressUpgrades.map(eventFromTimer).filter(Boolean) as UpgradeEvent[];
    // 3 buildings + 2 traps + Star Laboratory; the Rage Spell research is left to the API
    expect(events).toHaveLength(6);
    expect(events.every((e) => e.kind === 'expected')).toBe(true);
    expect(events.some((e) => e.name === 'Rage Spell')).toBe(false);
  });

  it('treats a timer from level 0 as built (buildings) or unlocked (everything else)', () => {
    const t = { code: 1000008, name: 'Cannon', category: 'defense' as const, village: 'home' as const, currentLevel: 0, targetLevel: 1, maxLevel: 17, timerSeconds: 1, finishesAtMs: 1 };
    expect(eventFromTimer(t)?.kind).toBe('built');
    expect(eventFromTimer({ ...t, code: 93000000, name: "Builder's Apprentice", category: 'helper' })?.kind).toBe('unlocked');
  });

  it('groups 40 walls reaching the same level into one line with totals', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const before = VillageImportService.parseExport(clone(exportFixture));
    const after = VillageImportService.parseExport(clone(exportFixture));
    const wall = after.items.find((i) => i.code === 1000010 && i.count >= 40)!;
    wall.count -= 40;
    after.items.push({ ...wall, level: wall.level + 1, count: 40 });
    const events = groupWalls(eventsFromImportChanges(VillageImportService.detectImportChanges(before, after), after));
    expect(events).toHaveLength(1);
    expect(events[0].wallTotals?.total).toBe(300);
  });
});

describe('notifyUpgrades', () => {
  let send: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.restoreAllMocks();
    send = vi.spyOn(DiscordService, 'sendDmResult').mockResolvedValue('sent');
  });

  it('sends a hero completion once even if it is reported twice', async () => {
    const { user, account } = newUser();
    const hero = event({ category: 'hero', name: 'Barbarian King', assetName: 'Barbarian King', key: 'hero:home:Barbarian King:37' });
    await notifyUpgrades(user, account, [hero]);
    await notifyUpgrades(user, account, [hero]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sends one summary instead of many DMs when more than 3 things happened', async () => {
    const { user, account } = newUser();
    const events = [1, 2, 3, 4, 5].map((n) => event({ code: 1000008 + n, name: `Building ${n}` }));
    const sent = await notifyUpgrades(user, account, events);
    expect(sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0][1] as any).embeds[0].description.split('\n')).toHaveLength(5);
  });

  it('words timer events as estimates and unlocks as unlocks', async () => {
    const { user, account } = newUser();
    await notifyUpgrades(user, account, [event({ kind: 'expected' }), event({ kind: 'unlocked', category: 'troop', name: 'Druid', newLevel: 1, maxLevel: 5 })]);
    const texts = send.mock.calls.map((c) => (c[1] as any).embeds[0].description as string);
    expect(texts[0]).toContain('should now be level 14');
    expect(texts[1]).toContain('🔓 **Druid** unlocked! (Lv 1/5)');
  });

  it('pauses DMs for 7 days after Discord refuses one (50007)', async () => {
    const { user, account } = newUser();
    send.mockResolvedValueOnce('blocked');
    const now = Date.now();
    await notifyUpgrades(user, account, [event({ key: 'a' })], now);
    expect(user.dmsBlockedAt).toBeTruthy();
    await notifyUpgrades(user, account, [event({ key: 'b' })], now + 1000);
    expect(send).toHaveBeenCalledTimes(1);
    await notifyUpgrades(user, account, [event({ key: 'c' })], now + 8 * 24 * 3600 * 1000);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('respects DMs being turned off for the account', async () => {
    const { user, account } = newUser();
    account.dmsEnabled = false;
    expect(await notifyUpgrades(user, account, [event()])).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});
