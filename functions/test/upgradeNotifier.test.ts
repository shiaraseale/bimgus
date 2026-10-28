import { describe, it, expect, vi, beforeEach } from 'vitest';
import apiFixture from './fixtures/api-player-th12.json';
import exportFixture from './fixtures/export-th12-bh9.json';
import { DiscordService } from '../src/services/discordService';
import { PlayerTrackingService } from '../src/services/playerTrackingService';
import { VillageImportService } from '../src/services/villageImportService';
import { CocService } from '../src/services/cocService';
import { FirestoreService } from '../src/services/firestoreService';
import { runPlayerTrackingJob } from '../src/jobs/playerTrackingJob';
import {
  UpgradeEvent,
  eventFromTimer,
  eventsFromImportChanges,
  heroUpgradeStarts,
  notifyUpgrades,
  supersededHeroTimer,
  withoutImportedTimers,
} from '../src/services/upgradeNotifier';
import { LinkedAccount, UserDoc } from '../src/types/user';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

const newUser = (): { user: UserDoc; account: LinkedAccount } => {
  const account: LinkedAccount = {
    playerTag: '#ANON12345',
    name: 'Tester',
    townHallLevel: 12,
    builderHallLevel: 9,
    isPrimary: true,
    villageData: { version: 2 } as any, // upgrade DMs need an import
  };
  const user: UserDoc = { discordUserId: '42', accounts: [account], createdAt: '', updatedAt: '' };
  return { user, account };
};

