# PLAN de Implementación — HU-E13 (Cancelación y vencimiento de pedidos pagados)

## Revisión 2 — propuesta para aprobación

## ERP SWAT Indumentarias — Módulo E

**Fuente funcional única:** `docs/specs/spec_modulo_E.md`, HU-E13 — Revisión 3 — propuesta para revisión, aprobada y congelada.
**Alcance de este documento:** plan técnico ejecutable. No constituye implementación, TASKS ni evidencia de pruebas.
**Addendum post-T17:** reconciliación contractual aprobada en §9 (SPEC §2.13.16).
**Cierre 08/10/2026:** HU-E13 COMPLETADA — VERIFY PASS; T00–T20 aprobadas. Registro final de implementación y evidencia en §10.
**Stack real:** Next.js 16 App Router · TypeScript · Prisma ORM · PostgreSQL 16 · Zod · RBAC Módulo D · eventos internos · Mercado Pago vía Módulo F.

---

## 1. Objetivo, invariantes y brechas actuales

Implementar HU-E13 completa preservando las fronteras de dominio: E orquesta; A es dueño del stock; B de comprobantes y venta; G de tesorería; F del adapter Mercado Pago y notificaciones; D de auditoría/configuración.

Invariantes no negociables de la SPEC:

- pago aprobado persiste E en `PAGO_CONFIRMADO` e ingresa inmediatamente a la cola;
- tomar hace atómicamente `PAGO_CONFIRMADO → EN_PREPARACION` más asignación de operador;
- cliente cancela solo `PAGO_CONFIRMADO`; Administrador, `PAGO_CONFIRMADO | EN_PREPARACION | LISTO_PARA_RETIRO`;
- vencimiento y E3 compiten exclusivamente desde `LISTO_PARA_RETIRO`;
- B conserva `FACTURADO`; E termina en `CANCELADO` o `VENCIDO_SIN_RETIRO` con baja lógica y QR nulo;
- reintegro exclusivamente total, con una saga durable por pedido/pago;
- factura original inmutable, una NC HU-E13 vinculada, stock multi-item, un contra-asiento y como máximo un refund aprobado;
- no hay atomicidad entre PostgreSQL y Mercado Pago;
- retries técnicos conservan la clave del intento; solo un rechazo definitivo habilita un nuevo intento manual;
- estados terminales inactivos salen de Pick & Pack y permanecen en E9 para el dueño.

Brechas de implementación — no son decisiones abiertas:

| Brecha actual | Cierre exigido |
|---|---|
| E2 llama `admitirPedidoPagoConfirmado()` y termina en `EN_PREPARACION` | persistir `PAGO_CONFIRMADO`, emitir admisión a cola sin transición y mover transición/asignación a `tomarPedido()` |
| La cola filtra solo `EN_PREPARACION` | incluir `PAGO_CONFIRMADO` no tomado y `EN_PREPARACION` tomado/legacy operable; excluir inactivos y terminales |
| A solo libera reservas abiertas | agregar compensación idempotente por línea `VENDIDO → DISPONIBLE`; no usar `liberarReservasTx()` |
| B no admite NC ni relación al original | agregar `NOTA_CREDITO`, vínculo no único al original y emisión HU-E13 idempotente |
| G11 retorna `payload | null` | retornar `CREADO | YA_EXISTENTE | INGRESO_ORIGINAL_NO_ENCONTRADO` |
| F1 no recibe clave | exigirla y enviarla como `X-Idempotency-Key` en cada refund |
| No existe saga persistente | agregar cabecera, compensaciones de stock e intentos de refund |
| E9 filtra extensiones inactivas | excepción histórica acotada a `CANCELADO` y `VENCIDO_SIN_RETIRO` propios |
| E3 solo rechaza plazo vencido | mantener rechazo y hacer competir al job de vencimiento con el mismo orden de locks |

---

## 2. Grafo de dependencias y orden obligatorio

```text
F0 Relevamiento/preflight de datos legacy
  └─> F1 Prisma + migration + seed/configuración
       ├─> F2 Módulo B: Nota de Crédito
       ├─> F3 Módulo A: stock multi-item
       ├─> F4 G11: resultado discriminado
       └─> F5 F1: X-Idempotency-Key
            F2 + F3 + F4 + F5
                    └─> F6 Saga HU-E13 y locks compartidos
                         ├─> F7 E2/E12 cola y toma
                         ├─> F8 APIs cancelación cliente/admin + reintento manual
                         ├─> F9 vencimiento, recordatorio y retry cron
                         ├─> F10 E9 e historial
                         └─> F11 eventos, F3 y AuditLog
                              F7–F11
                                └─> F12 UI cliente y administrativa
                                     └─> F13 integración end-to-end
                                          └─> VERIFY final D17/R22
```

Regla de ejecución: no iniciar F6 antes de tener contratos probados de B/A/G/F; no iniciar rutas o UI antes del dominio; no desplegar el cambio E2/E12 sin migration y cola compatibles; no habilitar cron hasta que la saga sea idempotente.

---

## 3. Matriz SPEC → componentes concretos

| Contrato Rev.3 | Componentes principales |
|---|---|
| Máquina B/E, cola y toma | `pago-web.service.ts`, `pick-pack.service.ts`, `pick-pack.types.ts`, schemas/rutas/componentes de preparación |
| Locks cancelación/toma/vencimiento/E3 | nuevo servicio HU-E13, `pick-pack.service.ts`, `retiro-e3.service.ts`, helper compartido de lock si evita duplicación |
| NC total e inmutable | `schema.prisma`, migration, `comprobante-fiscal.service.ts` |
| Stock 1:N | `schema.prisma`, migration, nuevo servicio A de compensación y saga E |
| G11 discriminado | `ingreso-tesoreria.service.ts` y sus consumidores/tests |
| Refund e intentos | `adapter.ts`, saga E, modelos Prisma, ruta manual |
| Cancelación Cliente/Admin | nuevas rutas bajo `/api/tienda/mis-pedidos/**` y `/api/ecommerce/pedidos/**`, schema Zod, saga |
| Vencimiento/recordatorio/retries | nuevo procesador HU-E13, `mantenimiento-programado.ts`, cron existente y script compartido |
| E9 histórico | `mis-pedidos.service.ts`, schemas, rutas y componentes E9 |
| F3/AuditLog | `event-types.ts`, `domain-event-bus.ts` si corresponde, listeners de notificación/auditoría |
| UI administrativa | `PedidosWebAdmin.tsx`, página `/ecommerce/pedidos`, DTO/listado administrativo |
| Addendum lectura administrativa T15 | nueva página `/ecommerce/pedidos/pagados`, componente HU-E13 y lectura `listarPedidosPagadosAdmin`; `/ecommerce/pedidos` permanece HU-E7 sin cambios |
| UI Cliente Web | `MisPedidosListado.tsx`, `DetallePedidoWeb.tsx`, páginas de cuenta |
| RBAC | `permisos-ecommerce.ts`; seed solo verifica/reutiliza permiso existente |

---

## 4. Fases de implementación

### F0 — Preflight y compatibilidad de datos existentes

**Responsabilidad**

- Inventariar en una copia de base los pedidos WEB actuales por estado E, actividad, operador, escaneos, QR/plazo, factura, ingreso y pago MP, únicamente para detectar/reportar inconsistencias.
- Todo pedido existente conserva exactamente sus estados B/E. La migration no convierte ni reinterpreta retrospectivamente `PAGO_CONFIRMADO`, `EN_PREPARACION`, `LISTO_PARA_RETIRO`, `CANCELADO`, `VENCIDO_SIN_RETIRO` o `ENTREGADO`.
- La nueva semántica `PAGO_CONFIRMADO → EN_PREPARACION` al tomar se aplica solo a pagos confirmados después del despliegue. Un `EN_PREPARACION` legacy conserva ese estado; cualquier adaptación de lectura necesaria para mantenerlo operable no modifica su historia persistida.
- No crear sagas, NC, movimientos o refunds retroactivos sin un hecho HU-E13 ocurrido después del despliegue.
- Pedidos existentes `LISTO_PARA_RETIRO` conservan estado, QR y plazo. Las nuevas tareas pueden evaluarlos con esos datos ya persistidos, sin backfill ni cambio preventivo de estado.
- Estados históricos `CANCELADO`/`VENCIDO_SIN_RETIRO` sin saga siguen visibles en E9 con reintegro `null`; no fabricar evidencia fiscal/remota.
- Un campo nuevo solo admite backfill si es técnicamente obligatorio y su valor se deriva inequívocamente sin reinterpretar el negocio. Cualquier inconsistencia legacy se reporta y puede bloquear el despliegue o el agregado afectado, pero nunca se corrige automáticamente.

