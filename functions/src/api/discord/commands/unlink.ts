import { FirestoreService } from '../../../services/firestoreService';
import { COLORS } from '../../../services/discordService';
import { card, layoutMessage } from '../../../services/discordLayout';
import commandWords from '../../../templates/commands.json';
import { fill, isolate } from '../../../templates';
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

const words = commandWords.unlink;

export async function execute(ctx: CommandContext): Promise<any> {
  const { optionsMap, discordUserId, respondPersonal } = ctx;
  const tagInput = optionsMap['tag'];
  const result = await FirestoreService.unlinkAccount(discordUserId, tagInput);

  if (!result.success) {
    return respondPersonal({
      content: result.needsTag
        ? fill(words.whichOne, { count: result.remainingAccounts })
        : tagInput
          ? fill(words.notFound, { tag: tagInput })
          : words.noAccounts,
    });
  }

  const remainingMsg =
    result.remainingAccounts > 0 ? fill(words.remaining, { count: result.remainingAccounts }) : words.allGone;

  return respondPersonal(
    layoutMessage(
      card({
        accent: COLORS.RED,
        title: words.title,
        body: [
          fill(words.body, {
            name: result.removedName ? isolate(result.removedName) : (result.removedTag || ''),
            tag: result.removedTag || '',
          }),
          '',
          remainingMsg,
        ].join('\n'),
      })
    )
  );
}
