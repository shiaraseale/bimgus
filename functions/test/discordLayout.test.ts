import { describe, it, expect, vi, afterEach } from 'vitest';
import axios from 'axios';
import {
  card,
  columnRows,
  fitLines,
  layoutMessage,
  layoutSize,
  overLimits,
  packMessages,
  prependNotice,
  splitLines,
  text,
  withFlags,
  IS_COMPONENTS_V2,
  LAYOUT_LIMITS,
} from '../src/services/discordLayout';
import { DiscordService } from '../src/services/discordService';
import { buttonLabels } from './layoutHelpers';

const button = { type: 2 as const, style: 5 as const, label: 'Open CoC', url: 'https://link.clashofclans.com/en/' };

describe('card', () => {
  it('puts the author and title above the body, and the thumbnail beside them', () => {
    const c = card({ accent: 0xffd700, author: '[Tester] Upgrades', title: 'Home', body: 'Line', thumbnail: 'u' });
    expect(c).toEqual({
      type: 17,
      accent_color: 0xffd700,
      components: [
        {
          type: 9,
          components: [{ type: 10, content: '-# [Tester] Upgrades\n### Home\nLine' }],
          accessory: { type: 11, media: { url: 'u' } },
        },
      ],
    });
  });

  it('uses plain text without a thumbnail, divides blocks, and puts the footer in the last text', () => {
    const c = card({ title: 'Help', blocks: ['**A**\none', '**B**\ntwo'], footer: 'Account: X', buttons: [button] });
    expect(c.components.map((x) => x.type)).toEqual([10, 14, 10, 14, 10, 14, 1]);
    // The larger gap around each divider, and a blank line above the footer
    c.components
      .filter((x) => x.type === 14)
      .forEach((sep) => expect(sep).toEqual({ type: 14, divider: true, spacing: 2 }));
    expect((c.components[4] as any).content).toBe('**B**\ntwo\n\n-# Account: X');
    expect(c).not.toHaveProperty('accent_color');
  });

  it('puts menus at the bottom, one row each, with a divider before them and another before the buttons', () => {
    const menu = (id: string) => ({ type: 3 as const, custom_id: id, options: [{ label: 'A', value: 'a' }] });
    const c = card({ title: 'T', body: 'x', menus: [menu('m1'), menu('m2')], buttons: [button] });
    expect(c.components.map((x) => x.type)).toEqual([10, 14, 1, 1, 14, 1]);
    const rows = c.components.filter((x) => x.type === 1);
    expect(rows.map((row: any) => row.components[0].custom_id ?? row.components[0].label)).toEqual([
      'm1',
      'm2',
      'Open CoC',
    ]);
  });

  it('puts the footer under the body when there are no blocks', () => {
    const c = card({ title: 'Done', body: 'Text', footer: 'Bimgus' });
    expect(c.components).toEqual([{ type: 10, content: '### Done\nText\n\n-# Bimgus' }]);
  });
});

describe('layoutSize and overLimits', () => {
  it('counts nested components (including accessories) and only text-display text', () => {
    const msg = layoutMessage(card({ title: 'T', body: 'abc', thumbnail: 'u', buttons: [button, button] }));
    // container, section, text, thumbnail, separator, row, 2 buttons
    expect(layoutSize(msg)).toEqual({ components: 8, chars: '### T\nabc'.length });
    expect(msg.flags).toBe(IS_COMPONENTS_V2);
  });

  it('names the message that is over a limit, and ignores plain messages', () => {
    const big = layoutMessage(card({ title: 'Big one', body: 'x'.repeat(LAYOUT_LIMITS.chars) }));
    expect(overLimits(big)).toMatch(/^"### Big one" has \d+ characters/);
    expect(overLimits(layoutMessage(card({ title: 'Small' })))).toBeNull();
    expect(overLimits({ content: 'x'.repeat(5000) })).toBeNull();
  });
});

describe('packMessages', () => {
  it("splits cards over messages within the limits, with the buttons in each message's last card", () => {
    const cards = Array.from({ length: 12 }, (_, i) => card({ title: `Event ${i}`, body: 'Text', thumbnail: 'u' }));
    const messages = packMessages(cards, [button, button]);
    expect(messages.length).toBe(2);
    for (const m of messages) {
      expect(layoutSize(m).components).toBeLessThanOrEqual(LAYOUT_LIMITS.components);
      expect(m.flags).toBe(IS_COMPONENTS_V2);
      expect(m.components!.every((c) => c.type === 17)).toBe(true);
      expect(buttonLabels(m.components![m.components!.length - 1])).toEqual(['Open CoC', 'Open CoC']);
      expect(buttonLabels(m)).toHaveLength(2); // only the last card has them
    }
    expect(messages.flatMap((m) => m.components!)).toHaveLength(cards.length);
  });

  it('counts the buttons when deciding what fits', () => {
    // 9 of these cards are 36 components; the divider, row and 2 buttons reach exactly 40, a tenth card doesn't fit
    const cards = Array.from({ length: 10 }, () => card({ title: 'Event', body: 'Text', thumbnail: 'u' }));
    const fitted = packMessages(cards.slice(0, 9), [button, button]);
    expect(fitted).toHaveLength(1);
    expect(layoutSize(fitted[0]).components).toBe(LAYOUT_LIMITS.components);
    expect(packMessages(cards, [button, button]).map((m) => m.components!.length)).toEqual([9, 1]);
  });

  it('sets the buttons apart with a divider, as a card built with them', () => {
    const [message] = packMessages([card({ title: 'T', body: 'x' })], [button]);
    expect(message.components).toEqual([card({ title: 'T', body: 'x', buttons: [button] })]);
  });

  it("joins a card's own row of buttons, and stays out of a row holding a menu", () => {
    const own = { ...button, label: 'Full list' };
    const [joined] = packMessages([card({ title: 'T', buttons: [own] })], [button]);
    expect(joined.components).toEqual([card({ title: 'T', buttons: [own, button] })]);

    const menu = { type: 3 as const, custom_id: 'm', options: [{ label: 'A', value: 'a' }] };
    const [underMenu] = packMessages([card({ title: 'T', menus: [menu] })], [button]);
    expect(underMenu.components).toEqual([card({ title: 'T', menus: [menu], buttons: [button] })]);
  });

  it('leaves the text before a card alone', () => {
    const [message] = packMessages([text('Notice'), card({ title: 'T' })], [button]);
    expect(message.components![0]).toEqual(text('Notice'));
    expect(buttonLabels(message.components![1])).toEqual(['Open CoC']);
  });

  it('splits on text length too', () => {
    const cards = [1, 2, 3].map(() => card({ body: 'x'.repeat(1500) }));
    expect(packMessages(cards).map((m) => m.components!.length)).toEqual([2, 1]);
  });
});

