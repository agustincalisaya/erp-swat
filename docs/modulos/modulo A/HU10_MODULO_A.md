# HU-A10 — Servicio Centralizado de Reserva: Congelamiento y Liberación (Módulo A)

**Estado:** Implementado y verificado en Sprint 2 — 60/60 tests (16 nuevos + 44 preexistentes), `tsc --noEmit` y `eslint` limpios. Ver sección 1.6 para el detalle exacto de qué está confirmado y qué queda como deuda técnica documentada.
**Metodología:** Specification-Driven Development (SDD) con Claude Code.
**Documentos fuente:** `RULES.md`, `spec_modulo_A.md` (sección 2.9), `schema.prisma`, `task_HU-A10.md`

---

# PARTE 1 — Referencia Técnica (estado actual, verificado)

> Esta sección describe **cómo funciona la funcionalidad hoy**, confirmado con `npm test`, `tsc --noEmit` y `eslint` sobre el código real entregado por Claude Code. Para el proceso de cómo se llegó a este estado, ver la Parte 2 — Historial de Desarrollo.

## 1.1. Alcance funcional

**Actor:** Sistema (sin actor humano — HU sin Frontend/UI).

**Objetivo:** exponer una única interfaz de congelamiento y liberación del estado "Reservado" por SKU y depósito, para que el Módulo A gobierne de forma centralizada esa máquina de estados y ningún otro módulo (B — cotización institucional, E — checkout web) implemente lógica de reserva propia cuando se integren en sprints futuros.

Cubre los 3 orígenes de reserva válidos (`SENIA`, `LICITACION`, `PEDIDO_INSTITUCIONAL`) y las 2 vías de liberación (venta confirmada, TTL vencido).

**Explícitamente fuera de alcance de esta HU:** ninguna pantalla ni Server Action de formulario — la interfaz que consumirá este servicio se construye recién con HU-B3 y HU-E1, ninguna de las dos planificada en este sprint. Tampoco se implementa lógica de esas dos HUs, solo el contrato que van a consumir.

## 1.2. Semántica de dominio

```
DISPONIBLE  →  (congelamiento)  →  RESERVADO  →  (venta)      →  VENDIDO
                                        └────  →  (TTL vencido) →  DISPONIBLE
```

El congelamiento nunca es un movimiento de entrada/salida real de mercadería — es una redistribución de la misma cantidad física entre "disponible comercialmente" y "reservado". La liberación por venta es la única transición que representa una salida definitiva. La liberación por TTL es la reversión exacta e inversa del congelamiento.

## 1.3. Modelo de datos

Sin migraciones nuevas — `Reserva` y el enum `OrigenReserva` ya existían migrados (`20260823074225_init` y `20260831031138_sprint2` respectivamente), verificado contra la base real con `npx prisma migrate status` antes de escribir código (ver 2.2).

`Reserva` no persiste el TTL de ninguna reserva individual (ni `ttl_horas` ni `fecha_expiracion`) — solo `fecha_inicio_reserva`. Esto tiene una consecuencia funcional real documentada en 1.5.

## 1.4. Endpoints implementados y verificados

| Endpoint | Método | Estado | Verificación |
|---|---|---|---|
| `/api/inventario/reservas` | `POST` | ✅ Implementado | Congelamiento válido (`201`), stock insuficiente (`422 STOCK_INSUFICIENTE`) |
| `/api/inventario/reservas/[id]/confirmar` | `PATCH` | ✅ Implementado | Liberación por venta válida (`200`), reserva ya cerrada/inactiva (`409 RESERVA_NO_ACTIVA`/`RESERVA_INACTIVA`) |
| `/api/cron/check-pruebas-vencidas` | `POST` (antes `GET`) | ✅ Implementado | Liberación por TTL — lógica movida a servicio, verificado contra el precedente ya existente del cron original |

Los tres delegan exclusivamente en `reserva.service.ts` (`crearReserva()`, `confirmarReservaPorVenta()`, `liberarReservasVencidas()`) — sin lógica de negocio duplicada entre Route Handler y servicio.

**Nombre de ruta del cron, mantenido deliberadamente:** `check-pruebas-vencidas` es remanente del diseño original previo a la cancelación de HU-A3 (Stock En Prueba). Se conserva porque ya está referenciado en el comentario del modelo `Reserva` en `schema.prisma`; no renombrar evita divergencia entre el schema y el código sin ningún beneficio funcional a cambio.

## 1.5. Registro de `MovimientoStock` por transición

| Transición | `tipo_movimiento` | `estado_origen` → `estado_destino` |
|---|---|---|
| Congelamiento | `AJUSTE` | `DISPONIBLE` → `RESERVADO` |
| Liberación por venta | `EGRESO` | `RESERVADO` → `VENDIDO` |
| Liberación por TTL | `INGRESO` (compensatorio) | `RESERVADO` → `DISPONIBLE` |

El tipo de la liberación por venta no salió resuelto de la task original con el mismo nivel de detalle que las otras dos filas — quedó fijado en revisión posterior a la primera entrega (ver 2.4).

