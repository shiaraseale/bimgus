import { config } from '../../../config';
import { FirestoreService } from '../../../services/firestoreService';
import { COLORS } from '../../../services/discordService';
import { CocAssetService } from '../../../services/cocAssetService';
import { LinkedAccount } from '../../../types/user';
import { PlayerTrackingService } from '../../../services/playerTrackingService';
import { log } from '../../../utils/log';
import { CommandContext } from '../context';

/** Slash command definition, registered by scripts/registerCommands.ts */
export const definition = {
  name: 'link',
  description: 'Link your Clash of Clans player account to your Discord profile',
  contexts: [0, 1],
  integration_types: [0],
  options: [
    {
      name: 'tag',
      description: 'Your Clash of Clans player tag (e.g. #ABC123)',
      type: 3, // STRING
      required: true,
    },
    {
      name: 'dms',
      description: 'Receive DMs for upgrades and war rosters (default: true; change later with /dms)',
      type: 5, // BOOLEAN
      required: false,
    },
  ],
};

export const runsAsTask = false;

export async function execute(ctx: CommandContext): Promise<any> {
  const { optionsMap, discordUserId, cocService, respondPersonal } = ctx;
  const tagInput = optionsMap['tag'];
  const dmsOption = optionsMap['dms'];
  const dmsEnabled = dmsOption !== undefined ? Boolean(dmsOption) : true;

  if (!tagInput) {
    return respondPersonal({ content: '⚠️ Please provide a player tag. Example: `/link tag:#ABC123`' });
  }

  const formattedTag = config.formatTag(tagInput);
  try {
    const freshPlayer = await cocService.getPlayer(formattedTag);
    const initialSnapshot = PlayerTrackingService.createSnapshot(freshPlayer);

    const linkedAccount: LinkedAccount = {
      playerTag: freshPlayer.tag,
      name: freshPlayer.name,
      townHallLevel: freshPlayer.townHallLevel,
      builderHallLevel: freshPlayer.builderHallLevel,
      isPrimary: false,
      dmsEnabled,
      lastSnapshot: initialSnapshot,
    };

    const updatedUser = await FirestoreService.linkAccount(discordUserId, linkedAccount);

    return respondPersonal({
      embeds: [
        {
          title: '✅ Account Successfully Linked!',
          description: [
            `**${freshPlayer.name}** (${freshPlayer.tag}) is now linked to your Discord profile!`,
            '',
            `🏰 **Town Hall**: TH${freshPlayer.townHallLevel}`,
            `🔨 **Builder Hall**: BH${freshPlayer.builderHallLevel || 'N/A'}`,
            `🏆 **Trophies**: ${freshPlayer.trophies.toLocaleString()}`,
            `👥 **Total Linked Accounts**: ${updatedUser.accounts.length}`,
            '',
            `🔔 **Automated DMs**: ${dmsEnabled ? 'Enabled ✅ (War roster pings)' : 'Disabled 🔕 (No DMs will be sent)'}`,
            ...(dmsEnabled ? ['*Upgrade DMs start once you run `/import-village` for this account.*'] : []),
          ].join('\n'),
          color: COLORS.GREEN,
          thumbnail: {
            url: CocAssetService.getTownHallUrl(freshPlayer.townHallLevel),
          },
          footer: { text: `Account: ${linkedAccount.name} • Bimgus Tracker` },
          timestamp: new Date().toISOString(),
        },
      ],
    });
  } catch (apiErr: any) {
    if (apiErr.response?.status !== 404) {
      log.warn(`[Link] Player lookup for ${formattedTag} failed: ${apiErr.message}`);
      return respondPersonal({
        content: `⚠️ Bimgus couldn't reach Clash of Clans just now (${apiErr.response?.status === 503 ? 'maintenance' : 'connection problem'}). Please try \`/link\` again in a few minutes.`,
      });
    }
    return respondPersonal({
      content: `❌ Could not find a Clash of Clans account with tag \`${formattedTag}\`. Please check the tag and try again.`,
    });
  }
}
