import { ImportTaskData, runImportTask } from '../../../jobs/importJob';
import { CommandContext } from '../context';
import { queueTask } from '../tasks';

/** Slash command definition, registered by scripts/registerCommands.ts */
export const definition = {
  name: 'import-village',
  description: 'Import your village JSON export (one per account; it includes both villages)',
  contexts: [0, 1],
  integration_types: [0],
  options: [
    {
      name: 'file',
      description: 'Village JSON export (one file covers both villages of an account)',
      type: 11, // ATTACHMENT
      required: false,
    },
    {
      name: 'file2',
      description: 'Export for another account (optional)',
      type: 11, // ATTACHMENT
      required: false,
    },
    {
      name: 'file3',
      description: 'Export for another account (optional)',
      type: 11, // ATTACHMENT
      required: false,
    },
    {
      name: 'file4',
      description: 'Export for another account (optional)',
      type: 11, // ATTACHMENT
      required: false,
    },
    {
      name: 'file5',
      description: 'Export for another account (optional)',
      type: 11, // ATTACHMENT
      required: false,
    },
    {
      name: 'file6',
      description: 'Export for another account (optional)',
      type: 11, // ATTACHMENT
      required: false,
    },
    {
      name: 'json_text',
      description: 'Or paste village JSON export text directly',
      type: 3, // STRING
      required: false,
    },
    {
      name: 'account',
      description: 'Specific player tag to link this export to (optional, defaults to matched tag)',
      type: 3, // STRING
      required: false,
    },
  ],
};

export const runsAsTask = false;

export async function execute(ctx: CommandContext): Promise<any> {
  const { optionsMap, data, discordUserId, isGuild, applicationId, interactionToken, respondPersonal, deferReply } =
    ctx;
  const jsonText = optionsMap['json_text'];
  const targetTag = optionsMap['account'];

  // Gather all attachments from file, file2, file3, file4, file5, file6, and resolved
  const resolvedAttachments = data.resolved?.attachments || {};
  const attachmentIds: string[] = [];
  for (const optKey of ['file', 'file2', 'file3', 'file4', 'file5', 'file6']) {
    if (optionsMap[optKey] && !attachmentIds.includes(optionsMap[optKey])) {
      attachmentIds.push(optionsMap[optKey]);
    }
  }
  for (const attId of Object.keys(resolvedAttachments)) {
    if (!attachmentIds.includes(attId)) {
      attachmentIds.push(attId);
    }
  }

  const attachments = attachmentIds.map((id) => resolvedAttachments[id]).filter((att) => att && att.url);

  if (attachments.length === 0 && !jsonText) {
    return respondPersonal({
      content:
        '⚠️ **Please provide your village JSON export!**\n\n' +
        '• **One export per account; it includes both your Home Village and Builder Base.**\n' +
        '• Attach up to 6 `.json` files at once if you have several accounts, or paste one export into the `json_text` option.\n\n' +
        '📖 **How to export from Clash of Clans:**\n' +
        '1. Open Clash of Clans ➔ Tap **Settings** ⚙️\n' +
        '2. Tap **More Settings**\n' +
        '3. Scroll to the bottom to **Data Export**\n' +
        '4. Tap **Copy** next to *"Export village data in JSON format"*',
    });
  }

  const importTask: ImportTaskData = {
    discordUserId,
    applicationId,
    interactionToken,
    isGuild,
    attachments: attachments.map((a: any) => ({ id: a.id, url: a.url, filename: a.filename })),
    ...(jsonText ? { jsonText } : {}),
    ...(targetTag ? { targetTag } : {}),
  };
  const queued = await queueTask('importTask', importTask);
  deferReply();
  if (!queued) void runImportTask(importTask);
  return;
}
