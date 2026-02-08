# 🧪 ShareWay V2 - Quality Assurance Bible

## 📜 Manifiesto de Calidad (Reglas de Oro)
> **"Nunca escribas tests que dependan de la implementación interna."**

### ✅ APLICA
1.  **Observables**: Testea lo que el usuario ve o la API devuelve.
2.  **Estados Finales**: Valida el resultado después de la acción, no el proceso.
3.  **Efectos Reales**: CRUD en base de datos, cambios en DOM visible, navegación.

### 🚫 PROHIBIDO
1.  **Estados Internos**: No asserts sobre `useState`, `variables`, o métodos privados.
2.  **Hooks Privados**: No testear custom hooks aislados a menos que sean librerías compartidas.
3.  **Estructura Frágil**: Evitar selectores CSS complejos que rompen con refactors de estilo (usar `role`, `text`, `label`).

### 🛡️ Atomicidad
1.  **Un Escenario**: Cada test debe probar UNA cosa.
2.  **Fallo Único**: Si falla, debe ser obvio por qué (un solo assert principal o relacionados).
3.  **Naming**: El nombre debe describir: `should [resultado] when [escenario]`.

### 🧠 Lógica Pura (Desacoplamiento)
1.  **Extracción**: Toda lógica crítica (validaciones, precios, filtros) debe vivir en funciones puras `utils/*.js` o `services/*.js`.
2.  **Cero React**: Si necesitas renderizar un componente para probar una suma, el diseño está mal.
3.  **Testabilidad**: Las funciones puras son triviales de testear con unit tests rápidos.

### 💎 Determinismo
1.  **Mockear Tiempo**: Nunca usar `new Date()` real. Usar `vi.setSystemTime`.
2.  **Datos Controlados**: Mockear IDs aleatorios y respuestas de API. El input siempre debe ser el mismo.
3.  **Cero Flakes**: Un test que falla el 1% de las veces es BASURA. Elimínalo o arréglalo.
4.  **No Red Real**: Unit tests nunca tocan internet. Integration tests usan entorno controlado local o staging dedicado.

### ☣️ Aislamiento de Datos
1.  **NO PROD**: Los tests automáticos JAMÁS tocan la base de datos de producción.
2.  **Seed Controlado**: Los tests deben correr contra un set de datos conocido y limpio.
3.  **Clean Slate**: Cada ejecución debe limpiar su estado o usar transacciones rollback (si aplica).
4.  **Sin Dependencias**: El Test B no debe depender de que el Test A haya creado un usuario.

### ⚡ Concurrencia
1.  **Race Conditions**: Si hay dinero o plazas de por medio, haz un test con `Promise.all`.
2.  **Simulación Real**: Usa múltiples clientes para simular usuarios distintos atacando al mismo tiempo.
3.  **Locks**: No asumas que la BD lo maneja. Pruébalo.

### 💥 Resiliencia y Caos
1.  **Happy Path != Done**: Si solo probaste el caso feliz, has hecho el 50% del trabajo.
2.  **Red Hostil**: Testea qué pasa si la API da timeout o devuelve 500.
3.  **Datos Corruptos**: Inyecta nulls, undefineds y strings vacíos donde no deben ir.
4.  **Rollbacks**: Si falla el paso 3 de 5, asegura que los pasos 1 y 2 se deshagan.

### 🎭 Estrategia E2E (La Cúpula)
1.  **Solo Critical Paths**: Ofrecer viaje, Reservar, Cancelar, Login. NADA MÁS.
2.  **No trivialidades**: No uses Playwright para ver si un input tiene borde rojo. Usa Unit Tests.
3.  **Coste**: Un E2E cuesta 100x más de mantener que un Unit Test. Úsalos con avaricia.

### 📚 Documentación Viva
1.  **Naming que narra**: `should [resultado] when [condición]`.
2.  **GWT**: Estructura tus tests en comentarios o bloques: `// Given` (contexto), `// When` (acción), `// Then` (resultado).
3.  **Legibilidad > Hacks**: Prefiero 3 líneas claras que una "clever one-liner" que nadie entiende.

### 🐛 Política de Cero Regresiones
1.  **Test First**: Si encuentras un bug, PRIMERO escribes un test que falle (Rojo).
2.  **Fix Second**: Arreglas el bug hasta que el test pase (Verde).
3.  **Never Again**: Ese test se queda para siempre. Si vuelve a fallar, rompiste algo.
4.  **No Exceptions**: Arreglar "una cosita rápida" sin test es prohibido.

