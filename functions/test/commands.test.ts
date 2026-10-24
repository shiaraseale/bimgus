import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { generateKeyPairSync, sign, KeyObject } from 'crypto';
import { AddressInfo } from 'net';
import { Server } from 'http';
import express from 'express';
import axios from 'axios';
import exportFixture from './fixtures/export-th12-bh9.json';
import apiFixture from './fixtures/api-player-th12.json';
import { config } from '../src/config';
import { discordInteractionsRouter } from '../src/api/discordInteractions';
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
    app.use(express.json({ verify: (req: any, _res, buf) => { req.rawBody = buf; } }));
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
    vi.spyOn(FirestoreService, 'saveUser').mockImplementation(async (u: any) => { user = clone(u); });
    vi.spyOn(CocService.prototype, 'getPlayer').mockImplementation(async () => clone(apiFixture) as any);
    vi.spyOn(DiscordService, 'sendDmResult').mockResolvedValue('sent');
    vi.spyOn(axios, 'get').mockImplementation(async () => ({ data: JSON.stringify(exportFixture) }) as any);
    vi.spyOn(axios, 'patch').mockImplementation(async (_url: string, body: any) => { patches.push(body); return {} as any; });
    vi.spyOn(axios, 'post').mockImplementation(async (_url: string, body: any) => { followups.push(body); return {} as any; });
  });

  const command = async (name: string, options: any[] = [], resolved: any = undefined) => {
    const body = JSON.stringify({
      type: 2,
      token: 'tok',
      application_id: 'app',
      user: { id: '42', username: 'tester' },
      data: { name, options, ...(resolved ? { resolved } : {}) },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(null, Buffer.from(timestamp + body), privateKey).toString('hex');
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Signature-Ed25519': signature, 'X-Signature-Timestamp': timestamp },
      body,
    });
    expect(res.status).toBe(200);
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
    expect(text).toContain('Rage Spell');
    expect(text.match(/\(\d{7,}\)/g)).toEqual(['(90000061)']);
    // Discord's per-message limits: 10 embeds and 6,000 characters across them
    for (const msg of [reply, ...followups]) {
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
    expect(allText(reply)).toContain('Changes Since Your Last Import (1)');
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

  it('/sixth-builder reads the BB defense task from the import', async () => {
    await importFile();
    patches = [];
    const reply = await command('sixth-builder');
    // This BH9 account has BB defenses at level 9+, so task 3 shows as done
    expect(allText(reply)).toContain('✅ **3. Upgrade BB Defense to Level 9**');
  });
});
