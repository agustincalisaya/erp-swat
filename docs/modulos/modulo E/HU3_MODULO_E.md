# HU-E3 — Plan técnico de retiro validado Click & Collect

> **Estado al 07/10/2026:** SPEC Rev. 9, PLAN y T1–T11 aprobadas; T12 documentada y pendiente de revisión humana. Este plan conserva su redacción de diseño previa a la implementación. El registro de implementación y VERIFY de §11 prevalece para describir lo efectivamente construido; el contrato sigue siendo la SPEC Rev. 9 (Revisiones 7–9).

## Estado y fuente de verdad

**Estado SDD:** discovery aprobado; SPEC aprobada; PLAN para revisión. Tasks e implementación no autorizadas. Este documento organiza dependencias y verificaciones futuras; no asigna tasks ejecutables ni modifica el contrato.

**Fuente de verdad:** `docs/specs/spec_modulo_E.md`, **Revisión 7 — HU-E3**, especialmente §2.3.a–§2.3.e y las notas de sustitución de §2.12 y §4. Ante cualquier diferencia, prevalece esa revisión. Los pasajes de Revisión 1 que asignaban el retiro a E12 y proponían `/pick-pack/[id]/validar-retiro` son históricos.

**Convención documental:** `docs/modulos/modulo E/HU*_MODULO_E.md` reúne el diseño de cada HU. Los archivos `HU*_TASKS.md` contienen backlog ejecutable; HU-E3 no tiene uno en esta etapa.

## 1. Resumen arquitectónico y límites

El QR único identifica exactamente un pedido. El Operador presenta el contenido decodificado del QR y el DNI físico; E3 identifica el pedido solo por `qr_token`, comprueba el DNI del `Cliente` titular y coordina una transacción única con Módulo B. B actualiza las cantidades entregadas y cierra la venta; E3 cambia la extensión a `ENTREGADO` y consume el token. Después del commit se emite el evento de entrega para Módulo D. En paralelo, la ampliación mínima del evento `LISTO` de E12 permite que F3 notifique internamente al Cliente Web.

```text
E8/E1/E2 → pago aprobado → E12 cola, escaneo y LISTO + token/plazo
                                      └→ evento LISTO → F3 → bandeja Cliente Web
E9 detalle propio → imagen QR con el token
Operador /ecommerce/preparacion → scanner o entrada manual + DNI
  → POST /api/ecommerce/preparacion/validar-retiro [RBAC]
  → E3: QR → PedidoVentaEcommerce → PedidoVenta → Cliente
  → un tx: locks → validaciones → helper B (ítems y CERRADO)
                         → E (ENTREGADO y token null) → commit
  → evento pedido_entregado → AuditLog D; respuesta mínima
```

| Componente | Responsabilidad y límite |
|---|---|
| E3 | Validar entrada, QR, DNI, plazo, estado y soft delete; coordinar transacción; consumir QR; publicar eventos después del resultado. |
| Módulo B | Helper transaccional para la **entrega total** de un `PedidoVenta` ya facturado. E3 no replica sus contadores ni su máquina de estados. |
| E12 | Conserva admisión, preparación, token/plazo y emisión de `pedido_listo_para_retiro`. Solo se amplía el payload seguro necesario para F3. |
| E9 | Sigue presentando el QR únicamente al propietario y mientras corresponda. Se invoca en integración; no se cambia servicio ni DTO. |
| E13 | Conserva vencimiento, cancelación, stock y reintegros. E3 solo comprueba el plazo; la futura mutación E13 deberá coordinar el mismo orden de locks. |
| F3 | Suscripción interna de `pedido_listo_para_retiro`; sin email/WhatsApp y sin aviso de `ENTREGADO`. |
| Módulo D | AuditLog de entrega y de intento rechazado a partir de eventos, sin QR/DNI. |

No hay persistencia nueva: `schema.prisma`, migraciones y `seed.ts` quedan fuera. Ya existen `ENTREGADO`, `codigo_qr_retiro` nullable/unique, plazo, `cantidad_entregada`, estados B y el permiso. No se agrega fecha, operador, clave de idempotencia, tabla de retiros ni entidad Remito. Actor y hora se conservan por evento/auditoría. Si se demuestra una imposibilidad real con estos datos, detener el futuro desarrollo y elevarla sin cambiar la SPEC unilateralmente.

## 2. Servicio E3, transacción y concurrencia

