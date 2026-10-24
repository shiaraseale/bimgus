import { Request, Response } from 'express';
import { InteractionResponseType } from 'discord-interactions';
import axios from 'axios';
import { config } from '../../config';
import { CocService } from '../../services/cocService';
import { FirestoreService } from '../../services/firestoreService';
import { getPlayerWithFallback } from '../../services/playerFallback';
import { isDmPaused } from '../../services/upgradeNotifier';
import { LinkedAccount, UserDoc } from '../../types/user';
import { log } from '../../utils/log';

export type CommandContext = ReturnType<typeof createCommandContext>;

/**
 * The shape most commands share (4.2): reply "thinking…", then send one message per linked account
 * (or the one named in the `account` option), with the same error handling for each.
 */
export function forEachLinkedAccount(
  ctx: CommandContext,
  label: string,
  fn: (account: LinkedAccount, index: number) => Promise<void>
) {
  ctx.deferReply();
  ctx.track(async () => {
    try {
      const { accounts, error } = await ctx.getTargetAccounts(ctx.optionsMap['account']);
      if (error || !accounts || accounts.length === 0) {
        await ctx.editDeferredReply({ content: error || 'No linked accounts found.' });
        return;
      }
      for (let idx = 0; idx < accounts.length; idx++) {
        const account = accounts[idx];
        try {
          await fn(account, idx);
        } catch (accountErr: any) {
          log.error(`Failed to load ${label} for ${account.playerTag}:`, accountErr);
          await ctx.sendAccountMessage(idx, {
            content: `❌ Could not load ${label} for **${account.name}** (${account.playerTag}): ${accountErr.message || 'API error'}`,
          });
        }
      }
    } catch (cmdErr: any) {
      log.error(`Failed to execute /${ctx.name}:`, cmdErr);
      await ctx.editDeferredReply({ content: `❌ Error processing request: ${cmdErr.message}` });
    }
  });
}

/**
 * Everything a slash command needs: its options, the user, and how to reply. Inside a Cloud Task
 * replay (`fromTask`), deferring does nothing (the request already replied "thinking…") and an
 * immediate reply edits the deferred one instead.
 */
export function createCommandContext(req: Request, res: Response, fromTask: boolean) {
  const interaction = req.body;
  const { data, member, user } = interaction;
  const discordUser = user || member?.user;
  const discordUserId: string = discordUser?.id;
  const name: string = data.name;
  const optionsMap: Record<string, any> = {};
  for (const opt of Array.isArray(data.options) ? data.options : []) {
    optionsMap[opt.name] = opt.value;
  }

  const cocService = CocService.shared();
  const isGuild = Boolean(interaction.guild_id);
  const interactionToken: string = interaction.token;
  const applicationId: string = interaction.application_id || config.discord.clientId;

  // Runs a command's work after the reply; inside a Cloud Task the task waits for it
  const track = (fn: () => Promise<void>) => {
    const promise = fn();
    if (fromTask) (req as any).work.push(promise);
  };

  // Edits the initial deferred reply with the final content, embeds, and action rows
  const editDeferredReply = async (messageData: any): Promise<boolean> => {
    try {
      const webhookUrl = `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}/messages/@original`;
      await axios.patch(webhookUrl, messageData, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000,
      });
      return true;
    } catch (patchErr: any) {
      log.error(
        '[Discord] Failed to patch deferred reply:',
        JSON.stringify(patchErr.response?.data) || patchErr.message
      );
      return false;
    }
  };

  // Personal command response: if run inside a server channel, make it ephemeral (flags: 64)
  // so it doesn't spam the chat! In private DMs with Bimgus, respond normally.
  const respondPersonal = (messageData: any) => {
    if (fromTask) return editDeferredReply(messageData);
    return res.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        ...(isGuild ? { flags: 64 } : {}),
        ...messageData,
      },
    });
  };

  // Immediately acknowledges the interaction to satisfy Discord's 3-second hard timeout
  const deferReply = (ephemeral: boolean = isGuild) => {
    if (fromTask) return undefined;
    return res.json({
      type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
      data: ephemeral ? { flags: 64 } : {},
    });
  };

  // Sends a follow-up message to the deferred interaction
  const sendFollowup = async (messageData: any) => {
    try {
      const webhookUrl = `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}`;
      await axios.post(
        webhookUrl,
        {
          ...(isGuild ? { flags: 64 } : {}),
          ...messageData,
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 15000,
        }
      );
    } catch (postErr: any) {
      log.error('[Discord] Failed to send follow-up reply:', postErr.response?.data || postErr.message);
    }
  };

  // Set by getTargetAccounts; used to tell the user once that their DMs are paused
  let commandUserDoc: UserDoc | null = null;

  // Sends a message per linked account (edits the initial reply for the first, follows up for the rest)
  const sendAccountMessage = async (index: number, messageData: any) => {
    if (index === 0) {
      if (commandUserDoc && isDmPaused(commandUserDoc) && !commandUserDoc.dmsBlockedNoticeShown) {
        commandUserDoc.dmsBlockedNoticeShown = true;
        await FirestoreService.saveUser(commandUserDoc).catch((err: any) =>
          log.warn(`[Discord] Could not record that the DM-pause notice was shown: ${err.message}`)
        );
        const notice =
          "📭 *Bimgus couldn't DM you (your DMs from this server may be closed), so upgrade DMs are paused for 7 days.*";
        messageData = { ...messageData, content: [notice, messageData.content].filter(Boolean).join('\n') };
      }
      await editDeferredReply(messageData);
    } else {
      await sendFollowup(messageData);
    }
  };

  // All linked accounts, or the one requested with the `account` option (all accounts are equal)
  async function getTargetAccounts(accountTagOption?: string): Promise<{
    userDoc: any;
    accounts: LinkedAccount[];
    error?: string;
  }> {
    if (!discordUserId) return { userDoc: null, accounts: [], error: 'Unable to identify Discord user.' };

    const userDoc = await FirestoreService.getUser(discordUserId);
    commandUserDoc = userDoc;
    if (!userDoc || !userDoc.accounts || userDoc.accounts.length === 0) {
      return {
        userDoc,
        accounts: [],
        error: '⚠️ You have not linked any Clash of Clans accounts yet! Use `/link tag:#PLAYERTAG` first.',
      };
    }

    if (accountTagOption) {
      const clean = config.formatTag(accountTagOption);
      const match = userDoc.accounts.find((a: LinkedAccount) => a.playerTag.toUpperCase() === clean.toUpperCase());
      if (!match) {
        return {
          userDoc,
          accounts: [],
          error: `⚠️ Account with tag \`${clean}\` is not linked. Use \`/accounts\` to see your linked accounts.`,
        };
      }
      return { userDoc, accounts: [match] };
    }

    return { userDoc, accounts: userDoc.accounts };
  }

  return {
    req,
    res,
    fromTask,
    name,
    data,
    optionsMap,
    discordUser,
    discordUserId,
    isGuild,
    interactionToken,
    applicationId,
    cocService,
    track,
    respondPersonal,
    deferReply,
    editDeferredReply,
    sendFollowup,
    sendAccountMessage,
    getTargetAccounts,
    getPlayerWithFallback: (account: LinkedAccount) => getPlayerWithFallback(cocService, account),
  };
}
