#!/usr/bin/env node

/**
 * Script de Verificación Pre-Migración
 * Verifica que todo esté listo antes de comenzar la migración
 */

import fs from 'fs';
import path from 'path';

console.log('\n🔍 VERIFICANDO PREPARACIÓN PARA MIGRACIÓN...\n');

let errors = [];
let warnings = [];
let success = [];

// 1. Verificar que existen los archivos SQL
const sqlFiles = [
    'supabase/schema.sql',
    'supabase/rpc_functions.sql',
    'supabase/additional_functions.sql'
];

console.log('📄 Verificando archivos SQL...');
sqlFiles.forEach(file => {
    const filepath = path.join(process.cwd(), file);
    if (fs.existsSync(filepath)) {
        success.push(`✅ ${file} encontrado`);
    } else {
        errors.push(`❌ ${file} NO encontrado`);
    }
});

// 2. Verificar archivos de código
const codeFiles = [
    'src/lib/supabase.js',
    'src/lib/supabaseRPC.js',
    'src/services/rideService.js'
];

console.log('\n💻 Verificando archivos de código...');
codeFiles.forEach(file => {
    const filepath = path.join(process.cwd(), file);
    if (fs.existsSync(filepath)) {
        success.push(`✅ ${file} encontrado`);
    } else {
        errors.push(`❌ ${file} NO encontrado`);
    }
});

// 3. Verificar que existe .env
console.log('\n⚙️  Verificando configuración...');
if (fs.existsSync('.env') || fs.existsSync('.env.local')) {
    success.push('✅ Archivo de entorno (.env o .env.local) encontrado');

    const envFile = fs.existsSync('.env.local') ? '.env.local' : '.env';
    const envContent = fs.readFileSync(envFile, 'utf-8');

    if (envContent.includes('VITE_SUPABASE_URL=https://XXXXX')) {
        warnings.push('⚠️  .env contiene valores placeholder - debes actualizarlo con tus credenciales de Supabase');
    } else if (envContent.includes('VITE_SUPABASE_URL=https://')) {
        success.push('✅ VITE_SUPABASE_URL configurado');
    } else {
        warnings.push('⚠️  VITE_SUPABASE_URL no encontrado en .env');
    }

    if (envContent.includes('VITE_SUPABASE_ANON_KEY=eyXXXXX')) {
        warnings.push('⚠️  VITE_SUPABASE_ANON_KEY contiene valor placeholder');
    } else if (envContent.includes('VITE_SUPABASE_ANON_KEY=')) {
        success.push('✅ VITE_SUPABASE_ANON_KEY configurado');
    } else {
        warnings.push('⚠️  VITE_SUPABASE_ANON_KEY no encontrado en .env');
    }

} else {
    errors.push('❌ Archivo .env NO encontrado');
}

// 4. Verificar node_modules
console.log('\n📦 Verificando dependencias...');
if (fs.existsSync('node_modules/@supabase/supabase-js')) {
    success.push('✅ @supabase/supabase-js instalado');
} else {
    errors.push('❌ @supabase/supabase-js NO instalado - ejecuta: npm install @supabase/supabase-js');
}

// 5. Verificar documentación
console.log('\n📚 Verificando documentación...');
const docs = [
    'MIGRATION_GUIDE.md',
    'MIGRATION_CHECKLIST.md',
    'README_MIGRATION.md'
];

docs.forEach(file => {
    if (fs.existsSync(file)) {
        success.push(`✅ ${file} disponible`);
    } else {
        warnings.push(`⚠️  ${file} no encontrado`);
    }
});

// Mostrar resultados
console.log('\n' + '='.repeat(60));
console.log('\n📊 RESUMEN DE VERIFICACIÓN:\n');

if (success.length > 0) {
    console.log('✅ ÉXITOS:');
    success.forEach(msg => console.log('  ' + msg));
}

if (warnings.length > 0) {
    console.log('\n⚠️  ADVERTENCIAS:');
    warnings.forEach(msg => console.log('  ' + msg));
}

if (errors.length > 0) {
    console.log('\n❌ ERRORES:');
    errors.forEach(msg => console.log('  ' + msg));
}

console.log('\n' + '='.repeat(60));

// Conclusión
if (errors.length === 0 && warnings.length > 0) {
    console.log('\n🟡 Estado: CASI LISTO');
    console.log('\n📝 Próximos pasos:');
    console.log('  1. Crear proyecto en Supabase (https://supabase.com/dashboard)');
    console.log('  2. Obtener credenciales (Settings > API)');
    console.log('  3. Actualizar archivo .env con tus credenciales');
    console.log('  4. Ejecutar scripts SQL en Supabase SQL Editor');
    console.log('\n📖 Ver: MIGRATION_CHECKLIST.md para instrucciones detalladas');
} else if (errors.length === 0) {
    console.log('\n✅ Estado: LISTO PARA MIGRAR');
    console.log('\n🚀 Puedes comenzar con la Fase 1: Setup de Supabase');
    console.log('📖 Sigue: MIGRATION_CHECKLIST.md');
} else {
    console.log('\n❌ Estado: NO LISTO');
    console.log('\nPor favor resuelve los errores antes de continuar.');
}

console.log('\n');