**Servicio previsto:** un servicio server-only de retiro en `src/lib/services/ecommerce/`, separado del servicio de preparación `pick-pack.service.ts`. Nombre orientativo: `validarYEntregarRetiro`. Recibe exclusivamente entrada ya normalizada y `actorId` derivado de la sesión RBAC; no recibe un ID de pedido provisto por el navegador.

1. El Route Handler aplica Zod estricto de §2.3.b: `qr_token` no vacío (hasta 128 caracteres, sin regex base64url rígida) y DNI con trim de 7–8 dígitos. Rechaza campos extra. El actor se obtiene de `withPermission("ecommerce:validar_retiro_qr")`.
2. Una lectura preliminar mínima de la extensión por `codigo_qr_retiro` único obtiene solo el `pedido_venta_id` necesario para bloquear el agregado. Esa lectura no autoriza nada ni retiene locks. Token no hallado: rechazo público uniforme y evento seguro sin ID de pedido.
3. Dentro de **una** transacción, adquirir locks en el orden de E12: **`PedidoVenta` → `PedidoVentaEcommerce` → `PedidoVentaItem` activos ordenados por `(created_at, id)`**. El servicio E12 ya usa `SELECT … FOR UPDATE` para ese agregado; la implementación futura debe seguir el patrón, sin llamar helpers privados de E12 como API pública. La fila `Cliente` se estabiliza después de esos locks, como prescribe §2.3.c. B trabaja con el mismo `TransactionClient` y no abre otro commit.
4. Después de los locks, releer y validar: pedido WEB y activo/no eliminado; extensión activa/no eliminada, `LISTO_PARA_RETIRO` y token todavía coincidente; plazo nulo o `>= ahora` capturado tras los locks; Cliente titular activo/no eliminado y DNI coincidente; ítems activos existentes y cantidades facturadas/entregadas coherentes. Una cuenta web dada de baja no bloquea el retiro.
5. Invocar el helper de B para la entrega total. Luego, en el mismo `tx`, hacer la transición E condicionada por estado y token: `ENTREGADO`, `codigo_qr_retiro = null`. Conservar plazo, fecha de pago, operador de preparación y prioridad. Cualquier fallo revierte B y E juntos.
6. Después del commit exitoso, publicar **una sola vez** `ecommerce:pedido_entregado`. Ante un rechazo de negocio, no escribir B/E; publicar `ecommerce:retiro_rechazado` fuera de la transacción fallida. Un fallo técnico o una incoherencia interna hace rollback y retorna error seguro, sin evento de entrega.

**Competencia:** dos operadores, doble clic o reuso del token entran por la misma prelectura; solo el primer request que conserve estado/token bajo los locks entrega. El otro relee, rechaza y no publica otro `pedido_entregado`. No se devuelve éxito idempotente. Para retiro frente a E13, el primer mutador que obtenga el lock decide; el siguiente relee estado/plazo y no aplica la transición incompatible. El plan no implementa E13.

**Semántica del QR:** el QR de B del mismo titular con su DNI entrega **B**, aunque exista A; el QR determina el pedido sin ambigüedad. QR de otro titular más el DNI presentado rechaza sin mutación. La UI debe ayudar al Operador a verificar el número mostrado antes de la entrega física.

## 3. Helper transaccional de Módulo B

El lugar arquitectónico es `src/lib/services/ventas/pedido-venta.service.ts`, junto a `facturarPedidoVentaTx(tx, …)` y `anularPedidoVentaTx(tx, …)`. Firma orientativa: `registrarEntregaTotalPedidoVentaTx(tx, pedidoVentaId)`; el nombre definitivo puede ajustarse a la convención de B, sin mover la lógica a e-commerce. El helper no recibe `actorId`: la identidad del actor pertenece a E3 y viaja en sus eventos para la auditoría post-commit. Si durante la implementación aparece una necesidad concreta del dominio B para ese parámetro, **STOP y reporte** antes de cambiar el contrato.

**Precondiciones bajo el `TransactionClient` compartido:** pedido WEB activo/no eliminado en `FACTURADO`; ítems activos/no eliminados existentes, `cantidad_facturada = cantidad`, `cantidad_entregada = 0` y ausencia de sobreentrega. El helper revalida la coherencia de B aun si E3 ya la verificó. Debe respetar el orden de locks ya adquirido por E3, sin bloquear recursos en orden inverso.

