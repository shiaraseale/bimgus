import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CocService } from '../src/services/cocService';
import { DiscordService } from '../src/services/discordService';
import { FirestoreService } from '../src/services/firestoreService';
import { getWarId, processWarDiff } from '../src/diff/warDiff';
import { runPlayerTrackingJob } from '../src/jobs/playerTrackingJob';
import { runWarPingJob } from '../src/jobs/warPingJob';
import { config } from '../src/config';
import { headings } from './layoutHelpers';

// Only the war snapshot's owner (the war task) may start a new war's snapshot. When the war task
// failed on the tick a war was declared, the roster DM check wrote the new war id onto the previous
// war's snapshot, so the new war inherited its logged attacks and matchup flag: no matchup post and no
// attack posts, only the end summary (seen 2026-10-27).

const cocTime = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '');
const botConfig: any = {
  webhooks: { warRoom: 'w' },
  notificationsEnabled: { warAttacks: true, warEndSummary: true, warAttackReminders: true },
};

const CLAN = '#C';
const configuredClan = config.coc.clanTag;
const war = (state: string, opponent: string, attacks: number[] = []): any => ({
  state,
  teamSize: 5,
  preparationStartTime: `2026102${opponent === '#OLD' ? 4 : 6}T050000.000Z`,
  startTime: cocTime(Date.now() - 20 * 3600_000),
  endTime: cocTime(Date.now() + 2 * 3600_000),
  clan: {
    tag: CLAN,
    name: 'Us',
    stars: 0,
    destructionPercentage: 0,
    attacks: attacks.length,
    members: [
      {
        tag: '#ME',
        name: 'Me',
        mapPosition: 1,
        townhallLevel: 12,
        attacks: attacks.map((order) => ({
          order,
          attackerTag: '#ME',
          defenderTag: '#THEM',
          stars: 2,
          destructionPercentage: 70,
        })),
      },
    ],
  },
  opponent: {
    tag: opponent,
    name: 'Them',
    stars: 0,
    destructionPercentage: 0,
    attacks: 0,
    members: [{ tag: '#THEM', name: 'Them', mapPosition: 1, townhallLevel: 12 }],
  },
});

// The previous war's final snapshot: everything posted and flagged
const previousWarSnapshot = async () => {
  const ended = (await processWarDiff(war('inWar', '#OLD', [1, 2, 3, 4]), null, botConfig))!;
  return { ...ended, state: 'warEnded', rosterNotified: true, pingedMissedAttacks: true };
};

let sent: any[];
let saved: any[];
afterEach(() => {
  config.coc.clanTag = configuredClan;
});
beforeEach(() => {
  config.coc.clanTag = CLAN;
  vi.restoreAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  sent = [];
  saved = [];
  vi.spyOn(DiscordService, 'sendWebhook').mockImplementation(async (_url: string, payload: any) => {
    sent.push(payload);
    return true;
  });
  vi.spyOn(DiscordService, 'sendDm').mockResolvedValue(true as any);
  vi.spyOn(FirestoreService, 'saveWarSnapshot').mockImplementation(async (_tag: string, snap: any) => {
    saved.push(snap);
  });
  vi.spyOn(FirestoreService, 'getConfig').mockResolvedValue(botConfig);
  vi.spyOn(FirestoreService, 'saveUser').mockResolvedValue(undefined as any);
  vi.spyOn(FirestoreService, 'getAllUsers').mockResolvedValue([
    {
      discordUserId: '42',
      createdAt: '',
      updatedAt: '',
      accounts: [{ playerTag: '#ME', name: 'Me', townHallLevel: 12, isPrimary: true }],
    },
  ]);
});

const mockApi = (current: any) =>
  vi.spyOn(CocService, 'shared').mockReturnValue({
    getPlayer: vi.fn(async () => {
      throw new Error('not needed');
    }),
    getCurrentWar: vi.fn(async () => current),
    getCwlGroup: vi.fn(async () => ({ state: 'notInWar' })),
  } as any);

describe('a new war after the war task missed its first tick', () => {
  it('leaves the previous war snapshot alone and waits for the war task', async () => {
    mockApi(war('preparation', '#NEW'));
    vi.spyOn(FirestoreService, 'getWarSnapshot').mockResolvedValue(await previousWarSnapshot());
    await runPlayerTrackingJob();
    expect(saved).toEqual([]);
    expect(DiscordService.sendDm).not.toHaveBeenCalled();
  });

  it('sends the roster DM once the war task has saved the new war, keeping its id and flags', async () => {
    const prep = war('preparation', '#NEW');
    const snap = (await processWarDiff(prep, await previousWarSnapshot(), botConfig))!;
    mockApi(prep);
    vi.spyOn(FirestoreService, 'getWarSnapshot').mockResolvedValue(snap);
    await runPlayerTrackingJob();
    expect(DiscordService.sendDm).toHaveBeenCalledTimes(1);
    expect(saved).toEqual([expect.objectContaining({ warId: getWarId(prep), rosterNotified: true })]);
  });

  it('posts the matchup and every attack of the new war, and resets the reminder flag', async () => {
    const prev = await previousWarSnapshot();
    const prep = (await processWarDiff(war('preparation', '#NEW'), prev, botConfig))!;
    expect(prep.pingedMissedAttacks).toBe(false);
    expect(prep.loggedAttackOrders).toEqual([]);
    const battle = (await processWarDiff(war('inWar', '#NEW'), prep, botConfig))!;
    sent = [];
    await processWarDiff(war('inWar', '#NEW', [1, 2]), battle, botConfig);
    const titles = sent.flatMap(headings);
    expect(titles).toHaveLength(2);
    titles.forEach((t) => expect(t).toMatch(/^💥 Our attack: .* 70%$/));
  });
});

describe('war reminders', () => {
  it("does not take the previous war's reminder flag for this war", async () => {
    mockApi(war('inWar', '#NEW'));
    vi.spyOn(FirestoreService, 'getWarSnapshot').mockResolvedValue(await previousWarSnapshot());
    const result = await runWarPingJob('#C');
    expect(result.message).toMatch(/isn't saved yet/);
    expect(saved).toEqual([]);
  });

  it('reminds once for the current war', async () => {
    const current = war('inWar', '#NEW');
    mockApi(current);
    const snap = (await processWarDiff(current, await previousWarSnapshot(), botConfig))!;
    vi.spyOn(FirestoreService, 'getWarSnapshot').mockResolvedValue(snap);
    await runWarPingJob(CLAN);
    expect(sent.flatMap(headings)).toContainEqual('⚠️ ~2h left in the war vs Them');
    expect(saved).toEqual([expect.objectContaining({ warId: getWarId(current), pingedMissedAttacks: true })]);
  });
});