const event = (over: Partial<UpgradeEvent> = {}): UpgradeEvent => ({
  kind: 'upgraded',
  code: 1000008,
  name: 'Cannon',
  assetName: 'Cannon',
  category: 'defense',
  village: 'home',
  oldLevel: 13,
  newLevel: 14,
  maxLevel: 17,
  count: 1,
  ...over,
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
    const druidish = next.troops.find(
      (t: any) => t.village === 'home' && t.level === 1 && !/Super|Sneaky|Inferno|Ice Hound|Rocket Balloon/.test(t.name)
    );
    expect(druidish, 'fixture has a non-super level-1 troop').toBeTruthy();
    delete old.troops[`home:${druidish.name}`];
    const hero = next.heroes.find((h: any) => h.name === 'Barbarian King');
    hero.level += 1;

    const events = PlayerTrackingService.detectApiUpgrades(old, next);
    expect(events).toContainEqual(
      expect.objectContaining({ kind: 'unlocked', name: druidish.name, oldLevel: 0, newLevel: 1 })
    );
    expect(events).toContainEqual(
      expect.objectContaining({ kind: 'upgraded', name: 'Barbarian King', newLevel: hero.level, maxLevel: 65 })
    );
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
    expect(PlayerTrackingService.detectApiUpgrades(PlayerTrackingService.createSnapshot(th17), lvl2)[0]).toMatchObject({
      kind: 'upgraded',
      newLevel: 2,
    });

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
    const t = {
      code: 1000008,
      name: 'Cannon',
      category: 'defense' as const,
      village: 'home' as const,
      currentLevel: 0,
      targetLevel: 1,
      maxLevel: 17,
      timerSeconds: 1,
      finishesAtMs: 1,
    };
    expect(eventFromTimer(t)?.kind).toBe('built');
    expect(eventFromTimer({ ...t, code: 93000000, name: "Builder's Apprentice", category: 'helper' })?.kind).toBe(
      'unlocked'
    );
  });

  it('ignores walls, from imports and from timers', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const before = VillageImportService.parseExport(clone(exportFixture));
    const after = VillageImportService.parseExport(clone(exportFixture));
    const wall = after.items.find((i) => i.code === 1000010 && i.count >= 40)!;
    wall.count -= 40;
    after.items.push({ ...wall, level: wall.level + 1, count: 40 });
    expect(eventsFromImportChanges(VillageImportService.detectImportChanges(before, after))).toEqual([]);
    expect(
      eventFromTimer({
        code: 1000010,
        name: 'Wall',
        category: 'wall',
        village: 'home',
        currentLevel: 10,
        targetLevel: 11,
        maxLevel: 14,
        timerSeconds: 1,
        finishesAtMs: 1,
      })
    ).toBeNull();
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
    const hero = event({
      category: 'hero',
      name: 'Barbarian King',
      assetName: 'Barbarian King',
      key: 'hero:home:Barbarian King:37',
    });
    await notifyUpgrades(user, account, [hero]);
    await notifyUpgrades(user, account, [hero]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sends one DM listing everything when more than one thing happened', async () => {
    const { user, account } = newUser();
    const events = [1, 2, 3, 4, 5].map((n) => event({ code: 1000008 + n, name: `Building ${n}` }));
    const sent = await notifyUpgrades(user, account, events);
    expect(sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0][1] as any).embeds[0].description.split('\n')).toHaveLength(5);
  });

  it('shows the level once in a single DM, with the hall it is the max for', async () => {
    const { user, account } = newUser();
    await notifyUpgrades(user, account, [event()]);
    const embed = (send.mock.calls[0][1] as any).embeds[0];
    expect(embed.title).toContain('Upgrade Completed!');
    expect(embed.description).toBe('🎉 **Cannon** reached Lv 14/17 for TH12');
    expect(embed.footer.text).not.toContain('Estimated');
  });

  it('words timer events as estimates and unlocks as unlocks', async () => {
    const { user, account } = newUser();
    await notifyUpgrades(user, account, [
      event({ kind: 'expected' }),
      event({ kind: 'unlocked', category: 'troop', name: 'Druid', newLevel: 1, maxLevel: 5 }),
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    const embed = (send.mock.calls[0][1] as any).embeds[0];
    expect(embed.description.split('\n')).toEqual([
      '🏗️ **Cannon** should now be Lv 14/17',
      '🔓 **Druid** unlocked (Lv 1/5)',
    ]);
    expect(embed.footer.text).toContain("Estimated from your import's timer");
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

  it('never DMs hero equipment upgrades or unlocks', async () => {
    const { user, account } = newUser();
    const puppet = event({
      category: 'equipment',
      name: 'Henchmen Puppet',
      assetName: 'Henchmen Puppet',
      oldLevel: 6,
      newLevel: 7,
      maxLevel: 15,
      key: 'equipment:home:Henchmen Puppet:7',
    });
    expect(await notifyUpgrades(user, account, [puppet, { ...puppet, kind: 'unlocked', key: 'x' }])).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('sends no upgrade DMs for an account that has never been imported, even after it is', async () => {
    const { user, account } = newUser();
    delete account.villageData;
    const hero = event({ category: 'hero', key: 'hero:home:Barbarian King:37' });
    expect(await notifyUpgrades(user, account, [hero])).toBe(0);
    account.villageData = { version: 2 } as any;
    expect(await notifyUpgrades(user, account, [hero])).toBe(0); // already seen before the import
    expect(send).not.toHaveBeenCalled();
  });

  it('respects DMs being turned off for the account', async () => {
    const { user, account } = newUser();
    account.dmsEnabled = false;
    expect(await notifyUpgrades(user, account, [event()])).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('hero upgrades: the API shows the new level when the upgrade starts', () => {
  const now = Date.parse('2026-10-24T15:45:00Z');
  const aqStart = event({
    kind: 'upgraded',
    code: 28000001,
    name: 'Archer Queen',
    assetName: 'Archer Queen',
    category: 'hero',
    oldLevel: 18,
    newLevel: 19,
    maxLevel: 30,
    key: 'hero:home:Archer Queen:19',
  });
  const importWithAqTimer = (finishesAtMs: number) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const data = VillageImportService.parseExport(clone(exportFixture));
    data.inProgressUpgrades.push({
      code: 28000001,
      name: 'Archer Queen',
      category: 'hero',
      village: 'home',
      currentLevel: 18,
      targetLevel: 19,
      maxLevel: 30,
      timerSeconds: 1,
      finishesAtMs,
    });
    return data;
  };

  it('does not DM at the start when the import has a timer for it (the timer will)', () => {
    const result = heroUpgradeStarts([aqStart], importWithAqTimer(now + 19 * 3600_000), now);
    expect(result.events).toEqual([]);
    expect(result.pending).toEqual([]);
  });

  it('without an import, waits for the game data upgrade time (24 h for Archer Queen 19)', () => {
    const result = heroUpgradeStarts([aqStart], null, now);
    expect(result.events).toEqual([]);
    expect(result.pending).toEqual([
      expect.objectContaining({ code: 28000001, targetLevel: 19, finishesAtMs: now + 24 * 3600_000 }),
    ]);
  });

  it('leaves non-hero events alone', () => {
    const cannon = event();
    expect(heroUpgradeStarts([cannon], null, now).events).toEqual([cannon]);
  });

  it('sends "should now be level 19" when the timer runs out, once, whichever timer fires', async () => {
    const send = vi.spyOn(DiscordService, 'sendDmResult').mockResolvedValue('sent');
    const { user, account } = newUser();
    const [pending] = heroUpgradeStarts([aqStart], null, now).pending;
    const fromPending = eventFromTimer(pending as any)!;
    const fromImport = eventFromTimer(importWithAqTimer(now).inProgressUpgrades.at(-1)!)!;
    expect(fromPending.kind).toBe('expected');
    expect(fromPending.key).toBe(fromImport.key);
    await notifyUpgrades(user, account, [fromPending]);
    await notifyUpgrades(user, account, [fromImport]);
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0][1] as any).embeds[0].description).toContain('Archer Queen** should now be Lv 19/');
  });

  it('drops an import timer the API has moved past, without a DM (level 12 after level 13)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(FirestoreService, 'saveUser').mockResolvedValue(undefined as any);
    const send = vi.spyOn(DiscordService, 'sendDmResult').mockResolvedValue('sent');
    // The import's Warden 11 → 12 timer hasn't run out, but the API shows 13: 12 finished early and
    // 13 has started
    const player = clone(apiFixture) as any;
    const warden = player.heroes.find((h: any) => h.name === 'Grand Warden');
    warden.level = 13;
    const village = VillageImportService.parseExport(clone(exportFixture));
    village.inProgressUpgrades = [
      {
        code: 28000002,
        name: 'Grand Warden',
        category: 'hero',
        village: 'home',
        currentLevel: 11,
        targetLevel: 12,
        maxLevel: 40,
        timerSeconds: 1,
        finishesAtMs: Date.now() + 3600_000,
      },
    ];
    const { user, account } = newUser();
    account.villageData = village;
    account.lastSnapshot = PlayerTrackingService.createSnapshot(player);
    vi.spyOn(CocService, 'shared').mockReturnValue({
      getPlayer: vi.fn(async () => player),
      getCurrentWar: vi.fn(async () => ({ state: 'notInWar' })),
    } as any);
    vi.spyOn(FirestoreService, 'getAllUsers').mockResolvedValue([user]);

    await runPlayerTrackingJob();
    const stored = VillageImportService.read(account.villageData)!;
    expect(stored.inProgressUpgrades.some((u) => u.code === 28000002)).toBe(false);
    expect(stored.items.find((i) => i.code === 28000002)?.level).toBe(12);
    expect(send).not.toHaveBeenCalled();
  });

  it('keeps a hero timer whose level the API shows (that upgrade is the one running)', () => {
    const player = clone(apiFixture) as any;
    player.heroes.find((h: any) => h.name === 'Grand Warden').level = 12;
    const snap = PlayerTrackingService.createSnapshot(player);
    const timer = { code: 28000002, name: 'Grand Warden', category: 'hero', village: 'home' as const };
    expect(supersededHeroTimer({ ...timer, targetLevel: 12 }, snap)).toBe(false);
    expect(supersededHeroTimer({ ...timer, targetLevel: 11 }, snap)).toBe(true);
    expect(supersededHeroTimer({ ...timer, category: 'defense', targetLevel: 11 }, snap)).toBe(false);
    expect(supersededHeroTimer({ ...timer, targetLevel: 11 }, undefined)).toBe(false);
  });

  it('drops a pending timer once an import covers the same upgrade', () => {
    const [pending] = heroUpgradeStarts([aqStart], null, now).pending;
    expect(withoutImportedTimers([pending], importWithAqTimer(now + 1000))).toEqual([]);
    expect(withoutImportedTimers([pending], null)).toEqual([pending]);
  });
});

describe('the 2-minute poll: API upgrades only DM accounts that have been imported', () => {
  // Every kind of level-up the live API reports, in one poll, plus a hero timer from an earlier poll
  const levelledUp = () => {
    const p = clone(apiFixture) as any;
    p.townHallLevel += 1;
    p.builderHallLevel += 1;
    p.troops.find((t: any) => t.name === 'Barbarian').level += 1;
    p.troops.find((t: any) => t.name === 'Wall Wrecker').level += 1; // siege
    p.spells.find((t: any) => t.name === 'Rage Spell').level += 1;
    p.heroes.find((t: any) => t.name === 'Grand Warden').level += 1; // starts a hero timer
    return p;
  };
  const linkedOnly = (): UserDoc => ({
    discordUserId: '42',
    createdAt: '',
    updatedAt: '',
    accounts: [
      {
        playerTag: '#ANON12345',
        name: 'Tester',
        townHallLevel: 12,
        isPrimary: true,
        lastSnapshot: PlayerTrackingService.createSnapshot(apiFixture),
        pendingUpgrades: [
          {
            code: 28000000,
            name: 'Barbarian King',
            category: 'hero',
            village: 'home',
            currentLevel: 36,
            targetLevel: 37,
            maxLevel: 65,
            timerSeconds: 60,
            finishesAtMs: Date.now() - 1000,
          },
        ],
      },
    ],
  });
  let send: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(CocService, 'shared').mockReturnValue({
      getPlayer: vi.fn(async () => levelledUp()),
      getCurrentWar: vi.fn(async () => ({ state: 'notInWar' })),
    } as any);
    vi.spyOn(FirestoreService, 'saveUser').mockResolvedValue(undefined as any);
    send = vi.spyOn(DiscordService, 'sendDmResult').mockResolvedValue('sent');
  });

  it('sends nothing for a linked account without an import', async () => {
    vi.spyOn(FirestoreService, 'getAllUsers').mockResolvedValue([linkedOnly()]);
    const result = await runPlayerTrackingJob();
    expect(result.dmsSent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('sends them once the account has an import', async () => {
    const user = linkedOnly();
    user.accounts[0].villageData = VillageImportService.parseExport(clone(exportFixture));
    vi.spyOn(FirestoreService, 'getAllUsers').mockResolvedValue([user]);
    await runPlayerTrackingJob();
    const text = JSON.stringify(send.mock.calls);
    for (const name of ['Town Hall', 'Builder Hall', 'Barbarian', 'Wall Wrecker', 'Rage Spell', 'Barbarian King']) {
      expect(text, name).toContain(name);
    }
  });
});
