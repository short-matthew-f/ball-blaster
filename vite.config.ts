import { defineConfig, type Plugin } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Stamps a unique build id into dist/sw.js so every deploy is a byte-different service worker (= detectable update). */
function stampServiceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'stamp-sw',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      const file = resolve(outDir, 'sw.js');
      const id = process.env.GITHUB_SHA?.slice(0, 8) ?? Date.now().toString(36);
      writeFileSync(file, readFileSync(file, 'utf8').replaceAll('__BUILD_ID__', id));
    },
  };
}

export default defineConfig({ base: './', build: { target: 'es2022' }, plugins: [stampServiceWorker()] });
