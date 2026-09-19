/**
 * HU-B1 (Módulo B) — Constantes de venta de mostrador con cobro multimedio
 * (docs/tasks/task_relos.md, Sección 0.7). `spec_modulo_B.md` §5 documenta el
 * porcentaje máximo de descuento por perfil como una entidad de configuración
 * global faltante — mismo gap que `UMBRAL_DIFERENCIA_ARQUEO` de HU-B2
 * (`turno-caja.constants.ts`) y `UMBRAL_MINIMO_HOMOLOGACION` de HU-H5. Vive
 * como constante de código, no como entidad de configuración en base de
 * datos — esa entidad no existe hoy en Módulo D. Si en el futuro Módulo D
 * expone una entidad de configuración global real, migrar el valor ahí sin
 * cambiar `venta-mostrador.service.ts`.
 *
 * ⚠️ Valor sugerido (porcentaje), pendiente de validar con Dirección.
 */
export const MARGEN_DESCUENTO_CAJERO_POS = 5;
