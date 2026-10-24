import { COLORS } from '../../../services/discordService';
import { EMOJIS } from '../../../constants/emojis';
import { CommandContext } from '../context';

/** Slash command definition, registered by scripts/registerCommands.ts */
export const definition = {
  name: 'help',
  description: 'Show a list of all available Bimgus commands and how to use them',
  contexts: [0, 1],
  integration_types: [0],
};

export const runsAsTask = false;

export async function execute(ctx: CommandContext): Promise<any> {
  const { respondPersonal } = ctx;
  return respondPersonal({
    embeds: [
      {
        title: '🤖 Bimgus — Clash of Clans Discord Assistant',
        description: 'Hi! I am **Bimgus**, your automated Clash of Clans assistant. I track your accounts, keep you ready for Clan Wars, and deliver personalized insights across all your linked accounts!\n\nHere are all available slash commands:',
        fields: [
          {
            name: '🔥 `/roast [user]`',
            value: 'Tag another member to let Bimgus deliver a witty, personalized Clash of Clans roast in the channel!\n\u200b',
            inline: false,
          },
          {
            name: '🔗 `/link [tag] [dms]`',
            value: 'Link a Clash of Clans account to your Discord profile. All linked accounts have equal status!\n\u200b',
            inline: false,
          },
          {
            name: '🗑️ `/unlink [tag]`',
            value: 'Unlink an account from your Discord profile.\n\u200b',
            inline: false,
          },
          {
            name: '👥 `/accounts`',
            value: 'View all of your linked Clash of Clans accounts (all accounts have equal status).\n\u200b',
            inline: false,
          },
          {
            name: '🔨 `/sixth-builder [account]`',
            value: 'Check your real-time checklist and progress towards unlocking B.O.B (sends a report for each linked account).\n\u200b',
            inline: false,
          },
          {
            name: `${EMOJIS.CROWN} \`/heroes [account] [village]\``,
            value: 'Check your hero levels against max limits (sends a report for each linked account).\n\u200b',
            inline: false,
          },
          {
            name: '🏰 `/upgrades [account]`',
            value: 'View live progression and all outstanding upgrades (sends a report for each linked account).\n\u200b',
            inline: false,
          },
          {
            name: '🛡️ `/defenses [account]`',
            value: 'Check defense max caps, gear-ups, and Hall upgrade status for your Town Hall / Builder Hall.\n\u200b',
            inline: false,
          },
          {
            name: '🧪 `/spells [account]`',
            value: 'Check spell laboratory research remaining to max your current Town Hall.\n\u200b',
            inline: false,
          },
          {
            name: '⚔️ `/troops [account] [village]`',
            value: 'Check troop research upgrades remaining to max your current Town Hall / Builder Hall.\n\u200b',
            inline: false,
          },
          {
            name: '📥 `/import-village [file] [json_text] [account]`',
            value: 'Import your in-game village JSON export to track exact building levels, timers and costs. One export per account; it includes both villages.\n\u200b',
            inline: false,
          },
        ],
        color: COLORS.GOLD,
        thumbnail: {
          url: 'https://raw.githubusercontent.com/ClashKingInc/ClashKingAssets/main/clashofclans/troops/home/barbarian/barbarian.webp',
        },
        footer: { text: 'Type / in any channel or DM Bimgus directly! • Bimgus' },
        timestamp: new Date().toISOString(),
      },
    ],
  });
}
