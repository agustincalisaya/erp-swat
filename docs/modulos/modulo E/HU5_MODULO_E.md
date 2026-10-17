# HU-E5 — Visibilidad web independiente del inventario físico (Módulo E)

Contrato: `docs/specs/spec_modulo_E.md` §2.5 (Revisión 4, aditiva) y §2.1 (contrato compartido con HU-E1). Task SDD: `docs/tasks/task_relos.md` (local: `docs/tasks/.gitignore` ignora todo el directorio, así que el task **no se versiona**; las decisiones vinculantes se copian en §3 de este cierre).

**Módulo:** E — Canal de Venta Online · **Responsable:** Adriel · **Sprint:** Sprint 4.
**Estado al 04/10/2026:** implementada y verificada con evidencia de ejecución sobre una base aislada (`swat_erp_test_e5`). Commit, PR e integración pendientes de ejecución manual por Adriel.

## 1. Historia de usuario y qué hace

**Como** Administrador E-commerce, **necesito** decidir qué artículos se muestran en la tienda online sin tocar el inventario, **para** gestionar el catálogo web de forma independiente del estado físico de los SKU.

| Capacidad | Superficie | Resultado |
|---|---|---|
| Ocultar / mostrar en la tienda | `PATCH /api/ecommerce/catalogo/[producto_web_id]/visibilidad`, pantalla `/ecommerce/catalogo` | UPDATE reversible de `visibilidad_web`, motivo opcional; no toca Módulo A |
| Baja lógica del contenido web | `PATCH /api/ecommerce/catalogo/[producto_web_id]/baja`, misma pantalla | `is_active`, `deleted_at`, `deleted_by`, `deletion_reason` obligatorio, `visibilidad_web = false` |
| Aviso proactivo a carritos | Post-COMMIT, evento `ecommerce:carrito_articulo_no_disponible` (`origen: "VISIBILIDAD_WEB"`) | F3 notifica al Cliente Web; el checkout de E1 se bloquea identificando el ítem |
| Carritos abandonados | Tercera tarea de `mantenimiento-programado.ts` (cron + `npm run job:reservas`) | Baja lógica `ABANDONADO` tras `ECOMMERCE_CARRITO_ABANDONADO_DIAS` (7) sin actividad |
| Trazabilidad | `ecommerce:visibilidad_web_cambiada`, `ecommerce:contenido_web_baja` | Asientos en el ledger con el actor de la sesión; cadena SHA-256 íntegra |

## 2. Criterios de aceptación (5) — estado y evidencia

| CA | Criterio | Estado y evidencia |
|---|---|---|
| CA1 | Indicador web propio, independiente del `is_active` del SKU | Aprobado: `hu-e5.integration` compara `VarianteSKU`, `ProductoMaestro` y `StockDeposito` antes/después (idénticos) |
| CA2 | Activo en inventario y no visible, y viceversa | Aprobado: ocultar un SKU activo; mostrar con el SKU inactivo (la bandera cambia, el SKU sigue inactivo y el cliente lo ve no comprable, spec §2.5) |
| CA3 | Desactivación web como baja lógica con los cuatro campos | Aprobado: servicio y HTTP verifican los cuatro campos + `visibilidad_web = false`, conteo antes/después y segunda baja 404; Chrome escenario 3 |
| CA4 | Bloqueo del checkout con aviso por artículo y notificación interna (F3) | Aprobado: evento por ítem, notificación ADVERTENCIA al cliente (no al visitante), `422 ARTICULO_NO_DISPONIBLE` con el ítem; Chrome escenario 2 (la bandeja del Cliente Web no tiene UI, ver §11) |
| CA5 | Carritos abandonados por baja lógica tras plazo configurable | Aprobado: vía `ejecutarMantenimientoProgramado`, plazo leído de `ConfiguracionSistema`, registro e ítems intactos, la cuenta arma otro carrito; `npm run job:reservas` en el escenario 4 |

