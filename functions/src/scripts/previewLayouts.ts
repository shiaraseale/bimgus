import { config } from '../config';
import { DiscordService } from '../services/discordService';
import { CocService } from '../services/cocService';
import { processClanDiff } from '../diff/clanDiff';
import { processClanGamesDiff } from '../diff/clanGamesDiff';
import { processWarDiff } from '../diff/warDiff';
import { processCwlDiff, sendCwlSeasonSummaryDiscord } from '../diff/cwlDiff';
import { processRaidDiff } from '../diff/raidDiff';
import { buildAttackReminder } from '../jobs/warPingJob';
import { buildRosterDm } from '../jobs/playerTrackingJob';
import { buildUpgradeDm, UpgradeEvent } from '../services/upgradeNotifier';
import { BotConfigDoc, CwlPlayerSummary, CwlSeasonSummary } from '../types/db';
import { LinkedAccount } from '../types/user';
import { CapitalRaidWeekend, CurrentWarResponse, CwlGroupResponse, WarAttack, WarClan } from '../types/coc';
import { DiscordWebhookPayload } from '../types/discord';
import { log } from '../utils/log';

/**
 * Posts one of every clan-feed message, reminder and DM to a test channel, built from made-up data, to
 * see how the layouts look (5.8). CWL, raid weekend and Clan Games messages can't be triggered on demand.
 *
 *   npm run preview-layouts              posts to DISCORD_TEST_CHANNEL_WEBHOOK (functions/.env)
 *   npm run preview-layouts -- --print   prints each message's text instead
 *   npm run preview-layouts -- war cwl   only those sections (clan, clan-games, war, cwl, raids,
 *                                        reminders, dms)
 *
 * Every message goes to the test channel, whatever webhook the code asks for. Slash command replies
 * need an interaction, so try those with the test bot instead.
 */

const CLAN = '#PREVIEW';
const HOUR = 3600_000;
// One clock for the whole run, so each war keeps the same id from one poll to the next
const NOW = Date.now();
const cocTime = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '');

const botConfig: BotConfigDoc = {
  clanTag: CLAN,
  webhooks: { clanActivity: 'test', warRoom: 'test', cwlHub: 'test', raidWeekend: 'test', clanGames: 'test' },
  notificationsEnabled: {
    memberJoinedLeft: true,
    roleChanges: true,
    thUpgrades: true,
    warAttacks: true,
    warEndSummary: true,
    warAttackReminders: true,
    raidDistricts: true,
    cwlGroup: true,
    cwlRoundSummary: true,
    clanGamesStart: true,
    clanGamesTiers: true,
    clanGamesMaxers: true,
  },
  warReminderHours: [4],
};

const NAMES = ['Avery', 'Blake', 'Casey', 'Devon', 'Emery', 'Finley', 'Harper', 'Jordan', 'Kendall', 'Logan'];

const clanMember = (i: number, extra: object = {}) => ({
  tag: `#P${i}`,
  name: NAMES[i],
  role: 'member',
  trophies: 2400 + i * 37,
  townHallLevel: 13,
  ...extra,
});

async function previewClan() {
  const prev: any = {
    memberTags: ['#P0', '#P1', '#P2', '#P3'],
    membersMap: Object.fromEntries(
      [0, 1, 2, 3].map((i) => [`#P${i}`, clanMember(i, i === 1 ? { role: 'admin' } : {})])
    ),
  };
  const clan: any = {
    tag: CLAN,
    members: 4,
    memberList: [clanMember(0, { role: 'admin' }), clanMember(2, { townHallLevel: 14 }), clanMember(3), clanMember(4)],
  };
  await processClanDiff(clan, prev, botConfig);
}

async function previewClanGames() {
  const members: any[] = [clanMember(0)];
  const at = (points: number) => ({
    getPlayer: async () => ({ achievements: [{ name: 'Games Champion', value: points }] }),
  });
  const start = await processClanGamesDiff(
    members,
    null,
    botConfig,
    at(1000) as unknown as CocService,
    CLAN,
    new Date('2026-11-22T08:00:00Z')
  );
  // The same player, 10,000 points later: maxed, and the clan past tiers 1 and 2
  await processClanGamesDiff(
    members,
    start,
    botConfig,
    at(11000) as unknown as CocService,
    CLAN,
    new Date('2026-11-23T08:00:00Z')
  );
}

