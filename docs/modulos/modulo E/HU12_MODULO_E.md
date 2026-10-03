# Especificación Técnica — HU-E12 (Cola de preparación y entrega)

## ERP SWAT Indumentarias — Módulo E

**Metodología:** Specification-Driven Development (SDD), especificación previa a implementación.
**Story Points:** 5.
**Stack previsto:** Next.js App Router · TypeScript · Prisma ORM · PostgreSQL 16 · Zod · RBAC de Módulo D.
**Fuentes contrastadas:** `RULES.md`; `docs/specs/spec_modulo_E.md` §§2.2, 2.3, 2.10, 2.12, 2.13 y 4; `docs/modulos/modulo E/HU10_MODULO_E.md`; `prisma/schema.prisma`; `prisma/seed.ts`; servicios de inventario, ventas, autenticación y eventos; `src/lib/utils/fecha-negocio.ts`.

**Estado SDD:** SPEC PREVIA; no constituye evidencia de implementación ni de tests aprobados. Lo marcado **PROPUESTO / APROBADO PARA IMPLEMENTACIÓN** es contrato de esta HU, sujeto a coordinación explícita de los archivos compartidos indicados en §8. Las rutas, entidad de escaneo, timestamp de pago y eventos E12 no existen actualmente.

---

## 1. Historia de Usuario y Criterios de Aceptación

**Como** Operador de Pick & Pack, **necesito** consultar y gestionar una cola de pedidos Click & Collect pendientes de preparación, **para** preparar ordenadamente los pedidos abonados y dejarlos disponibles para el retiro del cliente.

- [ ] **CA1 — Admisión:** E2 confirma el pago y fija `fecha_pago_confirmado`; dentro de la misma transacción Prisma invoca `admitirPedidoPagoConfirmado(tx, pedidoVentaId)` para pasar un pedido `WEB` de `PAGO_CONFIRMADO` a `EN_PREPARACION` una sola vez, sin asignar operador; estar en la cola no significa estar asignado.
- [ ] **CA2 — Cola:** solo muestra pedidos `WEB` activos en `EN_PREPARACION`, con orden reproducible: prioridad manual descendente (`NULL` último), fecha real de confirmación de pago ascendente e ID estable ascendente.
- [ ] **CA3 — Prioridad:** únicamente `ecommerce:priorizar_cola` ajusta valores enteros de 1 a 100 o retira la prioridad (`null`); solo si el pedido sigue sin tomar y en `EN_PREPARACION`.
- [ ] **CA4 — Toma:** solo `ecommerce:preparar_pedido` asigna atómicamente un pedido no asignado al usuario autenticado; dos operadores no pueden tomarlo a la vez. Tomar no cambia el estado.
- [ ] **CA5 — Escaneo:** cada lectura física válida de SKU/EAN con un `scan_id` UUID nuevo confirma exactamente una unidad cuantitativa del pedido, nunca más que `PedidoVentaItem.cantidad`; se conserva el progreso entre sesiones.
- [ ] **CA6 — Idempotencia:** repetir `scan_id` para exactamente la misma confirmación devuelve respuesta idempotente sin sumar otra unidad; reutilizarlo con otro pedido, código, SKU, línea u operación incompatible devuelve conflicto. Un `scan_id` nuevo representa otra lectura física, aunque el SKU coincida.
- [ ] **CA7 — Control de acceso:** solo el operador asignado puede escanear o completar; se rechazan pedidos no WEB, códigos ajenos, unidades excedentes y transiciones inválidas. No se entregan datos financieros ni secretos al Operador.
- [ ] **CA8 — Finalización:** solo cuando todas las líneas alcanzan su cantidad se transiciona una vez a `LISTO_PARA_RETIRO`, guardando token y plazo en la misma transacción; repetir no rota token/plazo ni vuelve a emitir el evento.
- [ ] **CA9 — Configuración:** plazo desde la transición con `ECOMMERCE_PLAZO_RETIRO_DIAS` positivo y válido; si falta o es inválido, rollback integral, sin token nuevo ni evento de listo.
- [ ] **CA10 — Trazabilidad:** admisión, toma, prioridad y finalización son hechos auditables; el token nunca viaja al ledger ni al evento. El fallo de notificación F3 no revierte la transición ya confirmada.
- [ ] **CA11 — Permisos:** sin sesión administrativa `401`; sin permiso `403`. Priorizar exige permiso de escritura distinto del permiso compartido de lectura, nunca comparación por nombre de rol.

---

## 2. Arquitectura de la pantalla y límites de dominio

**EXISTENTE:** `PedidoVenta` de Módulo B con `canal = WEB`, `PedidoVentaItem` y extensión 1:1 `PedidoVentaEcommerce`; `EstadoEcommerce`, `operador_asignado_id`, `prioridad_manual`, `codigo_qr_retiro @unique` y `plazo_retiro_vencimiento`; roles/permisos HU-E10; `CameraBarcodeScanner`/`useBarcodeScanner` (Barcode Detection API y ZXing) y resolución de `VarianteSKU` por `ean_qr` o `sku`. Hay fixtures de pedidos web, no un flujo productivo HU-E12. Ninguna ruta, UI ni servicio `pick-pack` fue encontrado en `src` al redactar esta SPEC.

**PROPUESTO / APROBADO PARA IMPLEMENTACIÓN:** servicio `pick-pack` server-only que centraliza admisión, cola, toma, escaneo, prioridad y finalización; Route Handlers RBAC como adaptadores finos; pantalla móvil de cola/detalle de preparación con cámara reutilizada, cantidades requeridas/confirmadas, feedback de conflictos y botón de completar deshabilitado mientras falten unidades. El botón no reemplaza la revalidación transaccional en el servidor. El resolver de SKU/EAN puede reutilizarse como lógica; el endpoint de inventario `/api/inventario/escaner/resolver` no es una autorización para preparar pedidos.

