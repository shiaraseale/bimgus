import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processClanDiff } from '../src/diff/clanDiff';
import { processWarDiff } from '../src/diff/warDiff';
import { processRaidDiff } from '../src/diff/raidDiff';
import { withOurClanFirst } from '../src/diff/cwlWars';
import { DiscordService } from '../src/services/discordService';

// Findings from the 4.6 review
const config: any = {
  webhooks: { clanActivity: 'w', warRoom: 'w', raidWeekend: 'w' },
  notificationsEnabled: {
    memberJoinedLeft: true,
    roleChanges: true,
    thUpgrades: true,
    warAttacks: true,
    warEndSummary: true,
    raidDistricts: true,
  },
};
let sent: any[];
beforeEach(() => {
  vi.restoreAllMocks();
  sent = [];
  vi.spyOn(DiscordService, 'sendWebhook').mockImplementation(async (_url: string, payload: any) => {
    sent.push(payload);
    return true;
  });
});

const member = (tag: string, extra: any = {}) => ({
  tag,
  name: tag,
  role: 'member',
  trophies: 1000,
  townHallLevel: 12,
  ...extra,
});

describe('clan diff', () => {
  it('announces a member who left and came back (older snapshots kept them in membersMap)', async () => {
    const prev: any = {
      tag: '#C',
      name: 'C',
      clanLevel: 1,
      membersCount: 1,
      memberTags: ['#A'],
      membersMap: { '#A': member('#A'), '#B': member('#B') },
      updatedAt: '',
    };
    const clan: any = { tag: '#C', name: 'C', clanLevel: 1, members: 2, memberList: [member('#A'), member('#B')] };
    await processClanDiff(clan, prev, config);
    const titles = sent.flatMap((p) => p.embeds.map((e: any) => e.title));
    expect(titles).toEqual(['📥 New Member Joined']);
  });
});

describe('war diff', () => {
  const war = (state: string): any => ({
    state,
    teamSize: 5,
    preparationStartTime: '20261020T000000.000Z',
    clan: { tag: '#C', name: 'C', stars: 10, destructionPercentage: 80, attacks: 8, members: [] },
    opponent: { tag: '#O', name: 'O', stars: 5, destructionPercentage: 50, attacks: 6, members: [] },
  });

  it('does not post a summary for a war that ended before the bot saw it', async () => {
    await processWarDiff(war('warEnded'), null, config);
    expect(sent.some((p) => p.embeds[0].title.includes('VICTORY'))).toBe(false);
  });

  it('posts the summary when a war it was tracking ends', async () => {
    const tracked = await processWarDiff(war('inWar'), null, config);
    sent = [];
    await processWarDiff(war('warEnded'), tracked, config);
    expect(sent[0].embeds[0].title).toBe('🏆 WAR VICTORY!');
  });
});

describe('raid diff', () => {
  const district = (i: number) => ({
    id: i,
    name: `District ${i}`,
    districtHallLevel: 5,
    destructionPercent: 100,
    attackCount: 6,
    totalLooted: 1000,
    attacks: Array.from({ length: 6 }, (_, n) => ({
      attacker: { tag: '#X', name: `A very long attacker name ${n}` },
      destructionPercent: (n + 1) * 16,
      stars: 1,
    })),
  });
  const weekend = (state: string): any => ({
    state,
    startTime: 'W1',
    capitalTotalLoot: 9000,
    enemyDistrictsDestroyed: 10,
    raidsCompleted: 1,
    attackLog: [
      {
        defender: { tag: '#D', name: 'Enemy', level: 8 },
        attackCount: 60,
        districtCount: 10,
        districtsDestroyed: 10,
        districts: Array.from({ length: 10 }, (_, i) => district(i)),
      },
    ],
  });

  it("keeps the conquered-capital post under Discord's 4,096-character limit", async () => {
    const prev: any = { weekendId: 'W1', state: 'ongoing', completedCapitalTags: [], announcedWeekendEnd: false };
    await processRaidDiff(weekend('ongoing'), prev, config, '#C');
    expect(sent).toHaveLength(1);
    expect(sent[0].embeds[0].description.length).toBeLessThanOrEqual(4096);
  });

  it('does not announce "Raid Weekend Started" on the very first run', async () => {
    await processRaidDiff(weekend('ongoing'), null, config, '#C');
    expect(sent.some((p) => p.embeds[0].title.includes('Started'))).toBe(false);
  });
});

describe('CWL dashboard data', () => {
  it('puts our clan on the clan side', () => {
    const w: any = { clan: { tag: '#THEM' }, opponent: { tag: '#US' } };
    expect(withOurClanFirst(w, '#us').clan.tag).toBe('#US');
    expect(withOurClanFirst(withOurClanFirst(w, '#US'), '#US').clan.tag).toBe('#US');
  });
});
