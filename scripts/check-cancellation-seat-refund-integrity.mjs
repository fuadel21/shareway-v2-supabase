import fs from 'node:fs';
import path from 'node:path';
import {
  collectFunctionDefinitions,
  resolveEffectiveFunctionChain,
} from './lib/sql-function-resolution.mjs';

const root = process.cwd();
const migrationsDir = path.join(root, 'supabase', 'migrations');
const srcDir = path.join(root, 'src');
const functionsDir = path.join(root, 'supabase', 'functions');
const failures = [];
const warnings = [];

const walkFiles = (directory, predicate) => {
  if (!fs.existsSync(directory)) return [];

  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    const relativePath = path.relative(root, fullPath).replaceAll('\\', '/');

    if (entry.isDirectory()) {
      if (/(^|\/)(__tests__|tests?|fixtures|coverage|dist|node_modules)(\/|$)/.test(relativePath)) return [];
      return walkFiles(fullPath, predicate);
    }

    return entry.isFile() && predicate(fullPath) ? [fullPath] : [];
  });
};

const sqlFiles = walkFiles(migrationsDir, (file) => file.endsWith('.sql'))
  .sort((left, right) => left.localeCompare(right));

if (sqlFiles.length === 0) {
  failures.push('No se encontraron migraciones SQL en supabase/migrations.');
}

const combinedSql = sqlFiles
  .map((file) => `\n-- FILE: ${path.relative(root, file)}\n${fs.readFileSync(file, 'utf8')}`)
  .join('\n')
  .toLowerCase();

const definitions = collectFunctionDefinitions(combinedSql);
const requiredFunctions = ['cancel_ride', 'cancel_booking_and_refund'];

for (const functionName of requiredFunctions) {
  if (!definitions.has(functionName)) {
    failures.push(`No se encontró una definición SQL de ${functionName}.`);
  }
}

const bookingCancelSql = resolveEffectiveFunctionChain(definitions, 'cancel_booking_and_refund');
const rideCancelSql = resolveEffectiveFunctionChain(definitions, 'cancel_ride');

const requirePattern = (body, pattern, message) => {
  if (body && !pattern.test(body)) failures.push(message);
};

if (bookingCancelSql) {
  requirePattern(
    bookingCancelSql,
    /for\s+(?:no\s+key\s+)?update/,
    'La implementación efectiva de cancel_booking_and_refund no bloquea filas con FOR UPDATE.',
  );
  requirePattern(
    bookingCancelSql,
    /(seats_available|available_seats|seats_recovered|enforce_ride_booking_seat_integrity)/,
    'La implementación efectiva de cancel_booking_and_refund no referencia ni devuelve el contrato de plazas.',
  );
  requirePattern(
    bookingCancelSql,
    /(refund|reembolso|wallet|escrow)/,
    'La implementación efectiva de cancel_booking_and_refund no contiene lógica reconocible de devolución o escrow.',
  );
  requirePattern(
    bookingCancelSql,
    /(auth\.uid\(\)|current_user)/,
    'La implementación efectiva de cancel_booking_and_refund no valida explícitamente al usuario autenticado.',
  );
  requirePattern(
    bookingCancelSql,
    /(cancelled|canceled)/,
    'La implementación efectiva de cancel_booking_and_refund no marca un estado de cancelación reconocible.',
  );

  if (!/(already|ya\s+cancel|idempot|on\s+conflict|status\s*(?:=|in))/i.test(bookingCancelSql)) {
    warnings.push('No se reconoce una protección explícita frente a una segunda cancelación; revisar idempotencia de la RPC efectiva.');
  }
}