**FUERA DE ALCANCE:** E2 confirma Mercado Pago y emite Factura B con Módulo B; E9 consulta y representa la imagen del QR al Cliente Web; E3 valida QR+DNI, realiza la entrega y marca `ENTREGADO`; E13 cancela o vence pedidos; F3 genera notificaciones internas. E12 crea el **token**, no el PNG/base64; no implementa `/validar-retiro`, reembolsos, liberación de stock vendido ni outbox. Cliente Web no es un rol RBAC interno.

---

## 3. Datos y modelo propuesto

### 3.1. Fuentes de verdad y fecha de pago

`PedidoVenta.estado` sigue gobernado por Módulo B; E12 solo muta `PedidoVentaEcommerce.estado_ecommerce`. `PedidoVentaItem.cantidad` es la cantidad requerida; `cantidad_facturada` y `cantidad_entregada` no son progreso de preparación. El catálogo no serializa prendas individuales: dos lecturas del mismo SKU confirman dos unidades **cuantitativas**, no prueban que sean dos objetos físicos distintos. `Reserva` registra cantidad congelada, no escaneos.

**Cambio Prisma PROPUESTO:** `PedidoVentaEcommerce.fecha_pago_confirmado DateTime?`, nullable inicialmente por compatibilidad y migración. **Invariante de dominio para pedidos WEB nuevos:** todo pedido que haya alcanzado `PAGO_CONFIRMADO`, `EN_PREPARACION`, `LISTO_PARA_RETIRO` o `ENTREGADO` debe tener ese campo; E2 persiste una sola vez el instante real de confirmación exitosa al establecer conceptualmente `PAGO_CONFIRMADO`, antes de invocar la admisión E12 en el mismo `Prisma.TransactionClient`. E12 solo consume esa fecha y rechaza como inconsistencia de dominio/configuración cualquier admisión sin ella. No hay fallback a `PedidoVenta.created_at`, `fecha_facturacion`, `WebhookPagoLog.created_at` ni `IngresoTesoreria.fecha`. La cola no expone pagos ni consulta `TransaccionPagoLog` para determinar prioridad.

**Pedidos legacy.** Pedidos históricos que ya estén en `EN_PREPARACION`, `LISTO_PARA_RETIRO` o `ENTREGADO` y tengan `fecha_pago_confirmado = null` permanecen visibles en la cola mientras estén en `EN_PREPARACION`. No se realiza backfill ni se fabrica una fecha histórica. En el DTO de cola `fecha_pago_confirmado` puede ser `null` únicamente para estos registros legacy; la UI debe mostrar explícitamente "Fecha de pago no disponible (registro anterior)". El orden de la cola es `prioridad_manual DESC NULLS LAST`, `fecha_pago_confirmado ASC NULLS LAST`, `PedidoVenta.id ASC`, de modo que, a igual prioridad, los pedidos con fecha conocida preceden a los legacy.

**Migración vs seed.** La migración de HU-E12 no hará backfill de `fecha_pago_confirmado`: los datos productivos históricos permanecerán `null` cuando la fecha real no pueda demostrarse. Los fixtures artificiales creados por `prisma/seed.ts` que representen pedidos pagados sí deben guardar una `fecha_pago_confirmado` sintética coherente, porque son datos nuevos de prueba y deben cumplir el invariante de pedidos nuevos. Esto no autoriza a inventar fechas productivas.

### 3.2. Persistencia de cada unidad escaneada

**Cambio Prisma PROPUESTO:** entidad `PedidoPreparacionEscaneo`, con `id` UUID, `pedido_venta_item_id` obligatorio con relación a `PedidoVentaItem`, `operador_id` obligatorio con relación a `Usuario`, `scan_id` UUID `@unique` global, `codigo_escaneado` (código literal usado en la lectura para verificar reintentos), `created_at` y `updated_at`, `is_active @default(true)`, `deleted_at`, `deleted_by` y `deletion_reason`; relaciones `onDelete: Restrict` y un índice por `pedido_venta_item_id`. El nombre de tabla y los nombres inversos de relaciones deberán ajustarse a la convención Prisma existente durante el diseño de la migración, sin cambiar la semántica. Regla N.° 1: no borrar registros de escaneo; las confirmaciones válidas son hechos operacionales y la cuenta normal solo incluye registros activos. No hacer baja lógica de escaneos como sustituto de corregir una preparación: la política de corrección manual queda fuera de alcance y requiere decisión específica si se solicita.

**Fuente autoritativa del progreso:** cada fila activa de `PedidoPreparacionEscaneo` representa una unidad confirmada; `cantidad_confirmada` se deriva exclusivamente contando, para el `pedido_venta_item_id`, registros con `is_active = true AND deleted_at IS NULL`, bajo la transacción al validar escrituras. No se agrega un contador persistido simultáneo en `PedidoVentaItem` ni se reutilizan `cantidad_facturada` o `cantidad_entregada`; tampoco existe una fila identificativa por prenda. `scan_id` se crea en el cliente por cada lectura física, se reutiliza solo para reintentar esa misma lectura y se valida como UUID; `id` de la fila lo genera el servidor. Si varias líneas del mismo pedido comparten `variante_sku_id`, se asigna bajo bloqueo a la primera línea pendiente según orden `(PedidoVentaItem.created_at ASC, PedidoVentaItem.id ASC)`. `confirmadas` nunca supera `cantidad`.

### 3.3. Prioridad, fechas y plazo

`PedidoVentaEcommerce.prioridad_manual` existente: `null` = sin preferencia; entero `1..100` = prioridad explícita; cuanto mayor, primero. Orden total: `prioridad_manual DESC NULLS LAST`, `fecha_pago_confirmado ASC NULLS LAST`, `PedidoVenta.id ASC`. La lectura de cola incluye pagados sin asignación y ya asignados mientras sigan `EN_PREPARACION`; los pedidos legacy con `fecha_pago_confirmado = null` se listan a continuación de los que tienen fecha conocida dentro de la misma prioridad. Solo se modifica prioridad cuando `operador_asignado_id IS NULL` y el estado sigue `EN_PREPARACION`; `null` retira la preferencia.

