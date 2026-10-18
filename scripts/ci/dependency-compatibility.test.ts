import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Exercise the same CommonJS APIs used by Expo's build tools, not mocked imports.
const require = createRequire(import.meta.url);

describe('patched build dependencies', () => {
  it('rejects a zero-length ICNS chunk without blocking the bundler', () => {
    // Synthetic malformed test data reproducing GHSA-w3rx-r6r6-pgpr.
    // Isolate a potentially vulnerable parser so it cannot hang the test runner.
    const child = spawnSync(process.execPath, ['--max-old-space-size=64', '-e', `
      const { getAssetSize } = require('@expo/metro/metro/Assets');
      const malformed = Buffer.alloc(16);
      malformed.write('icns'); malformed.writeUInt32BE(16, 4);
      malformed.write('icp4', 8);
      try { getAssetSize('png', malformed, 'fixture.png'); process.exit(1); }
      catch { process.exit(0); }
    `], { timeout: 2000, killSignal: 'SIGKILL', encoding: 'utf8', maxBuffer: 4096 });
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(0);
  });

  it('reads bundled artwork through both Metro asset APIs', async () => {
    const { getAssetSize, getAssetData } = require('@expo/metro/metro/Assets');
    const file = resolve('assets/images/TrackBingIcon.png');
    const dimensions = getAssetSize('png', readFileSync(file), file);
    expect(dimensions.width).toBeGreaterThan(0);
    expect(dimensions.height).toBeGreaterThan(0);
    const asset = await getAssetData(file, 'assets/images', [], null, '/assets');
    expect(asset.width).toBe(dimensions.width);
    expect(asset.height).toBe(dimensions.height);
  });

  it('preserves the CommonJS Xcode project identifier API', () => {
    const xcode = require('xcode');
    const project = xcode.project('fixture.pbxproj');
    project.hash = { project: { objects: {} } };
    expect(project.generateUuid()).toMatch(/^[A-F0-9]{24}$/);
  });

  it('rejects a UUID destination buffer that cannot hold the result', () => {
    const xcodeRequire = createRequire(require.resolve('xcode'));
    const { v5 } = xcodeRequire('uuid');
    expect(() => v5('test', v5.DNS, new Uint8Array(8), 4)).toThrow(RangeError);
  });

  it('rejects non-finite indexed source-map offsets', () => {
    const postcssRequire = createRequire(require.resolve('postcss'));
    const { SourceMapConsumer } = postcssRequire('source-map-js');
    expect(() => new SourceMapConsumer({ version: 3, sections: [{
      offset: { line: Infinity, column: 0 },
      map: { version: 3, sources: [], names: [], mappings: '' },
    }] })).toThrow();
  });
});
