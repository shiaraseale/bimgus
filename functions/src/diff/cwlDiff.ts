import { CwlGroupResponse, WarClanMember } from '../types/coc';
import { CwlSnapshotDoc, BotConfigDoc, CwlSeasonSummary, CwlPlayerSummary, CwlUnderdogHit } from '../types/db';
import { DiscordService, COLORS } from '../services/discordService';
import { card, fitLines, layoutMessage, packMessages } from '../services/discordLayout';
import { CocService } from '../services/cocService';
import { findOurCwlWar } from './cwlWars';
import { buildAttackCard, FlatAttack, formatCoCTime, lineupBlock, positionList, scoreLine } from './warDiff';
import { log } from '../utils/log';
import { discordTime } from '../utils/discordTime';

/**
 * Builds the comprehensive Clan War Leagues season summary across all played rounds.
 */
export async function buildCwlSeasonSummary(
  cwlGroup: CwlGroupResponse,
  clanTag: string,
  cocService: CocService,
  knownWarTags?: Record<number, string>
): Promise<CwlSeasonSummary | null> {
  const normalizedClanTag = clanTag.trim().toUpperCase();
  const playerMap = new Map<string, CwlPlayerSummary>();
  const underdogHits: CwlUnderdogHit[] = [];

  let clanName = '';
  let roundsPlayed = 0;
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let totalRawClanStars = 0;
  let totalClanDestruction = 0;

  if (!cwlGroup.rounds || cwlGroup.rounds.length === 0) return null;

  for (let roundIndex = 0; roundIndex < cwlGroup.rounds.length; roundIndex++) {
    const round = cwlGroup.rounds[roundIndex];
    const validWarTags = (round.warTags || []).filter((tag) => tag && tag !== '#0');
    const roundNum = roundIndex + 1;

    const found = await findOurCwlWar(validWarTags, normalizedClanTag, cocService, knownWarTags?.[roundIndex]);
    for (const { warTag, war } of found ? [found] : []) {
      try {
        const isClanHome = war.clan.tag.toUpperCase() === normalizedClanTag;

        const ourClan = isClanHome ? war.clan : war.opponent;
        const enemyClan = isClanHome ? war.opponent : war.clan;
        clanName = ourClan.name;

        // Process rounds that are ended or had active attacks
        if (war.state === 'warEnded' || ourClan.attacks > 0) {
          roundsPlayed++;
          totalRawClanStars += ourClan.stars;
          totalClanDestruction += ourClan.destructionPercentage;

          if (war.state === 'warEnded') {
            if (
              ourClan.stars > enemyClan.stars ||
              (ourClan.stars === enemyClan.stars && ourClan.destructionPercentage > enemyClan.destructionPercentage)
            ) {
              wins++;
            } else if (
              ourClan.stars === enemyClan.stars &&
              ourClan.destructionPercentage === enemyClan.destructionPercentage
            ) {
              ties++;
            } else {
              losses++;
            }
          }

          const oppMembersMap = new Map<string, WarClanMember>(enemyClan.members.map((m) => [m.tag, m]));

          for (const m of ourClan.members) {
            let stats = playerMap.get(m.tag);
            if (!stats) {
              stats = {
                tag: m.tag,
                name: m.name,
                townhallLevel: m.townhallLevel,
                roundsRostered: 0,
                attacksUsed: 0,
                missedAttacks: 0,
                totalStars: 0,
                totalDestruction: 0,
                avgDestruction: 0,
                perfectHits: 0,
                underdogHits: [],
              };
              playerMap.set(m.tag, stats);
            }

            stats.roundsRostered++;
            stats.townhallLevel = Math.max(stats.townhallLevel, m.townhallLevel);

            if (m.attacks && m.attacks.length > 0) {
              stats.attacksUsed += m.attacks.length;
              for (const atk of m.attacks) {
                stats.totalStars += atk.stars;
                stats.totalDestruction += atk.destructionPercentage;
                if (atk.stars === 3) stats.perfectHits++;

                const defender = oppMembersMap.get(atk.defenderTag);
                if (defender && defender.townhallLevel > m.townhallLevel && atk.stars > 0) {
                  const hit: CwlUnderdogHit = {
                    round: roundNum,
                    attackerTag: m.tag,
                    attackerName: m.name,
                    attackerTh: m.townhallLevel,
                    defenderTag: defender.tag,
                    defenderName: defender.name,
                    defenderTh: defender.townhallLevel,
                    thDiff: defender.townhallLevel - m.townhallLevel,
                    stars: atk.stars,
                    destruction: atk.destructionPercentage,
                  };
                  stats.underdogHits.push(hit);
                  underdogHits.push(hit);
                }
              }
            } else if (war.state === 'warEnded') {
              stats.missedAttacks++;
            }
          }
        }

        break; // Found our war for this round
      } catch (err: any) {
        log.warn(`[CWL Season Summary] War tag error for ${warTag}: ${err.message}`);
      }
    }
  }

  if (roundsPlayed === 0) return null;

  const playerSummaries: CwlPlayerSummary[] = Array.from(playerMap.values()).map((p) => ({
    ...p,
    avgDestruction: p.attacksUsed > 0 ? Number((p.totalDestruction / p.attacksUsed).toFixed(1)) : 0,
  }));

  // Rank players: primary totalStars desc, secondary avgDestruction desc, tertiary attacksUsed desc
  playerSummaries.sort((a, b) => {
    if (b.totalStars !== a.totalStars) return b.totalStars - a.totalStars;
    if (b.avgDestruction !== a.avgDestruction) return b.avgDestruction - a.avgDestruction;
    return b.attacksUsed - a.attacksUsed;
  });

  const topPerformers = playerSummaries.filter((p) => p.attacksUsed > 0).slice(0, 5);

  const missedAttacksList = playerSummaries
    .filter((p) => p.missedAttacks > 0)
    .map((p) => ({
      tag: p.tag,
      name: p.name,
      townhallLevel: p.townhallLevel,
      missedAttacks: p.missedAttacks,
      roundsRostered: p.roundsRostered,
    }))
    .sort((a, b) => b.missedAttacks - a.missedAttacks);

  // Sort underdogs: primary stars desc, secondary thDiff desc, tertiary destruction desc
  underdogHits.sort((a, b) => {
    if (b.stars !== a.stars) return b.stars - a.stars;
    if (b.thDiff !== a.thDiff) return b.thDiff - a.thDiff;
    return b.destruction - a.destruction;
  });

  const winBonusStars = wins * 10;
  const totalClanStars = totalRawClanStars + winBonusStars;
  const avgClanDestruction = roundsPlayed > 0 ? Number((totalClanDestruction / roundsPlayed).toFixed(2)) : 0;

  return {
    season: cwlGroup.season,
    clanTag,
    clanName: clanName || 'Our Clan',
    roundsPlayed,
    wins,
    losses,
    ties,
    totalClanStars,
    winBonusStars,
    avgClanDestruction,
    playerSummaries,
    topPerformers,
    missedAttacksList,
    underdogHits,
  };
}