El instante de pasar a listo se captura una sola vez para calcular y guardar `plazo_retiro_vencimiento`. Fuente: `ConfiguracionSistema.clave = ECOMMERCE_PLAZO_RETIRO_DIAS`, cuyo valor de seed es únicamente un ejemplo, no un literal del servicio. Se exige entero positivo; ausencia, no numérico, fraccional o `<= 0` detiene la operación. Se suman **días calendario conservando hora local del instante de transición** en `America/Argentina/Buenos_Aires`, zona de negocio definida por `src/lib/utils/fecha-negocio.ts`; se persiste el instante resultante como `DateTime` UTC, sin confundirlo con columnas de fecha-solo ni depender del huso local del proceso. Los casos de borde cercanos a medianoche forman parte de las pruebas. E13 utiliza ese plazo posteriormente para vencimiento; E12 no ejecuta el job.

No se añaden en esta SPEC campos de inicio/listo/entrega: `updated_at` no es su sustituto; la necesidad de fechas consultables de transición debe coordinarse con E3/E9 antes de ampliar Prisma. El timestamp de listo usado en el evento y en el cálculo se captura en la transición.

---

## 4. Máquina de estados, invariantes y concurrencia

1. **Contrato interno E2 → E12:** E2 confirma el pago y establece conceptualmente `PAGO_CONFIRMADO` junto a `fecha_pago_confirmado` igual al instante real de confirmación. **Dentro de esa misma transacción de negocio y utilizando el mismo `Prisma.TransactionClient`**, E2 llama `admitirPedidoPagoConfirmado(tx, pedidoVentaId)` de E12; E12 no abre otra transacción ni publica un endpoint para admisión. La función verifica pedido `canal = WEB`, extensión e-commerce, estado `PAGO_CONFIRMADO` y fecha no nula; entonces transiciona `PAGO_CONFIRMADO → EN_PREPARACION` sin asignar operador. Si ya está correctamente admitido (`EN_PREPARACION` y fecha válida, esté o no tomado posteriormente), el reintento no cambia estado, fecha ni asignación; no trata otros estados como admisión idempotente. Ante fallo de la admisión, E2 revierte conjuntamente las escrituras locales de confirmación y admisión: el estado de pago confirmado no queda persistido fuera de la cola por una falla entre pasos. Esto no revierte un cobro externo ya efectuado en Mercado Pago, cuya reconciliación es responsabilidad de E2. E2 es dueño de la confirmación y del instante de pago; E12 solo de la transición de admisión. Los eventos de esos hechos se emiten después del commit, nunca dentro de `tx`. Mientras E2 no exista, se prueba el contrato directamente con un estado previo creado en una base PostgreSQL de test aislada. La cola operativa filtra `canal = WEB`, extensión y pedido activos, y `EN_PREPARACION`.
2. **Tomar:** en `EN_PREPARACION`, con `operador_asignado_id = null`, asignar `usuario_id` de la sesión interna que tenga `ecommerce:preparar_pedido`. El estado permanece igual. El mismo operador puede reintentar y obtener la asignación vigente sin un segundo efecto; otro operador recibe conflicto.
3. **Escanear:** se exige pedido `WEB`, `EN_PREPARACION`, activo, asignado al actor; resolver código con `ean_qr`/`sku` de variante activa, comprobar pertenencia al pedido y primera línea pendiente, y persistir una fila por unidad. Código ajeno, exceso o actor incorrecto no cambian progreso. `scan_id` identifica inequívocamente una lectura física/intento lógico. Para un `scan_id` existente, verificar **antes de elegir otra línea pendiente** que corresponde al mismo pedido, operador, código literal y SKU/ítem original; si es exactamente la misma confirmación, devolver el resultado existente sin sumar otra unidad. Reutilizarlo con otro pedido, código, SKU, ítem u operación incompatible produce `409`, sin acreditar nada ni revelar información de pedidos ajenos. Un reintento válido de lectura ya guardada no suma aun si entretanto el pedido quedó listo; nunca abre una lectura nueva sobre un pedido listo.
4. **Completar:** solo el operador asignado, con estado `EN_PREPARACION`; releer todas las líneas activas y contar sus escaneos activos en transacción. Exigir igualdad `confirmadas === cantidad` en **cada** línea y al menos una línea requerida. Si falta algo, sin cambio. Con configuración válida, escribir de forma atómica `LISTO_PARA_RETIRO`, token único y plazo. Si ese operador reintenta sobre un pedido ya listo, devolver estado vigente sin rotación de token/plazo ni nuevo evento; no exponer el token en DTO operativo. Otros actores siguen sin autorización.
5. **Terminales:** E12 no transiciona `LISTO_PARA_RETIRO → ENTREGADO`, `CANCELADO` ni `VENCIDO_SIN_RETIRO`. No borrar `codigo_qr_retiro` automáticamente tras retiro/cancelación: puede conservarse como dato histórico; solo es funcionalmente válido según estado y plazo. E9 no lo muestra fuera de listo; E3/E13 rechazan o invalidan por estado.

**Estrategia transaccional obligatoria:** todas las mutaciones sobre un pedido adquieren primero bloqueo de su agregado `PedidoVenta`/`PedidoVentaEcommerce` en orden consistente, siguiendo `$transaction` + `SELECT … FOR UPDATE` o `updateMany` condicional con comprobación de `count` ya usados en el repositorio; luego, para escaneos, bloquean las líneas `PedidoVentaItem` del pedido en orden estable antes de contar/insertar. Tomar, priorizar, escanear y completar deben revalidar estado/actor **bajo el bloqueo**, no sobre una lectura anterior. La unicidad de `scan_id` actúa como segunda guarda ante solicitudes concurrentes. Dos tomas: una gana. Dos escaneos: no se excede cantidad. Completar frente al último escaneo: o ve progreso completo y finaliza o falla sin crear QR; reintento posterior es válido. Doble completar: un único token, plazo y evento. E13 deberá tomar el mismo agregado primero y validar transición bajo ese bloqueo para evitar completar simultáneamente un pedido cancelado. No emplear locks en memoria para proteger procesos/instancias distintos.

---

