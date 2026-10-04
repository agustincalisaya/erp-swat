# HU-E7 — Anulación manual de orden web no abonada (Módulo E)

Contrato: `docs/specs/spec_modulo_E.md` §2.7 y §2.7.a–§2.7.d (Revisión 5, aditiva) y §4. Task SDD: `docs/tasks/task_relos.md` (local: `docs/tasks/.gitignore` ignora todo el directorio, así que el task **no se versiona**; las decisiones vinculantes se copian en §3 de este cierre).

**Módulo:** E — Canal de Venta Online · **Responsable:** Adriel · **Sprint:** Sprint 4.
**Estado al 04/10/2026:** implementada y verificada con evidencia de ejecución sobre una base aislada (`swat_erp_test_e7`). Commit, PR e integración pendientes de ejecución manual por Adriel.

## 1. Historia de usuario y qué hace

**Como** Administrador E-commerce, **necesito** anular una orden web que no se pagó, **para** devolver su stock reservado sin perder el registro del intento de compra.

| Capacidad | Superficie | Resultado |
|---|---|---|
| Anulación manual | `PATCH /api/ecommerce/pedidos/[id]/anular`, pantalla `/ecommerce/pedidos` | `PAGO_PENDIENTE` / `PAGO_RECHAZADO` → `ANULADO`, baja lógica, stock de vuelta a DISPONIBLE |
| Anulación automática por TTL | Listener de `stock:reserva_liberada` (`TTL_VENCIDO`) | Misma anulación, actor de sistema "Canal Web", motivo `Reserva vencida sin pago (TTL)` |
| Trazabilidad | `ecommerce:orden_anulada` (evento sensible) | Asiento en el ledger encadenado SHA-256 |

## 2. Criterios de aceptación (5) — estado y evidencia

| CA | Criterio | Estado y evidencia |
|---|---|---|
| CA1 | Revierte la reserva sin eliminar la orden ni el intento | Aprobado: `hu-e7.integration` 1 (stock 3 → 5, reserva cerrada, `MovimientoStock` INGRESO, conteos de pedidos, ítems, reservas, aplicaciones, transacciones y extensiones idénticos); Chrome (a) (stock 7 → 8) |
| CA2 | El registro alimenta las métricas de conversión del Módulo D | Aprobado en el alcance de la spec: la orden queda persistida con su baja y su `deletion_reason`, y el evento lleva `automatico`. El consumidor (HU-D3) no existe todavía (§13) |
| CA3 | Baja lógica con `is_active`, `deleted_at`, `deleted_by`, `deletion_reason` obligatorio | Aprobado: servicio (1, 2, 2b) y HTTP (200 y 400 de motivo vacío/espacios/ausente) |
| CA4 | Al vencer la reserva, la orden se desactiva y el stock pasa a "Disponible" | Aprobado: `hu-e7.integration` 5 y 5b con el job real; Chrome (e) con `npm run job:reservas` |
| CA5 | Registro con hash SHA-256 como evento sensible | Aprobado: asientos manual (`usuario_id` = actor) y automático (`usuario_id` null), `verificarCadenaIntegridad()` íntegra (179 registros) |

## 3. Decisiones

D1–D13 se tomaron en la task antes de leer el código; N1–N12, sobre el reporte del Paso 1; D-P2-1 a D-P2-7, durante la implementación. Pendientes de validar con el equipo/PO las marcadas.

