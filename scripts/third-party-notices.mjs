/*
 * Copyright 2026 ADM Media Consulting SA
 * SPDX-License-Identifier: Apache-2.0
 */

// Writes dist/THIRD_PARTY_NOTICES.txt: the copyright and licence text of every
// third-party package whose code ships inside dist/, as their licences require
// (MIT asks for its notice in all copies, Apache-2.0 for a copy of the licence).
//
// The list is taken from the build itself, not maintained by hand: every
// package that appears in the source map of dist/index.js, plus the packages
// that reach dist/ without showing up there (see ALSO_BUNDLED). Run after the
// build; it fails if a package has no licence file, so a new dependency cannot
// ship without its notice.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modules = join(root, 'node_modules');

// Code that reaches dist/ without its own entry in the source map.
const ALSO_BUNDLED = {
  // The prebuilt sync-workers bundle of VHS has these inlined (only video.js
  // and @xmldom/xmldom are left as requires, and both are listed anyway).
  '@videojs/http-streaming': [
    '@videojs/vhs-utils',
    'aes-decrypter',
    'pkcs7',
    'm3u8-parser',
    'mpd-parser',
    'mux.js',
  ],
  // dist/style.css inlines video.js/dist/video-js.css, which embeds this icon font.
  'video.js': ['videojs-font'],
};

const packageOf = (source) => {
  const at = source.lastIndexOf('node_modules/');
  if (at < 0) return null;
  const parts = source.slice(at + 'node_modules/'.length).split('/');
  return parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
};

const map = JSON.parse(readFileSync(join(root, 'dist/index.js.map'), 'utf8'));
const names = new Set(map.sources.map(packageOf).filter(Boolean));
for (const [host, extra] of Object.entries(ALSO_BUNDLED)) {
  if (names.has(host)) extra.forEach((name) => names.add(name));
}

const sections = [...names].sort().map((name) => {
  const dir = join(modules, name);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const licenceFile = readdirSync(dir).find((file) => /^licen[cs]e/i.test(file));
  if (!licenceFile) {
    throw new Error(`${name} has no licence file; add its notice by hand before shipping it.`);
  }
  const repository = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  return [
    `${name} ${pkg.version}`,
    // Older packages declare `licenses: [{ type }]` instead of `license`.
    `License: ${pkg.license ?? pkg.licenses?.map((l) => l.type).join(' OR ') ?? 'see text below'}`,
    ...(pkg.homepage || repository ? [`Source: ${pkg.homepage ?? repository}`] : []),
    '',
    readFileSync(join(dir, licenceFile), 'utf8').trim(),
  ].join('\n');
});

const { name, version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const rule = '-'.repeat(78);
const header = [
  `Third-party software bundled in ${name} ${version}`,
  '',
  'The files in dist/ include the following packages, each under its own',
  'licence. Their copyright notices and licence texts follow.',
].join('\n');

writeFileSync(
  join(root, 'dist/THIRD_PARTY_NOTICES.txt'),
  [header, ...sections].join(`\n\n${rule}\n\n`) + '\n'
);
console.log(`third-party notices -> ${names.size} packages`);
