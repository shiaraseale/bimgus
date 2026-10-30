import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { generateKeyPairSync, sign, KeyObject } from 'crypto';
import { AddressInfo } from 'net';
import { Server } from 'http';
import express from 'express';
import axios from 'axios';

const enqueue = vi.fn(async () => {});
const taskQueue = vi.fn(() => ({ enqueue }));
vi.mock('firebase-admin/functions', () => ({ getFunctions: () => ({ taskQueue }) }));

import { config } from '../src/config';
import { discordInteractionsRouter } from '../src/api/discord/router';

describe('slow commands are queued as Cloud Tasks', () => {
  const originalPublicKey = config.discord.publicKey;
  let server: Server;
  let baseUrl: string;
  let privateKey: KeyObject;

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

  const send = async (payload: any) => {
    const body = JSON.stringify({
      type: 2,
      token: 'tok',
      application_id: 'app',
      guild_id: 'g',
      member: { user: { id: '42' } },
      ...payload,
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(null, Buffer.from(timestamp + body), privateKey).toString('hex');
    return fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature-Ed25519': signature,
        'X-Signature-Timestamp': timestamp,
      },
      body,
    });
  };

  it('/import-village queues importTask and replies "thinking" without downloading anything', async () => {
    const get = vi.spyOn(axios, 'get');
    const res = await send({
      data: {
        name: 'import-village',
        options: [{ name: 'file', value: 'a1' }],
        resolved: { attachments: { a1: { id: 'a1', url: 'https://cdn.example/x.json', filename: 'x.json' } } },
      },
    });
    expect(await res.json()).toEqual({ type: 5, data: { flags: 64 } });
    expect(taskQueue).toHaveBeenCalledWith('importTask');
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        discordUserId: '42',
        applicationId: 'app',
        interactionToken: 'tok',
        isGuild: true,
        attachments: [{ id: 'a1', url: 'https://cdn.example/x.json', filename: 'x.json' }],
      })
    );
    expect(get).not.toHaveBeenCalled();
  });

  it('/status queues commandTask with the whole interaction and replies "thinking"', async () => {
    const res = await send({ data: { name: 'status', options: [] } });
    expect(await res.json()).toEqual({ type: 5, data: { flags: 64 } });
    expect(taskQueue).toHaveBeenCalledWith('commandTask');
    expect(enqueue).toHaveBeenCalledWith({
      interaction: expect.objectContaining({ token: 'tok', data: { name: 'status', options: [] } }),
    });
  });

  it('/help is answered straight away, not queued', async () => {
    taskQueue.mockClear();
    const res = await send({ data: { name: 'help' } });
    expect((await res.json()).type).toBe(4);
    expect(taskQueue).not.toHaveBeenCalled();
  });

  it('/roast queues roastTask and replies publicly', async () => {
    const res = await send({
      data: { name: 'roast', options: [{ name: 'user', value: '7' }], resolved: { users: { 7: { username: 'T' } } } },
    });
    expect(await res.json()).toEqual({ type: 5, data: {} });
    expect(taskQueue).toHaveBeenCalledWith('roastTask');
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ targetUserId: '7', targetUsername: 'T' }));
  });
});