**Archivos**

- No requiere archivo productivo propio; los chequeos SQL formarán parte de la migration/predeploy documentada en `prisma/migrations/<timestamp>_hu_e13_cancelacion_reintegro/migration.sql` cuando puedan expresarse de forma segura.
- Fixtures compatibles: `prisma/seed.ts`.

**Dependencia:** ninguna.

**Tests/gate**

- Fixtures legacy en cada estado B/E permanecen byte-a-byte en esos estados después de la migration.
- `EN_PREPARACION` legacy, tomado o no tomado, conserva `EN_PREPARACION` y no se convierte a `PAGO_CONFIRMADO`.
- `LISTO_PARA_RETIRO` conserva estado, plazo y QR.
- Un pago posterior al despliegue persiste `PAGO_CONFIRMADO` y solo pasa a `EN_PREPARACION` al tomar.
- Migration/preflight reporta incoherencias y nunca las corrige silenciosamente.

**Riesgo:** que consultas nuevas excluyan registros legacy sin operador o intenten normalizarlos. Mitigación: compatibilidad de lectura explícita y pruebas sobre snapshot, sin escrituras ni reclasificación comercial.

---

### F1 — Prisma, migration aditiva y configuración

**Responsabilidad**

Aplicar exactamente el modelo Rev.3:

- `TipoComprobanteVenta.NOTA_CREDITO`.
- `ComprobanteFiscal.comprobante_original_id` nullable, FK `Restrict`, indexado y no único.
- No agregar por defecto `clave_idempotencia` a `ComprobanteFiscal` ni a `MovimientoStock`.
- enums `EstadoReintegroPedidoWeb`, `TipoActorReintegro`, `EstadoIntentoRefund`, `OrigenIntentoRefund`.
- modelos `ReintegroPedidoWeb`, `ReintegroStockCompensacion`, `ReintegroRefundIntento`, relaciones inversas e índices de la SPEC.
- idempotencia mínima: `ReintegroPedidoWeb.pedido_venta_id` y `nota_credito_id` únicos; en stock, `[reintegro_id, pedido_venta_item_id]`, `clave_idempotencia` y `movimiento_stock_id` únicos; en intentos, `clave_idempotencia` única e historial inmutable.
- B/A deben crear el hecho owner y vincularlo a su referencia HU-E13 dentro de la misma transacción PostgreSQL, de modo que un rollback no deje un comprobante/movimiento creado sin vínculo.
- FK `onDelete: Restrict`; ningún `DELETE` ni cascada destructiva.
- `ConfiguracionSistema.ECOMMERCE_RECORDATORIO_RETIRO_HORAS = 24`.
- verificar —no recrear— `ecommerce:cancelar_pedido_pagado` y su asignación al Administrador E-commerce.

**Archivos a modificar/crear**

- Modificar `prisma/schema.prisma`.
- Crear `prisma/migrations/<timestamp>_hu_e13_cancelacion_reintegro/migration.sql`.
- Modificar `prisma/seed.ts`.
- Regenerar cliente Prisma como paso de build, sin editar artefactos generados manualmente.

**Estrategia de migration**

1. Agregar valores de enum y columnas nullable.
2. Crear tablas hijas/cabecera, índices y uniques.
3. Agregar FK no destructivas; la FK circular de `intento_aprobado_id` se incorpora después de crear ambas tablas.
4. No actualizar ningún estado comercial B/E existente ni fabricar historia de transición.
5. Permitir backfill de un campo nuevo solo si es técnicamente obligatorio y derivable inequívocamente; documentarlo y probar que no reinterpreta el negocio. Este PLAN no identifica hoy ningún backfill obligatorio.
6. No hacer `DROP`, rename destructivo, `TRUNCATE`, reset ni backfill de saga/refund/NC.
7. Validar constraints contra una copia con datos reales antes de `migrate deploy`.
8. Mantener columnas nuevas nullable donde la historia previa no puede reconstruirse.

**Dependencia:** F0.

**Tests/gate**

- `prisma validate`, generación del cliente y `migrate deploy` sobre DB vacía y DB clonada con migration previa.
- Repetir seed sin duplicar configuración/permiso.
- Tests DB de cada unique compuesto y FK `Restrict`.
- Verificar que comprobantes/movimientos existentes aceptan columnas nulas.

**Riesgo:** ciclo de FK del intento aprobado y modificación de enum PostgreSQL. Mitigación: SQL ordenado y migration probada desde el último esquema productivo.

---

### F2 — Módulo B: Nota de Crédito HU-E13

**Responsabilidad**

Agregar un helper transaccional de B —por ejemplo `emitirNotaCreditoReintegroTx(tx, input)`— que:

- localice la factura original del mismo pedido;
- exija refund total y cree `NOTA_CREDITO` por el monto cobrado/facturado completo;
- guarde `comprobante_original_id` y vincule la NC mediante `ReintegroPedidoWeb.nota_credito_id @unique`;
- nunca actualice/desactive factura original ni cambie B desde `FACTURADO`;
- bajo lock de la saga, cree la NC y vincule `nota_credito_id` dentro de la misma transacción; si ya está vinculado, retorne `YA_EXISTENTE` con ese ID;
- retorne `CREADO | YA_EXISTENTE` con el mismo `nota_credito_id`;
- rechace original ausente, ajeno o inconsistente sin crear documento parcial.

**Archivos**

- Modificar `src/lib/services/ventas/comprobante-fiscal.service.ts`.
- Modificar `src/lib/services/ventas/comprobante-fiscal.service.test.ts`.
- Modificar `src/lib/services/ventas/comprobante-fiscal.integration.test.ts`.
- Prisma/migration de F1.

**Dependencia:** F1.

**Tests/gate**

- NC total vinculada e inmutable.
- Retry secuencial y carrera devuelven la misma NC.
- Otra NC fiscal del mismo original no queda prohibida globalmente.
- Factura original, monto y estado B permanecen intactos.
- Regresión completa del comprobante FACTURA_A/B/TICKET.

**Riesgo:** reutilizar `emitirComprobanteFiscal()` sin distinguir reglas NC. Mitigación: helper B explícito que comparta solo generación local CAE/QR y valide relación/idempotencia.

---

### F3 — Módulo A: compensación `VENDIDO → DISPONIBLE` multi-item

**Responsabilidad**

Crear un núcleo A transaccional por línea —por ejemplo `compensarVentaPagadaTx(tx, input)`— que:

- reciba item, SKU, depósito, cantidad, actor, motivo y clave de la hija E;
- valide correspondencia con la reserva/venta original y cantidad vendida;
- incremente `StockDeposito` en el depósito original;
- cree `MovimientoStock` tipo ingreso compensatorio con un `MovimientoStockItem` `VENDIDO → DISPONIBLE`;
- use como guarda la hija bloqueada `ReintegroStockCompensacion`, cuya clave y par `[reintegro_id, pedido_venta_item_id]` son únicos;
- cree el movimiento, incremente stock y vincule `movimiento_stock_id` dentro de la misma transacción; si la hija ya está vinculada, retorne `YA_EXISTENTE`;
- retorne `CREADO | YA_EXISTENTE` y nunca duplique stock;
- no reutilice `liberarReservasTx()`.

E crea las filas `ReintegroStockCompensacion`; A sigue siendo el único que muta stock. El procesador ordena por `pedido_venta_item_id`, salta hijas completas y ejecuta solo las faltantes. Un rollback revierte conjuntamente incremento, movimiento y vínculo.

**Archivos**

- Crear `src/lib/services/inventario/compensacion-venta.service.ts`.
- Crear `src/lib/services/inventario/compensacion-venta.service.test.ts`.
- Crear test de integración del mismo servicio.
- Modificar tipos/eventos de inventario solo si el movimiento requiere payload auditado, sin cambiar semántica de servicios existentes.
- Prisma/migration de F1.

**Dependencia:** F1.

**Tests/gate**

