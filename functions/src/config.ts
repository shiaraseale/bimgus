import * as dotenv from 'dotenv';
import * as path from 'path';

// Try loading from functions/.env, current directory, or root
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

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
  discordAuth: {
    clientId: process.env.DISCORD_CLIENT_ID || '',
    clientSecret: process.env.DISCORD_CLIENT_SECRET || '',
    guildId: process.env.DISCORD_GUILD_ID || '',
    coLeaderRoleId: process.env.DISCORD_COLEADER_ROLE_ID || '',
    leaderRoleId: process.env.DISCORD_LEADER_ROLE_ID || '',
    botToken: process.env.DISCORD_BOT_TOKEN || '',
    publicKey: process.env.DISCORD_PUBLIC_KEY || '',
  },
  discord: {
    botToken: process.env.DISCORD_BOT_TOKEN || '',
    publicKey: process.env.DISCORD_PUBLIC_KEY || '',
    clientId: process.env.DISCORD_CLIENT_ID || '',
    guildId: process.env.DISCORD_GUILD_ID || '',
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
