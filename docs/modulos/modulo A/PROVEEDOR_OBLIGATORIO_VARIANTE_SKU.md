# Proveedor habitual obligatorio en `VarianteSKU` (Módulo A + Módulo H)

**Estado:** Implementado y verificado — `npm test` 194/194 (10 nuevos + 184 preexistentes), `tsc --noEmit` y `eslint` limpios, migración aplicada por `prisma migrate reset` + reseed, verificación manual en runtime (UI + curl Nivel 2 + consulta directa a BD Nivel 3).
**Metodología:** Specification-Driven Development (SDD) con Claude Code — tres iteraciones de task (v1 → v2 → v3) más un parche adicional, cada una cerrando contradicciones que el relevamiento del código real encontró.
**Documentos fuente:** `RULES.md`, `spec_modulo_A.md` (§2.1 / §2.7), `schema.prisma`, `docs/tasks/task_proveedor_obligatorio_variante_sku.md`

---

# PARTE 1 — Referencia Técnica (estado actual, verificado)

> Cómo funciona hoy, confirmado sobre el código real entregado. Para cómo se llegó
> a este estado (y las 4 premisas de la task original que resultaron falsas), ver
> la Parte 2.

## 1.1. Alcance funcional

Cada `VarianteSKU` individual tiene un **proveedor habitual obligatorio**, elegido
**por variante** en el momento de su creación. Reemplaza la noción previa de que
el proveedor era solo un atributo a nivel `ProductoMaestro`.

`ProductoMaestro.proveedor_preferente` es un campo distinto y no relacionado — no
se tocó.

## 1.2. Modelo de datos

`VarianteSKU` en `schema.prisma`:

| Cambio | Antes | Después |
|---|---|---|
| `proveedor_id` | `String?` (columna suelta, sin FK, comentada como "STUB Sprint futuro") | `String` (NOT NULL) |
| Relación | inexistente | `proveedor Proveedor @relation(fields: [proveedor_id], references: [id], onDelete: Restrict)` |
| Back-relation en `Proveedor` | inexistente | `variantes_habituales VarianteSKU[]` |
| Índice | inexistente | `@@index([proveedor_id])` |

**Migración:** `20260909071038_proveedor_obligatorio_variante_sku`
```sql
ALTER TABLE "variantes_sku" ALTER COLUMN "proveedor_id" SET NOT NULL;
CREATE INDEX "variantes_sku_proveedor_id_idx" ON "variantes_sku"("proveedor_id");
ALTER TABLE "variantes_sku" ADD CONSTRAINT "variantes_sku_proveedor_id_fkey"
  FOREIGN KEY ("proveedor_id") REFERENCES "proveedores"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
```
Aplicada en dev con `prisma migrate reset` + reseed (había 1 fila con
`proveedor_id NULL` — artefacto manual — que hacía imposible el `SET NOT NULL`
in-place; ver 2.4).

## 1.3. Contrato — alta de variantes (`GenerarVariantesMatrizSchema`)

`lib/schemas/inventario.schema.ts`. Campo nuevo, **obligatorio y completo**:

```typescript
proveedor_por_combinacion: z.record(z.string(), z.string().uuid("Debe seleccionar un proveedor habitual"))
```

keyeado con `claveCombinacionVariante()` (`"TALLE|COLOR|GENERO"` normalizado —
la misma función que ya keyea `ean_por_combinacion`, reutilizada sin cambios). A
diferencia de `ean_por_combinacion` (override opcional y parcial), un `.refine()`
sobre el schema exige que **toda** combinación del cartesiano
`talles × colores × generos` tenga una entrada; si falta alguna → `400`
`VALIDATION_ERROR` con `path: ["proveedor_por_combinacion"]`.

Consumido por los **dos** puntos de entrada que comparten el schema: la Server
Action `generarVariantesMatriz()` y el Route Handler
`POST /api/inventario/productos/[id]/variantes/generar`.

`EditarVarianteOperativaSchema` (§2.7) **no cambió**: `proveedor_id:
z.string().uuid().optional()` — sigue siendo opcional de omitir en el PATCH
parcial. `.uuid().optional()` ya rechaza `null` y `""`.

## 1.4. Validación en la capa de servicios

