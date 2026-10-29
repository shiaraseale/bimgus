import * as dotenv from 'dotenv';
import * as path from 'path';

// Load functions/.env only (from src/ or lib/), never a .env elsewhere in the repo.
// Deployed functions get these values from Firebase, so this matters only for local runs.
dotenv.config({ path: path.resolve(__dirname, '../.env') });

export const config = {
  coc: {
    token: process.env.COC_API_TOKEN || '',
    clanTag: process.env.COC_CLAN_TAG || '',
    baseUrl: process.env.COC_API_BASE_URL || 'https://api.clashofclans.com/v1',
  },
  webhooks: {
    clanActivity: process.env.DISCORD_WEBHOOK_CLAN_ACTIVITY || '',
    warRoom: process.env.DISCORD_WEBHOOK_WAR_ROOM || '',
    cwlHub: process.env.DISCORD_WEBHOOK_CWL_HUB || '',
    raidWeekend: process.env.DISCORD_WEBHOOK_RAID_WEEKEND || '',
    clanGames: process.env.DISCORD_WEBHOOK_CLAN_GAMES || '',
  },
  discord: {
    // A getter, so tests and late-loaded env files are seen when it's read
    get botToken(): string {
      return process.env.DISCORD_BOT_TOKEN || '';
    },
    publicKey: process.env.DISCORD_PUBLIC_KEY || '',
    clientId: process.env.DISCORD_CLIENT_ID || '',
    guildId: process.env.DISCORD_GUILD_ID || '',
    // For a Discord login on the dashboard (not used yet)
    clientSecret: process.env.DISCORD_CLIENT_SECRET || '',
    coLeaderRoleId: process.env.DISCORD_COLEADER_ROLE_ID || '',
    leaderRoleId: process.env.DISCORD_LEADER_ROLE_ID || '',
    /** An application emoji's ID from EMOJI_<KEY>_ID, or '' when it isn't set */
    emojiId(key: string): string {
      return (process.env[`EMOJI_${key}_ID`] || '').trim();
    },
  },
  /** DRY_RUN_DISCORD=1 logs webhooks and DMs instead of sending them (staging, tests) */
  get dryRunDiscord(): boolean {
    return process.env.DRY_RUN_DISCORD === '1' || process.env.DRY_RUN_DISCORD === 'true';
  },
  /** URL the 2-minute poll pings to keep the api function warm (empty in staging) */
  get apiPingUrl(): string {
    return process.env.API_PING_URL || '';
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
  },
  formatTag(tag: string): string {
    const cleanTag = tag.trim().toUpperCase();
    return cleanTag.startsWith('#') ? cleanTag : `#${cleanTag}`;
  },
  encodeTag(tag: string): string {
    const formatted = this.formatTag(tag);
    return encodeURIComponent(formatted);
  },
};