| Decisión | Contrato vigente |
|---|---|
| D1 | `[id]` = `pedido_venta_id` (UUID de `PedidoVenta`) |
| D2 (validar equipo) | Pantalla mínima `/ecommerce/pedidos`; sin `actions.ts`, el cliente llama al Route Handler (desvío de spec §2.7, igual que D15 de E5) |
| D3 (validar PO) | Anulación automática por listener de `stock:reserva_liberada` (`TTL_VENCIDO`), como pide la spec |
| D4 | Solo `PAGO_PENDIENTE` y `PAGO_RECHAZADO`; el resto 409 `TRANSICION_INVALIDA` |
| D5 | `PAGO_PENDIENTE`: libera reservas (`ANULACION_ORDEN`), baja del cupón pendiente, anula `PedidoVenta`, extensión `ANULADO`; una transacción, sin DELETE |
| D6 + N1 | `PAGO_RECHAZADO`: solo la extensión; si el `PedidoVenta` sigue `RESERVADO` y activo, también se anula; si ya está `ANULADO`, no se toca |
| D7 + N8 | Búsqueda sin filtrar `is_active` (desvío justificado de RULES §1); 404 `PEDIDO_WEB_NO_ENCONTRADO` |
| D8 + N2 | Motivo `ANULACION_ORDEN` en `MotivoLiberacionInmediata` y `ReservaLiberadaPayload` (aditivo); lo usan las dos vías. La vía automática libera también las reservas que sigan activas |
| D9 + N3 | Orden de bloqueo de la confirmación (`PedidoVenta` FOR UPDATE → extensión), `updateMany` condicional |
| D10 + N4 | Evento con el payload exacto de la spec; auditoría automática con `usuario_id: null`; `deleted_by` automático = "Canal Web" |
| D11 | `stock_liberado` = esta operación liberó al menos una reserva |
| D12 + N5 | Body `.strict()` con los mensajes de raíz de E5, **sin** tope de largo |
| D13 | `MOTIVO_ANULACION_TTL = "Reserva vencida sin pago (TTL)"`; sin consumidor del Módulo D |
| N6 | Tests: orden del checkout real y solo `fecha_expiracion` al pasado; Chrome: el mismo `UPDATE`, solo en `swat_erp_test_e7` |
| N7 | `listenersRegistrados` en el bus, `esperarAnulacionesPendientes()` en el listener; el script espera ambas |
| N9 | Copias locales `emitirPostCommitSeguroE7` y `FOR UPDATE` propio; `pago-web.service.ts` sin cambios |
| N10 | 409 de "ya anulada" con el fixture `PEDIDO_WEB_ANULADO_IDS` |
| D-P2-1 | El deadlock con `rechazarPago` es `40P01` (no `P2034`): reintento local de hasta 3 intentos, relectura del estado, eventos una sola vez |
| D-P2-2 | La baja del cupón la firma "Canal Web" en las dos vías (actor de las liberaciones de E4) |
| D-P2-3 | Asiento: `pedidos_venta` / `pedido_venta_id`; antes `{ is_active: true }` (el payload no trae el estado previo) |
| D-P2-4 | Mapeo 404/409 local en la ruta; helpers de `respuesta-catalogo.ts` reutilizados sin modificar; `PedidoVentaIdSchema` nuevo |
| D-P2-5 | El listener ignora sin error `TRANSICION_INVALIDA`/`PEDIDO_WEB_NO_ENCONTRADO` (otra reserva de la orden o el pago ganaron) |
| D-P2-6 | `PAGO_CONFIRMADO`, `CANCELADO`, `VENCIDO_SIN_RETIRO` del 409: orden real pagada con `estado_ecommerce` fijado por `UPDATE` (ningún servicio deja una orden en esos estados) |
| D-P2-7 | `.next/dev/types` estaba corrupto (generado, ignorado por git); se borró y `tsc`/`build` pasaron limpios |

## 4. Modelo de datos, configuración y seed

Sin migración ni cambios en `schema.prisma` ni en `prisma/seed.ts`: el permiso `ecommerce:anular_orden_no_abonada` ya estaba sembrado y asignado al Administrador E-commerce; `EstadoEcommerce.ANULADO` y los campos de baja lógica de `PedidoVenta` y `PedidoVentaEcommerce` ya existían.

## 5. Contrato del endpoint y permiso

`withPermission(PERMISO_ANULAR_ORDEN_NO_ABONADA)` (`"ecommerce:anular_orden_no_abonada"`, en `src/lib/auth/permisos-ecommerce.ts`). Actor siempre de la sesión; `params` con `await` (Next 16).