**Limitación conocida, documentada en código:** el cron aplica un umbral fijo de 72h por `origen_reserva` para decidir qué reservas liberar. Una reserva de e-commerce con `ttl_horas` explícito y más corto que 72h (caso previsto por la spec para HU-E1) es aceptada y respondida correctamente en el `201` del congelamiento, pero el cron no la va a liberar antes de las 72h reales — el valor de `ttl_horas` recibido queda solamente informativo, no alimenta ninguna query de vencimiento. Comentario en código, en `liberarReservasVencidas()`:

> `// LIMITACIÓN CONOCIDA: cron aplica 72h fijo por origen, no respeta ttl_horas explícito de e-commerce — resolver al implementar HU-E1`

No resuelto en esta HU porque implica una decisión de diseño (persistir `fecha_expiracion` en `Reserva`, con migración nueva, vs. que Módulo E gestione su propio vencimiento de forma independiente) que corresponde tomar recién cuando exista HU-E1 real contra la cual decidir.

## 1.6. Resumen de verificación

| Pieza | Estado |
|---|---|
| Congelamiento — patrón de decremento atómico condicionado | ✅ Verificado, `npm test` (mismo patrón que `transferencia.service.ts`, molde canónico del repo) |
| Congelamiento — `MovimientoStock` de auditoría (`AJUSTE`) | ✅ Verificado |
| Liberación por venta — no reincrementa stock, transición a `VENDIDO` | ✅ Verificado |
| Liberación por venta — `MovimientoStock` (`EGRESO`) | ✅ Verificado, corregido en revisión posterior — ver 2.4 |
| Liberación por TTL — reversión + `MovimientoStock` compensatorio (`INGRESO`) | ✅ Verificado |
| Eventos de dominio (`stock:reserva_congelada`, `stock:reserva_liberada`) emitidos post-commit | ✅ Verificado, patrón fire-and-forget consistente con el resto del proyecto |
| Liberación por TTL — 3 orígenes generales (72h fijo) | ✅ Verificado |
| Liberación por TTL — respeta `ttl_horas` variable de e-commerce | ⚠️ No implementado, deuda documentada — no bloqueante porque HU-E1 no existe todavía, ver 1.5 |
| Frontend/UI | N/A — fuera de alcance explícito de esta HU (actor "Sistema") |
| Consumo del servicio por HU-B3/HU-E1 | ⛔ No aplica todavía — ninguna de las dos está planificada en este sprint; queda como nota técnica pendiente para cuando se implementen (ver spec §2.9) |

## 1.7. Eventos de dominio

| Evento | Disparador | Payload |
|---|---|---|
| `stock:reserva_congelada` | Congelamiento | `reserva_id`, `variante_sku_id`, `deposito_id`, `usuario_id`, `origen_reserva`, `cantidad` |
| `stock:reserva_liberada` | Liberación (venta o TTL) | `reserva_id`, `motivo_liberacion: "VENTA" \| "TTL_VENCIDO"`, `variante_sku_id`, `cantidad` |

Ambos emitidos siempre después del `COMMIT`, nunca dentro de la transacción — mismo patrón fire-and-forget ya usado por el resto de Módulo A. Consumidos por `audit-log.listener.ts` (`accion: "RESERVA_CONGELADA"` / `"RESERVA_LIBERADA"`, `tabla_afectada: "reservas"`).

**Decisión de payload confirmada, no ampliada:** `stock:reserva_liberada` no incluye `usuario_id` — la vía VENTA queda auditada sin actor explícito en el evento, igual que la vía TTL (que por definición no tiene actor humano). Evaluado como ampliación de contrato a decidir explícitamente si se necesita en el futuro, no como omisión — anotado en `event-types.ts`.

## 1.8. Permisos (RBAC)

| Permiso | Acción | Roles |
|---|---|---|
| `inventario:reservar_stock` | Congelamiento | `ENCARGADO_DEPOSITO`, `ADMINISTRADOR` |
| `inventario:confirmar_reserva` | Confirmación por venta | `ENCARGADO_DEPOSITO`, `ADMINISTRADOR` |

Granulares y separados, siguiendo el mismo molde ya usado por `transferir_stock`/`confirmar_recepcion`. El cron no usa `withPermission` — se autentica vía `Authorization: Bearer <CRON_SECRET>`, documentado en `.env.example`.

**Pendiente, anotado en el seed:** ningún rol de Módulo B/E existe todavía en el sistema para asignarle estos permisos cuando corresponda consumir el servicio desde esos módulos.

---

# PARTE 2 — Historial de Desarrollo (proceso SDD)

## 2.1. Contexto de la tarea original

