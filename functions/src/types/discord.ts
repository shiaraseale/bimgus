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

export type DiscordButtonComponent =
  | {
      type: 2; // Button
      style: 5; // Link button
      label: string;
      url: string;
      emoji?: DiscordButtonEmoji;
      disabled?: boolean;
    }
  | {
      type: 2; // Button
      style: 1 | 2 | 3 | 4; // Primary, secondary, success, danger
      label: string;
      custom_id: string;
      emoji?: DiscordButtonEmoji;
      disabled?: boolean;
    };

export interface DiscordSelectOption {
  label: string;
  value: string;
  description?: string;
  emoji?: DiscordButtonEmoji;
  default?: boolean;
}

export interface DiscordStringSelectComponent {
  type: 3; // String select
  custom_id: string;
  placeholder?: string;
  options: DiscordSelectOption[];
}

export interface DiscordActionRowComponent {
  type: 1; // Action row
  components: DiscordButtonComponent[] | [DiscordStringSelectComponent];
}

// Components V2 layout pieces, used with the IS_COMPONENTS_V2 message flag
export interface DiscordTextDisplayComponent {
  type: 10; // Text display: markdown, like a message's content
  content: string;
}

export interface DiscordThumbnailComponent {
  type: 11; // Thumbnail, only as a section's accessory
  media: { url: string };
  description?: string;
}

export interface DiscordSectionComponent {
  type: 9; // Section: 1-3 text displays beside an accessory
  components: DiscordTextDisplayComponent[];
  accessory: DiscordThumbnailComponent | DiscordButtonComponent;
}

export interface DiscordSeparatorComponent {
  type: 14; // Separator
  divider?: boolean;
  spacing?: 1 | 2; // Small, large
}

export type DiscordContainerChild =
  | DiscordTextDisplayComponent
  | DiscordSectionComponent
  | DiscordSeparatorComponent
  | DiscordActionRowComponent;

export interface DiscordContainerComponent {
  type: 17; // Container: a card with an accent colour down its left edge
  accent_color?: number;
  components: DiscordContainerChild[];
}

export type DiscordTopLevelComponent = DiscordContainerChild | DiscordContainerComponent;

export interface DiscordWebhookPayload {
  username?: string;
  avatar_url?: string;
  content?: string;
  embeds?: DiscordEmbed[];
  components?: DiscordTopLevelComponent[];
  flags?: number;
  allowed_mentions?: { parse?: ('users' | 'roles' | 'everyone')[]; users?: string[] };
}

export enum DiscordChannelCategory {
  CLAN_ACTIVITY = 'clanActivity',
  WAR_ROOM = 'warRoom',
  CWL_HUB = 'cwlHub',
  RAID_WEEKEND = 'raidWeekend',
  CLAN_GAMES = 'clanGames',
}
