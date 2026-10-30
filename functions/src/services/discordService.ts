import { config } from '../config';
import axios from 'axios';
import { DiscordWebhookPayload } from '../types/discord';
import { EMOJIS } from '../constants/emojis';
import { log } from '../utils/log';
import { card, layoutMessage, overLimits } from './discordLayout';

export const COLORS = {
  GOLD: 0xffd700,
  GREEN: 0x2ecc71,
  RED: 0xe74c3c,
  BLUE: 0x3498db,
  PURPLE: 0x9b59b6,
  DISCORD_BLURPLE: 0x5865f2,
};

export class DiscordService {
  // Webhook ID -> channel ID, filled in as each webhook's channel is looked up
  private static webhookToChannelMap: Record<string, string> = {};

  /**
   * Resolves a target string (channel ID or webhook URL) to a Discord channel ID.
   */
  static async resolveChannelId(target: string): Promise<string | null> {
    if (!target) return null;
    const clean = target.trim();
    if (/^\d{17,20}$/.test(clean)) {
      return clean;
    }
    const match = clean.match(/discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/(\d+)\/([\w-]+)/);
    if (match) {
      const [, webhookId, webhookToken] = match;
      if (this.webhookToChannelMap[webhookId]) {
        return this.webhookToChannelMap[webhookId];
      }
      try {
        // With the token in the path no authorisation is needed. Without a channel the message falls
        // back to the webhook, which can't show the bot's application emojis.
        const res = await axios.get(`https://discord.com/api/v10/webhooks/${webhookId}/${webhookToken}`, {
          timeout: 8000,
        });
        if (res.data?.channel_id) {
          this.webhookToChannelMap[webhookId] = res.data.channel_id;
          return res.data.channel_id;
        }
      } catch (err: any) {
        // Falls back to posting through the webhook URL
        log.warn(`[DiscordService] Could not look up the webhook's channel (${err.message})`);
      }
    }
    return null;
  }

  /**
   * Dispatches a message to a Discord channel directly from the official Bimgus bot,
   * falling back to webhook execution if needed.
   */
  static async sendWebhook(target: string, payload: DiscordWebhookPayload, retries = 3): Promise<boolean> {
    if (!target) return false;
    this.warnIfOverLimits(payload);

    if (config.dryRunDiscord) {
      const sanitizedTarget = target.replace(
        /(discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/\d+\/)[^/?\s]+/i,
        '$1[REDACTED]'
      );
      log.info(
        `[DiscordService DRY_RUN] Would send webhook to target "${sanitizedTarget}":`,
        JSON.stringify(payload, null, 2)
      );
      return true;
    }

    const botToken = config.discord.botToken;

    // 1. Send directly from the official Bimgus Discord Bot
    if (botToken) {
      const channelId = await this.resolveChannelId(target);
      if (channelId) {
        try {
          await axios.post(`https://discord.com/api/v10/channels/${channelId}/messages`, this.messageBody(payload), {
            headers: {
              Authorization: `Bot ${botToken}`,
              'Content-Type': 'application/json',
            },
            timeout: 8000,
          });
          return true;
        } catch (botErr: any) {
          if (botErr.response?.status === 429 && retries > 0) {
            const retryAfter = (botErr.response.data?.retry_after || 1) * 1000;
            log.warn(`[DiscordService] Bot rate limited. Waiting ${retryAfter}ms before retry...`);
            await new Promise((resolve) => setTimeout(resolve, retryAfter + 100));
            return this.sendWebhook(target, payload, retries - 1);
          }
          log.warn(`[DiscordService] Direct bot message failed (${botErr.message}). Falling back to webhook URL...`);
        }
      }
    }

    // 2. Fallback to Webhook URL if bot token is not available or direct post failed
    if (target.startsWith('http')) {
      try {
        let url = target;
        if (payload.components && payload.components.length > 0) {
          url += (url.includes('?') ? '&' : '?') + 'with_components=true';
        }

        await axios.post(url, {
          username: payload.username || 'Bimgus',
          avatar_url: payload.avatar_url,
          ...payload,
        });
        return true;
      } catch (err: any) {
        if (err.response?.status === 429 && retries > 0) {
          const retryAfter = (err.response.data?.retry_after || 1) * 1000;
          log.warn(`Discord rate limited. Waiting ${retryAfter}ms before retry...`);
          await new Promise((resolve) => setTimeout(resolve, retryAfter + 100));
          return this.sendWebhook(target, payload, retries - 1);
        }
        log.error(`Failed to send Discord message: ${err.message}`, err.response?.data);
        return false;
      }
    }

    return false;
  }

