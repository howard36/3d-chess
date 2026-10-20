// A mutation check: breaks the code one line at a time and runs the tests
// meant to catch each break, so a run can show that a new check fails on
// broken code (the skill's <evidence>) with something a reviewer can rerun.
//   node bench/loop/tools/mutate.mjs <breaks.json> [--at <ref>] [--only <regex>]
// breaks.json: [{ "name", "file", "find", "replace", "tests": ["src/x.test.ts"] }],
// `file` from the repo root, `tests` from client/ (vitest's). Each break is
// applied alone (`find` must occur once in `file`, or the row says "absent"),
// its tests run, and the file put back. The first row runs every test unbroken.
// --at runs the same in a temporary worktree of that ref (its code and its
// tests, this checkout's node_modules): a new check is shown by its break
// failing here and passing at the base. Prints a Markdown table.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
const here = git(process.cwd(), 'rev-parse', '--show-toplevel');
const breaks = JSON.parse(readFileSync(resolve(args[0]), 'utf8'));
const only = opt('--only') ? new RegExp(opt('--only')) : null;
const at = opt('--at');

let root = here;
if (at) {
  root = join(mkdtempSync(join(tmpdir(), 'mutate-')), 'wt');
  git(here, 'worktree', 'add', '--detach', root, at);
  symlinkSync(join(here, 'client/node_modules'), join(root, 'client/node_modules'));
}

const vitest = (tests) =>
  spawnSync('npx', ['vitest', 'run', ...tests], { cwd: join(root, 'client') }).status === 0
    ? 'passes'
    : 'fails';

/** The tests' verdict with one break applied, the file put back after. */
const run = (b) => {
  const path = join(root, b.file);
  const text = readFileSync(path, 'utf8');
  if (text.split(b.find).length !== 2) return 'absent';
  writeFileSync(
    path,
    text.replace(b.find, () => b.replace),
  );
  try {
    return vitest(b.tests);
  } finally {
    writeFileSync(path, text);
  }
};

const all = only ? breaks.filter((b) => only.test(b.name)) : breaks;
const rows = [['(unbroken)', 'all of them', vitest([...new Set(all.flatMap((b) => b.tests))])]];
try {
  for (const b of all) {
    rows.push([b.name, b.tests.join(', '), run(b)]);
    console.error(`${b.name}: ${rows.at(-1)[2]}`);
  }
} finally {
  if (at) git(here, 'worktree', 'remove', '--force', root);
}
const where = at ?? git(here, 'rev-parse', '--short', 'HEAD');
console.log(`At ${where}, with its own tests\n`);
console.log('| Break | Tests | Verdict |\n| :-- | :-- | :-- |');
for (const r of rows) console.log(`| ${r.join(' | ')} |`);