| Método | Ruta | Body | Éxito |
|---|---|---|---|
| PATCH | `/api/ecommerce/pedidos/[id]/anular` | `{ deletion_reason: string (trim, ≥ 1) }` | 200 `{ data: { pedido_venta_id, estado_ecommerce: "ANULADO", stock_liberado }, error: null }` |

Errores `{ data: null, error: { code, message } }`: 400 `VALIDATION_ERROR` ("El identificador del pedido es inválido", "El cuerpo debe ser un objeto JSON", "El motivo de anulación es obligatorio", "El motivo de anulación debe ser texto", "El cuerpo contiene campos no permitidos") · 401 `UNAUTHORIZED` · 403 `FORBIDDEN` · 404 `PEDIDO_WEB_NO_ENCONTRADO` · 409 `TRANSICION_INVALIDA` ("Solo una orden no abonada (Pago Pendiente o Pago Rechazado) puede anularse por esta vía") · 500 `INTERNAL_ERROR`.

## 6. Reglas de servicio

- `anulacion-orden.reglas.ts` (pura): `evaluarAnulabilidad(estado)` (matriz de los 9 estados), `MOTIVO_ANULACION_TTL`, mensaje del 409.
- `anulacion-orden.service.ts`: núcleo `anularOrdenTx` compartido por `anularOrdenNoAbonada` (manual) y `anularOrdenPorReservaVencida` (automática); reintento local ante `40P01`/`P2034`; emisión post-COMMIT aislada de `stock:reserva_liberada` (`ANULACION_ORDEN`), `ecommerce:cupon_aplicacion_liberada` y `ecommerce:orden_anulada`; `listarOrdenesNoAbonadasAdmin` (extensiones activas en `PAGO_PENDIENTE`/`PAGO_RECHAZADO`, `created_at desc, id`, página de 20, solo el nombre del cliente).
- Módulo A y B se usan solo por sus funciones: `liberarReservasTx`, `emitirReservasLiberadas`, `anularPedidoVentaTx`, `darDeBajaAplicacionCuponTx`, `emitirCuponAplicacionLiberada`.

## 7. Anulación automática

`anulacion-orden.listener.ts` se registra en `domain-event-bus.ts` después del de auditoría. Solo `TTL_VENCIDO`; captura todo error y loguea solo el código; lleva la cuenta de anulaciones en curso (`esperarAnulacionesPendientes()`). `domain-event-bus.ts` exporta `listenersRegistrados` (`Promise.allSettled` de los cuatro imports dinámicos, sin cambiar el registro de los existentes). `scripts/liberar-reservas-vencidas.ts` espera `listenersRegistrados` antes de la pasada y `esperarAnulacionesPendientes()` antes del drenaje de 500 ms y del `$disconnect`.

## 8. Auditoría y eventos

| Evento | Payload | Asiento (`audit-log.listener.ts`) |
|---|---|---|
| `ecommerce:orden_anulada` | `pedido_venta_id, usuario_id?, deletion_reason, automatico` | `usuario_id` = actor o `null`, `accion` = evento, `pedidos_venta`, antes `{ is_active: true }` / después `{ estado_ecommerce: "ANULADO", is_active: false, deletion_reason, automatico }`; `.catch` con `codigoDiagnosticoAuditoria` |
| `stock:reserva_liberada` (`ANULACION_ORDEN`) | sin cambios de forma | Handler existente `RESERVA_LIBERADA`, registra el motivo (verificado en el test 1) |

Sin cambios al escritor, la cola ni el hash-chain.

## 9. Pantalla `/ecommerce/pedidos`

Server Component con el gate de cupones y catálogo. `PedidosWebAdmin.tsx`: tarjetas mobile-first (una columna; dos desde `md`) con número de venta, cliente, total, fecha y badge (Pago pendiente / Pago rechazado); "Anular orden" con motivo obligatorio **y** casilla de confirmación (botón deshabilitado si falta cualquiera); el diálogo aclara si se libera stock o si ya se había liberado; aviso de éxito según `stock_liberado` y `router.refresh()`; errores 401/403/404/409/500 con mensajes en español sin detalles técnicos; estado vacío "No hay órdenes no abonadas"; paginación `?page=`. Sidebar: "Pedidos web" debajo de "Catálogo web", gateado por el permiso.

