import { describe, it, expect, vi, beforeEach } from 'vitest';
import apiFixture from './fixtures/api-player-th12.json';
import exportFixture from './fixtures/export-th12-bh9.json';
import { DiscordService } from '../src/services/discordService';
import { PlayerTrackingService } from '../src/services/playerTrackingService';
import { InProgressUpgrade, VillageImportService } from '../src/services/villageImportService';
import { CocService } from '../src/services/cocService';
import { FirestoreService } from '../src/services/firestoreService';
import { runPlayerTrackingJob } from '../src/jobs/playerTrackingJob';
import {
  UpgradeEvent,
  eventFromTimer,
  eventsFromImportChanges,
  finishedHeroTimer,
  notifyUpgrades,
} from '../src/services/upgradeNotifier';
import { activeInProgress } from '../src/api/discord/ui';
import { LinkedAccount, UserDoc } from '../src/types/user';
import { expectLayout, texts } from './layoutHelpers';

/** The first DM's heading, footer and the lines between them. */
const dmText = (send: any) => {
  const lines = texts(send.mock.calls[0][1]).split('\n');
  const body = lines.filter((l) => !/^(###|-#) /.test(l));
  // The blank line card() puts above the footer
  while (body.at(-1) === '') body.pop();
  return {
    title: lines.find((l) => l.startsWith('### ')) ?? '',
    footer: lines.find((l) => l.startsWith('-# ')) ?? '',
    body,
  };
};

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
    expect(dmText(send).body).toHaveLength(5);
  });

  it('lists each village under its own heading when both had upgrades', async () => {
    const { user, account } = newUser();
    await notifyUpgrades(user, account, [
      event(),
      event({ code: 1000032, name: 'Cannon (BB)', village: 'builder', newLevel: 5, maxLevel: 9 }),
    ]);
    expect(dmText(send).body).toEqual([
      '**🏰 Home Village**',
      '🎉 **Cannon** reached Lv 14/17',
      '',
      '**🔨 Builder Base**',
      '🎉 **Cannon (BB)** reached Lv 5/9',
    ]);
  });

  it('shows the level once in a single DM, with the hall it is the max for', async () => {
    const { user, account } = newUser();
    await notifyUpgrades(user, account, [event()]);
    const dm = dmText(send);
    expect(dm.title).toContain('Upgrade Completed!');
    expect(dm.body).toEqual(['🎉 **Cannon** reached Lv 14/17 for TH12']);
    expect(dm.footer).not.toContain('Estimated');
    expectLayout(send.mock.calls[0][1]);
  });

  it('carries the turn-off button', async () => {
    const { user, account } = newUser();
    await notifyUpgrades(user, account, [event()]);
    expect(JSON.stringify(send.mock.calls[0][1].components)).toContain('dms_off:#ANON12345');
  });

  it('words timer events as estimates and unlocks as unlocks', async () => {
    const { user, account } = newUser();
    await notifyUpgrades(user, account, [
      event({ kind: 'expected' }),
      event({ kind: 'unlocked', category: 'troop', name: 'Druid', newLevel: 1, maxLevel: 5 }),
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    const dm = dmText(send);
    expect(dm.body).toEqual(['🏗️ **Cannon** should now be Lv 14/17', '🔓 **Druid** unlocked (Lv 1/5)']);
    expect(dm.footer).toContain("Estimated from your import's timer");
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

describe('hero upgrades: the API shows the new level once the upgrade has finished', () => {
  // What an import knows about the Warden going from 11 to 12
  const wardenTimer = (finishesAtMs: number): InProgressUpgrade => ({
    code: 28000002,
    name: 'Grand Warden',
    category: 'hero',
    village: 'home',
    currentLevel: 11,
    targetLevel: 12,
    maxLevel: 40,
    timerSeconds: 1,
    finishesAtMs,
  });
  const playerWithWarden = (level: number) => {
    const player = clone(apiFixture) as any;
    player.heroes.find((h: any) => h.name === 'Grand Warden').level = level;
    return player;
  };

  /** One poll of an account last seen with the Warden at 11, which the API now shows at `level`. */
  const poll = async (level: number, timers: InProgressUpgrade[]) => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(FirestoreService, 'saveUser').mockResolvedValue(undefined as any);
    const send = vi.spyOn(DiscordService, 'sendDmResult').mockResolvedValue('sent');
    const village = VillageImportService.parseExport(clone(exportFixture));
    village.inProgressUpgrades = timers;
    const { user, account } = newUser();
    account.villageData = village;
    account.lastSnapshot = PlayerTrackingService.createSnapshot(playerWithWarden(11));
    vi.spyOn(CocService, 'shared').mockReturnValue({
      getPlayer: vi.fn(async () => playerWithWarden(level)),
      getCurrentWar: vi.fn(async () => ({ state: 'notInWar' })),
    } as any);
    vi.spyOn(FirestoreService, 'getAllUsers').mockResolvedValue([user]);
    await runPlayerTrackingJob();
    return { send, stored: VillageImportService.read(account.villageData)! };
  };

  beforeEach(() => vi.restoreAllMocks());

  it('reports a level-up as done, and starts no timer for it (Warden "in 20 hours" when finished)', async () => {
    const { send, stored } = await poll(12, []);
    expect(send).toHaveBeenCalledTimes(1);
    expect(dmText(send).body.join('\n')).toContain('Grand Warden** reached Lv 12/');
    expect(activeInProgress(stored)).toEqual([]);
  });

  it('drops a timer the API has reached, with one DM for the level', async () => {
    const { send, stored } = await poll(12, [wardenTimer(Date.now() + 3600_000)]);
    expect(stored.inProgressUpgrades).toEqual([]);
    expect(stored.items.find((i) => i.code === 28000002)?.level).toBe(12);
    expect(send).toHaveBeenCalledTimes(1);
    expect(dmText(send).body.join('\n')).toContain('Grand Warden** reached Lv 12/');
  });

  it('keeps the timer while the API still shows the current level', async () => {
    const finishesAtMs = Date.now() + 3600_000;
    const { send, stored } = await poll(11, [wardenTimer(finishesAtMs)]);
    expect(activeInProgress(stored)).toEqual([wardenTimer(finishesAtMs)]);
    expect(send).not.toHaveBeenCalled();
  });

  it('sends one DM for a level, whether the timer or the API gets there first', async () => {
    const send = vi.spyOn(DiscordService, 'sendDmResult').mockResolvedValue('sent');
    const { user, account } = newUser();
    const fromTimer = eventFromTimer(wardenTimer(1))!;
    const fromApi = PlayerTrackingService.detectApiUpgrades(
      PlayerTrackingService.createSnapshot(playerWithWarden(11)),
      playerWithWarden(12)
    ).find((e) => e.category === 'hero')!;
    expect(fromTimer.kind).toBe('expected');
    expect(fromTimer.key).toBe(fromApi.key);
    await notifyUpgrades(user, account, [fromTimer]);
    await notifyUpgrades(user, account, [fromApi]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(dmText(send).body.join('\n')).toContain('Grand Warden** should now be Lv 12/');
  });

  it('counts a hero timer as finished from the level it was going to', () => {
    const snap = PlayerTrackingService.createSnapshot(playerWithWarden(12));
    const timer = { code: 28000002, name: 'Grand Warden', category: 'hero', village: 'home' as const };
    expect(finishedHeroTimer({ ...timer, targetLevel: 11 }, snap)).toBe(true);
    expect(finishedHeroTimer({ ...timer, targetLevel: 12 }, snap)).toBe(true);
    expect(finishedHeroTimer({ ...timer, targetLevel: 13 }, snap)).toBe(false);
    expect(finishedHeroTimer({ ...timer, category: 'defense', targetLevel: 12 }, snap)).toBe(false);
    expect(finishedHeroTimer({ ...timer, targetLevel: 12 }, undefined)).toBe(false);
  });
});

describe('the 2-minute poll: API upgrades only DM accounts that have been imported', () => {
  // Every kind of level-up the live API reports, in one poll
  const levelledUp = () => {
    const p = clone(apiFixture) as any;
    p.townHallLevel += 1;
    p.builderHallLevel += 1;
    p.troops.find((t: any) => t.name === 'Barbarian').level += 1;
    p.troops.find((t: any) => t.name === 'Wall Wrecker').level += 1; // siege
    p.spells.find((t: any) => t.name === 'Rage Spell').level += 1;
    p.heroes.find((t: any) => t.name === 'Grand Warden').level += 1;
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
    for (const name of ['Town Hall', 'Builder Hall', 'Barbarian', 'Wall Wrecker', 'Rage Spell', 'Grand Warden']) {
      expect(text, name).toContain(name);
    }
  });
});