const warClan = (tag: string, name: string, size: number, attacks: (i: number) => WarAttack[]): WarClan => {
  const members = Array.from({ length: size }, (_, i) => ({
    tag: `${tag}-${i + 1}`,
    name: tag === CLAN ? NAMES[i] : `Rival ${i + 1}`,
    mapPosition: i + 1,
    // The rivals' Town Halls run a little behind ours, so the lineup shows some mismatches
    townhallLevel: 15 - Math.floor((tag === CLAN ? i : i + 1) / 3),
    attacks: attacks(i),
  }));
  const all = members.flatMap((m) => m.attacks);
  // Each base counts its best attack once
  const best = new Map<string, number>();
  all.forEach((a) => best.set(a.defenderTag, Math.max(best.get(a.defenderTag) ?? 0, a.destructionPercentage)));
  return {
    tag,
    name,
    badgeUrls: { small: '', medium: '', large: '' },
    clanLevel: 18,
    attacks: all.length,
    stars: all.reduce((n, a) => n + a.stars, 0),
    destructionPercentage: [...best.values()].reduce((n, d) => n + d, 0) / size,
    members,
  };
};

const hit = (order: number, attacker: string, defender: string, stars: number, pct: number): WarAttack => ({
  order,
  attackerTag: attacker,
  defenderTag: defender,
  stars,
  destructionPercentage: pct,
});

// Our member i's two attacks: #1 hits its base again after tripling it (a wasted attack), #2 gets all
// six stars, the rest take two then three stars off their mirror. Members 9 and 10 never attack.
function ourAttacks(i: number): WarAttack[] {
  const me = `${CLAN}-${i + 1}`;
  if (i === 0) return [hit(1, me, '#RIVAL-1', 3, 100), hit(2, me, '#RIVAL-1', 1, 55)];
  if (i === 1) return [hit(3, me, '#RIVAL-2', 3, 100), hit(4, me, '#RIVAL-10', 3, 100)];
  return i < 8 ? [hit(i * 2 + 1, me, `#RIVAL-${i + 1}`, 2, 74), hit(i * 2 + 2, me, `#RIVAL-${i + 1}`, 3, 100)] : [];
}

/** A 10v10 war with our first `ourHits` attacks made (by order), each member keeping `perMember`. */
function war(
  state: CurrentWarResponse['state'],
  ourHits: number,
  theirHits: number,
  perMember = 2
): CurrentWarResponse {
  const size = 10;
  const now = NOW;
  const ours = warClan(CLAN, 'Sample Clan', size, (i) =>
    ourAttacks(i)
      .filter((a) => a.order <= ourHits)
      .slice(0, perMember)
  );
  const theirs = warClan('#RIVAL', 'Rival Clan', size, (i) =>
    [hit(100 + i, `#RIVAL-${i + 1}`, `${CLAN}-${i + 1}`, 2, 81)].filter(() => i < theirHits)
  );
  return {
    state,
    teamSize: size,
    attacksPerMember: perMember,
    preparationStartTime: cocTime(now - 30 * HOUR),
    startTime: cocTime(state === 'preparation' ? now + 6 * HOUR : now - 6 * HOUR),
    endTime: cocTime(state === 'preparation' ? now + 30 * HOUR : now + 18 * HOUR),
    clan: ours,
    opponent: theirs,
  };
}

async function previewWar() {
  const prep = await processWarDiff(war('preparation', 0, 0), null, botConfig);
  const battle = await processWarDiff(war('inWar', 0, 0), prep, botConfig);
  const twoHits = await processWarDiff(war('inWar', 1, 1), battle, botConfig);
  await processWarDiff(war('warEnded', 15, 10), twoHits, botConfig);
}