**Efecto:** actualizar `cantidad_entregada` de cada ítem activo hasta `cantidad_facturada = cantidad` y recorrer contractualmente `FACTURADO → REMITO_EMITIDO → CERRADO` dentro del mismo `tx`. No crea Remito como entidad, no refactura, no vuelve a cobrar y no toca stock. Su fallo obliga rollback de la transición E y del consumo QR. La verificación de esta fase debe confirmar que nunca queda E `ENTREGADO` con B `FACTURADO` o cantidades parciales.

## 4. HTTP, RBAC y errores

`POST /api/ecommerce/preparacion/validar-retiro` tendrá un Route Handler fino en `src/app/api/ecommerce/preparacion/validar-retiro/route.ts`: validar JSON/Zod, extraer `session.userId`, invocar el servicio y devolver `{ data, error }` con `Cache-Control: no-store`. No recibe IDs ni identidad derivada; no acepta token/DNI en path o query. La respuesta `200` solo incluye `{ pedido_venta_id, numero, estado: "ENTREGADO" }`.

| HTTP | Contrato público | Plan de mapeo |
|---|---|---|
| 400 | `VALIDATION_ERROR` | JSON/schema/campos extra; mensaje y detalles sin eco de valores. |
| 401 | `UNAUTHORIZED` | Falta sesión interna, según `withPermission`. |
| 403 | `FORBIDDEN` | Falta `ecommerce:validar_retiro_qr`; nunca comparar nombres de rol. |
| 422 | `RETIRO_NO_VALIDO` | Misma respuesta para QR no hallado/usado, DNI distinto, estado/plazo/soft delete/Cliente no operable. No exponer el motivo técnico. |
| 500 | `INTERNAL_ERROR` | Error técnico o agregado B/E inconsistente; rollback y mensaje genérico. |

No se propone `409`. Los motivos técnicos acotados se mantienen dentro de servicio/auditoría segura; el mapper no construye un oráculo de existencia de QR o coincidencia de DNI. Seleccionar de Prisma solo IDs, estado, flags, plazo, DNI para comparación interna y cantidades necesarias; ni SELECT ni respuesta de Operador requieren datos de pago, email o DNI almacenado para visualización.

## 5. Eventos, auditoría y F3

| Evento | Productor | Consumidor | Regla |
|---|---|---|---|
| `ecommerce:pedido_entregado` | E3, una vez post-commit exitoso | Listener D | IDs de pedido/extensión, actor, estados anterior/nuevo, `evento_id`, timestamp; sin QR/DNI/email/pago. Ninguna suscripción F3. |
| `ecommerce:retiro_rechazado` | E3, también para token inexistente | Listener D | `evento_id`, actor, motivo enum, timestamp; `pedido_venta_ecommerce_id?` y `pedido_venta_id?` solo si fueron resueltos de forma segura. No incluir entrada del usuario. |
| `ecommerce:pedido_listo_para_retiro` | E12 ya lo emite post-commit | D existente; nueva suscripción F3 | Añadir `cliente_web_cuenta_id` y `numero_venta` resueltos server-side; nunca token ni DNI. |

En `pick-pack.service.ts`, durante `completarPreparacion`, obtener `numero_venta` y `cliente_id` del `PedidoVenta` y resolver la cuenta vinculada **operable** dentro de la transacción de finalización: `CuentaClienteWeb.is_active = true` y `deleted_at = null`. El select actual del lock de pedido solo trae `id/canal/flags`, así que la futura modificación debe ampliar la lectura mínima o hacer otra lectura dentro del mismo `tx`, sin alterar la finalización ni exponer esos datos en su DTO. Pasar al payload post-commit `cliente_web_cuenta_id` (nullable) y `numero_venta`. Si la cuenta no existe, está dada de baja o no está operable, enviar `cliente_web_cuenta_id: null`: `completarPreparacion` sigue normalmente, `LISTO_PARA_RETIRO` y su auditoría no se revierten, y F3 omite el destinatario web. Esto no convierte la cuenta en precondición del retiro físico E3; un pedido ya pagado puede retirarse con QR y DNI aunque su cuenta web haya sido dada de baja. El ID interno de destinatario y el número comercial no son QR, DNI ni email.

