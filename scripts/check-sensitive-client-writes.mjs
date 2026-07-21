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

const sensitiveUpdateFields = {
  rides: [
    'status', 'driver_id', 'departure_time', 'started_at', 'completed_at',
    'cancelled_at', 'seats', 'seats_available', 'available_seats', 'price',
    'payment_status', 'payout_status', 'escrow_status',
  ],
  ride_requests: [
    'status', 'driver_id', 'ride_id', 'matched_ride_id', 'seats_needed',
    'suggested_price', 'accepted_at', 'cancelled_at',
  ],
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
];

const allowedRpcWrapperFiles = new Set(['src/lib/supabaseRPC.js']);

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
        const protectedFields = sensitiveUpdateFields[table];
        const touchesSensitiveField = !protectedFields || protectedFields.some((field) => (
          new RegExp(`(?:^|[,{\\s])['"]?${escapeRegExp(field)}['"]?\\s*:`, 'm').test(payload)
        ));

        if (touchesSensitiveField) {
          recordFinding({
            content,
            matchIndex: match.index ?? 0,
            relativePath,
            type: 'direct-sensitive-update',
            message: `Actualización directa de campos sensibles en '${table}'. Usa una RPC atómica y autorizada.`,
          });
        } else {
          const lineNumber = lineForIndex(content, match.index ?? 0);
          rlsNotes.push({ file: relativePath, lineNumber, table, reason: 'metadata no sensible' });
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
            message: `RPC sensible '${rpcName}' invocada fuera del wrapper central src/lib/supabaseRPC.js.`,
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