## 3. Decisiones (D1–D22)

D1–D10 se tomaron en la task antes de leer el código; D11–D22, tras la lectura del código real y las validaciones de Adriel. Pendientes de validar con el equipo/PO las marcadas.

| Decisión | Contrato vigente |
|---|---|
| D1 (validar PO) | Dos operaciones: ocultar/mostrar (spec §2.5, reversible, motivo opcional) y baja lógica (criterio 3 del backlog, motivo obligatorio, fuerza `visibilidad_web = false`, sin reactivación en E5) |
| D2 | Pedir el valor actual: 200 con el estado, sin UPDATE, sin evento, sin notificaciones. UPDATE condicional al valor anterior: dos pedidos concurrentes emiten un solo evento |
| D3 | Contenido dado de baja no es operable: ambas operaciones 404 `PRODUCTO_WEB_NO_ENCONTRADO` |
| D4 (validar PO) | `ECOMMERCE_CARRITO_ABANDONADO_DIAS`, default **7**, medido por `carritos_web.updated_at`; vive solo en `ConfiguracionSistema`. Abandonado = `updated_at` **estrictamente** anterior al corte |
| D5 | Baja del carrito: `is_active = false`, `deleted_at = ahora`, `deleted_by = null`, `deletion_reason = "ABANDONADO"` (`MOTIVO_CARRITO_ABANDONADO`). Ítems intactos. Cuenta y visitante. Sin evento ni auditoría (spec §2.1) |
| D6 | `CarritoArticuloNoDisponiblePayload.origen?: "CHECKOUT" \| "VISIBILIDAD_WEB"`, opcional y retrocompatible |
| D7 | Idempotencia F3 por `carrito_item_id`: una notificación por ítem, sea por checkout o por visibilidad |
| D8 | Carrito de visitante: se emite igual con `cliente_web_cuenta_id: null`; F3 lo descarta |
| D9 | Listado del backoffice leído desde el Server Component (`listarContenidoWebAdmin`), sin GET nuevo |
| D10 | Carritos abandonados como tercera tarea del coordinador de HU-E4; sin scripts npm nuevos |
| D11 | Campo de `TareasMantenimiento` obligatorio; `hu-e4.integration.test.ts` solo recibe el stub no-op en los dos objetos de CA07 |
| D12 | El handler de `carrito_articulo_no_disponible` pasa de `void` a `.catch(...)` con `codigoDiagnosticoAuditoria` para todos los orígenes; `valor_nuevo` de CHECKOUT sin cambios, VISIBILIDAD_WEB agrega `origen` |
| D13 | `accion`: `CHECKOUT_BLOQUEADO` (sin origen o CHECKOUT) / `ARTICULO_NO_DISPONIBLE_VISIBILIDAD_WEB` (VISIBILIDAD_WEB) |
| D14 | El coordinador importa `server-only`: su aislamiento se prueba en `hu-e5.integration`; `npm test` queda para funciones puras, schemas y el arnés del listener |
| D15 (validar equipo) | Sin Server Actions: el componente cliente llama a los Route Handlers, como cupones y cuentas web. Desvío respecto de la spec §2.5 |
| D16 | Seed: solo la clave y la línea de PENDIENTES; los comentarios desactualizados del bloque se reportan (§12) |
| D17 | La baja lógica queda en E5 por el criterio 3; la spec §2.5/§2.11 la ubica en HU-E11, que debe reutilizar `darDeBajaContenidoWeb` |
| D18 | Visitante con la cookie de un carrito abandonado: GET vacío y agregar crea un carrito nuevo (sin cambios en `carrito.service.ts`) |
| D19 | `AGENTS.md` ausente: se siguieron los docs de `node_modules/next/dist/docs/` |
| D20 | La baja avisa a los carritos **solo si el contenido estaba visible** (si ya estaba oculto, el aviso salió al ocultarlo) |
| D21 | Bodies estrictos (`.strict()`, como HU-E4): un campo extra (`actor_id`, `deleted_by`, …) es 400 "El cuerpo contiene campos no permitidos" |
| D22 | Agregados aprobados: `respuesta-catalogo.ts`, `audit-log.listener.e5.test.ts` y el campo `producto_activo` del listado, **solo informativo y de solo lectura** (no modifica ni condiciona la visibilidad) |

