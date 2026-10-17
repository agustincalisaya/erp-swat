# SDD — HU-E3: Tasks de implementación de retiro validado

> **Estado al 07/10/2026:** T1–T11 ejecutadas y aprobadas; T12 documentada y pendiente de revisión humana. Las precondiciones y expresiones «pendiente/futura» que siguen son el registro histórico de cómo se autorizó cada task, no el estado actual. La evidencia final está en §7 y en `HU3_MODULO_E.md` §11.

## Estado SDD y alcance

- Discovery aprobado; SPEC aprobada en `docs/specs/spec_modulo_E.md`, **Revisión 9 — HU-E3** (conserva Revisiones 7 y 8); PLAN aprobado en `docs/modulos/modulo E/HU3_MODULO_E.md`.
- Este documento define el backlog ejecutable **T1–T12**. Ninguna task de implementación está autorizada todavía. Estado inicial de todas: **pendiente**.
- Autoridad: SPEC Rev.9 y §2.3.a–e → PLAN aprobado → código existente solo para paths y patrones. Los pasajes históricos de §2.12 y §4 sustituidos por Rev.7 no gobiernan E3.
- Cada task requiere autorización individual. Tras ejecutarla: pruebas y verificaciones de esa task → reporte de cambios, resultados y riesgos → **STOP** → revisión humana → autorización explícita de la siguiente. Aprobar este documento no autoriza T1.
- Las rutas nuevas son nombres propuestos conforme a las rutas reales; los únicos archivos modificables en una task son los enumerados en su sección. Una necesidad fuera de esa lista exige **STOP** antes de editar.

## 1. Contratos congelados

| Área | Regla |
|---|---|
| Entrada | `POST /api/ecommerce/preparacion/validar-retiro`; permiso `ecommerce:validar_retiro_qr`; body Zod estricto `{ qr_token, dni }`. Token `trim`, 1–128 caracteres sin regex base64url rígida; DNI `trim`, 7–8 dígitos. El QR único identifica exactamente un pedido. |
| Autorización del retiro | QR vigente + DNI del `Cliente` titular + pedido WEB, extensión y Cliente activos/no eliminados. La baja de `CuentaClienteWeb` no impide el retiro físico. |
| Exclusión pública | `400 VALIDATION_ERROR`, `401 UNAUTHORIZED`, `403 FORBIDDEN`, `422 RETIRO_NO_VALIDO` uniforme y `500 INTERNAL_ERROR`; sin `409` ni eco de QR/DNI. `200 { data: { pedido_venta_id, numero, estado: "ENTREGADO" }, error: null }`; `Cache-Control: no-store`. |
| Transacción | Prelectura mínima por token, luego locks `PedidoVenta → PedidoVentaEcommerce → PedidoVentaItem` activos ordenados por `(created_at, id)`; después bloquear `Cliente`. Releer y validar bajo lock, capturar reloj del plazo después de adquirirlos. |
| B y E | Helper B `registrarEntregaTotalPedidoVentaTx(tx, pedidoVentaId)`, sin `actorId`: cantidades completas y `FACTURADO → REMITO_EMITIDO → CERRADO`. En el mismo commit E pasa `LISTO_PARA_RETIRO → ENTREGADO` y `codigo_qr_retiro = null`; conservar plazo y metadatos ajenos. Segundo uso: rechazo, nunca éxito idempotente. |
| Eventos D | `ecommerce:pedido_entregado` post-commit una vez; `ecommerce:retiro_rechazado` para rechazo de negocio, con IDs opcionales de pedido/extensión solo si la resolución fue segura. AuditLog usa `pedidos_venta_ecommerce` y `registro_id = pedido_venta_ecommerce_id` o `null` si no hubo extensión. Sin QR, DNI, email ni pago. |
| F3 | E12 conserva `LISTO` y emite `ecommerce:pedido_listo_para_retiro`. Solo cuenta web activa/no eliminada es destinataria; cuenta ausente/inactiva no revierte LISTO ni su auditoría. `clave_origen = evento_id`, `{ numero_venta }` solo plantilla, prioridad `INFORMATIVA`, notificación interna única por ocurrencia y destinatario. Sin aviso de `ENTREGADO`, email o WhatsApp. |
| Límites | E13 conserva vencimiento/cancelación/reintegro; E3 solo verifica plazo. E9 y E2 se invocan en integración sin cambiar sus servicios/DTO. Sin `schema.prisma`, migraciones, seed, Remito nuevo, fecha/operador de entrega o clave de idempotencia nueva. |

## 2. Dependencias y decisión de corte

```text
T1,T2,T3 → T4 → T5 → T6 (eventos y AuditLog) → T7 (HTTP)
                  T2,T6 → T8 (F3)
                  T7,T8 → T9 (UI)
                  T6,T8,T9 → T10 → T11 → T12
```

