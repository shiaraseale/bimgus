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
  DiscordStringSelectComponent,
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
  blocks?: string[]; // further text, each after a divider
  footer?: string; // small text at the bottom, e.g. the account
  menus?: DiscordStringSelectComponent[]; // dropdowns at the bottom of the card, one row each
  buttons?: DiscordButtonComponent[]; // a row at the bottom of the card, under any menus
}

/** One card, laid out the same way everywhere. */
export function card(c: Card): DiscordContainerComponent {
  const head = [c.author ? `-# ${c.author}` : '', c.title ? `### ${c.title}` : '', c.body ?? '']
    .filter(Boolean)
    .join('\n');
  const blocks = (c.blocks ?? []).filter(Boolean);
  // The footer joins the last piece of text, after a blank line, rather than costing a component of its own
  const footer = c.footer ? `-# ${c.footer}` : '';
  const withFooter = (s: string, last: boolean) => (last && footer ? (s ? `${s}\n\n${footer}` : footer) : s);

  // Sections and the buttons are set apart with Discord's larger gap around each divider
  const children: DiscordContainerChild[] = [];
  const headText = withFooter(head, blocks.length === 0);
  if (c.thumbnail) children.push(section([headText || '​'], thumbnail(c.thumbnail)));
  else if (headText) children.push(text(headText));
  blocks.forEach((b, i) => {
    if (children.length > 0) children.push(separator('large'));
    children.push(text(withFooter(b, i === blocks.length - 1)));
  });
  // The menus, then the buttons, at the bottom, each group after a divider
  const menus = c.menus ?? [];
  if (menus.length > 0)
    children.push(separator('large'), ...menus.map((m): DiscordContainerChild => ({ type: 1, components: [m] })));
  if (c.buttons && c.buttons.length > 0) children.push(separator('large'), { type: 1, components: c.buttons });
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

// The card with `buttons` joining the row at its bottom, or in a row of their own after a divider
function addButtons(c: DiscordContainerComponent, buttons: DiscordButtonComponent[]): DiscordContainerComponent {
  const last = c.components[c.components.length - 1];
  if (last?.type === 1 && last.components[0]?.type === 2) {
    const row = [...(last.components as DiscordButtonComponent[]), ...buttons];
    return { ...c, components: [...c.components.slice(0, -1), { type: 1, components: row }] };
  }
  return { ...c, components: [...c.components, separator('large'), { type: 1, components: buttons }] };
}

// The message's components with `buttons` at the bottom of its last card
function onLastCard(components: DiscordTopLevelComponent[], buttons: DiscordButtonComponent[]) {
  if (buttons.length === 0) return components;
  const lastCard = components.map((c) => c.type).lastIndexOf(17);
  return components.map((c, i) => (i === lastCard && c.type === 17 ? addButtons(c, buttons) : c));
}

/**
 * Cards spread over as few messages as Discord's limits allow, in order, with `buttons` (e.g. link
 * buttons) at the bottom of each message's last card. A group of cards (an array) stays in one message.
 */
export function packMessages(
  blocks: Array<DiscordTopLevelComponent | DiscordTopLevelComponent[]>,
  buttons: DiscordButtonComponent[] = []
): DiscordWebhookPayload[] {
  const fits = (components: DiscordTopLevelComponent[]) => {
    const size = layoutSize({ components: onLastCard(components, buttons) });
    return size.components <= LAYOUT_LIMITS.components && size.chars <= LAYOUT_LIMITS.chars;
  };
  const messages: DiscordTopLevelComponent[][] = [];
  let current: DiscordTopLevelComponent[] = [];
  for (const block of blocks) {
    const group = Array.isArray(block) ? block : [block];
    if (current.length > 0 && !fits([...current, ...group])) {
      messages.push(current);
      current = [];
    }
    current.push(...group);
  }
  if (current.length > 0) messages.push(current);
  return messages.map((m) => layoutMessage(...onLastCard(m, buttons)));
}

/** Text to go inside `monospace`, used for columns, where a backtick in a player's name would end it. */
export function codeSafe(s: string): string {
  return s.replaceAll('`', "'");
}

// A custom emoji or a plain one. Neither works in monospace, so a row's emoji sit between runs of it
const EMOJI = /(<a?:\w+:\d+>|\p{Extended_Pictographic}️?)/u;

export interface ColumnRow {
  label: string; // lined up on the left
  value: string; // lined up on the right
  after?: string; // e.g. a cost: the text before any emoji is a third column, lined up on the right
}

/**
 * Rows in monospace columns, each as wide as its widest entry, with only the emoji outside them:
 * "`Cannon  13/17  1M` <gold>", or "`Fireball  14/18  2400` <shiny> `600` <glowy>" for several costs.
 */
export function columnRows(rows: ColumnRow[]): string[] {
  const afters = rows.map((r) => (r.after ?? '').split(EMOJI));
  const labelWidth = Math.max(...rows.map((r) => r.label.length));
  const valueWidth = Math.max(...rows.map((r) => r.value.length));
  const afterWidth = Math.max(...afters.map(([first]) => first.trim().length));
  return rows.map((r, i) => {
    const [first, ...rest] = afters[i];
    const columns = [r.label.padEnd(labelWidth), r.value.padStart(valueWidth)];
    if (first) columns.push(first.trim().padStart(afterWidth));
    // The rest alternates emoji and text, the text still holding the ", " between costs
    const tail = rest.map((part, j) => {
      if (j % 2 === 0) return part;
      const text = part.replace(/^[,\s]+|\s+$/g, '');
      return text ? `\`${text}\`` : '';
    });
    return [`\`${columns.join('  ')}\``, ...tail].filter(Boolean).join(' ');
  });
}

/** As many lines as fit `budget` characters, ending "…and N more" when some don't. */
export function fitLines(
  lines: string[],
  budget: number,
  more: (hidden: number) => string = (hidden) => `…and ${hidden} more`
): string[] {
  if (lines.join('\n').length <= budget) return lines;
  const room = budget - more(lines.length).length - 1;
  let used = 0;
  let kept = 0;
  while (kept < lines.length && used + lines[kept].length + 1 <= room) used += lines[kept++].length + 1;
  return [...lines.slice(0, kept), more(lines.length - kept)];
}

/** All the lines, in order, in as many parts as it takes for each to fit `budget` characters. */
export function splitLines(lines: string[], budget: number): string[][] {
  let part: string[] = [];
  const parts = [part];
  let used = 0;
  for (const line of lines) {
    if (part.length > 0 && used + line.length > budget) {
      part = [];
      parts.push(part);
      used = 0;
    }
    part.push(line);
    used += line.length + 1;
  }
  return parts;
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
