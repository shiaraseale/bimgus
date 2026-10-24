import { COLORS } from '../../../services/discordService';
import { CocAssetService } from '../../../services/cocAssetService';
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

export async function execute(ctx: CommandContext): Promise<any> {
  const { deferReply, editDeferredReply, getTargetAccounts, track } = ctx;
  deferReply();

  track(async () => {
    try {
      const { accounts, error } = await getTargetAccounts();
      if (error || !accounts || accounts.length === 0) {
        await editDeferredReply({ content: error || 'No accounts linked.' });
        return;
      }

      const accountList = accounts.map((a: LinkedAccount, idx: number) => {
        const dmBadge = a.dmsEnabled === false ? '🔕 DMs Off' : '🔔 DMs On';
        return `${idx + 1}. **${a.name}** (\`${a.playerTag}\`)\n   • Town Hall ${a.townHallLevel} | Builder Hall ${a.builderHallLevel || 'N/A'} | ${dmBadge}`;
      });

      await editDeferredReply({
        embeds: [
          {
            title: '📋 Your Linked Clash of Clans Accounts',
            description: [
              `You have **${accounts.length}** account${accounts.length === 1 ? '' : 's'} linked (all equal status):`,
              '',
              accountList.join('\n\n'),
              '',
              '💡 *All linked accounts are of equal status! Commands like `/heroes`, `/sixth-builder`, and `/upgrades` automatically send an individual message for each of your linked accounts.*',
              '',
              '*To toggle DMs for an account, run `/link tag:#TAG dms:true|false`.*',
            ].join('\n'),
            color: COLORS.DISCORD_BLURPLE,
            thumbnail: {
              url: CocAssetService.getTownHallUrl(accounts[0].townHallLevel),
            },
            footer: { text: 'Bimgus Multi-Account Manager' },
            timestamp: new Date().toISOString(),
          },
        ],
      });
    } catch (accErr: any) {
      await editDeferredReply({ content: `❌ Error loading accounts: ${accErr.message}` });
    }
  });

  return;
}