- Grafo preciso: `T1,T2,T3 → T4`; `T4 → T5`; `T2,T5 → T6` (eventos/auditoría); `T6 → T7` (HTTP/RBAC); `T2,T6 → T8` (F3); `T7,T8 → T9` (UI); `T6,T8,T9 → T10`; `T10 → T11`; `T11 → T12`. El endpoint de T7 solo se publica después de que T6 haya hecho obligatoria la trazabilidad E3 post-commit. Aunque haya dependencias funcionales paralelas, la ejecución y aprobación son **una task por vez**, en orden T1–T12.
- **Corte transitorio T2/T8:** T2 amplía de modo transitorio el tipo de `pedido_listo_para_retiro` con campos opcionales compatibles; T8 vuelve obligatorios `numero_venta` y `cliente_web_cuenta_id: string | null` mientras adapta el emisor E12. Hoy `completarPreparacion` construye un literal tipado sin esos campos: exigirlos en T2 rompería el typecheck y forzaría modificar E12 fuera de T2. El contrato final es el de SPEC; el tipo transitorio no habilita un listener F3 ni representa cierre de la integración. Si este corte no permite compilar sin cambiar E12/listeners, **STOP** y revisión humana, sin adaptación implícita.
- T4 aísla resolución, locks y validación en un núcleo reutilizado por T5. T4 no deja una operación pública de entrega parcial; T5 completa la misma orquestación. Si al implementarlo esa separación exige arquitectura artificial, **STOP** para revisar el corte antes de combinar tasks.

## 3. Tabla resumida T1–T12

| Task | Resultado revisable | Dependencia | Riesgo principal |
|---|---|---|---|
| T1 | Schema Zod y tests | TASKS aprobadas y autorización T1 | Eco de entrada inválida |
| T2 | Tipos E3 y ampliación transitoria LISTO | T1 aprobada | Emisor E12 tipado |
| T3 | Helper transaccional B y tests | T2 aprobada | Estado/cantidades B |
| T4 | Núcleo E3 de resolución/validación y tests | T1–T3 aprobadas | Locks y datos sensibles |
| T5 | Entrega B/E atómica y concurrencia | T4 aprobada | Doble entrega |
| T6 | Eventos E3 y AuditLog D | T2,T5 aprobadas | Emisión post-commit |
| T7 | HTTP/RBAC y tests | T6 aprobada | Oráculo/errores |
| T8 | Payload E12 completo y aviso F3 | T2,T6 aprobadas; T7 aprobada por orden de ejecución | Cuenta operable/idempotencia |
| T9 | Retiro en consola existente, tests y gate visual | T7,T8 aprobadas | Exposición en navegador |
| T10 | Integración real E8→E1→E2→E12→F3→E9→E3 | T6,T8,T9 aprobadas; T7 aprobada por orden de ejecución | Fixtures y flujo real |
| T11 | Verify integral y seguridad | T10 aprobada | Regresiones/filtraciones |
| T12 | Evidencia y cierre documental | T11 aprobada | Divergencia documental |

## 4. Tasks ejecutables

### T1 — Schema Zod E3

**Objetivo:** publicar la validación y normalización de entrada de retiro, con pruebas unitarias focalizadas.

**Precondiciones:** este documento aprobado y autorización expresa de T1; ninguna implementación previa E3.

**Archivos autorizados:** nuevos `src/lib/schemas/retiro-e3.schema.ts`, `src/lib/schemas/retiro-e3.schema.test.ts`.

**Archivos solo lectura/reutilización:** `src/lib/schemas/pick-pack.schema.ts`, `src/lib/schemas/pick-pack.schema.test.ts`, SPEC §2.3.b.

**Cambios permitidos:** `ValidarRetiroSchema` como objeto `.strict()` con `qr_token: z.string().trim().min(1).max(128)` y `dni: z.string().trim().regex(/^\d{7,8}$/)`; tipos inferidos; mensajes sin valor recibido.

**Cambios prohibidos:** endpoint, servicio, eventos, DNI persistido, regex restrictiva para base64url o campos de identidad/estado ajenos.

**Contrato aplicable:** body solo `{ qr_token, dni }`; el formato de DNI no sustituye la comparación con `Cliente.dni`.

**Tests obligatorios:** QR vacío/espacios/límites 1 y 128/exceso; token formalmente válido sin exigir base64url; DNI trim de 7/8, longitudes inválidas, letras y puntuación; campos faltantes/extra y objeto raíz inválido.

**Verificación:** suite de schema, typecheck si el entorno lo permite, lint focalizado, inspección de mensajes/`fieldErrors`, `git diff --check` y reporte de archivos.

**Criterio DONE:** entradas aceptadas/rechazadas conforme SPEC, output normalizado y ninguna respuesta de prueba ecoa QR/DNI.

**STOP obligatorio:** reportar pruebas, cambios y riesgos; no comenzar T2 sin revisión y autorización.

### T2 — Tipos de eventos HU-E3

**Objetivo:** tipar los dos eventos E3 y preparar la extensión del evento LISTO sin tocar su productor todavía.

**Precondiciones:** T1 aprobada y autorización expresa de T2.

**Archivos autorizados:** modificables `src/lib/events/event-types.ts`, `src/lib/events/event-types.test.ts`.

**Archivos solo lectura/reutilización:** `src/lib/services/ecommerce/pick-pack.service.ts`, `src/lib/events/domain-event-bus.ts`, SPEC §2.3.d, PLAN §5.

**Cambios permitidos:** declarar `ecommerce:pedido_entregado` con `evento_id`, ambos IDs, `actor_id`, estados E y `timestamp`; `ecommerce:retiro_rechazado` con motivo técnico acotado `TOKEN_NO_RESUELTO | PEDIDO_NO_OPERABLE | ESTADO_NO_LISTO | PLAZO_VENCIDO | DNI_NO_COINCIDE | CLIENTE_NO_OPERABLE`, `evento_id`, `actor_id`, `timestamp` y ambos IDs opcionales. Incluirlos en el mapa/lista de eventos. Ampliar `EcommercePedidoListoParaRetiroPayload` **transitoriamente** con `cliente_web_cuenta_id?: string | null` y `numero_venta?: string`; T8 los hará contractualmente obligatorios junto con el productor.