if (rideCancelSql) {
  requirePattern(
    rideCancelSql,
    /for\s+(?:no\s+key\s+)?update/,
    'La implementación efectiva de cancel_ride no bloquea filas con FOR UPDATE.',
  );
  requirePattern(
    rideCancelSql,
    /(cancelled|canceled)/,
    'La implementación efectiva de cancel_ride no marca el viaje como cancelado.',
  );

  if (!/(refund|reembolso|wallet|escrow)/.test(rideCancelSql)) {
    warnings.push('La implementación efectiva de cancel_ride no muestra reembolsos; confirmar que su delegado los procesa.');
  }
}

const requiredClientFiles = [
  'src/lib/supabaseRPC.js',
  'src/services/rideService.js',
  'src/components/RideDetails.jsx',
];

for (const file of requiredClientFiles) {
  if (!fs.existsSync(path.join(root, file))) failures.push(`Falta ${file}`);
}

if (requiredClientFiles.every((file) => fs.existsSync(path.join(root, file)))) {
  const rpc = fs.readFileSync(path.join(root, 'src/lib/supabaseRPC.js'), 'utf8');
  const service = fs.readFileSync(path.join(root, 'src/services/rideService.js'), 'utf8');
  const details = fs.readFileSync(path.join(root, 'src/components/RideDetails.jsx'), 'utf8');

  const bookingCancelEdge = fs.existsSync(path.join(functionsDir, 'cancel-booking-and-refund', 'index.ts'))
    ? fs.readFileSync(path.join(functionsDir, 'cancel-booking-and-refund', 'index.ts'), 'utf8')
    : '';
  const rideCancelEdge = fs.existsSync(path.join(functionsDir, 'cancel-ride-and-refund', 'index.ts'))
    ? fs.readFileSync(path.join(functionsDir, 'cancel-ride-and-refund', 'index.ts'), 'utf8')
    : '';

  if (!rpc.includes("supabase.rpc('cancel_booking_and_refund'")
    && !rpc.includes("supabase.functions.invoke('cancel-booking-and-refund'")) {
    failures.push('El cliente no usa la RPC/Edge Function cancel_booking_and_refund.');
  }
  if (!rpc.includes("supabase.rpc('cancel_ride'")
    && !rpc.includes("supabase.functions.invoke('cancel-ride-and-refund'")) {
    failures.push('El cliente no usa la RPC/Edge Function cancel_ride.');
  }
  if (!bookingCancelEdge.includes("rpc('cancel_booking_and_refund'")) {
    failures.push('La Edge Function de cancelación de pasajero no delega en cancel_booking_and_refund.');
  }
  if (!rideCancelEdge.includes("rpc('cancel_ride_unified'")) {
    failures.push('La Edge Function de cancelación de conductor no delega en cancel_ride_unified.');
  }
  if (!service.includes('cancelBookingAndRefund')) {
    failures.push('rideService no delega la cancelación del pasajero en cancelBookingAndRefund.');
  }
  if (!details.includes('askCancelBooking') || !details.includes('askCancelRide')) {
    failures.push('RideDetails no conserva confirmaciones separadas para pasajero y conductor.');
  }
}

const productionClientFiles = walkFiles(
  srcDir,
  (file) => /\.[cm]?[jt]sx?$/.test(file),
);

const directSeatWrite = /from\(\s*['"]rides['"]\s*\)[\s\S]{0,500}?\.update\s*\([\s\S]{0,350}?(seats_available|available_seats)/gi;

for (const file of productionClientFiles) {
  const source = fs.readFileSync(file, 'utf8');
  if (directSeatWrite.test(source)) {
    failures.push(`${path.relative(root, file)} modifica plazas directamente; la devolución debe ser atómica en RPC.`);
  }
  directSeatWrite.lastIndex = 0;
}

for (const warning of warnings) console.warn(`⚠️  ${warning}`);

if (failures.length > 0) {
  console.error('\n❌ Auditoría de cancelaciones, plazas y reembolsos fallida:');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log(
  `✅ Contrato efectivo de cancelación protegido: ${sqlFiles.length} migraciones ordenadas, delegados resueltos y ${productionClientFiles.length} módulos cliente revisados.`,
);
