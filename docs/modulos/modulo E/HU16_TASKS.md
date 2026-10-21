# SDD — HU-E16: Tasks de implementación

## Alcance y reglas

- **HU:** HU-E16 (backlog Sprint 5, fila 6) — Administrador E-commerce: "que el sistema no deje activar «mostrar en tienda» sin descripción ni foto, para evitar productos publicados a medias". 3 SP.
- **Contrato normativo:** `docs/specs/spec_modulo_E.md` §6.2 (filas E16-1 a E16-5 y párrafo "Concurrencia"). Contexto vigente: §2.5, §2.5.a–e (HU-E5), §2.11.d–g (HU-E11), §4 (extensiones Rev.4 y Rev.6) y la nota E16 de `docs/specs/spec_modulo_D.md` (D.3 confirma persistencia al productor).
- **Reglas transversales (`RULES.md`):** baja lógica (nunca DELETE), auditoría con hash SHA-256 encadenado vía `registrarAuditLog` (el productor nunca escribe `AuditLog`), Adapter/Gateway para externos (E16 no toca ninguno).
- No se amplía el alcance de §6.2. No se crean endpoints nuevos (el listado admin sigue leyéndose desde el Server Component, §2.5.b D9).
- **Sin cambios de `prisma/schema.prisma` ni migraciones.** Verificado contra el schema: `ProductoWebContenido.descripcion` (String NOT NULL), `visibilidad_web`, `ProductoWebFoto.is_active/deleted_at` y `AuditLog` (`registro_id String?`, `valor_nuevo Json?`) ya alcanzan. Si una task descubre que hace falta algo de schema, **frena y reporta**.
- Esta fase no implementa código ni ejecuta operaciones Git. Este archivo es el backlog técnico ejecutable de HU-E16.

### Decisiones de diseño fijadas

| # | Decisión |
|---|---|
| D1 | `cambiarVisibilidadWeb` toma, al inicio de su transacción y para **todo** pedido, el mismo `SELECT … FOR UPDATE` sobre `contenidos_producto_web` que usan las operaciones de fotos. El helper `bloquearContenidoActivo` hoy es privado de `foto-web.service.ts`: se **extrae** a un módulo compartido y ambos servicios lo importan (no se duplica SQL). La validación de descripción + fotos activas corre **dentro** de esa transacción y **solo** en el caso `false → true`. |
| D2 | Si falta algo, la transacción no hace UPDATE y **devuelve** los faltantes (no lanza dentro de la tx). Fuera de la tx: emitir `ecommerce:publicacion_web_rechazada` `{ intento_id (randomUUID), actor_id, producto_web_id, faltantes, timestamp }` y esperar la confirmación de D.3 con un coordinador propio de E16 que copia `libro-iva-confirmacion.ts` / `libro-iva-auditoria.ts` (singleton en `globalThis`, `esperar` registrado ANTES de emitir, `cancelar` en `finally`, carrera contra `listenersRegistrados`, plazo configurable para tests). Confirmado → `ServiceError("CONTENIDO_NO_PUBLICABLE", …, { faltantes })` (422). Falla / timeout / sin listener (`emit` devuelve `false`) → `ServiceError("AUDITORIA_NO_DISPONIBLE")` (503). En ningún camino hay UPDATE de visibilidad. |
| D3 | Orden canónico de `faltantes`: `['descripcion']`, `['foto']` o `['descripcion', 'foto']`. |
| D4 | Handler nuevo en `audit-log.listener.ts` con marca `Symbol.for("swat.audit-log.publicacion-web-rechazada")` anti-duplicado (patrón libro IVA). Un asiento por `intento_id`: `usuario_id = actor_id`, `accion = "ecommerce:publicacion_web_rechazada"`, `tabla_afectada = "contenidos_producto_web"`, `registro_id = producto_web_id`, `ip = "internal-event"`, `valor_anterior = null`, `valor_nuevo` con whitelist `{ intento_id, faltantes, timestamp }` — **sin descripción ni URLs**. Confirma `true` solo después de que `registrarAuditLog` resolvió; `false` si rechazó. El coordinador se carga con `import()` dinámico dentro del handler (como libro IVA) para no romper los arneses aislados existentes. |
| D5 | Ocultar (`true → false`) y el no-op (pedir el valor actual, incluido "ya visible → pedir visible" aunque no sea publicable) mantienen exactamente el contrato E5: mismo resultado, mismo evento `ecommerce:visibilidad_web_cambiada`, mismo aviso a carritos, sin evento de rechazo. |
| D6 | `respuesta-catalogo.ts`: `CONTENIDO_NO_PUBLICABLE → 422`, `AUDITORIA_NO_DISPONIBLE → 503`; `error.details` se propaga **solo** para `CONTENIDO_NO_PUBLICABLE`. |
| D7 | `listarContenidoWebAdmin` agrega `publicable: boolean` y `faltantes: FaltantePublicacion[]` calculados en servidor con la **misma** función pura que usa el servicio. No filtra por publicabilidad. |
| D8 | UI: "Mostrar en tienda" deshabilitado si `!publicable`, con el motivo visible; badge "No publicable" + faltantes si está visible pero ya no es publicable; "Ocultar en tienda" siempre habilitado. Manejo de 422/503 si llegan igual (carrera). |
| D9 | Baja de la última foto: no cambia `visibilidad_web` (E16-3). El catálogo público ya lo excluye (`whereContenidoPublicado.fotos: { some: NO_BORRADO }` en `catalogo-web.service.ts:161` y `evaluarComprabilidad` en `comprabilidad.ts`): **solo test de regresión**, sin cambios en esos archivos. |
| D10 | Seed idempotente con IDs fijos: ProductoMaestro + variante + precio en `listaPrecioVentaVersion1` + stock en Showroom + `ProductoWebContenido` con descripción, **sin fotos**, `visibilidad_web = false`. No se vuelve visible. |
| D11 | Sin cambios de schema ni migraciones. |
| D12 | Plazo de confirmación: constante **10 s** (`PLAZO_CONFIRMACION_RECHAZO_MS`), sobrescribible solo como propiedad del singleton para tests. **Sin clave de Configuración D.4** (C5 resuelta). |
| D13 | El helper de lock compartido lo usan **solo** `visibilidad-web.service.ts` y `foto-web.service.ts`. `contenido-web.service.ts` conserva su SQL en línea (deuda técnica DT-1, C3 resuelta). |
| D14 | **`package.json` se edita una única vez, en T01**, con todas las entradas nuevas de HU-E16 (tests unitarios en `test` y scripts `test:integration:e16` / `test:integration:e16-http`). Ninguna otra task toca `package.json` (C7 resuelta). |
| D15 | T07 agrega a `spec_modulo_E.md`, como **nota aditiva de Rev.10** (sin reescribir contenido existente), el evento `ecommerce:publicacion_web_rechazada` en §4 y `CONTENIDO_NO_PUBLICABLE` (422) / `AUDITORIA_NO_DISPONIBLE` (503) en la tabla de errores (C1 resuelta). |

