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
  /\.spec\.[jt]sx?$/,
];

const blockedDirectWriteTables = [
  'rides',
  'ride_requests',
  'bookings',
  'payments',
  'wallets',
  'wallet_transactions',
  'payout_requests',
  'platform_settings',
  'disputes',
];

const allowedMetadataFields = {
  rides: new Set([
    'vehicle_model',
    'vehicle_plate',
    'vehicle_color',
    'vehicle_year',
    'vehicle_photo_url',
    'vehicle_luggage',
    'vehicle_snapshot',
  ]),
};

const rlsReviewedTables = ['profiles', 'notifications', 'messages'];

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
  'trigger_emergency_alert',
  'trigger_emergency_alert_v2',
];

const allowedRpcWrapperFiles = new Set([
  'src/lib/supabaseRPC.js',
  'src/lib/emergencyRPC.js',
]);

const getExtension = (filePath) => filePath.match(/\.[^.]+$/)?.[0] || '';
const normalizePath = (filePath) => relative(root, filePath).replaceAll('\\', '/');
const shouldIgnorePath = (filePath) => ignoredPathPatterns.some((pattern) => pattern.test(normalizePath(filePath)));

const walk = (dir, files = []) => {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
    const fullPath = join(dir, entry);
    const info = statSync(fullPath);
    if (info.isDirectory()) walk(fullPath, files);
    else if (extensions.has(getExtension(fullPath)) && !shouldIgnorePath(fullPath)) files.push(fullPath);
  }
  return files;
};

const lineForIndex = (content, index) => content.slice(0, index).split(/\r?\n/).length;
const lineText = (content, lineNumber) => content.split(/\r?\n/)[lineNumber - 1]?.trim() || '';
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const findings = [];
const rlsNotes = [];

const recordFinding = ({ content, matchIndex, relativePath, type, message }) => {
  const lineNumber = lineForIndex(content, matchIndex);
  findings.push({
    type,
    file: relativePath,
    lineNumber,
    line: lineText(content, lineNumber),
    message,
  });
};

const parseLiteralObjectKeys = (payload) => {
  const trimmed = payload.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}') || /\.\.\./.test(trimmed)) return null;

  const keys = [];
  const keyPattern = /(?:^|[,\s{])['"]?([A-Za-z_$][\w$]*)['"]?\s*:/g;
  for (const match of trimmed.matchAll(keyPattern)) keys.push(match[1]);
  return keys.length > 0 ? keys : null;
};

for (const scanDir of scanDirs) {
  for (const file of walk(join(root, scanDir))) {
    const relativePath = normalizePath(file);
    const content = readFileSync(file, 'utf8');

    for (const table of blockedDirectWriteTables) {
      const tablePattern = escapeRegExp(table);
      const destructivePattern = new RegExp(
        `\\.from\\(\\s*['"]${tablePattern}['"]\\s*\\)[\\s\\S]{0,500}?\\.(insert|upsert|delete)\\s*\\(`,
        'g',
      );

      for (const match of content.matchAll(destructivePattern)) {
        recordFinding({
          content,
          matchIndex: match.index ?? 0,
          relativePath,
          type: 'direct-table-write',
          message: `Escritura directa desde cliente sobre tabla crítica '${table}'. Usa RPC/Edge Function con validación server-side.`,
        });
      }

      const updatePattern = new RegExp(
        `\\.from\\(\\s*['"]${tablePattern}['"]\\s*\\)[\\s\\S]{0,300}?\\.update\\s*\\(([\\s\\S]{0,1200}?)\\)\\s*\\.`,
        'g',
      );

      for (const match of content.matchAll(updatePattern)) {
        const payload = match[1] || '';
        const literalKeys = parseLiteralObjectKeys(payload);
        const allowedFields = allowedMetadataFields[table];
        const provenSafe = Boolean(
          allowedFields
          && literalKeys
          && literalKeys.every((field) => allowedFields.has(field))
        );

        if (!provenSafe) {
          recordFinding({
            content,
            matchIndex: match.index ?? 0,
            relativePath,
            type: 'direct-sensitive-update',
            message: `Actualización directa no demostrablemente segura en '${table}'. Solo se admite metadata de vehículo literal y expresamente permitida.`,
          });
        } else {
          const lineNumber = lineForIndex(content, match.index ?? 0);
          rlsNotes.push({ file: relativePath, lineNumber, table, reason: 'metadata de vehículo limitada por privilegios de columna y RLS' });
        }
      }
    }

    for (const table of rlsReviewedTables) {
      const directWritePattern = new RegExp(
        `\\.from\\(\\s*['"]${escapeRegExp(table)}['"]\\s*\\)[\\s\\S]{0,300}?\\.(insert|update|upsert|delete)\\s*\\(`,
        'g',
      );
      for (const match of content.matchAll(directWritePattern)) {
        rlsNotes.push({
          file: relativePath,
          lineNumber: lineForIndex(content, match.index ?? 0),
          table,
          reason: 'escritura de usuario',
        });
      }
    }

    if (!allowedRpcWrapperFiles.has(relativePath)) {
      for (const rpcName of lifecycleRpcNames) {
        const directRpcPattern = new RegExp(`supabase\\.rpc\\(\\s*['"]${escapeRegExp(rpcName)}['"]`, 'g');
        for (const match of content.matchAll(directRpcPattern)) {
          recordFinding({
            content,
            matchIndex: match.index ?? 0,
            relativePath,
            type: 'direct-sensitive-rpc',
            message: `RPC sensible '${rpcName}' invocada fuera de un wrapper central aprobado.`,
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
  console.warn('\n⚠️ RLS review notes: se han encontrado escrituras permitidas que dependen de RLS estricto:');
  const uniqueNotes = new Map();
  for (const note of rlsNotes) uniqueNotes.set(`${note.file}:${note.lineNumber}:${note.table}`, note);
  for (const note of uniqueNotes.values()) {
    console.warn(`- ${note.file}:${note.lineNumber} tabla '${note.table}' (${note.reason})`);
  }
  console.warn('Estas escrituras no bloquean el build, pero requieren policies RLS verificadas.\n');
}

console.log('✅ Sensitive client write check passed. No dangerous direct client writes found.');
