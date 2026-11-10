import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { APP_VERSION } from '../js/config.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('the version shown in the UI matches package.json', async () => {
  const pkg = JSON.parse(await read('../package.json'));
  assert.equal(APP_VERSION, pkg.version);
});

test('the service-worker cache is declared and versioned', async () => {
  const sw = await read('../sw.js');
  const match = sw.match(/const CACHE = 'done-v(\d+)';/);
  assert.ok(match, 'sw.js should declare a versioned CACHE name');
  assert.ok(Number(match[1]) > 0, `CACHE v${match[1]} should be a release counter`);

  const pkg = JSON.parse(await read('../package.json'));
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/, 'package.json must carry a full x.y.z version');
});
