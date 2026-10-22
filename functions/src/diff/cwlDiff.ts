import { CwlGroupResponse, WarClanMember, WarAttack } from '../types/coc';
import { CwlSnapshotDoc, BotConfigDoc, CwlSeasonSummary, CwlPlayerSummary, CwlUnderdogHit } from '../types/db';
import { DiscordService, COLORS } from '../services/discordService';
import { DiscordEmbed } from '../types/discord';
import { CocService } from '../services/cocService';

interface FlatAttack extends WarAttack {
  isClanAttack: boolean;
  attacker: WarClanMember;
  defender: WarClanMember;
}

function formatCoCTime(cocTime: string): string {
  if (cocTime.includes('-')) return cocTime;
  return cocTime.replace(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})\.(\d{3})Z$/,
    '$1-$2-$3T$4:$5:$6.$7Z'
  );
}

/**
 * Builds the comprehensive Clan War Leagues season summary across all played rounds.
 */
export async function buildCwlSeasonSummary(
  cwlGroup: CwlGroupResponse,
  clanTag: string,
  cocService: CocService
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

    for (const warTag of validWarTags) {
      try {
        const war = await cocService.getCwlWar(warTag);
        const isClanHome = war.clan.tag.toUpperCase() === normalizedClanTag;
        const isOpponent = war.opponent.tag.toUpperCase() === normalizedClanTag;
        if (!isClanHome && !isOpponent) continue;

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
        console.warn(`[CWL Season Summary] War tag error for ${warTag}: ${err.message}`);
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
 * Dispatches the formatted 2-part Discord embed for the CWL Season Summary.
 */
export async function sendCwlSeasonSummaryDiscord(
  summary: CwlSeasonSummary,
  webhookUrl: string
): Promise<void> {
  const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

  // 1. Season Highlights & Superlatives
  const highlightLines: string[] = [];

  // Check for flawless player(s)
  const flawless = summary.playerSummaries.find(
    (p) => p.roundsRostered >= 5 && p.attacksUsed === p.roundsRostered && p.totalStars === p.roundsRostered * 3
  );
  if (flawless) {
    highlightLines.push(
      `• 👑 **Flawless MVP**: **${flawless.name}** (TH${flawless.townhallLevel}) finished with a perfect **${flawless.totalStars}/${flawless.totalStars} ⭐** (${flawless.attacksUsed} attacks, ${flawless.perfectHits}x 3★, 100.0% avg)!`
    );
  }

  // Underdog MVP (Player with most total underdog stars, then max deficit, then 3-star hits)
  const underdogMVP = summary.playerSummaries
    .filter((p) => p.underdogHits && p.underdogHits.length > 0)
    .sort((a, b) => {
      const aStars = a.underdogHits.reduce((acc, h) => acc + h.stars, 0);
      const bStars = b.underdogHits.reduce((acc, h) => acc + h.stars, 0);
      if (bStars !== aStars) return bStars - aStars;
      const aMaxDiff = Math.max(...a.underdogHits.map((h) => h.thDiff));
      const bMaxDiff = Math.max(...b.underdogHits.map((h) => h.thDiff));
      if (bMaxDiff !== aMaxDiff) return bMaxDiff - aMaxDiff;
      const a3 = a.underdogHits.filter((h) => h.stars === 3).length;
      const b3 = b.underdogHits.filter((h) => h.stars === 3).length;
      return b3 - a3;
    })[0];

  if (underdogMVP) {
    const u3Count = underdogMVP.underdogHits.filter((h) => h.stars === 3).length;
    const uTotal = underdogMVP.underdogHits.reduce((acc, h) => acc + h.stars, 0);
    const bestHit = underdogMVP.underdogHits.find((h) => h.stars === 3 && h.thDiff >= 2) || underdogMVP.underdogHits[0];
    highlightLines.push(
      `• 🥊 **Underdog MVP**: **${underdogMVP.name}** (TH${underdogMVP.townhallLevel}) secured **${uTotal} ⭐** across ${underdogMVP.underdogHits.length} underdog matches (${u3Count}x 3★, including 3★ vs **${bestHit.defenderName}** (TH${bestHit.defenderTh}) [+${bestHit.thDiff} TH] in R${bestHit.round})!`
    );
  }

  // Goliath Takedown (Largest Town Hall gap hit)
  const goliathHit = [...summary.underdogHits].sort((a, b) => b.thDiff - a.thDiff || b.destruction - a.destruction)[0];
  if (goliathHit && goliathHit.thDiff >= 2) {
    highlightLines.push(
      `• 🎯 **Goliath Takedown**: **${goliathHit.attackerName}** (TH${goliathHit.attackerTh}) scored against **${goliathHit.defenderName}** (TH${goliathHit.defenderTh}) across a **+${goliathHit.thDiff} Town Hall deficit** in Round ${goliathHit.round} (${goliathHit.stars} ⭐, ${goliathHit.destruction}%)!`
    );
  }

  // Anchor performer
  const anchor = summary.topPerformers.find(
    (p) => p.name !== flawless?.name && p.attacksUsed === p.roundsRostered && p.perfectHits >= 4
  );
  if (anchor) {
    highlightLines.push(
      `• 🛡️ **Clan Anchor**: **${anchor.name}** (TH${anchor.townhallLevel}) delivered **${anchor.totalStars} ⭐** with ${anchor.perfectHits}x 3★ and ${anchor.avgDestruction}% avg destruction.`
    );
  }

  // 2. Top Performers Podium
  const podiumLines = summary.topPerformers.map((p, idx) => {
    const medal = medals[idx] || '⭐';
    return `${medal} **#${idx + 1} ${p.name}** (TH${p.townhallLevel})\n   • **${p.totalStars} ⭐** (${p.attacksUsed}/${p.roundsRostered} hits • ${p.avgDestruction}% avg${p.perfectHits > 0 ? ` • ${p.perfectHits}x 3★` : ''})`;
  });

  // 3. Underdog Heroes Ranking with Sub-Points per Match
  const underdogPlayers = summary.playerSummaries
    .filter((p) => p.underdogHits && p.underdogHits.length > 0)
    .map((p) => {
      const uStars = p.underdogHits.reduce((acc, h) => acc + h.stars, 0);
      const u3Stars = p.underdogHits.filter((h) => h.stars === 3).length;
      const maxDiff = Math.max(...p.underdogHits.map((h) => h.thDiff));
      const uDest = p.underdogHits.reduce((acc, h) => acc + h.destruction, 0);
      return {
        ...p,
        uStars,
        u3Stars,
        maxDiff,
        uDest,
      };
    });

  // Sort underdogs: primary total underdog stars desc, secondary max TH deficit desc, tertiary 3-star count desc
  underdogPlayers.sort(
    (a, b) => b.uStars - a.uStars || b.maxDiff - a.maxDiff || b.u3Stars - a.u3Stars || b.uDest - a.uDest
  );

  const underdogSections: string[] = [];
  if (underdogPlayers.length > 0) {
    const top5Underdogs = underdogPlayers.slice(0, 5);
    const goliathAttackerName = goliathHit?.attackerName;
    const goliathPlayer = underdogPlayers.find(
      (p) => p.name === goliathAttackerName || p.underdogHits.some((h) => h.attackerName === goliathAttackerName)
    );
    const isGoliathInTop5 = goliathPlayer && top5Underdogs.some((p) => p.name === goliathPlayer.name);

    top5Underdogs.forEach((p, idx) => {
      const medal = medals[idx] || '⭐';
      const isGoliathAttacker = goliathHit && (p.name === goliathHit.attackerName || p.tag === goliathHit.attackerTag);
      const playerHeader = `${medal} **#${idx + 1} ${p.name}** (TH${p.townhallLevel}) — **${p.uStars} ⭐** across ${p.underdogHits.length} underdog hits *(Max +${p.maxDiff} TH)*${isGoliathAttacker ? ' 🎯' : ''}`;

      // Sort matches: 3★ first, then largest TH diff, then round
      const sortedHits = [...p.underdogHits].sort(
        (a, b) => b.stars - a.stars || b.thDiff - a.thDiff || a.round - b.round
      );

      const hitSublines = sortedHits.map((h) => {
        const starIcons = '⭐'.repeat(h.stars);
        const isThisGoliathHit = goliathHit && h.round === goliathHit.round && h.defenderName === goliathHit.defenderName && h.thDiff === goliathHit.thDiff;
        const badge = isThisGoliathHit ? ' 🎯 Goliath Hit!' : (h.stars === 3 && h.thDiff >= 2 ? ' 👑' : '');
        return `   └ ⚔️ **R${h.round}**: ${starIcons} (${h.destruction}%) vs **${h.defenderName}** (TH${h.defenderTh}) \`[+${h.thDiff} TH]\`${badge}`;
      });

      underdogSections.push([playerHeader, ...hitSublines].join('\n'));
    });

    // If whoever had the Goliath hit is outside the top 5, include them as a dedicated shoutout
    if (goliathPlayer && !isGoliathInTop5) {
      const goliathRank = underdogPlayers.findIndex((p) => p.name === goliathPlayer.name) + 1;
      const goliathHeader = `🎯 **Goliath Shoutout: #${goliathRank} ${goliathPlayer.name}** (TH${goliathPlayer.townhallLevel}) — **${goliathPlayer.uStars} ⭐** across ${goliathPlayer.underdogHits.length} underdog hits *(Max +${goliathPlayer.maxDiff} TH)*`;

      const sortedHits = [...goliathPlayer.underdogHits].sort(
        (a, b) => b.stars - a.stars || b.thDiff - a.thDiff || a.round - b.round
      );

      const hitSublines = sortedHits.map((h) => {
        const starIcons = '⭐'.repeat(h.stars);
        const isThisGoliathHit = goliathHit && h.round === goliathHit.round && h.defenderName === goliathHit.defenderName && h.thDiff === goliathHit.thDiff;
        const badge = isThisGoliathHit ? ' 🎯 Goliath Hit!' : (h.stars === 3 && h.thDiff >= 2 ? ' 👑' : '');
        return `   └ ⚔️ **R${h.round}**: ${starIcons} (${h.destruction}%) vs **${h.defenderName}** (TH${h.defenderTh}) \`[+${h.thDiff} TH]\`${badge}`;
      });

      underdogSections.push([goliathHeader, ...hitSublines].join('\n'));
    }
  } else {
    underdogSections.push('• *No attacks scored against higher Town Halls this season.*');
  }

  // 4. Missed Attacks Callout
  const missedLines: string[] = [];
  if (summary.missedAttacksList.length > 0) {
    summary.missedAttacksList.forEach((m) => {
      missedLines.push(`• **${m.name}** (TH${m.townhallLevel}) — missed **${m.missedAttacks}/${m.roundsRostered}** attacks`);
    });
  } else {
    missedLines.push('✅ **Flawless 100% Attendance!** Zero missed attacks across all 7 rounds!');
  }

  // EMBED 1: Overview, Highlights, Top MVPs, Missed Attacks
  const overviewEmbed: DiscordEmbed = {
    title: `🏆 CWL Season ${summary.season} Final Summary`,
    description: [
      `Overall Clan War Leagues performance recap for **${summary.clanName}**!`,
      '',
      `⚔️ **Record**: **${summary.wins}W - ${summary.losses}L${summary.ties > 0 ? ` - ${summary.ties}T` : ''}** (${summary.roundsPlayed} Rounds)`,
      `⭐ **Total Stars**: **${summary.totalClanStars}** (${summary.winBonusStars} win bonus stars)`,
      `💥 **Avg Destruction**: **${summary.avgClanDestruction}%**`,
      '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '🌟 **SEASON HIGHLIGHTS & SUPERLATIVES**',
      highlightLines.join('\n'),
      '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '🎖️ **TOP PERFORMERS / MVPS**',
      podiumLines.length > 0 ? podiumLines.join('\n') : '• *No attacks recorded.*',
      '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '🚨 **MISSED ATTACKS AUDIT**',
      missedLines.join('\n'),
    ].join('\n'),
    color: summary.wins >= summary.losses ? COLORS.GOLD : COLORS.PURPLE,
    footer: { text: `CWL Final Season Recap • Bimgus Tracker` },
    timestamp: new Date().toISOString(),
  };

  // EMBED 2: Underdog Heroes Ranking with Subpoints
  const underdogEmbed: DiscordEmbed = {
    title: `🛡️ CWL Underdog Heroes Ranking (Top 5 & Highlights)`,
    description: [
      `Ranked list of clan members who conquered bases with **higher Town Hall levels**:`,
      '',
      underdogSections.join('\n\n'),
    ].join('\n'),
    color: COLORS.PURPLE,
    footer: { text: `Top 5 Underdogs & Goliath Shoutout • Bimgus Tracker` },
    timestamp: new Date().toISOString(),
  };

  // EMBED 3: Full Clan Stars Leaderboard (All rostered participants)
  const rosterLines = summary.playerSummaries.map((p, idx) => {
    const starStr = `${p.totalStars} ⭐`.padEnd(6, ' ');
    const hitStr = `${p.attacksUsed}/${p.roundsRostered} hits`;
    return `\`${String(idx + 1).padStart(2, ' ')}.\` **${p.name}** (TH${p.townhallLevel}) — **${starStr}** (${hitStr} • ${p.avgDestruction}%${p.perfectHits > 0 ? ` • ${p.perfectHits}x 3★` : ''})`;
  });

  const rosterEmbed: DiscordEmbed = {
    title: `⭐ CWL Full Clan Stars Leaderboard`,
    description: [
      `Full player ranking by total stars scored in CWL Season **${summary.season}**:`,
      '',
      rosterLines.join('\n'),
    ].join('\n'),
    color: COLORS.BLUE,
    footer: { text: `${summary.playerSummaries.length} clan members participated • Bimgus Tracker` },
    timestamp: new Date().toISOString(),
  };

  await DiscordService.sendWebhook(webhookUrl, {
    embeds: [overviewEmbed, underdogEmbed, rosterEmbed],
    components: [DiscordService.warActionRow(summary.clanTag)],
  });
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
  const loggedRounds = new Set<number>(isNewSeason ? [] : (prevSnapshot?.loggedRoundIndices || []));
  const announcedMatchups = new Set<number>(isNewSeason ? [] : (prevSnapshot?.announcedMatchupRounds || []));
  const announcedBattleDays = new Set<number>(isNewSeason ? [] : (prevSnapshot?.announcedBattleDayRounds || []));
  const loggedAttackOrders: Record<string, number[]> = isNewSeason ? {} : { ...(prevSnapshot?.loggedAttackOrders || {}) };

  let currentRoundIndex: number | undefined;
  let currentWarTag: string | undefined;

  // 1. Announce CWL Group Draw
  if (!announcedGroup && webhookUrl && config.notificationsEnabled.cwlGroup) {
    const clanLines = cwlGroup.clans.map((c, i) => `**${i + 1}. ${c.name}** (Level ${c.clanLevel})`);

    const groupEmbed: DiscordEmbed = {
      title: `🛡️ Clan War Leagues Started! (${cwlGroup.season})`,
      description: [
        'The CWL group stage has officially begun! Here are the 8 clans in our tier:',
        '',
        clanLines.join('\n'),
        '',
        `⚔️ **Total Rounds**: 7 Rounds`,
        `👥 **Roster Format**: 15v15 / 30v30 (1 attack per member)`,
      ].join('\n'),
      color: COLORS.GOLD,
      footer: { text: 'Bimgus • Clash of Clans Tracker' },
      timestamp: new Date().toISOString(),
    };

    await DiscordService.sendWebhook(webhookUrl, {
      embeds: [groupEmbed],
      components: [DiscordService.warActionRow(clanTag)],
    });
  }

  // 2. Scan and Process CWL Rounds
  if (cwlGroup.rounds && cwlGroup.rounds.length > 0) {
    for (let roundIndex = 0; roundIndex < cwlGroup.rounds.length; roundIndex++) {
      const round = cwlGroup.rounds[roundIndex];
      const validWarTags = (round.warTags || []).filter((tag) => tag && tag !== '#0');
      if (validWarTags.length === 0) continue;

      const roundNum = roundIndex + 1;

      // Find our clan's war in this round
      for (const warTag of validWarTags) {
        try {
          const war = await cocService.getCwlWar(warTag);
          const isOurWar = war.clan.tag.toUpperCase() === clanTag.toUpperCase() ||
                           war.opponent.tag.toUpperCase() === clanTag.toUpperCase();

          if (!isOurWar) continue;

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
            const startTimestamp = war.startTime
              ? Math.floor(new Date(formatCoCTime(war.startTime)).getTime() / 1000)
              : null;
            const endTimestamp = war.endTime
              ? Math.floor(new Date(formatCoCTime(war.endTime)).getTime() / 1000)
              : null;

            const matchupEmbed: DiscordEmbed = {
              title: `⚔️ CWL Round ${roundNum} Found!`,
              description: [
                `**${ourClan.name}** vs **${enemyClan.name}**`,
                `👥 **Format**: ${war.teamSize}v${war.teamSize} (1 Attack Each)`,
                '',
                `🛡️ **Opponent Level**: Level ${enemyClan.clanLevel}`,
                `⏳ **State**: ${war.state === 'preparation' ? 'Preparation Day' : 'Battle Day Active'}`,
                `🎯 **Battle Starts**: ${startTimestamp ? `<t:${startTimestamp}:R>` : 'Unknown'}`,
                `⏰ **Round Ends**: ${endTimestamp ? `<t:${endTimestamp}:R>` : 'Unknown'}`,
              ].join('\n'),
              color: COLORS.PURPLE,
              thumbnail: enemyClan.badgeUrls?.large ? { url: enemyClan.badgeUrls.large } : undefined,
              footer: { text: 'Bimgus • Clash of Clans Tracker' },
              timestamp: new Date().toISOString(),
            };

            await DiscordService.sendWebhook(webhookUrl, {
              embeds: [matchupEmbed],
              components: [DiscordService.warActionRow(clanTag, enemyClan.tag)],
            });
            announcedMatchups.add(roundIndex);
          }

          // B. Announce Battle Day Start
          if (
            webhookUrl &&
            war.state === 'inWar' &&
            !announcedBattleDays.has(roundIndex)
          ) {
            const endTimestamp = war.endTime
              ? Math.floor(new Date(formatCoCTime(war.endTime)).getTime() / 1000)
              : null;

            const battleEmbed: DiscordEmbed = {
              title: `🔥 CWL Round ${roundNum} Battle Day Has Begun!`,
              description: [
                `Round ${roundNum} against **${enemyClan.name}** is now LIVE!`,
                '',
                `⚔️ **Attacks**: Exactly 1 per member (${war.teamSize} attacks total)`,
                `⏰ **Round Ends**: ${endTimestamp ? `<t:${endTimestamp}:R>` : 'in 24 hours'}`,
                '',
                '🎯 Coordinate your hits carefully and secure those 3-star victories!',
              ].join('\n'),
              color: COLORS.GOLD,
              thumbnail: ourClan.badgeUrls?.large ? { url: ourClan.badgeUrls.large } : undefined,
              footer: { text: 'Bimgus • Clash of Clans Tracker' },
              timestamp: new Date().toISOString(),
            };

            await DiscordService.sendWebhook(webhookUrl, {
              embeds: [battleEmbed],
              components: [DiscordService.warActionRow(clanTag, enemyClan.tag)],
            });
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
                const defender = oppMembersMap.get(atk.defenderTag) ||
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
                const defender = ourMembersMap.get(atk.defenderTag) ||
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
                const starsStr = DiscordService.formatStars(attack.stars);
                const isThreeStar = attack.stars === 3;
                const isClan = attack.isClanAttack;

                const attackEmbed: DiscordEmbed = {
                  title: isClan ? `💥 CWL Attack: ${attack.attacker.name}` : `🛡️ Enemy Attack on: ${attack.defender.name}`,
                  description: [
                    `**#${attack.attacker.mapPosition} ${attack.attacker.name}** (TH${attack.attacker.townhallLevel}) attacked **#${attack.defender.mapPosition} ${attack.defender.name}** (TH${attack.defender.townhallLevel})`,
                    '',
                    `⭐ **Result**: ${starsStr} (${attack.destructionPercentage}%)`,
                    `🏰 **Live Score**: ${ourClan.stars} ⭐ vs ${enemyClan.stars} ⭐`,
                    `💥 **Destruction**: ${ourClan.destructionPercentage.toFixed(1)}% vs ${enemyClan.destructionPercentage.toFixed(1)}%`,
                    `🗡️ **Attacks Used**: ${ourClan.attacks}/${war.teamSize}`,
                  ].join('\n'),
                  color: isClan ? (isThreeStar ? COLORS.GOLD : COLORS.GREEN) : (isThreeStar ? COLORS.RED : COLORS.BLUE),
                  footer: { text: `CWL Round ${roundNum} • Bimgus Tracker` },
                  timestamp: new Date().toISOString(),
                };

                await DiscordService.sendWebhook(webhookUrl, {
                  embeds: [attackEmbed],
                  components: [DiscordService.warActionRow(clanTag, enemyClan.tag)],
                });
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

          // D. Round Completed Summary & Audit
          if (
            webhookUrl &&
            config.notificationsEnabled.cwlRoundSummary &&
            war.state === 'warEnded' &&
            !loggedRounds.has(roundIndex)
          ) {
            const won = ourClan.stars > enemyClan.stars ||
              (ourClan.stars === enemyClan.stars && ourClan.destructionPercentage > enemyClan.destructionPercentage);
            const tied = ourClan.stars === enemyClan.stars && ourClan.destructionPercentage === enemyClan.destructionPercentage;

            const outcomeTitle = won
              ? `🏆 CWL Round ${roundNum}: VICTORY!`
              : (tied ? `🤝 CWL Round ${roundNum}: TIED!` : `💀 CWL Round ${roundNum}: DEFEAT`);
            const outcomeColor = won ? COLORS.GOLD : (tied ? COLORS.BLUE : COLORS.RED);

            const roundEmbed: DiscordEmbed = {
              title: outcomeTitle,
              description: [
                `Round ${roundNum} against **${enemyClan.name}** has finished!`,
                '',
                `🏰 **${ourClan.name}**:`,
                `⭐ **Stars Earned**: ${ourClan.stars} ${won ? '(+10 Bonus Stars for Win!)' : ''}`,
                `💥 **Destruction**: ${ourClan.destructionPercentage.toFixed(2)}%`,
                `🗡️ **Attacks**: ${ourClan.attacks}/${war.teamSize}`,
                '',
                `⚔️ **${enemyClan.name}**:`,
                `⭐ **Stars Earned**: ${enemyClan.stars} ${!won && !tied ? '(+10 Bonus Stars for Win!)' : ''}`,
                `💥 **Destruction**: ${enemyClan.destructionPercentage.toFixed(2)}%`,
                `🗡️ **Attacks**: ${enemyClan.attacks}/${war.teamSize}`,
              ].join('\n'),
              color: outcomeColor,
              footer: { text: 'Bimgus • Clash of Clans Tracker' },
              timestamp: new Date().toISOString(),
            };

            await DiscordService.sendWebhook(webhookUrl, {
              embeds: [roundEmbed],
              components: [DiscordService.warActionRow(clanTag, enemyClan.tag)],
            });

            // Post-Round Audit (Missed attacks & 3-star stars)
            const missedAttacks = ourClan.members.filter((m) => !m.attacks || m.attacks.length === 0);
            const threeStarMaxers = ourClan.members.filter(
              (m) => m.attacks && m.attacks.some((a) => a.stars === 3)
            );

            const auditLines: string[] = [];
            if (missedAttacks.length > 0) {
              auditLines.push(`🚨 **Missed Attack (0/1)**:`);
              missedAttacks
                .sort((a, b) => a.mapPosition - b.mapPosition)
                .forEach((m) => {
                  auditLines.push(`• **#${m.mapPosition} ${m.name}** (TH${m.townhallLevel}) — 0 attacks`);
                });
              auditLines.push('');
            } else {
              auditLines.push('✅ **100% Clan Participation**: Every member completed their CWL attack!');
              auditLines.push('');
            }

            if (threeStarMaxers.length > 0) {
              auditLines.push(`⭐ **Round MVPs (Max 3 ⭐ Stars)**:`);
              threeStarMaxers
                .sort((a, b) => a.mapPosition - b.mapPosition)
                .forEach((m) => {
                  const atk = m.attacks![0];
                  auditLines.push(`• **#${m.mapPosition} ${m.name}** (TH${m.townhallLevel}) — 3 ⭐ (${atk.destructionPercentage}%)`);
                });
            }

            const auditEmbed: DiscordEmbed = {
              title: `📋 CWL Round ${roundNum} Performance Audit`,
              description: auditLines.join('\n'),
              color: COLORS.PURPLE,
              footer: { text: 'Bimgus • Clash of Clans Tracker' },
              timestamp: new Date().toISOString(),
            };

            await DiscordService.sendWebhook(webhookUrl, {
              embeds: [auditEmbed],
              components: [DiscordService.warActionRow(clanTag)],
            });
            loggedRounds.add(roundIndex);
          }

          // Found our war for this round, stop checking other warTags in this round
          break;
        } catch (err: any) {
          console.warn(`[CWL] Could not process warTag ${warTag}: ${err.message}`);
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
      const summary = await buildCwlSeasonSummary(cwlGroup, clanTag, cocService);
      if (summary) {
        await sendCwlSeasonSummaryDiscord(summary, webhookUrl);
        seasonSummary = summary;
        announcedSeasonSummary = true;
      }
    } catch (err: any) {
      console.warn(`[CWL] Failed to generate/send overall season summary: ${err.message}`);
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
    currentRoundIndex,
    currentWarTag,
    announcedSeasonSummary,
    seasonSummary,
    updatedAt: new Date().toISOString(),
  };
}