- Pedido con dos SKU genera dos compensaciones y cantidades exactas.
- Dos líneas del mismo SKU se idempotentizan por item, no solo SKU.
- Falla simulada entre creación lógica y commit: la transacción revierte incremento, movimiento y vínculo; el retry crea una sola compensación.
- Una línea completa + otra pendiente: solo procesa la pendiente.
- Carrera por la misma hija/clave: el lock y las constraints dejan un único incremento/movimiento.
- Regresión de reserva/confirmación, ingreso multi-item y stock por depósito.

**Riesgo:** depósito no reconstruible desde la venta. Mitigación: resolverlo por `PedidoVentaItem.reserva_id → Reserva.deposito_id`; si un pedido WEB pagado carece de esa evidencia, la saga queda pendiente con inconsistencia operativa, sin elegir depósito arbitrario.

---

### F4 — Módulo G: resultado discriminado G11

**Responsabilidad**

Reemplazar la ambigüedad `payload | null` de `registrarContraAsiento()` con:

```text
CREADO { contra_asiento_id, ... }
YA_EXISTENTE { contra_asiento_id, ... }
INGRESO_ORIGINAL_NO_ENCONTRADO
```

Agregar variante `tx`-scoped si la necesita el orquestador, conservar `pedido_venta_id @unique`, no mutar `IngresoTesoreria` y adaptar consumidores existentes sin interpretar “sin ingreso” como éxito.

**Archivos**

- Modificar `src/lib/services/tesoreria/ingreso-tesoreria.service.ts`.
- Modificar `src/lib/services/tesoreria/ingreso-tesoreria.service.test.ts`.
- Revisar/adaptar `src/lib/events/listeners/ingreso-tesoreria.listener.ts` y su test solo si consumen el retorno.

**Dependencia:** F1 para tipos relacionados de saga; el helper G puede desarrollarse en paralelo con F2/F3/F5.

**Tests/gate**

- creado, ya existente y falta de ingreso diferenciados.
- `P2002` concurrente se resuelve como `YA_EXISTENTE` con ID real.
- ingreso original inmutable.
- regresión HU-G11 completa.

**Riesgo:** consumidores actuales dependen de `null`. Mitigación: búsqueda de usos y adaptación atómica en el mismo bloque.

---

### F5 — Módulo F: refund idempotente

**Responsabilidad**

Cambiar el contrato de `solicitarReembolso` para exigir `paymentId` y `claveIdempotencia`; HU-E13 no pasa monto y por lo tanto solicita refund total. `llamarMercadoPago` debe permitir headers adicionales seguros y enviar literalmente:

```http
X-Idempotency-Key: <clave persistida del intento>
```

El adapter mapea aprobado/pendiente/rechazado y errores transitorios sin loguear token, header ni payload sensible. El simulador debe devolver el mismo refund para payment + key y permitir fixtures de timeout, rechazo y aprobación.

**Archivos**

- Modificar `src/lib/integraciones/mercadopago/adapter.ts`.
- Modificar `src/lib/integraciones/mercadopago/adapter.reembolso.test.ts`.
- Modificar helper HTTP interno del mismo adapter si hoy no admite headers.

**Dependencia:** ninguna de dominio; integrar después de F1 para usar el intento persistido.

**Tests/gate**

- header exacto presente en `POST /v1/payments/{id}/refunds`.
- retry técnico usa exactamente la misma clave/refund.
- claves diferentes representan intentos lógicos diferentes.
- body total omite `amount`.
- regresión de alta, health-check, webhook, bitácora y adapter F1 existente.

**Riesgo:** cambiar firma pública rompe callers. Mitigación: localizar todos los usos y compilar en el mismo gate; no ofrecer overload sin clave para refunds.

---

### F6 — Núcleo de saga HU-E13 y coordinación de locks

**Responsabilidad**

Crear el orquestador server-only con operaciones separadas:

- iniciar cancelación/vencimiento bajo lock, transición condicionada y creación atómica de cabecera + hijas stock;
- avanzar un paso local idempotente: NC → compensaciones faltantes → G11;
- crear/recuperar intento inicial durable;
- llamar F1 fuera de transacción/locks;
- persistir aprobado, rechazo definitivo o retry técnico;
- crear intento manual preservando historial;
- reanudar una cabecera `PENDIENTE` desde sus marcadores.

Orden de lock uniforme: `PedidoVenta` → `PedidoVentaEcommerce` → ítems activos ordenados → dependencias. Extraer un helper compartido únicamente si E3/E12 pueden consumirlo sin circularidad; de lo contrario, alinear SQL y cubrir el orden con tests. Nunca invocar MP dentro de `$transaction` ni dentro del reintento por deadlock.

**Addendum de retry congelado:** F6 implementa la política temporal fijada por el addendum posterior a Rev.3 de SPEC §2.13.7. Un error `TIMEOUT`, `RED`, `HTTP_429`, `HTTP_5XX` o `RESPUESTA_AMBIGUA` incrementa `intentos_tecnicos` sobre el mismo hijo y conserva número/key; con `n` posterior al incremento programa `proximo_reintento_at = ahora + min(5 * 2^(n - 1), 360) minutos` (`5, 10, 20, 40, 80, 160, 320, 360...`), sin jitter, límite ni rechazo por cantidad. `PENDING` remoto no incrementa el contador y programa `ahora + 15 minutos`. Todo intento `INICIAL` o `REINTENTO_MANUAL` nace confirmado con `proximo_reintento_at = ahora` antes de F1; `APROBADO`/`RECHAZADO` lo limpian. HTTP `400/401/403/404` es rechazo definitivo; `429/5xx` permanece técnico. El mantenimiento solo toma cabeceras `PENDIENTE` con fecha no nula y vencida, y reutiliza el hijo pendiente existente.

**Archivos**

- Crear `src/lib/services/ecommerce/reintegro-pedido-web.service.ts`.
- Crear `src/lib/services/ecommerce/reintegro-pedido-web.types.ts` si el volumen lo justifica.
- Crear `src/lib/services/ecommerce/reintegro-pedido-web.reglas.ts` para matrices puras.
- Crear unit/integration tests HU-E13 del núcleo.
- Modificar `src/lib/db/prisma.ts` solo si hace falta reutilizar retry de `40P01/P2034`, sin cambiar garantías de otros módulos.

**Dependencias:** F1–F5.

**Tests/gate**

- crash/retry en cada frontera definida por §2.13.7.
- una cabecera por pedido/pago.
- NC/stock/G11 incompletos identificables sin logs.
- G11 ausente mantiene E terminal y saga pendiente.
- timeout F1 conserva intento/key.
- rechazo detiene cron; aprobación impide otro intento.
- reintento manual conserva hijo rechazado y nunca permite dos aprobados.

**Riesgo:** emisión de eventos duplicada al reanudar. Mitigación: emitir solo por transición durable ganada; no emitir en `YA_EXISTENTE`/no-op.

---

### F7 — E2/E12: `PAGO_CONFIRMADO`, cola y toma atómica

**Responsabilidad**

- E2 mantiene facturación, confirmación `RESERVADO → VENDIDO`, ingreso G11, fecha de pago y evento de cola, pero deja E en `PAGO_CONFIRMADO`.
- `admitirPedidoPagoConfirmado()` deja de transicionar; puede reducirse a validación/preparación del evento de cola o reemplazarse por un helper con nombre coherente.
- Cola: incluir `PAGO_CONFIRMADO` no tomado y `EN_PREPARACION` tomado/legacy compatible; excluir inactivos/terminales.
- Tomar: bajo locks, `PAGO_CONFIRMADO → EN_PREPARACION` y operador en un update/commit; dos operadores, uno gana.
- Prioridad: permitirla sobre pedido visible no tomado en `PAGO_CONFIRMADO`; escaneo/completar siguen exigiendo `EN_PREPARACION` y actor asignado.

**Archivos**

- Modificar `src/lib/services/ecommerce/pago-web.service.ts`.
- Modificar `src/lib/services/ecommerce/pick-pack.service.ts` y `pick-pack.types.ts`.
- Modificar `src/lib/schemas/pick-pack.schema.ts` si cambian DTOs.
- Modificar rutas existentes `src/app/api/ecommerce/preparacion/**` solo por adaptación de contrato.
- Modificar `ConsolaPickPack.tsx`, `PreparacionPedidoPanel.tsx` después del gate de dominio.
- Adaptar tests `hu-e2.integration`, `hu-e2-e12.integration`, `pick-pack*`.

