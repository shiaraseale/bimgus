import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { generateKeyPairSync, sign, KeyObject } from 'crypto';
import { AddressInfo } from 'net';
import { Server } from 'http';
import express from 'express';
import axios from 'axios';
import exportFixture from './fixtures/export-th12-bh9.json';
import apiFixture from './fixtures/api-player-th12.json';
import { config } from '../src/config';
import { discordInteractionsRouter } from '../src/api/discord/router';
import { FirestoreService } from '../src/services/firestoreService';
import { CocService } from '../src/services/cocService';
import { DiscordService } from '../src/services/discordService';
import { UserDoc } from '../src/types/user';
import { cards, expectLayout, findComponent, headings, texts } from './layoutHelpers';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** Sends signed slash commands through the real router, with Firestore, Discord and the CoC API mocked. */
describe('slash commands end to end (mocked services)', () => {
  const originalPublicKey = config.discord.publicKey;
  let server: Server;
  let baseUrl: string;
  let privateKey: KeyObject;
  let user: UserDoc;
  let patches: any[];
  let followups: any[];

  beforeAll(async () => {
    const keys = generateKeyPairSync('ed25519');
    privateKey = keys.privateKey;
    config.discord.publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
    const app = express();
    app.use(
      express.json({
        verify: (req: any, _res, buf) => {
          req.rawBody = buf;
        },
      })
    );
    app.use('/api/discord', discordInteractionsRouter);
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/discord/interactions`;
  });

  afterAll(async () => {
    config.discord.publicKey = originalPublicKey;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    patches = [];
    followups = [];
    user = {
      discordUserId: '42',
      accounts: [{ playerTag: '#ANON12345', name: 'Tester', townHallLevel: 12, builderHallLevel: 9, isPrimary: true }],
      createdAt: '',
      updatedAt: '',
    };
    vi.spyOn(FirestoreService, 'getUser').mockImplementation(async () => user);
    vi.spyOn(FirestoreService, 'saveUser').mockImplementation(async (u: any) => {
      user = clone(u);
    });
    vi.spyOn(CocService.prototype, 'getPlayer').mockImplementation(async () => clone(apiFixture) as any);
    vi.spyOn(DiscordService, 'sendDmResult').mockResolvedValue('sent');
    vi.spyOn(axios, 'get').mockImplementation(async () => ({ data: JSON.stringify(exportFixture) }) as any);
    vi.spyOn(axios, 'patch').mockImplementation(async (_url: string, body: any) => {
      patches.push(body);
      return {} as any;
    });
    vi.spyOn(axios, 'post').mockImplementation(async (_url: string, body: any) => {
      followups.push(body);
      return {} as any;
    });
  });

  /** Sends a signed interaction and returns Discord's immediate response. */
  const interact = async (type: number, data: any) => {
    const body = JSON.stringify({
      type,
      token: 'tok',
      application_id: 'app',
      user: { id: '42', username: 'tester' },
      data,
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(null, Buffer.from(timestamp + body), privateKey).toString('hex');
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature-Ed25519': signature,
        'X-Signature-Timestamp': timestamp,
      },
      body,
    });
    expect(res.status).toBe(200);
    return res.json();
  };

  const command = async (name: string, options: any[] = [], resolved: any = undefined) => {
    await interact(2, { name, options, ...(resolved ? { resolved } : {}) });
    await vi.waitFor(() => expect(patches.length).toBeGreaterThan(0), { timeout: 5000 });
    return patches[0];
  };

  const importFile = () =>
    command('import-village', [{ name: 'file', value: 'att1' }], {
      attachments: { att1: { id: 'att1', url: 'https://cdn.example/export.json', filename: 'export.json' } },
    });

  const allText = (msg: any) => JSON.stringify(msg);

  /** A message of village cards: within Discord's limits, and no list split into "(cont.)" parts. */
  const expectCards = (msg: any, label = '') => {
    expect(headings(msg)).toEqual(['🏰 Home Village (TH12)', '🔨 Builder Base (BH9)']);
    expectLayout(msg, label);
    expect(allText(msg)).not.toMatch(/cont\./i);
  };

  it('/import-village stores both villages and replies with real names', async () => {
    const reply = await importFile();
    const stored = user.accounts[0].villageData;
    expect(stored.version).toBe(2);
    expect(stored.builderHallLevel).toBe(9);
    const text = allText(reply) + allText(followups);
    expect(text).toContain('Imported Village');
    // What's left is one line per village; the full list is behind a button
    expect(text).toContain('32 defenses · 10 traps');
    expect(text).not.toContain('Mega Tesla');
    // One message per import, within Discord's limits
    expect(followups).toHaveLength(0);
    expectLayout(reply);
    expect(headings(reply)).toEqual(['🏰 Home Village (TH12)', '🔨 Builder Base (BH9)']);
  });

  it("the import's Full list button lists every item still to upgrade, with real names", async () => {
    const reply = await importFile();
    const button = findComponent(reply, 'import_list:');
    expect(button.custom_id).toBe('import_list:#ANON12345');
    const list = await interact(3, { custom_id: button.custom_id, component_type: 2 });
    expect(list.data.flags).toBe(64 | (1 << 15));
    const text = allText(list);
    expect(text).toContain('Cannon (BB)');
    expect(text).toContain('• **Mega Tesla**: Lv 3 → 9');
    expect(text.match(/\(\d{7,}\)/g)).toBeNull();
    expectCards(list.data);
    // Each village's lists are on its own card
    expect(texts(cards(list.data)[0])).not.toContain('Mega Tesla');
    expect(texts(cards(list.data)[1])).toContain('**🛡️ Defenses (24)**');
  });

  it('/import-village again with one more upgraded cannon lists the change and sends no DM', async () => {
    await importFile();
    patches = [];
    const next = clone(exportFixture) as any;
    const cannon = next.buildings.find((b: any) => b.data === 1000008 && b.cnt === 5);
    cannon.cnt = 4;
    next.buildings.push({ data: 1000008, lvl: 14 });
    vi.spyOn(axios, 'get').mockImplementation(async () => ({ data: JSON.stringify(next) }) as any);
    const reply = await importFile();
    expect(DiscordService.sendDmResult).not.toHaveBeenCalled();
    expect(allText(reply)).toContain('Since Your Last Import (1)');
  });

  /** A /status message: one village's card, within Discord's limits, with no list split into parts. */
  const expectStatusCard = (msg: any, heading: string, label = '') => {
    // Everything, menus and buttons too, is inside the one card
    expect(
      msg.components.map((c: any) => c.type),
      label
    ).toEqual([17]);
    expect(headings(msg), label).toEqual([heading]);
    expectLayout(msg, label);
    expect(allText(msg)).not.toMatch(/cont\./i);
  };
  const HOME = '🏰 Home Village (TH12)';
  const BUILDER = '🔨 Builder Base (BH9)';

  /** Picks `value` in a menu and returns the message it redraws. */
  const pick = async (customId: string, value: string) => {
    patches = [];
    const ack = await interact(3, { custom_id: customId, component_type: 3, values: [value] });
    expect(ack.type).toBe(6); // "deferred update": the message is edited in place
    await vi.waitFor(() => expect(patches.length).toBeGreaterThan(0), { timeout: 5000 });
    return patches[0];
  };
  const picked = (msg: any, menu: string) =>
    findComponent(msg, `status:${menu}:`).options.find((o: any) => o.default).value;
  /** Presses a /status button and returns the message it redraws. */
  const press = async (customId: string) => {
    patches = [];
    const ack = await interact(3, { custom_id: customId, component_type: 2 });
    expect(ack.type).toBe(6);
    await vi.waitFor(() => expect(patches.length).toBeGreaterThan(0), { timeout: 5000 });
    return patches[0];
  };

  it('/status is one message, and every area of both villages redraws it within Discord limits', async () => {
    // Every home building one level lower, so nearly everything is still to upgrade
    const lowered = clone(exportFixture) as any;
    for (const b of lowered.buildings) if (b.lvl > 1) b.lvl -= 1;
    vi.spyOn(axios, 'get').mockImplementation(async () => ({ data: JSON.stringify(lowered) }) as any);
    await importFile();
    patches = [];
    followups = [];
    const overview = await command('status');
    expect(followups).toHaveLength(0);
    expectStatusCard(overview, HOME);
    // One linked account: no account menu
    expect(findComponent(overview, 'status:account:')).toBeUndefined();
    expect(findComponent(overview, 'status:village:').custom_id).toBe('status:village:#ANON12345:home:overview');

    for (const [village, heading] of [
      ['home', HOME],
      ['builder', BUILDER],
    ]) {
      const first = await pick('status:village:#ANON12345:home:overview', village);
      expectStatusCard(first, heading, village);
      const areas = findComponent(first, 'status:area:').options.map((o: any) => o.value);
      // B.O.B is only on the Builder Base
      expect(areas.includes('bob'), village).toBe(village === 'builder');
      for (const area of areas) {
        const msg = await pick(findComponent(first, 'status:area:').custom_id, area);
        expectStatusCard(msg, heading, `${village} ${area}`);
        expect(picked(msg, 'village')).toBe(village);
        expect(picked(msg, 'area')).toBe(area);
      }
    }
    expect(followups).toHaveLength(0);
  });

  it('the Gold Pass buttons step a boost, keep the view and lower the costs, on the Home Village only', async () => {
    await importFile();
    let msg = await pick('status:area:#ANON12345:home:overview', 'heroes');
    expect(findComponent(msg, 'status:builder:').label).toBe('Builder Boost: Off');
    expect(findComponent(msg, 'status:research:').label).toBe('Research Boost: Off');
    expect(texts(msg)).toContain('Barbarian King**: Lv 36/65 — 49K');

    for (const label of ['10%', '15%', '20%']) {
      msg = await press(findComponent(msg, 'status:builder:').custom_id);
      expect(findComponent(msg, 'status:builder:').label).toBe(`Builder Boost: ${label}`);
      expect(picked(msg, 'area')).toBe('heroes');
    }
    expect(texts(msg)).toContain('Barbarian King**: Lv 36/65 — 39K');
    expect(findComponent(msg, 'status:research:').label).toBe('Research Boost: Off');
    expect(user.accounts[0].goldPass).toMatchObject({ builder: 20, research: 0 });

    const lab = await pick(findComponent(msg, 'status:area:').custom_id, 'lab');
    expect(findComponent(lab, 'status:builder:').label).toBe('Builder Boost: 20%');
    const builderBase = await pick(findComponent(msg, 'status:village:').custom_id, 'builder');
    expect(findComponent(builderBase, 'status:builder:')).toBeUndefined();
  });

  it('the /status Defenses area lists the imported defenses with costs, for each village', async () => {
    await importFile();
    const home = texts(await pick('status:area:#ANON12345:home:overview', 'defenses'));
    expect(home).toContain('-# [Tester] Status: Defenses');
    // The whole list is in one piece under one heading
    expect(home).toMatch(/\*\*🛡️ Defenses \(51\)\*\*\n• /);
    expect(home).toMatch(/\*\*Cannon\*\*: Lv 13\/17 — /);
    expect(home).not.toContain('(BB)');
    // Switching village keeps the area
    const builder = await pick('status:village:#ANON12345:home:defenses', 'builder');
    expect(headings(builder)).toEqual([BUILDER]);
    expect(texts(builder)).toMatch(/\*\*🛡️ Defenses \(44\)\*\*\n• /);
    expect(texts(builder)).toContain('Cannon (BB)');
  });

  it('with several accounts, /status has an account menu, and switching keeps the village and area', async () => {
    user.accounts.push({ playerTag: '#ANON67890', name: 'Second', townHallLevel: 12, builderHallLevel: 9 } as any);
    const overview = await command('status');
    expect(texts(overview)).toContain('-# [Tester] Status');
    expect(findComponent(overview, 'status:account:').options.map((o: any) => o.label)).toEqual(['Tester', 'Second']);

    const second = await pick('status:account:#ANON12345:builder:lab', '#ANON67890');
    expect(headings(second)).toEqual([BUILDER]);
    expect(texts(second)).toContain('-# [Second] Status: Lab');
    expect(picked(second, 'account')).toBe('#ANON67890');
    expect(findComponent(second, 'status:area:').custom_id).toBe('status:area:#ANON67890:builder:lab');

    patches = [];
    const opened = await command('status', [{ name: 'account', value: 'anon67890' }]);
    expect(texts(opened)).toContain('-# [Second] Status');
  });

  it('/upgrades still answers, as /status, until the commands are re-registered', async () => {
    const reply = await command('upgrades');
    expectStatusCard(reply, HOME);
    expect(findComponent(reply, 'status:area:')).toBeDefined();
  });

  it('/status and /defenses use the stored import', async () => {
    await importFile();
    patches = [];
    const status = await command('status');
    expect(allText(status)).toContain('🛡️ **Defenses**: 51 to upgrade');
    expect(allText(status)).not.toContain('/import-village');
    patches = [];
    const defenses = await command('defenses');
    expect(allText(defenses)).toContain('Current Defenses & Next Upgrades');
    expectCards(defenses);
    expect(texts(cards(defenses)[1])).toContain('Cannon (BB)');
  });

  it('/defenses without an import lists hall caps and asks for one', async () => {
    const defenses = await command('defenses');
    expect(allText(defenses)).toContain('Max Lv 17'); // TH12 Cannon cap
    expect(allText(defenses)).toContain('/import-village');
  });

  it('a queued command task runs the command and edits the reply', async () => {
    const { runCommandTask } = await import('../src/api/discord/router');
    await runCommandTask({
      type: 2,
      token: 'tok',
      application_id: 'app',
      user: { id: '42', username: 'tester' },
      data: { name: 'heroes', options: [] },
    });
    // The task waits for the work, so the reply is already edited when it returns
    expect(patches).toHaveLength(1);
    expect(allText(patches[0])).toContain('Hero Maxing Overview');
  });

  it('a queued /status menu pick redraws the message inside the task', async () => {
    await importFile();
    patches = [];
    const { runCommandTask } = await import('../src/api/discord/router');
    await runCommandTask({
      type: 3,
      token: 'tok',
      application_id: 'app',
      user: { id: '42', username: 'tester' },
      data: { custom_id: 'status:area:#ANON12345:home:overview', component_type: 3, values: ['lab'] },
    });
    expect(patches).toHaveLength(1);
    expect(texts(patches[0])).toContain('-# [Tester] Status: Lab');
  });

  it('the menu on an old /upgrades message from before the new layouts clears its embeds to redraw it', async () => {
    await importFile();
    patches = [];
    let calls = 0;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(axios, 'patch').mockImplementation(async (_url: string, body: any) => {
      patches.push(body);
      if (calls++ === 0) throw Object.assign(new Error('Bad Request'), { response: { status: 400, data: {} } });
      return {} as any;
    });
    await interact(3, { custom_id: 'upgrades_view:#ANON12345', component_type: 3, values: ['lab'] });
    await vi.waitFor(() => expect(patches).toHaveLength(2), { timeout: 5000 });
    expect(patches[1]).toMatchObject({ content: null, embeds: [], flags: 1 << 15 });
    // It becomes a /status message on the Home Village
    expect(headings(patches[1])).toEqual([HOME]);
    expect(texts(patches[1])).toContain('-# [Tester] Status: Lab');
    expect(followups).toHaveLength(0);
  });

  it('/status lists every running timer, each village on its own card, two of the same trap on one line', async () => {
    // A copy of the export taken a minute ago, so its timers are still running
    const recent = { ...clone(exportFixture), timestamp: Math.floor(Date.now() / 1000) - 60 };
    vi.spyOn(axios, 'get').mockImplementation(async () => ({ data: JSON.stringify(recent) }) as any);
    await importFile();
    patches = [];
    const home = texts(await command('status'));
    // The real export has two Spring Traps upgrading to level 6, finishing minutes apart
    expect(home).toContain('**⏳ Upgrading (6)**\n');
    expect(home).toContain('2x **Spring Trap** → Lv 6');
    const builder = texts(await pick('status:village:#ANON12345:home:overview', 'builder'));
    expect(builder).toContain('**⏳ Upgrading (1)**\n• **Star Laboratory** → Lv 9');
  });

  it('/spells, /troops and /accounts reply for the linked account', async () => {
    await importFile();
    for (const [cmd, text] of [
      ['spells', 'Spell Laboratory Upgrades'],
      ['troops', 'Troop Research'],
      ['accounts', 'Tester'],
    ] as const) {
      patches = [];
      const reply = await command(cmd);
      expect(allText(reply), cmd).toContain(text);
    }
  });

  it('/sixth-builder reads the BB defense task from the import', async () => {
    await importFile();
    patches = [];
    const reply = await command('sixth-builder');
    // This BH9 account has BB defenses at level 9+, so task 3 shows as done
    expect(allText(reply)).toContain('✅ **3. Upgrade BB Defense to Level 9**');
  });

  it('/dms off turns DMs off for every account, and /dms on for one clears a DM pause', async () => {
    user.accounts.push({ playerTag: '#SECOND', name: 'Alt', townHallLevel: 10, isPrimary: false });
    user.dmsBlockedAt = new Date().toISOString();
    const update = vi.fn().mockResolvedValue(undefined);
    vi.spyOn((FirestoreService as any).usersCol, 'doc').mockReturnValue({ update });

    const off = await interact(2, { name: 'dms', options: [{ name: 'setting', value: 'off' }] });
    expect(allText(off)).toContain('Tester');
    expect(allText(off)).toContain('Alt');
    expect(user.accounts.map((a) => a.dmsEnabled)).toEqual([false, false]);
    expect(update).not.toHaveBeenCalled();

    const on = await interact(2, {
      name: 'dms',
      options: [
        { name: 'setting', value: 'on' },
        { name: 'account', value: 'alt' },
      ],
    });
    expect(allText(on)).toContain('DMs On');
    expect(user.accounts.map((a) => a.dmsEnabled)).toEqual([false, true]);
    expect(Object.keys(update.mock.calls[0][0]).sort()).toEqual(['dmsBlockedAt', 'dmsBlockedNoticeShown']);

    const missing = await interact(2, {
      name: 'dms',
      options: [
        { name: 'setting', value: 'on' },
        { name: 'account', value: '#NOPE' },
      ],
    });
    expect(allText(missing)).toContain('Could not find linked account');
  });

  it("the button on a DM turns that account's DMs off, with a button to turn them back on", async () => {
    const off = await interact(3, { custom_id: 'dms_off:#ANON12345', component_type: 2 });
    expect(user.accounts[0].dmsEnabled).toBe(false);
    expect(off.data.content).toContain('off');
    const undo = off.data.components[0].components[0];
    expect(undo.custom_id).toBe('dms_on:#ANON12345');

    await interact(3, { custom_id: undo.custom_id, component_type: 2 });
    expect(user.accounts[0].dmsEnabled).toBe(true);
  });
});