## 5. Contrato de API y RBAC (rutas PREVISTAS, no implementadas)

Rutas internas bajo `app/api/ecommerce/**`; todas exigen sesión administrativa real, `withPermission` y autorización de dominio también en servicio. Respuesta conforme a convención `{ data, error }`; `401` sin sesión, `403` sin permiso; conflicto de toma, cantidad, prioridad o transición inválida responde `409`; configuración inválida impide completar sin efectos. Validar path UUID y cuerpos en servidor. `id` identifica `PedidoVenta.id`, no una cuenta o identidad provista por el cliente.

| Método y URL | Permiso | Entrada / efecto previsto |
|---|---|---|
| `GET /api/ecommerce/pick-pack/cola` | `ecommerce:leer_cola_preparacion` | Listado paginado y ordenado; datos mínimos de progreso, sin QR ni total. |
| `PATCH /api/ecommerce/pick-pack/[id]/tomar` | `ecommerce:preparar_pedido` | Sin `operador_id` del body: toma el usuario de sesión; asigna sin cambiar estado. |
| `POST /api/ecommerce/pick-pack/[id]/confirmar-item` | `ecommerce:preparar_pedido` | Body `{ scan_id: UUID, codigo: string no vacío }`; una confirmación durable por lectura. `POST` crea el hecho de escaneo y su reintento queda gobernado por `scan_id`. |
| `PATCH /api/ecommerce/pick-pack/[id]/completar` | `ecommerce:preparar_pedido` | Transición parcial del estado del pedido, coherente con rutas existentes `/reservas/[id]/confirmar` y `/ventas/turnos/[id]/cerrar`; finalización idempotente. |
| `PATCH /api/ecommerce/pick-pack/[id]/prioridad` | `ecommerce:priorizar_cola` | Body `{ prioridad_manual: number entero 1..100 | null }`; `null` quita prioridad, solo pedido libre `EN_PREPARACION`. |

El `GET` de Operador solo muestra número, fecha de pago confirmado, prioridad, estado/asignación necesaria, producto/SKU/variante, cantidades requeridas/confirmadas y progreso agregado; el Administrador puede ver lo necesario para priorizar. `fecha_pago_confirmado` se devuelve como `null` únicamente para registros legacy y la UI debe renderizar "Fecha de pago no disponible (registro anterior)", sin sustituirla por `created_at`, `fecha_facturacion`, webhook o tesorería. Seleccionar estos campos desde la consulta: no incluir `TransaccionPagoLog`, total/precio, facturación cifrada, webhook, secreto o token QR y después «ocultarlos» en el navegador. El nombre del destinatario solo si es estrictamente necesario para Pick&Pack y autorizado conforme a la política de datos. `ecommerce:validar_retiro_qr` permanece reservado a E3; `/validar-retiro` no forma parte de los endpoints implementables por E12.

**Cambio RBAC PROPUESTO:** incorporar `ecommerce:priorizar_cola` únicamente al rol Administrador E-commerce, coordinando matriz, seed y tests HU-E10. `ecommerce:leer_cola_preparacion` sigue en ambos roles y no concede escritura; `ecommerce:preparar_pedido` y `ecommerce:validar_retiro_qr` mantienen su segregación. Jamás autorizar `prioridad` comparando `Rol.nombre`.

### 5.1. Categorías de error (sin fijar todavía códigos internos definitivos)

| Categoría | Respuesta HTTP conceptual | Regla |
|---|---|---|
| `scan_id`/ID/cuerpo mal formado, código vacío o prioridad fuera de `1..100` y distinta de `null` | `400` | Entrada inválida: no escribir. |
| Sin sesión / sin permiso RBAC | `401` / `403` | Aplicar la convención `withPermission`; no interpretar el rol por nombre. |
| Pedido inexistente o pedido no `WEB` (o sin extensión e-commerce operativa) | `404` | Misma superficie de no encontrado, sin revelar existencia de pedidos de otro canal. |
| Operador autenticado distinto del asignado | `403` | Autorización por asignación del agregado, aun cuando tenga el permiso RBAC. |
| Estado inválido; pedido ya asignado a otro; código/SKU que no pertenece al pedido; cantidad ya completa; `scan_id` usado en otro pedido, código, SKU, ítem u operación; preparación incompleta; prioridad sobre pedido tomado o fuera de estado; carrera al tomar/escanear/completar | `409` | Conflicto de dominio o concurrencia: no acreditar unidad ni ejecutar transición parcial. Un reintento idéntico del mismo operador/lectura no es conflicto. |
| Fecha de pago ausente al admitir | Sin respuesta HTTP E12: fallo de dominio/configuración en el contrato interno `tx` | E2 revierte la transacción local completa; nunca aplicar fallback. |
| `ECOMMERCE_PLAZO_RETIRO_DIAS` ausente o inválida | Fallo de configuración del servidor, **no** `400` atribuible al cliente; mapear a `500` si se invocó desde HTTP | Rollback integral; sin QR, estado nuevo ni evento. |

Los códigos de error de aplicación y el texto de respuesta se definirán al implementar los handlers; esta tabla fija categorías, no introduce un endpoint para la admisión.

---

## 6. Token, eventos y auditoría

**Token:** en la primera finalización válida generar 32 bytes aleatorios con CSPRNG de `node:crypto`, codificados de manera URL-safe como token opaco. Guardar solo en `PedidoVentaEcommerce.codigo_qr_retiro` (`@unique`), en la transacción de transición/plazo; tratar una eventual colisión única como conflicto seguro y no dejar un estado listo sin token. No codificar identificador interpretable de pedido, DNI, nombre, email, importe ni datos de Mercado Pago. No generar ni guardar PNG/base64 ni usar el QR fiscal `ComprobanteFiscal.qr_data_url`. El token nunca aparece en respuestas de cola, escaneo o completar, logs ni payloads de eventos. E9 genera la imagen bajo demanda y E3 valida contra el estado y el plazo.

