import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const migrationsDir = path.join(root, 'supabase', 'migrations');
const failures = [];
const warnings = [];

const walkSqlFiles = (directory) => {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkSqlFiles(fullPath);
    return entry.isFile() && entry.name.endsWith('.sql') ? [fullPath] : [];
  });
};

const sqlFiles = walkSqlFiles(migrationsDir);
if (sqlFiles.length === 0) {
  failures.push('No se encontraron migraciones SQL en supabase/migrations.');
}

const combinedSql = sqlFiles
  .map((file) => `\n-- FILE: ${path.relative(root, file)}\n${fs.readFileSync(file, 'utf8')}`)
  .join('\n')
  .toLowerCase();

const clientFiles = [
  'src/lib/supabaseRPC.js',
  'src/services/rideService.js',
  'src/components/RideDetails.jsx',
];

for (const file of clientFiles) {
  if (!fs.existsSync(path.join(root, file))) failures.push(`Falta ${file}`);
}

const readClient = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const requiredFunctions = ['cancel_ride', 'cancel_booking_and_refund'];
for (const functionName of requiredFunctions) {
  const definitionPattern = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${functionName}\\s*\\(`, 'i');
  if (!definitionPattern.test(combinedSql)) {
    failures.push(`No se encontró una definición SQL de ${functionName}.`);
  }
}

const functionBody = (name) => {
  const startPattern = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${name}\\s*\\(`, 'i');
  const match = startPattern.exec(combinedSql);
  if (!match) return '';
  const nextFunction = combinedSql.slice(match.index + match[0].length).search(/create\s+(?:or\s+replace\s+)?function\s+/i);
  return nextFunction === -1
    ? combinedSql.slice(match.index)
    : combinedSql.slice(match.index, match.index + match[0].length + nextFunction);
};

const bookingCancelSql = functionBody('cancel_booking_and_refund');
const rideCancelSql = functionBody('cancel_ride');

if (bookingCancelSql) {
  if (!/for\s+update/.test(bookingCancelSql)) {
    warnings.push('cancel_booking_and_refund no muestra FOR UPDATE; revisar concurrencia de plazas y pagos.');
  }
  if (!/(seats_available|available_seats)/.test(bookingCancelSql)) {
    failures.push('cancel_booking_and_refund no referencia plazas disponibles.');
  }
  if (!/(refund|reembolso|wallet|escrow)/.test(bookingCancelSql)) {
    failures.push('cancel_booking_and_refund no contiene lógica reconocible de devolución o escrow.');
  }
  if (!/(auth\.uid\(\)|current_user)/.test(bookingCancelSql)) {
    warnings.push('cancel_booking_and_refund no muestra validación explícita del usuario autenticado.');
  }
  if (!/(cancelled|canceled)/.test(bookingCancelSql)) {
    failures.push('cancel_booking_and_refund no marca un estado de cancelación reconocible.');
  }
}

if (rideCancelSql) {
  if (!/for\s+update/.test(rideCancelSql)) {
    warnings.push('cancel_ride no muestra FOR UPDATE; revisar doble cancelación concurrente.');
  }
  if (!/(refund|reembolso|wallet|escrow)/.test(rideCancelSql)) {
    warnings.push('cancel_ride no muestra procesamiento explícito de reembolsos; confirmar delegación a otra función.');
  }
  if (!/(cancelled|canceled)/.test(rideCancelSql)) {
    failures.push('cancel_ride no marca el viaje como cancelado.');
  }
}

if (clientFiles.every((file) => fs.existsSync(path.join(root, file)))) {
  const rpc = readClient('src/lib/supabaseRPC.js');
  const service = readClient('src/services/rideService.js');
  const details = readClient('src/components/RideDetails.jsx');

  if (!rpc.includes("supabase.rpc('cancel_booking_and_refund'")) {
    failures.push('El cliente no usa la RPC cancel_booking_and_refund.');
  }
  if (!rpc.includes("supabase.rpc('cancel_ride'")) {
    failures.push('El cliente no usa la RPC cancel_ride.');
  }
  if (!service.includes('cancelBookingAndRefund')) {
    failures.push('rideService no delega la cancelación del pasajero en cancelBookingAndRefund.');
  }
  if (!details.includes('askCancelBooking') || !details.includes('askCancelRide')) {
    failures.push('RideDetails no conserva confirmaciones separadas para pasajero y conductor.');
  }

  const directSeatWrite = /from\(['"]rides['"]\)[\s\S]{0,260}\.update\([\s\S]{0,180}(seats_available|available_seats)/g;
  for (const [name, source] of [['rideService', service], ['RideDetails', details]]) {
    if (directSeatWrite.test(source)) {
      failures.push(`${name} modifica plazas directamente; la devolución debe ser atómica en RPC.`);
    }
    directSeatWrite.lastIndex = 0;
  }
}

for (const warning of warnings) console.warn(`⚠️  ${warning}`);

if (failures.length > 0) {
  console.error('\n❌ Auditoría de cancelaciones, plazas y reembolsos fallida:');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log(`✅ Cancelaciones protegidas: ${sqlFiles.length} migraciones revisadas, RPC presentes y sin devoluciones de plazas desde el cliente.`);