describe('fitLines', () => {
  it('keeps every line when they fit', () => {
    expect(fitLines(['a', 'b'], 10)).toEqual(['a', 'b']);
  });

  it('keeps what fits and says how many were left out, within the budget', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i}`);
    const fitted = fitLines(lines, 30);
    expect(fitted).toEqual(['line 0', 'line 1', '…and 8 more']);
    expect(fitted.join('\n').length).toBeLessThanOrEqual(30);
  });

  it('takes its own wording for the last line', () => {
    expect(fitLines(['aaaa', 'bbbb', 'cccc'], 13, (n) => `+${n}`)).toEqual(['aaaa', 'bbbb', '+1']);
  });
});

describe('columnRows', () => {
  it('pads labels on the left, and values and amounts on the right, leaving only emoji outside', () => {
    expect(
      columnRows([
        { label: '3x Cannon', value: 'Lv 9/17', after: '1M <:gold:1>' },
        { label: 'Mortar', value: 'Lv 13/17', after: '250K <:gold:1>' },
      ])
    ).toEqual(['`3x Cannon   Lv 9/17    1M` <:gold:1>', '`Mortar     Lv 13/17  250K` <:gold:1>']);
  });

  it('keeps each of several costs in monospace, without the commas between them', () => {
    expect(columnRows([{ label: 'Fireball', value: 'Lv 1/9', after: '120 <:a:1>, 20 <:b:2>, 5 <:c:3>' }])).toEqual([
      '`Fireball  Lv 1/9  120` <:a:1> `20` <:b:2> `5` <:c:3>',
    ]);
  });

  it('handles text with no emoji, a plain emoji, an emoji alone, and no cost', () => {
    expect(
      columnRows([
        { label: 'A', value: '1', after: 'Free' },
        { label: 'B', value: '2', after: 'Maxed ✨' },
        { label: 'C', value: '3', after: '🏆' },
        { label: 'D', value: '4' },
      ])
    ).toEqual(['`A  1   Free`', '`B  2  Maxed` ✨', '`C  3` 🏆', '`D  4`']);
  });

  it('has nothing to do for no rows', () => {
    expect(columnRows([])).toEqual([]);
  });
});

describe('splitLines', () => {
  it('keeps the lines together when they fit', () => {
    expect(splitLines(['aaa', 'bbb'], 7)).toEqual([['aaa', 'bbb']]);
  });

  it('starts a new part at the line that would go over, losing none', () => {
    expect(splitLines(['aaa', 'bbb', 'ccc'], 6)).toEqual([['aaa'], ['bbb'], ['ccc']]);
  });

  it('gives one empty part for no lines, and never an empty part before a long line', () => {
    expect(splitLines([], 10)).toEqual([[]]);
    expect(splitLines(['aaaaa'], 3)).toEqual([['aaaaa']]);
  });
});

describe('prependNotice and withFlags', () => {
  it('adds a notice as text to a layout, and to the content of a plain message', () => {
    const layout = layoutMessage(card({ title: 'T' }));
    expect(prependNotice(layout, 'Paused').components![0]).toEqual({ type: 10, content: 'Paused' });
    expect(prependNotice({ content: 'Hi' }, 'Paused').content).toBe('Paused\nHi');
  });

  it("adds the ephemeral flag to a layout's flag instead of replacing it", () => {
    expect(withFlags(layoutMessage(), true).flags).toBe(64 | IS_COMPONENTS_V2);
    expect(withFlags({ content: 'x' }, true)).toEqual({ content: 'x', flags: 64 });
    expect(withFlags({ content: 'x' }, false)).toEqual({ content: 'x' });
  });
});

describe('sending layouts', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps the flags when the bot posts to a channel or a DM', async () => {
    const token = process.env.DISCORD_BOT_TOKEN;
    process.env.DISCORD_BOT_TOKEN = 'test-token';
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: { id: '555' } } as any);
    const msg = layoutMessage(card({ title: 'T' }));
    await DiscordService.sendWebhook('12345678901234567', msg);
    await DiscordService.sendDmResult('42', msg);
    const bodies = post.mock.calls.map((c) => c[1] as any).filter((b) => b.components);
    expect(bodies.length).toBe(2);
    for (const b of bodies) expect(b.flags).toBe(IS_COMPONENTS_V2);
    if (token === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = token;
  });
});