## 4. Modelo de datos, configuración y seed

Sin migración ni cambios en `schema.prisma`: `ProductoWebContenido` ya tenía `visibilidad_web` y los campos de baja lógica; `CarritoWeb` ya tenía los suyos y el índice único parcial `carritos_web_cuenta_activa_key` (E1) libera la cuenta cuando su carrito se da de baja.

| Cambio | Detalle |
|---|---|
| `ConfiguracionSistema` | `ECOMMERCE_CARRITO_ABANDONADO_DIAS = "7"`, módulo `E`, sembrada con `upsert` (`update: {}`) |
| `configuracion.service.ts` | `CLAVE_ECOMMERCE_CARRITO_ABANDONADO_DIAS` y `obtenerPlazoCarritoAbandonadoDias()` (entero positivo o `CONFIGURACION_INVALIDA`) |
| `prisma/seed.ts` | Solo la clave y quitar "plazo de carrito abandonado (HU-E1/E5)" de PENDIENTES. Re-ejecutado sobre la base de test: estado idéntico antes/después (18/46 cupones de baja, plazo 7, Gorra oculta) |

## 5. Contrato de endpoints y permiso

Sesión interna con `withPermission(PERMISO_GESTIONAR_CATALOGO)` (`"ecommerce:gestionar_catalogo"`, constante en `src/lib/auth/permisos-ecommerce.ts`), asignado solo al Administrador E-commerce. Actor siempre de la sesión. `params` se resuelve con `await` (Next 16).

| Método | Ruta | Body | Éxito |
|---|---|---|---|
| PATCH | `/api/ecommerce/catalogo/[producto_web_id]/visibilidad` | `{ visibilidad_web: boolean, motivo?: string (1–500, trim) }` | 200 `{ data: { producto_web_id, visibilidad_web }, error: null }` |
| PATCH | `/api/ecommerce/catalogo/[producto_web_id]/baja` | `{ deletion_reason: string (1–500, trim) }` | 200 `{ data: { producto_web_id, is_active: false, deleted_at }, error: null }` |

Errores `{ data: null, error: { code, message } }`: 400 `VALIDATION_ERROR` (id no UUID, body inválido, raíz `null`/array/no-JSON → "El cuerpo debe ser un objeto JSON", campo extra → "El cuerpo contiene campos no permitidos", motivo de baja vacío → "El motivo de baja es obligatorio") · 401 `UNAUTHORIZED` · 403 `FORBIDDEN` · 404 `PRODUCTO_WEB_NO_ENCONTRADO` · 500 `INTERNAL_ERROR`. `respuesta-catalogo.ts` concentra envelope, errores y lectura JSON.

## 6. Reglas de servicio

`src/lib/services/ecommerce/visibilidad-web.service.ts`:

- `cambiarVisibilidadWeb`: transacción con lectura del contenido activo y `updateMany` condicionado al valor anterior; post-COMMIT emite `ecommerce:visibilidad_web_cambiada` y, si el nuevo valor es `false`, avisa a los carritos.
- `darDeBajaContenidoWeb`: transacción con `updateMany` condicionado a activo (nunca DELETE); post-COMMIT emite `ecommerce:contenido_web_baja` y avisa a los carritos solo si estaba visible (D20).
- Aviso a carritos: ítems activos de carritos activos cuya variante es del Producto Maestro del contenido; un evento por ítem con `motivo: "NO_VISIBLE_WEB"` y `origen: "VISIBILIDAD_WEB"`. Una falla de la búsqueda se loguea sin PII y no revierte nada.
- Emisión post-COMMIT segura local (`emitirPostCommitSeguroE5`): un listener que lanza no convierte en error una operación confirmada; el log lleva evento, contenido y tipo de error, nunca el mensaje. No importa ni modifica el helper privado de E2.
- `listarContenidoWebAdmin`: contenidos activos, orden `titulo_comercial, id`, página de 20 (máx. 100), con nombre y estado del producto y fotos activas.

