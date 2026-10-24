import { ClanMember, ClanResponse } from '../types/coc';
import { ClanSnapshotDoc, BotConfigDoc } from '../types/db';
import { DiscordService, COLORS } from '../services/discordService';
import { DiscordEmbed } from '../types/discord';
import { CocAssetService } from '../services/cocAssetService';
import { EMOJIS } from '../constants/emojis';

export async function processClanDiff(
  currentClan: ClanResponse,
  previousSnapshot: ClanSnapshotDoc | null,
  config: BotConfigDoc
): Promise<ClanSnapshotDoc> {
  const currentMembersMap: Record<string, ClanMember> = {};
  for (const m of currentClan.memberList) {
    currentMembersMap[m.tag] = m;
  }
  const currentTags = Object.keys(currentMembersMap);

  // If there's no previous snapshot, record the current baseline and exit
  if (!previousSnapshot) {
    return {
      tag: currentClan.tag,
      name: currentClan.name,
      clanLevel: currentClan.clanLevel,
      membersCount: currentClan.members,
      memberTags: currentTags,
      membersMap: currentMembersMap,
      updatedAt: new Date().toISOString(),
    };
  }

  const prevMap = previousSnapshot.membersMap;
  // Joins are judged by the tag list: older snapshots kept departed members in membersMap
  const prevTags = new Set(previousSnapshot.memberTags);
  const webhookUrl = config.webhooks.clanActivity;
  const embedsToSend: DiscordEmbed[] = [];

  if (webhookUrl && config.notificationsEnabled.memberJoinedLeft) {
    // 1. Check for joined members
    for (const tag of currentTags) {
      if (!prevTags.has(tag)) {
        const joined = currentMembersMap[tag];
        embedsToSend.push({
          title: '📥 New Member Joined',
          description: [
            `**${joined.name}** (${joined.tag}) has entered the clan!`,
            '',
            `🏆 **Trophies**: ${joined.trophies.toLocaleString()}`,
            `🎖️ **Role**: ${formatRole(joined.role)}`,
            `📊 **Clan Size**: ${currentClan.members}/50`,
          ].join('\n'),
          color: COLORS.GREEN,
          thumbnail: joined.league?.iconUrls?.small ? { url: joined.league.iconUrls.small } : undefined,
          footer: { text: 'Bimgus • Clash of Clans Tracker' },
          timestamp: new Date().toISOString(),
        });
      }
    }

    // 2. Check for departed members
    for (const prevTag of previousSnapshot.memberTags) {
      if (!currentMembersMap[prevTag]) {
        const left = prevMap[prevTag];
        embedsToSend.push({
          title: '📤 Member Left',
          description: [
            `**${left.name}** (${left.tag}) has left or was kicked from the clan.`,
            '',
            `🎖️ **Last Role**: ${formatRole(left.role)}`,
            `🏆 **Trophies**: ${left.trophies.toLocaleString()}`,
            `📊 **Clan Size**: ${currentClan.members}/50`,
          ].join('\n'),
          color: COLORS.RED,
          footer: { text: 'Bimgus • Clash of Clans Tracker' },
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  // 3. Check for role changes & promotions
  if (webhookUrl && config.notificationsEnabled.roleChanges) {
    for (const tag of currentTags) {
      const prev = prevTags.has(tag) ? prevMap[tag] : undefined;
      const curr = currentMembersMap[tag];
      if (prev && curr && prev.role !== curr.role) {
        const isPromotion = getRoleWeight(curr.role) > getRoleWeight(prev.role);
        embedsToSend.push({
          title: isPromotion ? `${EMOJIS.CROWN} Clan Promotion` : '🔻 Clan Demotion',
          description: [
            `**${curr.name}** (${curr.tag}) status changed!`,
            '',
            `📜 **Previous Role**: ${formatRole(prev.role)}`,
            `🎖️ **New Role**: ${formatRole(curr.role)}`,
          ].join('\n'),
          color: isPromotion ? COLORS.GOLD : COLORS.BLUE,
          footer: { text: 'Bimgus • Clash of Clans Tracker' },
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  // 4. Check for Town Hall level upgrades
  if (webhookUrl && config.notificationsEnabled.thUpgrades) {
    for (const tag of currentTags) {
      const prev = prevTags.has(tag) ? prevMap[tag] : undefined;
      const curr = currentMembersMap[tag];
      if (
        prev &&
        curr &&
        prev.townHallLevel &&
        curr.townHallLevel &&
        curr.townHallLevel > prev.townHallLevel
      ) {
        embedsToSend.push({
          title: '🏛️ Town Hall Upgraded!',
          description: [
            `**${curr.name}** (${curr.tag}) has upgraded their Town Hall!`,
            '',
            `🏚️ **Previous Town Hall**: TH${prev.townHallLevel}`,
            `🏰 **New Town Hall**: TH${curr.townHallLevel}`,
            `🏆 **Trophies**: ${curr.trophies.toLocaleString()}`,
            `🎖️ **Role**: ${formatRole(curr.role)}`,
          ].join('\n'),
          color: COLORS.GOLD,
          thumbnail: {
            url: CocAssetService.getTownHallUrl(curr.townHallLevel),
          },
          footer: { text: 'Bimgus • Clash of Clans Tracker' },
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  // Send batch embeds to Discord
  if (webhookUrl && embedsToSend.length > 0) {
    // Discord allows up to 10 embeds per webhook message
    for (let i = 0; i < embedsToSend.length; i += 10) {
      await DiscordService.sendWebhook(webhookUrl, {
        embeds: embedsToSend.slice(i, i + 10),
        components: [
          DiscordService.createActionRow([
            DiscordService.createLinkButton('Open CoC', DiscordService.openGameLink(), '⚔️'),
            DiscordService.createLinkButton('Clash of Stats', DiscordService.clashOfStatsClanLink(currentClan.tag), '📊'),
          ]),
        ],
      });
    }
  }

  // Return new snapshot
  return {
    tag: currentClan.tag,
    name: currentClan.name,
    clanLevel: currentClan.clanLevel,
    membersCount: currentClan.members,
    memberTags: currentTags,
    membersMap: currentMembersMap,
    updatedAt: new Date().toISOString(),
  };
}

function formatRole(role: string): string {
  switch (role) {
    case 'admin':
      return 'Elder';
    case 'coLeader':
      return 'Co-Leader';
    case 'leader':
      return 'Leader';
    case 'member':
    default:
      return 'Member';
  }
}

function getRoleWeight(role: string): number {
  switch (role) {
    case 'leader':
      return 4;
    case 'coLeader':
      return 3;
    case 'admin':
      return 2;
    case 'member':
    default:
      return 1;
  }
}