`event-types.ts` define la ampliación de `EcommercePedidoListoParaRetiroPayload` y los dos eventos E3. `notificacion.listener.ts` agrega solo la suscripción de `pedido_listo_para_retiro` con prioridad `INFORMATIVA`, destinatario cuenta web operable cuando exista y variables de plantilla `{ numero_venta }`. Para este evento, **`clave_origen = evento_id`**: `GenerarNotificacionesInput` la define como identificador de la **ocurrencia**, y E12 ya emite `evento_id`. Reprocesar la misma ocurrencia con el mismo `evento_id` conserva la clave única de F3 y no duplica la notificación; `numero_venta` es solo una variable de plantilla y `pedido_venta_id` no se usa como `clave_origen`. La plantilla ya está en seed; no se modifica. El listener es post-commit e in-process: una falla de notificación no revierte `LISTO` y no existe reentrega durable automática en este alcance.

**Mapping AuditLog de Módulo D:**

| Evento | `tabla_afectada` | `registro_id` | Valores auditables mínimos |
|---|---|---|---|
| `ecommerce:pedido_entregado` | `pedidos_venta_ecommerce` | `pedido_venta_ecommerce_id` | `valor_anterior`: `estado_ecommerce = LISTO_PARA_RETIRO`, `estado_pedido_venta = FACTURADO`. `valor_nuevo`: `estado_ecommerce = ENTREGADO`, `estado_pedido_venta = CERRADO`, `qr_consumido = true`, `entrega_total = true`. Actor y timestamp provienen del evento. |
| `ecommerce:retiro_rechazado` con extensión resuelta seguramente | `pedidos_venta_ecommerce` | `pedido_venta_ecommerce_id` | Motivo técnico acotado, actor y timestamp; IDs opcionales de extensión/pedido. No registrar el valor presentado ni comparar DNI en el log. |
| `ecommerce:retiro_rechazado` con token sin correspondencia | `pedidos_venta_ecommerce` | `null` | Motivo técnico acotado, actor y timestamp; sin IDs de pedido. `AuditLog.registro_id` permite null. |

Nunca usar token ni DNI como `registro_id` ni incluirlos en `valor_anterior` o `valor_nuevo`; tampoco email ni datos de pago. El evento `pedido_entregado` refleja el efecto agregado B/E sin crear un segundo evento de B para esta HU.

## 6. UI y seguridad

En la superficie móvil existente `/ecommerce/preparacion`, incorporar una sección «Retiro» visible por el permiso de retiro. La página hoy exige `ecommerce:leer_cola_preparacion` y el rol sembrado de Operador tiene ambos permisos; revisar los gates de página y componente para que la acción se proteja **también** por `ecommerce:validar_retiro_qr` en servidor y no dependa solo de visibilidad. Reutilizar `CameraBarcodeScanner`, `useBarcodeScanner` (Barcode Detection API/ZXing) y el patrón de entrada manual de `PreparacionPedidoPanel`. El scanner entrega el contenido decodificado íntegro, no una data URL ni un ID extraído.

Campos: QR por scanner o texto manual, DNI y «Validar y entregar»; deshabilitar mientras envía, mostrar éxito/error sin datos sensibles y limpiar token/DNI tras éxito. No mostrar DNI almacenado ni datos de pago/facturación. Evitar conservar QR/DNI en URL, query params, `localStorage`, `sessionStorage`, logs, consola, eventos, AuditLog, errores o respuestas. Revisar `select` mínimos, mapper y componentes para evitar eco accidental, incluso en errores de Zod o de red. La respuesta exitosa muestra el número del pedido resuelto por QR; el Operador lo verifica antes de la entrega física.

## 7. Estrategia futura de pruebas

No se crean pruebas en esta fase. La secuencia futura de suites separa fallos por capa y culmina en el flujo real:

