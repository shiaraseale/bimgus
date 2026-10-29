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
import {
  describeEvent,
  eventsFromImportChanges,
  notifyUpgrades,
  withoutImportedTimers,
} from '../services/upgradeNotifier';
import { InteractionReply, interactionReply } from './interactionReply';
import { importListButton } from '../api/discord/components/importList';
import { CardSection, VillageCard, villageCards } from '../api/discord/ui';
import { Village } from '../services/gameDataService';
import { packMessages, text } from '../services/discordLayout';
import { log } from '../utils/log';
import { discordTime } from '../utils/discordTime';

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
        content: '❌ Failed to read or download the provided file(s). Please check your upload and try again.',
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
        content: `❌ Could not read any village exports:\n${parseErrors.join('\n')}`,
      });
      return;
    }

    // 3. Load user's linked accounts
    const user = task.discordUserId ? await FirestoreService.getUser(task.discordUserId) : null;
    const userAccounts = user?.accounts || [];
    if (!user || userAccounts.length === 0) {
      await reply.edit({
        content: '❌ No linked accounts found. Please `/link` your Clash of Clans account first!',
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
        content:
          `❌ None of the uploaded files could be matched to your linked accounts (${userAccounts.map((a) => a.playerTag).join(', ')}).\n` +
          (unmapped.length > 0 ? `Unmatched: ${unmapped.join(', ')}` : ''),
      });
      return;
    }

    if (unmapped.length > 0) {
      notices.push(`⚠️ These exports didn't match a linked account and were skipped: ${unmapped.join(', ')}`);
    }
    if (parseErrors.length > 0) {
      notices.push(`⚠️ Couldn't read:\n${parseErrors.join('\n')}`);
    }
    const noticeText = notices.join('\n').slice(0, NOTICE_LIMIT);

    // 5. Each export replaces that account's stored data
    const pending: Array<{ account: any; village: VillageDataV2; fileName: string; cards: VillageCard[] }> = [];
    for (const { account, village, fileName } of byAccount.values()) {
      // Compare with what was stored *before* overwriting it
      const previous = VillageImportService.read(account.villageData);
      const changes = VillageImportService.detectImportChanges(previous, village);
      const events = eventsFromImportChanges(changes);

      account.villageData = village;
      account.pendingUpgrades = withoutImportedTimers(account.pendingUpgrades, village);
      if (events.length > 0) await notifyUpgrades(user, account, events);

      // A card per village: what's running and what changed, then what's left in a line. The "Full list"
      // button lists every item, and /upgrades has heroes and the lab
      const weapon = VillageImportService.weaponFor(village);
      const villages: Village[] = village.builderHallLevel > 0 ? ['home', 'builder'] : ['home'];
      const cards = villages.map((v): VillageCard => {
        const sections: CardSection[] = [];
        const running = village.inProgressUpgrades.filter((u) => u.village === v && u.finishesAtMs > Date.now());
        if (running.length > 0) {
          sections.push({
            title: `⏳ Upgrading (${running.length})`,
            lines: VillageImportService.formatInProgressUpgrades(running).split('\n'),
          });
        }
        const changed = events.filter((e) => e.village === v);
        if (changed.length > 0) {
          sections.push({
            title: `🎉 Since Your Last Import (${changed.length})`,
            lines: changed.map((e) => describeEvent(e)),
          });
        }
        const weaponLine =
          v === 'home' && weapon && weapon.level < weapon.maxLevel
            ? [`🔥 **${weapon.name}**: Lv ${weapon.level} → ${weapon.maxLevel}`]
            : [];
        sections.push({
          title: '📋 Left to Upgrade',
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
    // many for one. Each account's last card has its "Full list" button
    const perAccountBudget = Math.floor((MESSAGE_BUDGET - noticeText.length) / Math.max(1, pending.length));
    const accountCards = pending.map(({ account, village, fileName, cards }) => {
      const staleWarning = VillageImportService.isStale(village)
        ? '\n⚠️ *This export is over a day old, so its timers may be out of date. Export again for accurate timers.*'
        : '';
      cards[0].intro = `📄 *Export taken ${discordTime(village.exportTimestamp)}*${staleWarning}`;
      return villageCards(cards, perAccountBudget, {
        author: `[${account.name}] Imported Village`,
        thumbnail: CocAssetService.getTownHallUrl(village.townHallLevel),
        footer: `Account: ${account.name} (${account.playerTag}) • ${fileName}`,
        buttons: [importListButton(account.playerTag, pending.length > 1 ? `Full list: ${account.name}` : 'Full list')],
      });
    });

    // One save for the whole user (all accounts, notified keys and any DM pause)
    await FirestoreService.saveUser(user);

    const messages = packMessages(
      [...(noticeText ? [text(noticeText)] : []), ...accountCards],
      [DiscordService.createActionRow([DiscordService.openGameLinkButton('Open CoC')])]
    );
    const ok = await reply.edit(messages[0]);
    if (!ok) {
      await reply.edit({
        content:
          "✅ Your export was imported, but Bimgus couldn't display the summary. Try `/upgrades` or `/defenses`.",
      });
      return;
    }
    for (const message of messages.slice(1)) await reply.followup(message);
  } catch (importErr: any) {
    log.error('Failed to execute /import-village:', importErr);
    await reply.edit({
      content: `❌ Error importing village data: ${importErr.message || 'Unknown error'}`,
    });
  }
}