**Eventos PROPUESTOS:** `ecommerce:pedido_tomado`, `ecommerce:pedido_listo_para_retiro` y `ecommerce:unidad_preparacion_confirmada`. Los tres se emiten **solo después de que la transacción correspondiente haya hecho commit**. Los eventos de transición de estado llevan `{ evento_id: UUID, pedido_venta_id, estado_anterior, estado_nuevo, actor_id, timestamp }`. En `pedido_tomado`, ambos estados son `EN_PREPARACION` (asignación, no transición); el evento listo marca `EN_PREPARACION → LISTO_PARA_RETIRO` y se publica **una sola vez** en el primer `completar` exitoso. La admisión propone `ecommerce:pedido_admitido_cola` para `PAGO_CONFIRMADO → EN_PREPARACION` y la priorización propone `ecommerce:prioridad_preparacion_cambiada` con valor anterior/nuevo, actor y timestamp; ambos son contratos E12 previstos, no tipos registrados todavía en el bus. Ningún evento expone el token.

`ecommerce:unidad_preparacion_confirmada` se emite **solo cuando una lectura física acredita una nueva unidad** (inserción exitosa en `PedidoPreparacionEscaneo`). Payload previsto:

- `evento_id`: UUID
- `pedido_venta_id`
- `pedido_venta_item_id`
- `variante_sku_id`
- `actor_id`
- `cantidad_confirmada_anterior`
- `cantidad_confirmada_nueva`
- `timestamp`

No incluye token QR, DNI, datos de Mercado Pago ni el código de barras literal salvo decisión posterior explícita. El listener central de Módulo D registra el hecho en `AuditLog`, manteniendo `PedidoPreparacionEscaneo` como fuente operacional del progreso. Un reintento idéntico del mismo `scan_id` no inserta ni genera un segundo evento ni un segundo asiento de auditoría. Un scan rechazado (código ajeno, exceso de cantidad, actor no asignado o estado inválido) no modifica el progreso ni genera el evento de confirmación.

**Auditoría:** `PedidoPreparacionEscaneo` sigue siendo la fuente operacional del progreso y la trazabilidad detallada de cada unidad. Además, cada confirmación **nueva y exitosa** genera el evento `ecommerce:unidad_preparacion_confirmada` post-commit, que el listener central de Módulo D registra como hecho de auditoría en `AuditLog`. El listener también registra los hechos relevantes del agregado: ingreso a cola, toma/asignación, cambio de prioridad y finalización/transición a `LISTO_PARA_RETIRO`, incluida la generación de QR **como hecho, nunca con el valor de `codigo_qr_retiro`**. Mantener ID de correlación y actor; no incluir DNI, email, datos de pago ni PII innecesaria. F3 consume `ecommerce:pedido_listo_para_retiro` para notificar al cliente; E12 no crea `Notificacion` ni llama directamente a F3.

**Durabilidad y fallos:** el bus actual es `EventEmitter` in-process y la práctica es emisión post-commit. La BD es fuente autoritativa: un fallo del listener/F3 no revierte `LISTO_PARA_RETIRO`. Esta HU **no** implementa outbox ni promete entrega `at-least-once` ante caída entre commit y emisión; si se exige entrega garantizada o auditoría atómica, resolver arquitectura transversal con F3/Módulo D antes de afirmar esa garantía. Reintentos de `completar` no deben emitir otra notificación; eso implica que el mecanismo actual no recupera por sí solo una emisión perdida.

---

## 7. Testing contractual y escenarios Given/When/Then

**Plan, NO resultados ejecutados.** Unitarios de reglas, orden total, fechas de negocio/configuración, idempotencia, DTOs y eventos/auditoría de confirmación de unidad; integración Prisma/PostgreSQL en base aislada con fixtures propios para constraints, bloqueos y carreras; tests HTTP/RBAC con sesiones reales, y pruebas UI de escáner/progreso/segregación. No usar base compartida ni ejecutar seed como parte de tests. Validar también `lint`, `tsc --noEmit`, `build` y documentación. Escenarios mínimos:

| Caso | Given / Cuando / Entonces |
|---|---|
| Cola y admisión | **Dado** E2 con pedido WEB `PAGO_CONFIRMADO` y fecha real, dentro de su `tx` / **cuando** llama `admitirPedidoPagoConfirmado(tx, id)` dos veces / **entonces** queda `EN_PREPARACION` una sola vez y sin asignación; si la admisión falla, E2 revierte sus escrituras locales; MOSTRADOR o falta de fecha no ingresan. |
| Orden natural y empates | **Dados** pedidos libres con prioridad `null` y diferentes fechas, y dos con igual prioridad/fecha / **cuando** se lista / **entonces** se ordenan por fecha ascendente y, en empate, por ID estable; prioridad mayor precede a menor y `null` queda al final. |
| Prioridad | **Dado** pedido libre en preparación / **cuando** Admin con permiso asigna 1..100 o `null` / **entonces** cambia orden y se audita; valor fuera de rango o pedido ya tomado/terminado no cambia nada. |
| Toma y carrera | **Dado** pedido sin asignar / **cuando** dos operadores intentan tomar en paralelo / **entonces** exactamente uno queda asignado; su reintento es idempotente, el otro recibe conflicto y el estado no cambia. |
| SKU válido y repetido | **Dados** SKU con cantidad 2 o repetido en dos líneas / **cuando** llegan lecturas con `scan_id` diferentes / **entonces** cada una acredita una unidad, llenando primero la línea pendiente de menor `(created_at, id)`. |
| Idempotencia y exceso | **Dada** una lectura ya confirmada / **cuando** se reenvía su `scan_id` con igual pedido, actor, código, SKU e ítem / **entonces** responde idempotente sin sumar; reutilizarlo para otro pedido, código, SKU, ítem u operación da `409`; un nuevo `scan_id` tras completar la cantidad da exceso sin inserción. |
| Confirmación auditada | **Dado** un pedido asignado con una línea de cantidad 2 / **cuando** escanea dos veces con `scan_id` distintos, reenvía el primer `scan_id` e intenta un tercer scan con código ajeno / **entonces** `PedidoPreparacionEscaneo` contiene exactamente dos filas activas, se emiten y auditan dos eventos `ecommerce:unidad_preparacion_confirmada`, el reintento idéntico no genera un tercer evento ni asiento, y el scan rechazado no genera evento. |
| Código ajeno y actor | **Dado** pedido asignado / **cuando** se envía SKU no perteneciente o escanea otro operador / **entonces** se rechaza sin confirmar ni revelar información financiera. |
| Completar incompleto | **Dado** al menos un ítem con confirmadas < requeridas / **cuando** el asignado completa / **entonces** no cambia estado, no crea token/plazo ni emite listo. |
| Completar y plazo | **Dados** todos los ítems confirmados y configuración positiva / **cuando** el asignado completa / **entonces** estado, token único y vencimiento en días calendario de Argentina quedan guardados juntos; evento listo se emite tras commit. |
| Configuración inválida | **Dada** clave ausente, no numérica, fraccional o no positiva / **cuando** completa / **entonces** rollback integral, sin QR, cambio de estado ni evento. |
| Doble completar | **Dado** pedido ya listo / **cuando** el mismo asignado reintenta / **entonces** no rota token ni plazo ni reemite evento. |
| Último escaneo concurrente | **Dado** un ítem a una lectura de completarse / **cuando** escaneo y completar compiten / **entonces** completar ve el escaneo confirmado o falla sin transición; ninguna cantidad excede el máximo. |
| Cancelación concurrente | **Dado** pedido en preparación / **cuando** E13 cancela mientras E12 completa / **entonces** solo una transición coherente prevalece bajo bloqueo común, sin pedido cancelado que se vuelva listo. |
| Permisos y datos | **Dadas** solicitudes sin sesión, sin permiso, de un pedido no WEB y con permiso de lectura pero no de prioridad / **cuando** se invocan rutas / **entonces** corresponden `401`/`403`/rechazo de dominio, sin datos sensibles ni capacidad de priorizar por rol inferido. |
| F3 falla | **Dada** transición a listo confirmada / **cuando** falla consumidor de notificación / **entonces** estado y plazo persisten; no se promete reentrega durable con el bus actual. |

