import assert from 'node:assert/strict';
import test from 'node:test';

test('retention policy documented as 14 day default', async () => {
  const fs = await import('node:fs/promises');
  const readme = await fs.readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, /14-day default retention/i);
});

test('package has expected runtime scripts', async () => {
  const fs = await import('node:fs/promises');
  const pkg = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts.start, 'node server/index.js');
  assert.equal(pkg.scripts.build, 'vite build');
});
