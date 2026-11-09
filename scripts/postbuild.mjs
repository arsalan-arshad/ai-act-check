// Copies non-TS assets (JSON data files) into dist/ and marks the CLI executable.
// Plain read/write per file (not fs.cpSync) so it also works on restrictive or network file systems.
// Fails loudly if a data file is missing or empty: the rules cannot run without them.
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const pairs = [['src/rules/data', 'dist/rules/data']];

for (const [from, to] of pairs) {
  const src = join(root, from);
  const dst = join(root, to);
  if (!existsSync(src)) throw new Error(`postbuild: missing source directory ${from}`);
  mkdirSync(dst, { recursive: true });
  for (const name of readdirSync(src)) {
    const data = readFileSync(join(src, name));
    if (data.length === 0) throw new Error(`postbuild: ${from}/${name} is empty`);
    writeFileSync(join(dst, name), data);
  }
}

const cli = join(root, 'dist/cli.js');
if (existsSync(cli)) chmodSync(cli, 0o755);