/**
 * The season's recap: the record, highlights, underdogs and missed attacks, then the stars leaderboard.
 */
export async function sendCwlSeasonSummaryDiscord(summary: CwlSeasonSummary, webhookUrl: string): Promise<void> {
  const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
  const highlightLines: string[] = [];

  const flawless = summary.playerSummaries.find(
    (p) => p.roundsRostered >= 5 && p.attacksUsed === p.roundsRostered && p.totalStars === p.roundsRostered * 3
  );
  if (flawless) {
    highlightLines.push(
      `👑 **Flawless**: ${flawless.name} (TH${flawless.townhallLevel}), ${flawless.totalStars}/${flawless.totalStars} ⭐`
    );
  }

  // The largest Town Hall gap anyone scored across
  const goliathHit = [...summary.underdogHits].sort((a, b) => b.thDiff - a.thDiff || b.destruction - a.destruction)[0];
  if (goliathHit && goliathHit.thDiff >= 2) {
    highlightLines.push(
      `🎯 **Biggest upset**: ${goliathHit.attackerName} (TH${goliathHit.attackerTh}) took ${goliathHit.stars} ⭐ ${goliathHit.destruction}% off ${goliathHit.defenderName} (TH${goliathHit.defenderTh}) in round ${goliathHit.round}`
    );
  }

  const anchor = summary.topPerformers.find(
    (p) => p.name !== flawless?.name && p.attacksUsed === p.roundsRostered && p.perfectHits >= 4
  );
  if (anchor) {
    highlightLines.push(
      `🛡️ **Anchor**: ${anchor.name} (TH${anchor.townhallLevel}), ${anchor.totalStars} ⭐ with ${anchor.perfectHits}× 3★`
    );
  }

  // Stars scored against higher Town Halls: most stars, then the largest gap, then the most 3-star hits
  const underdogs = summary.playerSummaries
    .filter((p) => p.underdogHits && p.underdogHits.length > 0)
    .map((p) => ({
      ...p,
      uStars: p.underdogHits.reduce((acc, h) => acc + h.stars, 0),
      u3Stars: p.underdogHits.filter((h) => h.stars === 3).length,
      maxDiff: Math.max(...p.underdogHits.map((h) => h.thDiff)),
      uDest: p.underdogHits.reduce((acc, h) => acc + h.destruction, 0),
    }))
    .sort((a, b) => b.uStars - a.uStars || b.maxDiff - a.maxDiff || b.u3Stars - a.u3Stars || b.uDest - a.uDest);
  const underdogLines = underdogs
    .slice(0, 5)
    .map(
      (p, idx) =>
        `${medals[idx]} ${p.name} (TH${p.townhallLevel}): ${p.uStars} ⭐ in ${p.underdogHits.length} hit${p.underdogHits.length === 1 ? '' : 's'}, up to +${p.maxDiff} TH`
    );

  const missed = summary.missedAttacksList.map((m) => `${m.name} (${m.missedAttacks} of ${m.roundsRostered})`);

  const overviewCard = card({
    accent: summary.wins >= summary.losses ? COLORS.GOLD : COLORS.PURPLE,
    title: `🏆 CWL ${summary.season}: ${summary.wins}W ${summary.losses}L${summary.ties > 0 ? ` ${summary.ties}T` : ''}`,
    body: `⭐ ${summary.totalClanStars} stars (${summary.winBonusStars} from wins) · 💥 ${summary.avgClanDestruction}% average`,
    blocks: [
      highlightLines.join('\n'),
      underdogLines.length > 0 ? ['🥊 **Underdogs** (stars on higher Town Halls)', ...underdogLines].join('\n') : '',
      missed.length > 0 ? `🚨 **Missed attacks**: ${missed.join(', ')}` : '✅ No missed attacks',
    ],
    footer: summary.clanName,
  });

  const leaderboardLines = summary.playerSummaries.map(
    (p, idx) =>
      `\`${String(idx + 1).padStart(2, ' ')}.\` **${p.name}** (TH${p.townhallLevel}) ${p.totalStars} ⭐ · ${p.attacksUsed}/${p.roundsRostered} · ${p.avgDestruction}%`
  );
  const leaderboardCard = card({
    accent: COLORS.BLUE,
    title: '⭐ Stars leaderboard',
    body: fitLines(leaderboardLines, 3000).join('\n'),
    footer: `${summary.playerSummaries.length} members took part · stars · attacks · average`,
  });

  // Both cards together when they fit, otherwise one message each
  for (const message of packMessages([overviewCard, leaderboardCard], [DiscordService.warActionRow(summary.clanTag)])) {
    await DiscordService.sendWebhook(webhookUrl, message);
  }
}

