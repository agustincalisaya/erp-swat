/**
 * HU-B2 (Módulo B) — Constantes del cierre de turno de caja con arqueo ciego
 * (task_relos.md, Sección 0.1). `spec_modulo_B.md` §5 documenta el umbral de
 * diferencia de arqueo como una entidad de configuración global faltante —
 * mismo gap que `UMBRAL_MINIMO_HOMOLOGACION` de HU-H5
 * (`proveedores/evaluacion.constants.ts`) y el % de descuento máximo de
 * HU-B4. Vive como constante de código, no como entidad de configuración en
 * base de datos — esa entidad no existe hoy en Módulo D. Si en el futuro
 * Módulo D expone una entidad de configuración global real, migrar el valor
 * ahí sin cambiar `turno-caja.service.ts` ni `turno-caja.calculo.ts`.
 *
 * ⚠️ Valor sugerido (pesos), pendiente de validar con Dirección.
 */
export const UMBRAL_DIFERENCIA_ARQUEO = 500;
