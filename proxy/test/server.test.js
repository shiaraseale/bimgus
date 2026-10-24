const http = require('http');
const assert = require('assert');

process.env.PROXY_KEY = 'test-secret-key-12345';
process.env.COC_API_TOKEN = 'test-coc-token';

const app = require('../server');
const server = http.createServer(app);

// Sends a GET with the path exactly as written (no client-side normalisation)
function rawGet(port, path, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
}

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`[Test] Proxy test server listening on ${baseUrl}`);

  try {
    // 1. Health check (unauthenticated)
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.strictEqual(healthRes.status, 200, 'Health endpoint should return 200');
    const healthJson = await healthRes.json();
    assert.strictEqual(healthJson.status, 'ok');
    console.log('✓ Health check passed (200)');

    // 2. Reject request without X-Proxy-Key
    const noKeyRes = await fetch(`${baseUrl}/v1/clans/%23ABC123`);
    assert.strictEqual(noKeyRes.status, 401, 'Request without key should return 401');
    console.log('✓ Missing key rejected (401)');

    // 3. Reject request with invalid X-Proxy-Key
    const badKeyRes = await fetch(`${baseUrl}/v1/clans/%23ABC123`, {
      headers: { 'X-Proxy-Key': 'wrong-key' },
    });
    assert.strictEqual(badKeyRes.status, 401, 'Request with invalid key should return 401');
    console.log('✓ Invalid key rejected (401)');

    // 4. Reject POST request with 403
    const postRes = await fetch(`${baseUrl}/v1/clans/%23ABC123`, {
      method: 'POST',
      headers: { 'X-Proxy-Key': 'test-secret-key-12345' },
    });
    assert.strictEqual(postRes.status, 403, 'POST request should return 403 Forbidden');
    console.log('✓ Non-GET method rejected (403)');

    // 5. Reject unallowed path with 403
    const badPathRes = await fetch(`${baseUrl}/v1/goldpass/seasons/current`, {
      headers: { 'X-Proxy-Key': 'test-secret-key-12345' },
    });
    assert.strictEqual(badPathRes.status, 403, 'Unallowed path should return 403 Forbidden');
    console.log('✓ Unallowed path rejected (403)');

    // 6. Reject paths that use ".." to leave the allow-list (sent raw, since fetch would resolve them first)
    for (const rawPath of ['/v1/clans/../goldpass/seasons/current', '/v1/clans/%2e%2e/goldpass/seasons/current', '/v1/players/%2E%2E/%2E%2E/locations']) {
      const status = await rawGet(port, rawPath, { 'X-Proxy-Key': 'test-secret-key-12345' });
      assert.strictEqual(status, 403, `${rawPath} should return 403 Forbidden`);
    }
    console.log('✓ Dot-segment paths rejected (403)');

    // 7. The query string is forwarded once, and the clan tag stays encoded
    assert.deepStrictEqual(app.buildUpstreamUrl('/v1/clans/%23ABC123/capitalraidseasons?limit=1'), {
      path: '/v1/clans/%23ABC123/capitalraidseasons',
      url: 'https://api.clashofclans.com/v1/clans/%23ABC123/capitalraidseasons?limit=1',
    });
    assert.strictEqual(app.buildUpstreamUrl('//evil.example/v1/clans/x'), null, 'Another host must be refused');
    console.log('✓ Upstream URL built once, without duplicate query or host change');

    console.log('\n🎉 ALL 7 PROXY SECURITY TESTS PASSED!');
    server.close();
    process.exit(0);
  } catch (err) {
    console.error('❌ Test failed:', err);
    server.close();
    process.exit(1);
  }
});
