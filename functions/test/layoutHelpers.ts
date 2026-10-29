/** Reading Components V2 messages in tests. */
import { expect } from 'vitest';
import { IS_COMPONENTS_V2, LAYOUT_LIMITS, layoutSize } from '../src/services/discordLayout';

const walk = (node: any, visit: (n: any) => void) => {
  if (!node || typeof node !== 'object') return;
  visit(node);
  (node.components ?? []).forEach((c: any) => walk(c, visit));
  walk(node.accessory, visit);
};

/** All the text in a message or a card, in order. */
export function texts(msgOrCard: any): string {
  const out: string[] = [];
  const roots = msgOrCard.type === 17 ? [msgOrCard] : (msgOrCard.components ?? []);
  roots.forEach((r: any) => walk(r, (n) => n.type === 10 && out.push(n.content)));
  return out.join('\n');
}

/** The message's cards (containers). */
export function cards(msg: any): any[] {
  return (msg.components ?? []).filter((c: any) => c.type === 17);
}

/** Each card's "### " heading. */
export function headings(msg: any): string[] {
  return cards(msg).map((c) => texts(c).match(/^### (.+)$/m)?.[1] ?? '');
}

/** The first button or menu whose custom_id starts with `prefix`. */
export function findComponent(msg: any, prefix: string): any {
  let found: any;
  (msg.components ?? []).forEach((r: any) =>
    walk(r, (n) => {
      if (!found && typeof n.custom_id === 'string' && n.custom_id.startsWith(prefix)) found = n;
    })
  );
  return found;
}

/** A Components V2 message that Discord would accept. */
export function expectLayout(msg: any, label = '') {
  expect(msg.flags & IS_COMPONENTS_V2, label).toBe(IS_COMPONENTS_V2);
  expect(msg.content, label).toBeUndefined();
  expect(msg.embeds, label).toBeUndefined();
  const size = layoutSize(msg);
  expect(size.components, label).toBeLessThanOrEqual(LAYOUT_LIMITS.components);
  expect(size.chars, label).toBeLessThanOrEqual(LAYOUT_LIMITS.chars);
}
