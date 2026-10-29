import { FirestoreService } from '../../../services/firestoreService';
import { COLORS } from '../../../services/discordService';
import { card, layoutMessage } from '../../../services/discordLayout';
import { CommandContext } from '../context';

/** Slash command definition, registered by scripts/registerCommands.ts */
export const definition = {
  name: 'dms',
  description: 'Turn Bimgus DMs (upgrade finished, war roster) on or off',
  contexts: [0, 1],
  integration_types: [0],
  options: [
    {
      name: 'setting',
      description: 'On or off',
      type: 3, // STRING
      required: true,
      choices: [
        { name: 'On', value: 'on' },
        { name: 'Off', value: 'off' },
      ],
    },
    {
      name: 'account',
      description: 'Only this account (tag or name); leave empty for all your accounts',
      type: 3, // STRING
      required: false,
    },
  ],
};

export const runsAsTask = false;

export async function execute(ctx: CommandContext): Promise<any> {
  const { optionsMap, discordUserId, respondPersonal } = ctx;
  const enabled = optionsMap['setting'] !== 'off';
  const account: string | undefined = optionsMap['account'] || undefined;

  const changed = await FirestoreService.setDmsEnabled(discordUserId, enabled, account);
  if (!changed) {
    return respondPersonal({
      content: account
        ? `⚠️ Could not find linked account \`${account}\`. Use \`/accounts\` to check your accounts.`
        : '⚠️ You do not have any linked Clash of Clans accounts. Use `/link` first!',
    });
  }

  return respondPersonal(
    layoutMessage(
      card({
        accent: enabled ? COLORS.GREEN : COLORS.RED,
        title: enabled ? '🔔 DMs On' : '🔕 DMs Off',
        body: [
          enabled
            ? 'Bimgus will DM you about finished upgrades and war rosters for:'
            : "Bimgus won't DM you about these accounts any more:",
          ...changed.map((a) => `• **${a.name}** (\`${a.playerTag}\`)`),
          '',
          `*Change it any time with \`/dms ${enabled ? 'off' : 'on'}\`.*`,
        ].join('\n'),
      })
    )
  );
}