| Suite | Dependencia | Evidencia esperada |
|---|---|---|
| A. Schema/unit | Contrato P1 | Trim, límites, DNI 7–8 dígitos, campos extra y entrada malformada. |
| B. Servicio | Helper B y E3 | QR/DNI/estado/plazo/soft delete; mismo titular con varios pedidos; otro titular; QR consumido; rollback ante inconsistencia. |
| C. Integración DB | B + E3 | Cantidades, B `CERRADO`, E `ENTREGADO`, token null, plazo conservado, cuenta web inactiva permitida. |
| D. Concurrencia | Servicio DB | Dos operadores/doble request: un éxito; reuso: rechazo; mutador incompatible E13 simulado con mismo lock order. |
| E. HTTP/RBAC | Ruta + servicio | 400/401/403/422 uniforme/500 seguro/200 mínimo; permiso granular; no filtración. |
| F. Eventos/auditoría | Event types + D | Una auditoría de entrega con estados B/E antes/después y flags `qr_consumido`/`entrega_total`; rechazo con `registro_id` de extensión si se resolvió, o null si el token no existe; sin QR/DNI. |
| G. F3 | Payload E12 + listener F3 | Cuenta activa/no eliminada: un aviso interno por `LISTO`; cuenta inexistente/inactiva: sin destinatario ni rollback. Reprocesar la misma ocurrencia (`evento_id`) no crea segunda fila; sin aviso `ENTREGADO` ni mensajería externa. |
| H. UI | HTTP estable | Scanner/manual, DNI, botón, feedback, bloqueo de doble envío, limpieza tras éxito y responsive. |
| I. E2→E12→E9→E3 | Todas las anteriores | E8 login → E1 carrito → E2 checkout/pago → E12 cola/toma/escaneo/LISTO → F3 aviso → E9 QR A → E3 token/DNI reales → B/E correctos, QR ausente en E9 y tercero rechazado. Sin fijar manualmente `LISTO`, token ni plazo. |

## 8. Inventario de archivos para etapas futuras

Las rutas nuevas son propuestas de organización coherentes con `pick-pack.schema.ts`, los servicios e-commerce y los Route Handlers de `/api/ecommerce/preparacion`. Esta tabla **no autoriza** su creación ahora. «Fase» indica dependencia de PLAN, no una task.

| Grupo | Archivo | Responsabilidad / tipo de cambio | Fase futura |
|---|---|---|---|
| Nuevo | `src/lib/schemas/retiro-e3.schema.ts` | Zod estricto del body; schema propio para no mezclar escaneo SKU de E12 con retiro. | P1 |
| Nuevo | `src/lib/services/ecommerce/retiro-e3.service.ts` | Orquestación E3 y transacción; sin reglas comerciales B duplicadas. | P3 |
| Nuevo | `src/app/api/ecommerce/preparacion/validar-retiro/route.ts` | Adaptador HTTP/RBAC mínimo. | P4 |
| Nuevos | Tests E3 de schema, servicio, DB, concurrencia, HTTP, auditoría, UI e integración | Matriz de §7, nombres concretos en futuro desglose autorizado. | P1–P9 |
| Modificado | `src/lib/services/ventas/pedido-venta.service.ts` | Helper transaccional de entrega total B. | P2 |
| Modificado | `src/lib/events/event-types.ts` | Extensión de payload `LISTO` y tipos de eventos E3. | P1/P5 |
| Modificado | `src/lib/events/listeners/audit-log.listener.ts` | Auditoría de entrega y rechazo. | P5 |
| Modificado | `src/lib/events/listeners/notificacion.listener.ts` | Suscripción interna `LISTO`; sin `ENTREGADO`. | P6 |
| Modificado | `src/lib/services/ecommerce/pick-pack.service.ts` | Solo resolución de cuenta/número y payload `LISTO`, sin cambiar preparación. | P6 |
| Modificados | `src/app/(dashboard)/ecommerce/preparacion/page.tsx`, `src/components/ecommerce/ConsolaPickPack.tsx` y componente/cliente de retiro que resulte necesario | Gate y composición de sección Retiro dentro de la superficie actual. | P7 |
| Solo reutilizados | `src/components/inventario/escaner/CameraBarcodeScanner.tsx`, `src/hooks/useBarcodeScanner.ts`, `src/components/ecommerce/PreparacionPedidoPanel.tsx` | Cámara, ZXing y patrón manual. | P7 |
| Solo reutilizados | `src/lib/auth/with-permission.ts`, `src/lib/services/ecommerce/mis-pedidos.service.ts`, `src/lib/services/ecommerce/pago-web.service.ts` | RBAC e integración E9/E2; sin modificación prevista. | P4/P8 |
| Fuera de alcance | `prisma/schema.prisma`, `prisma/migrations/**`, `prisma/seed.ts`, lógica E13, servicio/DTO E9 y pago E2 | Sin persistencia ni cambios a otras HU. | Ninguna |

## 9. Fases de implementación propuestas y puntos de parada

