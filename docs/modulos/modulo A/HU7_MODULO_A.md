# Especificación Técnica — HU-A7 (Auditoría de Inventario y Verificación SHA-256)

## ERP SWAT Indumentarias — Módulo A

**Metodología:** Regenerado por relevamiento directo del código (no SDD ex-ante).
**Stack real:** Next.js (App Router, RSC + Server Actions) · Prisma ORM · Zod · PostgreSQL.
**Fuente:** código en `src/` al 2026-09-01. Este documento reemplaza por completo la versión anterior — la anterior describía funcionalidad descartada (`LECTURA_SENSIBLE`, `DatoCifradoViewer`) y omitía funcionalidad real (filtro por usuario, cadena global, resolución de SKU). Ver §5 para el detalle de qué cambió y por qué.

---

## 1. Historia de Usuario y Criterios de Aceptación

**Como** Auditor, **necesito** consultar el log de auditoría de todos los movimientos de stock e inventario con verificación de integridad de la cadena SHA-256, **para** detectar cualquier manipulación retroactiva sobre el historial de inventario y cumplir auditorías forenses.

**Criterios de Aceptación (verificados contra el código real):**

- [x] **CA1** — El Auditor tiene acceso de solo lectura al log íntegro; no puede aprobar ni ejecutar operaciones.
- [x] **CA2** — La consola permite filtrar por usuario, SKU, rango de fechas, tipo de movimiento y módulo.
- [x] **CA3** — El proceso de verificación recalcula los hashes SHA-256 y señala el punto exacto de ruptura si detecta discrepancia.
- [x] **CA4** — Los registros de auditoría son append-only: ningún caso de uso expone operaciones de edición o borrado.

El detalle de qué función/archivo cumple cada uno está en §3.

---

## 2. Arquitectura de la pantalla

Ruta: `/inventario/auditoria` → `src/app/(dashboard)/inventario/auditoria/`.

### 2.1. `page.tsx` — React Server Component

- Es un RSC (`export default async function AuditoriaInventarioPage`), sin `"use client"`.
- `export const dynamic = "force-dynamic"` — sin caché estático (los filtros dependen de `searchParams`).
- Doble verificación antes de renderizar contenido:
  1. `getServerSession()` — si no hay sesión, renderiza un `<Alert>` de sesión inválida (no redirige).
  2. `usuarioTienePermiso(sesion.userId, "auditoria:leer_forense")` — si es `false`, renderiza un `<Alert>` de "no tenés el permiso" (tampoco redirige).
- **Nota de discrepancia interna**: el docstring del propio archivo dice _"Sin ese permiso, la página redirige a 403 (aplicado en middleware o layout)"_. Eso no es lo que hace el código: no hay ningún `redirect()`, la página se sigue renderizando con un `<Alert variant="destructive">` inline. El bloqueo es real (no se llega a los datos), pero el mecanismo documentado en el comentario no coincide con la implementación.
- Con sesión y permiso válidos, un componente interno `AuditoriaData` (async, dentro de `<Suspense>`) hace lo siguiente:
  - Sanea `q` (búsqueda libre, corta a 100 chars).
  - Parsea `searchParams` con `FiltrosAuditoriaInventarioSchema.safeParse(...)` — si falla, `<Alert>` de "parámetros inválidos", sin tocar la base.
  - Llama en paralelo (`Promise.all`) a `obtenerLogsInventario(filtros, sesion, q)` y a `listarUsuariosParaFiltro()` (de `audit-log.service.ts`, Módulo D — reutilizada, no hay una versión propia de Módulo A).
  - Si `listarUsuariosParaFiltro()` falla, se degrada a lista vacía (`.catch(() => [])`) sin tirar abajo la pantalla — el listado principal es lo que importa.
  - Si `obtenerLogsInventario` falla, sí se muestra `<Alert>` de error de conexión.
  - Pasa todo (`registros`, `total`, `page`, `page_size`, `usuarios`, `filtrosIniciales`) como props a `TablaForenseInventario` (Client Component).
- No hay `actions.ts` involucrado en la carga inicial — solo en la interacción (verificación).

### 2.2. `actions.ts` — Server Action

Un único Server Action, sin mutación:

- **`verificarIntegridadAction()`**: sin argumentos. Valida sesión + permiso (`auditoria:verificar_cadena` **o** `auditoria:leer_forense`, con `||`), llama a `verificarCadenaHashesInventario()` y devuelve el resultado envuelto en `ActionResult<T>`. Contrato exacto en §4.

