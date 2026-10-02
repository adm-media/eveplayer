/*
 * Copyright 2026 ADM Media Consulting SA
 * SPDX-License-Identifier: Apache-2.0
 */

// Writes dist/lang/<code>.json: one ready-made dictionary per language, for
// `EvePlayer.addLanguage(code, dictionary)`.
//
// Each file merges the Video.js dictionary for that language (the labels the
// player inherits from Video.js: Play, Mute, …) with the player's own labels
// from lang/<code>.json, which win on a shared key. A language present on only
// one side still ships: the labels the other side lacks stay in English.
// Video.js is bundled privately, so a consumer cannot reach its dictionaries
// any other way. Run after the build.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ownDir = join(root, 'lang');
const videojsDir = join(root, 'node_modules/video.js/dist/lang');
const outDir = join(root, 'dist/lang');

const readDictionaries = (dir) =>
  Object.fromEntries(
    readdirSync(dir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => [file.slice(0, -'.json'.length), JSON.parse(readFileSync(join(dir, file), 'utf8'))])
  );

const own = readDictionaries(ownDir);
const videojs = readDictionaries(videojsDir);

mkdirSync(outDir, { recursive: true });
const codes = [...new Set([...Object.keys(videojs), ...Object.keys(own)])].sort();
for (const code of codes) {
  const merged = { ...videojs[code], ...own[code] };
  writeFileSync(join(outDir, `${code}.json`), `${JSON.stringify(merged, null, 2)}\n`);
}
console.log(`dist/lang: ${codes.length} languages`);
