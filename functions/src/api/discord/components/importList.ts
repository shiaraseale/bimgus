import { InteractionResponseType } from 'discord-interactions';
import { FirestoreService } from '../../../services/firestoreService';
import { columnRows, layoutMessage, withFlags } from '../../../services/discordLayout';
import commandWords from '../../../templates/commands.json';
import { fill, isolate } from '../../../templates';
import { Village } from '../../../services/gameDataService';
import { VillageImportService } from '../../../services/villageImportService';
import { getVillageJsonTimestampNotice, VillageCard, villageCards } from '../ui';

const words = commandWords.import;
const PREFIX = 'import_list:';
// Room for the text across both cards (Discord allows 4,000 characters per message)
const LIST_BUDGET = 3700;

/** The "Full list" button on an import reply: every item still to upgrade in that account's import. */
export function importListButton(playerTag: string, label: string = words.fullList) {
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
      data: { content: fill(words.listNoImport, { tag }), flags: 64 },
    };
  }

  // A card per village, each with its lists in full
  const weapon = VillageImportService.weaponFor(village);
  const villages: Village[] = village.builderHallLevel > 0 ? ['home', 'builder'] : ['home'];
  const cards = villages.map((v): VillageCard => {
    const sections = [
      ...(v === 'home' && weapon && weapon.level < weapon.maxLevel
        ? [
            {
              title: words.listWeapon,
              lines: columnRows([{ label: weapon.name, value: `Lv ${weapon.level} → ${weapon.maxLevel}` }]),
            },
          ]
        : []),
      ...VillageImportService.importSections(village, v),
    ];
    return {
      village: v,
      hallLevel: v === 'home' ? village.townHallLevel : village.builderHallLevel,
      sections: sections.length > 0 ? sections : [{ title: words.listAllMaxed, lines: [words.listNothingLeft] }],
    };
  });
  cards[0].intro = getVillageJsonTimestampNotice(village) ?? undefined;
  const shownCards = villageCards(cards, LIST_BUDGET, {
    author: fill(words.listAuthor, { name: isolate(account.name) }),
    footer: fill(words.listFooter, { name: isolate(account.name), tag: account.playerTag }),
  });

  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: withFlags(layoutMessage(...shownCards), true),
  };
}
