# Especificación Técnica — Módulo H (Gestión de Proveedores y Abastecimiento)
## Contenido DIFERIDO — no planificado para Sprint 2
## Revisión 4 — HU-H2, HU-H6, HU-H7, HU-H8

**Metodología:** Specification-Driven Development (SDD)
**Stack:** Next.js 16 (App Router) · Node.js · PostgreSQL 16 · Prisma ORM · TypeScript · Zod · Argon2id · JWT
**Referencias normativas:** `RULES.md` (Regla N.° 1 — Restricción Estricta de Borrado Físico; Regla N.° 2 — Protección de Datos Personales y Trazabilidad Inalterable) · `Documento de Alcance Funcional y Técnico` (sección Módulo H) · `Product Backlog — SWAT Indumentarias.xlsx` (hoja "Product Backlog Consolidado", Entrega 8) · `schema.prisma` · `spec_modulo_D.md` · `spec_modulo_H.md` (contraparte de Sprint 2)

---

## ⚠️ Por qué este documento existe separado de `spec_modulo_H.md`

**Este documento NO corresponde a Sprint 2.** Contiene HUs que el PO decidió explícitamente diferir, según la hoja **`Sprint 2`** del Product Backlog (`Product Backlog — SWAT Indumentarias.xlsx`) — la fuente de planificación real, distinta de la hoja "Product Backlog Consolidado" contra la que se hizo el análisis de trazabilidad inicial:

> *"Quedan fuera de este sprint por depender de que Proveedores tenga historial real de operación, o de módulos que todavía no se construyen: HU-H2 (listas de precios versionadas), HU-H6 (auditoría de variaciones de proveedores), HU-H7 (comparador de precios) y HU-H8 (costo de reposición expuesto a Módulo B). Se abordan en sprints posteriores."* — Notas y criterios de selección, hoja `Sprint 2`.

Este documento existe para no perder el trabajo de especificación ya hecho (íntegro y correcto en su contenido técnico), y para que, cuando el equipo planifique el sprint que aborde estas cuatro HUs, no haga falta rehacer el análisis de trazabilidad contra el Documento de Alcance y el Backlog — se retoma directo desde acá.

**No implementar ninguna sección de este documento sin que el PO la incluya explícitamente en un sprint.** Si al leer este documento te preguntás "¿esto va ahora?", la respuesta por defecto es no — consultar `spec_modulo_H.md` para ver qué está efectivamente planificado.

**Contenido de este documento:**
- **HU-H2** — Publicación de una nueva versión de Lista de Precios (sección 2.3)
- **HU-H6** — Consola de Auditoría Forense de Proveedores (sección 2.7)
- **HU-H7** — Vista comparativa de precios entre proveedores (sección 2.8)
- **HU-H8** — Servicio de costo de reposición vigente (sección 2.9)

**Estado del schema (ya resuelto, no bloquea la futura implementación):** los modelos `ListaPrecio`, `ListaPrecioVersion`, `ListaPrecioItem` y los campos `Proveedor.datos_bancarios_cifrado`/`datos_bancarios_iv` **ya existen** en `schema.prisma`, migrados en `20260831050501_add_lista_precio_and_proveedor_bank_data` (aplicada y verificada con `prisma validate` + `prisma generate`, 100% aditiva, sin `DROP` ni `ALTER` sobre columnas/tablas preexistentes). Esto se hizo antes de detectar que estas HU estaban fuera de Sprint 2 — quedó como trabajo adelantado válido, no como error a revertir. Ver el detalle completo de la migración, sus supuestos y sus dos pendientes reales (default de `publicada`, cardinalidad `ListaPrecio`↔`Proveedor`) en la sección 2.3 de este documento y en la sección 5.

**Numeración de secciones:** se mantiene idéntica a la Revisión 3 (2.3, 2.7, 2.8, 2.9 y las subsecciones de la sección 3 correspondientes) para que, si en algún momento ambos documentos vuelven a fusionarse, no haya que renumerar nada ni romper referencias cruzadas ya usadas en otros documentos del proyecto.

---

## 1. Visión General (de esta porción diferida)

El subcomponente H.2 (Listas de Precios) es el único punto de origen de toda variación de costo de reposición que luego consumen el Módulo B (cálculo de margen en el POS) y el Módulo D (KPI de rentabilidad del Tablero de Comando). HU-H6, HU-H7 y HU-H8 son, en distinta medida, consumidores derivados de H.2: H6 audita sus variaciones críticas, H7 compara precios entre proveedores usando el mismo mecanismo de "versión vigente", y H8 expone el costo de reposición resultante a otros módulos. Las cuatro comparten la misma dependencia de fondo — sin `ListaPrecioVersion` con contenido publicado, ninguna es funcionalmente completable — razón adicional por la que el PO las agrupó como un bloque a diferir en conjunto.

