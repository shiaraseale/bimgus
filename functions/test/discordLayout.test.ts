import { describe, it, expect, vi, afterEach } from 'vitest';
import axios from 'axios';
import {
  card,
  fitLines,
  layoutMessage,
  layoutSize,
  overLimits,
  packMessages,
  prependNotice,
  withFlags,
  IS_COMPONENTS_V2,
  LAYOUT_LIMITS,
} from '../src/services/discordLayout';
import { DiscordService } from '../src/services/discordService';

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
  it('splits cards over messages within the limits, with the trailing row on each', () => {
    const cards = Array.from({ length: 12 }, (_, i) => card({ title: `Event ${i}`, body: 'Text', thumbnail: 'u' }));
    const row = { type: 1 as const, components: [button, button] };
    const messages = packMessages(cards, [row]);
    expect(messages.length).toBe(2);
    for (const m of messages) {
      expect(layoutSize(m).components).toBeLessThanOrEqual(LAYOUT_LIMITS.components);
      expect(m.components![m.components!.length - 1]).toEqual(row);
      expect(m.flags).toBe(IS_COMPONENTS_V2);
    }
    expect(messages.flatMap((m) => m.components!.slice(0, -1))).toEqual(cards);
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