**Dependencias:** F1 y F6 para locks/race; puede preparar cambios detrás de tests antes de habilitar rutas.

**Tests/gate**

- webhook aprobado deja `PAGO_CONFIRMADO`, cola visible y evento único.
- tomar transiciona/asigna atómicamente; retry mismo operador idempotente; segundo operador conflicto.
- carrera tomar vs cancelación cliente: un ganador.
- facturación, stock vendido, notificación de cola, prioridad, scans y completar sin regresión.

**Riesgo:** tests/fixtures E12 asumen `EN_PREPARACION` desde pago. Mitigación: actualizar fixtures solo cuando el escenario simula una toma real.

---

### F8 — APIs de cancelación y reintento manual

**Responsabilidad**

Adaptadores HTTP finos sobre F6:

- Cliente Web: propiedad por `sesion.clienteId`, solo `PAGO_CONFIRMADO`.
- Administrador: permiso existente y tres estados permitidos.
- Reintento manual: solo admin, motivo estricto, cabecera rechazada y sin intento aprobado/pendiente ajeno.
- envelopes/status exactos de la SPEC; retries retornan IDs/estado durable sin duplicar efectos.

**Archivos a crear**

- `src/app/api/tienda/mis-pedidos/[id]/cancelar/route.ts`.
- `src/app/api/ecommerce/pedidos/[id]/cancelar/route.ts`.
- `src/app/api/ecommerce/pedidos/[id]/reintegro/reintentar/route.ts`.
- `src/lib/schemas/reintegro-pedido-web.schema.ts` y test.
- Tests HTTP HU-E13.

**Archivos a modificar**

- `src/lib/auth/permisos-ecommerce.ts` para exponer/reutilizar la constante existente, sin seed de permiso nuevo.
- Error mapper compartido de e-commerce si corresponde.

**Dependencias:** F6 y F7.

**Tests/gate**

- 200 idempotente; 400 body; 401/403; 404 sin IDOR; 409 por transición/intento en proceso.
- Cliente no cancela pedido ajeno ni tomado.
- Admin cancela los tres estados y nunca terminal/entregado.
- Reintento manual preserva intento rechazado.

**Riesgo:** confundir ruta HU-E7 `/anular` con cancelación pagada. Mitigación: servicio/rutas separados; reutilizar solo patrones de auth/error/locks, no reglas de stock reservado.

---

### F9 — Vencimiento, recordatorio y cron/retries

**Responsabilidad**

Crear tres tareas aisladas:

1. recordatorios con clave F3 estable, sin columna nueva;
2. vencimiento de `LISTO_PARA_RETIRO` solo cuando `plazo < ahora`;
3. avance de sagas `PENDIENTE` elegibles por `proximo_reintento_at`.

Vencimiento usa Canal Web en `deleted_by`, actor sistema y `AuditLog.usuario_id = null`. Dos workers concurrentes se protegen por locks/transición condicionada. `RECHAZADO`/`APROBADO` no entran al retry. La pasada existente conserva reservas, cupones y carritos aunque falle E13.

**Archivos**

- Crear `src/lib/services/ecommerce/mantenimiento-hu-e13.service.ts` y tests.
- Modificar `src/lib/services/ecommerce/mantenimiento-programado.ts` y su test.
- Modificar `src/app/api/cron/check-pruebas-vencidas/route.ts` solo para exponer resultados agregados seguros.
- Modificar el script invocado por `npm run job:reservas` si necesita esperar eventos pendientes; no crear otro scheduler.

**Dependencias:** F6, F11 para eventos/F3.

**Tests/gate**

- igualdad de plazo no vence; plazo superado sí.
- dos jobs, un único vencimiento/saga.
- recordatorio en ventana y una notificación por destinatario.
- configuración 24, `>0`, `< días*24`; inválida falla solo recordatorio.
- retry recupera G11 tardío/F1 transitorio; no toma rechazados/aprobados.
- regresión de las tres tareas anteriores de mantenimiento.

**Riesgo:** lote grande y locks prolongados. Mitigación: paginar candidatos y procesar cada agregado en transacción separada; no llamar F1 con locks.

---

### F10 — E9: historia y detalle del reintegro

**Responsabilidad**

Cambiar la lectura, no la actividad operacional:

- incluir extensiones inactivas exclusivamente cuando sean propias y estén `CANCELADO`/`VENCIDO_SIN_RETIRO`;
- mantener `PedidoVenta` WEB activo/propio;
- mostrar estado, motivo, fechas y estado agregado del reintegro;
- no exponer `refund_id`, claves, errores técnicos ni datos MP;
- QR siempre nulo en terminales;
- aceptar registros históricos terminales sin saga con reintegro `null`.

**Archivos**

- Modificar `src/lib/services/ecommerce/mis-pedidos.service.ts`.
- Modificar `src/lib/schemas/mis-pedidos.schema.ts` si el DTO se amplía.
- Modificar rutas E9 solo si requieren serialización adicional.
- Modificar `MisPedidosListado.tsx`, `DetallePedidoWeb.tsx` en F12.
- Adaptar tests E9 service/integration/HTTP/UI.

**Dependencias:** F1 y F6.

**Tests/gate**

- dueño ve terminal inactivo; tercero obtiene 404.
- inactivo no terminal sigue oculto.
- QR y detalles internos ocultos.
- pedidos activos previos mantienen listado/detalle.

**Riesgo:** relajar globalmente soft-delete. Mitigación: OR explícito solo dentro del scope cliente/canal/estados HU-E13.

**Addendum post-T17:** el DTO E9 del Cliente Web y la selección de comprobantes quedan fijados por SPEC §2.13.16.2–§2.13.16.3 (ver §9.2 de este PLAN).

---

### F11 — Eventos, F3 y AuditLog

**Responsabilidad**

Agregar contratos Rev.3 y handlers explícitos:

- `ecommerce:plazo_retiro_por_vencer`;
- `ecommerce:pedido_cancelado`;
- `ecommerce:pedido_vencido_sin_retiro`;
- `ecommerce:reintegro_estado_cambiado` con intento/número/origen.

F3 usa `Notificacion.clave_idempotencia` estable por evento/origen/destinatario. Recordatorio al Cliente Web; cancelación/vencimiento al Cliente Web y rol Administrador E-commerce *(sustituido por el addendum post-T17, §9.1: cancelación y vencimiento notifican únicamente al Cliente Web operable; vencimiento con prioridad `CRITICA`)*. Auditoría sensible para cancelación/vencimiento/rechazo/reintento/aprobación; actor web/sistema con `usuario_id = null`, admin con su ID. Eventos solo post-commit y no-op/retry técnico sin nuevo hecho no duplican auditoría.

**Archivos**

- Modificar `src/lib/events/event-types.ts` y test.
- Modificar `src/lib/events/listeners/notificacion.listener.ts` y tests nuevos HU-E13.
- Modificar `src/lib/events/listeners/audit-log.listener.ts` y tests nuevos HU-E13.
- Modificar `src/lib/events/domain-event-bus.ts` solo si el patrón de registro requiere otro listener.
- `prisma/seed.ts` únicamente si el motor vigente exige plantillas; usar fallback interno si esa es la convención actual.

**Dependencias:** F6 y modelos F1; F9 consume recordatorio.

**Tests/gate**

- payload sin PII/QR/credenciales/error remoto.
- F3 duplicado por retry produce una fila por destinatario.
- hash-chain íntegra; actor correcto humano/web/sistema.
- rechazo y reintento manual conservan dos hechos separados.
- fallo de listener no revierte saga.

**Riesgo:** evento emitido antes de completar el commit. Mitigación: resultado pendiente post-commit y emisión fuera de transacción, siguiendo patrones E3/E7/E12.

---

### F12 — UI Cliente Web y Administrador

**Responsabilidad**

Implementar después de dominio/APIs:

- E9: botón de cancelación solo en `PAGO_CONFIRMADO`, diálogo con motivo y confirmación, estado durable resultante.
- Administrador: pedidos pagados cancelables en los tres estados, motivo obligatorio, progreso de saga y estados `PENDIENTE/APROBADO/RECHAZADO`.
- Para `RECHAZADO`, acción explícita de reintento manual con motivo; ocultarla en pendiente/aprobado.
- Pick & Pack: mostrar `PAGO_CONFIRMADO` no tomado; terminales/inactivos no aparecen.
- No exponer IDs remotos, claves, errores sensibles ni permitir que UI sustituya autorización server-side.

