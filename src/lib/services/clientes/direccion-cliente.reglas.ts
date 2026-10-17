/**
 * HU-C3 (Módulo C) — Regla estructural de direcciones de cliente
 * (spec_modulo_C.md §2.3).
 *
 * Módulo PURO y SIN dependencias de Next/Prisma: sin `import "server-only"`,
 * sin el alias `@/`, sin I/O. Solo importa `ServiceError` por ruta relativa
 * con extensión explícita.
 *
 * Por qué tan aislado (Deviation D1 del apply, design §1/§7): el script
 * `test` del proyecto corre `node --experimental-strip-types --test`, que no
 * resuelve alias de `tsconfig.json` ni puede importar un módulo cuyo primer
 * import sea `server-only` (su default export lanza al importarse). Con la
 * regla en `cliente.service.ts` —que sí es `server-only` y usa `@/`— la
 * cobertura unitaria exigida era imposible. Mismo precedente que
 * `turno-caja.calculo.ts`, `evaluacion.calculo.ts` y
 * `comprobante-proveedor-reglas.ts`: la regla de negocio vive en un módulo
 * puro que el service consume.
 */

// Import relativo con extensión explícita a propósito: el test runner nativo
// de Node (`node --experimental-strip-types --test`) no resuelve el alias
// `@/lib/errors/...`. Mismo criterio que `turno-caja.calculo.ts`.
import { ServiceError } from "../../errors/service-error.ts";

/**
 * Regla estructural de la obligatoriedad de FACTURACION (spec §2.3):
 * una dirección de `ENVIO` no puede ser la única del cliente — si el cliente
 * ya registra direcciones, debe existir al menos una `FACTURACION` ACTIVA
 * antes de aceptar una `ENVIO`.
 *
 * - Puramente estructural: NO depende de condición fiscal, IVA, CUIT ni de
 *   ningún dato del organismo (directiva del PO — no reintroducir).
 * - Cero direcciones ⇒ sin obligación: el llamador solo invoca esta función
 *   para `tipo === "ENVIO"` y le pasa el resultado del conteo de
 *   `FACTURACION` activas. `("FACTURACION", false)` es válido (primera
 *   dirección del cliente).
 * - No escribe nada: el llamador la aplica ANTES del `create`, de modo que
 *   el rechazo 422 implique CERO escrituras y CERO eventos.
 *
 * @param tipo - Tipo de la dirección que se intenta registrar.
 * @param hayFacturacionActiva - `true` si el cliente ya tiene ≥1 dirección
 *   `FACTURACION` con `is_active = true`.
 * @throws ServiceError code `DIRECCION_FACTURACION_REQUERIDA` (→ HTTP 422).
 */
export function validarReglaDireccionEnvio(
  tipo: "FACTURACION" | "ENVIO",
  hayFacturacionActiva: boolean,
): void {
  if (tipo === "ENVIO" && !hayFacturacionActiva) {
    throw new ServiceError(
      "DIRECCION_FACTURACION_REQUERIDA",
      "Debe existir al menos una dirección de tipo FACTURACION antes de registrar una dirección de envío",
    );
  }
}

/**
 * HU-C2 — Extensión de la regla estructural de FACTURACION a la EDICIÓN de
 * una dirección existente.
 *
 * El invariante es el mismo que en el alta: una dirección `ENVIO` no puede
 * existir sin al menos una `FACTURACION` activa. En edición la única
 * transición que puede romperlo es `FACTURACION → ENVIO`: la dirección deja de
 * ser FACTURACION y pasa a ser ENVIO, por lo que el cliente necesita OTRA
 * `FACTURACION` activa (distinta de la propia) que la respalde. Si la
 * dirección editada era la única FACTURACION, el resultado sería un cliente
 * con envíos y sin facturación (o con un ENVIO como única dirección) ⇒ 422.
 *
 * Toda otra edición es inocua para el invariante y NO se valida:
 *  - `ENVIO → FACTURACION`: agrega una FACTURACION, nunca la quita.
 *  - tipo sin cambio (`FACTURACION → FACTURACION`, `ENVIO → ENVIO`, o `tipo`
 *    ausente del PATCH): editar rótulo/dirección no altera el conteo. Tampoco
 *    se revalida un ENVIO→ENVIO para no bloquear la corrección de un rótulo
 *    sobre datos heredados.
 *
 * `hayOtraFacturacionActiva` debe contar FACTURACION activas EXCLUYENDO la
 * dirección que se está editando — si se la incluyera, la propia dirección
 * (todavía FACTURACION en la DB) se contaría a sí misma y la regla nunca
 * dispararía. Puro: el llamador hace el conteo y aplica esto ANTES del
 * `update`, de modo que el rechazo implique CERO escrituras y CERO eventos.
 *
 * @param tipoActual - Tipo persistido de la dirección.
 * @param tipoNuevo - Tipo resultante tras la edición (el actual si el PATCH no lo trae).
 * @param hayOtraFacturacionActiva - `true` si existe ≥1 FACTURACION activa del
 *   mismo cliente distinta de la dirección editada.
 * @throws ServiceError code `DIRECCION_FACTURACION_REQUERIDA` (→ HTTP 422).
 */
export function validarReglaEdicionDireccion(
  tipoActual: "FACTURACION" | "ENVIO",
  tipoNuevo: "FACTURACION" | "ENVIO",
  hayOtraFacturacionActiva: boolean,
): void {
  if (tipoActual === "FACTURACION" && tipoNuevo === "ENVIO") {
    validarReglaDireccionEnvio("ENVIO", hayOtraFacturacionActiva);
  }
}
