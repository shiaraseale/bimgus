import { ClanMember, ClanResponse } from '../types/coc';
import { ClanSnapshotDoc, BotConfigDoc } from '../types/db';
import { DiscordService, COLORS } from '../services/discordService';
import { DiscordContainerComponent } from '../types/discord';
import { card, packMessages } from '../services/discordLayout';
import { CocAssetService } from '../services/cocAssetService';
import words from '../templates/clan.json';
import shared from '../templates/shared.json';
import { fill } from '../templates';

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
            title: fill(words.joined.title, { name: joined.name }),
            body: fill(words.joined.body, {
              trophies: joined.trophies.toLocaleString(),
              role: formatRole(joined.role),
            }),
            accent: COLORS.GREEN,
            thumbnail: joined.league?.iconUrls?.small,
            footer: fill(words.joined.footer, { tag: joined.tag, members: currentClan.members }),
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
            title: fill(words.left.title, { name: left.name }),
            body: fill(words.left.body, { role: formatRole(left.role), trophies: left.trophies.toLocaleString() }),
            accent: COLORS.RED,
            footer: fill(words.left.footer, { tag: left.tag, members: currentClan.members }),
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
        const change = isPromotion ? words.promoted : words.demoted;
        cards.push(
          card({
            title: fill(change.title, { name: curr.name }),
            body: fill(change.body, { from: formatRole(prev.role), to: formatRole(curr.role) }),
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
            title: fill(words.townHall.title, { name: curr.name, level: curr.townHallLevel }),
            body: words.townHall.body,
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
    const links = [
      DiscordService.openGameLinkButton(),
      DiscordService.createLinkButton(
        shared.buttons.clashOfStats,
        DiscordService.clashOfStatsClanLink(currentClan.tag),
        '📊'
      ),
    ];
    for (const message of packMessages(cards, links)) {
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
  return words.roles[role as keyof typeof words.roles] ?? words.roles.member;
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
