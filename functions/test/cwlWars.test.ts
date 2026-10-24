import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findActiveCwlWar, findOurCwlWar } from '../src/diff/cwlWars';
import { processCwlDiff } from '../src/diff/cwlDiff';
import { DiscordService } from '../src/services/discordService';
import { CocService } from '../src/services/cocService';

const US = '#US';
const war = (tag: string, ours: boolean, state: string) => ({
  tag, state, teamSize: 15,
  clan: { tag: ours ? US : `#A${tag}`, name: 'Clan', stars: 0, destructionPercentage: 0, attacks: 0, members: [] },
  opponent: { tag: `#B${tag}`, name: 'Them', stars: 0, destructionPercentage: 0, attacks: 0, members: [] },
});

// Round r has wars #r0..#r3; ours is #r1. Rounds 0–1 ended, round 2 at battle day, round 3 in preparation
const states = ['warEnded', 'warEnded', 'inWar', 'preparation'];
const group: any = {
  state: 'inWar',
  season: '2026-10',
  clans: [],
  rounds: [0, 1, 2, 3, 4, 5, 6].map((r) => ({ warTags: r < 4 ? [0, 1, 2, 3].map((i) => `#${r}${i}`) : ['#0', '#0', '#0', '#0'] })),
};

describe('CWL war lookups (3.3)', () => {
  let getCwlWar: ReturnType<typeof vi.fn>;
  let coc: CocService;
  beforeEach(() => {
    vi.restoreAllMocks();
    getCwlWar = vi.fn(async (tag: string) => war(tag, tag[2] === '1', states[Number(tag[1])]));
    coc = { getCwlWar } as unknown as CocService;
  });

  it('needs one request when our war tag is already known', async () => {
    const found = await findOurCwlWar(group.rounds[2].warTags, US, coc, '#21');
    expect(found?.warTag).toBe('#21');
    expect(getCwlWar).toHaveBeenCalledTimes(1);
  });

  it('finds the battle-day war, newest round first, without touching ended rounds', async () => {
    const active = await findActiveCwlWar(group, US, coc);
    expect(active).toMatchObject({ warTag: '#21', roundIndex: 2 });
    const fetchedRounds = new Set(getCwlWar.mock.calls.map(([t]) => t[1]));
    expect([...fetchedRounds].sort()).toEqual(['2', '3']);
  });

  it('falls back to the preparation war when nothing is at battle day', async () => {
    const prepOnly = { ...group, rounds: group.rounds.map((r: any, i: number) => (i === 2 ? { warTags: ['#0'] } : r)) };
    states[2] = 'warEnded';
    const active = await findActiveCwlWar(prepOnly, US, coc);
    states[2] = 'inWar';
    expect(active).toMatchObject({ warTag: '#31', roundIndex: 3 });
  });

  it('war reminders only look for battle day', async () => {
    const onlyPrep = { ...group, rounds: group.rounds.map((r: any, i: number) => (i === 2 ? { warTags: ['#0'] } : r)) };
    expect(await findActiveCwlWar(onlyPrep, US, coc, ['inWar'])).toBeNull();
  });

  it('marks an ended round as done even with round summaries switched off', async () => {
    vi.spyOn(DiscordService, 'sendWebhook').mockResolvedValue(true);
    const prev: any = { season: '2026-10', state: 'inWar', clans: [], announcedGroup: true, loggedRoundIndices: [], updatedAt: '' };
    const snapshot = await processCwlDiff(group, US, prev, { webhooks: {}, notificationsEnabled: {} } as any, coc);
    expect(snapshot?.loggedRoundIndices.sort()).toEqual([0, 1]);
  });

  it('the poll skips rounds that are fully reported and remembers our war tags', async () => {
    vi.spyOn(DiscordService, 'sendWebhook').mockResolvedValue(true);
    const config: any = { webhooks: {}, notificationsEnabled: {} };
    const prev: any = {
      season: '2026-10', state: 'inWar', clans: [], announcedGroup: true,
      loggedRoundIndices: [0, 1], ourWarTags: { 2: '#21' }, updatedAt: '',
    };
    const snapshot = await processCwlDiff(group, US, prev, config, coc);
    const fetched = getCwlWar.mock.calls.map(([t]) => t);
    expect(fetched.some((t) => t.startsWith('#0') || t.startsWith('#1'))).toBe(false);
    expect(fetched.filter((t) => t.startsWith('#2'))).toEqual(['#21']); // known tag: one request
    expect(snapshot?.ourWarTags).toEqual({ 2: '#21', 3: '#31' });
  });
});
