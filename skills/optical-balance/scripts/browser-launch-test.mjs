import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const missing = mkdtempSync(join(tmpdir(), 'optical-missing-browser-'));
for (const [name, override] of [['default resolution', ''], ['explicit override', join(missing, 'chromium')]]) {
    test(`${name} reports how to install a missing browser`, () => {
        const result = spawnSync(process.execPath, [new URL('./browser-test.mjs', import.meta.url).pathname], {
            encoding: 'utf8',
            env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: missing, OPTICAL_CHROMIUM: override },
        });
        assert.equal(result.status, 1);
        assert.match(result.stderr, /npx playwright-core install chromium/);
        if (override) assert.ok(result.stderr.includes(override));
    });
}
