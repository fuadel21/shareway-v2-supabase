> ESTADO: este documento queda alineado con la migración canónica del 02/09/2026. Las referencias históricas a porcentajes, tiempos o tramos antiguos se sustituyen por las reglas vigentes descritas abajo.

# 📜 REGLAS DE NEGOCIO COMPLETAS: SHAREWAY V2
## Documentación Exhaustiva de Todas las Políticas y Restricciones

**Versión:** 2.0.0  
**Última Actualización:** 2026-02-09  
**Tipo:** Especificación Técnica de Reglas de Negocio

---

## 📋 ÍNDICE

1. [Reglas de Viajes](#1-reglas-de-viajes)
2. [Reglas de Precios](#2-reglas-de-precios)
3. [Reglas de Reservas](#3-reglas-de-reservas)
4. [Reglas de Cancelación](#4-reglas-de-cancelación)
5. [Reglas de Pagos y Finanzas](#5-reglas-de-pagos-y-finanzas)
6. [Reglas de Reembolsos](#6-reglas-de-reembolsos)
7. [Reglas de Retiros (Payouts)](#7-reglas-de-retiros-payouts)
8. [Reglas de Usuarios y Perfiles](#8-reglas-de-usuarios-y-perfiles)
9. [Reglas de Verificación y Seguridad](#9-reglas-de-verificación-y-seguridad)
10. [Reglas de Gamificación y Ecología](#10-reglas-de-gamificación-y-ecología)
11. [Reglas de Reseñas y Reputación](#11-reglas-de-reseñas-y-reputación)
12. [Reglas de Chat y Comunicación](#12-reglas-de-chat-y-comunicación)
13. [Reglas de Matching](#13-reglas-de-matching)
14. [Reglas de Vehículos](#14-reglas-de-vehículos)
15. [Reglas de Disputas](#15-reglas-de-disputas)
16. [Reglas de Administración](#16-reglas-de-administración)
17. [Reglas de Datos y Privacidad](#17-reglas-de-datos-y-privacidad)

---

## 1. REGLAS DE VIAJES

### 1.1 Creación de Viajes (Conductor)

#### Temporalidad
- **RN-V001:** Un viaje debe programarse con **mínimo 20 minutos de anticipación** desde el momento actual
  - Código: `RIDE_RULES.MIN_ADVANCE_MINUTES = 20`
  - Validación: Frontend + Backend (RPC)
  - Excepción: Ninguna

#### Asientos
- **RN-V002:** Número de asientos permitidos: **1 a 8**
  - Mínimo: `RIDE_RULES.MIN_SEATS = 1`
  - Máximo: `RIDE_RULES.MAX_SEATS = 8`
  - Validación: `CHECK (seats_total > 0)` en DB

- **RN-V003:** `seats_available` debe ser siempre ≤ `seats_total`
  - Actualización automática al confirmar pasajeros
  - Bloqueo pesimista (`FOR UPDATE`) en reservas

#### Ubicaciones
- **RN-V004:** Origen y destino son **obligatorios**
  - Formato: JSONB con `{lat, lng, address, name}`
  - Validación de coordenadas GPS válidas (no NaN, no Infinity)
  - Almacenamiento adicional en `GEOGRAPHY(POINT, 4326)` para búsquedas geoespaciales

- **RN-V005:** Waypoints (puntos intermedios) son **opcionales**
  - Formato: Array de JSONB
  - Máximo: Sin límite técnico (recomendado ≤ 5 para UX)

#### Estados del Viaje
- **RN-V006:** Estados permitidos:
  - `scheduled` - Programado (default)
  - `active` - Activo (conductor puede aceptar pasajeros en ruta)
  - `in_progress` - En curso (viaje iniciado)
  - `completed` - Completado
  - `cancelled` - Cancelado
  - `expired` - Expirado (automático si `departure_time` pasó sin iniciar)

- **RN-V007:** Transiciones de estado válidas:
  ```
  scheduled → active (al iniciar viaje)
  scheduled → cancelled (cancelación)
  scheduled → expired (automático)
  active → in_progress (al verificar primer pasajero)
  active → cancelled (cancelación)
  in_progress → completed (al completar)
  in_progress → cancelled (cancelación excepcional)
  ```

#### Restricciones Especiales
- **RN-V008:** Viajes "Solo Mujeres" (`is_women_only = true`)
  - Solo conductoras mujeres pueden crear
  - Solo pasajeras mujeres pueden reservar
  - Validación de género en perfil

- **RN-V009:** Viajes de Comunidad Exclusiva (`is_exclusive_community = true`)
  - Solo miembros de comunidades permitidas (`allowed_communities[]`)
  - Validación de dominio de email

#### Modificación de Viajes
- **RN-V010:** Un viaje puede modificarse si:
  - Estado = `scheduled`
  - No tiene pasajeros confirmados, O
  - Todos los pasajeros aprueban el cambio (futuro)

- **RN-V011:** Campos modificables:
  - `departure_time` (con restricción de anticipación)
  - `seats_total` (solo aumentar si hay pasajeros)
  - `price` (solo disminuir)
  - `details`
  - `is_women_only` (solo si no hay pasajeros)

### 1.2 Solicitudes de Viaje (Pasajero)

- **RN-V012:** Una solicitud debe incluir:
  - Origen (obligatorio)
  - Destino (opcional - puede ser "hacia X dirección")
  - Fecha/hora de salida deseada
  - Número de asientos necesarios (1-8)
  - Precio sugerido

- **RN-V013:** Estados de solicitud:
  - `pending` - Esperando conductor
  - `accepted` - Conductor aceptó (viaje creado)
  - `rejected` - Conductor rechazó
  - `fulfilled` - Reserva completada
  - `expired` - Expiró sin respuesta

- **RN-V014:** Expiración automática:
  - Si `departure_time` pasó sin aceptación → `expired`
  - Cron job cada hora

---

## 2. REGLAS DE PRECIOS

### 2.1 Cálculo de Precio Sugerido

- **RN-P001:** Precio dinámico por distancia (sistema de tiers):
  - Desde 100 km se aplica una tarifa marginal fija de **0,15 €/km**, sin un límite superior de distancia.
  ```
  0-15 km:     0.30€/km
  15-100 km:   0.22€/km
  +100 km:     0.15€/km (sin límite de distancia)
  ```
  - Código: `RIDE_PRICING_CONFIG.TIERS` en `pricingRules.js`
  - Cálculo progresivo (ej: 150km = 15×0.30 + 85×0.22 + 50×0.15 = 30.70€)

- **RN-P002:** Precio mínimo absoluto: **0.50€**
  - `RIDE_RULES.MIN_PRICE = 0.50`
  - Aplicable incluso a viajes muy cortos

- **RN-P003:** Precio máximo absoluto: **300€**
  - `RIDE_RULES.MAX_PRICE = 300`
  - Límite de seguridad anti-fraude

### 2.2 Validación de Precios

- **RN-P004:** El precio propuesto **NO puede superar** el precio sugerido
  - Margen de tolerancia: +0.05€ (por redondeo)
  - Validación: `validateRidePrice()` en frontend y backend
  - Mensaje: "Para garantizar precios justos, no puedes superar el precio recomendado"

- **RN-P005:** El precio propuesto **SÍ puede ser menor** que el sugerido
  - Sin límite inferior (excepto MIN_PRICE)
  - Permite viajes solidarios o compartidos entre conocidos

- **RN-P006:** La fórmula progresiva es la única tarifa de referencia.
  - Sus límites absolutos son 0,50–300,00 € por plaza.
  - El servidor valida la distancia y el precio; no se mantiene una tarifa paralela por km.

### 2.3 Comisiones de Plataforma

- **RN-P007:** Comisión estándar: **10%** sobre el importe bruto realmente pagado
  - Está incluida en el precio por plaza mostrado al pasajero; no se añade como cargo separado
  - Conductor recibe: 90%
  - Plataforma recibe: 10%

- **RN-P008:** Distribución al completar viaje:
  ```
  Por cada pasajero:
    - Pasajero pagó: X€ (retenido en held_balance)
    - Conductor recibe: X × 0.90€
    - Plataforma recibe: X × 0.10€
    - Pasajero: se libera el hold wallet; Stripe no se acredita dos veces
    - Conductor: balance += X × 0.90, registra trip_earning
    - Tesorería: balance += X × 0.10, registra platform_fee
  ```

- **RN-P009:** La comisión se calcula sobre el precio **efectivamente pagado**
  - Si hubo descuento, la comisión es sobre el precio con descuento
  - Si hubo reembolso parcial, la comisión se ajusta

---

## 3. REGLAS DE RESERVAS

### 3.1 Validaciones de Reserva

- **RN-R001:** Un usuario **NO puede reservar su propio viaje**
  - Validación: `driver_id != auth.uid()`
  - Error: "No puedes reservar tu propio viaje"

- **RN-R002:** Un usuario **NO puede reservar dos veces el mismo viaje**
  - Validación: `user_id NOT IN participant_ids`
  - Error: "Ya tienes una reserva en este viaje"

- **RN-R003:** Debe haber **asientos disponibles**
  - Validación: `seats_available >= seats_requested`
  - Bloqueo pesimista: `FOR UPDATE` en tabla rides
  - Error: "No hay asientos disponibles"

- **RN-R004:** El usuario debe tener **saldo suficiente** (pago con wallet)
  - Validación: `balance >= price × seats_requested`
  - Error: "Saldo insuficiente"

- **RN-R005:** Viajes "Solo Mujeres": Verificar género
  - Validación: `is_women_only = true → user.gender = 'female'`
  - Error: "Este viaje es exclusivo para mujeres"

### 3.2 Proceso de Reserva

- **RN-R006:** Al reservar con **saldo (wallet)**:
  1. Verificar saldo disponible
  2. Mover dinero: `balance → held_balance` (escrow)
  3. Registrar transacción tipo `hold`
  4. Generar PIN de 4 dígitos
  5. Añadir pasajero al array `passengers[]` con status `confirmed`
  6. Actualizar `participant_ids[]`
  7. Decrementar `seats_available`
  8. Notificar al conductor

- **RN-R007:** Al reservar con **tarjeta (Stripe)**:
  1. Crear Payment Intent en Stripe
  2. Registrar intención en `ride_requests` con `payment_intent_id`
  3. Usuario completa pago en Stripe
  4. Webhook recibe `payment_intent.succeeded`
  5. Llamar a `fulfill_booking_after_payment()`
  6. Mover dinero a `held_balance` interno (escrow)
  7. Añadir pasajero al viaje
  8. Marcar request como `fulfilled`

### 3.3 Verificación de Pasajeros

- **RN-R008:** Sistema de PIN de 4 dígitos
  - Generado al reservar
  - Único por pasajero por viaje
  - Conductor verifica presencialmente
  - Al verificar: status `confirmed` → `verified` o `confirmed_by_pin`

- **RN-R009:** Modos de aprobación:
  - **Automático** (`approval_mode = 'automatic'`): Reserva instantánea
  - **Manual** (`approval_mode = 'manual'`): Conductor debe aprobar
    - Status inicial: `pending`
    - Conductor acepta: `pending` → `confirmed`
    - Conductor rechaza: `pending` → `rejected` + reembolso

### 3.4 Ubicación de Recogida

- **RN-R010:** El pasajero puede especificar punto de recogida personalizado
  - Formato: `{lat, lng}` + `address` (texto)
  - Guardado en el objeto pasajero: `pickup_location`, `pickup_address`
  - Visible para el conductor en la lista de pasajeros

---

## 4. REGLAS DE CANCELACIÓN

### 4.1 Cancelación por Conductor

- **RN-C001:** Penalización según urgencia:
  ```
  < 2 horas antes:     5.00€
  2-24 horas antes:    2.00€
  > 24 horas antes:    0.00€
  ```

- **RN-C002:** Distribución de penalización:
  - 50% → Pasajeros confirmados (compensación equitativa)
  - 50% → Plataforma (tesorería)

- **RN-C003:** Reembolso a pasajeros:
  - **100% del precio pagado** + compensación
  - Dinero vuelve de `held_balance` a `balance`
  - Transacción tipo: `refund`

- **RN-C004:** Proceso:
  1. Calcular penalización según `departure_time - NOW()`
  2. Descontar penalización de `balance` del conductor
  3. Calcular compensación por pasajero: `(penalización × 0.5) / num_pasajeros`
  4. Para cada pasajero confirmado:
     - Reembolsar: `balance += booked_price + compensación`
     - Liberar escrow: `held_balance -= booked_price`
  5. Enviar 50% de penalización a tesorería
  6. Actualizar estado del viaje: `cancelled`
  7. Notificar a todos los pasajeros

### 4.2 Cancelación por Pasajero

- **RN-C005:** Política de reembolso:
  ```
  > 24h antes de salida:              100%
  < 15min desde reserva Y > 3h antes: 100% (arrepentimiento rápido)
  2-24h antes:                        50%
  < 2h antes:                         0%
  ```

- **RN-C006:** Distribución de penalización (si aplica):
  - 80% → Conductor (compensación)
  - 20% → Plataforma

- **RN-C007:** Proceso:
  1. Calcular reembolso según tiempo restante
  2. Calcular penalización: `booked_price - refund_amount`
  3. Reembolsar al pasajero: `balance += refund_amount`
  4. Liberar escrow: `held_balance -= booked_price`
  5. Distribuir penalización (80/20)
  6. Liberar asiento: `seats_available += seats_booked`
  7. Actualizar status del pasajero: `cancelled`
  8. Remover de `participant_ids[]`

### 4.3 Protección Anti-Abuso

- **RN-C008:** Contador de cancelaciones (30 días):
  - Almacenado en `profiles.cancellation_count_30d`
  - Actualizado en cada cancelación
  - Reset automático cada 30 días

- **RN-C009:** Penalizaciones por abuso:
  ```
  3+ cancelaciones:  -0.1 puntos de rating
  5+ cancelaciones:  -0.3 puntos de rating + suspensión 7 días
  ```

- **RN-C010:** Suspensión temporal:
  - `is_suspended = true`
  - `suspension_until = NOW() + 7 days`
  - Usuario no puede crear viajes ni reservar
  - Levantamiento automático al expirar

---

## 5. REGLAS DE PAGOS Y FINANZAS

### 5.1 Sistema de Wallet (Cartera Interna)

- **RN-F001:** Cada usuario tiene una wallet con:
  - `balance` - Saldo disponible para usar
  - `held_balance` - Saldo en garantía (escrow)
  - Relación: `total_funds = balance + held_balance`

- **RN-F002:** Wallet de Tesorería:
  - UUID: `00000000-0000-0000-0000-000000000000`
  - Recibe todas las comisiones y penalizaciones de plataforma
  - No puede ser negativa

- **RN-F003:** Transacciones registradas en `wallet_transactions`:
  - Tipos: `deposit`, `hold`, `trip_payment`, `trip_earning`, `refund`, `withdraw`, `platform_fee`, `cancellation_fee`, etc.
  - Cada transacción incluye: `amount`, `balance_after`, `description`, `related_ride_id`
  - Inmutables (no se pueden editar ni borrar)

### 5.2 Escrow (Held Balance)

- **RN-F004:** Al reservar un viaje:
  - Dinero se mueve de `balance` → `held_balance`
  - Permanece bloqueado hasta que el viaje se complete o cancele
  - Previene que el usuario gaste el mismo dinero dos veces

- **RN-F005:** Al completar viaje:
  - La wallet solo libera el hold de pagos wallet; Stripe no se acredita dos veces
  - `balance` del conductor += bruto × 0.90
  - `balance` de tesorería += bruto × 0.10
  - El bruto es precio por plaza × plazas, redondeado a céntimos

- **RN-F006:** Al cancelar:
  - `held_balance` → `balance` (reembolso)
  - Penalizaciones se descuentan de `balance` disponible

### 5.3 Bloqueos y Concurrencia

- **RN-F007:** Bloqueo pesimista en operaciones críticas:
  - `SELECT ... FOR UPDATE` en `wallets` y `rides`
  - Previene race conditions
  - Garantiza atomicidad

- **RN-F008:** Idempotencia en pagos externos:
  - Verificación de `payment_intent_id` duplicado
  - Si ya existe transacción con ese ID: retornar éxito sin procesar
  - Previene double-spending en caso de retry de webhook

### 5.4 Validaciones Financieras

- **RN-F009:** Balance nunca puede ser negativo:
  - Validación antes de cada operación
  - `CHECK (balance >= 0)` en DB (opcional, manejado en lógica)

- **RN-F010:** Held balance nunca puede ser negativo:
  - Validación antes de liberar escrow
  - Error si se intenta liberar más de lo retenido

- **RN-F011:** Suma de balances debe ser consistente:
  - `SUM(balance + held_balance)` de usuarios = Total esperado
  - Auditoría periódica recomendada

---

## 6. REGLAS DE REEMBOLSOS

### 6.1 Reembolsos Automáticos

- **RN-RE001:** Reembolso por cancelación de conductor:
  - Siempre 100% del precio pagado
  - Más compensación si aplica penalización
  - Automático al ejecutar `cancel_ride()`

- **RN-RE002:** Reembolso por cancelación de pasajero:
  - Según política de tiempo (ver RN-C005)
  - Automático al ejecutar `cancel_booking_and_refund()`

- **RN-RE003:** Reembolso por no-show del conductor:
  - 100% + compensación adicional (configurable)
  - Requiere reporte del pasajero

### 6.2 Disputas y Reembolsos Extraordinarios

- **RN-RE004:** Disputa por fuerza mayor:
  - Usuario puede crear disputa con evidencia
  - Tabla: `cancellation_disputes`
  - Campos: `reason`, `evidence_urls[]`, `refund_amount`
  - Status: `pending` → `approved` o `rejected`

- **RN-RE005:** Aprobación de disputa:
  - Solo administradores pueden aprobar/rechazar
  - Si aprobada: Reembolso 100% desde escrow o tesorería
  - Registro en `refund_logs` para auditoría

- **RN-RE006:** Reembolso forzado por admin:
  - Función: `admin_force_refund()`
  - Puede devolver dinero incluso si viaje ya completó
  - Fuentes: `held_balance` (preferido) o `tesorería`
  - Requiere `reason` obligatorio
  - Registrado en `refund_logs` con `processed_by = admin_id`

### 6.3 Logs de Auditoría

- **RN-RE007:** Todos los reembolsos manuales se registran:
  - Tabla: `refund_logs`
  - Campos: `ride_id`, `user_id`, `amount`, `type`, `reason`, `processed_by`
  - Inmutables
  - Consultables por admin para auditoría financiera

---

## 7. REGLAS DE RETIROS (PAYOUTS)

### 7.1 Solicitud de Retiro

- **RN-PO001:** Mínimo para retiro: **10.00€** (configurable)
  - Validación en frontend y backend

- **RN-PO002:** Al solicitar retiro:
  1. Verificar saldo disponible (`balance >= amount`)
  2. Restar inmediatamente de `balance`
  3. Crear registro en `payout_requests` con status `pending`
  4. Registrar transacción tipo `withdraw_request`

- **RN-PO003:** Estados de retiro:
  - `pending` - Esperando procesamiento
  - `processing` - En proceso por admin
  - `completed` - Transferido exitosamente
  - `cancelled` - Cancelado por usuario o admin
  - `failed` - Falló la transferencia

### 7.2 Procesamiento

- **RN-PO004:** Procesamiento manual por administrador:
  - Admin revisa solicitud
  - Ejecuta transferencia en Stripe/banco
  - Actualiza status a `completed`
  - Registra `stripe_payout_id` si aplica

- **RN-PO005:** Tiempo de procesamiento:
  - Estimado: 1-3 días hábiles
  - Comunicado al usuario al solicitar

### 7.3 Cancelación de Retiro

- **RN-PO006:** Usuario puede cancelar si status = `pending`:
  - Función: `cancel_payout(payout_id)`
  - Devuelve dinero a `balance`
  - Actualiza status a `cancelled`
  - Registra transacción tipo `withdraw_cancel`

- **RN-PO007:** No se puede cancelar si status = `processing` o `completed`
  - Error: "La solicitud ya está en proceso"

---

## 8. REGLAS DE USUARIOS Y PERFILES

### 8.1 Registro y Autenticación

- **RN-U001:** Email obligatorio y único
  - Validación de formato email
  - Verificación de email requerida (opcional, configurable)

- **RN-U002:** Contraseña mínima: 8 caracteres (Supabase default)
  - Recomendado: Incluir mayúsculas, minúsculas, números

- **RN-U003:** Al crear cuenta:
  - Se crea automáticamente perfil en `profiles`
  - Se crea automáticamente wallet en `wallets` con balance = 0
  - Trigger: `on_auth_user_created`

### 8.2 Perfil de Usuario

- **RN-U004:** Campos obligatorios:
  - `display_name` - Nombre visible
  - `email` - Email (heredado de auth)

- **RN-U005:** Campos opcionales:
  - `phone` - Teléfono
  - `photo_url` - Foto de perfil
  - `bio` - Biografía
  - `gender` - Género (para viajes solo mujeres)
  - `date_of_birth` - Fecha de nacimiento

- **RN-U006:** Campos calculados automáticamente:
  - `rating` - Promedio de reseñas (1-5)
  - `total_co2_saved` - CO2 total ahorrado (kg)
  - `rides_count` - Número de viajes completados
  - `eco_tier` - Tier ecológico (bronze/silver/gold/platinum)

### 8.3 Verificación de Identidad

- **RN-U007:** Verificación opcional pero recomendada:
  - `is_verified = true` tras verificación manual
  - Aumenta confianza de otros usuarios
  - Puede ser requisito para ciertos viajes

- **RN-U008:** Verificación de conductor (Stripe Connect):
  - Requerida para recibir pagos
  - `stripe_account_id` - ID de cuenta Stripe
  - `stripe_account_verified` - Estado de verificación
  - Proceso: Onboarding de Stripe Connect

---

## 9. REGLAS DE VERIFICACIÓN Y SEGURIDAD

### 9.1 Verificación de Pasajeros (PIN)

- **RN-S001:** PIN de 4 dígitos:
  - Generado al reservar
  - Formato: `1000-9999` (numérico)
  - Único por pasajero por viaje

- **RN-S002:** Verificación presencial:
  - Pasajero muestra PIN al conductor
  - Conductor ingresa PIN en app
  - Si correcto: status → `verified` o `confirmed_by_pin`
  - Si incorrecto: Error, máximo 3 intentos (futuro)

### 9.2 Seguridad de Datos

- **RN-S003:** Row Level Security (RLS) habilitado en todas las tablas:
  - Usuarios solo ven sus propios datos
  - Conductores solo editan sus viajes
  - Pasajeros solo cancelan sus reservas
  - Admins tienen acceso total

- **RN-S004:** Datos sensibles:
  - Contraseñas: Hasheadas por Supabase Auth
  - PINs: Almacenados en texto plano (solo 4 dígitos, bajo riesgo)
  - Datos de pago: Nunca almacenados (manejados por Stripe)

### 9.3 Contactos de Emergencia

- **RN-S005:** Cada usuario puede registrar contactos de emergencia:
  - Tabla: `emergency_contacts`
  - Campos: `name`, `phone`
  - Máximo: 3 contactos (recomendado)

- **RN-S006:** Botón SOS en viaje activo:
  - Envía ubicación GPS a contactos de emergencia
  - Notifica a plataforma
  - Crea chat de emergencia con soporte

---

## 10. REGLAS DE GAMIFICACIÓN Y ECOLOGÍA

### 10.1 Cálculo de CO2 Ahorrado

- **RN-G001:** Fórmula de cálculo:
  ```
  CO2_ahorrado = distancia_km × 0.12 kg/km × (num_pasajeros)
  ```
  - Basado en emisiones promedio de vehículo vs transporte individual
  - Factor: 0.12 kg CO2/km (configurable)

- **RN-G002:** Distribución de CO2:
  - Conductor: Recibe CO2 total del viaje
  - Cada pasajero: Recibe `CO2_total / num_pasajeros`
  - Actualizado al completar viaje

### 10.2 Tiers Ecológicos

- **RN-G003:** Clasificación por CO2 ahorrado:
  ```
  Bronze:    0-10 kg
  Silver:    10-50 kg
  Gold:      50-200 kg
  Platinum:  200+ kg
  ```

- **RN-G004:** Actualización automática:
  - Calculado en cada viaje completado
  - Trigger: `handle_ride_update_notifications`

### 10.3 Logros (Achievements)

- **RN-G005:** Logros desbloqueables:
  - `FIRST_RIDE` - Primer viaje completado
  - `CO2_SAVER_1` - 10kg de CO2 ahorrado
  - `CO2_SAVER_2` - 50kg de CO2 ahorrado
  - `SOCIAL_DRIVER` - 10 viajes como conductor
  - `ECO_WARRIOR` - 100kg de CO2 ahorrado
  - (Más logros configurables en tabla `achievements`)

- **RN-G006:** Desbloqueo automático:
  - Al alcanzar umbral → Insertar en `user_achievements`
  - Notificación al usuario
  - Visible en perfil público

---

## 11. REGLAS DE RESEÑAS Y REPUTACIÓN

### 11.1 Creación de Reseñas

- **RN-REV001:** Solo pueden reseñar participantes del viaje:
  - Conductor puede reseñar a pasajeros
  - Pasajeros pueden reseñar al conductor
  - Validación: `user_id IN (driver_id, participant_ids)`

- **RN-REV002:** Una reseña por persona por viaje:
  - Constraint: `UNIQUE(ride_id, reviewer_id, reviewee_id)`
  - Previene reseñas duplicadas

- **RN-REV003:** Reseña solo después de completar viaje:
  - Validación: `ride.status = 'completed'`
  - Error: "Solo puedes reseñar viajes completados"

### 11.2 Contenido de Reseña

- **RN-REV004:** Rating obligatorio: 1-5 estrellas
  - Validación: `CHECK (rating >= 1 AND rating <= 5)`

- **RN-REV005:** Comentario opcional:
  - Máximo: 500 caracteres (recomendado)
  - Sanitización de HTML/XSS

### 11.3 Cálculo de Rating

- **RN-REV006:** Rating promedio del usuario:
  ```
  rating = AVG(rating) de todas las reseñas recibidas
  ```
  - Actualizado automáticamente al recibir nueva reseña
  - Trigger: `update_user_rating_on_review`

- **RN-REV007:** Peso de reseñas:
  - Todas las reseñas tienen el mismo peso (futuro: peso por antigüedad)

---

## 12. REGLAS DE CHAT Y COMUNICACIÓN

### 12.1 Creación de Chats

- **RN-CH001:** Chat automático por viaje:
  - Se crea al confirmar primer pasajero
  - Participantes: Conductor + todos los pasajeros confirmados
  - Tabla: `chats` con `ride_id`

- **RN-CH002:** Participantes del chat:
  - Solo conductor y pasajeros confirmados
  - Actualización automática al añadir/remover pasajeros

### 12.2 Mensajes

- **RN-CH003:** Tipos de mensaje:
  - `text` - Texto plano
  - `image` - Imagen (URL de Supabase Storage)
  - `audio` - Audio (URL de Supabase Storage)
  - `location` - Ubicación GPS (JSONB con lat/lng)

- **RN-CH004:** Límites:
  - Texto: 1000 caracteres
  - Imagen: 5MB
  - Audio: 2MB, máximo 60 segundos

### 12.3 Realtime

- **RN-CH005:** Mensajes en tiempo real:
  - Supabase Realtime Channels
  - Suscripción por `chat_id`
  - Eventos: `INSERT` en tabla `messages`

- **RN-CH006:** Indicadores de lectura:
  - Array `read_by[]` con UUIDs de usuarios
  - Actualizado al abrir chat

### 12.4 Expiración

- **RN-CH007:** Chats se archivan automáticamente:
  - 30 días después de completar/cancelar viaje
  - Cron job: `cleanup_old_chats()`
  - Mensajes no se borran, solo se marcan como archivados

---

## 13. REGLAS DE MATCHING

### 13.1 Búsqueda de Viajes

- **RN-M001:** Parámetros de búsqueda:
  - Origen (obligatorio) - coordenadas GPS
  - Destino (opcional)
  - Fecha/hora (opcional, rango ±3h)
  - Asientos necesarios (default: 1)
  - Precio máximo (default: 999.99€)
  - Radio de proximidad (default: 15km)

- **RN-M002:** Algoritmo de matching:
  1. Filtrar por proximidad de origen (ST_DWithin)
  2. Filtrar por proximidad de destino (si especificado)
  3. Filtrar por fecha/hora compatible
  4. Filtrar por asientos disponibles
  5. Filtrar por precio ≤ máximo
  6. Ordenar por proximidad + precio

### 13.2 Matching Proactivo

- **RN-M003:** Notificaciones automáticas:
  - Al crear viaje → Buscar solicitudes compatibles
  - Al crear solicitud → Buscar viajes compatibles
  - Trigger: `invoke_match_engine`

- **RN-M004:** Criterios de compatibilidad:
  - Origen dentro de radio (15km default)
  - Destino dentro de radio (si especificado)
  - Fecha/hora ±3 horas
  - Asientos suficientes
  - Precio compatible

---

## 14. REGLAS DE VEHÍCULOS

### 14.1 Registro de Vehículos

- **RN-V101:** Campos obligatorios:
  - `make` - Marca
  - `model` - Modelo
  - `year` - Año
  - `seats` - Número de asientos
  - `fuel_type` - Tipo de combustible

- **RN-V102:** Tipos de combustible permitidos:
  - `gasoline` - Gasolina
  - `diesel` - Diésel
  - `electric` - Eléctrico
  - `hybrid` - Híbrido
  - `plugin_hybrid` - Híbrido enchufable

### 14.2 Validaciones

- **RN-V103:** Año del vehículo:
  - Mínimo: 1990
  - Máximo: Año actual + 1

- **RN-V104:** Número de asientos:
  - Mínimo: 2
  - Máximo: 9 (vehículos particulares)

### 14.3 Estado del Vehículo

- **RN-V105:** Estados:
  - `active` - Activo, puede usarse en viajes
  - `inactive` - Inactivo, no disponible

- **RN-V106:** Un usuario puede tener múltiples vehículos:
  - Sin límite técnico
  - Recomendado: Máximo 3 para UX

---

## 15. REGLAS DE DISPUTAS

### 15.1 Creación de Disputa

- **RN-D001:** Motivos válidos para disputa:
  - Cancelación por fuerza mayor
  - Conductor no se presentó
  - Pasajero no se presentó
  - Comportamiento inapropiado
  - Problema con el vehículo
  - Otro (especificar)

- **RN-D002:** Evidencia requerida:
  - Descripción detallada (`reason`)
  - Evidencia opcional: URLs de imágenes (`evidence_urls[]`)
  - Máximo 5 imágenes por disputa

### 15.2 Procesamiento

- **RN-D003:** Estados de disputa:
  - `pending` - Esperando revisión
  - `approved` - Aprobada, reembolso procesado
  - `rejected` - Rechazada

- **RN-D004:** Solo administradores pueden resolver:
  - Función: `resolve_ride_dispute()`
  - Acciones posibles:
    - `refund_passenger` - Reembolso total al pasajero
    - `payout_driver` - Pago al conductor (cerrar disputa)
    - `split_50_50` - Dividir 50/50

### 15.3 Tiempos

- **RN-D005:** Tiempo de resolución:
  - Objetivo: 24-48 horas
  - Notificación al usuario al resolver

---

## 16. REGLAS DE ADMINISTRACIÓN

### 16.1 Permisos de Admin

- **RN-A001:** Campo `is_admin` en perfil:
  - `true` - Usuario es administrador
  - `false` - Usuario normal (default)

- **RN-A002:** Acciones exclusivas de admin:
  - Aprobar/rechazar disputas
  - Forzar reembolsos
  - Aprobar retiros
  - Suspender usuarios
  - Verificar identidades
  - Ver estadísticas de plataforma
  - Exportar datos

### 16.2 Suspensión de Usuarios

- **RN-A003:** Suspensión manual:
  - Función: `admin_suspend_user(user_id, reason)`
  - Campos: `is_suspended = true`, `suspension_until`
  - Usuario no puede crear viajes ni reservar

- **RN-A004:** Levantamiento de suspensión:
  - Automático al expirar `suspension_until`
  - Manual por admin: `admin_lift_suspension(user_id)`

### 16.3 Estadísticas

- **RN-A005:** Métricas disponibles:
  - Total de usuarios activos
  - Total de viajes completados
  - Total de CO2 ahorrado
  - Total de ingresos (comisiones)
  - Tasa de cancelación
  - Rating promedio de plataforma

---

## 17. REGLAS DE DATOS Y PRIVACIDAD

### 17.1 GDPR Compliance

- **RN-P001:** Derecho al olvido:
  - Usuario puede solicitar eliminación de cuenta
  - Datos personales se anonimizan
  - Transacciones financieras se mantienen (anonimizadas) por ley

- **RN-P002:** Exportación de datos:
  - Usuario puede solicitar copia de sus datos
  - Formato: JSON
  - Incluye: perfil, viajes, transacciones, mensajes

### 17.2 Retención de Datos

- **RN-P003:** Períodos de retención:
  - Mensajes de chat: 30 días post-viaje
  - Transacciones financieras: 7 años (requisito legal)
  - Viajes completados: Indefinido (anonimizados tras 2 años)
  - Notificaciones: 90 días

### 17.3 Privacidad del Perfil

- **RN-P004:** Datos públicos:
  - Nombre visible
  - Foto de perfil
  - Rating
  - CO2 ahorrado
  - Eco tier

- **RN-P005:** Datos privados:
  - Email (solo visible para participantes de viaje)
  - Teléfono (solo visible para participantes de viaje)
  - Fecha de nacimiento
  - Balance de wallet

---

## 📊 RESUMEN DE CONSTANTES CLAVE

```javascript
// Viajes
MIN_ADVANCE_MINUTES = 10
MIN_SEATS = 1
MAX_SEATS = 8

// Precios
MIN_PRICE = 0.50€
MAX_PRICE = 300€
PLATFORM_COMMISSION = 10%

// Pricing Tiers (acumulativos)
0-15km:    0.30€/km
15-100km:  0.22€/km
+100km:    0.15€/km (sin límite de distancia)

// Cancelaciones (Conductor)
< 2h:   5.00€
2-24h:  2.00€
> 24h:  0.00€

// Cancelaciones (Pasajero)
> 24h o < 15min: 100% reembolso
2-24h:           50% reembolso
< 2h:            0% reembolso

// Penalizaciones por Abuso
3+ cancelaciones: -0.1 rating
5+ cancelaciones: -0.3 rating + suspensión 7 días

// CO2
Factor: 0.12 kg/km por pasajero

// Eco Tiers
Bronze:   0-10 kg
Silver:   10-50 kg
Gold:     50-200 kg
Platinum: 200+ kg
```

---

**Versión:** 2.0.0  
**Última Actualización:** 2026-02-09  
**Total de Reglas:** 150+  
**Autor:** ShareWay Engineering Team