**Estas fases aún no son tasks.** Su desglose, archivos autorizados y ejecución requieren autorización posterior. El futuro desarrollo será task-by-task: después de **cada task autorizada**, incluso si queda dentro de una misma fase, STOP → reporte con evidencia → revisión humana → autorización de la siguiente. No avanzar automáticamente por completar una verificación local.

| Fase | Objetivo y archivos principales | Precondición | Verificación de salida | Riesgo | No hacer en esa fase |
|---|---|---|---|---|---|
| P1 | Contrato de tipos y Zod E3: `retiro-e3.schema.ts`, tipos E3 en `event-types.ts`; suites A cuando se autoricen. | PLAN aprobado. | Body estricto, códigos de evento y payloads alineados con Rev.7; sin datos sensibles. | Bajo | No crear endpoint ni mutar pedidos. |
| P2 | Helper de entrega total B en `pedido-venta.service.ts`; pruebas focalizadas B/DB. | P1 aprobado; coordinar owner B. | Facturado y cantidades coherentes → cierre total en `tx`; fallo → rollback; sin entidad Remito. | Alto, dominio compartido | No mutar E ni crear pagos/comprobantes. |
| P3 | Servicio E3 y transacción en `retiro-e3.service.ts`; suites B/C/D iniciales. | P2 aprobado. | Locks en orden, revalidación, B/E en un commit, token consumido, rechazo sin segunda entrega. | Alto, concurrencia | No exponer HTTP ni crear UI. |
| P4 | Ruta, mapper y permiso; suites E. | P3 aprobado. | 400/401/403/422/500 seguros, 200 mínimo, `no-store`, sin oráculo ni eco. | Medio, datos sensibles | No autorizar por rol ni aceptar IDs. |
| P5 | Eventos E3 y listener D; suite F. | P3 y tipos P1 aprobados. | Un `pedido_entregado` post-commit; AuditLog de éxito con estados B/E y flags, rechazo con extensión o `registro_id = null`, sin QR/DNI. | Alto, auditoría | No crear segundo evento B ni suscribir `ENTREGADO` a F3. |
| P6 | Cierre F3: payload `LISTO` en E12 y `notificacion.listener.ts`; suite G. | Tipos P1 y E12 existente; puede revisarse tras P5 para evitar conflicto en `event-types.ts`. | Cuenta operable recibe un aviso; inactiva/inexistente no bloquea `LISTO`; misma ocurrencia `evento_id` no duplica. | Medio, evento compartido | No cambiar generación QR/plazo ni añadir mensajería externa. |
| P7 | Sección Retiro en `/ecommerce/preparacion`; suite H. | P4 aprobado. | Scanner/manual y DNI, permiso visual y server-side, estados responsive, limpieza. | Medio, exposición en UI | No crear circuito paralelo ni almacenar secretos. |
| P8 | Integración real I y concurrencia ampliada D; reutilizar suites E2/E12/E9. | P3–P7 aprobados. | Flujo real completo, B/E coherentes, F3 y E9 observables, tercero rechazado, dos operadores sin doble entrega. | Alto, integración | No fijar manualmente `LISTO`, token o plazo en prueba principal. |
| P9 | Verify y documentación de cierre de HU-E3 en este archivo y referencias de spec solo si hay divergencia aprobada. | P8 aprobado. | Evidencia de suites, ausencia de filtraciones y alcance de archivos comprobados. | Bajo | No cambiar contrato congelado unilateralmente. |

Dependencias principales: **P1 → P2 → P3 → P4 → P7 → P8 → P9**; **P3 → P5 → P8** y **P1 → P6 → P8**. P5 y P6 comparten `event-types.ts`, por eso se revisan secuencialmente. Las pruebas se incorporan con la fase que verifican, una vez autorizada la implementación; este PLAN no crea ninguna.

## 10. Riesgos y preguntas abiertas