### Principios Fundamentales
1. **Confiabilidad > Cantidad**: Preferimos 10 tests que validen comportamiento real a 100 tests que pasen con mocks falsos.
2. **Cero Falsos Positivos**: Si un test pasa, la funcionalidad DEBE funcionar.
3. **Validación en Capas**: 
   - Lógica Pura → Contract Tests
   - UI → Smoke Tests
   - Negocio → Integration Tests
   - Flujos → E2E Tests (✅ Activo)

---

## 🏗️ Arquitectura de Testing

### 1. 🛡️ Integration Tests (Core Business)
*La red de seguridad principal. Usan una base de datos real (Supabase Test Project).*

| Archivo | Propósito | Estado |
|---------|-----------|--------|
| `businessRules.integration.test.js` | Valida reglas críticas (Precio Justo, Solapamiento, Verificación). | ✅ Activo |
| `concurrency.integration.test.js` | Valida condiciones de carrera y prevención de overbooking. | ✅ Activo |
| `cancellation.integration.test.js` | Valida políticas de reembolso y cancelación. | 🚧 Parcial (Waiting RPCs) |
| `bookingFlow.integration.test.js` | Valida el ciclo de vida completo del viaje. | 🚧 Parcial (Waiting RPCs) |

### 2. 📜 Contract Tests (Pure Logic)
*Lógica de negocio pura y validación de inputs. Cero dependencias externas, ejecución instantánea.*

| Archivo | Propósito |
|---------|-----------|
| `bookingService.test.js` | Valida cálculos de reembolsos y validación de inputs de reserva. |
| `rideService.test.js` | Valida normalización de coordenadas y estructura de datos de viajes. |

### 3. 💨 Smoke Tests (UI Stability)
*Garantizan que los componentes críticos renderizan sin explotar. Sin lógica compleja.*

| Archivo | Propósito |
|---------|-----------|
| `CreateRide.test.jsx` | Verifica que el formulario de publicación carga. |
| `RideDetails.test.jsx` | Verifica que la vista de detalles carga y muestra mapa. |

---

## 🚀 Guía de Ejecución

### Setup Inicial
Necesario antes de correr los tests de integración.

```bash
# 1. Configurar variables de entorno (ver .env.test.example)
# 2. Provisionar datos de prueba
node scripts/seed-test.js
```

### Comandos
```bash
# Ejecutar TODO (Recomendado antes de push)
npm run test

# Ejecutar tests de negocio (Integration/Unit)
npm run test:coverage

# Ejecutar tests E2E (Simulación Usuario Real)
pnpm exec playwright test

# Ejecutar solo setup de autenticación
pnpm exec playwright test --project=setup

# Debuggear tests E2E
pnpm exec playwright test --debug
```

### 4. 🎭 End-to-End (E2E) con Playwright
Valida flujos completos en navegador real (Chromium).
- **Setup**: `auth.setup.ts` se loguea y guarda la sesión.
- **Flujos**: `booking-happy-path.spec.ts` valida navegación autenticada.
- **Nota**: El servidor corre en modo test (`pnpm run dev --mode test`) para usar `.env.test`.

---

## 🛠️ Cómo Escribir Tests (Style Guide)

### ✅ DOs (Lo que sí hacemos)
* **Usar `TEST_USERS` del seed**: `driver.elite@shareway.test`, etc.
* **Separar lógica pura**: Si es una función de cálculo (`calculateRefund`), testéala unitariamente.
* **Probar fallos**: Asegura que el sistema rechaza lo que debe rechazar (saldo insuficiente, overbooking).
* **Usar `it.todo()`**: Para marcar funcionalidad pendiente de backend.

### ❌ DON'Ts (Lo que NO hacemos)
* **Mockear Supabase RPCs en Unit Tests**: Crea falsos positivos. Usa Integration Tests para eso.
* **Testear librerías de terceros**: No testeamos si `react-router` funciona, testeamos que nuestra app monta la ruta.
* **Hardcodear IDs temporales**: Usa siempre los IDs retornados por la BD o los fijos del seed script.

---

## 🚧 Roadmap de Calidad

### Pendiente de Backend (RPCs)
- [ ] `start_ride`
- [ ] `complete_ride` y procesamiento de pagos
- [ ] `cancel_booking_and_refund`

### Siguientes Pasos (QA)
1. **Fase C**: E2E con Playwright (Critical Paths)
2. **Fase D**: Performance Testing (K6)

---

**Mantenedor**: QA Principal Team
**Versión**: 2.1.0
