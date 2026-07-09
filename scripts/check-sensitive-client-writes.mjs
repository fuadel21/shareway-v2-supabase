#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const scanDirs = ['src'];
const extensions = new Set(['.js', '.jsx', '.ts', '.tsx']);

const ignoredPathPatterns = [
  /(^|\/)test(s)?\//,
  /(^|\/)__tests__\//,
  /(^|\/)__mocks__\//,
  /(^|\/)e2e\//,
  /(^|\/)coverage\//,
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/
];

// Tablas cuya escritura directa desde cliente puede afectar dinero, estado de viaje,
// permisos de plataforma o administracion. Estas deben ir por RPC/Edge Function.
const blockedDirectWriteTables = [
  'rides',
  'ride_requests',
  'bookings',
  'payments',
  'wallets',
  'wallet_transactions',
  'payout_requests',
  'platform_settings',
  'disputes'
];

// Tablas con escrituras normales de usuario que pueden ser validas desde cliente
// si RLS esta bien configurado: editar perfil propio, enviar mensajes, marcar
// notificaciones leidas, etc. No se bloquean aqui, pero siguen en checklist RLS.
const rlsReviewedTables = [
  'profiles',
  'notifications',
  'messages'
];

const lifecycleRpcNames = [
  'start_ride',
  'complete_ride',
  'cancel_ride',
  'accept_passenger',
  'reject_passenger',
  'remove_passenger',
  'verify_passenger_boarding',
  'cancel_booking_and_refund',
  'confirm_trip_and_pay',
  'admin_update_user_status',
  'trigger_emergency_alert'
];

const allowedRpcWrapperFiles = new Set([
  'src/lib/supabaseRPC.js'
]);

const getExtension = (filePath) => {
  const match = filePath.match(/\.[^.]+$/);
  return match ? match[0] : '';
};

const shouldIgnorePath = (filePath) => {
  const normalizedPath = relative(root, filePath).replaceAll('\\', '/');
  return ignoredPathPatterns.some((pattern) => pattern.test(normalizedPath));
};

const walk = (dir, files = []) => {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;

    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      walk(fullPath, files);
    } else if (extensions.has(getExtension(fullPath)) && !shouldIgnorePath(fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
};

const lineForIndex = (content, index) => content.slice(0, index).split(/\r?\n/).length;
const lineText = (content, lineNumber) => content.split(/\r?\n/)[lineNumber - 1]?.trim() || '';

const findings = [];
const rlsNotes = [];

for (const scanDir of scanDirs) {
  const files = walk(join(root, scanDir));

  for (const file of files) {
    const relativePath = relative(root, file).replaceAll('\\', '/');
    const content = readFileSync(file, 'utf8');

    for (const table of blockedDirectWriteTables) {
      const directWritePattern = new RegExp(
        `\\.from\\(\\s*['\"]${table}['\"]\\s*\\)[\\s\\S]{0,300}?\\.(insert|update|upsert|delete)\\s*\\(`,
        'g'
      );

      for (const match of content.matchAll(directWritePattern)) {
        const lineNumber = lineForIndex(content, match.index ?? 0);
        findings.push({
          type: 'direct-table-write',
          file: relativePath,
          lineNumber,
          line: lineText(content, lineNumber),
          message: `Escritura directa desde cliente sobre tabla critica '${table}'. Usa RPC/Edge Function con validacion server-side.`
        });
      }
    }

    for (const table of rlsReviewedTables) {
      const directWritePattern = new RegExp(
        `\\.from\\(\\s*['\"]${table}['\"]\\s*\\)[\\s\\S]{0,300}?\\.(insert|update|upsert|delete)\\s*\\(`,
        'g'
      );

      for (const match of content.matchAll(directWritePattern)) {
        const lineNumber = lineForIndex(content, match.index ?? 0);
        rlsNotes.push({ file: relativePath, lineNumber, table });
      }
    }

    if (!allowedRpcWrapperFiles.has(relativePath)) {
      for (const rpcName of lifecycleRpcNames) {
        const directRpcPattern = new RegExp(`supabase\\.rpc\\(\\s*['\"]${rpcName}['\"]`, 'g');
        for (const match of content.matchAll(directRpcPattern)) {
          const lineNumber = lineForIndex(content, match.index ?? 0);
          findings.push({
            type: 'direct-sensitive-rpc',
            file: relativePath,
            lineNumber,
            line: lineText(content, lineNumber),
            message: `RPC sensible '${rpcName}' invocado fuera del wrapper central src/lib/supabaseRPC.js.`
          });
        }
      }
    }
  }
}

if (findings.length > 0) {
  console.error('\n🚫 Sensitive client write check failed.');
  console.error('Se han detectado escrituras directas o RPCs sensibles fuera del perímetro esperado:\n');

  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.lineNumber}`);
    console.error(`  Tipo: ${finding.type}`);
    console.error(`  Motivo: ${finding.message}`);
    console.error(`  Línea: ${finding.line}\n`);
  }

  console.error('Solución: mover estas operaciones a RPCs seguros que validen auth.uid(), rol y permisos en Supabase.\n');
  process.exit(1);
}

if (rlsNotes.length > 0) {
  console.warn('\n⚠️ RLS review notes: se han encontrado escrituras de usuario que dependen de RLS estricto:');
  const uniqueNotes = new Map();
  for (const note of rlsNotes) {
    uniqueNotes.set(`${note.file}:${note.lineNumber}:${note.table}`, note);
  }
  for (const note of uniqueNotes.values()) {
    console.warn(`- ${note.file}:${note.lineNumber} tabla '${note.table}'`);
  }
  console.warn('Estas escrituras no bloquean build, pero requieren policies RLS verificadas.\n');
}

console.log('✅ Sensitive client write check passed. No dangerous direct client writes found.');
