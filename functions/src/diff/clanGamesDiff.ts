import { ClanMember } from '../types/coc';
import { ClanGamesSnapshotDoc, BotConfigDoc } from '../types/db';
import { DiscordService, COLORS } from '../services/discordService';
import { card, layoutMessage } from '../services/discordLayout';
import words from '../templates/clanGames.json';
import { fill, isolate } from '../templates';
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
      title: words.started.title,
      body: fill(words.started.body, {
        maxPoints: MAX_CLAN_GAMES_POINTS.toLocaleString(),
        tier6Points: CLAN_GAMES_TIERS[5].points.toLocaleString(),
      }),
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
            title: fill(words.maxed.title, { name: isolate(member.name) }),
            body: fill(words.maxed.body, { maxPoints: MAX_CLAN_GAMES_POINTS.toLocaleString() }),
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

  // 3. Check for Tier completions: one card for the highest, when a poll passes several
  if (webhookUrl && config.notificationsEnabled.clanGamesTiers) {
    const reached = CLAN_GAMES_TIERS.filter(
      ({ tier, points }) => totalClanPoints >= points && !unlockedTiers.has(tier)
    );
    reached.forEach(({ tier }) => unlockedTiers.add(tier));
    const tier = reached.at(-1)?.tier;

    if (tier) {
      const tierCard = card({
        title: fill(words.tier.title, { tier }),
        body:
          tier < 6
            ? fill(words.tier.body, {
                points: totalClanPoints.toLocaleString(),
                nextTier: tier + 1,
                nextPoints: CLAN_GAMES_TIERS[tier].points.toLocaleString(),
              })
            : fill(words.tier.bodyAllTiers, { points: totalClanPoints.toLocaleString() }),
        accent: COLORS.GREEN,
        buttons: DiscordService.clanGamesActionRow(clanTag).components,
      });

      await DiscordService.sendWebhook(webhookUrl, layoutMessage(tierCard));
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