---

## 1. Resumen ejecutivo

HU-E16 se divide en **7 tasks** con **2 puntos de parada obligatorios** (después del servicio + auditoría y después de la UI). No hay modelo ni migración: el trabajo empieza por la regla pura de publicabilidad, el evento tipado y el coordinador de confirmación (T01); sigue con el lado D.3 (listener + productor que espera confirmación, T02) y con el servicio, que reutiliza el lock de fotos y expone `publicable`/`faltantes` en el listado (T03). **STOP.** Luego se mapea el contrato HTTP (T04), la UI de backoffice (T05, **STOP**), el seed de demostración (T06, paralelizable) y la verificación integral con documentación de evidencia (T07).

---

## 2. Tabla resumida T01–T07

| ID | Título | Archivo(s) principal(es) | Dependencia | STOP | Riesgo merge |
|---|---|---|---|---|---|
| T01 | Regla pura de publicabilidad, evento, coordinador y scripts | `src/lib/services/ecommerce/publicabilidad-web.reglas.ts`, `src/lib/events/event-types.ts`, `src/lib/events/publicacion-web-confirmacion.ts` (+ tests), `package.json` (única edición) | Aprobación de este TASKS | No | Medio (`event-types.ts`, `package.json`) |
| T02 | Auditoría D.3 con confirmación al productor | `src/lib/events/listeners/audit-log.listener.ts`, `src/lib/events/publicacion-web-auditoria.ts` (+ test de listener) | T01 | No | Alto (`audit-log.listener.ts`) |
| T03 | Servicio: lock compartido, validación false→true, rechazo auditado y listado | `src/lib/services/ecommerce/contenido-web-lock.ts`, `visibilidad-web.service.ts`, `foto-web.service.ts`, `hu-e16.integration.test.ts` | T01, T02 | **Sí** | Medio |
| T04 | Contrato HTTP 422/503 con `details` | `src/lib/services/ecommerce/respuesta-catalogo.ts`, ruta `visibilidad/route.ts` (doc), `hu-e16.http.integration.test.ts` | T03 aprobado | No | Bajo |
| T05 | UI de backoffice: publicable / no publicable | `src/components/ecommerce/CatalogoWebAdmin.tsx` (+ test de fuente) | T04 | **Sí** | Bajo |
| T06 | Seed de demostración E16-5 | `prisma/seed.ts` | T03 aprobado (puede redactarse en paralelo) | No | Alto (`seed.ts`) |
| T07 | Verificación integral, evidencia y nota Rev.10 | `docs/modulos/modulo E/HU16_MODULO_E.md`, `docs/specs/spec_modulo_E.md` (nota aditiva) | T01–T06 | No | Medio |

### Mapa CA §6.2 → tasks

| CA / caso | T01 | T02 | T03 | T04 | T05 | T06 | T07 |
|---|---|---|---|---|---|---|---|
| E16-1 (validación en la misma tx, 422 con faltantes, sin UPDATE, E5 intacto) | regla | | ✔ | ✔ | | | ✔ |
| E16-2 (servicio obligatorio, PATCH, `publicable`/`faltantes`, UI deshabilita) | regla | | ✔ | ✔ | ✔ | | ✔ |
| E16-3 (última foto: público excluye, admin "No publicable", visibilidad intacta, sin filtro admin) | | | ✔ | | ✔ | | ✔ |
| E16-4 (evento, asiento por `intento_id`, confirmación, 503, sin fire-and-forget) | evento + coordinador | ✔ | ✔ | ✔ | ✔ (503) | | ✔ |
| E16-5 (seed idempotente, sin foto, no visible) | | | | | | ✔ | ✔ |
| Concurrencia: faltantes individuales/combinados | ✔ | | ✔ | ✔ | | | |
| Concurrencia: mutación nula | | | ✔ | ✔ | | | |
| Concurrencia: un asiento por cada 422, incluso repetido | | ✔ | ✔ | ✔ | | | |
| Concurrencia: fallo y timeout del listener → 503 sin cambio | ✔ (timeout) | ✔ | ✔ | ✔ | | | |
| Concurrencia: carrera con baja de foto | | | ✔ | | | | |
| Concurrencia: visible que pierde la última foto | | | ✔ | | ✔ | | |

---

## 3. Detalle completo de tasks

### T01 — Regla pura de publicabilidad, evento y coordinador

- **Objetivo:** dejar las tres piezas sin dependencias de BD que el resto consume: la regla única de publicabilidad (una sola fuente de verdad para servicio y listado), el tipo del evento `ecommerce:publicacion_web_rechazada` y el coordinador de confirmación propio de E16.
- **Dependencia previa:** aprobación de este TASKS.
- **Archivos autorizados:**
  - `src/lib/services/ecommerce/publicabilidad-web.reglas.ts` (nuevo)
  - `src/lib/services/ecommerce/publicabilidad-web.reglas.test.ts` (nuevo)
  - `src/lib/events/event-types.ts`
  - `src/lib/events/event-types.test.ts` (solo si hace falta asertar el nuevo tipo)
  - `src/lib/events/publicacion-web-confirmacion.ts` (nuevo)
  - `src/lib/events/publicacion-web-confirmacion.test.ts` (nuevo)
  - `package.json` — **única edición de HU-E16 en este archivo (D14)**: agregar al script `test` los cuatro unitarios nuevos (`publicabilidad-web.reglas.test.ts`, `publicacion-web-confirmacion.test.ts`, `audit-log.listener.e16.test.ts` de T02 y `catalogo-web-admin.e16.test.ts` de T05) y crear `test:integration:e16` y `test:integration:e16-http` con el molde de `test:integration:e5` / `e5-http`.