Bajo Next.js App Router, esta porción del módulo se implementaría mediante **Route Handlers** (`app/api/proveedores/**`) siguiendo exactamente las mismas convenciones que `spec_modulo_H.md` ya establece para H1/H3/H4/H5: capa de servicios exclusiva (`lib/services/proveedores/lista-precios.service.ts`), Zod antes de tocar la capa de servicios, shape de respuesta `{ data, error }` estándar, `withPermission("proveedores:<accion>")`.

---

## 2. Interfaces y Contratos (Route Handlers / Server Actions)

### 2.3. Publicación de una nueva versión de Lista de Precios (HU-H2, HU-H6, HU-H9)

**Ruta:** `POST /app/api/proveedores/[id]/lista-precios/route.ts`
**Server Action equivalente:** `publicarListaPrecios()` en `app/(dashboard)/compras/listas-precios/actions.ts`
**Permiso requerido:** `proveedores:publicar_lista` dentro del umbral normal (Comprador, Supervisor de Compras); `proveedores:publicar_lista_critica` por encima del umbral (Supervisor de Compras directo; Comprador solo *solicita*).

**Schema ya migrado (migración `20260831050501_add_lista_precio_and_proveedor_bank_data`):** `model ListaPrecio` (cabecera lógica 1:N con `ListaPrecioVersion`, `proveedor_id`, bloque estándar de baja lógica y timestamps, `@@index([proveedor_id])`), `model ListaPrecioVersion` (`lista_precio_id`, `fecha_inicio_vigencia`, `variacion_porcentual_maxima`, `requiere_aprobacion`, `aprobada_por_id`, `aprobada_at`, `publicada`, bloque estándar de baja lógica y timestamps, `@@index([lista_precio_id, publicada, fecha_inicio_vigencia])`) y `model ListaPrecioItem` (`lista_precio_version_id`, `variante_sku_id`, `precio_unitario Decimal @db.Decimal(10, 2)`, `@@index([variante_sku_id])`) existen en `schema.prisma`.

**⚠️ Acción pendiente antes de implementar esta sección:** el campo `ListaPrecioVersion.publicada` fue migrado con `@default(true)`. El contrato funcional de esta especificación ("Comportamiento esperado" más abajo) exige el comportamiento inverso: toda versión debe nacer con `publicada` resuelto explícitamente por la capa de servicios en el mismo `$transaction` que la crea (`true` si no supera el umbral, `false` si lo supera), nunca por un default de columna — un default `true` es fail-unsafe: cualquier inserción futura que omita setear el campo explícitamente quedaría publicada por accidente. Corregir con `ALTER TABLE listas_precio_version ALTER COLUMN publicada SET DEFAULT false` (migración aditiva adicional, sin pérdida de datos) antes de implementar el servicio de esta sección. Esta corrección puede hacerse en cualquier momento, independientemente de cuándo se retome H2 — no hay razón para esperar al sprint que la implemente.

**Pendiente de confirmación de cardinalidad (no bloqueante para implementar, sí para cerrar el modelo de datos):** `ListaPrecio` fue migrado **sin** `@@unique([proveedor_id])` — el Documento de Alcance no es explícito sobre si un proveedor puede tener más de una `ListaPrecio` cabecera (ej. una por categoría de producto) o exactamente una. Mientras no se confirme, la consulta de "versión vigente" (ver más abajo) sigue funcionando correctamente porque resuelve mediante `take(1)` ordenado, pero la cardinalidad 1:1 asumida implícitamente en el resto de esta sección (y en 2.8, 2.9, que hablan de "la lista de precios del proveedor" en singular) depende de disciplina de la capa de servicios, no de un constraint de base de datos. Si el equipo confirma 1:1, aplicar `ALTER TABLE listas_precio ADD CONSTRAINT ... UNIQUE (proveedor_id)` como migración aditiva adicional.

**Faltante de configuración global (bloqueante, distinto de lo anterior):** un campo `variacion_umbral_critico` (`Decimal`, parametrizable por Dirección) debe vivir en una entidad de configuración global — **no** hardcodeado en el servicio. Esto **no** forma parte de la migración ya aplicada (que cubrió únicamente los modelos de datos transaccionales); si el Módulo D no expone aún dicha entidad de configuración cuando se retome esta HU, se declara explícitamente como dependencia bloqueante en la sección 5.

