import * as esbuild from 'esbuild';
import { cpSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, 'src');
const distDir = resolve(__dirname, 'dist');

const isWatch = process.argv.includes('--watch');

// Ensure dist directory exists
mkdirSync(distDir, { recursive: true });

// Copy static files to dist
const staticFiles = [
  'manifest.json',
  'popup.html',
  'styles.css',
  'offscreen.html',
];

for (const file of staticFiles) {
  cpSync(resolve(srcDir, file), resolve(distDir, file));
}

// Copy icons directory
cpSync(resolve(srcDir, 'icons'), resolve(distDir, 'icons'), { recursive: true });

// Bundle background.js (Service Worker - ESM format)
const backgroundBuild = {
  entryPoints: [resolve(srcDir, 'background.js')],
  bundle: true,
  outfile: resolve(distDir, 'background.js'),
  format: 'esm',
  platform: 'browser',
  target: 'chrome120',
  minify: false,
  sourcemap: false,
};

// Bundle popup.js (IIFE format for popup page)
const popupBuild = {
  entryPoints: [resolve(srcDir, 'popup.js')],
  bundle: true,
  outfile: resolve(distDir, 'popup.js'),
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  minify: false,
  sourcemap: false,
};

// Bundle content.js (IIFE format for content script)
const contentBuild = {
  entryPoints: [resolve(srcDir, 'content.js')],
  bundle: true,
  outfile: resolve(distDir, 'content.js'),
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  minify: false,
  sourcemap: false,
};

// Bundle offscreen.js (IIFE format)
const offscreenBuild = {
  entryPoints: [resolve(srcDir, 'offscreen.js')],
  bundle: true,
  outfile: resolve(distDir, 'offscreen.js'),
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  minify: false,
  sourcemap: false,
};

if (isWatch) {
  const contexts = await Promise.all([
    esbuild.context(backgroundBuild),
    esbuild.context(popupBuild),
    esbuild.context(contentBuild),
    esbuild.context(offscreenBuild),
  ]);
  await Promise.all(contexts.map(ctx => ctx.watch()));
  console.log('Watching for changes...');
} else {
  await Promise.all([
    esbuild.build(backgroundBuild),
    esbuild.build(popupBuild),
    esbuild.build(contentBuild),
    esbuild.build(offscreenBuild),
  ]);
  console.log('Build complete! Output in dist/');
}
