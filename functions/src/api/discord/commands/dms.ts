import { FirestoreService } from '../../../services/firestoreService';
import { COLORS } from '../../../services/discordService';
import { card, layoutMessage } from '../../../services/discordLayout';
import commandWords from '../../../templates/commands.json';
import { fill } from '../../../templates';
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

const words = commandWords.dms;

export async function execute(ctx: CommandContext): Promise<any> {
  const { optionsMap, discordUserId, respondPersonal } = ctx;
  const enabled = optionsMap['setting'] !== 'off';
  const account: string | undefined = optionsMap['account'] || undefined;

  const changed = await FirestoreService.setDmsEnabled(discordUserId, enabled, account);
  if (!changed) {
    return respondPersonal({
      content: account ? fill(words.notFound, { tag: account }) : words.noAccounts,
    });
  }

  return respondPersonal(
    layoutMessage(
      card({
        accent: enabled ? COLORS.GREEN : COLORS.RED,
        title: enabled ? words.onTitle : words.offTitle,
        body: [
          enabled ? words.onIntro : words.offIntro,
          ...changed.map((a) => fill(words.row, { name: a.name, tag: a.playerTag })),
          '',
          fill(words.changeTip, { setting: enabled ? 'off' : 'on' }),
        ].join('\n'),
      })
    )
  );
}
