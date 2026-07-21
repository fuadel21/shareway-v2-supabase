import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const migrationsDir = path.join(root, 'supabase', 'migrations');
const srcDir = path.join(root, 'src');
const failures = [];
const warnings = [];

const walk = (dir, predicate = () => true) => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full, predicate);
    return predicate(full) ? [full] : [];
  });
};

const sqlFiles = walk(migrationsDir, (file) => file.endsWith('.sql'));
const sourceFiles = walk(srcDir, (file) => /\.(js|jsx|ts|tsx)$/.test(file));
const sql = sqlFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const sourceEntries = sourceFiles.map((file) => [file, fs.readFileSync(file, 'utf8')]);
const source = sourceEntries.map(([, content]) => content).join('\n');

if (!/create\s+(or\s+replace\s+)?function\s+(public\.)?complete_ride\b/i.test(sql)) {
  failures.push('Falta una definición SQL de complete_ride.');
}

if (!/completed/i.test(sql) || !/completed_at/i.test(sql)) {
  failures.push('complete_ride debe dejar estado completed y registrar completed_at.');
}

if (!/(wallet|escrow|payment|transaction|payout|release|settle)/i.test(sql)) {
  warnings.push('No se detectó una señal clara de cierre o delegación financiera al completar el viaje.');
}

if (!/(rating|review|valoraci[oó]n|reseña)/i.test(source)) {
  failures.push('No se detectó un flujo de valoración posterior al viaje en el cliente.');
}

if (!/(completed|completeRide)/.test(source)) {
  failures.push('El cliente no reconoce el estado final completed o la acción completeRide.');
}

const forbiddenRideCompletionWrites = /from\(["']rides["']\)[\s\S]{0,260}\.update\(\s*\{[\s\S]{0,160}(status\s*:\s*["']completed["']|completed_at\s*:)/g;
for (const [file, content] of sourceEntries) {
  if (forbiddenRideCompletionWrites.test(content)) {
    failures.push(`${path.relative(root, file)} completa el viaje directamente; debe usar la RPC complete_ride.`);
  }
  forbiddenRideCompletionWrites.lastIndex = 0;
}

const ratingSignals = sourceEntries.filter(([, content]) => /(rating|review|valoraci[oó]n|reseña)/i.test(content));
if (ratingSignals.length > 0) {
  const ratingSource = ratingSignals.map(([, content]) => content).join('\n');
  if (!/(completed|finalizado|finished)/i.test(ratingSource)) {
    warnings.push('Revisar que la valoración solo se habilite para viajes completados.');
  }
  if (!/(ride_id|rideId)/.test(ratingSource)) {
    warnings.push('Revisar que las valoraciones queden ligadas a un viaje concreto.');
  }
}

if (!/(ride_updates_|visibilitychange|online)/.test(source)) {
  warnings.push('No se detectó recuperación de sincronización tras completar el viaje.');
}

for (const warning of warnings) console.warn(`⚠️  ${warning}`);

if (failures.length > 0) {
  console.error('\n❌ Auditoría posterior al viaje fallida:');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('✅ Cierre posterior al viaje protegido: estado terminal, pago delegado, valoración y sincronización permanecen conectados.');