Ninguna operación lee ni escribe `VarianteSKU`, `ProductoMaestro` ni stock. `comprabilidad.ts`, `checkout.service.ts` y `carrito.service.ts` no se modificaron.

## 7. Mantenimiento (criterio 5)

`carrito-abandonado.reglas.ts` (pura): `calcularFechaCorteAbandono(ahora, plazoDias)` = `ahora − plazo × 24 h`; rechaza plazos no enteros positivos. `carrito-abandonado.service.ts`: lee el plazo, busca candidatos y repite la condición en el `updateMany` (un carrito tocado en el medio no se da de baja); devuelve `{ total_desactivados, carrito_ids }`.

`mantenimiento-programado.ts` corre reservas → cupones → **carritos**, cada una con `ejecutarAislada`. El cron agrega `mantenimiento_carritos: { ok, total_desactivados }` (o `{ ok: false, error }`) en ambas respuestas sin cambiar autenticación ni que el status lo decida la liberación de reservas. El script imprime `— carritos abandonados: N carrito(s) dado(s) de baja.` y marca `exitCode = 1` si la tarea falla.

## 8. Auditoría y eventos

| Evento | Payload | Asiento (`audit-log.listener.ts`) |
|---|---|---|
| `ecommerce:visibilidad_web_cambiada` | `producto_web_id, producto_maestro_id, visibilidad_anterior, visibilidad_nueva, motivo \| null, actor_id` | `usuario_id = actor`, `accion` = evento, `contenidos_producto_web`, antes `{ visibilidad_web }` / después `{ visibilidad_web, motivo, producto_maestro_id }` |
| `ecommerce:contenido_web_baja` | `producto_web_id, producto_maestro_id, deletion_reason, actor_id` | antes `{ is_active: true }` / después `{ is_active: false, deleted_by, deletion_reason, visibilidad_web: false, producto_maestro_id }` |
| `ecommerce:carrito_articulo_no_disponible` (E1, ampliado) | `+ origen?` | D12/D13 |

Los tres handlers usan `.catch` con `codigoDiagnosticoAuditoria` (solo `PXXXX` o `ERROR_ESCRITURA_AUDITORIA`). Ambos eventos nuevos están en `DomainEventMap` y en `TIPOS_EVENTO_DOMINIO`. Sin cambios al escritor, la cola ni el hash-chain.

## 9. Pantalla `/ecommerce/catalogo`

Server Component con el mismo gate que cupones (sin sesión → `/login`, sin permiso → `/no-autorizado`). `CatalogoWebAdmin.tsx`: tarjetas mobile-first (una columna; dos desde `md`), badges de visibilidad, fotos y "Producto inactivo en inventario" (informativo); acción Ocultar/Mostrar con motivo opcional; Dar de baja con motivo obligatorio **y** casilla de confirmación explícita (el botón queda deshabilitado si falta cualquiera de los dos); avisos de éxito y error en español; tras cada acción, `router.refresh()`. Paginación por `?page=`. Sidebar: "Catálogo web" debajo de "Cupones", gateado por `ecommerce:gestionar_catalogo`.

## 10. Cómo probar

Base aislada (nunca la de desarrollo; nunca `migrate reset`):