Las pruebas de integración deben comprobar en PostgreSQL real `scan_id @unique`, conteo exclusivo de escaneos activos (`is_active = true AND deleted_at IS NULL`), el invariante de fecha en nuevos pedidos WEB, admisión bajo el `tx` de E2 con rollback, dos tomas y escaneos simultáneos, y doble completar; las pruebas de servicio verifican ausencia de QR/PII en DTO y payload. Una prueba aislada de borde de medianoche en `America/Argentina/Buenos_Aires` comprueba los días calendario. Los tests HTTP verifican que `operador_id` nunca provenga confiablemente de query/body/form.

---

## 8. Dependencias, discrepancias y puntos abiertos

**DEPENDENCIA EXTERNA — HU-E2:** E2 produce `PAGO_CONFIRMADO` y persiste `fecha_pago_confirmado` antes de invocar `admitirPedidoPagoConfirmado(tx, pedidoVentaId)` **en el mismo `Prisma.TransactionClient` y antes del commit**. E2 debe integrar una secuencia local componible bajo ese `tx` y emitir sus eventos después del commit; la coordinación con sus servicios de Módulo A/B no presupone que las operaciones externas de pago participen de una transacción PostgreSQL. Definir backfill/compatibilidad de pedidos confirmados previos a la migración sin inventar timestamps. E12 puede probar el contrato sobre estado previo en base aislada, pero no demostrar integración productiva con Mercado Pago hasta E2.

**DEPENDENCIA EXTERNA — HU-E10:** incorporar `ecommerce:priorizar_cola` exclusivo de Administrador a matriz/seed/tests; hoy §2.10 y HU-E10 solo conceden lectura compartida y §2.12 propone lectura + nombre de rol, incompatible con autorización por permiso.

**DEPENDENCIA EXTERNA — HU-E9 / E3 / E13 / F3:** E9 muestra QR; E3 valida QR+DNI/entrega; E13 cancela/vence y debe acordar orden de bloqueo; F3 consume eventos y resuelve destinatarios/notificaciones. La reversión de stock vendido de E13 es dependencia del Módulo A y no se implementa aquí.

**Discrepancias documentales que esta SPEC no modifica silenciosamente:** `spec_modulo_E.md` §2.3 da a entender que endpoints ya existen; §2.12 mezcla `POST` y `PATCH` en `confirmar-item`, permite «tomar» como alternativa de ingreso y atribuye la notificación a E9/F3; lista `/validar-retiro` dentro de §2.12 aunque su implementación corresponde a E3. Este contrato define `POST /confirmar-item`, admisión distinta de toma y E12 productor/F3 consumidor. Al aprobar la SPEC, coordinar después las correcciones en la especificación general, sin editarlas en esta fase.

**Coordinación para el PLAN, sin reabrir el contrato:** la admisión E2→E12 queda cerrada como llamada interna en el mismo `tx`; documentar la composición de servicios E2/A/B y el momento post-commit de los eventos. Siguen como tareas de planificación la migración y el tratamiento de filas históricas sin fecha comprobable, la integración futura de F3 (el bus no garantiza entrega durable), la eventual política de corrección manual de escaneos y, si se requieren fechas consultables de inicio/listo/entrega, la coordinación con E3/E9. Ninguno autoriza fallbacks silenciosos ni cambia los criterios de esta HU.

**Archivos compartidos con alto riesgo de conflicto:** `prisma/schema.prisma`, migraciones, `prisma/seed.ts`, `src/lib/events/event-types.ts`, `src/lib/events/listeners/audit-log.listener.ts`, documentación RBAC HU-E10 y `docs/specs/spec_modulo_E.md`. Requieren coordinación con sus owners; esta fase no los modifica.

---

## 9. Definition of Done y archivos previstos

