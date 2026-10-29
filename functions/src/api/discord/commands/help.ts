import { COLORS } from '../../../services/discordService';
import { EMOJIS } from '../../../constants/emojis';
import { card, layoutMessage } from '../../../services/discordLayout';
import { CommandContext } from '../context';

/** Slash command definition, registered by scripts/registerCommands.ts */
export const definition = {
  name: 'help',
  description: 'Show a list of all available Bimgus commands and how to use them',
  contexts: [0, 1],
  integration_types: [0],
};

export const runsAsTask = false;

// The commands in groups, each "**name**" then what it does
const GROUPS: Array<Array<[string, string]>> = [
  [
    [
      '🔗 `/link [tag] [dms]`',
      'Link a Clash of Clans account to your Discord profile. All linked accounts have equal status!',
    ],
    ['🔔 `/dms [on|off] [account]`', 'Turn Bimgus DMs on or off for all your accounts, or just one.'],
    ['🗑️ `/unlink [tag]`', 'Unlink an account from your Discord profile.'],
    ['👥 `/accounts`', 'View all of your linked Clash of Clans accounts (all accounts have equal status).'],
  ],
  [
    [
      '🏰 `/upgrades [account]`',
      "An overview of running timers and what is left, with a menu for each section's full list (one message per linked account).",
    ],
    [
      '🛡️ `/defenses [account]`',
      'Check defense max caps, gear-ups, and Hall upgrade status for your Town Hall / Builder Hall.',
    ],
    [
      `${EMOJIS.CROWN} \`/heroes [account] [village]\``,
      'Check your hero levels against max limits (sends a report for each linked account).',
    ],
    ['🧪 `/spells [account]`', 'Check spell laboratory research remaining to max your current Town Hall.'],
    [
      '⚔️ `/troops [account] [village]`',
      'Check troop research upgrades remaining to max your current Town Hall / Builder Hall.',
    ],
    [
      '🔨 `/sixth-builder [account]`',
      'Check your real-time checklist and progress towards unlocking B.O.B (sends a report for each linked account).',
    ],
    [
      '📥 `/import-village [file] [json_text] [account]`',
      'Import your in-game village JSON export to track exact building levels, timers and costs. One export per account; it includes both villages.',
    ],
  ],
  [
    [
      '🔥 `/roast [user]`',
      'Tag another member to let Bimgus deliver a witty, personalized Clash of Clans roast in the channel!',
    ],
  ],
];

export async function execute(ctx: CommandContext): Promise<any> {
  const { respondPersonal } = ctx;
  return respondPersonal(
    layoutMessage(
      card({
        accent: COLORS.GOLD,
        title: '🤖 Bimgus — Clash of Clans Discord Assistant',
        body: 'Hi! I am **Bimgus**, your automated Clash of Clans assistant. I track your accounts, keep you ready for Clan Wars, and deliver personalized insights across all your linked accounts!\n\nHere are all available slash commands:',
        thumbnail:
          'https://raw.githubusercontent.com/ClashKingInc/ClashKingAssets/main/clashofclans/troops/home/barbarian/barbarian.webp',
        blocks: GROUPS.map((group) => group.map(([name, value]) => `**${name}**\n${value}`).join('\n\n')),
        footer: 'Type / in any channel or DM Bimgus directly!',
      })
    )
  );
}
