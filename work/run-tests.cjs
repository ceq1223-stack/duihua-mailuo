const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const tests = fs.readdirSync(__dirname).filter(name => /^test-.*\.cjs$/.test(name)).sort();
let failed = false;
for (const test of tests) {
  console.log('\n' + test);
  const result = spawnSync(process.execPath, [path.join(__dirname, test)], { cwd: root, encoding: 'utf8' });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) failed = true;
}
process.exitCode = failed ? 1 : 0;
