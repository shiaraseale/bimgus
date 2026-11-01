import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processClanDiff } from '../src/diff/clanDiff';
import { processWarDiff } from '../src/diff/warDiff';
import { processRaidDiff } from '../src/diff/raidDiff';
import { withOurClanFirst } from '../src/diff/cwlWars';
import { DiscordService } from '../src/services/discordService';
import { EMOJIS } from '../src/constants/emojis';
import { buttonLabels, expectLayout, headings, texts } from './layoutHelpers';

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
    raidEndSummary: true,
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
    expect(sent.flatMap(headings)).toEqual(['📥 #B joined']);
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
    expect(sent.flatMap(headings).some((h) => h.includes('War won'))).toBe(false);
  });

  it('posts the summary when a war it was tracking ends', async () => {
    const tracked = await processWarDiff(war('inWar'), null, config);
    sent = [];
    await processWarDiff(war('warEnded'), tracked, config);
    expect(headings(sent[0])).toEqual(['🏆 War won vs O']);
    expect(texts(sent[0])).toContain('✅ Everyone used every attack');
  });
});

describe('raid diff', () => {
  const district = (i: number, hits: number) => ({
    id: i,
    name: `District ${i}`,
    districtHallLevel: 5,
    destructionPercent: 100,
    attackCount: hits,
    totalLooted: 1000,
    attacks: Array.from({ length: hits }, (_, n) => ({
      attacker: { tag: '#X', name: `A very long attacker name ${n}` },
      destructionPercent: Math.min(100, (n + 1) * 16),
      stars: 1,
    })),
  });
  const weekend = (state: string, hits = 6): any => ({
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
        districts: Array.from({ length: 10 }, (_, i) => district(i, hits)),
      },
    ],
  });

  const prev: any = { weekendId: 'W1', state: 'ongoing', completedCapitalTags: [], announcedWeekendEnd: false };

  it('lists each district with its attackers in order', async () => {
    await processRaidDiff(weekend('ongoing'), prev, config, '#C', []);
    expect(sent).toHaveLength(1);
    expectLayout(sent[0]);
    // The API lists the latest attack first
    expect(texts(sent[0])).toContain('A very long attacker name 5, A very long attacker name 4');
  });

  it('puts the districts in columns, with the attackers on a small line under each', async () => {
    const raid = weekend('ongoing');
    const [first, second] = raid.attackLog[0].districts;
    raid.attackLog[0].districts = [
      { ...first, name: 'Capital Peak', districtHallLevel: 10, attackCount: 12, totalLooted: 12500 },
      { ...second, name: 'Golem Quarry', districtHallLevel: 2, destructionPercent: 40, attacks: [], totalLooted: 900 },
    ];
    await processRaidDiff(raid, prev, config, '#C', []);

    const lines = texts(sent[0]).split('\n');
    const rows = lines.filter((l) => l.startsWith('`'));
    expect(rows).toEqual([
      `\`Capital Peak (10)  100%  12\` 🗡️ \`12,500\` ${EMOJIS.CAPITAL_GOLD}`,
      `\`Golem Quarry (2)    40%   6\` 🗡️ \`   900\` ${EMOJIS.CAPITAL_GOLD}`,
    ]);
    expect(lines[lines.indexOf(rows[0]) + 1]).toMatch(/^-# A very long attacker name 5, /);
    expect(lines[lines.indexOf(rows[1]) + 1]).not.toMatch(/^-# /); // nobody attacked it
  });

  it("keeps the conquered-capital post within Discord's limits, dropping attackers' names first", async () => {
    await processRaidDiff(weekend('ongoing', 20), prev, config, '#C', []);
    expect(sent).toHaveLength(1);
    expectLayout(sent[0]);
    expect(texts(sent[0])).not.toContain('attacker name');
    expect(texts(sent[0])).toContain('District 9');
  });

  it('does not announce "Raid Weekend Started" on the very first run', async () => {
    await processRaidDiff(weekend('ongoing'), null, config, '#C', []);
    expect(sent).toEqual([]);
  });

  describe('the end of weekend recap', () => {
    const raider = (name: string, gold: number, attacks = 6, bonus = 1) => ({
      tag: `#${name}`,
      name,
      attacks,
      attackLimit: 5,
      bonusAttackLimit: bonus,
      capitalResourcesLooted: gold,
    });
    const roster = ['Zed', 'Blake', 'Ana', 'Cy'].map((name) => ({ tag: `#${name}`, name }));
    const ended = (members: any[] | undefined) => ({
      ...weekend('ended'),
      totalAttacks: 60,
      attackLog: [],
      members,
    });

    it('ranks who raided by capital gold, and lists who did not', async () => {
      const members = [raider('Ana', 900), raider('Cy', 2500, 3, 0), raider('Blake', 900, 5, 0)];
      await processRaidDiff(ended(members), prev, config, '#C', roster);

      expect(sent).toHaveLength(1);
      expectLayout(sent[0]);
      expect(headings(sent[0])).toEqual([expect.stringMatching(/Raid weekend has ended$/)]);
      const lines = texts(sent[0]).split('\n');
      // Level on gold: the one with fewer attacks goes first
      expect(lines.filter((l) => l.startsWith('`'))).toEqual([
        `\` 1. Cy     3/5\` 🗡️ \`2,500\` ${EMOJIS.CAPITAL_GOLD}`,
        `\` 2. Blake  5/5\` 🗡️ \`  900\` ${EMOJIS.CAPITAL_GOLD}`,
        `\` 3. Ana    6/6\` 🗡️ \`  900\` ${EMOJIS.CAPITAL_GOLD}`,
      ]);
      expect(lines).toContain('🏅 **Ranking**');
      expect(texts(sent[0])).toContain('🚨 **No attacks (1)**: Zed');
      expect(texts(sent[0])).toContain('-# 3 members took part');
      expect(buttonLabels(sent[0])).toEqual(['Open CoC', 'Clash of Stats']);
    });

    it('keeps someone who left since raiding in the ranking, and sorts the names', async () => {
      await processRaidDiff(ended([raider('Gone', 1000)]), prev, config, '#C', roster);
      expect(texts(sent[0])).toContain(`\` 1. Gone  6/6\` 🗡️ \`1,000\` ${EMOJIS.CAPITAL_GOLD}`);
      expect(texts(sent[0])).toContain('🚨 **No attacks (4)**: Ana, Blake, Cy, Zed');
    });

    it('lines the columns up, and a backtick in a name cannot break its row', async () => {
      const members = [raider('Al', 31250), raider('A longest name', 900), raider('Back`tick', 12000, 3, 0)];
      await processRaidDiff(ended(members), prev, config, '#C', roster);
      const rows = texts(sent[0])
        .split('\n')
        .filter((l) => l.startsWith('`'))
        .map((l) => l.match(/`[^`]*`/g)!);
      expect(rows.map((r) => r.length)).toEqual([2, 2, 2]);
      expect(new Set(rows.map((r) => r[0].length)).size).toBe(1);
      expect(new Set(rows.map((r) => r[1].length)).size).toBe(1);
      expect(rows[1][0]).toContain("Back'tick");
    });

    it('says so when everyone raided', async () => {
      const members = roster.map((m) => raider(m.name, 500));
      await processRaidDiff(ended(members), prev, config, '#C', roster);
      expect(texts(sent[0])).toContain('✅ Everyone raided');
      expect(texts(sent[0])).not.toContain('No attacks');
    });

    it('copes with a weekend the API gives no members for', async () => {
      await processRaidDiff(ended(undefined), prev, config, '#C', roster);
      expect(texts(sent[0])).toContain('🚨 **No attacks (4)**');
      expect(texts(sent[0])).not.toContain('Ranking');
    });

    it('carries on into another message rather than leave anyone out', async () => {
      // More than a clan can hold, so this splits with or without the custom emoji's long code
      const members = Array.from({ length: 100 }, (_, i) => raider(`Long name ${i}`.padEnd(15, 'x'), 40000 - i));
      const others = Array.from({ length: 50 }, (_, i) => ({ tag: `#O${i}`, name: 'Other long name' }));
      await processRaidDiff(ended(members), prev, config, '#C', others);

      expect(sent.length).toBeGreaterThan(1);
      sent.forEach((m, i) => expectLayout(m, `message ${i + 1}`));
      const lines = sent.map(texts).join('\n').split('\n');
      expect(lines.filter((l) => l.startsWith('`'))).toHaveLength(100);
      // The title opens it, what's left closes it, and each message has its heading and buttons
      expect(texts(sent[0])).toContain('Raid weekend has ended');
      expect(sent.slice(1).map(texts).join()).not.toContain('Raid weekend has ended');
      expect(sent.slice(0, -1).map(texts).join()).not.toContain('No attacks');
      expect(texts(sent.at(-1))).toContain('**No attacks (50)**');
      expect(texts(sent.at(-1))).toContain('-# 100 members took part');
      sent.forEach((m) => {
        expect(texts(m)).toContain('🏅 **Ranking**');
        expect(buttonLabels(m)).toEqual(['Open CoC', 'Clash of Stats']);
      });
    });

    it('comes after an unfinished capital, once', async () => {
      const unfinished = {
        defender: { tag: '#D', name: 'Enemy', level: 8 },
        attackCount: 3,
        districtCount: 2,
        districtsDestroyed: 1,
        districts: [{ ...district(0, 1), destructionPercent: 40 }],
      };
      const raid: any = { ...ended([raider('Ana', 900)]), attackLog: [unfinished] };
      const after = await processRaidDiff(raid, prev, config, '#C', roster);
      expect(sent.flatMap(headings)).toEqual([
        expect.stringMatching(/Enemy: 50% when the weekend ended$/),
        expect.stringMatching(/Raid weekend has ended$/),
      ]);

      sent.length = 0;
      await processRaidDiff(raid, after, config, '#C', roster);
      expect(sent).toEqual([]);
    });

    it('waits for the end, skips a first run, and has its own setting', async () => {
      const members = [raider('Ana', 900)];
      await processRaidDiff({ ...ended(members), state: 'ongoing' } as any, prev, config, '#C', roster);
      await processRaidDiff(ended(members), null, config, '#C', roster);
      expect(sent).toEqual([]);

      const off = { ...config, notificationsEnabled: { ...config.notificationsEnabled, raidEndSummary: false } };
      await processRaidDiff(ended(members), prev, off, '#C', roster);
      expect(sent).toEqual([]);
    });
  });
});

describe('CWL dashboard data', () => {
  it('puts our clan on the clan side', () => {
    const w: any = { clan: { tag: '#THEM' }, opponent: { tag: '#US' } };
    expect(withOurClanFirst(w, '#us').clan.tag).toBe('#US');
    expect(withOurClanFirst(withOurClanFirst(w, '#US'), '#US').clan.tag).toBe('#US');
  });
});