**Addendum de lectura administrativa T15**

- Mantener `/ecommerce/pedidos` exclusivamente como pantalla HU-E7 para `PAGO_PENDIENTE | PAGO_RECHAZADO`, con su permiso actual.
- Crear la pantalla separada `/ecommerce/pedidos/pagados`, nombre funcional **Pedidos pagados / Gestión de pedidos pagados**, protegida solo por `PERMISO_CANCELAR_PEDIDO_PAGADO = ecommerce:cancelar_pedido_pagado`; no exigir permiso HU-E7 ni autorizar por nombre de rol.
- Incorporar un Server Component y servicio dedicado, conceptualmente `listarPedidosPagadosAdmin(...)`, sin API pública de lectura adicional salvo necesidad técnica real.
- Seleccionar exclusivamente `PAGO_CONFIRMADO | EN_PREPARACION | LISTO_PARA_RETIRO | CANCELADO | VENCIDO_SIN_RETIRO`. Excluir `PAGO_PENDIENTE`, `PAGO_RECHAZADO`, `ENTREGADO` y `ANULADO`.
- Aplicar localmente `(activa AND no eliminada AND estado cancelable) OR (inactiva AND deleted_at no nulo AND estado terminal HU-E13)`, conservando criterios normales de `PedidoVenta` WEB y sin relajar soft-delete global.
- Proyectar por fila únicamente identificación comercial segura, fecha, total, estado E, plazo, `reintegro: null | { estado, tiene_intento_pendiente }` y `acciones: { cancelar_pedido, reintentar_reintegro }`.
- Calcular `cancelar_pedido = true` solo para `PAGO_CONFIRMADO | EN_PREPARACION | LISTO_PARA_RETIRO`.
- Calcular `reintentar_reintegro = true` solo para cabecera `RECHAZADO` sin hijo `PENDIENTE`; la UI no infiere elegibilidad desde el estado comercial.
- No proyectar IDs de saga/intento, número/key, payment/refund ID, NC, contra-asiento, error técnico, actor/motivo histórico ni payload MP.
- Ejecutar filtro completo y `count` en PostgreSQL antes de `orderBy/skip/take`; no anexar terminales a una página de activos.
- Tras `PATCH /api/ecommerce/pedidos/[id]/cancelar` o `POST /api/ecommerce/pedidos/[id]/reintegro/reintentar`, refrescar/revalidar la lectura; T11 conserva autoridad ante carreras.

**Archivos**

- Modificar `src/components/ecommerce/MisPedidosListado.tsx` y/o `DetallePedidoWeb.tsx`.
- Modificar páginas `src/app/(tienda)/tienda/cuenta/pedidos/**` según ubicación de la acción.
- Modificar `src/components/ecommerce/PedidosWebAdmin.tsx` y `src/app/(dashboard)/ecommerce/pedidos/page.tsx`.
- Addendum T15: crear un componente administrativo HU-E13, `src/app/(dashboard)/ecommerce/pedidos/pagados/page.tsx` y un servicio de lectura dedicado; no modificar la semántica de los archivos HU-E7 de la viñeta anterior.
- Modificar `ConsolaPickPack.tsx`/`PreparacionPedidoPanel.tsx` para estado de cola.
- Adaptar tests de componentes existentes y crear casos HU-E13.

**Dependencias:** F7, F8, F10, F11.

**Tests/gate**

- visibilidad exacta de botones por estado/actor.
- motivo requerido, pending UI, error 409 por carrera y refresh del estado ganador.
- rechazo visible y reintento manual; aprobado sin acción.
- accesibilidad básica de diálogo/feedback y no exposición de secretos.

**Riesgo:** UI optimista representa cancelación antes del commit. Mitigación: renderizar exclusivamente respuesta/refresh del servidor.

---

### F13 — Integración end-to-end y estabilización

**Responsabilidad**

Conectar todos los bloques con fixtures reales de checkout, pago, cola, toma, preparación, LISTO, E3, G11, F1 simulado, cron, E9 y auditoría. Agregar scripts de integración solo siguiendo convención existente; usar DB aislada y migrada desde cero y desde snapshot pre-HU-E13.

**Archivos**

- Crear suites `src/lib/services/ecommerce/hu-e13.integration.test.ts` y `hu-e13.http.integration.test.ts` o nombres equivalentes al patrón actual.
- Crear suite específica de concurrencia/crash si mantenerla separada reduce fragilidad.
- Modificar `package.json` únicamente para scripts de test HU-E13 si la convención lo requiere.
- Adaptar fixtures/seed sin inventar estados funcionales.

**Dependencias:** F1–F12.

**Gate:** VERIFY completo de §6.

**Riesgo:** simulador MP demasiado permisivo. Mitigación: además del simulador, test unitario de request HTTP inspecciona método, URL, body y header exactos.

**Addendum post-T17:** T17 detectó divergencias contractuales registradas en §9; su estado y consecuencias están en §9.6.

---

## 5. Archivos principales previstos

### Nuevos

- `src/lib/services/ecommerce/reintegro-pedido-web.service.ts`
- `src/lib/services/ecommerce/reintegro-pedido-web.reglas.ts`
- `src/lib/services/ecommerce/mantenimiento-hu-e13.service.ts`
- `src/lib/services/inventario/compensacion-venta.service.ts`
- `src/lib/schemas/reintegro-pedido-web.schema.ts`
- `src/app/api/tienda/mis-pedidos/[id]/cancelar/route.ts`
- `src/app/api/ecommerce/pedidos/[id]/cancelar/route.ts`
- `src/app/api/ecommerce/pedidos/[id]/reintegro/reintentar/route.ts`
- migration HU-E13 y suites unitarias/integración/HTTP correspondientes.

### Modificados

- `prisma/schema.prisma`, `prisma/seed.ts`
- `comprobante-fiscal.service.ts`
- `movimiento.service.ts` solo si se extrae infraestructura común; preferencia por el servicio A nuevo
- `ingreso-tesoreria.service.ts`
- `integraciones/mercadopago/adapter.ts`
- `pago-web.service.ts`, `pick-pack.service.ts`, `retiro-e3.service.ts` si requiere alineación explícita de locks
- `mis-pedidos.service.ts`, schemas E9/Pick & Pack
- mantenimiento/cron existentes
- eventos y listeners F3/D
- componentes/páginas Cliente, Admin y Pick & Pack
- tests de regresión de todos esos componentes.

### No previstos

- cambios a la SPEC congelada;
- nuevos estados B/E;
- nuevo permiso;
- nuevo canal externo de notificación;
- reset de DB o borrado de datos;
- endpoint cron paralelo.

---

## 6. VERIFY obligatorio

La implementación no se considera completa hasta superar, en este orden, todos los gates previos y el siguiente gate final sobre PostgreSQL aislado:

| Área | Evidencia mínima obligatoria |
|---|---|
| Cancelación cliente | propio `PAGO_CONFIRMADO` cancela; ajeno 404; tomado pierde carrera/409; motivo obligatorio |
| Cancelación admin | cancela desde los tres estados; rechaza entregado/terminal; permiso 403 |
| Vencimiento | solo LISTO y `plazo < ahora`; QR nulo; B FACTURADO; actor sistema |
| Recordatorio | ventana de 24 h configurable, clave F3 estable, una notificación, sin columna adicional |
| Stock multi-item | varios SKU/líneas/depósitos; solo faltantes; cantidades exactas; crash entre A y vínculo no duplica |
| NC | total, `NOTA_CREDITO`, vínculo original, una NC HU-E13, original inmutable, otras NC futuras no bloqueadas globalmente |
| G11 | creado/existente/no encontrado; ausencia deja saga pendiente |
| Refund aprobado | intento durable antes de red, header exacto, un `refund_id`, cabecera aprobada |
| Retry técnico | timeout/red/ambiguo conserva hijo y clave; mismo refund al recuperar |
| Rechazo | hijo/cabecera rechazados, sin retry cron, visible y auditado |
| Reintento manual | admin+motivo crea hijo nuevo, preserva rechazo, clave nueva; request repetida no crea otro; prohibido tras aprobado |
| Concurrencia E3/E13 | retiro vs vencimiento/admin cancel: un terminal; QR/stock/refund coherentes |
| Concurrencia E12/E13 | tomar vs cliente cancel: un ganador; admin conserva ventana según estado |
| Idempotencia | retries/crashes no duplican NC, compensaciones, contra-asiento, notificaciones ni refund aprobado |
| Cron | tareas recordatorio/vencimiento/saga aisladas y coexistentes con reservas/cupones/carritos |
| E9 | terminal inactivo visible solo al dueño; QR/datos internos ocultos; legacy sin saga soportado |
| F3/AuditLog | destinatarios, claves, actores y hash-chain; fallos post-commit no revierten dominio |
| E2 | pago aprobado sigue facturando, vendiendo stock, registrando ingreso y encolando una vez; ahora persiste `PAGO_CONFIRMADO` |
| E3 | retiro válido y rechazos vigentes sin regresión |
| E6 | cifrado, acceso y auditoría de pagos sin exposición nueva |
| E12 | cola, prioridad, toma, scans y completar preservados con nueva semántica de toma |
| G11/F1 | suites existentes y nuevas pasan sin ruptura de consumidores |