```typescript
export const PublicarListaPreciosSchema = z.object({
  fecha_inicio_vigencia: z.coerce.date().refine(
    (d) => d >= new Date(new Date().toDateString()),
    "La fecha de vigencia no puede ser anterior al día de hoy"
  ),
  items: z
    .array(
      z.object({
        variante_sku_id: z.string().uuid(),
        precio_unitario: z.number().positive("El precio unitario debe ser mayor a 0"),
      })
    )
    .min(1, "La lista debe incluir al menos un ítem"),
});
export type PublicarListaPreciosInput = z.infer<typeof PublicarListaPreciosSchema>;
```

**Comportamiento esperado:**
- **Inmutabilidad estricta (ver 3.4):** esta operación **nunca** ejecuta un `UPDATE` sobre una `ListaPrecioVersion` existente. Siempre inserta una `ListaPrecioVersion` nueva con sus `ListaPrecioItem` asociados, dentro de la misma `prisma.$transaction`.
- El servicio calcula, por cada `variante_sku_id` recibida, la variación porcentual contra el `precio_unitario` de la versión previamente vigente para ese proveedor y esa variante (si existe). El máximo de esas variaciones porcentuales se persiste en `variacion_porcentual_maxima`.
- Si `variacion_porcentual_maxima` supera el umbral parametrizado por Dirección: `publicada = false`, `requiere_aprobacion = true`, la versión queda creada pero **no habilitada** para su uso en nuevas `OrdenCompra` hasta que un Supervisor de Compras la apruebe explícitamente vía un endpoint de aprobación (`PATCH /app/api/proveedores/[id]/lista-precios/[version_id]/aprobar/route.ts`, mismo patrón de homologación de proveedor de `spec_modulo_H.md` sección 2.2, fuera del detalle de este documento por brevedad pero sujeto a las mismas reglas transaccionales y de evento crítico).
- Si no supera el umbral: `publicada = true` inmediatamente, sin paso de aprobación.
- Solo puede existir una `ListaPrecioVersion` con `publicada = true` y sin `fecha_inicio_vigencia` futura por proveedor en un momento dado — la resolución de "versión vigente" es una consulta (`fecha_inicio_vigencia <= now()` ordenada `desc`, `take(1)`), nunca un flag mutable tipo `es_vigente` que deba reescribirse en cada publicación (evitar condiciones de carrera entre publicaciones concurrentes).
- Toda publicación cuya `variacion_porcentual_maxima` supere el umbral crítico genera, tras el `COMMIT` de la transacción, el evento `proveedor:variacion_precio_critica` hacia el Módulo D (sección 4).
- Cuando esta HU se implemente, **actualizar `spec_modulo_H.md` sección 2.4 (HU-H3)**: retirar la advertencia bloqueante sobre resolución de precio (Camino A/B) y reemplazar el mecanismo de seed por este endpoint como fuente real de `ListaPrecioVersion`.

**Respuesta `201 Created` (dentro del umbral, publicación inmediata):**
```json
{ "data": { "lista_precio_version_id": "uuid", "publicada": true, "requiere_aprobacion": false }, "error": null }
```

**Respuesta `201 Created` (supera umbral, pendiente de aprobación):**
```json
{ "data": { "lista_precio_version_id": "uuid", "publicada": false, "requiere_aprobacion": true, "variacion_porcentual_maxima": 23.5 }, "error": null }
```

**Respuesta `422 Unprocessable Entity` (proveedor no homologado):**
```json
{ "data": null, "error": { "code": "PROVEEDOR_NO_HOMOLOGADO", "message": "Solo proveedores en estado HOMOLOGADO pueden publicar listas de precios" } }
```

---

### 2.7. Consola de Auditoría Forense de Proveedores (HU-H6)

**Contexto de trazabilidad:** el Product Backlog Consolidado exige que el Auditor pueda "consultar el historial de variaciones críticas de precios y cambios de homologación de proveedores con verificación SHA-256", con filtro por proveedor, rango de fechas, tipo de evento y usuario responsable. `spec_modulo_H.md` (Sprint 2) ya define la emisión de `proveedor:estado_cambiado`; esta sección define el endpoint de lectura, y depende además de `proveedor:variacion_precio_critica` (sección 2.3, diferida junto con esta HU).

