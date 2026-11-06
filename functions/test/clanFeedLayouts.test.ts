import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processClanDiff } from '../src/diff/clanDiff';
import { buildAttackCard, processWarDiff, sendWarSummaryDiscord } from '../src/diff/warDiff';
import { processCwlDiff, sendCwlSeasonSummaryDiscord } from '../src/diff/cwlDiff';
import { DiscordService } from '../src/services/discordService';
import { buildAttackReminder } from '../src/jobs/warPingJob';
import { CocService } from '../src/services/cocService';
import { CwlPlayerSummary, CwlSeasonSummary } from '../src/types/db';
import { buttonLabels, cards, expectLayout, headings, texts } from './layoutHelpers';

// The clan feed's cards (5.5): short, and within Discord's layout limits however big the war
const config: any = {
  webhooks: { clanActivity: 'w', warRoom: 'w', cwlHub: 'w' },
  notificationsEnabled: {
    memberJoinedLeft: true,
    roleChanges: true,
    thUpgrades: true,
    warAttacks: true,
    cwlRoundSummary: true,
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
  name: tag.slice(1),
  role: 'member',
  trophies: 1000,
  townHallLevel: 12,
  ...extra,
});

const warMember = (i: number, attacks: any[] = [], name = `Member ${i}`) => ({
  tag: `#M${i}`,
  name,
  mapPosition: i,
  townhallLevel: 12,
  attacks,
});

describe('clan diff', () => {
  it("sends a poll's joins, leaves, role changes and Town Hall upgrades as one message", async () => {
    const prev: any = {
      memberTags: ['#A', '#B', '#C'],
      membersMap: { '#A': member('#A'), '#B': member('#B', { role: 'admin' }), '#C': member('#C') },
    };
    const clan: any = {
      tag: '#CLAN',
      members: 3,
      memberList: [member('#A', { role: 'admin' }), member('#C', { townHallLevel: 13 }), member('#D')],
    };
    await processClanDiff(clan, prev, config);

    expect(sent).toHaveLength(1);
    expectLayout(sent[0]);
    expect(headings(sent[0])).toEqual([
      '📥 \u2068D\u2069 joined',
      '📤 \u2068B\u2069 left',
      expect.stringMatching(/ \u2068A\u2069 promoted$/),
      '🏛️ \u2068C\u2069 reached TH13',
    ]);
    expect(texts(sent[0])).toContain('Member → Elder');
    expect(texts(sent[0])).toContain('### 🏛️ \u2068C\u2069 reached TH13\n🎉 Well done!\n');
    // The link buttons once, inside the last card
    expect(buttonLabels(cards(sent[0]).at(-1))).toEqual(['Open CoC', 'Clash of Stats']);
    expect(buttonLabels(sent[0])).toHaveLength(2);
  });
});

