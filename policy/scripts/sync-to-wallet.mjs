// Copies the shared policy code into the wallet, leaving out the Node-only
// Cedar file. `--check` fails if the wallet's copy has drifted.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, 'src');
const target = join(root, '..', 'wallet', 'src', 'policy');
const header = '// Generated from policy/src by `npm run sync` in policy/. Do not edit here.\n';
const files = readdirSync(source).filter((file) => file.endsWith('.ts') && file !== 'cedar-node.ts');

if (process.argv.includes('--check')) {
  const drifted = files.filter((file) => {
    const copy = join(target, file);
    return !existsSync(copy) || readFileSync(copy, 'utf8') !== header + readFileSync(join(source, file), 'utf8');
  });
  if (drifted.length) {
    console.error(`Out of date in wallet/src/policy: ${drifted.join(', ')}`);
    process.exit(1);
  }
  console.log('wallet/src/policy is up to date');
} else {
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  for (const file of files) writeFileSync(join(target, file), header + readFileSync(join(source, file), 'utf8'));
  console.log(`Copied ${files.length} files to wallet/src/policy`);
}