No existe ningún otro Server Action en este archivo. En particular: **no existe `revelarDatoSensibleAction()`** (ver §5).

### 2.3. `TablaForenseInventario.tsx` — Client Component

Único Client Component de la pantalla (`"use client"`). Es el único consumidor de `verificarIntegridadAction`. No expone ninguna acción de mutación — confirmado por lectura completa del archivo (ningún `<form>` de escritura, ningún botón de editar/eliminar).

---

## 3. Capa de servicios — `lib/services/inventario/auditoria.service.ts`

Dos funciones exportadas. Son las únicas dos — no existe una tercera función de "acceso a dato sensible":

### 3.1. `obtenerLogsInventario(filtros, sesion, q?)` → `Promise<ListadoAuditoriaInventario>`

Cumple **CA1** (permiso de auditor) y **CA2** (filtros).

- **Barrera de permiso propia**: vuelve a chequear `auditoria:leer_forense` con `usuarioTienePermiso()`, aunque `page.tsx` ya lo validó — defensa en profundidad ante callers futuros que no pasen por la página.
- **Restricción de dominio siempre activa**: `where.tabla_afectada = { in: TABLAS_MODULO_A }`, sin excepción. Las 7 tablas del Módulo A hoy son:
  `stock_depositos`, `movimientos_stock`, `variantes_sku`, `depositos`, `productos_maestros`, `transferencias_stock`, `reservas`.
  (`transferencias_stock` y `reservas` no estaban en el relevamiento original; ver comentario en el propio archivo — sin `transferencias_stock` el filtro "Transferencia" daba 0 resultados siempre; `reservas` se agregó por completitud de dominio aunque hoy no tiene eventos reales, porque la funcionalidad de negocio de Reservas todavía no existe.)
- **Filtro por usuario** (`filtros.usuario_id`): `where.usuario_id = filtros.usuario_id` directo. Existe y funciona — esto es lo que el documento anterior omitía.
- **Filtro por SKU** (`filtros.sku_referencia`): no es un `ILIKE` directo sobre `registro_id`. Primero resuelve el término contra `VarianteSKU.sku` y `ProductoMaestro.codigo_producto` (contains, insensitive), traduce a los `registro_id` correspondientes (incluyendo un segundo salto: variante → `MovimientoStock` que la referencia), y arma `where.registro_id = { in: [...ids] }`. Si el término no matchea ningún código real, cae a un `ILIKE` crudo sobre `registro_id` como fallback (comportamiento legado, para quien pega un UUID a mano). `stock_depositos` y `depositos` quedan fuera de esta resolución porque no tienen código de SKU/producto propio.
- **Filtro por fechas**: `fecha_desde` usa `gte` directo; `fecha_hasta` pasa por `finDeDia()`, que la ancla a `23:59:59.999 UTC` del día elegido — sin esto, un rango con la misma fecha en Desde y Hasta cubría un instante, no el día completo.
- **Filtro por tipo de movimiento**: `where.accion = { in: ACCIONES_POR_TIPO_MOVIMIENTO[filtros.tipo_movimiento] }`. No es igualdad exacta contra el valor del enum — hay un mapeo explícito, porque `AuditLog.accion` no usa los mismos literales que el filtro:

  | `tipo_movimiento` (filtro) | `accion` real en `AuditLog`                          |
  | -------------------------- | ---------------------------------------------------- |
  | `INGRESO`                  | `INGRESO`                                            |
  | `CREATE`                   | `CREATE`                                             |
  | `UPDATE`                   | `UPDATE`                                             |
  | `TRANSFERENCIA`            | `TRANSFERENCIA_DESPACHADA`, `TRANSFERENCIA_RECIBIDA` |
  | `DELETE`                   | `DELETE_LOGICO`                                      |

- **Filtro por módulo/entidad** (`filtros.tabla_afectada`): sub-filtra dentro del dominio A ya restringido (`where.tabla_afectada = filtros.tabla_afectada`, valor único, no lista).
- **Búsqueda libre** (`q`): solo se aplica si `sku_referencia` no está activo. Es un `OR` con `contains` insensitive sobre `accion`, `tabla_afectada` y `registro_id`. No es parte de los CA — ver §6.
- Paginación server-side (`skip`/`take` sobre `page`/`page_size`) y `orderBy: created_at desc`.
- Devuelve `usuario_nombre` vía `include: { usuario: { select: { nombre_completo } } }`.

### 3.2. `verificarCadenaHashesInventario()` → `Promise<ResultadoVerificacionInventario>`

Cumple **CA3**. Contrato exacto en §4.

