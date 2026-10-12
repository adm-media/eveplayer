/*
 * Copyright 2026 ADM Media Consulting SA
 * SPDX-License-Identifier: Apache-2.0
 */

// Prints the CHANGELOG.md section of one version, without its heading:
//
//   node scripts/release-notes.mjs 1.1.0 > release-notes.md
//
// The Release workflow uses it twice: as a check, before anything is
// published, that the version being released has been described, and as the
// body of the GitHub Release, so the release page and the changelog say the
// same thing. Exits with an error when the section is missing or empty.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const version = process.argv[2];
if (!version) {
  console.error('Usage: node scripts/release-notes.mjs <version>');
  process.exit(1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lines = readFileSync(join(root, 'CHANGELOG.md'), 'utf8').split('\n');

// A section starts at `## [<version>]` and runs to the next `## ` heading or
// to the link definitions (`[x.y.z]: https://...`) at the end of the file.
const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
if (start === -1) {
  console.error(
    `CHANGELOG.md has no "## [${version}] - <date>" section. Describe the release there first.`
  );
  process.exit(1);
}
let end = start + 1;
while (end < lines.length && !lines[end].startsWith('## ') && !/^\[[^\]]+\]: /.test(lines[end])) {
  end++;
}

const body = lines.slice(start + 1, end).join('\n').trim();
if (!body) {
  console.error(`The CHANGELOG.md section for ${version} is empty.`);
  process.exit(1);
}
process.stdout.write(`${body}\n`);