async function previewCwl() {
  const group: CwlGroupResponse = {
    state: 'inWar',
    season: '2026-11',
    clans: [
      { tag: CLAN, name: 'Sample Clan' },
      ...['North', 'South', 'East', 'West', 'Upper', 'Lower', 'Middle'].map((w, i) => ({
        tag: `#G${i}`,
        name: `${w} Clan`,
      })),
    ] as any,
    rounds: [{ warTags: ['#W1'] }, ...Array.from({ length: 6 }, () => ({ warTags: ['#0'] }))],
  };
  const cwlWar = (state: CurrentWarResponse['state'], hits: number) => war(state, hits, hits, 1);
  const coc = (w: CurrentWarResponse) => ({ getCwlWar: async () => w }) as unknown as CocService;

  const prep = await processCwlDiff(group, CLAN, null, botConfig, coc(cwlWar('preparation', 0)));
  const battle = await processCwlDiff(group, CLAN, prep, botConfig, coc(cwlWar('inWar', 0)));
  const hits = await processCwlDiff(group, CLAN, battle, botConfig, coc(cwlWar('inWar', 1)));
  await processCwlDiff(group, CLAN, hits, botConfig, coc(cwlWar('warEnded', 9)));

  const players: CwlPlayerSummary[] = NAMES.map((name, i) => ({
    tag: `#P${i}`,
    name,
    townhallLevel: 15 - Math.floor(i / 3),
    roundsRostered: 7,
    attacksUsed: i === 9 ? 5 : 7,
    missedAttacks: i === 9 ? 2 : 0,
    totalStars: 21 - i,
    totalDestruction: (98 - i * 2) * 7,
    avgDestruction: 98 - i * 2,
    perfectHits: Math.max(0, 7 - i),
    underdogHits:
      i >= 6
        ? [
            {
              round: i - 4,
              attackerTag: `#P${i}`,
              attackerName: name,
              attackerTh: 13,
              defenderTag: '#X',
              defenderName: 'Rival 2',
              defenderTh: 15,
              thDiff: 2,
              stars: 2,
              destruction: 77,
            },
          ]
        : [],
  }));
  const summary: CwlSeasonSummary = {
    season: '2026-11',
    clanTag: CLAN,
    clanName: 'Sample Clan',
    roundsPlayed: 7,
    wins: 5,
    losses: 2,
    ties: 0,
    totalClanStars: 196,
    winBonusStars: 50,
    avgClanDestruction: 88.4,
    playerSummaries: players,
    topPerformers: players.slice(0, 5),
    missedAttacksList: players.filter((p) => p.missedAttacks > 0),
    underdogHits: players.flatMap((p) => p.underdogHits),
  };
  await sendCwlSeasonSummaryDiscord(summary, 'test');
}

async function previewRaids() {
  const district = (id: number, name: string, pct: number, attackers: string[]) => ({
    id,
    name,
    districtHallLevel: 4,
    destructionPercent: pct,
    stars: pct === 100 ? 3 : 1,
    attackCount: attackers.length,
    totalLooted: attackers.length * 420,
    // The API lists the latest attack first
    attacks: attackers.map((a) => ({ attacker: { tag: '#X', name: a }, destructionPercent: pct, stars: 1 })).reverse(),
  });
  // A finished capital, or one with only its first district down when the weekend ended
  const capital = (name: string, finished: boolean) => ({
    defender: { tag: `#${name.toUpperCase()}`, name, level: 8, badgeUrls: {} },
    attackCount: finished ? 9 : 3,
    districtCount: 3,
    districtsDestroyed: finished ? 3 : 1,
    districts: [
      district(70000001, 'Barbarian Camp', 100, finished ? ['Emery', 'Finley'] : ['Avery', 'Blake']),
      district(70000002, 'Wizard Valley', finished ? 100 : 40, finished ? ['Harper', 'Jordan', 'Kendall'] : ['Casey']),
      district(70000000, 'Capital Peak', finished ? 100 : 0, finished ? ['Avery', 'Blake', 'Casey', 'Devon'] : []),
    ],
  });
  const weekend = (state: 'ongoing' | 'ended', attackLog: any[]): CapitalRaidWeekend => ({
    state,
    startTime: 'W2',
    endTime: cocTime(Date.now() + 40 * HOUR),
    capitalTotalLoot: 12600,
    raidsCompleted: 1,
    totalAttacks: 13,
    enemyDistrictsDestroyed: 4,
    offensiveReward: 0,
    defensiveReward: 0,
    attackLog,
  });
  const lastWeekend: any = { weekendId: 'W1', state: 'ended', completedCapitalTags: [], announcedWeekendEnd: true };

  const started = await processRaidDiff(weekend('ongoing', []), lastWeekend, botConfig, CLAN);
  const conquered = await processRaidDiff(weekend('ongoing', [capital('Northhold', true)]), started, botConfig, CLAN);
  await processRaidDiff(
    weekend('ended', [capital('Northhold', true), capital('Eastmarch', false)]),
    conquered,
    botConfig,
    CLAN
  );
}

