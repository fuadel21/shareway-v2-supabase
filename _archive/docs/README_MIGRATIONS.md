# Shareway - Script de Aplicación de Migraciones

## 🚀 Uso

### Aplicar todas las migraciones:
```bash
node apply-migrations.js
```

### Aplicar solo migraciones críticas (modo seguro):
```bash
node apply-migrations.js --safe
```

### Forzar reaplicación de todas las migraciones:
```bash
node apply-migrations.js --force
```

### Modo desarrollo:
```bash
node apply-migrations.js --env=development
```

### Modo producción:
```bash
node apply-migrations.js --env=production
```

### Ver qué migraciones se aplicarían (dry run):
```bash
node apply-migrations.js --dry-run
```

## 📋 Migraciones en Orden de Aplicación

### 🚨 CRÍTICAS (Fase 1)
1. `20260118_FIX_RACE_CONDITIONS.sql` - Race conditions en confirm_trip_and_pay
2. `20260118_ADMIN_PERMISSIONS.sql` - Permisos de admin y auditoría
3. `20260118_IMPLEMENT_ESCROW.sql` - Sistema de escrow para fondos
4. `20260118_RATE_LIMITING_VALIDATIONS.sql` - Rate limiting y validaciones

### 🎯 FEATURES (Fase 2-4)
5. `20260118_RATING_SYSTEM.sql` - Sistema de rating y reviews
6. `20260118_REPUTATION_SYSTEM.sql` - Sistema de reputación y badges
7. `20260118_NOTIFICATIONS_SYSTEM.sql` - Sistema de notificaciones
8. `20260118_EMAIL_TEMPLATES.sql` - Email templates y automatización
9. `20260118_GAMIFICATION_SYSTEM.sql` - Sistema de gamificación y lealtad
10. `20260118_CHALLENGES_SYSTEM.sql` - Desafíos y sistema de progresión

## ⚙️ Variables de Entorno

### Desarrollo (.env.local)
```bash
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### Producción
```bash
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
```

## 🔧 Requisitos Previos

1. **Node.js** instalado (versión 16+)
2. **Variables de entorno** configuradas
3. **Acceso a la base de datos** con permisos de administrador
4. **Backup** de la base de datos (opcional pero recomendado)

## 📋 Características

- ✅ **Orden automático**: Aplica migraciones en la secuencia correcta
- ✅ **Verificación de conexión**: Valida que puede conectarse a Supabase
- ✅ **Detección de duplicados**: Salta migraciones ya aplicadas (a menos que se use --force)
- ✅ **Logging detallado**: Muestra progreso y errores con colores
- ✅ **Modo seguro**: Opción para aplicar solo migraciones críticas
- ✅ **Dry run**: Muestra qué se aplicaría sin ejecutar
- ✅ **Registro de auditoría**: Guarda logs de cada migración aplicada
- ✅ **Manejo de errores**: Continúa o se detiene según criticidad
- **⏱️ Pausas automáticas**: Pequeñas pausas entre migraciones críticas

## 🚨 Ejecución

El script aplicará las migraciones en orden, verificando cada paso:

1. **Verificar conexión** a la base de datos
2. **Crear tabla de logs** si no existe
3. **Aplicar cada migración** en orden
4. **Verificar éxito** antes de continuar
5. **Registrar auditoría** de cada migración
6. **Mostrar resumen** final

## 📊 Logs y Auditoría

Cada migración se registra en la tabla `public.migration_logs`:
- Nombre de la migración
- Contenido SQL completo
- Fecha y hora de aplicación
- Tiempo de ejecución
- Estado (éxito/error)
- Mensaje de error si aplica

## 🔄 Post-Ejecución

Después de aplicar las migraciones:

1. **Reiniciar servidor** de desarrollo si es necesario
2. **Verificar tablas** creadas en Supabase
3. **Probar las nuevas funcionalidades**
4. **Revisar logs** para verificar que todo se aplicó correctamente

## 🛠️ Recuperación de Errores

Si una migración falla:

1. **Revisar el error** en el log
2. **Corregir el problema** (generalmente SQL o permisos)
3. **Ejecutar con --force** si es seguro
4. **Verificar estado** de la base de datos

## 📞 Soporte

Para problemas o preguntas:
- Revisar los logs generados por el script
- Verificar las variables de entorno
- Validar permisos de la base de datos
- Consultar la documentación de cada migración
