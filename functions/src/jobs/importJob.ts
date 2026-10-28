/**
 * /import-village, run as a Cloud Task (3.7) so it gets full CPU instead of running after the
 * interaction's reply. The interaction handler validates the input, replies "thinking…" and queues this.
 */
import axios from 'axios';
import { config } from '../config';
import { FirestoreService } from '../services/firestoreService';
import { DiscordService, COLORS } from '../services/discordService';
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
import { log } from '../utils/log';
import { discordTime } from '../utils/discordTime';

// Room for the import summary in one message (Discord's limit is 6,000 characters across all embeds),
// and what each account's embed needs besides its fields (title, description, footer)
const MESSAGE_BUDGET = 5700;
const EMBED_OVERHEAD = 450;

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

    // 5. Each export replaces that account's stored data
    const embedsToSend: any[] = [];
    const pending: Array<{
      account: any;
      village: VillageDataV2;
      fileName: string;
      sections: Array<{ title: string; lines: string[] }>;
    }> = [];
    for (const { account, village, fileName } of byAccount.values()) {
      // Compare with what was stored *before* overwriting it
      const previous = VillageImportService.read(account.villageData);
      const changes = VillageImportService.detectImportChanges(previous, village);
      const events = eventsFromImportChanges(changes);

      account.villageData = village;
      account.pendingUpgrades = withoutImportedTimers(account.pendingUpgrades, village);
      if (events.length > 0) await notifyUpgrades(user, account, events);

      // What's running and what changed, then what's left as one line per village; the "Full list"
      // button lists every item, and /upgrades has heroes and the lab
      const sections: Array<{ title: string; lines: string[] }> = [];
      const activeInProg = village.inProgressUpgrades.filter((u) => u.finishesAtMs > Date.now());
      if (activeInProg.length > 0) {
        sections.push({
          title: `⏳ Upgrading (${activeInProg.length})`,
          lines: VillageImportService.formatInProgressUpgrades(activeInProg).split('\n'),
        });
      }
      if (events.length > 0) {
        sections.push({
          title: `🎉 Since Your Last Import (${events.length})`,
          lines: events.map((e) => describeEvent(e)),
        });
      }
      const weapon = VillageImportService.weaponFor(village);
      sections.push({
        title: '📋 Left to Upgrade',
        lines: [
          ...VillageImportService.importSummary(village),
          ...(weapon && weapon.level < weapon.maxLevel
            ? [`🔥 **${weapon.name}**: Lv ${weapon.level} → ${weapon.maxLevel}`]
            : []),
        ],
      });
      pending.push({ account, village, fileName, sections });
    }

    // One message for the whole import: Discord allows 10 embeds and 6,000 characters across them
    const perAccountBudget = Math.floor(MESSAGE_BUDGET / Math.max(1, pending.length)) - EMBED_OVERHEAD;
    for (const { account, village, fileName, sections } of pending) {
      const fitted = VillageImportService.fitSections(sections, perAccountBudget);
      const fields = fitted.flatMap((sec) => VillageImportService.linesToFields(sec.title, sec.lines)).slice(0, 25);
      const staleWarning = VillageImportService.isStale(village)
        ? '\n⚠️ *This export is over a day old, so its timers may be out of date. Export again for accurate timers.*'
        : '';
      embedsToSend.push({
        title: `🛡️ [${account.name}] Imported Village`,
        description: `📄 *Export taken ${discordTime(village.exportTimestamp)}*${staleWarning}`,
        color: COLORS.GOLD,
        thumbnail: { url: CocAssetService.getTownHallUrl(village.townHallLevel) },
        fields,
        footer: { text: `Account: ${account.name} (${account.playerTag}) • ${fileName}` },
        timestamp: new Date().toISOString(),
      });
    }

    // One save for the whole user (all accounts, notified keys and any DM pause)
    await FirestoreService.saveUser(user);

    if (unmapped.length > 0) {
      notices.push(`⚠️ These exports didn't match a linked account and were skipped: ${unmapped.join(', ')}`);
    }
    if (parseErrors.length > 0) {
      notices.push(`⚠️ Couldn't read:\n${parseErrors.join('\n')}`);
    }

    // A "Full list" button per account, then "Open CoC", five to a row (Discord allows five rows)
    const buttons = [
      ...pending.map(({ account }) =>
        importListButton(account.playerTag, pending.length > 1 ? `Full list: ${account.name}` : 'Full list')
      ),
      DiscordService.openGameLinkButton('Open CoC'),
    ];
    const components: any[] = [];
    for (let i = 0; i < buttons.length && components.length < 5; i += 5) {
      components.push(DiscordService.createActionRow(buttons.slice(i, i + 5)));
    }
    const ok = await reply.edit({
      content: notices.join('\n').slice(0, 1900) || undefined,
      embeds: embedsToSend.slice(0, 10),
      components,
    });
    if (!ok) {
      await reply.edit({
        content:
          "✅ Your export was imported, but Bimgus couldn't display the summary. Try `/upgrades` or `/defenses`.",
      });
      return;
    }
  } catch (importErr: any) {
    log.error('Failed to execute /import-village:', importErr);
    await reply.edit({
      content: `❌ Error importing village data: ${importErr.message || 'Unknown error'}`,
    });
  }
}