### Comandos/gates técnicos

Usar los scripts reales del repositorio al implementar y registrar resultados, como mínimo:

1. `npx prisma validate` y generación del cliente.
2. `prisma migrate deploy` + seed en DB vacía.
3. `prisma migrate deploy` sobre snapshot pre-HU-E13 con datos legacy.
4. tests unitarios por bloque inmediatamente después de F2, F3, F4, F5, F6, F7 y F11.
5. suites de integración E2, E3, E6, E9, E12, G11, F1 y HU-E13.
6. tests HTTP/UI HU-E13.
7. lint, typecheck y build completos.
8. corrida real del mantenimiento en DB aislada y verificación de segunda corrida idempotente.

Ningún gate posterior compensa un gate de dominio fallido. Toda falla preexistente debe separarse con evidencia; no se relajan constraints, hooks ni políticas para hacer pasar el pipeline.

---

## 7. Riesgos de implementación y controles

| Riesgo | Control del plan |
|---|---|
| cambio E2/E12 rompe cola | desplegar schema compatible, adaptar servicio+cola+toma en un mismo bloque y ejecutar regresión E2/E12 |
| doble stock por crash | hija E única por item, lock, creación A + vínculo en una transacción y retorno `YA_EXISTENTE` |
| doble refund | intento durable, mismo header en retry técnico, lock cabecera, único intento aprobado, manual solo tras rechazo |
| NC duplicada o bloqueo fiscal futuro | `pedido_venta_id`/`nota_credito_id` únicos en saga y creación B + vínculo en una transacción; vínculo original no único global |
| G11 tardío | saga pendiente y cron; no revertir terminal ni avanzar a F1 |
| deadlock E3/E12/E13 | orden uniforme de locks, transiciones condicionadas y retry DB acotado antes de llamadas externas |
| terminal desaparece de E9 o entra a cola | filtros separados: excepción histórica E9; activos/no terminales en Pick & Pack |
| migration sobre datos legacy | estados B/E intocables, columnas nullable, preflight solo informativo y deploy sobre snapshot; sin reset ni reinterpretación |
| eventos duplicados | emitir por transición durable ganada y claves F3 estables |
| PII/secreto en UI/log | DTO mínimo, errores seguros y tests de ausencia de campos sensibles |

---

## 8. Incompatibilidades reales detectadas

No se detectó una incompatibilidad nueva entre la SPEC Rev.3 y la arquitectura actual que obligue a detener este PLAN. Las diferencias halladas son las brechas de implementación enumeradas en §1 y tienen una ruta aditiva compatible.

Existe un gate de datos previo al despliegue: si aparecen pedidos legacy incoherentes o pedidos pagados sin evidencia suficiente para determinar depósito/cantidad vendida, se reportan y no se corrigen por inferencia. Ningún hallazgo autoriza modificar estados B/E existentes. El bloque afectado vuelve a auditoría de datos sin cambiar la SPEC ni habilitar una decisión funcional unilateral.

Agregar una clave idempotente genérica a `ComprobanteFiscal` o `MovimientoStock` tampoco está aprobado por defecto. Solo si la implementación demuestra una ventana de crash/concurrencia imposible de cerrar mediante las entidades HU-E13 y la transacción compartida, deberá detenerse ese bloque y volver a revisión de schema.

---

## 9. Addendum post-T17 — reconciliación contractual aprobada

Registra las decisiones aprobadas después de T17. Para HU-E13 prevalece sobre los textos de este PLAN que contradice. No modifica máquina de estados, saga de reintegro, T07/T08, T10, T12, T15, T16, permisos, schema ni migrations.

### 9.1. F11 / T09 — destinatarios y prioridad F3

Según SPEC §2.13.16.1:

- `ecommerce:plazo_retiro_por_vencer`, `ecommerce:pedido_cancelado` y `ecommerce:pedido_vencido_sin_retiro` notifican únicamente a la cuenta del Cliente Web operable.
- Ninguna notificación HU-E13 nueva se dirige al rol `ADMINISTRADOR_ECOMMERCE`; la trazabilidad administrativa corresponde al AuditLog y a las vistas administrativas HU-E13.
- `ecommerce:pedido_vencido_sin_retiro` usa prioridad `CRITICA`, según el contrato del Módulo F. Las demás prioridades no cambian.
- Reemplaza, para HU-E13, la frase de F11 «cancelación/vencimiento al Cliente Web y rol Administrador E-commerce».

### 9.2. F10 / F12 / T13–T14 — E9

Según SPEC §2.13.16.2–§2.13.16.3, el contrato Cliente Web E9 agrega:

- `motivo: string | null` = `PedidoVentaEcommerce.deletion_reason`;
- `fecha_terminacion: string | null` = `PedidoVentaEcommerce.deleted_at`;
- `reintegro_estado: "PENDIENTE" | "APROBADO" | "RECHAZADO" | null` = `ReintegroPedidoWeb.estado`, o `null` sin saga;
- `nota_credito: { tipo, fecha_emision, monto } | null`, separado de `comprobante`.

Reglas:

- `motivo` y `fecha_terminacion` son `null` donde no correspondan.
- Se conservan la fecha del pedido y `plazo_retiro_vencimiento`.
- `comprobante` es siempre el comprobante fiscal original; una NC HU-E13 nunca lo reemplaza.
- La lectura individual de comprobante E9 acepta la misma visibilidad histórica `CANCELADO`/`VENCIDO_SIN_RETIRO` que el detalle.
- No se exponen IDs de saga/intento, número de intento, `refund_id`, payment ID, claves, `ultimo_error_codigo`, errores técnicos, G11, actor administrativo ni motivo de reintento manual.

### 9.3. F8 / T11 — respuesta de cancelación Cliente Web

Contrato vigente según SPEC §2.13.16.4: `{ pedido_venta_id, estado_ecommerce: "CANCELADO", reintegro_iniciado: true }`. No expone reintegro, NC, intento, refund, payment ID, clave idempotente ni diagnóstico técnico. La lógica T11 no cambia.

### 9.4. T18 — integridad del AuditLog con escritores multiproceso

T17 reveló que la serialización del ledger (`colaLedger`) es memoria de proceso: escrituras concurrentes desde procesos distintos (servidor y `job:reservas`, o dos procesos Node) pueden leer el mismo `hash_anterior` y bifurcar la cadena SHA-256. La cola en memoria no constituye garantía suficiente.

Solución arquitectónica congelada, sin schema ni migration:

1. cada append al AuditLog corre en su propia transacción PostgreSQL;
2. dentro de ella, primero se adquiere `pg_advisory_xact_lock` con una clave fija dedicada al ledger AuditLog;
3. luego, en la misma transacción: deduplicación idempotente si corresponde, lectura del registro anterior ordenada determinísticamente por `created_at DESC, id DESC`, cálculo SHA-256 e `INSERT` del nuevo asiento;
4. el commit libera automáticamente el advisory lock.

La cola en memoria puede mantenerse como optimización local, pero no es frontera de corrección. La corrección pertenece al servicio central de AuditLog del Módulo D y queda autorizada dentro de T18 exclusivamente para resolver este defecto de concurrencia revelado por HU-E13.

### 9.5. T19 — precondición legacy del seed