| Servicio | Validación | Códigos de error |
|---|---|---|
| `generarVariantesMatriz()` (`producto.service.ts`) | por cada `proveedor_id` distinto resuelto del map (1 sola query): existe + `is_active` + `estado = HOMOLOGADO`. `proveedor_id` de cada variante se resuelve con `proveedor_por_combinacion[claveCombinacionVariante(...)]`, análogo a `ean_qr`. | `PROVEEDOR_NO_ENCONTRADO` (no existe / inactivo), `PROVEEDOR_NO_HOMOLOGADO` (activo pero no homologado) |
| `editarVarianteOperativa()` (`variante.service.ts`) | si el PATCH trae `proveedor_id`: existe + `is_active` + `estado = HOMOLOGADO` | ídem — el guard HOMOLOGADO vive en el servicio, no solo en la UI |

La regla "proveedor habitual debe ser HOMOLOGADO" no depende de que el cliente
sea la UI oficial — un PATCH directo por API con un proveedor PENDIENTE se
rechaza igual. `PROVEEDOR_NO_ENCONTRADO` ya existía en el repo (flujo de
edición); `PROVEEDOR_NO_HOMOLOGADO` también (Módulo H, alta de OC).

## 1.5. Endpoints y mapeo de status

| Endpoint | Caso | Status |
|---|---|---|
| `POST /api/inventario/productos/[id]/variantes/generar` | `proveedor_por_combinacion` ausente o incompleto | `400 VALIDATION_ERROR` |
| ídem | proveedor inexistente/inactivo | `404 PROVEEDOR_NO_ENCONTRADO` |
| ídem | proveedor activo no HOMOLOGADO | `422 PROVEEDOR_NO_HOMOLOGADO` |
| ídem | válido | `201` |
| `PATCH /api/inventario/variantes/[id]` | `proveedor_id` inexistente/inactivo | `404 PROVEEDOR_NO_ENCONTRADO` |
| ídem | `proveedor_id` activo no HOMOLOGADO | `422 PROVEEDOR_NO_HOMOLOGADO` |
| ídem | `proveedor_id` HOMOLOGADO / body vacío | `200` |

`422` para `PROVEEDOR_NO_HOMOLOGADO` es consistente con los Route Handlers de OC
de Módulo H, que ya lo mapean así.

## 1.6. UI

**Server Action de datos:** `listarProveedoresParaSelector()` (nueva, en
`app/(dashboard)/inventario/productos/actions.ts`) — envuelve
`listarProveedoresHomologados()` de Módulo H (`estado = HOMOLOGADO`,
`is_active`, `deleted_at IS NULL`). Se reutiliza en vez de duplicar la query;
es lectura pura sin lógica de Compras. Tres puntos de consumo: `MatrizVariantes`
(alta de producto nuevo y `NuevaVariante`) + `FormularioEditarVariante`.

**`MatrizVariantes.tsx`** (compartido por los dos flujos de alta):
- `<select>` **nativo** de proveedor por fila del preview (no `ComboboxFiltrable`
  — hasta 200 filas posibles y la lista de HOMOLOGADO es corta; montar el
  combobox con portal 200 veces sería innecesariamente pesado).
- Estado `proveedorPorFila`, misma key que `eanPorFila`.
- `puedeConfirmar` exige que **todas** las filas del preview tengan proveedor
  seleccionado (a diferencia de `ean_qr`, que admite filas parciales) y que haya
  al menos un proveedor HOMOLOGADO.
- `<Alert>` de estado vacío si no hay proveedores HOMOLOGADO (mismo patrón que
  el formulario de alta de OC).

**`FormularioEditarVariante.tsx`** (HU-A8):
- El `<Input>` de UUID crudo se reemplazó por `ComboboxFiltrable` (una sola
  instancia por formulario, el argumento de peso no aplica), cableado en
  `react-hook-form` vía `field.onChange`.
- Aviso si el proveedor actual de la variante ya no está HOMOLOGADO.
- El campo sigue opcional de omitir; el cambio es de UX en cómo se completa el
  valor.

## 1.7. Seed

`prisma/seed.ts`: el `upsert` de `proveedorHomologado` (InduSur) se movió a
**antes** de la creación de la primera `VarianteSKU` — con la columna NOT NULL,
las variantes no pueden insertarse sin proveedor, así que el padre requerido va
primero (mismo patrón que `productoMaestro`). `proveedorPendiente` y el resto del
bloque de Módulo H quedan donde estaban. Las **6** variantes del seed se insertan
directamente con `proveedor_id: proveedorHomologado.id` (en `create` y `update`).
Todo el catálogo demo queda en InduSur/HOMOLOGADO — reproducible por el mismo
`<select>` de la UI, que solo ofrece HOMOLOGADO.