## 10. Cómo probar

```bash
docker exec swat_erp_postgres psql -U erpswat -d postgres -c "CREATE DATABASE swat_erp_test_e7 TEMPLATE template0"
export TEST_DB="postgresql://erpswat:<password>@localhost:5432/swat_erp_test_e7?schema=public"
# Misma ENCRYPTION_KEY_PROVEEDORES en el seed, los tests y el servidor; definida fuera del repo.
DATABASE_URL=$TEST_DB npx prisma migrate deploy && DATABASE_URL=$TEST_DB npx prisma db seed

npm test
HU_E7_INTEGRATION_DATABASE_URL=$TEST_DB npm run test:integration:e7
DATABASE_URL=$TEST_DB MP_MODO=simulado APP_PUBLIC_URL=http://localhost:3107 npx next dev -p 3107
HU_E7_INTEGRATION_BASE_URL=http://localhost:3107 HU_E7_INTEGRATION_DATABASE_URL=$TEST_DB npm run test:integration:e7-http
DATABASE_URL=$TEST_DB npm run job:reservas
```

Los dos tests verifican `current_database()` y fallan si la base no es de test. Escriben en la base (no borran nada); la suite de servicio anula fixtures del seed, así que cada corrida completa necesita una base recién sembrada.

**Resultados del 04/10/2026:** `npm test` 682/682 · `test:integration:e7` 11/11 (carrera con el pago: 4 anulación / 4 pago; carrera con el rechazo: 12/12 rondas con un deadlock reintentado y resultado consistente) · `test:integration:e7-http` 6/6 · regresión `e2` 11/11, `e4` 27/27, `e4-http` 10/10, `e5` 18/18, `e5-http` 8/8 · `npm run lint` 0 errores (4 warnings preexistentes en archivos no tocados) · `npx tsc --noEmit` 0 errores · `npm run build` OK.

## 11. Prueba manual en Chrome (04/10/2026, base `swat_erp_test_e7`, servidor en el puerto 3107)

| # | Escenario | Resultado |
|---|---|---|
| a | Anular V-2026-000004 (Juan Pérez, `PAGO_PENDIENTE`) | Probado: aviso "se anuló y su stock reservado volvió a estar disponible", sale de la lista; en la base `ANULADO`/`ANULADO`, reserva cerrada, stock 7 → 8 |
| b | Anular V-2026-000005 (`PAGO_RECHAZADO`) | Probado: el diálogo aclara que el stock ya se había liberado; aviso "No había stock reservado para liberar"; stock sin cambios (6) |
| c | Botón deshabilitado sin motivo o sin confirmación | Probado: deshabilitado con solo el motivo, con solo la confirmación y con motivo de solo espacios + confirmación |
| d | Usuario sin permiso | Probado: `operador.pickpack.seed` → `/no-autorizado`; su Sidebar no muestra "Pedidos web" |
| e | Anulación automática real | Probado: V-2026-000012 (creada con el checkout real), `UPDATE` de `fecha_expiracion` solo en `swat_erp_test_e7`, `npm run job:reservas` → "1 reserva(s) liberada(s)"; la orden quedó `ANULADO` con `deleted_by` "Canal Web" y el motivo TTL, stock 3 → 5, asiento con `usuario_id` null y `automatico: true`, y desapareció de la pantalla |
| f | Viewport de teléfono | Verificado parcialmente: la ventana estaba maximizada y no aceptó el cambio de tamaño; la página se cargó en un iframe de 387 px del mismo origen: una columna, sin scroll horizontal, Sidebar colapsado. No se probó en un dispositivo ni en el emulador |

El login del formulario se reemplazó por `POST /api/auth/login` desde la página (el formulario no completó la sesión antes de navegar); las credenciales son las del seed de test.

## 12. Hallazgos reportados, sin corregir