- **Archivos prohibidos:** `prisma/**`, `src/lib/services/ecommerce/*.service.ts`, `src/lib/events/listeners/**`, `src/app/**`, `src/components/**`, `comprabilidad.ts`, `catalogo-web.service.ts`.
- **Cambios previstos:**
  - `publicabilidad-web.reglas.ts` — función pura, sin Prisma ni `server-only` (molde de `comprabilidad.ts`, testeable con `node --test`):
    - `export type FaltantePublicacion = "descripcion" | "foto";`
    - `export function evaluarPublicabilidad(c: { descripcion: string; fotos_activas: number }): { publicable: boolean; faltantes: FaltantePublicacion[] }` — `descripcion.trim().length > 0` y `fotos_activas >= 1`; faltantes en orden canónico D3.
    - `export const ETIQUETA_FALTANTE: Record<FaltantePublicacion, string>` (p. ej. "Falta la descripción", "Falta al menos una foto activa") para la UI.
  - `event-types.ts`:
    - `export interface PublicacionWebRechazadaPayload { intento_id: string; actor_id: string; producto_web_id: string; faltantes: FaltantePublicacion[]; timestamp: string }` (comentario: sin descripción ni URLs; spec E §6.2 E16-4). Tipar `faltantes` como literal `("descripcion" | "foto")[]` sin importar desde services si eso crea una dependencia invertida.
    - Entrada `"ecommerce:publicacion_web_rechazada": PublicacionWebRechazadaPayload` en `DomainEventMap`, junto al bloque de `ecommerce:foto_web_baja`.
    - Agregar el nombre a `TIPOS_EVENTO_DOMINIO` (el chequeo `EventosFaltantes` falla el typecheck si se omite).
  - `publicacion-web-confirmacion.ts` — copia del patrón de `libro-iva-confirmacion.ts`:
    - `class ConfirmacionesPublicacionWeb` con `esperar(id, plazoMs = this.plazoMs)` (lanza si el id ya está pendiente), `confirmar(id, ok)`, `cantidadPendiente`; respuestas tardías o de otro id no resuelven nada.
    - `export const PLAZO_CONFIRMACION_RECHAZO_MS = 10_000` y `plazoMs` como propiedad pública inicializada con esa constante (D12), único gancho de configuración y solo para tests. No se lee ninguna clave de Configuración D.4.
    - Singleton en `globalThis` (`swatConfirmacionesPublicacionWeb`) sobreviviendo recargas.
- **Tests obligatorios:**
  - `publicabilidad-web.reglas.test.ts`: completo → `{ publicable: true, faltantes: [] }`; sin descripción → `['descripcion']`; descripción de solo espacios → `['descripcion']`; sin foto → `['foto']`; ambos → `['descripcion','foto']` (orden fijo).
  - `publicacion-web-confirmacion.test.ts` (molde `libro-iva-confirmacion.test.ts`): concurrencia de ids, duplicado lanza, timeout resuelve `false`, respuesta tardía no afecta otra espera, `cancelar` limpia, `plazoMs` ajustable.
  - `npx tsc --noEmit` (exhaustividad de `TIPOS_EVENTO_DOMINIO`) y `src/lib/events/event-types.test.ts`.
- **Definition of Done:** tipos compilan; regla y coordinador cubiertos; ningún servicio ni listener modificado; `package.json` contiene **todas** las entradas de HU-E16 (D14) y ninguna otra modificación. Mientras T02 y T05 no estén fusionados, `npm test` falla por los dos archivos aún inexistentes: en T01–T04 los unitarios se corren por ruta directa (`node --experimental-strip-types --test <archivo>`) y `npm test` completo se exige verde desde T05 (ver C7).
- **CA que cubre:** base de E16-1/E16-2 (regla), E16-4 (evento y coordinador), matriz: faltantes individuales/combinados, timeout.
- **Qué NO incluye:** handler de auditoría, productor, servicio, HTTP, UI.

---

### T02 — Auditoría D.3 con confirmación al productor

- **Objetivo:** implementar los dos extremos de la garantía E16-4: el handler de D.3 que persiste un asiento por `intento_id` y confirma, y el helper del productor que espera esa confirmación.
- **Dependencia previa:** T01.
- **Archivos autorizados:**
  - `src/lib/events/listeners/audit-log.listener.ts`
  - `src/lib/events/publicacion-web-auditoria.ts` (nuevo)
  - `src/lib/events/listeners/audit-log.listener.e16.test.ts` (nuevo; ya registrado en `package.json` por T01)
- **Archivos prohibidos:** `package.json`, `src/lib/services/auditoria/audit-log.service.ts`, `src/lib/events/domain-event-bus.ts`, `libro-iva-*.ts`, servicios de ecommerce, `src/app/**`, `src/components/**`, `prisma/**`.
- **Cambios previstos:**
  - `audit-log.listener.ts` — bloque "HU-E16" junto a los bloques HU-E5/HU-E11, con el molde exacto del handler de `tesoreria:libro_iva_exportado` (`audit-log.listener.ts:2091-2122`):
    - Guarda `if (!domainEventBus.listeners("ecommerce:publicacion_web_rechazada").some((h) => Reflect.get(h, marca)))`.
    - `void import("@/lib/events/publicacion-web-confirmacion").then(({ confirmacionesPublicacionWeb }) => registrarAuditLog({...}).then(() => confirmar(intento_id, true), () => confirmar(intento_id, false))).catch(() => {})`.
    - Campos del asiento según D4; whitelist explícita `{ intento_id, faltantes, timestamp }` construida campo por campo (nunca spread del payload).
    - Import **dinámico** del coordinador (`import()` dentro del handler, como libro IVA; C6 resuelta): `audit-log.listener.e5.test.ts`, `.e11.test.ts`, `.test.ts`, `.e6.test.ts` y `libro-iva-confirmacion.test.ts` cargan el listener con un mapa de dependencias que lanza ante una dependencia inesperada; un import estático los rompería. Esos arneses **no** se modifican.
    - Asiento (C8 resuelta): `registro_id = payload.producto_web_id`, `tabla_afectada = "contenidos_producto_web"`, `valor_nuevo = { intento_id, faltantes, timestamp }`.
  - `publicacion-web-auditoria.ts` — `import "server-only"`; molde de `libro-iva-auditoria.ts`:
    - `export async function auditarRechazoPublicacionWeb(datos: Pick<PublicacionWebRechazadaPayload, "actor_id" | "producto_web_id" | "faltantes">): Promise<void>`.
    - `intento_id = randomUUID()`; `espera = confirmacionesPublicacionWeb.esperar(intento_id)` **antes** de emitir; `Promise.race([listenersRegistrados.then(() => true, () => false), espera.resultado.then(() => false)])`; si no inicializó, si `domainEventBus.emit(...)` devuelve `false` (sin listener) o si `await espera.resultado` es `false` → `ServiceError("AUDITORIA_NO_DISPONIBLE", "No se pudo registrar el intento. Intentá nuevamente más tarde.")`; `finally { espera.cancelar() }`.
    - Si confirma, resuelve sin valor; el servicio (T03) lanza el 422. Sin polling, sin retries, sin acceso a `AuditLog`.
    - Log de diagnóstico sin datos del payload salvo `producto_web_id` (sin descripción, sin URLs).