**Ruta:** `GET /app/api/proveedores/auditoria/route.ts`
**Permiso requerido:** `auditoria:leer_historico` sobre el dominio `proveedores` (exclusivo Auditor, conforme matriz RBAC del Documento de Alcance § Módulo H, sección 5 — Supervisor de Compras conserva `✓` para el historial comercial general de la sección 2.8, pero el log de auditoría forense es de acceso exclusivo del Auditor).

**Principio de diseño no negociable:** este endpoint **no** recalcula ni reimplementa el encadenamiento SHA-256. El Módulo H no es propietario del `AuditLog` ni de la lógica de verificación de cadena — ambos son responsabilidad exclusiva del Módulo D (Regla N.° 3 de `RULES.md`, aislamiento de dominio). Este Route Handler es una consulta de conveniencia con **filtro pre-aplicado por dominio** (`modulo_origen = "H"` o equivalente en el schema del `AuditLog`) que delega la resolución de integridad de cadena a la capa de servicios del Módulo D (`lib/services/auditoria/verificacion-cadena.service.ts`, ya definida en `spec_modulo_D.md`) — no ejecuta su propio cálculo de hash. **Antes de implementar esta sección, confirmar con el owner del Módulo D que `listarEventosPorDominio(dominio, filtros)` existe o se agrega a su capa de servicios** — este documento asume su existencia pero no la garantiza.

```typescript
// lib/schemas/proveedores.schema.ts
export const ConsultarAuditoriaProveedoresQuerySchema = z.object({
  proveedor_id: z.string().uuid().optional(),
  tipo_evento: z.enum([
    "proveedor:estado_cambiado",
    "proveedor:variacion_precio_critica",
    "proveedor:legajo_bancario_consultado",
  ]).optional(),
  usuario_id: z.string().uuid().optional(),
  fecha_desde: z.coerce.date().optional(),
  fecha_hasta: z.coerce.date().optional(),
  verificar_integridad: z.coerce.boolean().default(false),
  // Si true, el servicio invoca la verificación de cadena del Módulo D sobre
  // el subconjunto de resultados devuelto — operación más costosa, opt-in
  // explícito del cliente, nunca ejecutada por defecto en cada listado.
  pagina: z.coerce.number().int().positive().default(1),
  por_pagina: z.coerce.number().int().positive().max(50).default(20),
});
export type ConsultarAuditoriaProveedoresQuery = z.infer<typeof ConsultarAuditoriaProveedoresQuerySchema>;
```

**Comportamiento esperado:**
- Consulta de solo lectura sobre `AuditLog` (Módulo D), filtrada por los `tipo_evento` propios de este módulo (ver enum arriba, alineado 1:1 con la tabla de eventos de la sección 4) — el Route Handler de Módulo H invoca una función expuesta por la capa de servicios del Módulo D (`listarEventosPorDominio(dominio: "proveedores", filtros)`), no accede a la tabla `AuditLog` mediante un `prisma.auditLog.findMany` propio, para no duplicar la capa de acceso a datos de una entidad que no pertenece a este módulo.
- Si `verificar_integridad = true`, el servicio invoca adicionalmente `verificarCadenaHash()` del Módulo D sobre el rango de registros devuelto y expone en la respuesta el resultado (`integra: boolean`, `punto_ruptura_id?: string`) — mismo contrato de verificación que HU-A6/HU-D4, reutilizado sin reimplementación.
- Los registros son append-only por herencia del `AuditLog` — este endpoint no expone, ni indirectamente, ninguna operación de edición o borrado sobre los eventos consultados.

**Respuesta `200 OK`:**
```json
{
  "data": {
    "items": [
      {
        "audit_log_id": "uuid",
        "tipo_evento": "proveedor:variacion_precio_critica",
        "proveedor_id": "uuid",
        "usuario_id": "uuid",
        "valor_anterior": { "precio_unitario_referencia": 4500.00 },
        "valor_nuevo": { "precio_unitario_referencia": 5550.00 },
        "hash_actual": "a1b2c3...",
        "created_at": "2026-08-25T14:20:00.000Z"
      }
    ],
    "paginacion": { "total": 47, "pagina_actual": 1, "total_paginas": 3, "por_pagina": 20 },
    "verificacion_integridad": null
  },
  "error": null
}
```

**Respuesta `200 OK` (con `verificar_integridad = true` y cadena íntegra):**
```json
{
  "data": {
    "items": [ "..." ],
    "paginacion": { "total": 47, "pagina_actual": 1, "total_paginas": 3, "por_pagina": 20 },
    "verificacion_integridad": { "integra": true, "punto_ruptura_id": null }
  },
  "error": null
}
```

---

