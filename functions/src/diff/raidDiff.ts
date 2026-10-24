import { CapitalRaidWeekend } from '../types/coc';
import { RaidSnapshotDoc, BotConfigDoc } from '../types/db';
import { DiscordService, COLORS } from '../services/discordService';
import { DiscordEmbed } from '../types/discord';
import { EMOJIS } from '../constants/emojis';

/**
 * Builds a rich summary embed when an entire enemy clan capital is conquered (100% destroyed),
 * or when the raid weekend concludes while a capital was partially attacked.
 * Details all attacks grouped by district in chronological order, showing 0% for unattacked districts.
 */
function buildCapitalConqueredEmbed(
  raid: NonNullable<CapitalRaidWeekend['attackLog']>[number],
  weekendTotals?: {
    districtsDestroyed: number;
    capitalTotalLoot: number;
    raidsCompleted?: number;
  },
  isPartialWeekendEnd: boolean = false,
  _clanTag: string = '#ABC123'
): DiscordEmbed {
  const totalLoot = raid.districts.reduce((sum, d) => sum + (d.totalLooted || 0), 0);
  const percentCleared =
    raid.districtCount > 0
      ? Math.round((raid.districtsDestroyed / raid.districtCount) * 100)
      : 100;

  const lines: string[] = [
    isPartialWeekendEnd
      ? 'Raid Weekend has ended with an active attack in progress on an enemy Clan Capital!'
      : 'The clan has completely conquered an enemy Clan Capital!',
    '',
    `🎯 **Enemy Clan**: **${raid.defender.name}** (Lvl ${raid.defender.level})`,
    `🏰 **Districts Cleared**: **${raid.districtsDestroyed}/${raid.districtCount}** (${isPartialWeekendEnd ? `${percentCleared}%` : '100%'})`,
    `⚔️ **Total Attacks**: **${raid.attackCount}**`,
    `${EMOJIS.CAPITAL_GOLD} **Capital Gold Looted**: **${totalLoot.toLocaleString()}**`,
  ];

  if (isPartialWeekendEnd) {
    lines.push('⏳ **Status**: *Raid Weekend ended before capital could be completed*');
  }

  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('📋 **DISTRICT ATTACK BREAKDOWN**');
  lines.push('');

  for (const d of raid.districts) {
    const districtLoot = (d.totalLooted || 0).toLocaleString();
    lines.push(
      `🏰 **${d.name}** (Lvl ${d.districtHallLevel}) — ${d.attackCount} hit${d.attackCount === 1 ? '' : 's'} • ${districtLoot} ${EMOJIS.CAPITAL_GOLD}`
    );

    if (!d.attacks || d.attacks.length === 0) {
      lines.push('   └ ⚪ *0% — Not attacked (0 hits)*');
    } else {
      // The API returns attacks in reverse order (latest first); reverse for chronological order
      const chronAttacks = [...d.attacks].reverse();
      let prevDest = 0;

      chronAttacks.forEach((atk, idx) => {
        const gain = atk.destructionPercent - prevDest;
        const isFinish = atk.destructionPercent === 100;
        const starIcon = atk.stars > 0 ? '⭐'.repeat(atk.stars) : '0★';
        const finishBadge = isFinish ? ' 💥 Cleared!' : '';

        lines.push(
          `   └ ⚔️ Hit ${idx + 1}: **${atk.attacker.name}** — +${gain}% → ${atk.destructionPercent}% (${starIcon})${finishBadge}`
        );
        prevDest = atk.destructionPercent;
      });
    }

    lines.push('');
  }

  if (weekendTotals) {
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push(isPartialWeekendEnd ? '📊 **FINAL WEEKEND TOTALS**' : '📊 **CLAN WEEKEND TOTALS**');
    lines.push(`🏰 **Districts Destroyed**: **${weekendTotals.districtsDestroyed}**`);
    lines.push(`${EMOJIS.CAPITAL_GOLD} **Capital Gold Looted**: **${weekendTotals.capitalTotalLoot.toLocaleString()}**`);
    if (weekendTotals.raidsCompleted !== undefined && weekendTotals.raidsCompleted > 0) {
      lines.push(`🏛️ **Capitals Completed**: **${weekendTotals.raidsCompleted}**`);
    }
  }

  const badgeUrl =
    raid.defender.badgeUrls?.large ||
    raid.defender.badgeUrls?.medium ||
    raid.defender.badgeUrls?.small;

  return {
    title: isPartialWeekendEnd
      ? `${EMOJIS.RAID} Raid Weekend Concluded: ${raid.defender.name} (Partial Attack)`
      : `${EMOJIS.RAID} Clan Capital Conquered: ${raid.defender.name}`,
    description: lines.join('\n'),
    color: isPartialWeekendEnd ? COLORS.PURPLE : COLORS.GOLD,
    thumbnail: badgeUrl ? { url: badgeUrl } : undefined,
    footer: { text: 'Clan Capital Raid Weekend • Bimgus Tracker' },
    timestamp: new Date().toISOString(),
  };
}

