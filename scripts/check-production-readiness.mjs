#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();

const SCAN_DIRS = ['src'];
const FILE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);

const IGNORED_PATH_PATTERNS = [
  /(^|\/)test(s)?\//,
  /(^|\/)__tests__\//,
  /(^|\/)__mocks__\//,
  /(^|\/)fixtures\//,
  /(^|\/)e2e\//,
  /(^|\/)coverage\//,
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/
];

const BLOCKED_PATTERNS = [
  {
    pattern: /Mocked for test/i,
    reason: 'Comentario o dato mock dentro de codigo de aplicacion.'
  },
  {
    pattern: /passenger-(789|456)/i,
    reason: 'ID de pasajero simulado expuesto en flujo real.'
  },
  {
    pattern: /driverBalance\s*:\s*125\.50/i,
    reason: 'Saldo de conductor simulado.'
  },
  {
    pattern: /escrowAmount\s*:\s*25\.50/i,
    reason: 'Importe escrow simulado.'
  },
  {
    pattern: /driverPenalty\s*:\s*5\.00/i,
    reason: 'Penalizacion simulada.'
  },
  {
    pattern: /actualDistance\s*:\s*618\.2/i,
    reason: 'Distancia real simulada.'
  },
  {
    pattern: /co2Saved\s*:\s*45\.6/i,
    reason: 'Impacto CO2 simulado.'
  },
  {
    pattern: /refundAmounts\s*:\s*{[^}]*passenger-/is,
    reason: 'Mapa de reembolsos con pasajeros simulados.'
  },
  {
    pattern: /Mock for test/i,
    reason: 'Comentario mock en codigo de aplicacion.'
  },
  {
    pattern: /return\s+25\.50\s*;/,
    reason: 'Importe escrow simulado.'
  }
];

const getExtension = (filePath) => {
  const match = filePath.match(/\.[^.]+$/);
  return match ? match[0] : '';
};

const shouldIgnorePath = (filePath) => {
  const normalizedPath = relative(root, filePath).replaceAll('\\', '/');
  return IGNORED_PATH_PATTERNS.some((pattern) => pattern.test(normalizedPath));
};

const walk = (dir, files = []) => {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;

    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      walk(fullPath, files);
    } else if (FILE_EXTENSIONS.has(getExtension(fullPath)) && !shouldIgnorePath(fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
};

const findings = [];

for (const scanDir of SCAN_DIRS) {
  const fullScanDir = join(root, scanDir);
  const files = walk(fullScanDir);

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const lines = content.split(/\r?\n/);

    for (const { pattern, reason } of BLOCKED_PATTERNS) {
      const match = content.match(pattern);
      if (!match) continue;

      const matchedIndex = match.index ?? 0;
      const beforeMatch = content.slice(0, matchedIndex);
      const lineNumber = beforeMatch.split(/\r?\n/).length;
      const line = lines[lineNumber - 1]?.trim() || '';

      findings.push({
        file: relative(root, file).replaceAll('\\', '/'),
        lineNumber,
        line,
        reason
      });
    }
  }
}

const SECRET_FILE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.json', '.txt', '.env', '.yml', '.yaml'])
const SECRET_IGNORED_PATH_PATTERNS = [
  /(^|\/)node_modules\//,
  /(^|\/)\.git\//,
  /(^|\/)_archive\//,
  /(^|\/)_LEGACY_HISTORY_\//,
  /(^|\/)coverage\//,
  /\.md$/
]
const SECRET_PATTERNS = [
  { pattern: /sk_live_[A-Za-z0-9]{16,}/, reason: 'Stripe live secret committed.' },
  { pattern: /sk_test_[A-Za-z0-9]{16,}/, reason: 'Stripe test secret committed.' },
  { pattern: /whsec_[A-Za-z0-9]{16,}/, reason: 'Stripe webhook secret committed.' }
]

const shouldIgnoreSecretPath = (filePath) => {
  const normalizedPath = relative(root, filePath).replaceAll('\\', '/')
  return SECRET_IGNORED_PATH_PATTERNS.some((pattern) => pattern.test(normalizedPath))
}

const walkSecrets = (dir, files = []) => {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git' || entry === 'coverage') continue
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      walkSecrets(fullPath, files)
    } else if (SECRET_FILE_EXTENSIONS.has(getExtension(fullPath)) && !shouldIgnoreSecretPath(fullPath)) {
      files.push(fullPath)
    }
  }
  return files
}

for (const file of walkSecrets(root)) {
  const content = readFileSync(file, 'utf8')
  const lines = content.split(/\r?\n/)
  for (const { pattern, reason } of SECRET_PATTERNS) {
    const match = content.match(pattern)
    if (!match) continue
    const lineNumber = content.slice(0, match.index ?? 0).split(/\r?\n/).length
    findings.push({
      file: relative(root, file).replaceAll('\\', '/'),
      lineNumber,
      line: lines[lineNumber - 1]?.trim() || '',
      reason
    })
  }
}

if (findings.length > 0) {
  console.error('\n🚫 Production readiness check failed.');
  console.error('Se han detectado mocks/datos simulados dentro del codigo de aplicacion:\n');

  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.lineNumber}`);
    console.error(`  Motivo: ${finding.reason}`);
    console.error(`  Linea: ${finding.line}\n`);
  }

  console.error('Solucion: elimina estos datos simulados o muevelos a tests/fixtures antes de produccion.\n');
  process.exit(1);
}

console.log('✅ Production readiness check passed. No dangerous production mocks found.');
