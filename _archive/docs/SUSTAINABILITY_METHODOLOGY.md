# Metodología de Sostenibilidad y Cálculo de Impacto
*Versión 1.0 - Enero 2026*

Este documento detalla la metodología utilizada por Shareway para calcular, reportar y auditar el impacto ambiental (reducción de emisiones de CO₂) generado por el uso de nuestra plataforma de movilidad compartida.

## 1. Principios Generales
Nuestra metodología se alinea con los estándares de la **Agencia Europea de Medio Ambiente (AEMA/EEA)** y los requisitos de **Horizon Europe** para la justificación de impacto ambiental. Nos basamos en datos científicos y factores de emisión oficiales para evitar el *greenwashing* y garantizar la transparencia.

## 2. Fórmula de Cálculo
El cálculo del "Ahorro de CO₂" se basa en un enfoque contrafactual (Baseline vs. Real).

**Fórmula General:**
$$ \text{Ahorro} = (\text{Emisiones Baseline}) - (\text{Emisiones Reales}) $$

### 2.1. Baseline (Escenario Contrafactual)
Representa las emisiones que se habrían generado si el pasajero hubiera realizado el viaje en un vehículo privado promedio de un solo ocupante.
*   **Factor de Emisión:** 120g CO₂/km (Promedio flota UE 2024 para vehículos de combustión mixta).
*   **Cálculo:** $\text{Distancia (km)} \times 120g$

### 2.2. Emisiones Reales (Escenario Shareway)
Representa las emisiones reales generadas por el vehículo compartido, prorrateadas por el número de ocupantes.
*   **Factor de Vehículo:**
    *   Vehículo Eléctrico (EV): 0g CO₂/km (emisiones directas).
    *   Híbrido: ~90g CO₂/km.
    *   Combustión (Gasolina/Diesel): ~140g CO₂/km.
*   **Cálculo:** $\frac{\text{Distancia (km)} \times \text{Factor Vehículo}}{\text{Número de Ocupantes}}$

*Nota: Al compartir vehículo, las emisiones totales se dividen entre todos los ocupantes, reduciendo la huella de carbono individual.*

## 3. Trazabilidad y Auditoría
Para garantizar la integridad de los datos ante organismos reguladores y procesos de subvención (Grants):
*   **Registro Inmutable:** Cada viaje completado genera un registro en nuestra tabla `climate_audit_logs`.
*   **Bloqueo de Datos:** Una vez registrado, el impacto no puede ser modificado.
*   **Transparencia:** Los usuarios pueden descargar un reporte de su impacto histórico.

## 4. Descargo de Responsabilidad (Disclaimer)
Las cifras mostradas son **estimaciones científicas** basadas en distancias geoespaciales y promedios de flota.
*   No constituyen créditos de carbono financieros ni instrumentos comercializables.
*   El objetivo es la concienciación y la gamificación de la sostenibilidad.
*   Factores externos como tráfico, estilo de conducción o clima no están contemplados en este modelo simplificado.