describe('war cards', () => {
  it('puts the result first on an attack card, and the score and context in the footer', () => {
    const attack: any = {
      isClanAttack: false,
      stars: 2,
      destructionPercentage: 85,
      attacker: { name: 'Them 4', mapPosition: 4, townhallLevel: 13 },
      defender: { name: 'Member 2', mapPosition: 2, townhallLevel: 12 },
    };
    const c = buildAttackCard(
      attack,
      { stars: 12, destructionPercentage: 45 },
      { stars: 10, destructionPercentage: 38.24 },
      [],
      'CWL round 3'
    );
    const text = texts(c);
    expect(text).toMatch(/^### 🛡️ Enemy attack: .* 85%$/m);
    expect(text).toContain('**#4 \u2068Them 4\u2069** (TH13) → **#2 \u2068Member 2\u2069** (TH12)');
    expect(text).toMatch(/^-# Score 12–10 .* · 45\.0% vs 38\.2% · CWL round 3$/m);
  });

  const prepWar = (size: number, name = (i: number) => `Member ${i}`): any => ({
    state: 'preparation',
    teamSize: size,
    clan: {
      tag: '#C',
      name: 'Us',
      stars: 0,
      destructionPercentage: 0,
      attacks: 0,
      members: Array.from({ length: size }, (_, i) => ({ ...warMember(i + 1, [], name(i + 1)), townhallLevel: 15 })),
    },
    opponent: {
      tag: '#O',
      name: 'Them',
      clanLevel: 12,
      stars: 0,
      destructionPercentage: 0,
      attacks: 0,
      members: Array.from({ length: size }, (_, i) => ({ ...warMember(i + 1, [], `Rival ${i + 1}`), tag: `#O${i}` })),
    },
  });

  it("lists the matchup's lineup, our player and their mirror on each line", async () => {
    await processWarDiff(prepWar(3), null, config);
    expect(sent).toHaveLength(1);
    expectLayout(sent[0]);
    const text = texts(sent[0]);
    expect(text).toContain('**\u2068Us\u2069** vs **\u2068Them\u2069**\n` 1 \u2068Member 1\u2069 (TH15) vs \u2068Rival 1\u2069 (TH12)`');
    expect(text).toContain('` 3 \u2068Member 3\u2069 (TH15) vs \u2068Rival 3\u2069 (TH12)`');
  });

  it('lines up every "vs", and copes with a missing mirror and a backtick in a name', async () => {
    const war = prepWar(3, (i) => (i === 2 ? 'Fifteen chars15' : `M${i}`));
    war.clan.members[0].townhallLevel = 9;
    war.clan.members[2].name = 'Back`tick'; // a backtick would end the monospace early
    war.opponent.members.pop(); // no mirror for #3
    await processWarDiff(war, null, config);

    const rows = texts(sent[0])
      .split('\n')
      .filter((l) => l.startsWith('`'));
    expect(rows).toEqual([
      `\` 1 \u2068M1\u2069${' (TH9)'.padEnd(20)} vs \u2068Rival 1\u2069 (TH12)\``,
      '` 2 \u2068Fifteen chars15\u2069 (TH15) vs \u2068Rival 2\u2069 (TH12)`',
      `\` 3 \u2068Back'tick\u2069${' (TH15)'.padEnd(13)} vs ${'–'.padEnd(14)}\``,
    ]);
  });

  it('isolates an Arabic name in the lineup without pushing the columns out', async () => {
    const war = prepWar(2, (i) => (i === 1 ? 'البرق' : 'Member 2'));
    await processWarDiff(war, null, config);
    const rows = texts(sent[0])
      .split('\n')
      .filter((l) => l.startsWith('`'));
    expect(rows[0]).toBe('` 1 \u2068البرق\u2069 (TH15)    vs \u2068Rival 1\u2069 (TH12)`');
    // On screen the marks take no room, so the "vs" lines up once they're gone
    const visible = rows.map((r) => r.replace(/[\u2068\u2069]/g, ''));
    expect(new Set(visible.map((r) => r.indexOf(' vs '))).size).toBe(1);
  });

  it("shortens a rival's name only where a row would be too wide for a phone", async () => {
    const lineup = async (ourName: string) => {
      sent.length = 0;
      const war = prepWar(2, () => ourName);
      war.opponent.members[0].name = 'Rival Longnames';
      await processWarDiff(war, null, config);
      return texts(sent[0])
        .split('\n')
        .filter((l) => l.startsWith('`'));
    };

    const widest = await lineup('Fifteen chars15');
    expect(widest[0]).toBe('` 1 \u2068Fifteen chars15\u2069 (TH15) vs \u2068Rival Long…\u2069 (TH12)`');
    // The isolate marks take no room on screen
    widest.forEach((row) => expect(row.replace(/[\u2068\u2069]/g, '').length - 2).toBeLessThanOrEqual(47));

    expect((await lineup('Short'))[0]).toBe('` 1 \u2068Short\u2069 (TH15) vs \u2068Rival Longnames\u2069 (TH12)`');
  });

  it("fits a 50v50 war's lineup in the matchup message", async () => {
    // Clash allows 15-character names
    await processWarDiff(
      prepWar(50, (i) => `Fifteen chars${String(i).padStart(2, '0')}`),
      null,
      config
    );
    expectLayout(sent[0]);
    expect(texts(sent[0])).toContain('`50 \u2068Fifteen chars50\u2069 (TH15) vs \u2068Rival 50\u2069 (TH12)`');
  });

  it("fits a 50v50 war's summary and audit in one message", async () => {
    // Nobody attacked except #1, who hit an already 3-starred base
    const tripled = { order: 1, attackerTag: '#M1', defenderTag: '#O1', stars: 3, destructionPercentage: 100 };
    const again = { order: 2, attackerTag: '#M1', defenderTag: '#O1', stars: 1, destructionPercentage: 60 };
    const members = Array.from({ length: 50 }, (_, i) => warMember(i + 1, i === 0 ? [tripled, again] : []));
    const opponents = Array.from({ length: 50 }, (_, i) => ({ ...warMember(i + 1), tag: `#O${i + 1}` }));
    const war: any = {
      state: 'warEnded',
      teamSize: 50,
      clan: { tag: '#C', name: 'Us', stars: 3, destructionPercentage: 2, attacks: 2, members },
      opponent: { tag: '#O', name: 'Them', stars: 80, destructionPercentage: 90, attacks: 90, members: opponents },
    };
    await sendWarSummaryDiscord('w', war);

    expect(sent).toHaveLength(1);
    expectLayout(sent[0]);
    expect(headings(sent[0])).toEqual(['💀 War lost vs \u2068Them\u2069']);
    expect(texts(sent[0])).toContain('🗡️ Attacks used: 2/100 vs 90/100');
    expect(texts(sent[0])).toContain('🚨 **No attacks**: #2 \u2068Member 2\u2069, #3 \u2068Member 3\u2069');
    expect(texts(sent[0])).toContain('**Hit a base already at 3');
  });
});

describe('CWL cards', () => {
  it('posts a finished round as one card with its audit', async () => {
    const war: any = {
      state: 'warEnded',
      teamSize: 2,
      clan: {
        tag: '#C',
        name: 'Us',
        stars: 3,
        destructionPercentage: 75,
        attacks: 1,
        members: [
          warMember(1, [{ order: 1, attackerTag: '#M1', defenderTag: '#O1', stars: 3, destructionPercentage: 100 }]),
          warMember(2),
        ],
      },
      opponent: { tag: '#O', name: 'Them', stars: 2, destructionPercentage: 60, attacks: 2, members: [] },
    };
    const group: any = {
      state: 'inWar',
      season: '2026-10',
      clans: [],
      rounds: [{ warTags: ['#W1'] }, ...Array.from({ length: 6 }, () => ({ warTags: ['#0'] }))],
    };
    const prev: any = { season: '2026-10', announcedGroup: true, loggedRoundIndices: [], ourWarTags: { 0: '#W1' } };
    const coc = { getCwlWar: vi.fn(async () => war) } as unknown as CocService;

    await processCwlDiff(group, '#C', prev, config, coc);

    expect(sent).toHaveLength(1);
    expectLayout(sent[0]);
    expect(headings(sent[0])).toEqual(['🏆 CWL round 1: won vs \u2068Them\u2069']);
    expect(texts(sent[0])).toContain('🗡️ Attacks used: 1/2 vs 2/2');
    expect(texts(sent[0])).toContain('🚨 **No attack**: #2 \u2068Member 2\u2069');
    expect(texts(sent[0])).toContain('⭐ **3 stars**: #1 \u2068Member 1\u2069');
  });

  it("keeps a big season's recap within Discord's limits", async () => {
    const hits = (i: number) =>
      Array.from({ length: 7 }, (_, r) => ({
        round: r + 1,
        attackerTag: `#M${i}`,
        attackerName: `A rather long player name ${i}`,
        attackerTh: 12,
        defenderTag: '#X',
        defenderName: 'A rather long defender name',
        defenderTh: 14,
        thDiff: 2,
        stars: 2,
        destruction: 70,
      }));
    const players: CwlPlayerSummary[] = Array.from({ length: 35 }, (_, i) => ({
      tag: `#M${i}`,
      name: `A rather long player name ${i}`,
      townhallLevel: 12,
      roundsRostered: 7,
      attacksUsed: 6,
      missedAttacks: 1,
      totalStars: 14,
      totalDestruction: 420,
      avgDestruction: 70,
      perfectHits: 0,
      underdogHits: hits(i),
    }));
    const summary: CwlSeasonSummary = {
      season: '2026-10',
      clanTag: '#C',
      clanName: 'Us',
      roundsPlayed: 7,
      wins: 4,
      losses: 3,
      ties: 0,
      totalClanStars: 150,
      winBonusStars: 40,
      avgClanDestruction: 70,
      playerSummaries: players,
      topPerformers: players.slice(0, 5),
      missedAttacksList: players.map((p) => ({ ...p, missedAttacks: 1 })),
      underdogHits: players.flatMap((p) => p.underdogHits),
    };
    await sendCwlSeasonSummaryDiscord(summary, 'w');

    expect(sent.length).toBeGreaterThan(0);
    sent.forEach((m, i) => expectLayout(m, `message ${i + 1}`));
    const all = sent.flatMap(headings);
    expect(all).toEqual(['🏆 CWL 2026-10: 4W 3L', '⭐ Stars leaderboard']);
    expect(sent.map(texts).join('\n')).toContain('🥊 **Underdogs**');
    sent.forEach((m) => expect(buttonLabels(cards(m).at(-1))).toEqual(['Open CoC', 'Clash of Stats']));

    // The leaderboard's columns line up: each row is two runs of monospace, each run one width
    const rows = sent
      .map(texts)
      .join('\n')
      .split('\n')
      .filter((l) => l.startsWith('`'))
      .map((l) => l.match(/`[^`]*`/g)!);
    expect(rows.length).toBeGreaterThan(1);
    rows.forEach((r) => expect(r).toHaveLength(2));
    expect(new Set(rows.map((r) => r[0].length)).size).toBe(1);
    expect(new Set(rows.map((r) => r[1].length)).size).toBe(1);
  });
});

describe('attack reminders', () => {
  const clan = (members: any[]): any => ({ name: 'Us', stars: 20, destructionPercentage: 40, attacks: 30, members });
  const hit = { order: 1, attackerTag: '#X', defenderTag: '#Y', stars: 2, destructionPercentage: 70 };
  const reminder = (members: any[], extra: any = {}) =>
    buildAttackReminder({
      ourClan: clan(members),
      enemyClan: { ...clan([]), name: 'Them', stars: 18 },
      teamSize: members.length,
      attacksPerMember: 2,
      hoursLeft: 2.6,
      endMs: Date.UTC(2026, 9, 30, 12),
      clanTag: '#C',
      ...extra,
    });

  it('names who still has attacks, with how many are left for those who started', () => {
    const msg = reminder([warMember(2, [hit, hit]), warMember(3), warMember(1, [hit])])!;
    expectLayout(msg);
    // 2.6 hours: rounded down, as Discord's "in 2 hours" is
    expect(headings(msg)).toEqual(['⚠️ ~2h left in the war vs \u2068Them\u2069']);
    const labels = cards(msg)[0]
      .components.filter((c: any) => c.type === 1)
      .flatMap((r: any) => r.components.map((b: any) => b.label));
    expect(labels).toEqual(['Open CoC', 'Clash of Stats']);
    expect(texts(msg)).toContain('**Still to attack**: #1 \u2068Member 1\u2069 (1 left), #3 \u2068Member 3\u2069');
    expect(texts(msg)).toMatch(/^Ends <t:\d+:R> \(<t:\d+:s>\)$/m);
  });

  it('says which CWL round', () => {
    const msg = reminder([warMember(1)], { attacksPerMember: 1, roundNum: 4 })!;
    expect(headings(msg)).toEqual(['⚠️ ~2h left in CWL round 4 vs \u2068Them\u2069']);
    expect(headings(reminder([warMember(1)], { hoursLeft: 0.4 })!)).toEqual([
      '⚠️ Under an hour left in the war vs \u2068Them\u2069',
    ]);
  });

  it('is null when everyone has attacked', () => {
    expect(reminder([warMember(1, [hit, hit])])).toBeNull();
  });

  it('fits a 50v50 war where nobody has attacked', () => {
    const members = Array.from({ length: 50 }, (_, i) => warMember(i + 1, [], `A rather long player name ${i}`));
    expectLayout(reminder(members)!);
  });
});
