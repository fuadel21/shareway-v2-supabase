import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');

async function collectFiles(directory, extensions) {
  const files = [];
  try {
    for (const entry of await readdir(directory)) {
      const fullPath = path.join(directory, entry);
      const info = await stat(fullPath);
      if (info.isDirectory()) files.push(...await collectFiles(fullPath, extensions));
      else if (extensions.some((extension) => entry.endsWith(extension))) files.push(fullPath);
    }
  } catch {
    return files;
  }
  return files;
}

const [clientFiles, migrationFiles] = await Promise.all([
  collectFiles(SRC, ['.js', '.jsx']),
  collectFiles(MIGRATIONS, ['.sql']),
]);

const readAll = async (files) => (await Promise.all(files.map(async (file) => ({
  file: path.relative(ROOT, file),
  content: await readFile(file, 'utf8'),
}))));

const client = await readAll(clientFiles);
const migrations = await readAll(migrationFiles);
const clientText = client.map(({ content }) => content).join('\n');
const sqlText = migrations.map(({ content }) => content).join('\n').toLowerCase();
const failures = [];
const warnings = [];

function requireMatch(label, text, pattern) {
  if (!pattern.test(text)) failures.push(label);
}

requireMatch('Falta una RPC o servicio seguro para crear/obtener chat.', clientText, /get_or_create_chat|getOrCreateChat/i);
requireMatch('El chat no conserva vínculo con ride_id.', `${clientText}\n${sqlText}`, /ride_id|p_ride_id/i);
requireMatch('No se detecta sincronización realtime de mensajes o conversaciones.', clientText, /postgres_changes|\.channel\(|realtime/i);
requireMatch('No se detecta un flujo de notificaciones.', `${clientText}\n${sqlText}`, /notification|notifications|push/i);
requireMatch('No se detecta autenticación o control de participantes para chat.', sqlText, /auth\.uid\(\)|participant|sender_id|recipient_id|user_id/i);

const lifecycleSignals = [
  ['reserva', /book|booking|reserve|reservation|confirm_trip_and_pay/i],
  ['aceptación', /accept_passenger|accepted/i],
  ['cancelación', /cancel_ride|cancel_booking|cancelled|canceled/i],
  ['inicio', /start_ride|in_progress/i],
  ['finalización', /complete_ride|completed/i],
];

for (const [label, pattern] of lifecycleSignals) {
  if (!pattern.test(`${clientText}\n${sqlText}`)) failures.push(`Falta señal de ${label} en el flujo chat/notificaciones.`);
}

const unsafeMessageWrites = client.filter(({ content }) =>
  /\.from\(['"](?:messages|chat_messages|notifications)['"]\)\s*\.insert\(/s.test(content)
);
if (unsafeMessageWrites.length > 0 && !/policy|row level security|enable row level security/.test(sqlText)) {
  failures.push(`Hay inserciones directas de mensajes/notificaciones sin evidencia de RLS: ${unsafeMessageWrites.map(({ file }) => file).join(', ')}`);
}

if (!/mark.*read|read_at|is_read|unread/i.test(`${clientText}\n${sqlText}`)) {
  warnings.push('No se detecta contrato explícito de leído/no leído.');
}
if (!/removechannel|unsubscribe|cleanup/i.test(clientText)) {
  warnings.push('No se detecta limpieza explícita de canales realtime.');
}

if (failures.length > 0) {
  console.error('\n❌ Ride chat/notification integrity audit failed:\n');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('✅ Ride chat and notification integrity audit passed.');
for (const warning of warnings) console.warn(`⚠️ ${warning}`);