- **Tests obligatorios** (`audit-log.listener.e16.test.ts`, arnés de `libro-iva-confirmacion.test.ts` / `cargarAislado`):
  - Cargar el listener dos veces y re-importarlo → `listenerCount("ecommerce:publicacion_web_rechazada") === 1`.
  - Confirma `true` **solo después** de que resuelve `registrarAuditLog` (pendiente mientras no resuelve).
  - `registrarAuditLog` rechaza → confirma `false`; sin unhandled rejection; sin datos del error en consola.
  - Whitelist: un payload con campos extra (`descripcion`, `url`, `fotos`) persiste exactamente `{ intento_id, faltantes, timestamp }`; `usuario_id`, `accion`, `tabla_afectada`, `registro_id`, `ip`, `valor_anterior = null` correctos.
  - Dos emisiones con `intento_id` distintos y mismo contenido → dos llamadas a `registrarAuditLog`.
  - Regresión: `audit-log.listener.e5.test.ts`, `.e11.test.ts`, `.test.ts` y `libro-iva-confirmacion.test.ts` siguen verdes.
- **Definition of Done:** handler idempotente en registro, cargando el coordinador solo por `import()` dinámico; asiento con `registro_id = producto_web_id`, `tabla_afectada = "contenidos_producto_web"` y `valor_nuevo` exactamente `{ intento_id, faltantes, timestamp }`; confirmación post-persistencia; productor que nunca devuelve éxito sin confirmación; arneses previos intactos sin editarlos; `package.json` sin cambios.
- **CA que cubre:** E16-4; matriz: un asiento por cada 422 incluso repetido, fallo del listener, timeout, sin listener.
- **Qué NO incluye:** integración con `cambiarVisibilidadWeb` (T03), mapeo HTTP (T04).

---

### T03 — Servicio: lock compartido, validación false→true, rechazo auditado y listado

- **Objetivo:** aplicar E16-1/E16-2/E16-4 en `cambiarVisibilidadWeb`, serializado con la baja de fotos, y exponer `publicable`/`faltantes` en el listado admin.
- **Dependencia previa:** T01, T02.
- **Archivos autorizados:**
  - `src/lib/services/ecommerce/contenido-web-lock.ts` (nuevo; destino del helper extraído)
  - `src/lib/services/ecommerce/foto-web.service.ts` (solo reemplazar el helper privado por el import; sin cambios de comportamiento)
  - `src/lib/services/ecommerce/visibilidad-web.service.ts`
  - `src/lib/services/ecommerce/hu-e16.integration.test.ts` (nuevo)
- **Archivos prohibidos:** `catalogo-web.service.ts` (incluido `whereContenidoPublicado`, C4), `comprabilidad.ts`, `contenido-web.service.ts` (no se migra su lock: D13 / DT-1), `respuesta-catalogo.ts`, rutas, componentes, `prisma/**`, `audit-log.listener.ts`, `package.json`.
- **Cambios previstos:**
  - `contenido-web-lock.ts` — `import "server-only"`; `export async function bloquearContenidoActivo(tx: Prisma.TransactionClient, productoWebId: string): Promise<void>` con el SQL **movido** desde `foto-web.service.ts:61-66` (mismo `SELECT id FROM contenidos_producto_web WHERE id = … AND is_active = true AND deleted_at IS NULL FOR UPDATE`) y el mismo `ServiceError("PRODUCTO_WEB_NO_ENCONTRADO", …)`.
  - `foto-web.service.ts` — borra el helper local e importa el compartido. Las 3 llamadas (`subirFotoProducto`, `marcarFotoPrincipal`, `darDeBajaFoto`) quedan iguales.
  - `visibilidad-web.service.ts`, `cambiarVisibilidadWeb`:
    1. En la tx: `await bloquearContenidoActivo(tx, productoWebId)` (reemplaza el 404 por `findFirst`); leer `producto_maestro_id`, `visibilidad_web`, `descripcion` y `_count` de fotos activas (`is_active: true, deleted_at: null`).
    2. Si `visibilidad_web === nuevo` → no-op E5 (`null`), **sin** validar publicabilidad (D5).
    3. Si `nuevo === true`: `evaluarPublicabilidad(...)`; si `!publicable` → retornar `{ rechazo: faltantes }` **sin UPDATE y sin throw**.
    4. Si no: el `updateMany` condicional actual se conserva tal cual (defensa adicional).
    5. Fuera de la tx, ante rechazo: `await auditarRechazoPublicacionWeb({ actor_id, producto_web_id, faltantes })` (lanza 503 si no confirma); si confirma → `throw new ServiceError("CONTENIDO_NO_PUBLICABLE", "El contenido no se puede mostrar en la tienda: falta …", { faltantes })`.
    6. Caminos de cambio admitido y ocultar: idénticos a E5 (evento `visibilidad_web_cambiada` post-commit con `emitirPostCommitSeguroE5`, aviso a carritos solo al ocultar).
    - Actualizar el JSDoc (`@throws` 422/503) y la cabecera del archivo (HU-E16, spec §6.2).
  - `listarContenidoWebAdmin`: sumar `descripcion: true` al `select` (solo para calcular; **no** se agrega `descripcion` al DTO, ya la provee `obtenerDetalleContenidosAdmin`); `ContenidoWebAdminFila` gana `publicable: boolean` y `faltantes: FaltantePublicacion[]` calculados con `evaluarPublicabilidad({ descripcion, fotos_activas: _count.fotos })`. El `where` no cambia (no filtra por publicabilidad).