- Base vacía: `migrate` + seed normal.
- Snapshot legacy: `migrate deploy`. No ejecutar el seed global mientras exista el desajuste histórico de `permiso.codigo` / UUID: `ecommerce:priorizar_cola` tiene el mismo código y otro UUID, y el seed falla con P2002.
- El snapshot puede requerir configuración dirigida de `ECOMMERCE_RECORDATORIO_RETIRO_HORAS` y el provisionado idempotente del conector F1 mediante sus servicios productivos/de setup aprobados.
- No insertar datos comerciales retroactivos ni alterar permisos legacy durante HU-E13.
- **Riesgo de despliegue:** ejecutar hoy el seed completo sobre una producción que conserve el UUID histórico puede producir P2002. La corrección general del seed queda fuera de HU-E13.

### 9.6. Estado de T17 (F13)

T17 detectó las divergencias de §9.1–§9.3. Sus flujos funcionales PostgreSQL y HTTP pasaron; los resultados históricos de T17 no se modifican. T17 no se considera cerrada hasta aplicar las correcciones documentales y de código de T09, T13 y T14. El AuditLog multiproceso queda como gate de T18 (§9.4) y el seed legacy como precondición de T19 (§9.5).

---

## 10. Registro final de implementación y VERIFY — HU-E13, 08/10/2026

**Estado:** HU-E13 «Cancelación y vencimiento de pedidos pagados» **COMPLETADA — VERIFY PASS**. T00–T19 aprobadas; T20 es este cierre documental. No quedan tareas funcionales abiertas de HU-E13. Las fases §§1–8 son el plan histórico y §9 la reconciliación post-T17; este registro describe lo realmente implementado. La autoridad contractual sigue siendo SPEC §2.13 Rev.3 con sus addenda (retry, T15 y §2.13.16 post-T17).

### 10.1. Recorrido funcional implementado

| Flujo | Estados | Autoridad |
|---|---|---|
| Pago E2 | `PAGO_PENDIENTE → PAGO_CONFIRMADO` (B `RESERVADO → FACTURADO`), ingreso inmediato a la cola Pick & Pack | T10 |
| Pick & Pack E12 | `PAGO_CONFIRMADO` («Pendiente de toma») → toma backend atómica con operador → `EN_PREPARACION` → escaneos/completar → `LISTO_PARA_RETIRO` (QR + plazo) → E3 → `ENTREGADO` | T10, T16 |
| Cancelación Cliente Web | solo `PAGO_CONFIRMADO` → `CANCELADO` | T07, T11 |
| Cancelación Administrador E-commerce | `PAGO_CONFIRMADO`, `EN_PREPARACION` o `LISTO_PARA_RETIRO` → `CANCELADO` | T07, T11 |
| Vencimiento automático | `LISTO_PARA_RETIRO` con `plazo_retiro_vencimiento < ahora` → `VENCIDO_SIN_RETIRO` | T07, T12 |

Terminales E: `CANCELADO`, `VENCIDO_SIN_RETIRO`, `ENTREGADO`. B nunca pasa `FACTURADO → ANULADO`: la reversión es por hechos compensatorios. No se reinterpretan estados legacy. No se puede escanear ni completar antes de `EN_PREPARACION`; los terminales e inactivos quedan fuera de la cola.

### 10.2. Saga de reintegro

0. Bajo locks `PedidoVenta → PedidoVentaEcommerce → PedidoVentaItem`: transición terminal condicionada, QR consumido, baja lógica de la extensión (`is_active = false`, `deleted_at`, `deleted_by`, `deletion_reason = motivo`) e intención durable `ReintegroPedidoWeb(PENDIENTE)` con una `ReintegroStockCompensacion` por línea, en un solo commit.
1. Nota de Crédito total (`NOTA_CREDITO`, `comprobante_original_id` al original inmutable).
2. Compensación de stock `VENDIDO → DISPONIBLE` por línea, depósito y cantidad originales.
3. Contra-asiento G11 (`CREADO | YA_EXISTENTE | INGRESO_ORIGINAL_NO_ENCONTRADO`; la ausencia deja la saga pendiente y recuperable).
4. Intento de refund durable antes de F1 y refund total con `X-Idempotency-Key = HU-E13:REFUND:<pedido>:<payment>:<n>`.
5. Estado final de la cabecera: `PENDIENTE | APROBADO | RECHAZADO`.

Idempotencia garantizada por constraints y locks: una saga por pedido y pago, una NC HU-E13, una compensación por línea, un contra-asiento y como máximo un refund `APROBADO`.

### 10.3. Política de retry

- **Errores técnicos** (`TIMEOUT`, `RED`, `HTTP_429`, `HTTP_5XX`, `RESPUESTA_AMBIGUA`): misma fila, mismo número, misma key; backoff `5, 10, 20, 40, 80, 160, 320, 360, 360…` minutos, sin jitter ni límite.
- **PENDING remoto:** `+15` minutos, mismo intento y key, sin incrementar `intentos_tecnicos`.
- **HTTP 400/401/403/404:** rechazo definitivo, sin retry automático.
- **Reintento manual:** solo tras `RECHAZADO` y sin intento `PENDIENTE`; permiso `ecommerce:cancelar_pedido_pagado`; motivo obligatorio; crea un intento `REINTENTO_MANUAL` nuevo con key nueva y conserva el historial.

### 10.4. F3, E9, administración y AuditLog

- **F3 (§2.13.16.1):** `plazo_retiro_por_vencer`, `pedido_cancelado` y `pedido_vencido_sin_retiro` notifican solo a la cuenta Cliente Web operable; ninguna notificación HU-E13 al rol `ADMINISTRADOR_ECOMMERCE`. Prioridad del vencimiento: `CRITICA`. Idempotencia por `sha256(tipo:clave_origen:destinatario)`.
- **E9 Cliente Web (§2.13.16.2–.3):** pedidos activos propios más `CANCELADO`/`VENCIDO_SIN_RETIRO` históricos propios. El detalle expone `motivo`, `fecha_terminacion`, `reintegro_estado` (`PENDIENTE | APROBADO | RECHAZADO | null`), `comprobante` (siempre la factura original) y `nota_credito` opcional. No expone payment/refund IDs, keys, intentos, errores técnicos ni actores internos. La lectura individual de comprobante acepta la misma visibilidad histórica.
- **Administración (§2.13.15):** `/ecommerce/pedidos/pagados` muestra `PAGO_CONFIRMADO`, `EN_PREPARACION`, `LISTO_PARA_RETIRO`, `CANCELADO` y `VENCIDO_SIN_RETIRO`. `cancelar_pedido` solo en estados cancelables; `reintentar_reintegro` solo con `RECHAZADO` y sin intento pendiente. Autorización por el permiso `ecommerce:cancelar_pedido_pagado`, nunca por nombre de rol. `/ecommerce/pedidos` sigue siendo la pantalla HU-E7 independiente.
- **AuditLog (T18, §9.4):** cada append ejecuta `BEGIN → pg_advisory_xact_lock(clave fija del ledger) → deduplicación si aplica → hash anterior → SHA-256 → INSERT → COMMIT`. El anterior se lee por `created_at DESC, id DESC` y la verificación recorre `created_at ASC, id ASC`; `created_at` se toma bajo el lock y es estrictamente creciente. `colaLedger` quedó solo como optimización local. La integridad se validó con procesos del sistema operativo distintos.

### 10.5. Formato de fechas (corrección de hydration en T19)

La inspección visual detectó un hydration mismatch en fechas: `Intl.DateTimeFormat`/`toLocaleString` sin `timeZone` y con `dateStyle`/`timeStyle` dependían de la zona y del ICU de cada runtime. Se centralizó en `src/lib/utils/fecha-negocio.ts` (`formatearFechaNegocio`, `formatearFechaHoraNegocio`): es-AR, zona de negocio `America/Argentina/Buenos_Aires`, 24 h y texto armado desde partes numéricas, con formato `dd/mm/aaaa` y `dd/mm/aaaa HH:mm`. Se aplica en Mis pedidos (listado y detalle), Pedidos pagados y Pick & Pack. No se usó `suppressHydrationWarning`, `useEffect` para ocultar fechas ni `ssr:false`.

### 10.6. Legacy y seed

