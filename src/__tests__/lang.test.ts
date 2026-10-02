/*
 * Copyright 2026 ADM Media Consulting SA
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The dictionaries under lang/ hold the player's own labels; the Video.js ones
// are merged in at build time (scripts/build-lang.mjs). These checks keep the
// source, lang/en.json (the reference list translators copy) and every
// translation in step.

const root = resolve(__dirname, '../..');
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;

const en = readJson(join(root, 'lang/en.json'));
const videojsEn = readJson(join(root, 'node_modules/video.js/dist/lang/en.json'));
const source = readFileSync(join(root, 'src/EvePlayer.ts'), 'utf8');

/** Every literal key the source translates: `_t('…')` and `controlText('…')`. */
const usedKeys = [...source.matchAll(/(?:_t|controlText)\('((?:[^'\\]|\\.)*)'/g)].map((m) =>
  m[1].replace(/\\'/g, "'")
);

const translations = readdirSync(join(root, 'lang'))
  .filter((file) => file.endsWith('.json') && file !== 'en.json')
  .map((file) => ({ file, dictionary: readJson(join(root, 'lang', file)) }));

describe('lang/ dictionaries', () => {
  it('finds the translated labels in the source', () => {
    expect(usedKeys).toContain('Settings');
  });

  it('lists every label the source translates, unless Video.js already has it', () => {
    const missing = usedKeys.filter((key) => !(key in en) && !(key in videojsEn));
    expect(missing).toEqual([]);
  });

  it('lists no label the source no longer uses', () => {
    const unused = Object.keys(en).filter((key) => !usedKeys.includes(key));
    expect(unused).toEqual([]);
  });

  it('keeps en.json as the identity dictionary', () => {
    for (const [key, value] of Object.entries(en)) expect(value).toBe(key);
  });

  it.each(translations)('$file translates only labels listed in en.json', ({ dictionary }) => {
    expect(Object.keys(dictionary).filter((key) => !(key in en))).toEqual([]);
  });

  it.each(translations)('$file keeps every {n} placeholder of the English label', ({ dictionary }) => {
    const placeholders = (text: string) => (text.match(/\{\d+\}/g) ?? []).sort();
    for (const [key, value] of Object.entries(dictionary)) {
      expect(placeholders(value), key).toEqual(placeholders(key));
    }
  });

  it('ships a complete Italian dictionary', () => {
    const it = translations.find((t) => t.file === 'it.json');
    expect(Object.keys(it?.dictionary ?? {}).sort()).toEqual(Object.keys(en).sort());
  });
});