- **Tests obligatorios** (`hu-e16.integration.test.ts`, base real descartable, molde de `hu-e5.integration.test.ts`: `skip` sin `HU_E16_INTEGRATION_DATABASE_URL`, assert de nombre de base `/test/i`, fixtures propios con `crearArticulo` de `hu-e1.test-fixtures.ts` + ajustes de descripción/fotos; nunca se borra nada; listener de auditoría real registrado con `iniciarAuditLogListener`):
  1. **Faltantes individuales y combinados:** oculto sin foto → 422 `['foto']`; sin descripción (forzada por Prisma a `""` y a `"   "`) → `['descripcion']`; ambos → `['descripcion','foto']`. Se verifica `err.code`, `err.details`.
  2. **Mutación nula:** tras cada rechazo, `visibilidad_web === false`, `updated_at` idéntico al previo, sin evento `ecommerce:visibilidad_web_cambiada` (espía en el bus), sin `carrito_articulo_no_disponible`.
  3. **Un asiento por cada 422, incluso repetido:** tres rechazos del mismo contenido → tres asientos `ecommerce:publicacion_web_rechazada` con `intento_id` distintos, `registro_id = producto_web_id`, `valor_nuevo` exactamente `{ intento_id, faltantes, timestamp }` (sin `descripcion`/`url`); `verificarCadenaIntegridad()` OK.
  4. **Fallo del listener → 503 sin cambio:** handler de prueba que confirma `false` (o `registrarAuditLog` forzado a fallar) → `AUDITORIA_NO_DISPONIBLE`, visibilidad intacta, sin asiento.
  5. **Timeout → 503 sin cambio:** `confirmacionesPublicacionWeb.plazoMs` bajado (p. ej. 200 ms) y listener que no confirma → `AUDITORIA_NO_DISPONIBLE`, `cantidadPendiente === 0` al final, visibilidad intacta. Restaurar listeners y plazo en `t.after`.
  6. **Sin listener → 503:** quitar temporalmente los handlers del evento → `emit` sin oyentes → 503 inmediato.
  7. **Carrera con baja de foto:** contenido oculto con una sola foto; abrir una tx manual que toma `bloquearContenidoActivo`, da de baja la foto y retiene el lock hasta una señal; lanzar `cambiarVisibilidadWeb(true)` en paralelo; liberar → debe responder 422 `['foto']` (esperó al lock y revalidó). Variante inversa: `cambiarVisibilidadWeb(true)` gana el lock → visible; la baja posterior deja visible sin foto (caso 8). Nunca queda `visibilidad_web = true` derivado de una lectura vieja de fotos.
  8. **Visible que pierde la última foto (E16-3):** visible y publicable → `darDeBajaFoto` de la última → `visibilidad_web` sigue `true`; el catálogo público (`listarCatalogo`/`obtenerDetalleProductoWeb`) lo excluye (regresión HU-E11); `listarContenidoWebAdmin` lo incluye con `publicable: false, faltantes: ['foto']`; ocultarlo funciona (200, contrato E5); volver a mostrarlo → 422.
  9. **Contrato E5 intacto:** ocultar publicable y no publicable → 200 + evento; no-op `true → true` en contenido no publicable → 200 sin UPDATE, sin evento y **sin** asiento de rechazo; no-op `false → false` igual; mostrar publicable → 200 + evento; contenido dado de baja → 404 en ambos sentidos.
  10. **Listado:** completo → `publicable: true, faltantes: []`; ningún registro desaparece por no ser publicable.
  - Regresión obligatoria: `npm run test:integration:e5`, `test:integration:e11`, `test:integration:e1` (las fixtures de E1 ya nacen con foto y descripción).
- **Definition of Done:** `contenido-web-lock.ts` es la única copia del SQL para fotos y visibilidad, y lo importan **solo** `foto-web.service.ts` y `visibilidad-web.service.ts`; `contenido-web.service.ts` queda sin cambios (DT-1); la regla usa `trim()` vía `evaluarPublicabilidad` y el filtro público de E11 no se toca; el rechazo nunca hace UPDATE; 422 solo con asiento confirmado; los tests de timeout bajan `plazoMs` en el singleton y lo restauran; suites E5/E11/E1 verdes.
- **CA que cubre:** E16-1, E16-2 (servicio y listado), E16-3, E16-4; toda la matriz del párrafo "Concurrencia".
- **Qué NO incluye:** mapeo HTTP, UI, seed.

> **⛔ STOP obligatorio después de T03:** revisar servicio + auditoría (lock, ausencia de UPDATE en rechazos, confirmación, 503) antes de exponer el contrato HTTP.

---

### T04 — Contrato HTTP 422/503 con `details`

- **Objetivo:** que `PATCH /api/ecommerce/catalogo/[producto_web_id]/visibilidad` entregue `422 CONTENIDO_NO_PUBLICABLE` con `error.details.faltantes` y `503 AUDITORIA_NO_DISPONIBLE`, sin afectar otras rutas del catálogo.
- **Dependencia previa:** T03 aprobado.
- **Archivos autorizados:**
  - `src/lib/services/ecommerce/respuesta-catalogo.ts`
  - `src/app/api/ecommerce/catalogo/[producto_web_id]/visibilidad/route.ts` (solo el comentario de respuestas; la lógica no cambia)
  - `src/lib/services/ecommerce/hu-e16.http.integration.test.ts` (nuevo)
- **Archivos prohibidos:** `package.json`, servicios, otras rutas de `catalogo/**`, `service-error.ts`, componentes, `prisma/**`.
- **Cambios previstos:**
  - `STATUS_POR_CODIGO`: `CONTENIDO_NO_PUBLICABLE: 422`, `AUDITORIA_NO_DISPONIBLE: 503`, con comentario HU-E16.
  - `respuestaErrorCatalogo`: incluir `details: err.details` en `error` **solo** si `err.code === "CONTENIDO_NO_PUBLICABLE"` y `details` está definido; el resto de los códigos sigue devolviendo exactamente `{ code, message }`.
  - Comentario de la ruta: sumar `422 CONTENIDO_NO_PUBLICABLE · 503 AUDITORIA_NO_DISPONIBLE`.
- **Tests obligatorios** (`hu-e16.http.integration.test.ts`, molde de `hu-e5.http.integration.test.ts`, `skip` sin URL de base de test):
  - 422 con body `{ data: null, error: { code: "CONTENIDO_NO_PUBLICABLE", message, details: { faltantes } } }` para `['foto']`, `['descripcion']`, `['descripcion','foto']`; visibilidad intacta; un asiento por request, también en requests repetidos.
  - 503 `AUDITORIA_NO_DISPONIBLE` sin `details` con listener fallando/sin confirmar; visibilidad intacta.
  - Ocultar / no-op / mostrar publicable → 200 con el body E5; 400/401/403/404 sin cambios.
  - Otro código del catálogo con `details` hipotético (p. ej. `FOTO_WEB_NO_ENCONTRADA`) no expone `details`.
- **Definition of Done:** contrato HTTP de §6.2 verificado de punta a punta; ninguna otra ruta cambia su envelope.
- **CA que cubre:** E16-1 (422 + `details.faltantes`), E16-2 (obligatorio aunque se omita la UI), E16-4 (503); matriz: faltantes, mutación nula, asiento por 422, fallo/timeout → 503.
- **Qué NO incluye:** UI.

---

### T05 — UI de backoffice: publicable / no publicable

- **Objetivo:** reflejar en `/ecommerce/catalogo` lo que el servidor calcula, sin reimplementar la regla en el cliente.
- **Dependencia previa:** T04.
- **Archivos autorizados:**
  - `src/components/ecommerce/CatalogoWebAdmin.tsx`
  - `src/components/ecommerce/catalogo-web-admin.e16.test.ts` (nuevo; asserts sobre la fuente, molde de `checkout-e15.test.tsx` / `cancelar-pedido-web.test.ts`; ya registrado en `package.json` por T01)
  - `src/app/(dashboard)/ecommerce/catalogo/page.tsx` — **solo si** hiciera falta; hoy el `...fila` ya propaga `publicable` y `faltantes` sin cambios.
