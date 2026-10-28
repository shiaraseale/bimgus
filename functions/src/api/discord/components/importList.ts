import { InteractionResponseType } from 'discord-interactions';
import { COLORS } from '../../../services/discordService';
import { FirestoreService } from '../../../services/firestoreService';
import { VillageImportService } from '../../../services/villageImportService';
import { getVillageJsonTimestampNotice } from '../ui';

const PREFIX = 'import_list:';
// Room for the list in one embed (Discord's limit is 6,000 characters, including the title and footer)
const LIST_BUDGET = 5000;

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

  const sections: Array<{ title: string; lines: string[] }> = [];
  const weapon = VillageImportService.weaponFor(village);
  if (weapon && weapon.level < weapon.maxLevel) {
    sections.push({
      title: '🔥 Town Hall Weapon',
      lines: [`• **${weapon.name}**: Lv ${weapon.level} → ${weapon.maxLevel}`],
    });
  }
  sections.push(...VillageImportService.importSections(village));
  const fields = VillageImportService.fitSections(sections, LIST_BUDGET)
    .flatMap((sec) => VillageImportService.linesToFields(sec.title, sec.lines))
    .slice(0, 25);

  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      embeds: [
        {
          title: `📋 [${account.name}] Left to Upgrade`,
          description: getVillageJsonTimestampNotice(village),
          color: COLORS.GOLD,
          fields:
            fields.length > 0
              ? fields
              : [{ name: '✨ All maxed', value: 'Nothing left to upgrade in this export.', inline: false }],
          footer: { text: `Account: ${account.name} (${account.playerTag}) • Heroes and the lab are in /upgrades` },
        },
      ],
      flags: 64,
    },
  };
}
