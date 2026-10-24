import { ClanMember } from '../types/coc';
import { ClanGamesSnapshotDoc, BotConfigDoc } from '../types/db';
import { DiscordService, COLORS } from '../services/discordService';
import { DiscordEmbed } from '../types/discord';
import { CocService } from '../services/cocService';
import { isClanGamesActive } from './clanGamesWindow';
import { mapWithConcurrency } from '../utils/concurrency';

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
  clanTag: string = '#ABC123',
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
  const unlockedTiers = new Set<number>(isNewEvent ? [] : (prevSnapshot?.unlockedTiers || []));
  const maxedTags = new Set<string>(isNewEvent ? [] : (prevSnapshot?.maxedMemberTags || []));
  const baselineMap = { ...(isNewEvent ? {} : (prevSnapshot?.memberBaselinePoints || {})) };

  // 1. Announce Start of Clan Games
  if ((isNewEvent || !prevSnapshot?.announcedStart) && webhookUrl && config.notificationsEnabled.clanGamesStart) {
    const startEmbed: DiscordEmbed = {
      title: '🎪 Clan Games Have Begun!',
      description: [
        'Clan Games are officially live! Complete challenges to unlock maximum clan rewards.',
        '',
        `🎯 **Max Points per Player**: ${MAX_CLAN_GAMES_POINTS.toLocaleString()} pts`,
        `🏆 **Clan Tier 6 Goal**: 50,000 pts`,
        `⏳ **Event Window**: 22nd 08:00 UTC – 28th`,
        '',
        '**Reward Milestones**:',
        '• **Tier 1**: 3,000 pts',
        '• **Tier 2**: 7,500 pts',
        '• **Tier 3**: 12,000 pts',
        '• **Tier 4**: 18,000 pts',
        '• **Tier 5**: 30,000 pts',
        '• **Tier 6**: 50,000 pts',
      ].join('\n'),
      color: COLORS.GOLD,
      footer: { text: 'Bimgus • Clash of Clans Tracker' },
      timestamp: now.toISOString(),
    };
    await DiscordService.sendWebhook(webhookUrl, {
      embeds: [startEmbed],
      components: [DiscordService.clanGamesActionRow(clanTag)],
    });
  }

  // 2. Sample player Clan Games achievements
  let totalClanPoints = 0;
  // Sample up to 15 members per poll cycle
  const sampleMembers = members.slice(0, 15);

  // Fetch a few at a time (3.2), then process in roster order
  const players = await mapWithConcurrency(sampleMembers, 5, (member) =>
    cocService.getPlayer(member.tag).catch(() => null)
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
          const maxEmbed: DiscordEmbed = {
            title: `🌟 ${MAX_CLAN_GAMES_POINTS.toLocaleString()} Clan Games Points Maxed!`,
            description: [
              `**${member.name}** (${member.tag}) has reached the **${MAX_CLAN_GAMES_POINTS.toLocaleString()} maximum points** cap!`,
              '',
              `🎖️ **Role**: ${member.role}`,
              `🏆 **Achievement**: Maximum individual rewards unlocked!`,
            ].join('\n'),
            color: COLORS.GOLD,
            footer: { text: 'Bimgus • Clash of Clans Tracker' },
            timestamp: now.toISOString(),
          };
          await DiscordService.sendWebhook(webhookUrl, {
            embeds: [maxEmbed],
            components: [DiscordService.clanGamesActionRow(clanTag)],
          });
        }
      }
    } catch {
      // Continue next player if individual fetch fails
    }
  }

  // 3. Check for Tier completions
  if (webhookUrl && config.notificationsEnabled.clanGamesTiers) {
    for (const { tier, points } of CLAN_GAMES_TIERS) {
      if (totalClanPoints >= points && !unlockedTiers.has(tier)) {
        unlockedTiers.add(tier);

        const tierEmbed: DiscordEmbed = {
          title: `🎉 Clan Games Tier ${tier} Unlocked!`,
          description: [
            `The clan has reached **${totalClanPoints.toLocaleString()}** Clan Games points!`,
            '',
            `🔓 **Unlocked**: Tier ${tier} Rewards`,
            `🎯 **Next Goal**: ${tier < 6 ? `${CLAN_GAMES_TIERS[tier].points.toLocaleString()} pts` : 'MAX TIER REACHED! 🏆'}`,
          ].join('\n'),
          color: COLORS.GREEN,
          footer: { text: 'Bimgus • Clash of Clans Tracker' },
          timestamp: now.toISOString(),
        };
        await DiscordService.sendWebhook(webhookUrl, {
          embeds: [tierEmbed],
          components: [DiscordService.clanGamesActionRow(clanTag)],
        });
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