## 1.8. Resumen de verificación

| Pieza | Estado |
|---|---|
| Schema: relación + índice + FK `onDelete: Restrict` + NOT NULL | ✅ `prisma validate` + verificado en BD (`variantes_sku_proveedor_id_fkey`, `variantes_sku_proveedor_id_idx`, `is_nullable = NO`) |
| Migración aplicada limpiamente tras reset + reseed | ✅ |
| Seed: 6 variantes → InduSur, 0 con `proveedor_id` nulo | ✅ Nivel 3 (consulta directa) |
| `GenerarVariantesMatrizSchema` rechaza `proveedor_por_combinacion` ausente/incompleto/no-UUID | ✅ Nivel 1 (`inventario.matriz-proveedor.test.ts`) + Nivel 2 (`400`) |
| `EditarVarianteOperativaSchema` sin cambios (tests preexistentes verdes) | ✅ |
| Alta: proveedor PENDIENTE → `422`, inexistente → `404`, válido → `201` | ✅ Nivel 2 (curl) |
| Edición: PATCH con PENDIENTE → `422`, inexistente → `404`, HOMOLOGADO → `200`, body vacío → `200` | ✅ Nivel 2 (curl) |
| Matriz de Variantes: `<select>` por fila, botón bloqueado hasta que todas las filas tengan proveedor, generación 201 con `proveedor_id` persistido | ✅ Runtime (UI) |
| `FormularioEditarVariante`: `ComboboxFiltrable` en vez de `<Input>` de UUID, precargado con el proveedor actual, lista solo HOMOLOGADO | ✅ Runtime (UI) |
| `spec_modulo_A.md` §2.1 y §2.7 actualizados | ✅ |

## 1.9. Fuera de alcance

- `ProductoMaestro.proveedor_preferente` — campo distinto, no se toca.
- Asignación automática de proveedor por categoría/rubro más allá del seed.
- Endpoint nuevo de cambio de proveedor habitual (más allá de lo que ya cubre `EditarVarianteOperativaSchema`).
- `onDelete: Restrict` — ya estaba así en el resto de FKs a `Proveedor`, no se modifica.

---

# PARTE 2 — Historial de Desarrollo (proceso SDD)

## 2.1. Contexto de la tarea original