- **No filtra por Módulo A antes de encadenar.** Recorre **todo** `AuditLog` (usuarios, roles, sesiones e inventario mezclados), ordenado `created_at asc` — porque `registrarAuditLog()` encadena cada evento contra el último de toda la tabla, una única cadena global. Filtrar primero por Módulo A y encadenar solo esas filas entre sí produciría falsos positivos de ruptura apenas hay un evento de otro módulo (ej. un login) intercalado cronológicamente.
- El filtro de Módulo A se usa **solo para contar**: `registros_verificados` incrementa únicamente cuando la fila ya validada pertenece a `TABLAS_MODULO_A`, nunca para decidir adyacencia de hashes.
- Dos checks independientes por fila, cada uno con retorno inmediato ante discrepancia:
  1. `registro.hash_anterior !== hashAnteriorEsperado` (el acumulador local).
  2. `registro.hash_actual !== calcularHashEncadenado(payload, hashAnteriorEsperado)` (recalculado con `lib/crypto/hash-chain.ts`, nunca confía en el valor almacenado).
- Detecta dos clases de manipulación: `hash_anterior` alterado en BD, o payload del registro alterado.
- El cálculo del hash (`calcularHashEncadenado`) es SHA-256 sobre el payload canonicalizado (claves ordenadas alfabéticamente, recursivo) + `hash_anterior`. La canonicalización es necesaria porque Postgres `jsonb` no preserva el orden de inserción de claves al leer de vuelta.

Existe una función equivalente para Módulo D completo: `verificarCadenaIntegridad()` en `lib/services/auditoria/audit-log.service.ts` (usada por `POST /api/auditoria/verificar-cadena`). Misma lógica de fondo (mismo `calcularHashEncadenado`), pero sin distinguir Módulo A y con los dos checks colapsados en un único booleano `cadenaRota`. La pantalla de HU-A7 **no** usa este endpoint — usa la Server Action local (`verificarIntegridadAction` → `verificarCadenaHashesInventario`).

---

## 4. Contrato de verificación de cadena (HU-A7)

**Entrada:** `verificarIntegridadAction()` — sin parámetros.

**Autorización:** requiere `auditoria:verificar_cadena` **o** `auditoria:leer_forense` (basta con uno de los dos). Sin sesión → `error.code: "UNAUTHORIZED"`. Sin ninguno de los dos permisos → `error.code: "FORBIDDEN"`. Excepción no controlada → `error.code: "INTERNAL_ERROR"`.

**Salida** (`ActionResult<ResultadoVerificacionInventario>`):

```typescript
interface ActionResult<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface ResultadoVerificacionInventario {
  integra: boolean;
  registros_verificados: number; // solo eventos de Módulo A ya validados
  primer_registro_divergente_id?: string; // presente solo si integra === false
  hash_esperado?: string; // presente solo si integra === false
  hash_almacenado?: string; // presente solo si integra === false
}
```

Si `integra === true`, `registros_verificados` es el total de eventos de Módulo A en toda la tabla (la cadena completa se recorrió sin ruptura). Si `integra === false`, es el conteo de eventos de Módulo A vistos **antes** del punto de ruptura — el recorrido se detiene ahí, no sigue evaluando el resto de la cadena.

---

## 5. Esquema de validación real — `lib/schemas/inventario-auditoria.schema.ts`

```typescript
const TABLAS_MODULO_A = [
  "stock_depositos",
  "movimientos_stock",
  "variantes_sku",
  "depositos",
  "productos_maestros",
  "transferencias_stock",
  "reservas",
] as const;

export const FiltrosAuditoriaInventarioSchema = z
  .object({
    usuario_id: z.string().uuid().optional(),
    sku_referencia: z.string().max(200).optional(),
    fecha_desde: z.coerce.date().optional(),
    fecha_hasta: z.coerce.date().optional(),
    tipo_movimiento: z
      .enum(["INGRESO", "TRANSFERENCIA", "CREATE", "UPDATE", "DELETE"])
      .optional(),
    tabla_afectada: z.enum(TABLAS_MODULO_A).optional(),
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(100).default(25),
  })
  .refine(
    (data) =>
      !data.fecha_desde ||
      !data.fecha_hasta ||
      data.fecha_desde <= data.fecha_hasta,
    {
      message: "fecha_desde no puede ser posterior a fecha_hasta",
      path: ["fecha_desde"],
    },
  );
```

