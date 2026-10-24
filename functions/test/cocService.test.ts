import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import { Server } from 'http';
import { AddressInfo } from 'net';
import { CocService } from '../src/services/cocService';

describe('CocService retries (3.8)', () => {
  let server: Server;
  let base: string;
  let responses: Array<{ status: number; body?: any; headers?: Record<string, string> }>;
  let calls: number;

  beforeAll(async () => {
    const app = express();
    app.get('/v1/players/:tag', (_req, res) => {
      calls++;
      const next = responses.shift() ?? { status: 200, body: { tag: '#P', name: 'P' } };
      res.set(next.headers ?? {}).status(next.status).json(next.body ?? {});
    });
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    calls = 0;
    responses = [];
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  const client = () => new CocService(undefined, base, 'key');

  it('retries a rate limit and then succeeds', async () => {
    responses = [{ status: 429, headers: { 'Retry-After': '0' } }];
    const player = await client().getPlayer('#P');
    expect(player.name).toBe('P');
    expect(calls).toBe(2);
  });

  it('gives up after two retries', async () => {
    responses = [{ status: 429 }, { status: 429 }, { status: 429 }, { status: 429 }];
    await expect(client().getPlayer('#P')).rejects.toMatchObject({ response: { status: 429 } });
    expect(calls).toBe(3);
  });

  it('does not retry maintenance', async () => {
    responses = [{ status: 503, body: { reason: 'inMaintenance' } }];
    await expect(client().getPlayer('#P')).rejects.toMatchObject({ response: { status: 503 } });
    expect(calls).toBe(1);
  });

  it('does not retry a 404', async () => {
    responses = [{ status: 404, body: { reason: 'notFound' } }];
    await expect(client().getPlayer('#P')).rejects.toMatchObject({ response: { status: 404 } });
    expect(calls).toBe(1);
  });

  it('shares one instance per container', () => {
    expect(CocService.shared()).toBe(CocService.shared());
  });
});