Decisión nueva del equipo/PO que revierte una nota de diseño previa ("Proveedor
pertenece conceptualmente a `ProductoMaestro`, no a cada variante"). El campo
`VarianteSKU.proveedor_id` existía en `schema.prisma` como stub opcional
documentado para un Módulo H todavía no implementado; Módulo H ya está operativo,
así que la premisa del stub dejó de aplicar.

## 2.2. Relevamiento — 4 premisas de la task original que resultaron falsas

Instrucción del prompt: relevamiento obligatorio antes de escribir código, con
aprobación posterior. Lo que encontró el relevamiento sobre el código real:

1. **"La relación `proveedor` ya existe, solo se quita la nulabilidad" — FALSO.**
   En el schema y en la BD real solo había una columna `proveedor_id text NULL`
   **sin FK, sin índice, sin campo de relación en el modelo, sin back-relation en
   `Proveedor`**. El cambio no era un `ALTER ... SET NOT NULL` simple: había que
   crear la relación, la back-relation, el índice y la FK.

2. **"Tocar `VarianteInputSchema` / `CrearProductoConVariantesSchema`" — esos
   schemas no existen en el código.** Era lenguaje desactualizado del spec. El
   alta real es en dos pasos (`POST /productos` crea el `ProductoMaestro`;
   `POST /productos/[id]/variantes/generar` genera las variantes con
   `GenerarVariantesMatrizSchema`). El spec también describía `ean_qr` como
   requerido cuando en realidad es opcional.

3. **Orden de siembra del seed invertido.** Las variantes se crean ~1200 líneas
   antes que los proveedores. El paso de asignación "posterior" que planteaban
   las primeras versiones de la task era inviable con una columna NOT NULL (ver
   2.4).

4. **`EditarVarianteOperativaSchema` — no requiere cambio.** `.uuid().optional()`
   ya rechazaba `null` y `""`; la semántica pedida ("obligatorio si se envía")
   ya estaba cubierta. El guard HOMOLOGADO va en el servicio, no en el schema.

Estado de datos en dev: 7 filas en `variantes_sku`, 1 con `proveedor_id NULL`
(artefacto manual, 0 dependientes), y 2 apuntando a un proveedor **PENDIENTE**
(Calzado Norte) — inconsistente con la regla "solo HOMOLOGADO" que se iba a
establecer.

## 2.3. Iteraciones de la task (v1 → v2 → v3)

| Versión | Qué cerró |
|---|---|
| **v1** | Original. Varias premisas incorrectas (relación inexistente, schemas inexistentes). |
| **v2** | Corrigió las premisas del schema y del flujo de dos pasos. Introdujo una contradicción interna: §4 proponía un `proveedor_id` **escalar** pero §6 pedía selección **por variante** — incompatible. |
| **v3** | Resolvió escalar↔map a favor de **`proveedor_por_combinacion`** (map obligatorio, análogo a `ean_por_combinacion`). Cerró: guard HOMOLOGADO también en `variante.service.ts`, `<select>` nativo en la Matriz, reutilizar `listarProveedoresHomologados()`, reset + reseed en vez de fix manual de datos. |
| **Parche sobre v3** | Ver 2.4 — la estrategia de seed de v3 seguía siendo inviable. |

Se confirmó que `claveCombinacionVariante()` es reutilizable **tal cual** para
keyear `proveedor_por_combinacion` (función pura, ya usada para
`ean_por_combinacion` en cliente y servidor) — el `.refine()` la llama para que
las keys normalicen igual que el `.map()` del servicio.

## 2.4. Parche bloqueante sobre v3 — estrategia de seed

v3 §3 mantenía el enfoque "crear las variantes sin `proveedor_id`, asignarlo con
un `UPDATE` posterior a la creación de `Proveedor`". **Inviable:** en un
`prisma migrate reset` la columna ya es NOT NULL cuando corre el seed, así que
el primer `varianteSKU.upsert({ create: { …sin proveedor_id… } })` falla al
instante y nunca se llega al `UPDATE`.

**Resolución (autorizada explícitamente por contradecir el "no reordenar" de la
task):** mover **solo** el `upsert` de `proveedorHomologado` a antes de la
primera variante (es una entidad raíz sin dependencias), setear
`proveedor_id: proveedorHomologado.id` directo en los `create`/`update` de las 6
variantes del seed, y eliminar el paso de `UPDATE`. Corolario detectado en el
segundo relevamiento: `varianteSkuById` solo contenía 5 de las 6 variantes del
seed (la primera, `VARIANTE_SKU_SEED_ID` / `CAMPOL-POLICÍA-M-AZUL-H`, se crea
antes de que exista ese `Map`) — el paso tenía que cubrir las 6 explícitamente.

Como se resetea la BD, las 3 filas problemáticas de dev (1 NULL + 2 en Calzado
Norte/PENDIENTE) dejan de existir y el reseed genera las 6 filas ya correctas.
El `prisma migrate reset` requirió consentimiento explícito del usuario (gate de
seguridad de Prisma para agentes de IA) — confirmado que es la BD local de
desarrollo, sin datos productivos.

## 2.5. Ajuste post-implementación — extensión de import en `inventario.schema.ts`

Agregar `import { claveCombinacionVariante }` al schema rompió 3 test files que
lo importan como valor con `node --experimental-strip-types` (sin resolución de
paths ni de extensión). Se corrigió usando `../utils/sku.ts` (ruta relativa con
`.ts` explícito) en vez de `@/lib/utils/sku` — misma convención que ya usan
`sku.test.ts` (`./sku.ts`) y `transferencia.test.ts`
(`../../schemas/inventario.schema.ts`). `tsc` lo acepta (`allowImportingTsExtensions`).

## 2.6. Verificación final

- `npx prisma validate` — OK.
- `prisma migrate reset` + reseed — corre de punta a punta, 6 variantes → InduSur.
- `npx tsc --noEmit` — sin errores.
- `npm test` — 194/194 (se agregó `src/lib/schemas/inventario.matriz-proveedor.test.ts` al script `test` de `package.json`).
- Nivel 2 (curl con cookie jar): 5 casos del endpoint de alta + 4 del PATCH de edición, todos con el status y código de error esperados.
- Runtime (Claude en Chrome): Matriz de Variantes genera 2 variantes con proveedor por fila (persistido en BD); `FormularioEditarVariante` muestra el `ComboboxFiltrable` precargado.
