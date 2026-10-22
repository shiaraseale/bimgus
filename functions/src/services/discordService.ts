import axios from 'axios';
import { DiscordWebhookPayload } from '../types/discord';
import { EMOJIS } from '../constants/emojis';

export const COLORS = {
  GOLD: 0xFFD700,
  GREEN: 0x2ECC71,
  RED: 0xE74C3C,
  BLUE: 0x3498DB,
  PURPLE: 0x9B59B6,
  DISCORD_BLURPLE: 0x5865F2,
};

export class DiscordService {
  private static webhookToChannelMap: Record<string, string> = {
    '123456789012345678': '123456789012345678', // 🤖-clan-log
    '123456789012345678': '123456789012345678', // 🤖-war-room
    '123456789012345678': '123456789012345678', // 🤖-cwl-hub
    '123456789012345678': '123456789012345678', // 🤖-raid-weekend
    '123456789012345678': '123456789012345678', // 🤖-clan-games
  };

  /**
   * Resolves a target string (channel ID or webhook URL) to a Discord channel ID.
   */
  static async resolveChannelId(target: string): Promise<string | null> {
    if (!target) return null;
    const clean = target.trim();
    if (/^\d{17,20}$/.test(clean)) {
      return clean;
    }
    const match = clean.match(/discord\.com\/api\/webhooks\/(\d+)/);
    if (match) {
      const webhookId = match[1];
      if (this.webhookToChannelMap[webhookId]) {
        return this.webhookToChannelMap[webhookId];
      }
      try {
        const res = await axios.get(`https://discord.com/api/v10/webhooks/${webhookId}`);
        if (res.data?.channel_id) {
          this.webhookToChannelMap[webhookId] = res.data.channel_id;
          return res.data.channel_id;
        }
      } catch {
        // Fallback
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

    if (process.env.DRY_RUN_DISCORD === '1' || process.env.DRY_RUN_DISCORD === 'true') {
      const sanitizedTarget = target.replace(
        /(discord\.com\/api\/webhooks\/\d+\/)[^/?\s]+/i,
        '$1[REDACTED]'
      );
      console.log(`[DiscordService DRY_RUN] Would send webhook to target "${sanitizedTarget}":`, JSON.stringify(payload, null, 2));
      return true;
    }

    const botToken = process.env.DISCORD_BOT_TOKEN;

    // 1. Send directly from the official Bimgus Discord Bot
    if (botToken) {
      const channelId = await this.resolveChannelId(target);
      if (channelId) {
        try {
          await axios.post(
            `https://discord.com/api/v10/channels/${channelId}/messages`,
            {
              content: payload.content,
              embeds: payload.embeds,
              components: payload.components,
            },
            {
              headers: {
                Authorization: `Bot ${botToken}`,
                'Content-Type': 'application/json',
              },
              timeout: 8000,
            }
          );
          return true;
        } catch (botErr: any) {
          if (botErr.response?.status === 429 && retries > 0) {
            const retryAfter = (botErr.response.data?.retry_after || 1) * 1000;
            console.warn(`[DiscordService] Bot rate limited. Waiting ${retryAfter}ms before retry...`);
            await new Promise((resolve) => setTimeout(resolve, retryAfter + 100));
            return this.sendWebhook(target, payload, retries - 1);
          }
          console.warn(`[DiscordService] Direct bot message failed (${botErr.message}). Falling back to webhook URL...`);
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
          console.warn(`Discord rate limited. Waiting ${retryAfter}ms before retry...`);
          await new Promise((resolve) => setTimeout(resolve, retryAfter + 100));
          return this.sendWebhook(target, payload, retries - 1);
        }
        console.error(`Failed to send Discord message: ${err.message}`, err.response?.data);
        return false;
      }
    }

    return false;
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
  static createActionRow(buttons: ReturnType<typeof DiscordService.createLinkButton>[]) {
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
      buttons.push(this.createLinkButton('Opponent Clan', this.clanDeepLink(opponentTag), '🛡️'));
    }
    return this.createActionRow(buttons);
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
   * Creates an in-game deep link opening the player's profile in Clash of Clans.
   */
  static playerDeepLink(tag: string): string {
    return `https://link.clashofclans.com/en?action=OpenPlayerProfile&tag=${this.cleanTag(tag)}`;
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
    if (process.env.DRY_RUN_DISCORD === '1' || process.env.DRY_RUN_DISCORD === 'true') {
      console.log(`[Discord DM DRY_RUN] Would send DM to user "${discordUserId}":`, JSON.stringify(payload, null, 2));
      return true;
    }

    const token = botTokenOverride || process.env.DISCORD_BOT_TOKEN;
    if (!token) {
      console.warn('[Discord DM] Skipping DM: No DISCORD_BOT_TOKEN configured');
      return false;
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

      // 2. Attach components only if explicitly provided
      const components = payload.components && payload.components.length > 0
        ? payload.components
        : undefined;

      // 3. Send message into DM channel
      await axios.post(
        `https://discord.com/api/v10/channels/${dmChannelId}/messages`,
        {
          content: payload.content,
          embeds: payload.embeds,
          components,
        },
        { headers, timeout: 8000 }
      );

      console.log(`[Discord DM] Successfully sent DM to user ${discordUserId}`);
      return true;
    } catch (err: any) {
      if (err.response?.status === 429 && retries > 0) {
        const retryAfter = (err.response.data?.retry_after || 1) * 1000;
        console.warn(`[Discord DM] Rate limited. Waiting ${retryAfter}ms before retry...`);
        await new Promise((resolve) => setTimeout(resolve, retryAfter + 100));
        return this.sendDm(discordUserId, payload, token, retries - 1);
      }
      console.error(`[Discord DM] Failed to send DM to ${discordUserId}: ${err.message}`, err.response?.data);
      return false;
    }
  }
}

