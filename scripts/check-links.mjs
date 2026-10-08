/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

// Checks that relative links and images in Markdown files resolve to files in
// the repository. External URLs are not fetched (CI stays offline-safe).
import { existsSync, readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = globSync('**/*.md', {
  cwd: root,
  exclude: f => /node_modules|dist|\.demo|\.git\b/.test(f),
});
const problems = [];
for (const file of files) {
  const text = readFileSync(join(root, file), 'utf8').replace(
    /```[\s\S]*?```/g,
    '',
  );
  const links = [
    ...text.matchAll(/\]\(([^)\s]+)\)/g),
    ...text.matchAll(/(?:src|srcset|href)="([^"]+)"/g),
  ].map(m => m[1]);
  for (const link of links) {
    if (/^(https?:|mailto:|#)/.test(link)) continue;
    const target = join(
      root,
      dirname(file),
      decodeURIComponent(link.split('#')[0]),
    );
    if (!existsSync(target)) problems.push(`${file}: broken link ${link}`);
  }
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`links OK (${files.length} Markdown files)`);
