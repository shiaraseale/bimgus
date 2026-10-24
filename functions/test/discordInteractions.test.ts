import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { generateKeyPairSync, sign, KeyObject } from 'crypto';
import { AddressInfo } from 'net';
import { Server } from 'http';
import express from 'express';
import { config } from '../src/config';
import { discordInteractionsRouter } from '../src/api/discord/router';

describe('Discord interactions signature check', () => {
  const originalPublicKey = config.discord.publicKey;
  let server: Server;
  let baseUrl: string;
  let privateKey: KeyObject;
  let publicKeyHex: string;

  beforeAll(async () => {
    const keys = generateKeyPairSync('ed25519');
    privateKey = keys.privateKey;
    // The last 32 bytes of the SPKI DER encoding are the raw Ed25519 public key
    publicKeyHex = keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');

    // Same body parsing as dashboardApp, so the raw body is available for verification
    const app = express();
    app.use(express.json({
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }));
    app.use('/api/discord', discordInteractionsRouter);
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/discord/interactions`;
  });

  afterAll(async () => {
    config.discord.publicKey = originalPublicKey;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const ping = JSON.stringify({ type: 1 });

  const post = (body: string, headers: Record<string, string> = {}) =>
    fetch(baseUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });

  const signedHeaders = (body: string) => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(null, Buffer.from(timestamp + body), privateKey).toString('hex');
    return { 'X-Signature-Ed25519': signature, 'X-Signature-Timestamp': timestamp };
  };

  it('rejects every request when no public key is configured', async () => {
    config.discord.publicKey = '';
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const unsigned = await post(ping);
    expect(unsigned.status).toBe(401);

    // Even a correctly signed request is rejected, because there is nothing to verify it against
    const signed = await post(ping, signedHeaders(ping));
    expect(signed.status).toBe(401);
  });

  it('rejects a request without signature headers', async () => {
    config.discord.publicKey = publicKeyHex;
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await post(ping);
    expect(res.status).toBe(401);
  });

  it('rejects a request with an invalid signature', async () => {
    config.discord.publicKey = publicKeyHex;
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const headers = signedHeaders(ping);
    const res = await post(JSON.stringify({ type: 1, tampered: true }), headers);
    expect(res.status).toBe(401);
  });

  it('answers a correctly signed PING with PONG', async () => {
    config.discord.publicKey = publicKeyHex;

    const res = await post(ping, signedHeaders(ping));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ type: 1 });
  });
});
