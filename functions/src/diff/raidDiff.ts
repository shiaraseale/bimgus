import { CapitalRaidWeekend, ClanMember } from '../types/coc';
import { RaidSnapshotDoc, BotConfigDoc } from '../types/db';
import { DiscordService, COLORS } from '../services/discordService';
import { DiscordButtonComponent, DiscordContainerComponent } from '../types/discord';
import { EMOJIS } from '../constants/emojis';
import {
  card,
  codeSafe,
  fitLines,
  LAYOUT_LIMITS,
  layoutMessage,
  packMessages,
  splitLines,
} from '../services/discordLayout';
import { formatCoCTime } from './warDiff';
import { discordTime } from '../utils/discordTime';

// Room for a capital's district lines (Discord allows 4,000 characters per message)
const DISTRICTS_BUDGET = 3300;
// Room for the recap's title, totals and footer; the ranking gets the rest, after the names who didn't raid
const RECAP_TEXT_BUDGET = 300;

type RaidLogEntry = NonNullable<CapitalRaidWeekend['attackLog']>[number];

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/**
 * A row per district in the same columns as the recap's ranking: how far it got, its hits and loot, with
 * who attacked it in order on a small line under it (when `withNames`).
 */
function districtLines(districts: RaidLogEntry['districts'], withNames: boolean): string[] {
  const names = districts.map((d) => `${d.name} (${d.districtHallLevel})`);
  const golds = districts.map((d) => (d.totalLooted || 0).toLocaleString());
  const nameWidth = Math.max(...names.map((n) => n.length));
  const hitWidth = Math.max(...districts.map((d) => String(d.attackCount).length));
  const goldWidth = Math.max(...golds.map((g) => g.length));
  return districts.map((d, i) => {
    const percent = `${d.destructionPercent}%`.padStart(4);
    const hits = String(d.attackCount).padStart(hitWidth);
    const row = `\`${names[i].padEnd(nameWidth)}  ${percent}  ${hits}\` 🗡️ \`${golds[i].padStart(goldWidth)}\` ${EMOJIS.CAPITAL_GOLD}`;
    // The API lists the latest attack first
    const attackers = [...(d.attacks ?? [])].reverse().map((a) => a.attacker.name);
    return withNames && attackers.length > 0 ? `${row}\n-# ${attackers.join(', ')}` : row;
  });
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
  let districts = districtLines(raid.districts, true);
  if (districts.join('\n').length > DISTRICTS_BUDGET) districts = districtLines(raid.districts, false);

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

/**
 * The weekend's recap: its totals, everyone who raided ranked by the capital gold they looted (fewer
 * attacks first when level), then the clan's current members who didn't raid. One card, or more when
 * the ranking won't fit one message, as a nearly full clan's won't, so that nobody's left out.
 */
function buildWeekendRecapCards(
  raid: CapitalRaidWeekend,
  clanMembers: Array<Pick<ClanMember, 'tag' | 'name'>>
): DiscordContainerComponent[] {
  const raiders = [...(raid.members ?? [])].sort(
    (a, b) => b.capitalResourcesLooted - a.capitalResourcesLooted || a.attacks - b.attacks
  );
  // Monospace text keeps the columns in line, padded to the widest name and gold. Custom emoji don't
  // work inside it, so each row has two runs of it with the emoji around them
  const nameWidth = Math.max(...raiders.map((m) => m.name.length));
  const golds = raiders.map((m) => m.capitalResourcesLooted.toLocaleString());
  const goldWidth = Math.max(...golds.map((g) => g.length));
  const ranking = raiders.map((m, i) => {
    const rank = `${String(i + 1).padStart(2, ' ')}.`;
    const name = codeSafe(m.name).padEnd(nameWidth);
    const attacks = `${m.attacks}/${m.attackLimit + m.bonusAttackLimit}`;
    return `\`${rank} ${name}  ${attacks}\` 🗡️ \`${golds[i].padStart(goldWidth)}\` ${EMOJIS.CAPITAL_GOLD}`;
  });
  const raided = new Set(raiders.map((m) => m.tag));
  const missed = clanMembers
    .filter((m) => !raided.has(m.tag))
    .map((m) => m.name)
    .sort((a, b) => a.localeCompare(b));
  const missedLine =
    missed.length > 0 ? `🚨 **No attacks (${missed.length})**: ${missed.join(', ')}` : '✅ Everyone raided';
  const parts = splitLines(ranking, LAYOUT_LIMITS.chars - RECAP_TEXT_BUDGET - missedLine.length);

  return parts.map((part, i) => {
    const first = i === 0;
    const last = i === parts.length - 1;
    return card({
      accent: COLORS.GOLD,
      title: first ? `${EMOJIS.RAID} Raid weekend has ended` : undefined,
      body: first
        ? `🏰 ${count(raid.raidsCompleted, 'capital')} · ${count(raid.enemyDistrictsDestroyed, 'district')} · ⚔️ ${count(raid.totalAttacks, 'attack')} · ${raid.capitalTotalLoot.toLocaleString()} ${EMOJIS.CAPITAL_GOLD}`
        : undefined,
      blocks: [part.length > 0 ? ['🏅 **Ranking**', ...part].join('\n') : '', last ? missedLine : ''],
      footer: last ? `${count(raiders.length, 'member')} took part` : undefined,
    });
  });
}

export async function processRaidDiff(
  latestRaid: CapitalRaidWeekend,
  prevSnapshot: RaidSnapshotDoc | null,
  config: BotConfigDoc,
  clanTag: string,
  clanMembers: Array<Pick<ClanMember, 'tag' | 'name'>>
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
    // The recap last, after any unfinished capital's card
    if (!isInitialSnapshot && webhookUrl && config.notificationsEnabled.raidEndSummary) {
      const links = DiscordService.raidActionRow(clanTag).components;
      for (const message of packMessages(buildWeekendRecapCards(latestRaid, clanMembers), links)) {
        await DiscordService.sendWebhook(webhookUrl, message);
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
