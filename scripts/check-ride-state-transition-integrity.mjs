import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const migrationDir = path.join(root, 'supabase', 'migrations');
const failures = [];
const warnings = [];

if (!fs.existsSync(migrationDir)) {
  failures.push('No existe supabase/migrations');
} else {
  const sqlFiles = fs.readdirSync(migrationDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const sql = sqlFiles
    .map((file) => `\n-- FILE: ${file}\n${fs.readFileSync(path.join(migrationDir, file), 'utf8')}`)
    .join('\n');

  const findLatestFunction = (name) => {
    const pattern = new RegExp(`create\\s+or\\s+replace\\s+function\\s+(?:public\\.)?${name}\\s*\\([\\s\\S]*?(?=create\\s+or\\s+replace\\s+function|$)`, 'ig');
    const matches = [...sql.matchAll(pattern)];
    return matches.at(-1)?.[0] || '';
  };

  const startRide = findLatestFunction('start_ride');
  const completeRide = findLatestFunction('complete_ride');
  const cancelRide = findLatestFunction('cancel_ride');

  for (const [name, body] of [
    ['start_ride', startRide],
    ['complete_ride', completeRide],
    ['cancel_ride', cancelRide],
  ]) {
    if (!body) failures.push(`Falta una definición SQL localizable de ${name}`);
  }

  if (startRide) {
    if (!/auth\.uid\s*\(\s*\)/i.test(startRide)) failures.push('start_ride no valida auth.uid()');
    if (!/driver_id/i.test(startRide)) failures.push('start_ride no valida al conductor');
    if (!/scheduled/i.test(startRide)) failures.push('start_ride no exige estado scheduled');
    if (!/in_progress|active/i.test(startRide)) failures.push('start_ride no fija un estado de viaje en curso');
    if (!/for\s+update/i.test(startRide)) warnings.push('start_ride no contiene FOR UPDATE; revisar concurrencia en servidor');
    if (!/started_at/i.test(startRide)) warnings.push('start_ride no registra started_at de forma visible');
  }

  if (completeRide) {
    if (!/auth\.uid\s*\(\s*\)/i.test(completeRide)) failures.push('complete_ride no valida auth.uid()');
    if (!/driver_id/i.test(completeRide)) failures.push('complete_ride no valida al conductor');
    if (!/in_progress|active/i.test(completeRide)) failures.push('complete_ride no exige viaje en curso');
    if (!/completed/i.test(completeRide)) failures.push('complete_ride no fija estado completed');
    if (!/completed_at/i.test(completeRide)) warnings.push('complete_ride no registra completed_at de forma visible');
    if (!/for\s+update/i.test(completeRide)) warnings.push('complete_ride no contiene FOR UPDATE; revisar doble finalización');
    if (!/escrow|wallet|payment|payout|transaction/i.test(completeRide)) {
      warnings.push('complete_ride no muestra liquidación o cierre financiero; revisar si delega en otra función');
    }
  }

  if (cancelRide) {
    if (!/auth\.uid\s*\(\s*\)/i.test(cancelRide)) failures.push('cancel_ride no valida auth.uid()');
    if (!/driver_id/i.test(cancelRide)) failures.push('cancel_ride no valida al conductor');
    if (!/scheduled|in_progress|active/i.test(cancelRide)) failures.push('cancel_ride no limita estados cancelables');
    if (!/cancelled|canceled/i.test(cancelRide)) failures.push('cancel_ride no fija estado cancelado');
    if (/completed[\s\S]{0,160}(?:update|status\s*=)/i.test(cancelRide)) {
      failures.push('cancel_ride parece permitir alterar un viaje ya completado');
    }
  }

  const forbiddenTransitions = [
    /status\s*=\s*['"]completed['"][\s\S]{0,240}status\s*=\s*['"](?:scheduled|in_progress|active)['"]/i,
    /status\s*=\s*['"]cancelled['"][\s\S]{0,240}status\s*=\s*['"](?:scheduled|in_progress|active|completed)['"]/i,
  ];

  for (const pattern of forbiddenTransitions) {
    if (pattern.test(sql)) failures.push('Se detectó una posible reapertura de viaje en migraciones');
  }
}

const frontendFiles = [
  'src/services/rideService.js',
  'src/lib/supabaseRPC.js',
  'src/components/RideDetails.jsx',
  'src/components/MyRides.jsx',
];

for (const file of frontendFiles) {
  const fullPath = path.join(root, file);
  if (!fs.existsSync(fullPath)) {
    failures.push(`Falta ${file}`);
    continue;
  }

  const source = fs.readFileSync(fullPath, 'utf8');
  const directStatusWrite = /from\(["']rides["']\)[\s\S]{0,260}\.update\(\s*\{[\s\S]{0,160}status\s*:/g;
  if (directStatusWrite.test(source)) {
    failures.push(`${file} modifica rides.status directamente; debe usar RPC de ciclo de viaje`);
  }
}

const rideServicePath = path.join(root, 'src/services/rideService.js');
const rideService = fs.existsSync(rideServicePath) ? fs.readFileSync(rideServicePath, 'utf8') : '';

for (const fn of ['startRide', 'completeRide', 'cancelRide']) {
  if (!new RegExp(`export\\s+const\\s+${fn}\\s*=`).test(rideService)) {
    failures.push(`rideService no exporta ${fn}`);
  }
}

if (!rideService.includes('updateRideStatus está deshabilitado en producción')) {
  failures.push('La mutación genérica updateRideStatus debe continuar deshabilitada');
}

for (const warning of warnings) console.warn(`⚠️  ${warning}`);

if (failures.length) {
  console.error('\n❌ Auditoría de transiciones del viaje fallida:');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('✅ Transiciones protegidas: scheduled → in_progress → completed, con cancelación autorizada y sin reaperturas desde el cliente.');