### 2.8. Vista comparativa de precios entre proveedores (HU-H7)

**Contexto de trazabilidad:** el Backlog exige, para un mismo insumo (SKU o categoría), una comparación entre proveedores que incluya precio unitario vigente, fecha de vigencia, puntaje de evaluación y **tiempo de entrega comprometido histórico**. Esta HU depende de `ListaPrecioVersion`/`ListaPrecioItem` con contenido real publicado (sección 2.3, también diferida) y adicionalmente requiere una métrica derivada no persistida (tiempo de entrega histórico) que se define a continuación de forma explícita para eliminar cualquier ambigüedad de cálculo.

**Ruta:** `GET /app/api/proveedores/comparativa-precios/route.ts`
**Server Action equivalente:** ninguna — este es un caso de uso de consulta pura, consumido directamente vía Route Handler desde el cliente (patrón ya establecido para vistas de solo lectura de alto volumen de filtros, ver sección 2.6 de `spec_modulo_A.md`).
**Permiso requerido:** `proveedores:comparar_precios` (Comprador y Supervisor de Compras, `✓` directo conforme matriz RBAC del Documento de Alcance § Módulo H, sección 5 — "Consultar el historial de precios y órdenes de un proveedor").

```typescript
export const ComparativaPreciosQuerySchema = z.object({
  variante_sku_id: z.string().uuid().optional(),
  categoria: z.string().min(1).optional(),
}).refine(
  (d) => d.variante_sku_id !== undefined || d.categoria !== undefined,
  { message: "Debe indicarse variante_sku_id o categoria", path: ["variante_sku_id"] }
);
export type ComparativaPreciosQuery = z.infer<typeof ComparativaPreciosQuerySchema>;
```

**Definición determinística de "tiempo de entrega comprometido histórico" (sin ambigüedad de cálculo):** se define como el promedio, en días corridos, de `(Recepcion.fecha_recepcion de la recepción que llevó la OrdenCompra a RECIBIDA_COMPLETA) − (OrdenCompra.fecha_confirmacion)`, calculado sobre el universo de `OrdenCompra` del proveedor con `estado ∈ { RECIBIDA_COMPLETA, CERRADA }` y `is_active = true`, sin límite de ventana temporal salvo que el equipo defina explícitamente un recorte (ej. "últimos 12 meses") como parámetro de configuración — de no existir esa definición, el cálculo es sobre el historial completo. Esta métrica se calcula **on-demand** en el momento de la consulta (agregación SQL vía Prisma `groupBy`/`aggregate`), nunca se persiste ni se cachea, consistente con el principio de "nunca una copia cacheada desactualizada" que HU-H8 (2.9) exige de forma explícita para el costo de reposición y que este documento extiende por coherencia a toda métrica derivada de este módulo. **Confirmar esta fórmula con el equipo antes de implementar** — es una interpretación razonable del criterio de aceptación del Backlog, pero el Backlog no la especifica de forma unívoca (alternativa posible: medir contra `fecha_entrega_comprometida` en vez de `fecha_confirmacion`, para evaluar cumplimiento de plazo en vez de duración real del ciclo).

**Comportamiento esperado:**
1. Resuelve el conjunto de proveedores candidatos: si se recibe `variante_sku_id`, todos los `Proveedor` con `estado = "HOMOLOGADO"` que tengan un `ListaPrecioItem` para esa variante en su `ListaPrecioVersion` vigente (misma consulta de "versión vigente" de 2.3/3.4); si se recibe `categoria`, todos los `Proveedor` homologados cuyo array `categorias` (`schema.prisma` línea 530) contenga ese valor, restringido además a los que tengan al menos un ítem vigente en esa categoría.
2. Para cada proveedor candidato, agrega en una única fila de respuesta: `precio_unitario` (de la lista vigente), `fecha_inicio_vigencia` de esa versión, `puntaje_total` de la `EvaluacionProveedor` más reciente (`fecha_evaluacion desc`, `take(1)`), y `tiempo_entrega_promedio_dias` (definición del párrafo anterior).
3. Proveedores homologados sin evaluación previa exponen `puntaje_total: null` — el frontend es responsable de representar la ausencia de dato, el servicio **no** debe sustituir por `0` (un `0` sería indistinguible de una evaluación real de puntaje mínimo).
4. La respuesta se ordena por `precio_unitario` ascendente por defecto (criterio de "mayor conveniencia económica" del backlog), sin paginación explícita — el universo de proveedores homologados por insumo es acotado por diseño de negocio (no se espera un volumen que requiera paginación; si en producción se detecta lo contrario, es una revisión posterior de este contrato, no una asunción a resolver ahora).

