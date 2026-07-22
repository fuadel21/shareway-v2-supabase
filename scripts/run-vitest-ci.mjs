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

const tail = (value = '', maxLines = 40) => clean(value)
  .split('\n')
  .filter(Boolean)
  .slice(-maxLines)
  .join('\n');

const annotationEscape = (value) => clean(value)
  .replace(/%/g, '%25')
  .replace(/\n/g, '%0A')
  .replace(/\r/g, '%0D');

const firstUsefulLine = (value = '') => clean(value)
  .split('\n')
  .find((line) => line && !line.startsWith('Error:')) || clean(value).split('\n').find(Boolean) || 'Test fallido';

let report;
try {
  report = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
} catch {
  const fallback = tail(`${run.stdout || ''}\n${run.stderr || ''}`);
  if (fallback) console.error(fallback);
  console.error('No se pudo leer el informe JSON de Vitest.');
  process.exit(run.status || 1);
} finally {
  fs.rmSync(resultFile, { force: true });
}

const failed = [];
for (const suite of report.testResults || []) {
  let assertionsFound = false;

  for (const test of suite.assertionResults || []) {
    assertionsFound = true;
    if (test.status !== 'failed') continue;
    const title = [...(test.ancestorTitles || []), test.title].filter(Boolean).join(' > ');
    const messages = (test.failureMessages || []).map(clean).filter(Boolean);
    failed.push({
      file: suite.name || '',
      title: title || 'Assertion fallida',
      message: messages.join('\n').slice(0, 4000),
    });
  }

  const suiteFailed = suite.status === 'failed' || suite.status === 'fail';
  const suiteMessages = [
    ...(Array.isArray(suite.failureMessages) ? suite.failureMessages : []),
    suite.message,
  ].map(clean).filter(Boolean);

  if (suiteFailed && (!assertionsFound || suiteMessages.length)) {
    failed.push({
      file: suite.name || '',
      title: 'Fallo al cargar o ejecutar la suite',
      message: suiteMessages.join('\n').slice(0, 4000) || 'La suite terminó antes de ejecutar assertions.',
    });
  }
}

const globalErrors = Array.isArray(report.unhandledErrors) ? report.unhandledErrors : [];
for (const error of globalErrors) {
  const message = clean(error?.message || error?.stack || error);
  failed.push({
    file: error?.file || '',
    title: 'Error no controlado de Vitest',
    message: message.slice(0, 4000),
  });
}

if (failed.length) {
  console.error(`\n❌ ${failed.length} fallo(s) de test detectado(s):`);
  for (const failure of failed) {
    const firstLine = firstUsefulLine(failure.message);
    console.error(`\n- ${failure.file || '(sin archivo)'}\n  ${failure.title}\n  ${firstLine}`);
    console.error(`::error file=${annotationEscape(failure.file)},title=${annotationEscape(failure.title)}::${annotationEscape(firstLine)}`);
  }
} else if (run.status !== 0) {
  const fallback = tail(`${run.stdout || ''}\n${run.stderr || ''}`);
  if (fallback) console.error(`\n❌ Vitest terminó con error:\n${fallback}`);
  console.error('Vitest terminó con error sin assertions o suites fallidas localizables.');
}

const passed = report.numPassedTests ?? 0;
const total = report.numTotalTests ?? 0;
console.log(`\nVitest: ${passed}/${total} tests correctos.`);
process.exit(run.status || (failed.length ? 1 : 0));