**Cambios prohibidos:** modificar E12, listeners, servicio E3, emisión de eventos o payloads con token/DNI/email/pago. Si compilar obliga cambiar productor/listener, **STOP** antes de hacerlo.

**Contrato aplicable:** los dos IDs del rechazo viajan juntos solo tras resolución segura; sin extensión se omiten ambos. El payload final LISTO tendrá `cliente_web_cuenta_id: string | null`, `numero_venta` y `evento_id` existente.

**Tests obligatorios:** aserciones de tipos/mapa y nombres del bus; comprobación de que el evento de rechazo admite ausencia de ambos IDs y que no se introducen campos sensibles.

**Verificación:** tests de event-types, typecheck completo, lint focalizado, `git diff --check`, búsqueda de payloads sensibles.

**Criterio DONE:** tipos E3 compilan y son utilizables; emisión E12 actual sigue compilando sin modificación; la promoción final de LISTO queda expresamente pendiente para T8.

**STOP obligatorio:** reportar la deuda de tipo transitorio y resultados; no comenzar T3 sin aprobación.

### T3 — Helper transaccional de entrega total Módulo B

**Objetivo:** añadir una operación B reutilizable que cierre una venta WEB facturada con entrega total usando el `TransactionClient` del llamador.

**Precondiciones:** T2 aprobada y autorización expresa de T3; revisar convenciones B existentes.

**Archivos autorizados:** modificables `src/lib/services/ventas/pedido-venta.service.ts`, `src/lib/services/ventas/pedido-venta.service.test.ts`, `src/lib/services/ventas/pedido-venta.integration.test.ts`.

**Archivos solo lectura/reutilización:** `src/lib/services/ecommerce/pick-pack.service.ts` (orden de locks), `src/lib/services/ventas/pedido-venta.http.integration.test.ts`, SPEC §2.3.c, PLAN §3.

**Cambios permitidos:** helper orientativo `registrarEntregaTotalPedidoVentaTx(tx, pedidoVentaId)`; exigir venta WEB activa/no eliminada en `FACTURADO`, ítems activos/no eliminados existentes, `cantidad_facturada = cantidad`, `cantidad_entregada = 0` y ausencia de sobreentrega; actualizar cada `cantidad_entregada` hasta lo facturado y recorrer `FACTURADO → REMITO_EMITIDO → CERRADO` en el mismo `tx`, respetando locks previos.

**Cambios prohibidos:** `actorId` sin necesidad demostrada (si surge, STOP), transacción/commit propios, eventos/auditoría E3, mutación E, stock, pagos, comprobante adicional, entidad Remito o wrapper HTTP.

**Contrato aplicable:** B posee estados y contadores de venta; fallo del helper debe permitir rollback conjunto al ser invocado por E3.

**Tests obligatorios:** caso completo facturado; cantidad exacta de todos los ítems; venta no WEB/inactiva/eliminada/estado incorrecto; cero ítems; ítem inactivo o cantidad incoherente/entregada previamente; fallo intermedio con rollback en PostgreSQL dedicado.

**Verificación:** suites B focalizadas e integración DB, typecheck, lint focalizado, `git diff --check`, revisión de ausencia de efectos de stock/pago/eventos.

**Criterio DONE:** helper recibe solo `tx` e ID, deja B `CERRADO` y cantidades completas en caso válido; toda inconsistencia impide cierre y revierte escrituras.

**STOP obligatorio:** reportar resultados y cualquier tensión con dominio B; no comenzar T4 sin aprobación.

### T4 — Servicio E3: resolución, locks y validaciones

**Objetivo:** construir el núcleo server-only que resuelve por QR y verifica el agregado bajo locks, todavía sin entregar.

**Precondiciones:** T1–T3 aprobadas y autorización expresa de T4.

**Archivos autorizados:** nuevos `src/lib/services/ecommerce/retiro-e3.service.ts`, `src/lib/services/ecommerce/retiro-e3.service.test.ts`; nuevo `src/lib/services/ecommerce/retiro-e3.validation.integration.test.ts` si los locks requieren PostgreSQL real.

**Archivos solo lectura/reutilización:** `src/lib/services/ecommerce/pick-pack.service.ts`, `src/lib/services/ventas/pedido-venta.service.ts`, `src/lib/schemas/retiro-e3.schema.ts`, `src/lib/errors/service-error.ts`, SPEC §2.3.c, PLAN §2.

**Cambios permitidos:** prelectura mínima de `PedidoVentaEcommerce.codigo_qr_retiro` para obtener `pedido_venta_id` sin autorizar; iniciar `tx`; locks `PedidoVenta → PedidoVentaEcommerce → PedidoVentaItem` activos ordenados `(created_at,id)` y después `Cliente`; relectura y validación de canal WEB, flags de baja, B `FACTURADO`, E `LISTO_PARA_RETIRO`, token coincidente, plazo nulo/vigente con reloj capturado tras locks, Cliente operativo, DNI coincidente e ítems coherentes. Mantener datos sensibles dentro del servicio. El núcleo de validación debe poder ser invocado por la orquestación de T5 sin reabrir una transacción o invertir locks.

**Cambios prohibidos:** escribir B/E, consumir QR, emitir eventos, HTTP, UI, F3, cambios E13 o consulta a `CuentaClienteWeb` como precondición de retiro.

**Contrato aplicable:** QR determina pedido; mismo titular con dos pedidos no es ambiguo; rechazo externo futuro uniforme y anomalía interna diferenciada sin filtrar secretos.