**Respuesta `200 OK`:**
```json
{
  "data": {
    "variante_sku_id": "uuid",
    "proveedores": [
      {
        "proveedor_id": "uuid",
        "razon_social": "Textiles del Norte S.A.",
        "precio_unitario": 4500.00,
        "fecha_inicio_vigencia": "2026-08-01T00:00:00.000Z",
        "puntaje_total": 87.5,
        "tiempo_entrega_promedio_dias": 12.4
      },
      {
        "proveedor_id": "uuid",
        "razon_social": "Confecciones Salta SRL",
        "precio_unitario": 4720.00,
        "fecha_inicio_vigencia": "2026-07-15T00:00:00.000Z",
        "puntaje_total": null,
        "tiempo_entrega_promedio_dias": null
      }
    ]
  },
  "error": null
}
```

**Respuesta `422 Unprocessable Entity` (ningún proveedor homologado para el criterio):**
```json
{ "data": null, "error": { "code": "SIN_PROVEEDORES_COMPARABLES", "message": "No hay proveedores homologados con precio vigente para el criterio indicado" } }
```

---

### 2.9. Servicio de costo de reposición vigente (HU-H8)

**Contexto de trazabilidad:** este endpoint es un servicio **interno de integración**, consumido de forma síncrona por el Módulo B en el momento de confirmar una venta (cálculo de margen) y por el Módulo D para el KPI de rentabilidad del Tablero de Comando. No tiene Server Action equivalente ni formulario de UI propio del Módulo H — es exclusivamente un Route Handler de contrato API interno. **Nota adicional de dependencia:** el Módulo B, consumidor principal de este servicio, tampoco existe todavía (no está construido en Sprint 2) — esta HU está doblemente diferida: por su propia planificación de sprint y porque su consumidor real no existe aún.

**Ruta:** `GET /app/api/proveedores/costo-reposicion/[variante_sku_id]/route.ts`
**Permiso requerido:** `proveedores:leer_costo_reposicion`, otorgado como permiso de servicio-a-servicio a los llamadores autorizados (Módulo B, Módulo D), no expuesto en ningún menú de navegación de usuario final — la sesión que invoca este endpoint es la del usuario que dispara la operación de venta o de refresco del Tablero de Comando, no un usuario del Módulo H.

```typescript
export const CostoReposicionParamsSchema = z.object({
  variante_sku_id: z.string().uuid(),
});
export type CostoReposicionParams = z.infer<typeof CostoReposicionParamsSchema>;
```

**Regla de resolución de proveedor (desempate — sin ambigüedad):**
1. Se resuelve el conjunto de `Proveedor` con `estado = "HOMOLOGADO"`, `is_active = true`, que tengan un `ListaPrecioItem` para `variante_sku_id` en su `ListaPrecioVersion` vigente (misma consulta de "versión vigente" de 2.3/3.4, evaluada `on-demand`, nunca cacheada — criterio de aceptación explícito del Backlog).
2. Si existe un `proveedor_preferente_id` configurado explícitamente para esa `VarianteSKU` (**faltante de schema adicional**: no existe hoy un campo `proveedor_preferente_id` en `VarianteSKU` ni tabla de configuración equivalente — no formó parte de la migración de Revisión 3 y debe agregarse como parte de una migración futura si se requiere soportar esta preferencia; hasta que exista, el sistema se comporta como si ningún producto tuviera proveedor preferente configurado) y ese proveedor está en el conjunto resuelto en el paso 1, se retorna su precio sin más evaluación.
3. En ausencia de proveedor preferente aplicable, se retorna el `precio_unitario` **mínimo** entre los proveedores candidatos del paso 1 (regla explícita del Backlog: "expone el costo del proveedor de menor precio vigente, salvo configuración explícita de proveedor preferente").
4. Si el conjunto de candidatos del paso 1 está vacío (ninguna variante tiene proveedor homologado con precio vigente), `404` con `code: "SIN_COSTO_REPOSICION_DISPONIBLE"` — el Módulo B debe manejar explícitamente esta ausencia (por ejemplo, impidiendo el cálculo de margen o marcándolo como "no disponible"), nunca asumir un costo `0` ni un valor por defecto silencioso.

