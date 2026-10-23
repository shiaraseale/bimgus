import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AddressInfo } from 'net';
import { Server } from 'http';
import { dashboardApp } from '../src/api/dashboardApi';

describe('dashboardApi ping endpoint', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = dashboardApp.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('returns 204 No Content for GET /api/ping', async () => {
    const res = await fetch(`${baseUrl}/api/ping`);
    expect(res.status).toBe(204);
    const body = await res.text();
    expect(body).toBe('');
  });

  it('returns 204 No Content for GET /ping', async () => {
    const res = await fetch(`${baseUrl}/ping`);
    expect(res.status).toBe(204);
    const body = await res.text();
    expect(body).toBe('');
  });
});
