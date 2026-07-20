import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const files = {
  rideDetails: 'src/components/RideDetails.jsx',
  rideService: 'src/services/rideService.js',
  rpc: 'src/lib/supabaseRPC.js',
  myRides: 'src/components/MyRides.jsx',
  bookingModal: 'src/components/BookingPaymentModal.jsx',
};

const failures = [];
const warnings = [];

for (const [name, file] of Object.entries(files)) {
  if (!fs.existsSync(path.join(root, file))) {
    failures.push(`${name}: falta ${file}`);
  }
}

if (failures.length === 0) {
  const rideDetails = read(files.rideDetails);
  const rideService = read(files.rideService);
  const rpc = read(files.rpc);
  const myRides = read(files.myRides);
  const bookingModal = read(files.bookingModal);

  const requiredServiceExports = [
    'isRideBookable',
    'startRide',
    'completeRide',
    'cancelRide',
    'cancelBooking',
    'acceptPassenger',
    'rejectPassenger',
    'removePassenger',
    'markNoShow',
  ];

  for (const fn of requiredServiceExports) {
    if (!new RegExp(`export\\s+const\\s+${fn}\\s*=`).test(rideService)) {
      failures.push(`rideService: falta export ${fn}`);
    }
  }

  const requiredRpcWrappers = [
    'startRide',
    'completeRide',
    'cancelRide',
    'cancelBookingAndRefund',
    'acceptPassenger',
    'rejectPassenger',
  ];

  for (const fn of requiredRpcWrappers) {
    if (!new RegExp(`export\\s+const\\s+${fn}\\s*=`).test(rpc)) {
      failures.push(`supabaseRPC: falta wrapper ${fn}`);
    }
  }

  const requiredRideDetailHandlers = [
    'handleStartRide',
    'handleCompleteRide',
    'askCancelRide',
    'askCancelBooking',
    'handleVerifyPin',
  ];

  for (const handler of requiredRideDetailHandlers) {
    if (!rideDetails.includes(handler)) {
      failures.push(`RideDetails: falta ${handler}`);
    }
  }

  if (!rideDetails.includes('isRideBookable(')) {
    failures.push('RideDetails: la reserva no usa isRideBookable');
  }

  if (!rideDetails.includes(".channel(`ride_updates_${rideId}`)")) {
    failures.push('RideDetails: falta sincronización realtime del viaje');
  }

  if (!rideDetails.includes('openSecureAction')) {
    failures.push('RideDetails: las acciones críticas no usan confirmación segura');
  }

  if (!myRides.includes('startRide') || !myRides.includes('completeRide') || !myRides.includes('cancelRide')) {
    warnings.push('MyRides: revisar que iniciar/finalizar/cancelar sigan disponibles como acciones rápidas');
  }

  if (!bookingModal.includes('localStorage') || !bookingModal.includes('Comprobar otra vez')) {
    warnings.push('BookingPaymentModal: no se detecta recuperación visible de pago pendiente');
  }

  const forbiddenDirectStatusWrite = /from\(['"]rides['"]\)[\s\S]{0,240}\.update\(\s*\{[\s\S]{0,120}status\s*:/g;
  const protectedFiles = [
    ['RideDetails', rideDetails],
    ['MyRides', myRides],
    ['BookingPaymentModal', bookingModal],
  ];

  for (const [name, source] of protectedFiles) {
    if (forbiddenDirectStatusWrite.test(source)) {
      failures.push(`${name}: escritura directa de rides.status detectada; usar RPC de ciclo de viaje`);
    }
    forbiddenDirectStatusWrite.lastIndex = 0;
  }

  if (!rideService.includes("updateRideStatus está deshabilitado en producción")) {
    failures.push('rideService: updateRideStatus genérico debe permanecer deshabilitado');
  }

  if (!rideService.includes('assertBusinessSuccess')) {
    failures.push('rideService: faltan comprobaciones de éxito de negocio en RPC');
  }
}

for (const warning of warnings) console.warn(`⚠️  ${warning}`);

if (failures.length > 0) {
  console.error('\n❌ Auditoría del ciclo de viaje fallida:');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('✅ Ciclo de viaje protegido: publicación, reserva, inicio, finalización, cancelación y plazas usan la arquitectura esperada.');
