#!/usr/bin/env node

/**
 * Script Simplificado para Aplicar Migraciones de Shareway
 * Aplica migraciones SQL directamente sin necesidad de exec_sql
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { program } from 'commander';

// Obtener __dirname en ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuración
const config = {
    development: {
        supabaseUrl: process.env.VITE_SUPABASE_URL,
        supabaseAnonKey: process.env.VITE_SUPABASE_ANON_KEY
    },
    production: {
        supabaseUrl: process.env.SUPABASE_URL,
        supabaseAnonKey: process.env.SUPABASE_ANON_KEY
    }
};

// Lista de migraciones en orden de aplicación
const MIGRATIONS = [
    {
        file: '20260118_FIX_RACE_CONDITIONS.sql',
        description: 'Fix crítico: Race conditions en confirm_trip_and_pay',
        critical: true
    },
    {
        file: '20260118_ADMIN_PERMISSIONS.sql',
        description: 'Fix crítico: Permisos de admin y auditoría',
        critical: true
    },
    {
        file: '20260118_IMPLEMENT_ESCROW.sql',
        description: 'Fix crítico: Sistema de escrow para fondos',
        critical: true
    },
    {
        file: '20260118_RATE_LIMITING_VALIDATIONS.sql',
        description: 'Fix crítico: Rate limiting y validaciones',
        critical: true
    },
    {
        file: '20260118_RATING_SYSTEM.sql',
        description: 'Sistema de rating y reviews completo',
        critical: false
    },
    {
        file: '20260118_REPUTATION_SYSTEM.sql',
        description: 'Sistema de reputación y badges',
        critical: false
    },
    {
        file: '20260118_NOTIFICATIONS_SYSTEM.sql',
        description: 'Sistema de notificaciones completo',
        critical: false
    },
    {
        file: '20260118_EMAIL_TEMPLATES.sql',
        description: 'Email templates y automatización',
        critical: false
    },
    {
        file: '20260118_GAMIFICATION_SYSTEM.sql',
        description: 'Sistema de gamificación y lealtad',
        critical: false
    },
    {
        file: '20260118_CHALLENGES_SYSTEM.sql',
        description: 'Desafíos y sistema de progresión',
        critical: false
    }
];

// Colores para consola
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    bright: '\x1b[1m'
};

// Funciones de utilidad
const log = {
    info: (message) => console.log(`${colors.cyan}[INFO]${colors.reset} ${message}`),
    success: (message) => console.log(`${colors.green}[SUCCESS]${colors.reset} ${message}`),
    warning: (message) => console.log(`${colors.yellow}[WARNING]${colors.reset} ${message}`),
    error: (message) => console.log(`${colors.red}[ERROR]${colors.reset} ${message}`),
    critical: (message) => console.log(`${colors.bright}${colors.red}[CRITICAL]${colors.reset} ${message}`)
};

const printCyan = (text) => console.log(`${colors.cyan}${text}${colors.reset}`);

// Función para leer archivo SQL
function readSQLFile(filename) {
    const filePath = path.join(__dirname, 'supabase/migrations', filename);
    
    if (!fs.existsSync(filePath)) {
        throw new Error(`Archivo no encontrado: ${filePath}`);
    }
    
    return fs.readFileSync(filePath, 'utf8');
}

// Función para verificar conexión
async function verifyConnection(client) {
    try {
        const { error, data } = await client.from('profiles').select('count').single();
        
        if (error) {
            throw error;
        }
        
        log.success('✅ Conexión a Supabase verificada');
        return true;
    } catch (error) {
        log.error('❌ Error de conexión a Supabase:');
        log.error(error.message);
        return false;
    }
}

// Función para ejecutar SQL usando el endpoint SQL de Supabase
async function executeSQLDirect(supabaseUrl, supabaseKey, sql, description) {
    try {
        log.info(`Ejecutando: ${description}`);
        
        const response = await fetch(`${supabaseUrl}/rest/v1/rpc/`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json',
                'apikey': supabaseKey
            },
            body: JSON.stringify({
                query: sql
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
        
        log.success(`✅ Completado: ${description}`);
        return await response.json();
    } catch (error) {
        log.error(`❌ Error en ${description}: ${error.message}`);
        throw error;
    }
}

// Función principal
async function applyMigrations(options = {}) {
    const { env = 'development', force = false, skipNonCritical = false } = options;
    
    printCyan('='.repeat(60));
    printCyan('🚀 SHAREWAY - SCRIPT DE MIGRACIONES AUTOMATIZADO');
    printCyan('='.repeat(60));
    log.info(`Entorno: ${env}`);
    log.info(`Migraciones totales: ${MIGRATIONS.length}`);
    
    if (skipNonCritical) {
        const criticalCount = MIGRATIONS.filter(m => m.critical).length;
        log.warning(`⚠️ Modo seguro: Solo ${criticalCount} migraciones críticas`);
    }
    
    // Configuración de Supabase
    const envConfig = config[env];
    if (!envConfig.supabaseUrl || !envConfig.supabaseAnonKey) {
        log.error('❌ Variables de entorno no encontradas');
        log.error('Asegúrate de tener VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY');
        process.exit(1);
    }
    
    const client = createClient(envConfig.supabaseUrl, envConfig.supabaseAnonKey);
    
    // Verificar conexión
    const isConnected = await verifyConnection(client);
    if (!isConnected) {
        log.error('❌ No se puede conectar a la base de datos');
        process.exit(1);
    }
    
    // Aplicar migraciones
    let appliedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    for (const migration of MIGRATIONS) {
        // Saltar no críticas si está en modo seguro
        if (skipNonCritical && !migration.critical) {
            skippedCount++;
            continue;
        }
        
        try {
            // Leer SQL
            const sql = readSQLFile(migration.file);
            
            // Mostrar información de la migración
            log.info(`📄 Procesando: ${migration.file}`);
            log.info(`📝 Descripción: ${migration.description}`);
            
            // Para este script, solo mostraremos el contenido SQL
            // y daremos instrucciones para aplicarlo manualmente
            printCyan('\n' + '='.repeat(50));
            printCyan(`SQL para aplicar manualmente en Supabase:`);
            printCyan('='.repeat(50));
            console.log(sql);
            printCyan('='.repeat(50));
            
            appliedCount++;
            
            // Pausa para revisar
            if (migration.critical) {
                log.info('⏸️  Pausa para revisar la migración crítica...');
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            
        } catch (error) {
            errorCount++;
            
            if (migration.critical) {
                log.critical(`💥 ERROR CRÍTICO en ${migration.file}: ${error.message}`);
                
                if (!force) {
                    log.error('❌ Deteniendo ejecución por error crítico');
                    break;
                }
            } else {
                log.error(`❌ Error en ${migration.file}: ${error.message}`);
            }
        }
    }
    
    // Resumen final
    printCyan('='.repeat(60));
    printCyan('📊 RESUMEN DE MIGRACIÓN');
    printCyan('='.repeat(60));
    log.info(`✅ Procesadas: ${appliedCount}`);
    log.info(`⏭️  Saltadas: ${skippedCount}`);
    log.info(`❌ Errores: ${errorCount}`);
    
    if (appliedCount > 0) {
        printCyan('\n📋 INSTRUCCIONES PARA APLICAR LAS MIGRACIONES:');
        printCyan('1. Copia cada bloque SQL mostrado arriba');
        printCyan('2. Ve a tu panel de Supabase');
        printCyan('3. Navega a SQL Editor');
        printCyan('4. Pega y ejecuta cada migración en orden');
        printCyan('5. Verifica que no haya errores');
        
        if (env === 'development') {
            log.info('💡 Después de aplicar: pnpm dev');
        }
    }
    
    printCyan('='.repeat(60));
    
    return {
        applied: appliedCount,
        skipped: skippedCount,
        errors: errorCount,
        success: errorCount === 0
    };
}

// Configuración de CLI
program
    .name('apply-migrations-manual')
    .description('Muestra las migraciones SQL para aplicar manualmente en Supabase')
    .option('-e, --env', 'Entorno a usar (development|production)', 'development')
    .option('-s, --safe', 'Solo mostrar migraciones críticas', false)
    .action(async (options) => {
        const result = await applyMigrations({
            env: options.env,
            skipNonCritical: options.safe
        });
        
        process.exit(result.success ? 0 : 1);
    });

// Ejecutar el programa
program.parse();
