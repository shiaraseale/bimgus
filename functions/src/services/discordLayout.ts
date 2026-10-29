/**
 * Discord's Components V2 layouts: each card is a container with an accent colour, holding text
 * (markdown, `###` headings, `-#` subtext), an optional thumbnail beside it, and its buttons.
 */
import {
  DiscordButtonComponent,
  DiscordContainerChild,
  DiscordContainerComponent,
  DiscordSectionComponent,
  DiscordSeparatorComponent,
  DiscordTextDisplayComponent,
  DiscordThumbnailComponent,
  DiscordTopLevelComponent,
  DiscordWebhookPayload,
} from '../types/discord';

export const EPHEMERAL = 1 << 6;
export const IS_COMPONENTS_V2 = 1 << 15;

// Discord allows 40 components per message, nested ones included, and 4,000 characters of text
export const LAYOUT_LIMITS = { components: 40, chars: 4000 };

export function text(content: string): DiscordTextDisplayComponent {
  return { type: 10, content };
}

export function thumbnail(url: string): DiscordThumbnailComponent {
  return { type: 11, media: { url } };
}

/** Up to three text displays with a thumbnail or button beside them. */
export function section(
  texts: string[],
  accessory: DiscordThumbnailComponent | DiscordButtonComponent
): DiscordSectionComponent {
  return { type: 9, components: texts.slice(0, 3).map(text), accessory };
}

export function separator(spacing: 'small' | 'large' = 'small', divider = true): DiscordSeparatorComponent {
  return { type: 14, divider, spacing: spacing === 'small' ? 1 : 2 };
}

export function container(accent: number | undefined, components: DiscordContainerChild[]): DiscordContainerComponent {
  return { type: 17, ...(accent !== undefined ? { accent_color: accent } : {}), components };
}

export interface Card {
  accent?: number;
  author?: string; // a small line above the title, e.g. "[Tester] Upgrades: Lab"
  title?: string;
  body?: string; // under the title, beside the thumbnail when there is one
  thumbnail?: string;
  blocks?: string[]; // further text, each after a divider (what were an embed's fields)
  footer?: string; // small text at the bottom, e.g. the account
  buttons?: DiscordButtonComponent[]; // a row at the bottom of the card
}

/** One card, laid out the same way everywhere: what an embed used to be. */
export function card(c: Card): DiscordContainerComponent {
  const head = [c.author ? `-# ${c.author}` : '', c.title ? `### ${c.title}` : '', c.body ?? '']
    .filter(Boolean)
    .join('\n');
  const blocks = (c.blocks ?? []).filter(Boolean);
  // The footer joins the last piece of text rather than costing a component of its own
  const footer = c.footer ? `-# ${c.footer}` : '';
  const withFooter = (s: string, last: boolean) => (last && footer ? [s, footer].filter(Boolean).join('\n') : s);

  const children: DiscordContainerChild[] = [];
  const headText = withFooter(head, blocks.length === 0);
  if (c.thumbnail) children.push(section([headText || '​'], thumbnail(c.thumbnail)));
  else if (headText) children.push(text(headText));
  blocks.forEach((b, i) => {
    if (children.length > 0) children.push(separator());
    children.push(text(withFooter(b, i === blocks.length - 1)));
  });
  if (c.buttons && c.buttons.length > 0) {
    children.push(separator(), { type: 1, components: c.buttons });
  }
  return container(c.accent, children);
}

/** A whole message from top-level components (usually cards). */
export function layoutMessage(...components: DiscordTopLevelComponent[]): DiscordWebhookPayload {
  return { flags: IS_COMPONENTS_V2, components };
}

export function isLayout(payload: { flags?: number }): boolean {
  return ((payload.flags ?? 0) & IS_COMPONENTS_V2) !== 0;
}

/** What Discord counts towards a message's limits: every component, nested ones too, and the text. */
export function layoutSize(payload: { components?: unknown[] }): { components: number; chars: number } {
  let components = 0;
  let chars = 0;
  const walk = (node: any) => {
    if (!node || typeof node !== 'object' || typeof node.type !== 'number') return;
    components++;
    if (node.type === 10) chars += String(node.content ?? '').length;
    (node.components ?? []).forEach(walk);
    walk(node.accessory);
  };
  (payload.components ?? []).forEach(walk);
  return { components, chars };
}

/** Why a layout message would be refused, or null when it's within Discord's limits. */
export function overLimits(payload: DiscordWebhookPayload): string | null {
  if (!isLayout(payload)) return null;
  const size = layoutSize(payload);
  const over = [
    size.components > LAYOUT_LIMITS.components ? `${size.components} components` : '',
    size.chars > LAYOUT_LIMITS.chars ? `${size.chars} characters` : '',
  ].filter(Boolean);
  if (over.length === 0) return null;
  return `"${firstLine(payload).slice(0, 60)}" has ${over.join(' and ')} (Discord allows 40 and 4,000)`;
}

// The first line of a layout's text, to say which message a warning is about
function firstLine(payload: { components?: unknown[] }): string {
  let found = '';
  const walk = (node: any) => {
    if (found || !node || typeof node !== 'object') return;
    if (node.type === 10) found = String(node.content ?? '').split('\n')[0];
    (node.components ?? []).forEach(walk);
  };
  (payload.components ?? []).forEach(walk);
  return found;
}

/**
 * Cards spread over as few messages as Discord's limits allow, in order, with `trailing` (e.g. a row
 * of link buttons) at the end of each message. A group of cards (an array) stays in one message.
 */
export function packMessages(
  blocks: Array<DiscordTopLevelComponent | DiscordTopLevelComponent[]>,
  trailing: DiscordTopLevelComponent[] = []
): DiscordWebhookPayload[] {
  const fits = (components: DiscordTopLevelComponent[]) => {
    const size = layoutSize({ components });
    return size.components <= LAYOUT_LIMITS.components && size.chars <= LAYOUT_LIMITS.chars;
  };
  const messages: DiscordTopLevelComponent[][] = [];
  let current: DiscordTopLevelComponent[] = [];
  for (const block of blocks) {
    const group = Array.isArray(block) ? block : [block];
    if (current.length > 0 && !fits([...current, ...group, ...trailing])) {
      messages.push(current);
      current = [];
    }
    current.push(...group);
  }
  if (current.length > 0) messages.push(current);
  return messages.map((m) => layoutMessage(...m, ...trailing));
}

/** Adds a line of text at the top of a message, whether it's a layout or plain content. */
export function prependNotice<T extends { flags?: number; content?: string; components?: any[] }>(
  payload: T,
  notice: string
): T {
  if (isLayout(payload)) return { ...payload, components: [text(notice), ...(payload.components ?? [])] };
  return { ...payload, content: [notice, payload.content].filter(Boolean).join('\n') };
}

/** The message with the ephemeral flag added to any flags it already has, rather than replacing them. */
export function withFlags<T extends { flags?: number }>(messageData: T, ephemeral: boolean): T {
  const flags = (ephemeral ? EPHEMERAL : 0) | (messageData.flags ?? 0);
  return flags ? { ...messageData, flags } : messageData;
}
