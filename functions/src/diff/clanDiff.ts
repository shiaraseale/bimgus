import { ClanMember, ClanResponse } from '../types/coc';
import { ClanSnapshotDoc, BotConfigDoc } from '../types/db';
import { DiscordService, COLORS } from '../services/discordService';
import { DiscordContainerComponent } from '../types/discord';
import { card, packMessages } from '../services/discordLayout';
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
  const cards: DiscordContainerComponent[] = [];

  if (webhookUrl && config.notificationsEnabled.memberJoinedLeft) {
    // 1. Check for joined members
    for (const tag of currentTags) {
      if (!prevTags.has(tag)) {
        const joined = currentMembersMap[tag];
        cards.push(
          card({
            title: `📥 ${joined.name} joined`,
            body: `🏆 ${joined.trophies.toLocaleString()} · ${formatRole(joined.role)}`,
            accent: COLORS.GREEN,
            thumbnail: joined.league?.iconUrls?.small,
            footer: `${joined.tag} · ${currentClan.members}/50 members`,
          })
        );
      }
    }

    // 2. Check for departed members
    for (const prevTag of previousSnapshot.memberTags) {
      if (!currentMembersMap[prevTag]) {
        const left = prevMap[prevTag];
        cards.push(
          card({
            title: `📤 ${left.name} left`,
            body: `Was ${formatRole(left.role)} · 🏆 ${left.trophies.toLocaleString()}`,
            accent: COLORS.RED,
            footer: `${left.tag} · ${currentClan.members}/50 members`,
          })
        );
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
        cards.push(
          card({
            title: isPromotion ? `${EMOJIS.CROWN} ${curr.name} promoted` : `🔻 ${curr.name} demoted`,
            body: `${formatRole(prev.role)} → ${formatRole(curr.role)}`,
            accent: isPromotion ? COLORS.GOLD : COLORS.BLUE,
            footer: curr.tag,
          })
        );
      }
    }
  }

  // 4. Check for Town Hall level upgrades
  if (webhookUrl && config.notificationsEnabled.thUpgrades) {
    for (const tag of currentTags) {
      const prev = prevTags.has(tag) ? prevMap[tag] : undefined;
      const curr = currentMembersMap[tag];
      if (prev && curr && prev.townHallLevel && curr.townHallLevel && curr.townHallLevel > prev.townHallLevel) {
        cards.push(
          card({
            title: `🏛️ ${curr.name} reached TH${curr.townHallLevel}`,
            body: `Up from TH${prev.townHallLevel}`,
            accent: COLORS.GOLD,
            thumbnail: CocAssetService.getTownHallUrl(curr.townHallLevel),
            footer: curr.tag,
          })
        );
      }
    }
  }

  // Send the poll's events together, as few messages as Discord's limits allow
  if (webhookUrl && cards.length > 0) {
    const links = DiscordService.createActionRow([
      DiscordService.createLinkButton('Open CoC', DiscordService.openGameLink(), '⚔️'),
      DiscordService.createLinkButton('Clash of Stats', DiscordService.clashOfStatsClanLink(currentClan.tag), '📊'),
    ]);
    for (const message of packMessages(cards, [links])) {
      await DiscordService.sendWebhook(webhookUrl, message);
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