**Prohibición explícita de cacheo (cumplimiento literal del criterio de aceptación):** ninguna capa de este endpoint —Route Handler, capa de servicios, ni infraestructura (Redis, memoria de proceso, `revalidate` de Next.js)— debe cachear el resultado de este cálculo más allá de la duración de una única request. El criterio de aceptación de HU-H8 es explícito: "nunca a una copia cacheada desactualizada". Un cambio de `ListaPrecioVersion` (HU-H2) debe reflejarse en la siguiente consulta a este endpoint sin ningún mecanismo de invalidación intermedio que gestionar — la ausencia de caché es la estrategia de invalidación. Esta restricción debe quedar explícita en el docstring de la función de servicio correspondiente para prevenir que una futura optimización de performance introduzca cacheo sin revisar este documento.

**Comportamiento esperado:**
- Operación de **solo lectura**, sin `$transaction` (no escribe ninguna tabla).
- No emite evento de dominio propio — es una consulta pura sin efecto sobre el estado del sistema.
- El Módulo B, al confirmar una venta, invoca este endpoint de forma síncrona antes de calcular el margen; una falla de este endpoint (`404` o error 5xx) es responsabilidad del Módulo B decidir cómo se propaga a la UX de venta — fuera de alcance de este documento.

**Respuesta `200 OK`:**
```json
{
  "data": {
    "variante_sku_id": "uuid",
    "proveedor_id": "uuid",
    "precio_unitario": 4500.00,
    "fecha_inicio_vigencia": "2026-08-01T00:00:00.000Z",
    "criterio_seleccion": "MENOR_PRECIO_VIGENTE"
  },
  "error": null
}
```
*(`criterio_seleccion` es `"MENOR_PRECIO_VIGENTE"` o `"PROVEEDOR_PREFERENTE"`, expuesto explícitamente para que el Módulo D pueda auditar en el Tablero de Comando por qué se seleccionó ese proveedor y no otro, sin tener que inferirlo comparando contra el resto de la cartera.)*

**Respuesta `404 Not Found`:**
```json
{ "data": null, "error": { "code": "SIN_COSTO_REPOSICION_DISPONIBLE", "message": "Ninguna VarianteSKU con proveedor homologado y precio vigente para este SKU" } }
```

---

## 3. Reglas de Negocio Estrictas (Capa de Servicios) — de esta porción diferida

### 3.4. Inmutabilidad estricta de `ListaPrecioVersion` (versionado continuo)

- Ninguna actualización de precio ejecuta `UPDATE` sobre una `ListaPrecioVersion` o `ListaPrecioItem` ya persistidos. Toda modificación de precios —incluida la corrección de un error de tipeo— crea una `ListaPrecioVersion` nueva con nueva `fecha_inicio_vigencia`.
- `OrdenCompraItem.precio_unitario` congela, en el momento de creación de la orden (`spec_modulo_H.md` sección 2.4), el precio de la versión vigente en ese instante. Una publicación posterior de una nueva `ListaPrecioVersion` **no** debe, bajo ninguna implementación, disparar un `UPDATE` sobre `OrdenCompraItem.precio_unitario` de órdenes ya emitidas — verificar explícitamente que ningún trigger, listener de eventos ni job recorra órdenes existentes al publicarse una lista nueva.
- La resolución de "versión vigente" de un proveedor es siempre una consulta derivada (`publicada = true AND fecha_inicio_vigencia <= now()`, ordenada `desc`, `take(1)`) evaluada en el momento de la consulta — nunca un puntero cacheado o un flag `es_vigente` persistido que deba mantenerse sincronizado manualmente entre publicaciones.
- Esta misma consulta derivada es la fuente de verdad única que debe reutilizar `spec_modulo_H.md` sección 2.4 (HU-H3, cuando se migre del seed temporal a esta HU real) y las secciones 2.8 y 2.9 de este documento. Ninguna de ellas debe implementar su propia lógica de resolución de "versión vigente" — todas invocan la misma función de servicio (`resolverListaPrecioVigente(proveedor_id, variante_sku_id?)`), evitando divergencia de criterio entre los distintos puntos de consumo.

### 3.7. Cifrado AES-256 — corrección de datos bancarios (complemento de HU-H6)

- Toda consulta exitosa de `datos_bancarios` descifrados por un Auditor genera, tras resolverse, el evento `proveedor:legajo_bancario_consultado` hacia el Módulo D (sección 4) — el acceso de lectura a un dato cifrado es en sí mismo un evento auditable, igual que en Módulo C. Este evento solo tiene un consumidor real (la consola de auditoría de la sección 2.7) una vez que HU-H6 esté implementada; hasta entonces, el endpoint de consulta de legajo bancario (`spec_modulo_H.md` sección 3.3) puede emitir el evento igualmente hacia el `AuditLog` general del Módulo D sin depender de que exista la consola de esta sección.
- Ninguna corrección de `datos_bancarios` se implementa como `UPDATE` directo sobre el campo cifrado existente: se trata como una nueva versión auditada del legajo (mismo principio de no-sobrescritura aplicado a `ListaPrecioVersion` en 3.4), preservando el valor cifrado anterior accesible para reconstrucción forense.

