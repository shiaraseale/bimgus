import { InteractionResponseType } from 'discord-interactions';
import { FirestoreService } from '../../../services/firestoreService';
import { Village } from '../../../services/gameDataService';
import { VillageImportService } from '../../../services/villageImportService';
import { getVillageJsonTimestampNotice, VillageCard, villageCards } from '../ui';

const PREFIX = 'import_list:';
// Room for the lists across both cards (Discord allows 6,000 characters per message)
const LIST_BUDGET = 5300;

/** The "Full list" button on an import reply: every item still to upgrade in that account's import. */
export function importListButton(playerTag: string, label: string = 'Full list') {
  return {
    type: 2 as const,
    style: 2 as const,
    label,
    custom_id: `${PREFIX}${playerTag}`,
    emoji: { name: '📋' },
  };
}

export function isImportListButton(customId: string): boolean {
  return customId.startsWith(PREFIX);
}

/** Replies (only to the person who pressed it) with the stored import's full list. */
export async function handleImportListButton(customId: string, discordUserId: string) {
  const tag = customId.slice(PREFIX.length);
  const user = await FirestoreService.getUser(discordUserId);
  const account = user?.accounts.find((a) => a.playerTag.toUpperCase() === tag.toUpperCase());
  const village = account ? VillageImportService.read(account.villageData) : null;
  if (!account || !village) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: `⚠️ There's no import stored for \`${tag}\` on your profile.`, flags: 64 },
    };
  }

  // A card per village, each with its lists in full
  const weapon = VillageImportService.weaponFor(village);
  const villages: Village[] = village.builderHallLevel > 0 ? ['home', 'builder'] : ['home'];
  const cards = villages.map((v): VillageCard => {
    const sections = [
      ...(v === 'home' && weapon && weapon.level < weapon.maxLevel
        ? [{ title: '🔥 Town Hall Weapon', lines: [`• **${weapon.name}**: Lv ${weapon.level} → ${weapon.maxLevel}`] }]
        : []),
      ...VillageImportService.importSections(village, v),
    ];
    return {
      village: v,
      hallLevel: v === 'home' ? village.townHallLevel : village.builderHallLevel,
      sections: sections.length > 0 ? sections : [{ title: '✨ All maxed', lines: ['Nothing left to upgrade.'] }],
    };
  });
  cards[0].intro = getVillageJsonTimestampNotice(village) ?? undefined;
  const embeds: any[] = villageCards(cards, LIST_BUDGET);
  embeds[0].author = { name: `[${account.name}] Left to Upgrade` };
  embeds[embeds.length - 1].footer = {
    text: `Account: ${account.name} (${account.playerTag}) • Heroes and the lab are in /upgrades`,
  };

  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { embeds, flags: 64 },
  };
}
