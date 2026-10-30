import { ClanMember } from '../types/coc';
import { ClanGamesSnapshotDoc, BotConfigDoc } from '../types/db';
import { DiscordService, COLORS } from '../services/discordService';
import { card, layoutMessage } from '../services/discordLayout';
import { CocService } from '../services/cocService';
import { isClanGamesActive } from './clanGamesWindow';
import { mapWithConcurrency } from '../utils/concurrency';
import { log } from '../utils/log';

const MAX_CLAN_GAMES_POINTS = 10000;

const CLAN_GAMES_TIERS = [
  { tier: 1, points: 3000 },
  { tier: 2, points: 7500 },
  { tier: 3, points: 12000 },
  { tier: 4, points: 18000 },
  { tier: 5, points: 30000 },
  { tier: 6, points: 50000 },
];

export async function processClanGamesDiff(
  members: ClanMember[],
  prevSnapshot: ClanGamesSnapshotDoc | null,
  config: BotConfigDoc,
  cocService: CocService,
  clanTag: string,
  now: Date = new Date()
): Promise<ClanGamesSnapshotDoc> {
  const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const isEventWindow = isClanGamesActive(now);

  const webhookUrl = config.webhooks.clanGames;

  // If outside event window, return or reset state
  if (!isEventWindow) {
    return {
      month: currentMonth,
      isActive: false,
      totalPoints: 0,
      unlockedTiers: [],
      maxedMemberTags: [],
      memberBaselinePoints: {},
      announcedStart: false,
      updatedAt: now.toISOString(),
    };
  }

  const isNewEvent = !prevSnapshot || prevSnapshot.month !== currentMonth;
  const unlockedTiers = new Set<number>(isNewEvent ? [] : prevSnapshot?.unlockedTiers || []);
  const maxedTags = new Set<string>(isNewEvent ? [] : prevSnapshot?.maxedMemberTags || []);
  const baselineMap = { ...(isNewEvent ? {} : prevSnapshot?.memberBaselinePoints || {}) };

  // 1. Announce Start of Clan Games
  if ((isNewEvent || !prevSnapshot?.announcedStart) && webhookUrl && config.notificationsEnabled.clanGamesStart) {
    const startCard = card({
      title: '🎪 Clan Games have started',
      body: `Up to ${MAX_CLAN_GAMES_POINTS.toLocaleString()} points each · tier 6 at ${CLAN_GAMES_TIERS[5].points.toLocaleString()} · ends on the 28th`,
      accent: COLORS.GOLD,
      buttons: DiscordService.clanGamesActionRow(clanTag).components,
    });

    await DiscordService.sendWebhook(webhookUrl, layoutMessage(startCard));
  }

  // 2. Sample player Clan Games achievements
  let totalClanPoints = 0;
  // Sample up to 15 members per poll cycle
  const sampleMembers = members.slice(0, 15);

  // Fetch a few at a time (3.2), then process in roster order
  const players = await mapWithConcurrency(sampleMembers, 5, (member) =>
    cocService.getPlayer(member.tag).catch((err: any) => {
      log.warn(`[ClanGames] Could not fetch ${member.tag} (${err.message}); skipping them this poll`);
      return null;
    })
  );
  for (const [i, member] of sampleMembers.entries()) {
    try {
      const player = players[i];
      if (!player) continue;
      const achievement = player.achievements?.find((a: any) => a.name === 'Games Champion');
      const currentValue = achievement ? achievement.value : 0;

      if (baselineMap[member.tag] === undefined) {
        // Record starting baseline
        baselineMap[member.tag] = currentValue;
      }

      const pointsContributed = Math.max(0, Math.min(MAX_CLAN_GAMES_POINTS, currentValue - baselineMap[member.tag]));
      totalClanPoints += pointsContributed;

      // Check if player maxed out points
      if (pointsContributed >= MAX_CLAN_GAMES_POINTS && !maxedTags.has(member.tag)) {
        maxedTags.add(member.tag);

        if (webhookUrl && config.notificationsEnabled.clanGamesMaxers) {
          const maxCard = card({
            title: `🌟 ${member.name} maxed Clan Games`,
            body: `All ${MAX_CLAN_GAMES_POINTS.toLocaleString()} points`,
            footer: member.tag,
            accent: COLORS.GOLD,
            buttons: DiscordService.clanGamesActionRow(clanTag).components,
          });

          await DiscordService.sendWebhook(webhookUrl, layoutMessage(maxCard));
        }
      }
    } catch (err: any) {
      // Continue with the next player
      log.warn(`[ClanGames] Could not process ${member.tag}: ${err.message}`);
    }
  }

  // 3. Check for Tier completions
  if (webhookUrl && config.notificationsEnabled.clanGamesTiers) {
    for (const { tier, points } of CLAN_GAMES_TIERS) {
      if (totalClanPoints >= points && !unlockedTiers.has(tier)) {
        unlockedTiers.add(tier);

        const tierCard = card({
          title: `🎉 Clan Games tier ${tier} unlocked`,
          body: `**${totalClanPoints.toLocaleString()}** points · ${tier < 6 ? `tier ${tier + 1} at ${CLAN_GAMES_TIERS[tier].points.toLocaleString()}` : 'every tier unlocked 🏆'}`,
          accent: COLORS.GREEN,
          buttons: DiscordService.clanGamesActionRow(clanTag).components,
        });

        await DiscordService.sendWebhook(webhookUrl, layoutMessage(tierCard));
      }
    }
  }

  return {
    month: currentMonth,
    isActive: true,
    totalPoints: totalClanPoints,
    unlockedTiers: Array.from(unlockedTiers),
    maxedMemberTags: Array.from(maxedTags),
    memberBaselinePoints: baselineMap,
    announcedStart: true,
    updatedAt: now.toISOString(),
  };
}