export async function processCwlDiff(
  cwlGroup: CwlGroupResponse,
  clanTag: string,
  prevSnapshot: CwlSnapshotDoc | null,
  config: BotConfigDoc,
  cocService: CocService
): Promise<CwlSnapshotDoc | null> {
  if (cwlGroup.state === 'notInWar') {
    return null;
  }

  const webhookUrl = config.webhooks.cwlHub || config.webhooks.warRoom;
  const isNewSeason = !prevSnapshot || prevSnapshot.season !== cwlGroup.season;
  const announcedGroup = !isNewSeason && (prevSnapshot?.announcedGroup ?? false);
  const loggedRounds = new Set<number>(isNewSeason ? [] : prevSnapshot?.loggedRoundIndices || []);
  const announcedMatchups = new Set<number>(isNewSeason ? [] : prevSnapshot?.announcedMatchupRounds || []);
  const announcedBattleDays = new Set<number>(isNewSeason ? [] : prevSnapshot?.announcedBattleDayRounds || []);
  const loggedAttackOrders: Record<string, number[]> = isNewSeason ? {} : { ...prevSnapshot?.loggedAttackOrders };
  const ourWarTags: Record<number, string> = isNewSeason ? {} : { ...prevSnapshot?.ourWarTags };

  let currentRoundIndex: number | undefined;
  let currentWarTag: string | undefined;

  // 1. Announce CWL Group Draw
  if (!announcedGroup && webhookUrl && config.notificationsEnabled.cwlGroup) {
    const others = cwlGroup.clans.filter((c) => c.tag.toUpperCase() !== clanTag.toUpperCase()).map((c) => c.name);

    const groupCard = card({
      title: `🛡️ CWL ${cwlGroup.season} has started`,
      body: `7 rounds, 1 attack each. Our group: ${others.join(', ')}`,
      accent: COLORS.GOLD,
      buttons: DiscordService.warActionRow(clanTag).components,
    });

    await DiscordService.sendWebhook(webhookUrl, layoutMessage(groupCard));
  }

  // 2. Scan and Process CWL Rounds
  if (cwlGroup.rounds && cwlGroup.rounds.length > 0) {
    for (let roundIndex = 0; roundIndex < cwlGroup.rounds.length; roundIndex++) {
      const round = cwlGroup.rounds[roundIndex];
      const validWarTags = (round.warTags || []).filter((tag) => tag && tag !== '#0');
      if (validWarTags.length === 0) continue;

      const roundNum = roundIndex + 1;

      // A round whose summary has been posted has nothing left to report, so it isn't fetched again
      if (loggedRounds.has(roundIndex)) continue;

      // Find our clan's war in this round (one request once its tag is known)
      const found = await findOurCwlWar(validWarTags, clanTag, cocService, ourWarTags[roundIndex]);
      if (found) ourWarTags[roundIndex] = found.warTag;
      for (const { warTag, war } of found ? [found] : []) {
        try {
          currentRoundIndex = roundIndex;
          currentWarTag = warTag;

          const isClanHome = war.clan.tag.toUpperCase() === clanTag.toUpperCase();
          const ourClan = isClanHome ? war.clan : war.opponent;
          const enemyClan = isClanHome ? war.opponent : war.clan;

          // A. Announce Round Matchup (Preparation or Battle Day)
          if (
            webhookUrl &&
            !announcedMatchups.has(roundIndex) &&
            (war.state === 'preparation' || war.state === 'inWar')
          ) {
            const startMs = war.startTime ? new Date(formatCoCTime(war.startTime)).getTime() : null;
            const endMs = war.endTime ? new Date(formatCoCTime(war.endTime)).getTime() : null;

            const matchupCard = card({
              title: `⚔️ CWL round ${roundNum}: vs ${enemyClan.name}`,
              body: [
                `${war.teamSize}v${war.teamSize} · clan level ${enemyClan.clanLevel}`,
                war.state === 'preparation' && startMs ? `Battle day ${discordTime(startMs)}` : '',
                endMs ? `Ends ${discordTime(endMs)}` : '',
              ]
                .filter(Boolean)
                .join('\n'),
              accent: COLORS.PURPLE,
              thumbnail: enemyClan.badgeUrls?.large,
              blocks: [lineupBlock(ourClan, enemyClan)],
              buttons: DiscordService.warActionRow(clanTag, enemyClan.tag).components,
            });

            await DiscordService.sendWebhook(webhookUrl, layoutMessage(matchupCard));
            announcedMatchups.add(roundIndex);
          }

          // B. Announce Battle Day Start
          if (webhookUrl && war.state === 'inWar' && !announcedBattleDays.has(roundIndex)) {
            const endMs = war.endTime ? new Date(formatCoCTime(war.endTime)).getTime() : null;

            const battleCard = card({
              title: `🔥 CWL round ${roundNum} battle day: vs ${enemyClan.name}`,
              body: `1 attack each · ends ${endMs ? discordTime(endMs) : 'in 24 hours'}`,
              accent: COLORS.GOLD,
              thumbnail: ourClan.badgeUrls?.large,
              buttons: DiscordService.warActionRow(clanTag, enemyClan.tag).components,
            });

            await DiscordService.sendWebhook(webhookUrl, layoutMessage(battleCard));
            announcedBattleDays.add(roundIndex);
          }

          // C. Live Attack Diffing
          const warLoggedOrders = new Set<number>(loggedAttackOrders[warTag] || []);
          const isNewWarTracking = !loggedAttackOrders[warTag];

          const ourMembersMap = new Map<string, WarClanMember>(ourClan.members.map((m) => [m.tag, m]));
          const oppMembersMap = new Map<string, WarClanMember>(enemyClan.members.map((m) => [m.tag, m]));

          const allAttacks: FlatAttack[] = [];

          for (const m of ourClan.members) {
            if (m.attacks) {
              for (const atk of m.attacks) {
                const defender =
                  oppMembersMap.get(atk.defenderTag) ||
                  ({ name: 'Unknown', mapPosition: 0, tag: atk.defenderTag, townhallLevel: 0 } as WarClanMember);
                allAttacks.push({
                  ...atk,
                  isClanAttack: true,
                  attacker: m,
                  defender,
                });
              }
            }
          }

          for (const m of enemyClan.members) {
            if (m.attacks) {
              for (const atk of m.attacks) {
                const defender =
                  ourMembersMap.get(atk.defenderTag) ||
                  ({ name: 'Unknown', mapPosition: 0, tag: atk.defenderTag, townhallLevel: 0 } as WarClanMember);
                allAttacks.push({
                  ...atk,
                  isClanAttack: false,
                  attacker: m,
                  defender,
                });
              }
            }
          }

          allAttacks.sort((a, b) => a.order - b.order);

          if (webhookUrl && config.notificationsEnabled.warAttacks && war.state === 'inWar') {
            if (isNewWarTracking) {
              // Establish baseline without spamming past attacks
              for (const a of allAttacks) {
                warLoggedOrders.add(a.order);
              }
            } else {
              const newAttacks = allAttacks.filter((a) => !warLoggedOrders.has(a.order));
              for (const attack of newAttacks) {
                const attackCard = buildAttackCard(
                  attack,
                  ourClan,
                  enemyClan,
                  DiscordService.warActionRow(clanTag, enemyClan.tag).components,
                  `CWL round ${roundNum} · ${ourClan.attacks}/${war.teamSize} attacks`
                );
                await DiscordService.sendWebhook(webhookUrl, layoutMessage(attackCard));
                warLoggedOrders.add(attack.order);
                await new Promise((r) => setTimeout(r, 350));
              }
            }
          } else {
            for (const a of allAttacks) {
              warLoggedOrders.add(a.order);
            }
          }
          loggedAttackOrders[warTag] = Array.from(warLoggedOrders);

          // A finished round with summaries off has nothing left to report either
          if (war.state === 'warEnded' && (!webhookUrl || !config.notificationsEnabled.cwlRoundSummary)) {
            loggedRounds.add(roundIndex);
          }

          // D. Round Completed Summary & Audit
          if (
            webhookUrl &&
            config.notificationsEnabled.cwlRoundSummary &&
            war.state === 'warEnded' &&
            !loggedRounds.has(roundIndex)
          ) {
            const won =
              ourClan.stars > enemyClan.stars ||
              (ourClan.stars === enemyClan.stars && ourClan.destructionPercentage > enemyClan.destructionPercentage);
            const tied =
              ourClan.stars === enemyClan.stars && ourClan.destructionPercentage === enemyClan.destructionPercentage;

            const outcome = won ? '🏆' : tied ? '🤝' : '💀';
            const result = won ? 'won' : tied ? 'tied' : 'lost';

            // The result and the round's audit in one card
            const missedAttacks = ourClan.members.filter((m) => !m.attacks || m.attacks.length === 0);
            const threeStars = ourClan.members.filter((m) => m.attacks && m.attacks.some((a) => a.stars === 3));
            const auditLines = [
              missedAttacks.length > 0 ? `🚨 **No attack**: ${positionList(missedAttacks)}` : '✅ Everyone attacked',
              threeStars.length > 0 ? `⭐ **3 stars**: ${positionList(threeStars)}` : '',
            ].filter(Boolean);

            const roundCard = card({
              title: `${outcome} CWL round ${roundNum}: ${result} vs ${enemyClan.name}`,
              body: [
                scoreLine(ourClan, enemyClan),
                `🗡️ Attacks used: ${ourClan.attacks}/${war.teamSize} vs ${enemyClan.attacks}/${war.teamSize}`,
              ].join('\n'),
              blocks: [fitLines(auditLines, 3500).join('\n')],
              accent: won ? COLORS.GOLD : tied ? COLORS.BLUE : COLORS.RED,
              buttons: DiscordService.warActionRow(clanTag, enemyClan.tag).components,
            });

            await DiscordService.sendWebhook(webhookUrl, layoutMessage(roundCard));
            loggedRounds.add(roundIndex);
          }

          // Found our war for this round, stop checking other warTags in this round
          break;
        } catch (err: any) {
          log.warn(`[CWL] Could not process warTag ${warTag}: ${err.message}`);
        }
      }
    }
  }

  // 3. Overall Season End Summary Check
  const isSeasonEnded =
    cwlGroup.state === 'ended' ||
    (cwlGroup.rounds && cwlGroup.rounds.length > 0 && loggedRounds.size === cwlGroup.rounds.length);

  let announcedSeasonSummary = prevSnapshot?.announcedSeasonSummary ?? false;
  let seasonSummary = prevSnapshot?.seasonSummary;

  if (isSeasonEnded && !announcedSeasonSummary && webhookUrl && config.notificationsEnabled.cwlRoundSummary) {
    try {
      const summary = await buildCwlSeasonSummary(cwlGroup, clanTag, cocService, ourWarTags);
      if (summary) {
        await sendCwlSeasonSummaryDiscord(summary, webhookUrl);
        seasonSummary = summary;
        announcedSeasonSummary = true;
      }
    } catch (err: any) {
      log.warn(`[CWL] Failed to generate/send overall season summary: ${err.message}`);
    }
  }

  return {
    season: cwlGroup.season,
    state: cwlGroup.state,
    clans: cwlGroup.clans.map((c) => ({ tag: c.tag, name: c.name, clanLevel: c.clanLevel })),
    announcedGroup: true,
    announcedMatchupRounds: Array.from(announcedMatchups),
    announcedBattleDayRounds: Array.from(announcedBattleDays),
    loggedAttackOrders,
    loggedRoundIndices: Array.from(loggedRounds),
    ourWarTags,
    currentRoundIndex,
    currentWarTag,
    announcedSeasonSummary,
    seasonSummary,
    updatedAt: new Date().toISOString(),
  };
}
