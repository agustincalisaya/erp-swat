# Excepción al filtrado por defecto de inactivos — Reporte de Variantes Inactivas (Criterio 2)

**Cambio**: HU-A6 Ajustes — UI de Variantes.

## Regla base

- `RULES.md` §1 / `spec_modulo_A.md` §3.3: los SELECT de la capa de servicios
  filtran `is_active: true` por defecto; el histórico completo queda reservado
  al Módulo de Auditoría.

## Excepción

La pestaña **Inactivas** de la vista `/inventario/variantes` lista
`is_active = false` para cumplir el **Criterio 2** del Product Backlog
("stock remanente visible en reportes de inventario inactivo, sin ofrecerse
en ningún canal de venta").

## Alcance — SOLO LECTURA

- La única función que consulta inactivos es
  `listarVariantesPaginadas()` (add-only, `src/lib/services/inventario/variante.service.ts`),
  y lo hace porque la vista lo exige explícitamente (`tab=inactivas`), no como
  default de ningún SELECT de operación.
- La pestaña **no ofrece ninguna acción de escritura**: sin baja, sin edición
  y sin reactivación (la reactivación no existe por diseño; la baja es
  irreversible vía la aplicación).
- Ningún endpoint de operación estándar expone el flag al cliente HTTP.

## Verificación

- `git diff` del backend de baja (`darDeBajaVariante`, `ModalJustificacionBaja`,
  `actions.ts`, `audit-log.listener.ts`, `event-types.ts`) sin cambios
  (criterio 8).