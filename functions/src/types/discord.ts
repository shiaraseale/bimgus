export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbedAuthor {
  name: string;
  url?: string;
  icon_url?: string;
}

export interface DiscordEmbedFooter {
  text: string;
  icon_url?: string;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: number; // Integer color code, e.g. 0xffd700 for gold
  fields?: DiscordEmbedField[];
  author?: DiscordEmbedAuthor;
  footer?: DiscordEmbedFooter;
  timestamp?: string; // ISO 8601 string
  thumbnail?: { url: string };
  image?: { url: string };
}

export interface DiscordButtonEmoji {
  name?: string;
  id?: string;
  animated?: boolean;
}

export interface DiscordButtonComponent {
  type: 2; // Button
  style: 5; // Link button
  label: string;
  url: string;
  emoji?: DiscordButtonEmoji;
  disabled?: boolean;
}

export interface DiscordActionRowComponent {
  type: 1; // Action row
  components: DiscordButtonComponent[];
}

export interface DiscordWebhookPayload {
  username?: string;
  avatar_url?: string;
  content?: string;
  embeds?: DiscordEmbed[];
  components?: DiscordActionRowComponent[];
}

export enum DiscordChannelCategory {
  CLAN_ACTIVITY = 'clanActivity',
  WAR_ROOM = 'warRoom',
  CWL_HUB = 'cwlHub',
  RAID_WEEKEND = 'raidWeekend',
  CLAN_GAMES = 'clanGames',
}