export async function processRaidDiff(
  latestRaid: CapitalRaidWeekend,
  prevSnapshot: RaidSnapshotDoc | null,
  config: BotConfigDoc,
  clanTag: string = '#ABC123'
): Promise<RaidSnapshotDoc> {
  const weekendId = latestRaid.startTime;
  const webhookUrl = config.webhooks.raidWeekend;
  const isNewWeekend = !prevSnapshot || prevSnapshot.weekendId !== weekendId;

  // 1. Raid Weekend Start Announcement
  if (isNewWeekend && webhookUrl && latestRaid.state === 'ongoing') {
    const embed: DiscordEmbed = {
      title: `${EMOJIS.RAID} Raid Weekend Started!`,
      description: [
        'Clan Capital Raid Weekend is now active! Make sure to take all 5 (+1 bonus) attacks before Monday morning.',
        '',
        `${EMOJIS.CAPITAL_GOLD} **Total Capital Loot**: ${latestRaid.capitalTotalLoot.toLocaleString()}`,
        `🏰 **Districts Destroyed**: ${latestRaid.enemyDistrictsDestroyed}`,
      ].join('\n'),
      color: COLORS.GOLD,
      footer: { text: 'Bimgus • Clash of Clans Tracker' },
      timestamp: new Date().toISOString(),
    };
    await DiscordService.sendWebhook(webhookUrl, {
      embeds: [embed],
      components: [DiscordService.raidActionRow(clanTag)],
    });
  }

  // 2. Track Completed Clan Capitals
  const completedCapitalTags = new Set<string>(
    prevSnapshot && !isNewWeekend ? (prevSnapshot.completedCapitalTags || []) : []
  );

  // If initial tracking snapshot, establish baseline of already conquered capitals without spamming
  const isInitialSnapshot = !prevSnapshot;

  if (latestRaid.attackLog && latestRaid.attackLog.length > 0) {
    for (const raid of latestRaid.attackLog) {
      const isFullyConquered =
        raid.districtsDestroyed >= raid.districtCount ||
        (raid.districts && raid.districts.length > 0 && raid.districts.every((d) => d.destructionPercent === 100));

      if (isFullyConquered) {
        if (!completedCapitalTags.has(raid.defender.tag)) {
          if (!isInitialSnapshot && webhookUrl && config.notificationsEnabled.raidDistricts) {
            const embed = buildCapitalConqueredEmbed(
              raid,
              {
                districtsDestroyed: latestRaid.enemyDistrictsDestroyed,
                capitalTotalLoot: latestRaid.capitalTotalLoot,
                raidsCompleted: latestRaid.raidsCompleted,
              },
              false,
              clanTag
            );
            await DiscordService.sendWebhook(webhookUrl, {
              embeds: [embed],
              components: [DiscordService.raidActionRow(clanTag, raid.defender.tag)],
            });
            // Add a small pause to prevent hitting Discord rate limits
            await new Promise((r) => setTimeout(r, 400));
          }
          completedCapitalTags.add(raid.defender.tag);
        }
      }
    }
  }

  // 3. Raid Weekend Concluded Check (Partial Unfinished Capital)
  let announcedWeekendEnd =
    prevSnapshot && !isNewWeekend ? (prevSnapshot.announcedWeekendEnd ?? false) : false;

  if (latestRaid.state === 'ended' && !announcedWeekendEnd) {
    if (latestRaid.attackLog && latestRaid.attackLog.length > 0) {
      for (const raid of latestRaid.attackLog) {
        const isFullyConquered =
          raid.districtsDestroyed >= raid.districtCount ||
          (raid.districts && raid.districts.length > 0 && raid.districts.every((d) => d.destructionPercent === 100));

        // If attacks were started on this capital but it was not fully completed before weekend ended
        if (!isFullyConquered && raid.attackCount > 0 && !completedCapitalTags.has(raid.defender.tag)) {
          if (!isInitialSnapshot && webhookUrl && config.notificationsEnabled.raidDistricts) {
            const embed = buildCapitalConqueredEmbed(
              raid,
              {
                districtsDestroyed: latestRaid.enemyDistrictsDestroyed,
                capitalTotalLoot: latestRaid.capitalTotalLoot,
                raidsCompleted: latestRaid.raidsCompleted,
              },
              true /* isPartialWeekendEnd */,
              clanTag
            );
            await DiscordService.sendWebhook(webhookUrl, {
              embeds: [embed],
              components: [DiscordService.raidActionRow(clanTag, raid.defender.tag)],
            });
            await new Promise((r) => setTimeout(r, 400));
          }
          completedCapitalTags.add(raid.defender.tag);
        }
      }
    }
    announcedWeekendEnd = true;
  }

  return {
    weekendId,
    state: latestRaid.state,
    totalLoot: latestRaid.capitalTotalLoot,
    districtsDestroyed: latestRaid.enemyDistrictsDestroyed,
    completedDistrictIds: prevSnapshot?.completedDistrictIds || [],
    completedCapitalTags: Array.from(completedCapitalTags),
    announcedWeekendEnd,
    updatedAt: new Date().toISOString(),
  };
}