```bash
docker exec swat_erp_postgres psql -U erpswat -d postgres -c "CREATE DATABASE swat_erp_test_e5 TEMPLATE template0"
export TEST_DB="postgresql://erpswat:erpswat@localhost:5432/swat_erp_test_e5?schema=public"
# Misma ENCRYPTION_KEY_PROVEEDORES en el seed, los tests y el servidor; definida fuera del repo.
DATABASE_URL=$TEST_DB npx prisma migrate deploy && DATABASE_URL=$TEST_DB npx prisma db seed

npm test
HU_E5_INTEGRATION_DATABASE_URL=$TEST_DB npm run test:integration:e5
# Servidor aparte (next dev: el simulador de MP está prohibido en production):
DATABASE_URL=$TEST_DB MP_MODO=simulado APP_PUBLIC_URL=http://localhost:3105 CRON_SECRET=... npx next dev -p 3105
HU_E5_INTEGRATION_BASE_URL=http://localhost:3105 HU_E5_INTEGRATION_DATABASE_URL=$TEST_DB HU_E5_CRON_SECRET=... \
  npm run test:integration:e5-http
DATABASE_URL=$TEST_DB npm run job:reservas
```

El servidor también necesita `JWT_SECRET_CLIENTE_WEB` y `CARRITO_COOKIE_SECRET` (igual que E1). Los dos tests verifican `current_database()` y fallan si la base no es de test. Ambos escriben en la base indicada (no borran nada).

## 11. Prueba manual en Chrome (04/10/2026, base `swat_erp_test_e5`)

| # | Escenario | Resultado |
|---|---|---|
| 1 | Admin muestra la Gorra Táctica → aparece en `/tienda/catalogo` | Probado: aviso de éxito, badge "Visible", la tienda la lista a $ 9.500 |
| 2 | Carlos Ruiz la agrega; admin la oculta → aviso en el carrito, notificación, bloqueo de "Iniciar compra" | Probado en navegador: aviso por ítem y bloqueo identificando `GORTAC-OPERATIVA-U-NEGRO-U`. **Notificación: no verificable en navegador**, porque no existe bandeja del Cliente Web en la tienda (fuera de alcance de F3: `docs/modulos/modulo F/HU3_MODULO_F.md`, línea 229); verificada en la base: una notificación ADVERTENCIA para la cuenta y dos asientos (`…_VISIBILIDAD_WEB` y `CHECKOUT_BLOQUEADO`) |
| 3 | Dar de baja con motivo; sin motivo no envía | Probado: con motivo solo de espacios y la confirmación marcada el botón queda deshabilitado y el servidor no recibió ningún PATCH; con motivo, aviso de éxito, la tarjeta desaparece y la fila queda con los cuatro campos |
| 4 | Carrito envejecido + `npm run job:reservas` | Probado: línea `carritos abandonados: 1 carrito(s) dado(s) de baja.`, reservas y cupones reportan; conteos 93/100 iguales; el carrito de Carlos se ve vacío |
| 5 | Usuario sin permiso | Probado: `operador.pickpack.seed` → 307 a `/no-autorizado`; su Sidebar no muestra "Catálogo web" |

Antes del escenario 2 se quitaron desde la UI los dos ítems sembrados del carrito de Carlos (uno con SKU inactivo bloquearía el checkout por otro motivo). No se verificó la pantalla en un viewport de teléfono: el layout es mobile-first por construcción, pero no se capturó a ancho móvil.

## 12. Hallazgos reportados, sin corregir