1. **Fixture `PEDIDO_WEB_PAGO_RECHAZADO_IDS`:** deja el `PedidoVenta` en `RESERVADO` y activo; el flujo real de E2 lo anula. Coincide con la spec §3.1, que a su vez contradice a E2 (documentado en §2.7.b Rev.5).
2. **`ejecutarConReintentoDeConflicto` (`src/lib/db/prisma.ts`) no cubre deadlocks:** Prisma informa `40P01` como `PrismaClientUnknownRequestError`, no como `P2034`.
3. **`void registrarAuditLog` sin `.catch` en el handler de `stock:reserva_liberada`** (y en los de E2 `pago_*`): un rechazo de la escritura produce `unhandledRejection`. Observado en la práctica: un script de prueba local que desconectó Prisma con auditoría encolada terminó con el proceso caído por ese rechazo.
4. **`ecommerce:orden_anulada` en `TIPOS_EVENTO_DOMINIO`** lo vuelve seleccionable como `tipo_evento` de plantilla de notificación (HU-F2); no hay consumidor de notificación para este evento.
5. **`spec_modulo_A.md`** no documenta el motivo `ANULACION_ORDEN`; queda para su owner (registrado en la extensión de eventos Rev.5 de la spec E).
6. **`.next/dev/types/routes.d.ts` corrupto** (generado por `next dev`, previo a esta sesión) hacía fallar `tsc` y `build`; se resolvió borrando el directorio generado.
7. **Título del documento** de las pantallas del backoffice: "Create Next App" (layout del dashboard, no de esta HU).
8. **`docs/tasks/.gitignore` ignora el task** (`*`): este documento replica sus decisiones.

## 13. Pendientes

- Validar con el equipo/PO: D2 (pantalla mínima, sin Server Action) y D3 (listener spec-literal; funciona en cron, checkout y script, ver §7).
- Decisiones de producto no pedidas por la spec: reconstruir el carrito del cliente, notificar al Cliente Web y cerrar la preferencia de Mercado Pago al anular.
- Consumo de las métricas de conversión por el Módulo D (HU-D3): el dato está persistido, el consumidor no existe.
- Agendado del cron en despliegue (mismo pendiente que reservas, cupones y carritos).

## 14. Archivos

**Nuevos:** `src/app/api/ecommerce/pedidos/[id]/anular/route.ts`, `src/app/(dashboard)/ecommerce/pedidos/page.tsx`, `src/components/ecommerce/PedidosWebAdmin.tsx`, `src/lib/services/ecommerce/anulacion-orden.reglas.ts`, `src/lib/services/ecommerce/anulacion-orden.reglas.test.ts`, `src/lib/services/ecommerce/anulacion-orden.service.ts`, `src/lib/events/listeners/anulacion-orden.listener.ts`, `src/lib/schemas/anulacion-orden.schema.test.ts`, `src/lib/services/ecommerce/hu-e7.integration.test.ts`, `src/lib/services/ecommerce/hu-e7.http.integration.test.ts`, y este documento.

**Modificados:** `package.json` (scripts `test:integration:e7`, `test:integration:e7-http` y los dos tests unitarios en `npm test`), `scripts/liberar-reservas-vencidas.ts` (N7), `src/components/layout/Sidebar.tsx`, `src/lib/auth/permisos-ecommerce.ts`, `src/lib/events/domain-event-bus.ts`, `src/lib/events/event-types.ts`, `src/lib/events/listeners/audit-log.listener.ts`, `src/lib/schemas/ecommerce.schema.ts`, `src/lib/services/inventario/reserva.service.ts` (solo el tipo `MotivoLiberacionInmediata`), `docs/specs/spec_modulo_E.md` (Revisión 5).

**No modificados:** `schema.prisma` (sin migración), `prisma/seed.ts`, `checkout.service.ts`, `carrito.service.ts`, `comprabilidad.ts`, `pago-web.service.ts`, `cupon.service.ts`, `mantenimiento-programado.ts`, la ruta del cron, `src/lib/db/prisma.ts`, `respuesta-catalogo.ts`.