**Tests obligatorios:** prelectura inexistente; QR de A/B del mismo titular resuelve exactamente el indicado; otro titular/DNI distinto; estados no listos, plazo vencido, bajas lógicas de pedido/extensión/Cliente y cuenta web inactiva permitida; ítems inexistentes o incoherentes; orden de locks/relectura. No afirmar una entrega exitosa antes de T5.

**Verificación:** tests focalizados y DB si aplica, typecheck, lint, `git diff --check`, inspección de selects y de que no hay mutaciones.

**Criterio DONE:** núcleo reutilizable verificado bajo locks y sin efecto comercial. Si T4/T5 no pueden separarse limpiamente, STOP para revisión del corte.

**STOP obligatorio:** reportar evidencia de locks/validaciones; no comenzar T5 sin aprobación.

### T5 — Servicio E3: entrega atómica y concurrencia

**Objetivo:** completar la orquestación transaccional B/E y consumir el QR una sola vez.

**Precondiciones:** T4 aprobada y autorización expresa de T5.

**Archivos autorizados:** modificables `src/lib/services/ecommerce/retiro-e3.service.ts`, `src/lib/services/ecommerce/retiro-e3.service.test.ts`, `src/lib/services/ecommerce/retiro-e3.validation.integration.test.ts` si fue creado; nuevo `src/lib/services/ecommerce/retiro-e3.integration.test.ts` y nuevo `src/lib/services/ecommerce/retiro-e3.concurrency.integration.test.ts`.

**Archivos solo lectura/reutilización:** `src/lib/services/ventas/pedido-venta.service.ts`, `src/lib/services/ecommerce/pick-pack.service.ts`, SPEC §2.3.c, PLAN §2–3.

**Cambios permitidos:** servicio `validarYEntregarRetiro` o nombre coherente; invocar núcleo T4 y helper B en el mismo `tx`; transición E condicional por estado/token a `ENTREGADO`, `codigo_qr_retiro = null`, comprobar exactamente una fila; conservar plazo/fecha de pago/operador de preparación/prioridad; commit único. Rechazo sin mutación y sin éxito idempotente. Preparar resultado interno mínimo para eventos T6 sin emitirlos todavía.

**Cambios prohibidos:** endpoint, auditoría/listeners, F3, UI, lógica E13, segunda transacción/commit, mutar pago/stock/QR de E12 o persistencia nueva.

**Contrato aplicable:** B `CERRADO` con cantidades completas y E `ENTREGADO` con QR nulo son indivisibles. Primera operación bajo locks gana; segundo uso, doble click y otro operador rechazan. Incompatibilidad futura con E13 se prueba sin implementarlo.

**Tests obligatorios:** éxito y estado B/E/cantidades/plazo preservado; DNI incorrecto, token inexistente, estado no listo, vencido, soft delete y Cliente inválido sin mutaciones; mismo titular con varios pedidos; otro titular; reuso; rollback si helper B o actualización E falla; dos operadores y doble request concurrentes, exactamente un éxito; mutador incompatible simulado con mismo orden de locks.

**Verificación:** suites servicio/DB/concurrencia en PostgreSQL dedicado, typecheck, lint, `git diff --check`, inspección de único commit y ausencia de QR en resultado.

**Criterio DONE:** una sola entrega B/E bajo competencia, segundo request rechazado; sin evento E3 aún, explícitamente pendiente de T6. No existe endpoint HTTP E3 en esta etapa.

**STOP obligatorio:** reportar resultados y límites de la simulación E13; no comenzar T6 sin aprobación.

### T6 — Eventos E3 y auditoría Módulo D

**Objetivo:** publicar resultados E3 fuera de la transacción y registrar éxito/rechazo en AuditLog.

**Precondiciones:** T2 y T5 aprobadas; autorización expresa de T6. El endpoint HTTP E3 aún no existe.

**Archivos autorizados:** modificables `src/lib/services/ecommerce/retiro-e3.service.ts`, `src/lib/events/listeners/audit-log.listener.ts`, `src/lib/events/listeners/audit-log.listener.test.ts`; nuevos `src/lib/services/ecommerce/retiro-e3.eventos.test.ts`, `src/lib/services/ecommerce/retiro-e3.audit.integration.test.ts` si la cobertura existente no basta.

**Archivos solo lectura/reutilización:** `src/lib/events/event-types.ts`, `src/lib/events/domain-event-bus.ts`, `src/lib/services/ecommerce/pick-pack.eventos.test.ts`, `src/lib/services/ecommerce/pick-pack.audit.integration.test.ts`, SPEC §2.3.d, PLAN §5.

**Cambios permitidos:** un `ecommerce:pedido_entregado` después de commit exitoso, sin emisión en rollback; `ecommerce:retiro_rechazado` fuera de la transacción fallida para rechazos de negocio, incluido token inexistente. IDs opcionales juntos solo si resolución segura, sin búsquedas posteriores para completarlos. Listener D: éxito en `pedidos_venta_ecommerce` / extensión, `valor_anterior` E `LISTO_PARA_RETIRO` y B `FACTURADO`, `valor_nuevo` E `ENTREGADO`, B `CERRADO`, `qr_consumido: true`, `entrega_total: true`; rechazo en la misma tabla con `registro_id` extensión o `null`, motivo enum, actor/hora.

**Cambios prohibidos:** crear endpoint HTTP E3, segundo evento B, evento de éxito ante fallo, notificación F3 de ENTREGADO, token/DNI/email/pago en payload/AuditLog/logs, cambios al contrato HTTP o al payload LISTO.

