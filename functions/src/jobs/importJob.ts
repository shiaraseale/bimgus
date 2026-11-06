/**
 * /import-village, run as a Cloud Task (3.7) so it gets full CPU instead of running after the
 * interaction's reply. The interaction handler validates the input, replies "thinking…" and queues this.
 */
import axios from 'axios';
import { config } from '../config';
import { FirestoreService } from '../services/firestoreService';
import { DiscordService } from '../services/discordService';
import { CocAssetService } from '../services/cocAssetService';
import { VillageDataV2, VillageImportService } from '../services/villageImportService';
import { describeEvent, eventsFromImportChanges } from '../services/upgradeNotifier';
import { InteractionReply, interactionReply } from './interactionReply';
import { importListButton } from '../api/discord/components/importList';
import { CardSection, VillageCard, villageCards } from '../api/discord/ui';
import { Village } from '../services/gameDataService';
import { packMessages, text } from '../services/discordLayout';
import commandWords from '../templates/commands.json';
import shared from '../templates/shared.json';
import { fill, isolate } from '../templates';
import { log } from '../utils/log';
import { discordTime } from '../utils/discordTime';

const words = commandWords.import;

// Room for the import summary's text in one message (Discord allows 4,000 characters per message),
// of which the notices about skipped or unreadable files may use some
const MESSAGE_BUDGET = 3600;
const NOTICE_LIMIT = 800;

export interface ImportTaskData {
  discordUserId: string;
  applicationId: string;
  interactionToken: string;
  isGuild: boolean;
  attachments: Array<{ id: string; url: string; filename?: string }>;
  jsonText?: string;
  targetTag?: string;
}