**El enum de `tipo_movimiento` cambió respecto al documento anterior.** Antes: 4 valores (`INGRESO`, `EGRESO`, `AJUSTE`, `TRANSFERENCIA`). Hoy: 5 valores (`INGRESO`, `TRANSFERENCIA`, `CREATE`, `UPDATE`, `DELETE`). `EGRESO` y `AJUSTE` se sacaron deliberadamente — no existe ningún emisor de eventos de dominio que escriba esas acciones (confirmado contra `audit-log.listener.ts`), eran opciones huérfanas que siempre devolvían 0 resultados. Reincorporarlas es funcionalidad pendiente de otra HU, no de ésta.

`tabla_afectada` es un campo adicional del schema no descrito en el documento anterior — valida contra el mismo enum `TABLAS_MODULO_A` (duplicado literal del array en `auditoria.service.ts`; el comentario del archivo aclara que no se puede importar del service sin crear dependencia circular, así que se mantiene sincronizado a mano).

---

## 6. Filtros reales en `TablaForenseInventario.tsx`

| Filtro UI           | Campo                         | Exigido por CA2 | Notas                                                                                                                                                                                                                                 |
| ------------------- | ----------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Búsqueda libre      | `q`                           | No              | Debounce 350ms, máx. 100 chars, deshabilitado si hay `sku_referencia` activo.                                                                                                                                                         |
| Usuario responsable | `usuario_id`                  | Sí              | `ComboboxFiltrable` poblado por `listarUsuariosParaFiltro()` — **todos** los usuarios del sistema, activos o no (el ledger forense debe seguir siendo filtrable por un usuario ya dado de baja).                                      |
| SKU / Variante      | `sku_referencia`              | Sí              | Placeholder "Código de SKU o de producto" — refleja la resolución real (§3.1), no un ID interno.                                                                                                                                      |
| Tipo de movimiento  | `tipo_movimiento`             | Sí              | `<select>` nativo, 5 opciones (Ingreso, Transferencia, Creación, Actualización, Eliminación).                                                                                                                                         |
| Módulo / Entidad    | `tabla_afectada`              | Sí              | `<select>` nativo, 7 opciones (una por tabla de `TABLAS_MODULO_A`). El CA pide filtrar por "módulo"; en esta pantalla el módulo ya está fijo (Inventario) por diseño, así que este selector sub-filtra por entidad dentro del módulo. |
| Desde / Hasta       | `fecha_desde` / `fecha_hasta` | Sí              | `<input type="date">`, aplican `onBlur`.                                                                                                                                                                                              |

**Gating de permiso**: no hay gate por-filtro individual dentro del componente — toda la pantalla (`page.tsx`) ya exige `auditoria:leer_forense` antes de renderizar `TablaForenseInventario`, así que quien ve el componente ya tiene el permiso. Esto es distinto de la consola de Módulo D (`/auditoria/logs`), donde el combo de usuario sí tiene su propio gate de visibilidad porque esa pantalla degrada en vez de bloquear.

Botón "Limpiar filtros" visible solo si hay algún filtro activo (`router.push("?")`, resetea todo vía URL).

**Paginación**: el schema y el servicio soportan `page`/`page_size` server-side, y la UI muestra el contador ("página X de Y"), pero **no encontré controles de navegación** (sin botones de página siguiente/anterior) en `TablaForenseInventario.tsx`. Hoy la única forma de cambiar de página es editando el parámetro `page` en la URL a mano. Documento esto como capacidad parcial, no como algo exigido por ningún CA.

---

## 7. `LECTURA_SENSIBLE` / `DatoCifradoViewer` — evaluado y descartado

Búsqueda explícita (`grep` sobre `src/` completo, más `Glob` de nombre de archivo) por: `LECTURA_SENSIBLE`, `DatoCifradoViewer`, `revelarDatoSensibleAction`, `registrarAccesoDatoSensible`.

**No existe ningún hit en código.** El único lugar donde aparecen esos nombres es `docs/modulos/modulo A/HU8_MODULO_A.md` — que es la especificación de una historia de usuario distinta (**HU-A8**, no HU-A7), y ahí solo como documentación, sin componente ni acción implementados que yo haya encontrado en este relevamiento.

Confirmado también por listado directo de archivos:

- `src/components/inventario/auditoria/` contiene únicamente `TablaForenseInventario.tsx`.
- `src/app/(dashboard)/inventario/auditoria/actions.ts` contiene únicamente `verificarIntegridadAction`.

Esto respalda lo que ya sospechabas: la funcionalidad de "revelar dato sensible" se descartó del alcance de HU-A7 y no forma parte del código actual de esta pantalla.

---

## 8. Navegación — `Sidebar.tsx`