**Contrato aplicable:** `actor_id` reside en E3, no en helper B; emisión post-commit mediante patrón del bus existente, que no es durable. Un fallo del listener no revierte B/E.

**Tests obligatorios:** exactamente un evento/asiento de entrega por éxito; cero en rollback; rechazo con extensión resuelta usa ID de extensión, token no resuelto usa `registro_id = null`; motivos acotados; no persistencia de datos sensibles; listener fallido no duplica entrega ni convierte rechazo en éxito.

**Verificación:** suites de eventos y AuditLog con DB cuando corresponda, typecheck, lint, `git diff --check`, inspección de payloads y búsqueda de secretos.

**Criterio DONE:** servicio E3 emite trazabilidad post-commit de actor/hora y efectos B/E conforme PLAN, sin segunda entrega ni datos sensibles; el endpoint HTTP aún no existe.

**STOP obligatorio:** reportar auditoría y riesgos del bus post-commit; no comenzar T7 (HTTP/RBAC) sin aprobación.

### T7 — HTTP y RBAC de retiro

**Objetivo:** exponer E3 mediante un Route Handler fino y seguro.

**Precondiciones:** T6 (eventos E3 y AuditLog) aprobada y autorización expresa de T7. No exponer la ruta mientras el servicio no emita `ecommerce:pedido_entregado` post-commit.

**Archivos autorizados:** nuevo `src/app/api/ecommerce/preparacion/validar-retiro/route.ts`; nuevo `src/lib/services/ecommerce/hu-e3.http.integration.test.ts`; nuevo `src/app/api/ecommerce/preparacion/validar-retiro/error-mapper.ts` solo si el patrón de respuesta lo justifica y se revisa dentro de T7.

**Archivos solo lectura/reutilización:** `src/lib/auth/with-permission.ts`, `src/app/api/ecommerce/preparacion/[pedidoVentaId]/completar/route.ts`, `src/app/api/ecommerce/preparacion/[pedidoVentaId]/error-mapper.ts`, schema T1 y servicio T5.

**Cambios permitidos:** `withPermission("ecommerce:validar_retiro_qr")`; actor desde `session.userId`; parseo JSON y Zod estricto; mapear 400/401/403/422/500 sin oráculo; éxito `200` mínimo y `Cache-Control: no-store` en toda respuesta de esta operación, incluidos errores.

**Cambios prohibidos:** IDs, actor, estado o plazo desde body/query/path; autorizar por rol; `409`; devolver token/DNI/Cliente/pago; modificar auth global o E12.

**Contrato aplicable:** `422 RETIRO_NO_VALIDO` con mensaje «No fue posible validar el retiro» para todos los rechazos de negocio, incluso QR consumido; inconsistencia B/E es `500 INTERNAL_ERROR` seguro.

**Tests obligatorios:** JSON inválido/campos extra/formatos 400; sin sesión 401, sin permiso 403 y permiso correcto 200; QR inexistente, usado, DNI incorrecto, estado/plazo/soft delete 422 con mismo cuerpo; inconsistencia 500; body de éxito exacto; header no-store; ausencia de QR/DNI/PII en todas las respuestas.

**Verificación:** HTTP/RBAC focalizado, typecheck, lint, `git diff --check`, inspección de mapper y búsqueda de eco de body.

**Criterio DONE:** ruta expone exactamente contrato aprobado y delega al servicio ya auditado en T6; ningún rechazo sensible permite inferir la causa.

**STOP obligatorio:** reportar HTTP, permiso y archivos; no comenzar T8 sin aprobación.

### T8 — Integración F3 para LISTO_PARA_RETIRO

**Objetivo:** completar la notificación interna al titular web cuando E12 deja el pedido listo.

**Precondiciones:** T2 y T6 aprobadas; T7 aprobado por la secuencia de ejecución; autorización expresa de T8.

**Archivos autorizados:** modificables `src/lib/events/event-types.ts`, `src/lib/events/event-types.test.ts`, `src/lib/services/ecommerce/pick-pack.service.ts`, `src/lib/services/ecommerce/pick-pack.eventos.test.ts`, `src/lib/services/ecommerce/pick-pack.audit.integration.test.ts`, `src/lib/events/listeners/notificacion.listener.ts`; nuevo `src/lib/events/listeners/notificacion.listener.e3.test.ts`.

**Archivos solo lectura/reutilización:** `src/lib/services/notificaciones/notificacion.service.ts`, `src/lib/events/listeners/audit-log.listener.ts`, `src/lib/services/ecommerce/pick-pack.integration.test.ts`, SPEC §2.3.d, PLAN §5.

**Cambios permitidos:** en `completarPreparacion`, resolver dentro de su transacción `numero_venta` y cuenta vinculada con `CuentaClienteWeb.is_active = true`, `deleted_at = null`; emitir payload post-commit con `cliente_web_cuenta_id: string | null`, `numero_venta` y `evento_id` ya existente. En T8 hacer **obligatorios** esos campos del tipo LISTO. Si no hay cuenta operable, `cliente_web_cuenta_id: null`, mantener LISTO/auditoría y omitir destinatario F3. Suscribir solo `ecommerce:pedido_listo_para_retiro` en `notificacion.listener.ts`: prioridad `INFORMATIVA`, `cuenta_cliente_web_ids`, `clave_origen = evento_id`, variables `{ numero_venta }`.

**Cambios prohibidos:** alterar generación QR/plazo, usar `pedido_venta_id` o `numero_venta` como `clave_origen`, agregar token al evento, bloquear LISTO por cuenta inactiva, tocar seed/plantilla, WhatsApp/email o notificación de ENTREGADO.