HU-E12 **NO está Done**. Solo podrá considerarse Done tras aprobación de esta SPEC, migración necesaria aplicada, servicios y rutas implementados, UI Pick&Pack operativa, RBAC y segregación verificados, concurrencia probada con PostgreSQL aislado, pruebas unitarias/de integración/HTTP-RBAC y de UI, `lint` sin errores, TypeScript y build correctos, documentación actualizada y contrato E2/F3 definido. Si E2 no entrega todavía pedidos productivos, la cobertura equivalente con fixtures aislados es obligatoria; no presentar esa cobertura como integración end-to-end de Mercado Pago.

| Archivo o área | Estado al escribir esta SPEC |
|---|---|
| `prisma/schema.prisma` y migración E12 | Propuestos: fecha real de pago y entidad de escaneo; **sin modificar**. |
| `src/lib/services/ecommerce/pick-pack.service.ts` y tests | Previsto; no existente. |
| `src/app/api/ecommerce/pick-pack/**` y tests HTTP | Previsto; no existente. |
| `src/app/(dashboard)/ecommerce/pick-pack/**` y componentes/tests | Previsto; no existente. |
| `src/lib/events/event-types.ts`, listener de auditoría, matriz/seed HU-E10 | Integración futura en archivos compartidos; sin modificar. |
| `docs/modulos/modulo E/HU12_MODULO_E.md` | Solo especificación previa, sin implementación. |

---

## 10. Evidencia de implementación y verificación (T10)

Sección agregada al cierre de HU-E12. La SPEC contractual de las secciones 1–9 se mantiene intacta; esta sección documenta qué se construyó, cómo se verificó y qué limitaciones quedan registradas. No modifica requisitos.

### 10.1. Arquitectura final implementada

| Capa | Implementación | Archivos |
|---|---|---|
| Modelo | `PedidoVentaEcommerce.fecha_pago_confirmado DateTime?`, `PedidoPreparacionEscaneo` (`scan_id @unique`, FK `Restrict`, baja lógica) | `prisma/migrations/20261001212437_hu_e12_pick_pack/` |
| RBAC | `ecommerce:leer_cola_preparacion` (Admin + Operador), `ecommerce:preparar_pedido` (Operador), `ecommerce:priorizar_cola` (Admin) | `prisma/seed.ts`, `roles-hu-e10.test.ts` |
| Schemas/DTO | Zod estrictos de cola, path UUID, prioridad, scan, bodies vacíos; DTOs sin QR/PII/pagos | `src/lib/schemas/pick-pack.schema.ts`, `src/lib/services/ecommerce/pick-pack.types.ts` |
| Dominio | `admitirPedidoPagoConfirmado`, `listarColaPreparacion`, `tomarPedido`, `actualizarPrioridad`, `confirmarItem`, `completarPreparacion` | `src/lib/services/ecommerce/pick-pack.service.ts` |
| Integración E2 | `confirmarPago` invoca la admisión como última mutación de dominio dentro del mismo `TransactionClient`, con locks `PedidoVenta → PedidoVentaEcommerce → PedidoVentaItem(s)` | `src/lib/services/ecommerce/pago-web.service.ts` |
| HTTP | Route Handlers finos con `withPermission`, Zod y mapper de errores | `src/app/api/ecommerce/preparacion/**` |
| Frontend | Consola mobile-first con cola, prioridad, toma, detalle, cámara (`CameraBarcodeScanner` existente) y entrada manual | `src/app/(dashboard)/ecommerce/preparacion/`, `src/components/ecommerce/` |

### 10.2. Desviación documentada respecto a §5

La tabla de rutas de §5 era **prevista** (`/api/ecommerce/pick-pack/cola`, `PATCH tomar`, `POST confirmar-item`, `PATCH completar`). La instrucción de implementación T08 aprobó y fijó los paths productivos distintos:

| SPEC §5 (previsto) | Implementado (aprobado en T08) |
|---|---|
| `GET /api/ecommerce/pick-pack/cola` | `GET /api/ecommerce/preparacion` |
| `PATCH .../tomar` | `POST /api/ecommerce/preparacion/[id]/tomar` |
| `POST .../confirmar-item` | `POST /api/ecommerce/preparacion/[id]/scan` |
| `PATCH .../prioridad` | `PATCH /api/ecommerce/preparacion/[id]/prioridad` |
| `PATCH .../completar` | `POST /api/ecommerce/preparacion/[id]/completar` |

La semántica contractual se conserva íntegra (permisos, entradas, idempotencia, códigos de error); solo cambian path y verbo de `tomar`/`completar`/`confirmar-item`. La corrección de `spec_modulo_E.md` §2.12 queda pendiente de coordinación con su owner (ver §8).

### 10.3. Matriz SPEC → implementación → test → estado

| Requisito / AC | Implementación | Test | Estado |
|---|---|---|---|
| CA1 admisión en tx de E2 | `admitirPedidoPagoConfirmado(tx)` última mutación de `confirmarPago` | `pick-pack.admision` (8), `hu-e2-e12` (11) | CUMPLE |
| CA2 cola ordenada | `listarColaPreparacion` con orden `prioridad DESC NULLS LAST, fecha ASC NULLS LAST, id ASC` | `pick-pack.integration` cola | CUMPLE |
| CA3 prioridad 1..100/null | `actualizarPrioridad`, solo libre `EN_PREPARACION` | dominio + HTTP + UI | CUMPLE |
| CA4 toma exclusiva | `updateMany` condicionado + lock agregado | concurrencia 2 operadores | CUMPLE |
| CA5 una lectura = una unidad | fila por escaneo, conteo de activos | SKU/EAN, SKU repetido | CUMPLE |
| CA6 scan_id idempotente | `@unique` + verificación pedido/actor/código/ítem | retry, conflicto, carrera | CUMPLE |
| CA7 control de acceso | actor = sesión; asignación revalidada bajo lock | 403 actor distinto | CUMPLE |
| CA8 finalización una vez | tx con token+plazo+estado; retry conserva | doble completar, carrera | CUMPLE |
| CA9 configuración plazo | `ECOMMERCE_PLAZO_RETIRO_DIAS` entero > 0, rollback si inválida | config 0/neg/decimal/ausente | CUMPLE |
| CA10 trazabilidad | eventos post-commit + `AuditLog`, token nunca viaja | `pick-pack.audit` (9) | CUMPLE |
| CA11 permisos | `withPermission`, actor por sesión | 401/403/404/409 HTTP | CUMPLE |
| Legacy fecha null | DTO `null`, orden `NULLS LAST`, texto UI | HTTP + frontend | CUMPLE |
| QR 32B base64url único | `randomBytes(32)`, `@unique`, solo persistido | token 32B, sin exposición | CUMPLE |
| Fecha pago `date_approved` | E2 persiste una vez; sin fallbacks | fallback controlado, retry | CUMPLE |
| Plazo días calendario AR | `fecha-negocio` + instante de transición | medianoche, retry conserva | CUMPLE |
| Eventos post-commit | 5 eventos E12 + relación con `pedido_pago_confirmado` | `pick-pack.eventos` (23 TAP) | CUMPLE |
| Concurrencia último cupo | locks agregado+líneas + `scan_id @unique` | carreras A–G §10.6 | CUMPLE |
| Frontend operativo | consola RBAC, scanner, progreso, completar | 22 tests UI/helpers | CUMPLE |

