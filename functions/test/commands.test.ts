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

  it('/import-village again with one more upgraded cannon sends one DM and lists the change', async () => {
    await importFile();
    patches = [];
    const next = clone(exportFixture) as any;
    const cannon = next.buildings.find((b: any) => b.data === 1000008 && b.cnt === 5);
    cannon.cnt = 4;
    next.buildings.push({ data: 1000008, lvl: 14 });
    vi.spyOn(axios, 'get').mockImplementation(async () => ({ data: JSON.stringify(next) }) as any);
    const reply = await importFile();
    expect(DiscordService.sendDmResult).toHaveBeenCalledTimes(1);
    expect(allText(reply)).toContain('Since Your Last Import (1)');
  });

  it('/upgrades is one message, and each section picked from its menu redraws it within Discord limits', async () => {
    // Every home building one level lower, so nearly everything is still to upgrade
    const lowered = clone(exportFixture) as any;
    for (const b of lowered.buildings) if (b.lvl > 1) b.lvl -= 1;
    vi.spyOn(axios, 'get').mockImplementation(async () => ({ data: JSON.stringify(lowered) }) as any);
    await importFile();
    patches = [];
    followups = [];
    const overview = await command('upgrades');
    expect(followups).toHaveLength(0);
    expectCards(overview);
    expect(texts(cards(overview)[1])).toContain('🧱 **Walls**: 180 to upgrade');
    const menu = findComponent(overview, 'upgrades_view:');
    expect(menu.custom_id).toBe('upgrades_view:#ANON12345');

    for (const view of menu.options.map((o: any) => o.value)) {
      patches = [];
      const ack = await interact(3, { custom_id: menu.custom_id, component_type: 3, values: [view] });
      expect(ack.type).toBe(6); // "deferred update": the message is edited in place
      await vi.waitFor(() => expect(patches.length).toBeGreaterThan(0), { timeout: 5000 });
      const msg = patches[0];
      if (view === 'bob') expect(headings(msg)).toEqual(['🔨 Builder Base (BH9)']);
      else expectCards(msg, view);
      expect(findComponent(msg, 'upgrades_view:').options.find((o: any) => o.default).value).toBe(view);
    }
    expect(followups).toHaveLength(0);
  });

  it('the /upgrades Defenses section lists the imported defenses with costs', async () => {
    await importFile();
    patches = [];
    await interact(3, { custom_id: 'upgrades_view:#ANON12345', component_type: 3, values: ['defenses'] });
    await vi.waitFor(() => expect(patches.length).toBeGreaterThan(0), { timeout: 5000 });
    const [home, builder] = cards(patches[0]).map(texts);
    expect(home).toContain('-# [Tester] Upgrades: Defenses');
    // The whole list is in one piece under one heading per village
    expect(home).toMatch(/\*\*🛡️ Defenses \(51\)\*\*\n• /);
    expect(home).toMatch(/\*\*Cannon\*\*: Lv 13\/17 — /);
    expect(builder).toMatch(/\*\*🛡️ Defenses \(44\)\*\*\n• /);
    expect(builder).toContain('Cannon (BB)');
    expect(home).not.toContain('(BB)');
  });

  it('/upgrades and /defenses use the stored import', async () => {
    await importFile();
    patches = [];
    const upgrades = await command('upgrades');
    expect(allText(upgrades)).toContain('🛡️ **Defenses**: 51 to upgrade');
    expect(allText(upgrades)).not.toContain('/import-village');
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

  it('a queued /upgrades menu pick redraws the message inside the task', async () => {
    await importFile();
    patches = [];
    const { runCommandTask } = await import('../src/api/discord/router');
    await runCommandTask({
      type: 3,
      token: 'tok',
      application_id: 'app',
      user: { id: '42', username: 'tester' },
      data: { custom_id: 'upgrades_view:#ANON12345', component_type: 3, values: ['lab'] },
    });
    expect(patches).toHaveLength(1);
    expect(texts(patches[0])).toContain('-# [Tester] Upgrades: Lab');
  });

  it('the /upgrades menu on a message from before the new layouts clears its embeds to redraw it', async () => {
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
    expect(followups).toHaveLength(0);
  });

  it('/upgrades lists every running timer, with two of the same trap on one line', async () => {
    // A copy of the export taken a minute ago, so its timers are still running
    const recent = { ...clone(exportFixture), timestamp: Math.floor(Date.now() / 1000) - 60 };
    vi.spyOn(axios, 'get').mockImplementation(async () => ({ data: JSON.stringify(recent) }) as any);
    await importFile();
    patches = [];
    const reply = await command('upgrades');
    // The real export has two Spring Traps upgrading to level 6, finishing minutes apart
    // Each village's timers are on its own card
    const [home, builder] = cards(reply).map(texts);
    expect(home).toContain('**⏳ Upgrading (6)**\n');
    expect(home).toContain('2x **Spring Trap** → Lv 6');
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

  it('upgrade DMs carry the turn-off button', async () => {
    await importFile();
    const changed = clone(exportFixture) as any;
    changed.buildings.find((b: any) => b.data === 1000008 && b.cnt === 5).cnt = 4;
    changed.buildings.push({ data: 1000008, lvl: 14 });
    vi.spyOn(axios, 'get').mockImplementation(async () => ({ data: JSON.stringify(changed) }) as any);
    patches = [];
    await importFile();
    const dm = (DiscordService.sendDmResult as any).mock.calls[0][1];
    expect(JSON.stringify(dm.components)).toContain('dms_off:#ANON12345');
  });
});