- La migración `20261008120000_hu_e13_reintegros` es aditiva: sin backfill, sin reinterpretación de estados B/E y sin `TransaccionPagoLog` retroactivo. Se verificó sobre el snapshot pre-HU-E13 con los 114 pedidos idénticos antes y después.
- El legacy pagado solo opera por fallback con evidencia durable completa; la evidencia contradictoria rechaza sin efectos. Los pedidos legacy con evidencia inconsistente (p. ej. `EVIDENCIA_STOCK_INCONSISTENTE`) seguirán reportando un error en cada pasada del mantenimiento hasta su revisión manual; no se corrigen automáticamente.
- **Seed:** en base vacía se usa el seed normal. En una base legacy se aplica `migrate deploy` más configuración dirigida (`ECOMMERCE_RECORDATORIO_RETIRO_HORAS` y conector F1 por sus servicios); **no** se ejecuta el seed global mientras `ecommerce:priorizar_cola` conserve el mismo código con un UUID histórico distinto (P2002). La corrección del seed queda fuera de HU-E13.

### 10.7. Evidencia VERIFY T19

| Gate | Resultado |
|---|---|
| Base fresca `swat_erp_test_e13_t19` (migrate + seed, seed repetido sin duplicados) | PASS: 37 suites de integración/HTTP, incluido el gate multiproceso T18 (19/19) |
| Clon del snapshot legacy `swat_erp_test_e13_t00` | PASS: T17 servicio 12, T18 19, T07 20, T12 9; estados legacy sin cambios |
| Migraciones | 33 aplicadas, sin pendientes; HU-E13 exactamente una vez, en ambas bases |
| D17 (§2.13.13) | PASS en todas las filas: E2, E3, E6, E9, E12, A, B, G11, F1, F3, D, HTTP/RBAC y crash recovery |
| AuditLog | Íntegro antes y después en ambas bases; verificadores central, A y B coinciden; 0 empates de `created_at` |
| T17 / T18 | PASS (T17 servicio 12, HTTP 10; T18 19) |
| E9 dedicada (`hu_e9_test` descartable) | 1/1 PASS |
| `npm test` al cierre | 809 tests: 806 PASS / 3 FAIL de baseline preexistente (`notificacion.service.test.ts:93`, `pedido-venta.service.test.ts:151` y `:157`) |
| Unitarios focales HU-E13 · componentes T14/T15/T16 · E3 con flag | 93 · 42 + 4 · 6 PASS |
| `tsc --noEmit` · ESLint · `next build` | 0 errores · 0 errores (4 advertencias preexistentes) · PASS |
| UI manual | Inspección visual en desktop y móvil e hydration de fechas revalidada, según la revisión humana de T19 |

Los conteos incluyen el test contenedor de cada suite. Durante la inspección visual también se detectó que la base local de trabajo tenía 29/33 migraciones; se resolvió operativamente con backup y `migrate deploy`, sin cambio de código.

### 10.8. R1–R22

La SPEC Rev.3 declara «Conserva D1–D17 y R1–R22», pero ningún documento del repositorio enumera R1–R22; solo se citan R1, R2, R6, R9 y R15. No se reconstruyeron los faltantes. T19 verificó D17 completo, los R identificables, la matriz completa de criterios HU-E13 y todos los gates obligatorios de T19. Se clasifica como **deuda documental preexistente, no defecto funcional de HU-E13**.

### 10.9. Despliegue

**Pre-deploy:** backup; `verificarCadenaIntegridad()` y conteo de empates históricos de `created_at` en el ledger real; `migrate deploy`; `migrate status` sin pendientes; no ejecutar el seed global sobre producción legacy; configurar `ECOMMERCE_PLAZO_RETIRO_DIAS`, `ECOMMERCE_RECORDATORIO_RETIRO_HORAS`, `CRON_SECRET` y F1/Mercado Pago; desplegar el servidor y `job:reservas` con el mismo código (T18).

**Post-deploy:** `migrate status`; login y RBAC; smoke de pago; Pick & Pack; Mis pedidos; Pedidos pagados; cron sin secreto → 401; cadena de AuditLog íntegra.

### 10.10. Herramienta local de datos visuales

`scripts/hu-e13-datos-visuales.ts` es una utilidad **solo de desarrollo**, no productiva: genera una cuenta Cliente Web demo y 8 pedidos (`PAGO_CONFIRMADO`, `EN_PREPARACION`, `LISTO_PARA_RETIRO`, cancelados con reintegro `PENDIENTE`/`APROBADO`/`RECHAZADO` y un vencido) recorriendo los servicios reales, sin Mercado Pago real (inyección en las fronteras E2/F1 y simulador local). Uso, solo contra PostgreSQL local y nunca con `NODE_ENV=production`:

```bash
node --conditions=react-server --import tsx scripts/hu-e13-datos-visuales.ts --confirmar
```

Las credenciales de la cuenta demo las imprime el script en la ejecución local; no se documentan aquí.

### 10.11. Riesgos y deuda fuera de HU-E13 (sin resolver)

1. Seed global sobre legacy: P2002 por el UUID histórico de `ecommerce:priorizar_cola`.
2. Los verificadores de cadena de Módulos A (`inventario/auditoria.service.ts`) y B (`ventas/auditoria-ventas.service.ts`) todavía ordenan solo por `created_at`; hoy coinciden con el central.
3. `pick-pack.audit.integration.test.ts` espera con una heurística de 100 ms sensible al timing.
4. `RetiroPedidoPanel.test.tsx` requiere `--experimental-test-module-mocks`.
5. La suite E9 dedicada exige una base `hu_e9_test` migrada al día.
6. Los pedidos legacy con evidencia inconsistente requieren revisión manual.
7. Fechas potencialmente no deterministas fuera de HU-E13: `PedidosWebAdmin.tsx`, `CuentasWebCliente.tsx`, `CuponesCliente.tsx`.
8. El cron sin `CRON_SECRET` en development conserva el acceso previo; en producción falla cerrado.

### 10.12. Archivos de HU-E13

| Capa | Archivos |
|---|---|
| Persistencia | `prisma/schema.prisma`; `prisma/migrations/20261008120000_hu_e13_reintegros/`; `prisma/seed.ts` (configuración del recordatorio) |
| B / A / G / F | `ventas/comprobante-fiscal.service.ts`; `inventario/compensacion-venta.service.ts`; `tesoreria/ingreso-tesoreria.service.ts`; `integraciones/mercadopago/adapter.ts` |
| Saga y mantenimiento | `ecommerce/reintegro-pedido-web.service.ts`, `reintegro-refund.service.ts`, `mantenimiento-hu-e13.service.ts`, `mantenimiento-programado.ts`; `app/api/cron/check-pruebas-vencidas/route.ts`; `scripts/liberar-reservas-vencidas.ts` |
| E2 / E12 / E9 / T15 | `pago-web.service.ts`, `pick-pack.service.ts`, `mis-pedidos.service.ts`, `pedidos-pagados-admin.service.ts` |
| HTTP y schemas | `api/tienda/mis-pedidos/[id]/cancelar`, `api/ecommerce/pedidos/[id]/cancelar`, `api/ecommerce/pedidos/[id]/reintegro/reintentar`; `schemas/reintegro-pedido-web.schema.ts`; `auth/permisos-ecommerce.ts` |
| Eventos y D | `events/event-types.ts`, `listeners/audit-log.listener.ts`, `listeners/notificacion.listener.ts`, `auditoria/audit-log.service.ts` |
| UI | `CancelarPedidoWeb.tsx`, `DetallePedidoWeb.tsx`, `MisPedidosListado.tsx`, `PedidosPagadosAdmin.tsx` + `app/(dashboard)/ecommerce/pedidos/pagados/`, `ConsolaPickPack.tsx`, `PreparacionPedidoPanel.tsx`, `pick-pack-client.ts`, `layout/Sidebar.tsx`, `lib/ecommerce/cancelacion-pedido-web.client.ts`, `lib/utils/fecha-negocio.ts` |
| Pruebas | Suites unitarias, de integración y HTTP de T03–T18 (`*.e13.integration.test.ts`, `hu-e13*.test.ts`, `reintegro-*.test.ts`, `mantenimiento-hu-e13`, `pedidos-pagados-admin`, `compensacion-venta`, `hu-e13.concurrencia.*`, `audit-log.service.test.ts`, componentes) y adaptaciones de regresión E2/E3/E4/E7/E9/E12/F3 |
| Herramienta dev | `scripts/hu-e13-datos-visuales.ts` |

Las rutas abreviadas cuelgan de `src/lib/services/`, `src/app/` o `src/components/ecommerce/` según su capa.

---

**HU-E13 PLAN REV2 LISTO PARA AUDITORÍA**

**STOP.**