async function previewReminders(send: (payload: DiscordWebhookPayload) => Promise<boolean>) {
  const reminder = (attacksPerMember: number, roundNum?: number) => {
    const w = war('inWar', 9, 6, attacksPerMember);
    return buildAttackReminder({
      ourClan: w.clan,
      enemyClan: w.opponent,
      teamSize: w.teamSize,
      attacksPerMember,
      hoursLeft: 2.4,
      endMs: Date.now() + 2.4 * HOUR,
      clanTag: CLAN,
      roundNum,
    })!;
  };
  await send(reminder(2));
  await send(reminder(1, 4)); // a CWL round
  await send(DiscordService.webhookTestMessage('War Room'));
}

async function previewDms(send: (payload: DiscordWebhookPayload) => Promise<boolean>) {
  const account: LinkedAccount = {
    playerTag: '#P0',
    name: 'Avery',
    townHallLevel: 13,
    builderHallLevel: 9,
    isPrimary: true,
    villageData: { version: 2 } as any,
  };
  const event = (over: Partial<UpgradeEvent> = {}): UpgradeEvent => ({
    kind: 'upgraded',
    code: 1000008,
    name: 'Cannon',
    assetName: 'Cannon',
    category: 'defense',
    village: 'home',
    oldLevel: 17,
    newLevel: 18,
    maxLevel: 21,
    count: 1,
    ...over,
  });
  await send(buildUpgradeDm(account, [event()]));
  await send(
    buildUpgradeDm(account, [
      event(),
      event({ kind: 'expected', name: 'Archer Tower', assetName: 'Archer Tower', newLevel: 19, maxLevel: 21 }),
      event({ code: 1000032, name: 'Cannon (BB)', village: 'builder', oldLevel: 6, newLevel: 7, maxLevel: 9 }),
    ])
  );
  await send(buildRosterDm(account, { mapPosition: 3, townhallLevel: 13 }, 'Rival Clan', 15, Date.now() + 20 * HOUR));
}

// The message's text and buttons, for --print
function describe(payload: DiscordWebhookPayload): string {
  const out: string[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 10) out.push(node.content);
    if (node.type === 2) out.push(`[${node.label}]`);
    if (node.type === 14) out.push('───');
    (node.components ?? []).forEach(walk);
    walk(node.accessory);
  };
  (payload.components ?? []).forEach(walk);
  return out.join('\n');
}

async function main() {
  const print = process.argv.includes('--print');
  const target = config.discord.testChannelWebhook;
  if (!print && !target) throw new Error('Set DISCORD_TEST_CHANNEL_WEBHOOK in functions/.env, or use --print');
  // The preview sends even when Discord sends are switched off for testing
  if (!print) delete process.env.DRY_RUN_DISCORD;

  const send = DiscordService.sendWebhook.bind(DiscordService);
  let sent = 0;
  const failed: string[] = [];
  let depth = 0; // a rate-limited send retries through here; count it once
  DiscordService.sendWebhook = async (_target, payload, retries) => {
    if (print) {
      process.stdout.write(`\n════ ${++sent} ════\n${describe(payload)}\n`);
      return true;
    }
    await new Promise((r) => setTimeout(r, 600));
    depth++;
    const ok = await send(target, payload, retries).finally(() => depth--);
    if (depth === 0 && ok) sent++;
    if (depth === 0 && !ok)
      failed.push(
        describe(payload)
          .split('\n')
          .find((l) => l.startsWith('###')) ?? '?'
      );
    return ok;
  };
  const post = (payload: DiscordWebhookPayload) => DiscordService.sendWebhook(target, payload);

  const sections: Array<[string, () => Promise<void>]> = [
    ['clan', previewClan],
    ['clan-games', previewClanGames],
    ['war', previewWar],
    ['cwl', previewCwl],
    ['raids', previewRaids],
    ['reminders', () => previewReminders(post)],
    ['dms', () => previewDms(post)],
  ];
  const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  for (const [name, run] of sections) {
    if (only.length === 0 || only.includes(name)) await run();
  }

  if (print) return;
  log.info(`[previewLayouts] Sent ${sent} messages to the test channel`);
  if (failed.length > 0) log.warn(`[previewLayouts] ${failed.length} failed: ${failed.join(', ')}`);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      log.error('[previewLayouts] Failed:', err.message);
      process.exit(1);
    });
}