### Transacciones y eventos — nota de alcance

Las secciones 2.7, 2.8 y 2.9 de este documento son de **solo lectura** y no ejecutan `$transaction` ni emiten eventos de dominio propios (ver nota en cada sección). La sección 2.3 (HU-H2) sí ejecuta `$transaction` y emite evento crítico — sigue el mismo patrón fire-and-forget post-`COMMIT` que `spec_modulo_H.md` sección 3.4 establece para H1/H3/H4/H5.

---

## 4. Eventos de Dominio (EDA) — de esta porción diferida

| Evento | Disparado por | Consumidor | Payload mínimo |
|---|---|---|---|
| `proveedor:variacion_precio_critica` | 2.3 | Módulo D (`audit-log.listener.ts`) | `{ proveedor_id, lista_precio_version_id, usuario_id, variacion_porcentual_maxima, requiere_aprobacion, valor_anterior, valor_nuevo }` — `valor_anterior`/`valor_nuevo` referencian los `precio_unitario` agregados de la variante con mayor variación, no la lista completa |
| `proveedor:legajo_bancario_consultado` | 3.7 (complemento de sección 3.3 de `spec_modulo_H.md`) | Módulo D (`audit-log.listener.ts`) | `{ proveedor_id, usuario_id, rol: "AUDITOR" }` — sin incluir el dato bancario en ningún caso |

**Sin eventos nuevos en 2.7, 2.8, 2.9:** son operaciones de solo lectura — 2.7 consume eventos ya existentes (no los emite), y 2.8/2.9 son cálculos on-demand sin persistencia ni notificación de cambio de estado.

**Regla de exclusión de datos sensibles en el payload:** misma convención que `spec_modulo_H.md` sección 4 y `spec_modulo_D.md` §5.1 — ningún evento de este módulo incluye en su payload el valor en claro de `datos_bancarios`.

---

## 5. Fuera de Alcance (diferido / bloqueado) — dentro de este documento ya diferido

- **Corrección del default de `ListaPrecioVersion.publicada`:** ver advertencia en sección 2.3. Es la única acción de código que puede (y conviene) resolverse ya mismo, independientemente de cuándo se implemente el resto.
- **Cardinalidad `ListaPrecio` ↔ `Proveedor` (1:1 vs. 1:N):** migrado sin `@@unique([proveedor_id])` por ambigüedad del Documento de Alcance (ver nota en sección 2.3). Confirmar con el equipo antes de considerar el modelo de datos cerrado.
- **Campo `proveedor_preferente_id` (o tabla de configuración equivalente) para el desempate de HU-H8 (2.9):** no existe aún en `schema.prisma`. Hasta su definición, el servicio de costo de reposición opera siempre bajo el criterio de menor precio vigente, sin excepción por preferencia.
- **Entidad de configuración global para `variacion_umbral_critico` (sección 2.3):** dependencia bloqueante a resolver con el owner de Módulo D.
- **Endpoint de aprobación de `ListaPrecioVersion` (`.../lista-precios/[version_id]/aprobar`):** mencionado en 2.3 pero no detallado en este documento; se especifica como documento independiente o adenda cuando se resuelva el resto del modelo de datos.
- **Confirmación de la función `listarEventosPorDominio` del Módulo D (sección 2.7):** este documento asume su existencia; verificar con el owner de Módulo D antes de implementar.
- **Confirmación de fórmula de "tiempo de entrega comprometido histórico" (sección 2.8):** interpretación razonable pero no unívoca del criterio de aceptación del Backlog; confirmar antes de implementar.
- **Recorte de ventana temporal configurable para `tiempo_entrega_promedio_dias` (sección 2.8):** este documento define el cálculo sobre el historial completo del proveedor a falta de una definición explícita de ventana (ej. "últimos 12 meses").
- **Dependencia de Módulo B para HU-H8 (sección 2.9):** el consumidor principal de este servicio no existe todavía en el proyecto. Implementable de forma aislada y testeable vía Postman (mismo patrón que HU-A10 en Sprint 2), pero sin consumidor real hasta que Módulo B se construya.