  // The fields a bot message sends (a webhook payload also has a username and avatar)
  private static messageBody(payload: DiscordWebhookPayload) {
    const components = payload.components && payload.components.length > 0 ? payload.components : undefined;
    return {
      content: payload.content,
      embeds: payload.embeds,
      components,
      flags: payload.flags,
      allowed_mentions: payload.allowed_mentions,
    };
  }

  // Discord refuses a layout over its limits, so say which message it was (staging's dry run too)
  private static warnIfOverLimits(payload: DiscordWebhookPayload) {
    const over = overLimits(payload);
    if (over) log.warn(`[DiscordService] Message over Discord's limits: ${over}`);
  }

  /**
   * Helper to format star strings: 1 -> ⭐, 2 -> ⭐⭐, 3 -> ⭐⭐⭐
   */
  static formatStars(stars: number): string {
    return EMOJIS.STAR.repeat(Math.max(0, Math.min(3, stars))) + '☆'.repeat(Math.max(0, 3 - stars));
  }

  /**
   * Cleans a clan or player tag for URLs (e.g. "#ABC123" -> "ABC123").
   */
  static cleanTag(tag: string): string {
    return tag.replace(/^#/, '').toUpperCase();
  }

  /**
   * Universal link that opens the Clash of Clans app directly.
   */
  static openGameLink(): string {
    return 'https://link.clashofclans.com/en/';
  }

  /**
   * Creates an in-game deep link opening the clan profile in Clash of Clans.
   * From here, players can directly tap the War map or Clan Capital.
   */
  static clanDeepLink(tag: string): string {
    return `https://link.clashofclans.com/en?action=OpenClanProfile&tag=${this.cleanTag(tag)}`;
  }

  /**
   * Creates a Clash of Stats link for current war data.
   */
  static clashOfStatsWarLink(tag: string): string {
    return `https://www.clashofstats.com/clans/${this.cleanTag(tag)}/wars/current/`;
  }

  /**
   * Creates a Clash of Stats link for the clan profile.
   */
  static clashOfStatsClanLink(tag: string): string {
    return `https://www.clashofstats.com/clans/${this.cleanTag(tag)}/`;
  }

  /**
   * Creates a Link Button component.
   */
  static createLinkButton(label: string, url: string, emojiName?: string) {
    return {
      type: 2 as const,
      style: 5 as const,
      label,
      url,
      ...(emojiName ? { emoji: { name: emojiName } } : {}),
    };
  }

  /**
   * Creates an Action Row wrapping multiple buttons.
   */
  static createActionRow<B extends { type: 2 }>(buttons: B[]) {
    return {
      type: 1 as const,
      components: buttons,
    };
  }

  /**
   * Standard action row for Wars and CWL (Matchups, Live Attacks, Audits).
   */
  static warActionRow(clanTag: string, opponentTag?: string) {
    const buttons = [
      this.createLinkButton('Open CoC', this.openGameLink(), '⚔️'),
      this.createLinkButton('Clash of Stats', this.clashOfStatsWarLink(clanTag), '📊'),
    ];
    if (opponentTag) {
      buttons.push(this.createLinkButton('Enemy Clan', this.clanDeepLink(opponentTag), '🛡️'));
    }
    return this.createActionRow(buttons);
  }

  /** What the dashboard's "Test webhook" posts: the same kind of card as the channel's real messages. */
  static webhookTestMessage(channelName: string): DiscordWebhookPayload {
    return layoutMessage(
      card({
        accent: COLORS.GREEN,
        title: '✅ Webhook works',
        body: `This channel will get Bimgus's **${channelName}** messages.`,
      })
    );
  }

  /**
   * Action row for War / CWL pending attack reminders.
   */
  static warReminderActionRow(clanTag: string) {
    return this.createActionRow([
      this.createLinkButton('Open CoC', this.openGameLink(), '⚔️'),
      this.createLinkButton('Live War Map', this.clashOfStatsWarLink(clanTag), '📊'),
    ]);
  }

  /**
   * Action row for Clan Capital Raid Weekend notifications.
   */
  static raidActionRow(clanTag: string, enemyClanTag?: string) {
    const buttons = [
      this.createLinkButton('Open CoC', this.openGameLink(), '⚔️'),
      this.createLinkButton('Clash of Stats', this.clashOfStatsClanLink(clanTag), '📊'),
    ];
    if (enemyClanTag) {
      buttons.push(this.createLinkButton('Enemy Clan', this.clanDeepLink(enemyClanTag), '🛡️'));
    }
    return this.createActionRow(buttons);
  }

  /**
   * Action row for Clan Games notifications.
   */
  static clanGamesActionRow(clanTag: string) {
    return this.createActionRow([
      this.createLinkButton('Open CoC', this.openGameLink(), '🎯'),
      this.createLinkButton('Clash of Stats', this.clashOfStatsClanLink(clanTag), '📊'),
    ]);
  }

  /**
   * Standard button to open the Clash of Clans app directly.
   */
  static openGameLinkButton(label: string = 'Open CoC') {
    return this.createLinkButton(label, this.openGameLink(), '⚔️');
  }

  /**
   * Sends a Direct Message to a Discord user using the Bot Token via Discord REST API.
   */
  static async sendDm(
    discordUserId: string,
    payload: DiscordWebhookPayload,
    botTokenOverride?: string,
    retries = 2
  ): Promise<boolean> {
    return (await this.sendDmResult(discordUserId, payload, botTokenOverride, retries)) === 'sent';
  }

  /**
   * Like sendDm, but says why a DM wasn't sent. 'blocked' means the user doesn't accept DMs from
   * the bot (Discord error 50007), which retrying won't fix, so it's logged as a warning, not an error.
   */
  static async sendDmResult(
    discordUserId: string,
    payload: DiscordWebhookPayload,
    botTokenOverride?: string,
    retries = 2
  ): Promise<'sent' | 'blocked' | 'failed'> {
    this.warnIfOverLimits(payload);
    if (config.dryRunDiscord) {
      log.info(`[Discord DM DRY_RUN] Would send DM to user "${discordUserId}":`, JSON.stringify(payload, null, 2));
      return 'sent';
    }

    const token = botTokenOverride || config.discord.botToken;
    if (!token) {
      log.warn('[Discord DM] Skipping DM: No DISCORD_BOT_TOKEN configured');
      return 'failed';
    }

    const headers = {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
    };

    try {
      // 1. Open or retrieve direct message channel with user
      const channelRes = await axios.post(
        'https://discord.com/api/v10/users/@me/channels',
        { recipient_id: discordUserId },
        { headers, timeout: 8000 }
      );
      const dmChannelId = channelRes.data.id;

      // 2. Send message into DM channel
      await axios.post(`https://discord.com/api/v10/channels/${dmChannelId}/messages`, this.messageBody(payload), {
        headers,
        timeout: 8000,
      });

      log.info(`[Discord DM] Successfully sent DM to user ${discordUserId}`);
      return 'sent';
    } catch (err: any) {
      if (err.response?.status === 429 && retries > 0) {
        const retryAfter = (err.response.data?.retry_after || 1) * 1000;
        log.warn(`[Discord DM] Rate limited. Waiting ${retryAfter}ms before retry...`);
        await new Promise((resolve) => setTimeout(resolve, retryAfter + 100));
        return this.sendDmResult(discordUserId, payload, token, retries - 1);
      }
      if (err.response?.data?.code === 50007) {
        log.warn(`[Discord DM] User ${discordUserId} doesn't accept DMs from the bot (50007)`);
        return 'blocked';
      }
      log.error(`[Discord DM] Failed to send DM to ${discordUserId}: ${err.message}`, err.response?.data);
      return 'failed';
    }
  }
}