- **Concurrencia con E13:** no hay implementación E13 hoy; las futuras transiciones de vencimiento/cancelación deberán respetar los locks del agregado. La prueba de carrera podrá usar un mutador incompatible controlado hasta que E13 exista, sin implementarla aquí.
- **Auditoría post-commit:** el bus existente es in-process y no durable. Una falla del listener no revierte B/E. Registrar el riesgo y verificar el comportamiento, sin agregar outbox o persistencia nueva.
- **Aviso a cuenta legacy/inactiva:** la cuenta puede faltar o estar dada de baja; solo una `CuentaClienteWeb` activa/no eliminada se incluye como destinataria. En los demás casos el payload nullable omite el aviso sin deshacer `LISTO` ni su auditoría. La baja de la cuenta web no cancela el derecho de retiro físico.
- **Respuesta tras entrega:** el QR fija inequívocamente el pedido. Si hay varios pedidos del mismo titular, la interfaz muestra el número resuelto para verificación antes de entregar físicamente la prenda; no introduce una identidad de pedido alternativa.
- **Preguntas abiertas contractuales:** ninguna. Un impedimento técnico demostrado respecto de la ausencia de persistencia nueva obliga STOP y revisión humana; este PLAN no lo presupone ni altera la SPEC.

**PLAN LISTO PARA REVISIÓN FINAL**

**STOP.**

## 11. Registro final de implementación y VERIFY — HU-E3, 07/10/2026

**Estado:** implementación T1–T10 y VERIFY T11 aprobadas; cierre documental T12 pendiente de revisión humana. La descripción prospectiva de §§1–10 es el plan histórico, no una afirmación de que las tasks sigan pendientes. La SPEC Rev. 9 mantiene la autoridad contractual. No se cambió la SPEC para este cierre.

### Recorrido implementado

1. El pago confirmado de E2 ingresa en la preparación E12. E12 toma y escanea los ítems, pasa a `LISTO_PARA_RETIRO` y genera `codigo_qr_retiro` único y `plazo_retiro_vencimiento`. E9 muestra el QR al Cliente titular en el detalle propio. El ciclo observado es **Pago Confirmado → En Preparación → Listo para Retiro → Entregado**.
2. El Operador utiliza la sección **Retiro** de `/ecommerce/preparacion`: `CameraBarcodeScanner` entrega el contenido decodificado del QR, o se ingresa manualmente, y se presenta DNI. El componente impide doble envío, informa éxito/error y limpia QR y DNI después del éxito. Los valores no se guardan en URL ni storage del navegador.
3. `POST /api/ecommerce/preparacion/validar-retiro` aplica `ValidarRetiroSchema` estricto a `{ qr_token, dni }` y `withPermission("ecommerce:validar_retiro_qr")`; obtiene el actor de `session.userId`. Resuelve el pedido solo por el token. Devuelve únicamente `{ pedido_venta_id, numero, estado: "ENTREGADO" }` en `data`, con `Cache-Control: no-store`. Respuestas públicas: `400 VALIDATION_ERROR`, `401 UNAUTHORIZED`, `403 FORBIDDEN`, `422 RETIRO_NO_VALIDO` con «No fue posible validar el retiro» y `500 INTERNAL_ERROR`. El motivo técnico del rechazo no se expone.
4. E3 hace prelectura mínima por token y revalida bajo `SELECT … FOR UPDATE` en orden `PedidoVenta → PedidoVentaEcommerce → PedidoVentaItem (created_at, id) → Cliente`. Comprueba canal WEB, estados, soft delete, plazo y DNI del Cliente titular. La baja de `CuentaClienteWeb` no impide el retiro físico. Un plazo vencido rechaza sin mutar a `VENCIDO_SIN_RETIRO` ni ejecutar cancelación, stock o reintegro de E13.
5. Dentro del mismo `TransactionClient`, `registrarEntregaTotalPedidoVentaTx(tx, pedidoVentaId)` completa `cantidad_entregada` y recorre `FACTURADO → REMITO_EMITIDO → CERRADO`; E3 hace un `updateMany` condicional a `ENTREGADO` con `codigo_qr_retiro = null`. La transacción revierte ambos dominios si falla cualquiera. Se conserva el plazo histórico. El segundo uso del QR se rechaza; la concurrencia PostgreSQL verificó exactamente una entrega.
6. Después del commit, E3 emite `ecommerce:pedido_entregado`; un rechazo de negocio emite `ecommerce:retiro_rechazado` después del fallo/rollback, con IDs solo si se resolvieron de forma segura. El listener D registra AuditLog sobre `pedidos_venta_ecommerce`: extensión ID en éxito/rechazo resuelto o `registro_id = null` sin resolución. El éxito registra estados B/E y `qr_consumido`/`entrega_total`; nunca QR, DNI, email ni datos de pago. El bus post-commit sigue siendo in-process, sin entrega durable automática.
7. E12 emite `ecommerce:pedido_listo_para_retiro` con `numero_venta` y `cliente_web_cuenta_id` operable o `null`. F3 crea solo una notificación **interna** `INFORMATIVA` para cuenta activa/no eliminada, con `clave_origen = evento_id`; sin cuenta, LISTO y su auditoría continúan. No hay WhatsApp, email ni notificación F3 al entregar.