**Contrato aplicable:** misma ocurrencia + destinatario produce una fila de `Notificacion`; cuenta web dada de baja no pierde derecho de retiro físico. El listener es post-commit; falla F3 no revierte LISTO.

**Tests obligatorios:** actualizar `event-types.test.ts` para demostrar que `cliente_web_cuenta_id` (nullable) y `numero_venta` ya son obligatorios en el payload LISTO; cuenta activa/no eliminada recibe una notificación; ausente/inactiva/eliminada no recibe y LISTO/audit continúan; repetir mismo `evento_id` y destinatario no duplica; otra ocurrencia conserva su clave distinta; variable de plantilla solo número; evento sin QR/DNI; `pedido_entregado` no genera aviso; ningún canal externo.

**Verificación:** `event-types.test.ts`, suites E12 eventos/audit y F3 focalizadas, typecheck para garantizar campos requeridos, lint, `git diff --check`, inspección de selects/payload y ausencia de seed modificado.

**Criterio DONE:** E12 y F3 compilan con payload final de SPEC; notificación correcta y omisión segura cuando no hay cuenta operable.

**STOP obligatorio:** reportar tests y cambio compartido E12/F3; no comenzar T9 sin aprobación.

### T9 — UI Retiro en consola de preparación

**Objetivo:** incorporar la operación de retiro a `/ecommerce/preparacion` reutilizando scanner e interacción existentes.

**Precondiciones:** T7 (HTTP/RBAC) y T8 (F3) aprobadas; autorización expresa de T9.

**Archivos autorizados:** modificables `src/app/(dashboard)/ecommerce/preparacion/page.tsx`, `src/components/ecommerce/ConsolaPickPack.tsx`, `src/components/ecommerce/ConsolaPickPack.test.tsx`; nuevos `src/components/ecommerce/RetiroPedidoPanel.tsx`, `src/components/ecommerce/RetiroPedidoPanel.test.tsx` si la composición separada facilita el aislamiento. Para el cliente HTTP, autorizar **solo la alternativa necesaria** tras leer el patrón real: (A) modificar `src/components/ecommerce/pick-pack-client.ts` y `src/components/ecommerce/pick-pack.client.test.ts`; o (B) crear `src/components/ecommerce/retiro-e3.client.ts` y `src/components/ecommerce/retiro-e3.client.test.ts`. Si `RetiroPedidoPanel` reutiliza limpiamente una abstracción existente, no es obligatorio tocar ni crear un cliente.

**Archivos solo lectura/reutilización:** `src/components/inventario/escaner/CameraBarcodeScanner.tsx`, `src/hooks/useBarcodeScanner.ts`, `src/components/ecommerce/PreparacionPedidoPanel.tsx`; inspeccionar `src/components/ecommerce/pick-pack-client.ts` y su test antes de elegir la alternativa HTTP; SPEC §2.3.e, PLAN §6.

**Cambios permitidos:** sección/pestaña Retiro en la consola existente; gate visual por `ecommerce:validar_retiro_qr`, autorización definitiva en backend; scanner entrega contenido completo decodificado, entrada manual alternativa, DNI, botón «Validar y entregar», loading/bloqueo de doble click, feedback genérico, número del pedido tras éxito y limpieza de QR/DNI. Reutilizar el cliente HTTP existente si encaja; si no, elegir solo una alternativa autorizada arriba. Mantener responsive de la consola.

**Cambios prohibidos:** página paralela, forzar `fetch` directo en el componente contra la convención real, extraer ID del QR, enviar data URL/OCR, guardar QR/DNI en URL/query/storage, logs/console o mostrar DNI almacenado, token procesado, facturación/pago. No modificar scanner/hook, header, navegación ni estilos globales aprobados salvo necesidad estricta de la propia sección; un archivo/ruta no autorizados exige STOP.

**Contrato aplicable:** input del operador es QR + DNI, ambos solo en POST body; el número de la venta exitosa permite comprobar el pedido antes de entrega física.

**Tests obligatorios:** gate de permiso, scanner/manual envían token decodificado completo, DNI, bloqueo durante request, éxito con número y limpieza, error genérico sin eco, estado responsive básico y ausencia de storage/query; probar el cliente HTTP seleccionado si se modificó o creó.

**Verificación:** tests de componentes/UI, typecheck, lint, `git diff --check`, inspección de cliente HTTP, consola, URL y almacenamiento. **Gate visual obligatorio en navegador real:** abrir `/ecommerce/preparacion` en viewport desktop y móvil; revisar sección Retiro, scanner, entrada manual QR, DNI, botón habilitado/deshabilitado, loading, error, éxito con número y limpieza posterior. Comprobar ausencia de overflow/solapamientos, proporciones y responsive coherentes, ausencia visual de QR procesado/DNI y preservación de header/navegación/estilos globales. Adjuntar capturas desktop y móvil al reporte para revisión humana visual; no son opcionales.

**Criterio DONE:** tests UI verdes, verificación visual real aprobada con capturas desktop y móvil y revisión humana visual; retiro usable dentro de preparación sin overflow, solapamientos, duplicar scanner ni exponer secretos; backend continúa siendo autoridad.

**STOP obligatorio:** reportar tests y capturas desktop/móvil para revisión humana visual; no comenzar T10 sin aprobación.

### T10 — Integración real E8/E1/E2/E12/F3/E9/E3

