import { config } from '../../../config';
import { FirestoreService } from '../../../services/firestoreService';
import { COLORS } from '../../../services/discordService';
import { CocAssetService } from '../../../services/cocAssetService';
import { card, layoutMessage } from '../../../services/discordLayout';
import commandWords from '../../../templates/commands.json';
import { fill, isolate } from '../../../templates';
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

const words = commandWords.link;

export async function execute(ctx: CommandContext): Promise<any> {
  const { optionsMap, discordUserId, cocService, respondPersonal } = ctx;
  const tagInput = optionsMap['tag'];
  const dmsOption = optionsMap['dms'];
  const dmsEnabled = dmsOption !== undefined ? Boolean(dmsOption) : true;

  if (!tagInput) {
    return respondPersonal({ content: words.missingTag });
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

    return respondPersonal(
      layoutMessage(
        card({
          accent: COLORS.GREEN,
          title: words.title,
          body: [
            fill(words.intro, { name: isolate(freshPlayer.name), tag: freshPlayer.tag }),
            '',
            fill(words.townHall, { level: freshPlayer.townHallLevel }),
            fill(words.builderHall, { level: freshPlayer.builderHallLevel || words.noBuilderHall }),
            fill(words.trophies, { trophies: freshPlayer.trophies.toLocaleString() }),
            fill(words.total, { count: updatedUser.accounts.length }),
            '',
            dmsEnabled ? words.dmsOn : words.dmsOff,
            ...(dmsEnabled ? [words.dmsTip] : []),
          ].join('\n'),
          thumbnail: CocAssetService.getTownHallUrl(freshPlayer.townHallLevel),
          footer: fill(words.footer, { name: isolate(linkedAccount.name) }),
        })
      )
    );
  } catch (apiErr: any) {
    if (apiErr.response?.status !== 404) {
      log.warn(`[Link] Player lookup for ${formattedTag} failed: ${apiErr.message}`);
      return respondPersonal({
        content: fill(words.unreachable, {
          reason: apiErr.response?.status === 503 ? words.maintenance : words.connectionProblem,
        }),
      });
    }
    return respondPersonal({
      content: fill(words.notFound, { tag: formattedTag }),
    });
  }
}