HU tomada directamente de la fila de Sprint 2 (Módulo A, HU-A10, actor Sistema, 5 puntos de historia), con criterios de aceptación ya bastante específicos en el Backlog. Antes de generar la task para Claude Code, se hizo un análisis de trazabilidad explícito confirmando que `spec_modulo_A.md` sección 2.9 ya contractualizaba los 4 criterios de aceptación uno por uno, y se confirmó con el equipo que la HU es 100% backend — sin ambigüedad de alcance de Frontend que resolver antes de arrancar.

## 2.2. Relevamiento de estado real (previo a implementar)

Instrucción explícita del prompt: relevamiento obligatorio antes de escribir código, con aprobación posterior. Resultado reportado por Claude Code:

- `npx prisma migrate status` confirmó las 6 migraciones aplicadas, incluida la del modelo `Reserva` y el enum `OrigenReserva` — sin necesidad de migración nueva, confirmando lo ya anticipado en la task.
- No existía `reserva.service.ts` ni ninguna ruta `app/api/inventario/reservas/*` — superficie completamente nueva, sin código previo que reconciliar.
- El patrón canónico de decremento atómico condicionado ya estaba resuelto y probado en `transferencia.service.ts` (`crearTransferencia()`), tomado como molde directo.
- **Hallazgo no anticipado por la task:** el cron `check-pruebas-vencidas` ya existía con la lógica de liberación por TTL **inline en el Route Handler**, no en un servicio — y sin emitir ningún evento de dominio. La task pedía refactorizar hacia `liberarReservasVencidas()` en el servicio; el relevamiento confirmó que ese refactor era necesario, no opcional, porque el código preexistente no cumplía la regla de "lógica de negocio exclusivamente en `lib/services/`".
- **Hallazgo de diseño real, elevado como pregunta antes de codear:** `Reserva` no tiene ninguna columna para persistir el TTL de una reserva individual — solo `fecha_inicio_reserva`. Esto significa que el cron, tal como está diseñado en el schema actual, solo puede aplicar un umbral fijo por `origen_reserva`, no un TTL variable por reserva. Se identificó como decisión de diseño real a tomar antes de implementar, no un detalle menor.

## 2.3. Decisiones tomadas antes de implementar (resolviendo las 4 preguntas del relevamiento)

1. **TTL de e-commerce y el cron:** se confirmó la opción sin migración — el cron aplica 72h fijo por origen; el `ttl_horas` explícito de e-commerce queda solo informativo en la respuesta del congelamiento. Se decidió explícitamente no agregar `fecha_expiracion` a `Reserva` en esta HU, para no introducir una migración fuera del alcance descripto por la task, dejando la limitación documentada en código como deuda técnica formal en vez de una omisión silenciosa.
2. **Verbo del cron:** se confirmó reemplazar `GET` por `POST` sin alias — no había `CRON_SECRET` configurado en ningún entorno ni orquestador productivo dependiendo del verbo anterior, así que no había nada que preservar por compatibilidad.
3. **Permisos:** se confirmaron granulares y separados (`inventario:reservar_stock` / `inventario:confirmar_reserva`), siguiendo el molde ya usado por transferencias, en vez de inventar un permiso combinado nuevo.
4. **`estado_origen` del congelamiento:** se confirmó `"DISPONIBLE"` por simetría directa con la reversión del cron (`"RESERVADO"` → `"DISPONIBLE"`), y se confirmó explícitamente que el congelamiento no dispara `stock:umbral_critico_alcanzado` — mismo precedente ya establecido por transferencia, sin necesidad de una nueva regla de negocio.

## 2.4. Corrección post-implementación — `tipo_movimiento` de la liberación por venta

La primera entrega de Claude Code usó `tipo_movimiento: "AJUSTE"` para la liberación por venta, razonado por analogía directa con el congelamiento (que sí es `AJUSTE`). En revisión, se identificó que esa analogía no era correcta: el congelamiento mueve cantidad dentro del mismo stock físico sin salida real, mientras que la confirmación de venta representa la salida definitiva del stock hacia el cliente — conceptualmente más cercano a un `EGRESO` que a un ajuste administrativo, y consistente con cómo la spec describe `stock:movimiento_registrado` (Ingreso, Transferencia, Ajuste directo) sin encajar ahí a la venta.

**Corrección aplicada:** `tipo_movimiento: "EGRESO"` en `confirmarReservaPorVenta()`, con docstring explicando la distinción respecto del congelamiento. El test correspondiente en `reserva.test.ts` se actualizó (`assert.match` sobre `"EGRESO"`) sin tocar el test del congelamiento, que verifica un slice de código distinto y no se solapaba con el cambio.

**Verificación tras la corrección:** `npm test` → 60/60, `tsc --noEmit` → sin errores.

## 2.5. Nota técnica pendiente para sprints futuros

Confirmado explícitamente como pendiente, no resuelto en esta HU: al implementar HU-B3 (Módulo B) y HU-E1 (Módulo E), verificar retroactivamente que ambas consuman `crearReserva()`/`confirmarReservaPorVenta()` de este servicio y no implementen lógica de reserva propia — requisito de cumplimiento obligatorio ya anticipado por la nota técnica explícita del Backlog para esta HU.