- **Archivos prohibidos:** `package.json`, `ContenidoWebFormularios.tsx`, servicios, rutas, `prisma/**`.
- **Cambios previstos:**
  - `interface Fila`: `publicable: boolean; faltantes: FaltantePublicacion[]` (tipo importado de `publicabilidad-web.reglas.ts`, módulo puro).
  - Botón de visibilidad: si `!fila.visibilidad_web && !fila.publicable` → "Mostrar en tienda" `disabled` y texto visible bajo el botón con los faltantes (`ETIQUETA_FALTANTE`), asociado con `aria-describedby`.
  - Si `fila.visibilidad_web && !fila.publicable` → `Badge` "No publicable" + faltantes; texto aclaratorio de que la tienda no lo muestra hasta completar el contenido; "Ocultar en tienda" sigue habilitado.
  - `FormularioVisibilidad`: ante 422 `CONTENIDO_NO_PUBLICABLE` (carrera) mostrar los faltantes de `error.details.faltantes` y llamar `router.refresh()` vía un callback para actualizar la fila; ante 503 mostrar el mensaje del servidor ("intentá nuevamente") sin refrescar como éxito. `RespuestaApi.error` gana `details?: { faltantes?: string[] }`.
  - Ningún cálculo de publicabilidad en el cliente: solo se leen `publicable`/`faltantes`.
- **Tests obligatorios:**
  - `catalogo-web-admin.e16.test.ts`: el botón "Mostrar en tienda" se deshabilita por `!fila.publicable`; existe el badge "No publicable"; "Ocultar en tienda" no depende de `publicable`; manejo de `CONTENIDO_NO_PUBLICABLE` y de 503; no hay `trim()`/conteo de fotos para decidir publicabilidad en el componente.
  - Verificación manual en `npm run dev` con el seed de T06 (o fixture equivalente): contenido sin foto oculto (botón deshabilitado + motivo), visible que perdió su última foto (badge + ocultar habilitado), contenido completo (sin cambios E5). Registrar capturas/evidencia en T07.
  - `npx tsc --noEmit`, `npm run lint`.
- **Definition of Done:** la UI no permite pedir la publicación de un contenido incompleto y explica el motivo; la carrera se maneja sin mensajes de éxito falsos; `npm test` completo verde (primer punto en que existen todos los unitarios registrados por T01).
- **CA que cubre:** E16-2 (UI), E16-3 ("No publicable" en admin), E16-4 (503 en UI); matriz: visible que pierde la última foto.
- **Qué NO incluye:** cambios en formularios de contenido/fotos.

> **⛔ STOP obligatorio después de T05:** revisar la UI (estados deshabilitado / No publicable / manejo de 422-503) antes de la verificación integral.

---

### T06 — Seed de demostración E16-5

- **Objetivo:** dejar en el seed un contenido con descripción y sin foto activa, oculto, para demostrar el bloqueo.
- **Dependencia previa:** T03 aprobado (la redacción puede hacerse en paralelo; no depende de código nuevo).
- **Archivos autorizados:** `prisma/seed.ts`.
- **Archivos prohibidos:** `prisma/schema.prisma`, `prisma/migrations/**`, cualquier otro archivo.
- **Cambios previstos:**
  - Constantes con UUID fijos nuevos junto a las de HU-E5/HU-E11 (`seed.ts:539-558`): `PRODUCTO_E16_ID`, `VARIANTE_E16_ID`, `CONTENIDO_WEB_E16_ID`, `STOCK_E16_SHOWROOM_ID` (UUID v4 únicos, verificados contra el archivo).
  - Bloque "HU-E16 — Contenido sin foto (E16-5)" después del bloque "HU-E1/HU-E11 — Contenido web del catálogo" (`seed.ts:3952`), con el molde de la Gorra Táctica:
    - `productoMaestro.upsert` (código propio, p. ej. `CINTAC`, `update: {}`), `varianteSKU.upsert` con `generarSku` y `ean_qr` único, `listaPrecioVentaItem.upsert` en `listaPrecioVentaVersion1`, `stockDeposito.upsert` en `depositoShowroom` (cantidad > 0).
    - `productoWebContenido.upsert` por `producto_maestro_id` con `titulo_comercial`, `descripcion` no vacía ("Datos de prueba — sin foto, no publicable (HU-E16)"), `visibilidad_web: false`, `update: {}`. **Sin** `productoWebFoto`.
  - No se modifica ningún bloque existente. No se vuelve visible.
- **Tests obligatorios:**
  - Correr el seed dos veces sobre una base de test: segunda corrida sin errores ni duplicados.
  - Asserts en `hu-e16.integration.test.ts` (sección "seed", opcional si el contenido existe): `visibilidad_web === false`, 0 fotos activas, `listarContenidoWebAdmin` → `publicable: false, faltantes: ['foto']`; `cambiarVisibilidadWeb(true)` → 422 `['foto']` (y el test lo deja oculto).
  - Regresión: suites E5 y E11 (la Gorra y los demás contenidos del seed no cambian).
- **Definition of Done:** el seed es idempotente, el contenido nuevo existe oculto y sin foto, y ningún fixture previo cambia.
- **CA que cubre:** E16-5.
- **Qué NO incluye:** fotos para el contenido nuevo; cambios en fixtures previos.

---

### T07 — Verificación integral y evidencia

- **Objetivo:** demostrar §6.2 completo con la suite y dejar la evidencia de cierre.
- **Dependencia previa:** T01–T06.
- **Archivos autorizados:**
  - `docs/modulos/modulo E/HU16_MODULO_E.md` (nuevo; evidencia de cierre)
  - `docs/specs/spec_modulo_E.md` — **aprobado (D15)**: solo notas aditivas de Rev.10, sin reescribir ni renumerar contenido existente (§6.2 incluido).
- **Archivos prohibidos:** código fuente, `package.json` (ya editado en T01), `prisma/**`.
- **Cambios previstos / verificación:**
  - Nota aditiva Rev.10 en §4: subsección "Extensión de eventos — Revisión 10 (HU-E16)" con `ecommerce:publicacion_web_rechazada`, payload `{ intento_id, actor_id, producto_web_id, faltantes, timestamp }` (sin descripción ni URLs), emisión con espera de confirmación de D.3 (no fire-and-forget) y asiento `contenidos_producto_web` / `registro_id = producto_web_id`; `null` → `{ intento_id, faltantes, timestamp }`.
  - Nota aditiva Rev.10 junto a la tabla de errores §2.11.g (filas nuevas debajo de la existente, sin editar las anteriores): `422 CONTENIDO_NO_PUBLICABLE` (con `error.details.faltantes`) y `503 AUDITORIA_NO_DISPONIBLE`, ambos en `PATCH …/visibilidad`.
  - `npm test` (incluye los unit tests nuevos de T01, T02, T05).
  - `npm run test:integration:e16`, `test:integration:e16-http`, `e5`, `e5-http`, `e11`, `e11-http`, `e1`.
  - `npx tsc --noEmit`, `npm run lint`, `npm run build`.
  - `HU16_MODULO_E.md`: tabla CA → test que lo prueba, matriz "Concurrencia" → caso, decisiones D1–D15, conflictos resueltos, deuda técnica DT-1, capturas de UI.