export async function runImportTask(
  task: ImportTaskData,
  reply: InteractionReply = interactionReply(task)
): Promise<void> {
  try {
    // 1. Download all attachment files
    const rawInputs: Array<{ name: string; raw: string }> = [];
    if (task.jsonText) {
      rawInputs.push({ name: 'pasted_json_text', raw: task.jsonText });
    }

    if (task.attachments.length > 0) {
      const downloaded = await Promise.all(
        task.attachments.map(async (att) => {
          try {
            const res = await axios.get(att.url, { responseType: 'text', timeout: 15000 });
            const raw = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
            return { name: att.filename || att.id, raw };
          } catch (dlErr: any) {
            log.warn(`Failed to download attachment ${att.id}:`, dlErr.message);
            return null;
          }
        })
      );
      for (const d of downloaded) {
        if (d) rawInputs.push(d);
      }
    }

    if (rawInputs.length === 0) {
      await reply.edit({
        content: words.downloadFailed,
      });
      return;
    }

    // 2. Parse every export; each one is a whole account (both villages)
    const parsed: Array<{ fileName: string; village: VillageDataV2 }> = [];
    const parseErrors: string[] = [];
    for (const item of rawInputs) {
      try {
        const json = VillageImportService.parseRawJson(item.raw);
        parsed.push({ fileName: item.name, village: VillageImportService.parseExport(json) });
      } catch (pErr: any) {
        parseErrors.push(`• **${item.name}**: ${pErr.message}`);
      }
    }

    if (parsed.length === 0) {
      await reply.edit({
        content: fill(words.unreadable, { errors: parseErrors.join('\n') }),
      });
      return;
    }

    // 3. Load user's linked accounts
    const user = task.discordUserId ? await FirestoreService.getUser(task.discordUserId) : null;
    const userAccounts = user?.accounts || [];
    if (!user || userAccounts.length === 0) {
      await reply.edit({
        content: words.noAccounts,
      });
      return;
    }

    // 4. Match each export to an account by its tag (newest export wins per account)
    const { byAccount, unmapped, notices } = VillageImportService.matchExportsToAccounts(
      parsed,
      userAccounts,
      task.targetTag ? config.formatTag(task.targetTag) : undefined
    );

    if (byAccount.size === 0) {
      await reply.edit({
        content: fill(unmapped.length > 0 ? words.unmatchedFiles : words.unmatched, {
          tags: userAccounts.map((a) => a.playerTag).join(', '),
          files: unmapped.join(', '),
        }),
      });
      return;
    }

    if (unmapped.length > 0) {
      notices.push(fill(words.skipped, { files: unmapped.join(', ') }));
    }
    if (parseErrors.length > 0) {
      notices.push(fill(words.couldNotRead, { errors: parseErrors.join('\n') }));
    }
    const noticeText = notices.join('\n').slice(0, NOTICE_LIMIT);

    // 5. Each export replaces that account's stored data
    const pending: Array<{ account: any; village: VillageDataV2; fileName: string; cards: VillageCard[] }> = [];
    for (const { account, village, fileName } of byAccount.values()) {
      // Compare with what was stored *before* overwriting it. What changed goes in this reply and not
      // in a DM, which would only repeat it (removed on request, 2026-10-30)
      const previous = VillageImportService.read(account.villageData);
      const changes = VillageImportService.detectImportChanges(previous, village);
      const events = eventsFromImportChanges(changes);

      account.villageData = village;

      // A card per village: what's running and what changed, then what's left in a line. The "Full list"
      // button lists every item, and /status has heroes and the lab
      const weapon = VillageImportService.weaponFor(village);
      const villages: Village[] = village.builderHallLevel > 0 ? ['home', 'builder'] : ['home'];
      const cards = villages.map((v): VillageCard => {
        const sections: CardSection[] = [];
        const running = village.inProgressUpgrades.filter((u) => u.village === v && u.finishesAtMs > Date.now());
        if (running.length > 0) {
          sections.push({
            title: fill(shared.upgrading, { count: running.length }),
            lines: VillageImportService.formatInProgressUpgrades(running).split('\n'),
          });
        }
        const changed = events.filter((e) => e.village === v);
        if (changed.length > 0) {
          sections.push({
            title: fill(words.sinceLastImport, { count: changed.length }),
            lines: changed.map((e) => describeEvent(e)),
          });
        }
        const weaponLine =
          v === 'home' && weapon && weapon.level < weapon.maxLevel
            ? [fill(words.weapon, { name: weapon.name, level: weapon.level, max: weapon.maxLevel })]
            : [];
        sections.push({
          title: shared.leftToUpgrade,
          lines: [VillageImportService.importSummary(village, v), ...weaponLine],
        });
        return {
          village: v,
          hallLevel: v === 'home' ? village.townHallLevel : village.builderHallLevel,
          sections,
        };
      });
      pending.push({ account, village, fileName, cards });
    }

    // The import's cards share one message's text, and spread over more messages if there are too
    // many for one. Each account's last card has its "Full list" button, and each message's "Open CoC"
    const perAccountBudget = Math.floor((MESSAGE_BUDGET - noticeText.length) / Math.max(1, pending.length));
    const accountCards = pending.map(({ account, village, fileName, cards }) => {
      const staleWarning = VillageImportService.isStale(village) ? words.stale : '';
      cards[0].intro = fill(words.exportTaken, { time: discordTime(village.exportTimestamp), stale: staleWarning });
      return villageCards(cards, perAccountBudget, {
        author: fill(words.author, { name: isolate(account.name) }),
        thumbnail: CocAssetService.getTownHallUrl(village.townHallLevel),
        footer: fill(words.footer, { name: isolate(account.name), tag: account.playerTag, file: fileName }),
        buttons: [
          importListButton(
            account.playerTag,
            pending.length > 1 ? fill(words.fullListFor, { name: isolate(account.name) }) : words.fullList
          ),
        ],
      });
    });

    // One save for the whole user (all accounts)
    await FirestoreService.saveUser(user);

    const messages = packMessages(
      [...(noticeText ? [text(noticeText)] : []), ...accountCards],
      [DiscordService.openGameLinkButton()]
    );
    const ok = await reply.edit(messages[0]);
    if (!ok) {
      await reply.edit({
        content: words.notDisplayed,
      });
      return;
    }
    for (const message of messages.slice(1)) await reply.followup(message);
  } catch (importErr: any) {
    log.error('Failed to execute /import-village:', importErr);
    await reply.edit({
      content: fill(words.failed, { reason: importErr.message || words.unknownError }),
    });
  }
}
