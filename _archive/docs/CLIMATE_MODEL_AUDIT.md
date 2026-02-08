# Modelo de Cálculo de Impacto Ambiental: Sharway
**Versión del Modelo:** 2.0 (EEA Compliance)
**Fecha:** Enero 2026
**Normativa de Referencia:** European Environment Agency (EEA) Emissions Guidebook 2024 / Horizon Europe ESG Metrics

## 1. Resumen Ejecutivo
Este documento define la metodología técnica utilizada por Sharway para cuantificar, auditar y reportar la reducción de emisiones de CO₂ lograda a través del carpooling. El modelo se basa en el principio de **Adicionalidad por Desplazamiento Evitado**, comparando las emisiones reales del viaje compartido contra un escenario contrafactual (Baseline) donde cada pasajero utiliza un vehículo privado promedio.

---

## 2. Fórmula de Cálculo

El Ahorro Neto de CO₂ ($E_{saved}$) se calcula para cada viaje finalizado mediante la siguiente fórmula:

$$ E_{saved} = E_{baseline} - E_{actual} $$

Donde:
- **$E_{baseline}$ (Emisiones Evitadas Teóricas):** Representa las emisiones que se hubieran generado si los pasajeros hubieran realizado el trayecto individualmente.
- **$E_{actual}$ (Emisiones Reales):** Representa las emisiones generadas por el vehículo del conductor durante el trayecto compartido.

### 2.1 Cálculo del Baseline ($E_{baseline}$)
Se asume que cada pasajero adicional (excluyendo al conductor, que ya realizaría el viaje) sustituye un vehículo privado promedio de la flota europea.

$$ E_{baseline} = N_{pax} \times D_{km} \times F_{avg\_EU} $$

- $N_{pax}$: Número de pasajeros confirmados en el viaje.
- $D_{km}$: Distancia del trayecto en kilómetros.
- $F_{avg\_EU}$: Factor de emisión promedio de un turismo en la UE (108 g CO₂/km, fuente: EEA 2023 Report).

### 2.2 Cálculo de Emisiones Reales ($E_{actual}$)
Se calculan las emisiones específicas del vehículo utilizado.

$$ E_{actual} = D_{km} \times \frac{C_{eff}}{100} \times F_{fuel} $$

- $C_{eff}$: Eficiencia del vehículo (L/100km o kWh/100km). Si se desconoce, se usa el default conservador (7.0 L/100km).
- $F_{fuel}$: Factor de conversión de combustible a CO₂.

**Tabla de Factores de Conversión ($F_{fuel}$):**
| Tipo de Motor | Factor ($F_{fuel}$) | Unidad | Fuente |
|---|---|---|---|
| Diesel | 2.68 | kg CO₂/L | DEFRA / EEA |
| Gasolina | 2.31 | kg CO₂/L | DEFRA / EEA |
| Eléctrico (EV) | 0.25 | kg CO₂/kWh | Mix Eléctrico Medio UE |
| Híbrido | 1.50 | kg CO₂/L (eq) | Estimación Mixta |

---

## 3. Suposiciones y Justificación para Auditoría

### 3.1 Principio de Conservadurismo
Para evitar el "Greenwashing", el modelo adopta posturas conservadoras:
- **Ocupación:** Solo se cuentan pasajeros con estado `completed` o `verified`.
- **Baseline:** Se utiliza el promedio de flota UE (108g), que es menor que la flota antigua real en muchos países miembros, subestimando deliberadamente el ahorro para mayor robustez.
- **Eficiencia Default:** Si el usuario no provee datos, se asume un coche de 7L/100km (relativamente ineficiente), lo que aumenta $E_{actual}$ y reduce el ahorro reportado.

### 3.2 Trazabilidad (Audit Trail)
Cada cálculo genera un registro inmutable en la tabla `climate_audit_logs` con:
- Snapshot de los factores usados en el momento del cálculo.
- IDs anonimizados de conductor y pasajeros.
- Metadatos del vehículo.

Esto permite que un auditor externo reconstruya cualquier cifra reportada años después, incluso si los factores de emisión cambian en el futuro.

---

## 4. Visualización al Usuario

El impacto se presenta al usuario en tres niveles para incentivar el cambio de comportamiento:

1.  **Nivel Micro (Ride Detail):** "En este viaje ahorraste X kg de CO₂".
2.  **Nivel Macro (Profile):** Acumulado histórico y equivalencias tangibles (ej. "Has salvado el equivalente a 5 árboles").
3.  **Gamificación:** Medallas (Badges) desbloqueables por hitos de sostenibilidad (ver `Achievements.jsx`).

---

## 5. Datos Mínimos Requeridos

Para operar el modelo con precisión, el sistema requiere:
1.  **Distancia del Viaje:** Obtenida vía OSRM/Google Routes.
2.  **Número de Pasajeros:** Validado por el sistema de reservas.
3.  **Tipo de Motor:** Input del usuario (con fallback a Gasolina).
4.  **Eficiencia (Opcional):** Input del usuario (con fallback a 7L/100km).