1. **Handlers de cupón de HU-E4 sin `.catch`:** `cupon_creado`, `cupon_editado`, `cupon_baja` y `cupon_aplicado` usan `void registrarAuditLog(...)`; un rechazo produce `unhandledRejection`. Solo `cupon_consumido` y `cupon_aplicacion_liberada` tienen la captura.
2. **Comentarios desactualizados en el bloque de configuración de `seed.ts`:** dice "Solo las 4 claves" con 6 sembradas antes de E5 (7 con la de E5), y PENDIENTES todavía lista "intentos fallidos de login de Cliente Web (HU-E8)", ya sembrada como `ECOMMERCE_CUENTA_WEB_MAX_INTENTOS`.
3. **`AGENTS.md` ausente:** `CLAUDE.md` lo incluye con `@AGENTS.md`, pero solo existe `node_modules/next/AGENTS.md`.
4. **Desvío `actions.ts`:** la spec §2.5 nombra `cambiarVisibilidadWeb()` como Server Action; el repo (cupones, cuentas web) usa Route Handlers desde el cliente (D15).
5. **Ubicación de la baja lógica:** la spec §2.5 y §2.11 la ubican en HU-E11; E5 la implementó por el criterio 3 (D17). E11 debe reutilizar `darDeBajaContenidoWeb`.
6. **`docs/tasks/.gitignore` ignora el task** (`*`): las decisiones de `task_relos.md` no se versionan; este documento las replica.
7. **Texto de la plantilla F2/F3 de `carrito_articulo_no_disponible`:** dice que el artículo "bloqueó la confirmación de tu compra"; en el aviso proactivo (origen VISIBILIDAD_WEB) todavía no hubo intento de compra. Observado en la base durante el escenario 2.
8. **Hidratación en la tienda (HU-E1):** el overlay de Next marca un mismatch en el input de búsqueda de `/tienda/catalogo` por un atributo `data-has-listeners` que inyecta una extensión del navegador. No proviene del código de E5.
9. **Nombres spec vs. repo:** la spec usa convenciones de ruta que el repo implementó distinto (p. ej. `/pick-pack/` vs `/preparacion/`); para E5 se mantuvo la ruta de la spec §2.5.

## 13. Pendientes

- Validar con el equipo/PO: D1 (dos operaciones), D4 (7 días) y D15 (sin Server Actions).
- Agendado del cron en despliegue: mismo pendiente que reservas y cupones.
- Coordinar con el owner de Módulo D la incorporación de `ECOMMERCE_CARRITO_ABANDONADO_DIAS` a `spec_modulo_D.md` §6.2.
- Reactivación de un contenido dado de baja: fuera de alcance de E5.

## 14. Archivos

**Nuevos:** `src/app/api/ecommerce/catalogo/[producto_web_id]/visibilidad/route.ts`, `src/app/api/ecommerce/catalogo/[producto_web_id]/baja/route.ts`, `src/app/(dashboard)/ecommerce/catalogo/page.tsx`, `src/components/ecommerce/CatalogoWebAdmin.tsx`, `src/lib/services/ecommerce/visibilidad-web.service.ts`, `src/lib/services/ecommerce/carrito-abandonado.reglas.ts`, `src/lib/services/ecommerce/carrito-abandonado.service.ts`, `src/lib/services/ecommerce/respuesta-catalogo.ts`, tests `carrito-abandonado.reglas.test.ts`, `visibilidad-web.schema.test.ts`, `audit-log.listener.e5.test.ts`, `hu-e5.integration.test.ts`, `hu-e5.http.integration.test.ts`, y este documento.

**Modificados:** `package.json`, `prisma/seed.ts`, `scripts/liberar-reservas-vencidas.ts`, `src/app/api/cron/check-pruebas-vencidas/route.ts`, `src/components/layout/Sidebar.tsx`, `src/lib/auth/permisos-ecommerce.ts`, `src/lib/events/event-types.ts`, `src/lib/events/listeners/audit-log.listener.ts`, `src/lib/schemas/ecommerce.schema.ts`, `src/lib/services/ecommerce/hu-e4.integration.test.ts` (solo stubs D11), `src/lib/services/ecommerce/mantenimiento-programado.ts`, `src/lib/services/sistema/configuracion.service.ts`, `docs/specs/spec_modulo_E.md` (Revisión 4).

**No modificados:** `schema.prisma` (sin migración), `comprabilidad.ts`, `checkout.service.ts`, `carrito.service.ts`, `pago-web.service.ts`, `reserva.service.ts`, `cupon.service.ts`. En el PR, "Modificación de archivos esenciales": `seed.ts` marcado, `schema.prisma` sin marcar.
