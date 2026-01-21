# Estrategia de Incentivos Climáticos: Sharway "Green Miles"

Este documento define los mecanismos para incentivar decisiones sostenibles en la plataforma, alineados con objetivos de reducción de CO₂ y criterios de grants de la UE.

## 1. Mecanismos de Incentivos

### A. "Green Miles" (Eco-Puntos) por Ocupación
Incentivamos maximizar la ocupación del vehículo, ya que es el factor #1 de reducción de emisiones por persona.

*   **Mecanismo:** El conductor recibe puntos canjeables o estatus por cada pasajero transportado.
*   **Fórmula:** `Puntos = Distancia_km * (Pasajeros + 1) * Factor_Vehículo`
*   **Bonus "Full House":** +20% de puntos si el coche va lleno (ocupación 100%).
*   **Visualización:** "Llena 1 asiento más para ganar 50 Green Miles extra".

### B. Prioridad "Eco-First" en Búsquedas
Los viajes más sostenibles aparecen primero, premiando a los conductores eficientes.

*   **Mecanismo:** El algoritmo de búsqueda ordena los resultados considerando un "Eco-Score" además del tiempo y precio.
*   **Criterio de Prioridad:**
    1.  Alta Ocupación Potencial (coches con 3+ plazas disponibles en rutas populares).
    2.  Vehículos de Bajas Emisiones (EVs, Híbridos).
    3.  Conductores con alto "Lifetime CO2 Saved".
*   **Impacto:** Aumenta la probabilidad de "match" para conductores sostenibles.

### C. Gamificación: Niveles de Impacto (Eco-Tiers)
Reconocimiento público del compromiso ambiental del usuario.

*   **Niveles:**
    1.  **Seed (Semilla):** Nuevo usuario.
    2.  **Sapling (Brote):** 100 kg CO₂ ahorrados.
    3.  **Tree (Árbol):** 500 kg CO₂ ahorrados.
    4.  **Forest (Bosque):** 1,000+ kg CO₂ ahorrados (Badges especiales).
*   **Recompensas:** Badge en perfil, acceso anticipado a eventos, descuentos en fees (futuro).

### D. Penalizaciones Suaves ("Nudges")
En lugar de castigar, mostramos el "costo de oportunidad" ambiental.

*   **Mecanismo:**
    *   **Conductor:** Si publica un viaje con precio muy alto (que desincentiva reservas), mostrar: "Tu precio es alto. Bajarlo 2€ podría llenar tu coche y ahorrar 15kg más de CO₂".
    *   **Cancelaciones:** Si cancela un viaje lleno, pierde puntos de "Reliability" y "Green Miles".

---

## 2. Evaluación de Impacto y Riesgos

### Impacto Real Estimado
*   **Reducción Directa:** Aumentar la ocupación promedio de 1.5 a 2.5 personas reduce las emisiones *per cápita* en un 40%.
*   **Adopción de EVs:** Al priorizar EVs en búsquedas, incentivamos a los dueños de eléctricos a compartir más (ya que llenarán más rápido).

### Riesgos de Manipulación
*   **"Ghost Rides":** Usuarios creando viajes falsos con amigos para ganar puntos.
    *   *Mitigación:* Los puntos solo se otorgan tras la confirmación GPS de que el viaje ocurrió (ya implementado en `Ride Completion Logic`).
    *   *Límite:* Puntos máximos diarios/semanales.

### Aceptación del Usuario
*   **Pros:** Gamificación positiva, sentimiento de contribución.
*   **Contras:** Si la prioridad "Eco-First" oculta viajes más convenientes (ej. más rápidos).
    *   *Solución:* La prioridad Eco es un "boost", no un filtro absoluto. El precio y horario siguen siendo dominantes, pero ante igualdad, gana el Eco.

---

## 3. Métricas Medibles (KPIs)

Para reportes de la UE:

1.  **Tasa de Ocupación Promedio:** (Objetivo: >2.2 pax/viaje).
2.  **% de Km en Vehículos Cero Emisiones:** Crecimiento MoM (Mes a Mes).
3.  **CO₂ Ahorrado por Usuario Activo:** Métrica de eficiencia de la comunidad.
4.  **Tasa de Conversión de "Nudges":** % de usuarios que bajan precio o aceptan más pasajeros tras ver el mensaje de impacto.

---

## 4. Implementación Técnica (Base de Datos)

*   **Tabla `profiles`:** Nuevos campos `eco_points`, `eco_tier`, `vehicle_emission_class`.
*   **Tabla `climate_audit_logs`:** Registro de puntos otorgados por viaje para auditoría.
*   **RPC `search_rides`:** Modificado para ordenar por score compuesto (Eco + Relevancia).