**Objetivo:** demostrar el recorrido completo con servicios/endpoints reales y token generado por E12.

**Precondiciones:** T6 (eventos/auditoría), T8 y T9 aprobadas; T7 (HTTP/RBAC) aprobado por la secuencia de ejecución; autorización expresa de T10; PostgreSQL dedicado y servidor de prueba según patrón E9/E12.

**Archivos autorizados:** nuevo `src/lib/services/ecommerce/hu-e3-e8-e12.integration.test.ts`; nuevo `src/lib/services/ecommerce/hu-e3-concurrencia.integration.test.ts` solo si la integración de carrera de T5 requiere ampliación con rutas reales.

**Archivos solo lectura/reutilización:** `src/lib/services/ecommerce/hu-e9-e8-e12.integration.test.ts`, `src/lib/services/ecommerce/hu-e9.http.integration.test.ts`, `src/lib/services/ecommerce/hu-e12.http.integration.test.ts`, servicios/endpoints E8/E1/E2/E12/E9/E3/F3, SPEC §2.3.e, PLAN §7.

**Cambios permitidos:** fixture con Cliente A y B y pedidos reales; login E8 → carrito E1 → checkout/pago aprobado E2 → admisión/toma/escaneos/completar E12 → LISTO y aviso F3 → detalle E9 con QR propio → obtener token real desde fixture/backend seguro y enviar contenido decodificado + DNI real a E3 → verificar B `CERRADO`, cantidades, E `ENTREGADO`, token null, plazo conservado y QR ausente en E9. Verificar mismo titular con pedidos A/B: QR B entrega B; otro titular/DNI incorrecto rechaza; reuso rechazado.

**Cambios prohibidos:** fijar manualmente `LISTO_PARA_RETIRO`, `codigo_qr_retiro` o plazo en escenario principal; editar servicios E2/E9/E8, usar base compartida, imprimir token/DNI o modificar flujo de pago productivo.

**Contrato aplicable:** prueba principal demuestra integración real; E9 presenta imagen QR y no devuelve token literal en DTO. Decodificar el QR o leer token desde fixture server-only sin exponerlo a logs.

**Tests obligatorios:** flujo principal completo y aserciones B/E/F3/E9; clientes A/B, varios pedidos del mismo titular, tercero, QR consumido; sin escrituras manuales de salidas E12. Extender carrera real solo para un riesgo aún no cubierto por T5.

**Verificación:** integración opt-in en PostgreSQL dedicado, aserción de 0 skipped para gate de cierre, typecheck, lint focalizado, `git diff --check`, revisión de cleanup y datos sensibles.

**Criterio DONE:** recorrido real verde, sin reemplazar transiciones por fixtures; B/E y notificaciones coherentes.

**STOP obligatorio:** reportar entorno, resultados/skip, archivos y riesgos; no comenzar T11 sin aprobación.

### T11 — VERIFY integral y seguridad

**Objetivo:** ejecutar regresión y revisar el alcance completo antes del cierre documental.

**Precondiciones:** T10 aprobada y autorización expresa de T11.

**Archivos autorizados:** ninguno para modificación productiva o tests; esta task es de verificación. Resultados se reportan en la respuesta de la task, sin crear artefactos versionados.

**Archivos solo lectura/reutilización:** todas las suites E3, B, E12, E9, F3 y archivos autorizados por T1–T10; `package.json` para comandos.

**Cambios permitidos:** ejecutar suites relevantes, typecheck, lint, build, `git diff --check` y revisión estática del diff/archivos; usar artefactos temporales de herramientas fuera de fuentes versionadas si el runner los requiere.

**Cambios prohibidos:** corregir problemas ajenos a E3, editar SPEC/PLAN, código/tests, Prisma/migraciones/seed o declarar verde una suite omitida.

**Contrato aplicable:** verificar privacidad de QR/DNI en logs, consola, eventos, AuditLog, errores, URL/query y storage; verificar que solo archivos de T1–T10 autorizados hayan cambiado. E13/E2/E9 siguen sin cambios productivos.

**Tests obligatorios:** suites E3 schema/servicio/DB/concurrencia/HTTP/eventos/audit/UI/integración; regresión B, E12, E9 y F3. Ejecutar `typecheck`, `lint` y `build` según scripts reales del repo.

**Verificación:** resultados completos con pass/fail/skip, `git diff --check`, inspección de archivos y búsquedas de `qr_token`, `codigo_qr_retiro`, `dni` en superficies sensibles; sin repetir suites sin riesgo concreto.

**Criterio DONE:** gates verdes o bloqueos explícitos y revisables; ninguna filtración ni cambio fuera de alcance. Un gate obligatorio skipped/no ejecutado impide cierre.

**STOP obligatorio:** reporte integral y revisión humana; no comenzar T12 sin aprobación.

### T12 — Documentación final de HU-E3

**Objetivo:** registrar implementación y evidencia verificadas, sin redefinir el contrato.

**Precondiciones:** T11 aprobada y autorización expresa de T12.

**Archivos autorizados:** modificables `docs/modulos/modulo E/HU3_MODULO_E.md`, `docs/modulos/modulo E/HU3_TASKS.md` para estado/evidencia de cierre.

**Archivos solo lectura/reutilización:** `docs/specs/spec_modulo_E.md` Rev.9, reportes de T1–T11 y paths reales implementados.

**Cambios permitidos:** documentar archivos finales, tests ejecutados, resultados, decisiones de implementación dentro del contrato y riesgos/deudas reales; marcar estado de tasks y evidencia de cierre.

