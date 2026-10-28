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
import { VillageImportService } from '../src/services/villageImportService';

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

  it('/import-village stores both villages and replies with real names', async () => {
    const reply = await importFile();
    const stored = user.accounts[0].villageData;
    expect(stored.version).toBe(2);
    expect(stored.builderHallLevel).toBe(9);
    const text = allText(reply) + allText(followups);
    expect(text).toContain('Imported Village');
    expect(text).toContain('Cannon (BB)');
    expect(text.match(/\(\d{7,}\)/g)).toBeNull();
    // One message per import, within Discord's limits: 10 embeds and 6,000 characters across them
    expect(followups).toHaveLength(0);
    for (const msg of [reply]) {
      expect(msg.embeds.length).toBeLessThanOrEqual(10);
      const chars = msg.embeds.reduce((n: number, e: any) => n + VillageImportService.embedSize(e), 0);
      expect(chars).toBeLessThanOrEqual(6000);
    }
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

  it('/upgrades splits a long overview into messages Discord accepts (it was refused at over 6,000)', async () => {
    // Every home building one level lower, so nearly everything is still to upgrade
    const lowered = clone(exportFixture) as any;
    for (const b of lowered.buildings) if (b.lvl > 1) b.lvl -= 1;
    vi.spyOn(axios, 'get').mockImplementation(async () => ({ data: JSON.stringify(lowered) }) as any);
    await importFile();
    patches = [];
    followups = [];
    await command('upgrades');
    await vi.waitFor(() => expect(followups.length).toBeGreaterThan(0));
    const messages = [patches[0], ...followups];
    expect(messages.length).toBeGreaterThan(1);
    for (const msg of messages) {
      expect(msg.embeds).toHaveLength(1);
      expect(VillageImportService.embedSize(msg.embeds[0])).toBeLessThanOrEqual(6000);
      expect(msg.embeds[0].fields.length).toBeLessThanOrEqual(25);
    }
    expect(messages.at(-1).components).toBeDefined();
    expect(patches[0].components).toBeUndefined();
  });

  it('/upgrades and /defenses use the stored import', async () => {
    await importFile();
    patches = [];
    const upgrades = await command('upgrades');
    expect(allText(upgrades)).toContain('Cannon');
    expect(allText(upgrades)).not.toContain('Run `/import-village`');
    patches = [];
    const defenses = await command('defenses');
    expect(allText(defenses)).toContain('Current Defenses & Next Upgrades');
    expect(allText(defenses)).toContain('Cannon (BB)');
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

  it('/upgrades lists every running timer, including two of the same trap', async () => {
    // A copy of the export taken a minute ago, so its timers are still running
    const recent = { ...clone(exportFixture), timestamp: Math.floor(Date.now() / 1000) - 60 };
    vi.spyOn(axios, 'get').mockImplementation(async () => ({ data: JSON.stringify(recent) }) as any);
    await importFile();
    patches = [];
    const reply = await command('upgrades');
    // The real export has two Spring Traps upgrading to level 6
    const timers = allText(reply).match(/Spring Trap\*\*: Upgrading/g) ?? [];
    expect(timers).toHaveLength(2);
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
