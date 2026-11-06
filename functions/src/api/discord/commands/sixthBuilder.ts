import { DiscordService, COLORS } from '../../../services/discordService';
import { CocAssetService } from '../../../services/cocAssetService';
import { PlayerTrackingService } from '../../../services/playerTrackingService';
import { VillageImportService } from '../../../services/villageImportService';
import { card, layoutMessage } from '../../../services/discordLayout';
import commandWords from '../../../templates/commands.json';
import shared from '../../../templates/shared.json';
import { accountFooter, fill, isolate } from '../../../templates';
import { DiscordButtonComponent } from '../../../types/discord';
import { bobDefenseButton } from '../components/bobDefense';
import { CommandContext, forEachLinkedAccount } from '../context';
import { formatProgressBar, getVillageJsonTimestampNotice } from '../ui';

/** Slash command definition, registered by scripts/registerCommands.ts */
export const definition = {
  name: 'sixth-builder',
  description: 'Check how close you are to unlocking the 6th Builder (B.O.B)',
  contexts: [0, 1],
  integration_types: [0],
  options: [
    {
      name: 'account',
      description: 'Specific player tag to check (leave blank for all linked accounts)',
      type: 3, // STRING
      required: false,
    },
  ],
};

// Runs as a Cloud Task (3.7): its work happens after the "thinking…" reply
export const runsAsTask = true;

const words = commandWords.sixthBuilder;

export async function execute(ctx: CommandContext): Promise<any> {
  const { sendAccountMessage, getPlayerWithFallback } = ctx;
  return forEachLinkedAccount(ctx, '6th Builder data', async (account, idx) => {
    const { player: freshPlayer, isCached } = await getPlayerWithFallback(account);
    const village = VillageImportService.read(account.villageData);
    const bob = PlayerTrackingService.calculateSixthBuilderProgress(
      freshPlayer,
      village,
      account.bobDefenseCompleted || false
    );

    const task = (template: string, t: { completed: boolean; current: number; target: number }) =>
      fill(template, { mark: t.completed ? words.done : words.todo, current: t.current, target: t.target });

    const statusBanner = bob.unlocked
      ? words.unlocked
      : fill(words.progress, { bar: formatProgressBar(bob.overallPercentage) });

    const bbJsonNotice =
      village && village.builderHallLevel > 0 ? getVillageJsonTimestampNotice(village, words.exportPrefix) : null;

    const bobButtons: DiscordButtonComponent[] = [];
    if ((freshPlayer.builderHallLevel || 0) >= 1) {
      const toggleBtn = bobDefenseButton(account.playerTag, bob.tasks.bbDefenseLv9.completed);
      bobButtons.push(toggleBtn);
    }
    bobButtons.push(DiscordService.openGameLinkButton());

    const message = layoutMessage(
      card({
        accent: bob.unlocked ? COLORS.GOLD : COLORS.BLUE,
        title: fill(words.title, { name: isolate(account.name) }),
        body: [isCached ? shared.maintenance : '', statusBanner, bbJsonNotice ?? ''].filter(Boolean).join('\n'),
        thumbnail: CocAssetService.getBobUrl(
          bob.unlocked ? 4 : Object.values(bob.tasks).filter((t: any) => t.completed).length
        ),
        blocks: [
          [
            task(words.gearUps, bob.tasks.gearUps),
            `   ${bob.tasks.gearUps.description}`,
            '',
            task(words.troop, bob.tasks.bbTroopLv18),
            `   ${bob.tasks.bbTroopLv18.description}`,
            '',
            task(words.defense, bob.tasks.bbDefenseLv9),
            `   ${bob.tasks.bbDefenseLv9.description}`,
            '',
            task(words.heroes, bob.tasks.bbHeroesLv45),
            `   ${bob.tasks.bbHeroesLv45.description}`,
          ].join('\n'),
        ],
        footer: accountFooter(account),
        buttons: bobButtons,
      })
    );

    await sendAccountMessage(idx, message);
  });
}
