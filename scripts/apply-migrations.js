#!/usr/bin/env node

/**
 * Script Automatizado para Aplicar Migraciones de Shareway
 * Aplica todas las migraciones SQL en orden correcto
 * 
 * Uso: node apply-migrations.js [--env=development|production]
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { program } from 'commander';

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
    },
    {
        file: 'FIX_GET_USER_NOTIFICATIONS.sql',
        description: 'Fix RPC get_user_notifications column error',
        critical: true
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

// Función para ejecutar SQL
async function executeSQL(client, sql, description) {
    try {
        log.info(`Ejecutando: ${description}`);

        const { error, data } = await client.rpc('exec_sql', { sql_string: sql });

        if (error) {
            throw error;
        }

        log.success(`✅ Completado: ${description}`);
        return data;
    } catch (error) {
        log.error(`❌ Error en ${description}: ${error.message}`);
        throw error;
    }
}

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

// Función para verificar si ya se aplicó una migración
async function checkMigrationApplied(client, migrationName) {
    try {
        const { error, data } = await client
            .from('migration_logs')
            .select('*')
            .eq('migration_name', migrationName)
            .single();

        return !error && data;
    } catch (error) {
        // Si la tabla no existe, asumimos que no se ha aplicado
        return false;
    }
}

// Función para registrar migración aplicada
async function markMigrationApplied(client, migrationName, sqlContent) {
    try {
        const { error } = await client
            .from('migration_logs')
            .insert({
                migration_name: migrationName,
                sql_content: sqlContent,
                applied_at: new Date().toISOString(),
                success: true
            });

        if (error) {
            log.warning(`⚠️ No se pudo registrar migración: ${error.message}`);
        }
    } catch (error) {
        log.warning(`⚠️ Error al registrar migración: ${error.message}`);
    }
}

// Función para crear tabla de logs si no existe
async function ensureMigrationLogsTable(client) {
    const createTableSQL = `
        CREATE TABLE IF NOT EXISTS public.migration_logs (
            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            migration_name TEXT NOT NULL UNIQUE,
            sql_content TEXT,
            applied_at TIMESTAMPTZ DEFAULT NOW(),
            success BOOLEAN DEFAULT true,
            error_message TEXT,
            execution_time_ms INTEGER
        );
    `;

    try {
        await client.rpc('exec_sql', { sql_string: createTableSQL });
        log.info('Tabla migration_logs verificada/creada');
    } catch (error) {
        log.warning(`⚠️ Error creando tabla migration_logs: ${error.message}`);
    }
}

// Función principal
async function applyMigrations(options = {}) {
    const { env = 'development', force = false, skipNonCritical = false } = options;

    log.cyan('='.repeat(60));
    log.cyan('🚀 SHAREWAY - SCRIPT DE MIGRACIONES AUTOMATIZADO');
    log.cyan('='.repeat(60));
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

    // Crear tabla de logs
    await ensureMigrationLogsTable(client);

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
            // Verificar si ya fue aplicada
            const isApplied = await checkMigrationApplied(client, migration.file);

            if (isApplied && !force) {
                log.info(`⏭️  Saltando (ya aplicada): ${migration.file}`);
                skippedCount++;
                continue;
            }

            // Leer y ejecutar SQL
            const sql = readSQLFile(migration.file);

            const startTime = Date.now();
            await executeSQL(client, sql, migration.description);
            const executionTime = Date.now() - startTime;

            // Registrar migración
            await markMigrationApplied(client, migration.file, sql);

            // Actualizar registro con tiempo de ejecución
            await client
                .from('migration_logs')
                .update({ execution_time_ms: executionTime })
                .eq('migration_name', migration.file);

            appliedCount++;

            // Pequeña pausa entre migraciones críticas
            if (migration.critical) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

        } catch (error) {
            errorCount++;

            if (migration.critical) {
                log.critical(`💥 ERROR CRÍTICO en ${migration.file}: ${error.message}`);

                // Registrar error
                try {
                    await client
                        .from('migration_logs')
                        .insert({
                            migration_name: migration.file,
                            error_message: error.message,
                            success: false
                        });
                } catch (logError) {
                    // Ignorar error de logging
                }

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
    log.cyan('='.repeat(60));
    log.cyan('📊 RESUMEN DE MIGRACIÓN');
    log.cyan('='.repeat(60));
    log.info(`✅ Aplicadas: ${appliedCount}`);
    log.info(`⏭️  Saltadas: ${skippedCount}`);
    log.info(`❌ Errores: ${errorCount}`);

    if (errorCount > 0) {
        log.warning('⚠️ Algunas migraciones fallaron. Revisa los errores y ejecuta con --force si es necesario.');
    }

    if (appliedCount > 0) {
        log.success('🎉 ¡Migraciones aplicadas exitosamente!');
        log.info('📌 Recuerda reiniciar tu servidor de desarrollo si es necesario');

        if (env === 'development') {
            log.info('💡 Para desarrollo: npm run dev');
            log.info('💡 Para producción: npm run build && npm run preview');
        }
    } else if (skippedCount > 0) {
        log.info('ℹ️  Todas las migraciones ya estaban aplicadas');
    }

    log.cyan('='.repeat(60));

    return {
        applied: appliedCount,
        skipped: skippedCount,
        errors: errorCount,
        success: errorCount === 0
    };
}

// Configuración de CLI
program
    .name('apply-migrations')
    .description('Aplica todas las migraciones SQL de Shareway en orden correcto')
    .option('-e, --env', 'Entorno a usar (development|production)', 'development')
    .option('-f, --force', 'Forzar reaplicación de todas las migraciones', false)
    .option('-s, --safe', 'Solo aplicar migraciones críticas', false)
    .option('--dry-run', 'Mostrar qué migraciones se aplicarían sin ejecutarlas', false)
    .action(async (options) => {
        if (options.dryRun) {
            log.cyan('🔍 MODO DRY RUN - Solo mostrar migraciones');
            log.info(`Entorno: ${options.env}`);
            log.info(`Migraciones a procesar: ${MIGRATIONS.length}`);
            log.info(`Modo seguro: ${options.safe ? 'Sí' : 'No'}`);

            const toApply = options.safe
                ? MIGRATIONS.filter(m => m.critical)
                : MIGRATIONS;

            log.info(`Migraciones que se aplicarían: ${toApply.length}`);
            toApply.forEach((migration, index) => {
                log.info(`${index + 1}. ${migration.file} - ${migration.description}`);
            });

            if (options.force) {
                log.warning('⚠️  Con --force se reaplicarían todas las migraciones');
            }

            return;
        }

        const result = await applyMigrations({
            env: options.env,
            force: options.force,
            skipNonCritical: options.safe
        });

        process.exit(result.success ? 0 : 1);
    });

// Exportar para uso programático
export {
    applyMigrations,
    MIGRATIONS
};