### Rutas y pruebas finales

| Capa | Archivos finales |
|---|---|
| Entrada y HTTP | `src/lib/schemas/retiro-e3.schema.ts`; `src/app/api/ecommerce/preparacion/validar-retiro/route.ts` |
| Dominio B/E | `src/lib/services/ventas/pedido-venta.service.ts`; `src/lib/services/ecommerce/retiro-e3.service.ts` |
| Eventos, D y F3 | `src/lib/events/event-types.ts`; `src/lib/events/listeners/audit-log.listener.ts`; `src/lib/events/listeners/notificacion.listener.ts`; `src/lib/services/ecommerce/pick-pack.service.ts` |
| Operador | `src/app/(dashboard)/ecommerce/preparacion/page.tsx`; `src/components/ecommerce/ConsolaPickPack.tsx`; `src/components/ecommerce/RetiroPedidoPanel.tsx`; `src/components/ecommerce/pick-pack-client.ts` |
| Pruebas E3 | `src/lib/schemas/retiro-e3.schema.test.ts`; `src/lib/services/ecommerce/retiro-e3.service.test.ts`, `retiro-e3.validation.integration.test.ts`, `retiro-e3.delivery.integration.test.ts`, `retiro-e3.audit.integration.test.ts`, `hu-e3.http.integration.test.ts` y `hu-e3-e8-e12.integration.test.ts` (los seis nombres abreviados pertenecen a `src/lib/services/ecommerce/`) |
| Pruebas de integración compartida | `src/lib/services/ventas/pedido-venta.service.test.ts` y `pedido-venta.integration.test.ts`; `src/lib/events/event-types.test.ts`; `src/lib/events/listeners/audit-log.listener.test.ts` y `notificacion.listener.e3.test.ts`; `src/lib/services/ecommerce/pick-pack.eventos.test.ts` |
| Pruebas UI | `src/components/ecommerce/RetiroPedidoPanel.test.tsx`, `ConsolaPickPack.test.tsx`, `pick-pack.client.test.ts` y `mis-pedidos.test.tsx` (los tres nombres abreviados pertenecen a `src/components/ecommerce/`) |

**VERIFY T11 aprobado:** 201 PASS, 0 FAIL y 0 SKIP en las ejecuciones válidas: 85 de E3/E12/F3, 4 de T10 real, 37 de UI, 1 de E9 aislada, 52 de E12 aislada y 22 de B/T3. T10 cubre el recorrido real E8/E1/E2/E12/F3/E9/E3; T5 cubre rollback y doble retiro. Las bases descartables se retiraron. `npm run lint` pasó con 0 errores y 4 advertencias ajenas. `next build` compiló; la fase TypeScript falló únicamente por los mismos 16 errores preexistentes aceptados en cupones/seed/tipos Prisma. `tsc --noEmit --pretty false` mostró esos mismos 16, sin error nuevo de HU-E3.

**Alcance y límites verificados:** no se agregó persistencia HU-E3 en `prisma/schema.prisma`, migraciones ni `prisma/seed.ts`; E9, E2 y E13 se invocan o consultan sin cambio productivo en sus servicios. No hay `DELETE` físico en el flujo E3 revisado. La revisión estática de QR/DNI cubrió HTTP, servicio, UI, eventos, AuditLog, URL/storage y mensajes de log. La comparación histórica exhaustiva de archivos modificados y `git diff --check` no se ejecutaron en T11 porque se prohibió Git; no se presentan como evidencia de ese gate. Las regresiones E9/E12 requirieron bases aisladas: `hu_e9_test` para la guardia de E9 y cola limpia para E12; el pedido preexistente de prioridad 80 en la plantilla causaba la falla de aislamiento, sin regresión productiva demostrada.

**Riesgos remanentes:** el bus de eventos y sus listeners son post-commit e in-process; si fallan, la entrega o LISTO ya confirmados no se revierten y no hay reentrega durable en HU-E3. La lógica de vencimiento/cancelación de E13 sigue fuera de esta HU. El cierre de HU-E3 requiere revisión humana de T12.
