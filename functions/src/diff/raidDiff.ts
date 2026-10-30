import { CapitalRaidWeekend } from '../types/coc';
import { RaidSnapshotDoc, BotConfigDoc } from '../types/db';
import { DiscordService, COLORS } from '../services/discordService';
import { DiscordButtonComponent, DiscordContainerComponent } from '../types/discord';
import { EMOJIS } from '../constants/emojis';
import { card, fitLines, layoutMessage } from '../services/discordLayout';
import { formatCoCTime } from './warDiff';
import { discordTime } from '../utils/discordTime';

// Room for a capital's district lines (Discord allows 4,000 characters per message)
const DISTRICTS_BUDGET = 3300;

type RaidLogEntry = NonNullable<CapitalRaidWeekend['attackLog']>[number];

/** One district: how far it got, its hits and loot, and who attacked it in order (when `withNames`). */
function districtLine(d: RaidLogEntry['districts'][number], withNames: boolean): string {
  const head = `${d.destructionPercent === 100 ? '✅' : '⚪'} **${d.name}** (${d.districtHallLevel})`;
  if (!d.attacks || d.attacks.length === 0) return `${head}: not attacked`;
  const hits = `${d.attackCount} hit${d.attackCount === 1 ? '' : 's'}`;
  const loot = `${(d.totalLooted || 0).toLocaleString()} ${EMOJIS.CAPITAL_GOLD}`;
  // The API lists the latest attack first
  const names = withNames
    ? ` · ${[...d.attacks]
        .reverse()
        .map((a) => a.attacker.name)
        .join(', ')}`
    : '';
  return `${head}: ${d.destructionPercent}% · ${hits} · ${loot}${names}`;
}

/**
 * A capital the clan conquered, or one it was still attacking when the weekend ended: the totals, then
 * a line per district with its attackers in order.
 */
function buildCapitalCard(
  raid: RaidLogEntry,
  weekendTotals: { districtsDestroyed: number; capitalTotalLoot: number; raidsCompleted?: number },
  isPartialWeekendEnd: boolean,
  buttons: DiscordButtonComponent[]
): DiscordContainerComponent {
  const totalLoot = raid.districts.reduce((sum, d) => sum + (d.totalLooted || 0), 0);
  const percentCleared =
    raid.districtCount > 0 ? Math.round((raid.districtsDestroyed / raid.districtCount) * 100) : 100;

  // A long breakdown loses the attackers' names first, then districts from the end
  let districts = raid.districts.map((d) => districtLine(d, true));
  if (districts.join('\n').length > DISTRICTS_BUDGET) districts = raid.districts.map((d) => districtLine(d, false));

  const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;
  const totals = [
    count(weekendTotals.districtsDestroyed, 'district'),
    `${weekendTotals.capitalTotalLoot.toLocaleString()} capital gold`,
    weekendTotals.raidsCompleted ? count(weekendTotals.raidsCompleted, 'capital') : '',
  ].filter(Boolean);

  return card({
    accent: isPartialWeekendEnd ? COLORS.PURPLE : COLORS.GOLD,
    title: isPartialWeekendEnd
      ? `${EMOJIS.RAID} ${raid.defender.name}: ${percentCleared}% when the weekend ended`
      : `${EMOJIS.RAID} Conquered ${raid.defender.name}`,
    body: `🏰 ${raid.districtsDestroyed}/${raid.districtCount} districts · ⚔️ ${raid.attackCount} attacks · ${totalLoot.toLocaleString()} ${EMOJIS.CAPITAL_GOLD}`,
    thumbnail: raid.defender.badgeUrls?.large || raid.defender.badgeUrls?.medium || raid.defender.badgeUrls?.small,
    blocks: [fitLines(districts, DISTRICTS_BUDGET).join('\n')],
    footer: `${isPartialWeekendEnd ? 'Weekend total' : 'Weekend so far'}: ${totals.join(' · ')}`,
    buttons,
  });
}

export async function processRaidDiff(
  latestRaid: CapitalRaidWeekend,
  prevSnapshot: RaidSnapshotDoc | null,
  config: BotConfigDoc,
  clanTag: string
): Promise<RaidSnapshotDoc> {
  const weekendId = latestRaid.startTime;
  const webhookUrl = config.webhooks.raidWeekend;
  const isNewWeekend = !prevSnapshot || prevSnapshot.weekendId !== weekendId;

  // 1. Raid Weekend Start Announcement (not on the very first run, which only records a baseline)
  if (isNewWeekend && prevSnapshot && webhookUrl && latestRaid.state === 'ongoing') {
    const endMs = latestRaid.endTime ? new Date(formatCoCTime(latestRaid.endTime)).getTime() : null;
    const startCard = card({
      accent: COLORS.GOLD,
      title: `${EMOJIS.RAID} Raid weekend has started`,
      body: `5 attacks each, plus a bonus one${endMs ? ` · ends ${discordTime(endMs)}` : ''}`,
      buttons: DiscordService.raidActionRow(clanTag).components,
    });
    await DiscordService.sendWebhook(webhookUrl, layoutMessage(startCard));
  }

  // 2. Track Completed Clan Capitals
  const completedCapitalTags = new Set<string>(
    prevSnapshot && !isNewWeekend ? prevSnapshot.completedCapitalTags || [] : []
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
            const capitalCard = buildCapitalCard(
              raid,
              {
                districtsDestroyed: latestRaid.enemyDistrictsDestroyed,
                capitalTotalLoot: latestRaid.capitalTotalLoot,
                raidsCompleted: latestRaid.raidsCompleted,
              },
              false,
              DiscordService.raidActionRow(clanTag, raid.defender.tag).components
            );
            await DiscordService.sendWebhook(webhookUrl, layoutMessage(capitalCard));
            // Add a small pause to prevent hitting Discord rate limits
            await new Promise((r) => setTimeout(r, 400));
          }
          completedCapitalTags.add(raid.defender.tag);
        }
      }
    }
  }

  // 3. Raid Weekend Concluded Check (Partial Unfinished Capital)
  let announcedWeekendEnd = prevSnapshot && !isNewWeekend ? (prevSnapshot.announcedWeekendEnd ?? false) : false;

  if (latestRaid.state === 'ended' && !announcedWeekendEnd) {
    if (latestRaid.attackLog && latestRaid.attackLog.length > 0) {
      for (const raid of latestRaid.attackLog) {
        const isFullyConquered =
          raid.districtsDestroyed >= raid.districtCount ||
          (raid.districts && raid.districts.length > 0 && raid.districts.every((d) => d.destructionPercent === 100));

        // If attacks were started on this capital but it was not fully completed before weekend ended
        if (!isFullyConquered && raid.attackCount > 0 && !completedCapitalTags.has(raid.defender.tag)) {
          if (!isInitialSnapshot && webhookUrl && config.notificationsEnabled.raidDistricts) {
            const capitalCard = buildCapitalCard(
              raid,
              {
                districtsDestroyed: latestRaid.enemyDistrictsDestroyed,
                capitalTotalLoot: latestRaid.capitalTotalLoot,
                raidsCompleted: latestRaid.raidsCompleted,
              },
              true /* isPartialWeekendEnd */,
              DiscordService.raidActionRow(clanTag, raid.defender.tag).components
            );
            await DiscordService.sendWebhook(webhookUrl, layoutMessage(capitalCard));
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