- **Tests obligatorios:** los listados arriba, todos verdes.
- **Definition of Done:** todo verde; evidencia escrita; notas aditivas Rev.10 agregadas en §4 y en la tabla de errores sin alterar texto previo (verificable con un diff que solo agrega líneas en `spec_modulo_E.md`).
- **CA que cubre:** verificación de E16-1…E16-5 y de toda la matriz de concurrencia.

---

## 4. Dependencias entre tasks

```
T01 (regla + evento + coordinador)
  ↓
T02 (listener D.3 + productor)
  ↓
T03 (servicio + lock + listado)  ── ⛔ STOP
  ↓                    ↘
T04 (HTTP 422/503)      T06 (seed E16-5, paralelizable)
  ↓
T05 (UI)  ── ⛔ STOP
  ↓
T07 (verificación integral + evidencia)  ← requiere T06
```

- T06 no depende de código nuevo: puede redactarse en paralelo y fusionarse después del STOP de T03.
- T01 y T02 podrían unificarse en un solo PR si el revisor lo prefiere; se separan para aislar el riesgo de merge de `audit-log.listener.ts`.

---

## 5. Archivos permitidos por tarea

| Tarea | Archivos permitidos |
|---|---|
| T01 | `src/lib/services/ecommerce/publicabilidad-web.reglas.ts` (+ test), `src/lib/events/event-types.ts`, `src/lib/events/event-types.test.ts`, `src/lib/events/publicacion-web-confirmacion.ts` (+ test), `package.json` (**única edición**: 4 unitarios en `test` + `test:integration:e16` y `test:integration:e16-http`) |
| T02 | `src/lib/events/listeners/audit-log.listener.ts`, `src/lib/events/publicacion-web-auditoria.ts`, `src/lib/events/listeners/audit-log.listener.e16.test.ts` |
| T03 | `src/lib/services/ecommerce/contenido-web-lock.ts`, `foto-web.service.ts` (solo import del helper), `visibilidad-web.service.ts`, `hu-e16.integration.test.ts` |
| T04 | `src/lib/services/ecommerce/respuesta-catalogo.ts`, `src/app/api/ecommerce/catalogo/[producto_web_id]/visibilidad/route.ts` (comentario), `hu-e16.http.integration.test.ts` |
| T05 | `src/components/ecommerce/CatalogoWebAdmin.tsx`, `src/components/ecommerce/catalogo-web-admin.e16.test.ts`, `src/app/(dashboard)/ecommerce/catalogo/page.tsx` (solo si hiciera falta) |
| T06 | `prisma/seed.ts` |
| T07 | `docs/modulos/modulo E/HU16_MODULO_E.md`, `docs/specs/spec_modulo_E.md` (solo notas aditivas Rev.10, D15) |

`package.json` solo figura en T01 (D14).

---

## 6. Tests obligatorios por tarea

| Tarea | Tests |
|---|---|
| T01 | `publicabilidad-web.reglas.test.ts`, `publicacion-web-confirmacion.test.ts`, `event-types.test.ts`, `tsc --noEmit`. |
| T02 | `audit-log.listener.e16.test.ts` + regresión `audit-log.listener.test.ts`, `.e5`, `.e6`, `.e11`, `libro-iva-confirmacion.test.ts`. |
| T03 | `hu-e16.integration.test.ts` (casos 1–10) + regresión `test:integration:e5`, `e11`, `e1`. |
| T04 | `hu-e16.http.integration.test.ts` + regresión `test:integration:e5-http`, `e11-http`. |
| T05 | `catalogo-web-admin.e16.test.ts`, verificación manual en dev, `tsc`, `lint`. |
| T06 | Seed ×2 en base de test, asserts de seed en `hu-e16.integration.test.ts`, regresión E5/E11. |
| T07 | `npm test`, todas las suites de integración E16/E5/E11/E1, `tsc --noEmit`, `lint`, `build`. |

---

## 7. Definition of Done por tarea

Cada task se considera Done cuando:

1. Todos los cambios previstos están implementados en los archivos autorizados.
2. Los tests obligatorios pasan (con salida registrada si alguno se omite por falta de base de test).
3. No se modificaron archivos prohibidos ni `prisma/schema.prisma` / migraciones.
4. No se amplió el alcance de §6.2.
5. Se completó el STOP obligatorio si corresponde.
6. Se documentaron riesgos o dependencias pendientes.

---

## 8. Puntos de parada obligatorios

- **STOP después de T03:** revisar servicio + auditoría: lock compartido, validación solo `false → true`, ausencia de UPDATE en rechazos, 422 solo con asiento confirmado, 503 ante fallo/timeout/sin listener, contrato E5 intacto.
- **STOP después de T05:** revisar la UI: botón deshabilitado con motivo, badge "No publicable", "Ocultar" habilitado, manejo de 422/503 por carrera.
- **STOP implícito ante schema:** si cualquier task detecta que necesita tocar `schema.prisma` o una migración, se frena y se reporta (D11).

---

## 9. Conflictos detectados entre spec y código

Todas las dudas de la primera versión quedan **RESUELTAS** (decisión del equipo, 20/10/2026).

