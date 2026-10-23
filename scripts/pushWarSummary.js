// Forwards to the shared TypeScript implementation in functions/src/scripts/pushWarSummary.ts
const path = require('path');

try {
  const { pushWarSummary } = require(path.join(__dirname, '../functions/lib/scripts/pushWarSummary'));
  pushWarSummary(process.argv[2])
    .then((res) => {
      console.log(res.message);
      process.exit(res.success ? 0 : 1);
    })
    .catch((err) => {
      console.error('[pushWarSummary] Error:', err.message);
      process.exit(1);
    });
} catch {
  const { spawnSync } = require('child_process');
  const res = spawnSync(
    'npx',
    ['ts-node', path.join(__dirname, '../functions/src/scripts/pushWarSummary.ts'), ...process.argv.slice(2)],
    { stdio: 'inherit' }
  );
  process.exit(res.status || 0);
}
