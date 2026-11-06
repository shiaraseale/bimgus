import { COLORS } from '../../../services/discordService';
import { CocAssetService } from '../../../services/cocAssetService';
import { card, layoutMessage } from '../../../services/discordLayout';
import commandWords from '../../../templates/commands.json';
import { fill, isolate } from '../../../templates';
import { LinkedAccount } from '../../../types/user';
import { CommandContext } from '../context';

/** Slash command definition, registered by scripts/registerCommands.ts */
export const definition = {
  name: 'accounts',
  description: 'View and manage your linked Clash of Clans accounts (multi-account support)',
  contexts: [0, 1],
  integration_types: [0],
};

// Runs as a Cloud Task (3.7): its work happens after the "thinking…" reply
export const runsAsTask = true;

const words = commandWords.accounts;

export async function execute(ctx: CommandContext): Promise<any> {
  const { deferReply, editDeferredReply, getTargetAccounts, track } = ctx;
  deferReply();

  track(async () => {
    try {
      const { accounts, error } = await getTargetAccounts();
      if (error || !accounts || accounts.length === 0) {
        await editDeferredReply({ content: error || words.none });
        return;
      }

      const accountList = accounts.map((a: LinkedAccount, idx: number) => {
        return fill(words.row, {
          index: idx + 1,
          name: isolate(a.name),
          tag: a.playerTag,
          th: a.townHallLevel,
          bh: a.builderHallLevel || words.noBuilderHall,
          dms: a.dmsEnabled === false ? words.dmsOff : words.dmsOn,
        });
      });

      await editDeferredReply(
        layoutMessage(
          card({
            accent: COLORS.DISCORD_BLURPLE,
            title: words.title,
            body: [
              fill(words.intro, { count: accounts.length, accounts: accounts.length === 1 ? 'account' : 'accounts' }),
              '',
              accountList.join('\n\n'),
              '',
              words.tip,
              '',
              words.dmsTip,
            ].join('\n'),
            thumbnail: CocAssetService.getTownHallUrl(accounts[0].townHallLevel),
          })
        )
      );
    } catch (accErr: any) {
      await editDeferredReply({ content: fill(words.failed, { reason: accErr.message }) });
    }
  });

  return;
}