1. **C1 — Spec sin registrar el evento ni los códigos nuevos fuera de §6.2. — RESUELTA.** §4 no listaba `ecommerce:publicacion_web_rechazada` y la tabla de errores §2.11.g no incluía `422 CONTENIDO_NO_PUBLICABLE` ni `503 AUDITORIA_NO_DISPONIBLE`. **Resolución:** T07 los agrega a `spec_modulo_E.md` como nota aditiva de Rev.10, sin reescribir contenido existente (D15).
2. **C2 — "Publicado" vs `visibilidad_web = true` en la carrera. — RESUELTA.** El párrafo "Concurrencia" dice que "no debe quedar publicado un contenido sin foto por una carrera", pero E16-3 admite explícitamente `visibilidad_web = true` sin fotos tras una baja posterior. **Interpretación aprobada:** lo que se impide es que el `false → true` se decida con una lectura vieja de las fotos (garantizado por el lock compartido y la revalidación dentro de la misma transacción). Un estado `visible + sin foto` es legítimo solo si la baja de la última foto se serializó **después** del cambio de visibilidad; en ese caso la tienda no lo muestra (regla HU-E11) y el admin lo marca "No publicable". El test de carrera (T03 caso 7) verifica ambos órdenes.
3. **C3 — SQL del lock duplicado en `contenido-web.service.ts:149-153`. — RESUELTA.** **Resolución:** no se migra. El helper compartido `contenido-web-lock.ts` lo usan solo `visibilidad-web.service.ts` y `foto-web.service.ts` (D13). Queda registrado como deuda técnica **DT-1** (§10).
4. **C4 — Descripción de solo espacios: filtro público vs regla E16. — RESUELTA.** **Resolución:** la regla E16 usa `trim()` (`evaluarPublicabilidad`). El filtro público de E11 (`whereContenidoPublicado`, `descripcion: { not: "" }`) **no se toca**. Queda registrado: no es explotable por la API (alta y edición validan `trim().min(1)`) y `evaluarComprabilidad` recorta, así que el artículo nunca es comprable; una descripción `"   "` escrita por SQL directo podría aparecer listada en la tienda.
5. **C5 — Plazo de confirmación. — RESUELTA.** **Resolución:** constante `PLAZO_CONFIRMACION_RECHAZO_MS = 10_000`, sobrescribible solo en el singleton para tests. Sin clave de Configuración D.4 (D12).
6. **C6 — Arneses aislados del listener. — RESUELTA.** **Resolución:** el handler E16 carga el coordinador con `import()` dinámico, como libro IVA. Los arneses existentes (`audit-log.listener.test.ts`, `.e5`, `.e6`, `.e11`, `libro-iva-confirmacion.test.ts`) no se modifican.
7. **C7 — `package.json` como punto de conflicto. — RESUELTA.** **Resolución:** todas las entradas nuevas (4 unitarios en `test` + `test:integration:e16` y `test:integration:e16-http`) se agregan en una única edición dentro de T01; ninguna otra task toca `package.json` (D14). **Consecuencia aceptada:** entre T01 y la fusión de T02/T05, `npm test` falla porque referencia `audit-log.listener.e16.test.ts` y `catalogo-web-admin.e16.test.ts` todavía inexistentes. En T01–T04 los unitarios se corren por ruta directa y `npm test` completo se exige verde desde T05.
8. **C8 — `registro_id` del asiento de rechazo. — RESUELTA.** **Resolución:** `registro_id = producto_web_id`, `tabla_afectada = "contenidos_producto_web"`; `intento_id` viaja dentro de `valor_nuevo` junto con `faltantes` y `timestamp` (D4, T02).

**Pendiente no bloqueante:** validación de redacción de las etiquetas de faltantes de la UI ("Falta la descripción" / "Falta al menos una foto activa"); se ajustan en T05 si el PO pide cambios.

---

## 10. Deuda técnica registrada

| ID | Descripción | Origen | Acción sugerida |
|---|---|---|---|
| DT-1 | `editarContenidoWeb` (`src/lib/services/ecommerce/contenido-web.service.ts:149-153`) repite en línea el mismo `SELECT … FOR UPDATE` sobre `contenidos_producto_web` que `contenido-web-lock.ts`. | C3 / D13 | Migrarlo al helper compartido en una HU o tarea técnica posterior, con regresión de `test:integration:e11` y `e11-http`. Fuera del alcance de HU-E16. |

---

## 11. Decisiones menores tomadas durante la implementación

Ninguna contradice §6.2 ni las decisiones D1–D15; se registran para la revisión.

| # | Decisión | Dónde |
|---|---|---|
| DM-1 | `cambiarVisibilidadWeb` toma el lock compartido al inicio de **toda** transacción (también al ocultar y en el no-op), reemplazando el `findFirst` de existencia: el 404 lo da el helper con el mismo código y mensaje. La validación sigue siendo solo para `false → true`. Serializar también ocultar es inocuo y simplifica. | `visibilidad-web.service.ts` |
| DM-2 | Mensaje del 422: `No se puede mostrar en la tienda: falta la descripción y falta al menos una foto activa.` (armado con `ETIQUETA_FALTANTE`). | `visibilidad-web.service.ts` |
| DM-3 | `PublicacionWebRechazadaPayload.faltantes` se tipa con el literal `("descripcion" \| "foto")[]` en `event-types.ts`, sin importar desde `services/` (evita una dependencia invertida); es estructuralmente igual a `FaltantePublicacion`. | `event-types.ts` |
| DM-4 | El productor vive en `src/lib/events/publicacion-web-auditoria.ts` (gemelo de `libro-iva-auditoria.ts`). Su log de diagnóstico solo incluye `producto_web_id`. El coordinador lanza `INTENTO_DUPLICADO` si se repite un id (equivalente a `EXPORTACION_DUPLICADA`). | `publicacion-web-auditoria.ts`, `publicacion-web-confirmacion.ts` |
| DM-5 | `listarContenidoWebAdmin` lee `descripcion` solo para calcular `publicable`/`faltantes`; la fila no la expone (ya la entrega `obtenerDetalleContenidosAdmin`). | `visibilidad-web.service.ts` |
| DM-6 | El fallo y el timeout de D.3 no se pueden provocar dentro de un servidor aparte. El 503 HTTP se prueba en proceso: Route Handler real + `respuesta-catalogo.ts` real, con el servicio simulado. El camino real de servicio (falla, timeout, sin listener) está en `hu-e16.integration.test.ts`, y el servidor real cubre el 422 de punta a punta. | `hu-e16.http.integration.test.ts` |
| DM-7 | `audit-log.listener.e16.test.ts` cubre también al productor (ambos cargados aislados con `cargarAislado`), sin un archivo de test adicional. | `audit-log.listener.e16.test.ts` |
| DM-8 | UI: tras un 422 dentro del diálogo, el botón de envío queda deshabilitado (la fila del diálogo quedó vieja) y se hace `router.refresh()`. El 503 muestra el mensaje del servidor y permite reintentar. El motivo bajo el botón deshabilitado se asocia con `aria-describedby`. | `CatalogoWebAdmin.tsx` |
| DM-9 | Seed E16-5: "Cinturón Táctico" (`CINTAC`, EAN `7791234500160`, precio $8.500 en la versión 1, 4 u. en Showroom), contenido `4f151400-53c6-4e19-9f0c-53bf8a2c6438` con descripción, sin fotos y oculto; todos los `upsert` con `update: {}`. | `prisma/seed.ts` |
| DM-10 | Base de test local `swat_erp_test_e16` (mismo criterio que `swat_erp_test_e15`), con migraciones aplicadas y seed. | entorno local |
| DM-11 | Falla preexistente y ajena a E16: en `hu-e1.http.integration.test.ts:285`, `/tienda` hoy es una portada editorial (`src/app/(tienda)/tienda/page.tsx`) que responde 200, y el test espera la redirección 307 vieja. No se modifica desde HU-E16; se reporta a su owner. | — |