**Cambios prohibidos:** cambiar SPEC o contrato aprobado, editar código/tests, inventar resultados, crear tasks nuevas o extender E13. Cualquier divergencia real de SPEC exige STOP y aprobación contractual previa; `spec_modulo_E.md` no está autorizado en T12.

**Contrato aplicable:** documentación refleja implementación verificada, incluyendo helper B, locks, HTTP, eventos/AuditLog, F3 y UI; no sustituye revisiones históricas.

**Tests obligatorios:** ninguno nuevo; cotejar contra resultados aprobados de T11 y paths existentes.

**Verificación:** lectura cruzada SPEC/PLAN/código/evidencia, enlaces internos, `git diff --check` y reporte de archivos documentales.

**Criterio DONE:** HU-E3 documentada con evidencia verificable y sin divergencia contractual; revisión humana de cierre pendiente hasta autorización expresa.

**STOP obligatorio:** entregar reporte final de documentación; no iniciar otra HU ni trabajos posteriores automáticamente.

## 5. Archivos fuera de alcance de todas las tasks

- `prisma/schema.prisma`, `prisma/migrations/**`, `prisma/seed.ts`: no hay persistencia, migración ni seed E3.
- Lógica HU-E13; servicios/DTO de E9 (`src/lib/services/ecommerce/mis-pedidos.service.ts` y asociados), flujo productivo E2 (`src/lib/services/ecommerce/pago-web.service.ts`), auth Cliente Web, header/estilos globales de Tienda ajenos a la consola. Pueden **leerse/invocarse** en T10/T11, no modificarse.
- Código de scanner/hook existente y `src/lib/auth/with-permission.ts`: reutilización sin modificación prevista.
- Cualquier archivo no enumerado en los «Archivos autorizados» de la task vigente, aunque aparezca en este documento como solo lectura. Si surge necesidad concreta: **STOP**, reporte y autorización antes de cambiar el límite.

## 6. Política STOP y criterio de cierre HU-E3

Al concluir **cada** task futura, ejecutar sus tests focalizados y `git diff --check`, informar archivos modificados, pruebas con pass/fail/skip, verificaciones, riesgos/hallazgos y **detenerse**. No avanzar por inferencia de aprobación. Los comandos Git de verificación pertenecen a futuras tasks autorizadas; esta redacción de TASKS no ejecuta Git.

HU-E3 solo puede considerarse cerrada tras T1–T12 aprobadas individualmente y evidencia real de: QR/DNI correcto → B `CERRADO` con cantidades completas + E `ENTREGADO` con token nulo en un commit; rechazo genérico y sin mutación para tercero, segundo uso, estado/plazo/baja; una auditoría segura de entrega y rechazo; un aviso interno F3 por ocurrencia LISTO para cuenta operable; E9 deja de mostrar QR; gates de tests/regresión/typecheck/lint/build y revisión de privacidad verdes. Ningún cambio a Prisma, migraciones, seed ni lógica E13.

**TASKS HU-E3 LISTAS PARA APROBACIÓN FINAL**

**STOP.**

## 7. Registro de ejecución y cierre documental T12

| Tasks | Estado y evidencia aprobada |
|---|---|
| T1–T3 | Schema Zod, tipos de eventos y helper B implementados con pruebas focalizadas. Firma final B: `registrarEntregaTotalPedidoVentaTx(tx, pedidoVentaId)`; sin `actorId`. |
| T4–T5 | Validación bajo locks y entrega B/E en un commit; PostgreSQL real verificó locks, rollback, doble retiro y consumo de QR. |
| T6–T8 | Eventos E3/AuditLog post-commit, ruta HTTP con RBAC y aviso interno F3 de LISTO implementados y probados. |
| T9 | Retiro integrado en `/ecommerce/preparacion`, scanner/manual, DNI, feedback y limpieza; tests UI y revisión visual aprobados. |
| T10 | Integración real E8 → E1/E2 → E12 → F3/E9 → E3 aprobada; 4/4 PASS, SKIP 0. |
| T11 | VERIFY aprobado: 201 PASS, 0 FAIL, 0 SKIP en gates válidos; lint PASS; compilación de build PASS; typecheck y fase TypeScript del build limitados exclusivamente por los 16 errores preexistentes aceptados. |
| T12 | Registro documental en este archivo y `HU3_MODULO_E.md` §11; pendiente de revisión humana. |

**Contrato observado:** pago confirmado → preparación E12 → LISTO con QR/plazo y aviso F3 a cuenta web operable → QR + DNI del titular en E3 → helper B `CERRADO` con cantidades completas y extensión E `ENTREGADO` con token nulo, todo en una transacción. Reuso, DNI incorrecto, estado no apto, baja y plazo vencido rechazan sin entregar. El plazo vencido no ejecuta E13. Una cuenta web inactiva/eliminada no recibe F3 pero no pierde el derecho de retiro físico del pedido pagado. E9 deja de presentar el QR tras consumirse. Ver `HU3_MODULO_E.md` §11 para rutas, HTTP, auditoría, pruebas y límites de privacidad.

**Alcance:** no se introdujeron schema Prisma, migraciones, seed, entidad Remito ni lógica E13 para HU-E3. El bus post-commit in-process no garantiza reentrega durable. T11 no usó Git por instrucción expresa: no se certificó `git diff --check` ni un diff histórico completo de archivos. E9 y E12 pasaron sus regresiones aisladas con bases descartables; la prioridad 80 preexistente en la plantilla explicaba la falla inicial de E12. Ninguna task posterior está autorizada por este registro.
