import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const resultFile = path.join(os.tmpdir(), `shareway-vitest-${process.pid}.json`);
const vitestBin = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

const run = spawnSync(
  vitestBin,
  ['exec', 'vitest', 'run', '--reporter=json', `--outputFile=${resultFile}`, '--silent=passed-only'],
  { encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'] },
);

const clean = (value = '') => String(value)
  .replace(/\u001b\[[0-9;]*m/g, '')
  .replace(/\r/g, '')
  .trim();

const annotationEscape = (value) => clean(value)
  .replace(/%/g, '%25')
  .replace(/\n/g, '%0A')
  .replace(/\r/g, '%0D');

let report;
try {
  report = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
} catch {
  process.stdout.write(clean(run.stdout) + '\n');
  process.stderr.write(clean(run.stderr) + '\n');
  console.error('No se pudo leer el informe JSON de Vitest.');
  process.exit(run.status || 1);
} finally {
  fs.rmSync(resultFile, { force: true });
}

const failed = [];
for (const suite of report.testResults || []) {
  for (const test of suite.assertionResults || []) {
    if (test.status !== 'failed') continue;
    const title = [...(test.ancestorTitles || []), test.title].filter(Boolean).join(' > ');
    const messages = (test.failureMessages || []).map(clean).filter(Boolean);
    failed.push({ file: suite.name || '', title, message: messages.join('\n').slice(0, 4000) });
  }
}

if (failed.length) {
  console.error(`\n❌ ${failed.length} test(s) fallido(s):`);
  for (const failure of failed) {
    const firstLine = failure.message.split('\n').find(Boolean) || 'Test fallido';
    console.error(`\n- ${failure.file}\n  ${failure.title}\n  ${firstLine}`);
    console.error(`::error file=${annotationEscape(failure.file)},title=${annotationEscape(failure.title)}::${annotationEscape(firstLine)}`);
  }
} else if (run.status !== 0) {
  process.stdout.write(clean(run.stdout) + '\n');
  process.stderr.write(clean(run.stderr) + '\n');
  console.error('Vitest terminó con error sin assertions fallidas localizables.');
}

const passed = report.numPassedTests ?? 0;
const total = report.numTotalTests ?? 0;
console.log(`\nVitest: ${passed}/${total} tests correctos.`);
process.exit(run.status || (failed.length ? 1 : 0));