### 10.4. Endpoints productivos

`GET /api/ecommerce/preparacion` (`ecommerce:leer_cola_preparacion`) · `POST .../tomar` · `PATCH .../prioridad` (`ecommerce:priorizar_cola`) · `POST .../scan` · `POST .../completar` (`ecommerce:preparar_pedido`). Mapeo: `400` validación Zod · `401` sin sesión · `403` RBAC/`OPERADOR_NO_AUTORIZADO` · `404` `PEDIDO_NO_OPERABLE` · `409` conflictos de dominio · `500` configuración/inconsistencia/error interno. Ningún endpoint devuelve `codigo_qr_retiro`, MP ids, PII ni `codigo_escaneado`.

### 10.5. Eventos emitidos (post-commit, payload mínimo, sin token)

`ecommerce:pedido_admitido_cola` (devuelto a E2 como `evento_pendiente`), `ecommerce:pedido_tomado`, `ecommerce:prioridad_preparacion_cambiada`, `ecommerce:unidad_preparacion_confirmada`, `ecommerce:pedido_listo_para_retiro`. Relación E2: `pedido_pago_confirmado` precede a `pedido_admitido_cola`. Toda emisión post-commit está aislada con try/catch: un listener fallido no revierte el commit ni impide el siguiente evento.

### 10.6. Concurrencia verificada en PostgreSQL real

(A) dos operadores tomando → exactamente uno asigna · (B) dos scans por último cupo → exactamente uno inserta · (C) mismo `scan_id` concurrente → una sola fila · (D) último scan vs completar → transición coherente · (E) doble completar → un token/plazo/evento · (F) dos callbacks MP → una confirmación y una admisión · (G) E2 y E12 concurrentes sobre el mismo agregado → sin deadlock, misma jerarquía de locks.

### 10.7. Resultados de tests (convención: conteo TAP incluyendo wrappers)

| Suite | Pass |
|---|---|
| `pick-pack.test.ts` + `fecha-negocio.test.ts` | 33 |
| `pick-pack.admision.integration.test.ts` | 8 |
| `pick-pack.integration.test.ts` | 51 |
| `pick-pack.eventos.test.ts` | 23 |
| `pick-pack.audit.integration.test.ts` | 9 |
| `hu-e2-e12.integration.test.ts` | 11 |
| `hu-e2.integration.test.ts` | 11 |
| `hu-e12.http.integration.test.ts` | 24 |
| Frontend `pick-pack.client.test.ts` + `ConsolaPickPack.test.tsx` | 22 |
| **Total** | **192 pass / 0 fail** |

Ejecutado con `--test-concurrency=1` sobre PostgreSQL 16 aislado (`swat_erp_test_e12`). Checks estáticos: `prisma format --check` ✓, `prisma validate` ✓, `tsc --noEmit` ✓, `lint` 0 errores, `next build` ✓, `git diff --check` limpio, sin marcadores de merge.

### 10.8. Limitaciones y deuda técnica registrada

1. **Ledger `AuditLog` in-process:** la serialización de la cadena de hash es por proceso; múltiples procesos/instancias no tienen exclusión global demostrada y el ledger puede bifurcar. Riesgo transversal del proyecto, no específico de E12. No se corrige en esta HU.
2. **Event bus in-process:** `EventEmitter` sin outbox, sin entrega durable, sin reintento automático ni exactly-once. E12/E2 aíslan errores de listeners para no convertir commits válidos en falsos errores. Una emisión perdida entre commit y listener no se recupera por sí sola — deuda transversal documentada en §6.
3. **`fecha-negocio` con offset fijo UTC-3:** Argentina se resuelve con offset fijo en lugar de IANA dinámico; observación técnica, convención vigente del proyecto.
4. **Rutas previstas vs implementadas:** ver §10.2 — cambio aprobado en T08; queda alinear `spec_modulo_E.md` §2.12 con su owner.
5. **`"use server"` removido de `pick-pack.service.ts` (T08):** Next.js interpreta un archivo con esa directiva como Server Actions y exige que todo export sea `async`; `calcularProgreso` es síncrono y su importación desde Route Handlers devolvía 500. Se conserva `import "server-only"`. Si T09/otro módulo requiere Server Actions de este dominio, crear un wrapper `actions.ts` con la directiva.

### 10.9. Dependencias restantes (fuera de alcance E12)

- **E9:** historial/estado del pedido para el Cliente Web y representación visual del QR bajo demanda (E12 solo genera el token; no hay imagen ni endpoint de QR).
- **E3:** validación QR + DNI en el punto de retiro y transición `LISTO_PARA_RETIRO → ENTREGADO` (`ecommerce:validar_retiro_qr` reservado).
- **E13:** cancelación, vencimiento por `plazo_retiro_vencimiento` y reembolso/reversión coordinada.
- **F3:** consumo de los eventos para notificaciones internas/cliente; el bus actual no garantiza entrega durable.

**Veredicto:** HU-E12 implementada y verificada — lista para entrega/merge.
