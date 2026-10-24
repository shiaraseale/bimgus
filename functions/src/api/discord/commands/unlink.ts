import { FirestoreService } from '../../../services/firestoreService';
import { COLORS } from '../../../services/discordService';
import { CommandContext } from '../context';

/** Slash command definition, registered by scripts/registerCommands.ts */
export const definition = {
  name: 'unlink',
  description: 'Unlink a Clash of Clans account from your Discord profile and stop tracking',
  contexts: [0, 1],
  integration_types: [0],
  options: [
    {
      name: 'tag',
      description: 'Specific player tag to unlink (only needed if you have more than one)',
      type: 3, // STRING
      required: false,
    },
  ],
};

export const runsAsTask = false;

export async function execute(ctx: CommandContext): Promise<any> {
  const { optionsMap, discordUserId, respondPersonal } = ctx;
  const tagInput = optionsMap['tag'];
  const result = await FirestoreService.unlinkAccount(discordUserId, tagInput);

  if (!result.success) {
    return respondPersonal({
      content: result.needsTag
        ? `⚠️ You have ${result.remainingAccounts} linked accounts, so please say which one: \`/unlink tag:#TAG\`. Use \`/accounts\` to see them.`
        : tagInput
        ? `⚠️ Could not find linked account \`${tagInput}\` under your Discord profile. Use \`/accounts\` to check your accounts.`
        : `⚠️ You do not have any linked Clash of Clans accounts to unlink. Use \`/link\` first!`,
    });
  }

  const remainingMsg = result.remainingAccounts > 0
    ? `You have **${result.remainingAccounts}** linked account(s) remaining. Use \`/accounts\` to view them.`
    : `You have unlinked all accounts. Automatic upgrade tracking and war roster DMs have been turned off for your profile.`;

  return respondPersonal({
    embeds: [
      {
        title: '🗑️ Account Unlinked Successfully',
        description: [
          `**${result.removedName || result.removedTag}** (\`${result.removedTag}\`) has been unlinked from your Discord profile.`,
          '',
          remainingMsg,
        ].join('\n'),
        color: COLORS.RED,
        footer: { text: 'Bimgus Account Manager' },
        timestamp: new Date().toISOString(),
      },
    ],
  });
}