Server Component. Sección **"Auditoría"** (ícono `ShieldCheck`), cuarto ítem de la lista:

```typescript
{
  label: "Auditoría del Inventario",
  href: "/inventario/auditoria",
  icon: FileSearch,
  permiso: "auditoria:leer_forense",
}
```

- Gateado por `auditoria:leer_forense` — sin ese permiso, `usuarioTienePermiso()` filtra el ítem completo del árbol (`.filter(item => item !== null)`), no se ve en absoluto. Esto es distinto del ítem "Auditoría Forense" (`/auditoria/logs`, Módulo D) que está justo arriba en la misma sección: ese **no** lleva `permiso`, sigue visible para cualquier sesión porque esa pantalla degrada su contenido en vez de bloquear el acceso.
- **Discrepancia con el docstring del propio archivo**: el comentario en `Sidebar.tsx` dice que "Auditoría del Inventario" quedó _"como sub-ítem anidado bajo la entrada 'Auditoría Forense' de arriba"_. En el array `SECCIONES` real, sin embargo, es un ítem **hermano** de "Auditoría Forense" dentro de la misma sección `items[]` — no tiene `children`, y "Auditoría Forense" tampoco define `children` para contenerlo. El mecanismo de anidación (`ItemConfig.children`) existe en el tipo y el render lo soporta, pero ningún ítem de `SECCIONES` lo usa hoy. Navegación real: `Auditoría → Auditoría del Inventario`, ambos ítems al mismo nivel.

## Confirmado visualmente el 01/09/2026: los ítems son hermanos, no anidados. Se decide no corregir — no afecta ningún criterio de aceptación, queda como mejora cosmética pendiente de baja prioridad.

## 9. Cumplimiento de cada Criterio de Aceptación

| CA                                                                     | Cumplido por                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CA1** — solo lectura, sin aprobar/ejecutar                           | `page.tsx` (doble check sesión+permiso antes de renderizar), `actions.ts` (único Server Action es de lectura), `TablaForenseInventario.tsx` (sin `<form>` ni control de mutación)                                                                                                                                                                                                                                                   |
| **CA2** — filtrar por usuario, SKU, fechas, tipo de movimiento, módulo | `obtenerLogsInventario()` en `auditoria.service.ts` (lógica de cada filtro, §3.1) + `TablaForenseInventario.tsx` (UI de cada filtro, §6) + `FiltrosAuditoriaInventarioSchema` (validación, §5)                                                                                                                                                                                                                                      |
| **CA3** — recalcula SHA-256 y señala punto de ruptura                  | `verificarCadenaHashesInventario()` en `auditoria.service.ts` (§3.2) + `verificarIntegridadAction()` en `actions.ts` (contrato, §4) + `calcularHashEncadenado()` en `lib/crypto/hash-chain.ts`                                                                                                                                                                                                                                      |
| **CA4** — append-only, sin edición/borrado                             | Ausencia verificada: ni `auditoria.service.ts` ni `actions.ts` exponen ninguna función de `UPDATE`/`DELETE` sobre `AuditLog`. El único endpoint de escritura sobre logs a nivel de API (`/api/auditoria/logs`, Módulo D) solo acepta `GET` — confirmado indirectamente por los Test Cases Postman `PUT-TC-HU7-11` / `PATCH-TC-HU7-11` / `DELETE - TC-HU7-11`, que existen específicamente para verificar el rechazo de esos métodos |

---

## 10. Capacidades adicionales no exigidas por los CA

- **Búsqueda libre (`q`)** con debounce, sobre `accion`/`tabla_afectada`/`registro_id`.
- **Resolución de SKU contra catálogo real** (`VarianteSKU`/`ProductoMaestro`) en vez de búsqueda cruda por ID — mejora de usabilidad no pedida por el CA, que solo exige "filtrar por SKU".
- **Doble barrera de permiso**: `obtenerLogsInventario()` vuelve a validar `auditoria:leer_forense` server-side, aunque `page.tsx` ya lo hizo — defensa en profundidad, no exigida explícitamente por ningún CA pero alineada con el principio general del proyecto.
- **Degradación resiliente en la carga de usuarios para el filtro**: si `listarUsuariosParaFiltro()` falla, la pantalla no se cae, el combo queda vacío.
- **Verificación de cadena disponible también por API REST** (`POST /api/auditoria/verificar-cadena`, Módulo D) — no es el camino que usa esta pantalla, pero corre sobre el mismo algoritmo de hash y es un canal alternativo de auditoría externa (ej. scripts, Postman).

---
