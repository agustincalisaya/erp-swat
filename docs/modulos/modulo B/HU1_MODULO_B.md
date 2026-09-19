# HU-B1 — Venta de Mostrador con Cobro Multimedio

**Módulo:** B (Ventas y Punto de Venta) — Sprint 3
**Responsable:** Adriel Relos
**Rama:** `feature/HU-B1-venta-mostrador`
**Estado:** Completa, verificada. Lista para commit y PR contra `develop`.

---

## 1. Objetivo de la HU

El Cajero POS registra una venta de mostrador desde `/ventas/pos`: carga uno o más ítems (variante, depósito, cantidad, precio unitario, descuento %), uno o más medios de pago cuyo total debe igualar exactamente el importe de la venta, y selecciona manualmente el tipo de comprobante. Si algún ítem tiene un descuento superior al margen habilitado para el perfil del Cajero (5%), la venta se registra y el cobro se recibe igual, pero el comprobante fiscal queda pendiente hasta que un Supervisor de Ventas autorice ese ítem (flujo ya existente de HU-B4).

---

## 2. Secuencia y decisiones de alcance

- Segunda HU de la secuencia **B2 → B1 → B7** (las tres a cargo de Adriel). HU-B2 ya mergeada a `develop`.
- Orden invertido respecto del plan original (B2 → B7 → B1) porque se detectó que HU-B7 depende funcionalmente de HU-B1: el comprobante se emite dentro de la misma transacción de cobro, no como endpoint propio.
- Esta rama incluye solo el alcance **mínimo** de `comprobante-fiscal.service.ts` (CAE simulado + QR) que B1 necesita para no dejar ninguna venta sin comprobante. La máquina de estados de facturación parcial/remitos queda para HU-B7 completa.
- Sin gap en Módulo A: se confirmó que el servicio de Reserva (HU-A10) ya es suficientemente genérico. B1 lo consume con `POST /api/inventario/reservas` (congela stock) + `PATCH /api/inventario/reservas/[id]/confirmar` (transiciona a `VENDIDO`).
- `origen_reserva: "SENIA"` usado como valor más genérico disponible del enum `OrigenReserva` (deuda técnica documentada, no bloqueante).
- `CUENTA_CORRIENTE` excluida a propósito de `MedioPagoVenta` — no está en los criterios de aceptación de la HU narrativa.
- `MARGEN_DESCUENTO_CAJERO_POS = 5` como constante de código, pendiente de validar con Dirección (mismo gap de configuración global que HU-B2 y HU-H5).
- HU-C7 (consulta unificada de cliente) todavía no existe en código — B1 hace lookup directo y simple contra `Cliente`. Pendiente de revisar integración cuando C7 exista.

---

## 3. Qué se implementó

**Backend:**
- `registrarVentaMostrador(usuarioId, input)` en `venta-mostrador.service.ts`, todo dentro de una sola `prisma.$transaction`.
- Valida turno de caja abierto (`422 SIN_TURNO_ABIERTO` si no existe).
- Evalúa el descuento de cada ítem contra `MARGEN_DESCUENTO_CAJERO_POS`; si lo supera, el `PedidoVentaItem` se marca `requiere_autorizacion: true`, `autorizado_por_id: null`.
- Si algún ítem queda pendiente, el `PedidoVenta` completo permanece en `RESERVADO` (sin comprobante, sin confirmar egreso definitivo de stock) hasta autorización vía HU-B4.
- Si todo está dentro de margen, congela y confirma stock vía Reserva, emite comprobante fiscal simulado (`comprobante-fiscal.service.ts`, CAE + QR determinísticos, `es_simulado: true`) y el `PedidoVenta` queda `FACTURADO`.
- Evento `venta:registrada` emitido tras el commit exitoso, con listener en `audit-log.listener.ts`.

**Frontend:**
- Pantalla `/ventas/pos` — único frontend de esta HU (sin listado/historial de ventas, fuera de alcance). Formulario de cliente opcional, ítems (variante, depósito, cantidad, precio, descuento %), medios de pago múltiples, selección de tipo de comprobante.
- Banner informativo sobre el margen de descuento visible desde el inicio.
- Resultado de confirmación diferenciado: "Venta registrada y facturada correctamente" (con comprobante) vs. "Venta registrada — a la espera de un Supervisor" (sin comprobante, mensaje claro, no error genérico).

---

## 4. Verificación realizada (evidencia real)

**`npm test`:** 370/370 ✔ (incluye los de HU-B1: `ventas.schema.test.ts` — validación de `MedioPagoSchema` y `RegistrarVentaMostradorSchema`, incluida la exclusión deliberada de `CUENTA_CORRIENTE` — y `venta-mostrador.calculo.test.ts` — cálculo de totales, descuentos, margen, suma de medios de pago).

**`npx tsc --noEmit`:** limpio, sin errores.

**`npm run build`:** compila OK, incluye `/api/ventas` y `/ventas/pos`.

**Test de integración contra Postgres real (9/9 ✔, corrido dos veces sin fallos):**

| Escenario | Resultado |
|---|---|
| Venta simple, un solo medio de pago | ✔ PASS — factura directo, comprobante emitido |
| Cobro multimedio combinado (2 medios) | ✔ PASS — factura directo |
| Sin turno abierto | ✔ PASS — `422 SIN_TURNO_ABIERTO`, sin tocar stock ni cobro |
| Descuento dentro de margen (≤5%) | ✔ PASS — factura directo, sin ítem pendiente |
| Descuento fuera de margen (>5%) | ✔ PASS — `RESERVADO`, ítem marcado, sin comprobante |
| Stock `DISPONIBLE` → `VENDIDO` vía Reserva/confirmar | ✔ PASS |
| (extra) 2 ítems mixtos, uno dentro/uno fuera de margen | ✔ PASS |
| (extra) integridad de cadena SHA-256 del audit log | ✔ PASS |

Nota: corrida contra la base Postgres local del `.env` del proyecto (mismo patrón que `test:integration:b2/b3`), consumiendo stock real de variantes de prueba documentadas, re-ejecutable sin fallos.

**Verificación manual completa en navegador**, hecha por Adriel, con capturas de los 2 escenarios clave desde `/ventas/pos` (usuario `CAJERO_POS`):
1. **Descuento 5% (dentro de margen):** "Venta registrada y facturada correctamente", comprobante TICKET emitido con `comprobante_id` no nulo (V-2026-000015, total $190.000,00).
2. **Descuento 10% (fuera de margen):** "Venta registrada — a la espera de un Supervisor", comprobante "Pendiente de autorización" sin `comprobante_id` (V-2026-000016, total $72.000,00), mensaje claro de que el cobro ya fue recibido y el comprobante se emite tras la autorización.

---

## 5. Pendientes documentados (no bloqueantes)

1. Validar `MARGEN_DESCUENTO_CAJERO_POS` (5%) con Dirección/PO — no existe entidad de configuración global (mismo gap que HU-B2 y HU-H5).
2. `origen_reserva: "SENIA"` como convención — pendiente de coordinar con el dueño de Módulo A si se agrega un valor de enum dedicado a venta directa.
3. Integración real con HU-C7 pendiente de que esa HU exista en código — hoy B1 usa lookup directo y simple contra `Cliente`.
4. Máquina de estados de facturación parcial/remitos y comprobante fiscal completo — alcance de HU-B7 (próxima HU de la secuencia).
5. No hay pantalla de listado/historial de ventas — fuera de alcance de esta HU; las ventas quedan persistidas en `PedidoVenta` pero solo consultables por BD, no por frontend.

---

## 6. Estado de entrega

- Verificación completa (automatizada + manual) cerrada.
- Pendiente: commit y PR contra `develop`.

## 7. Próximo paso

Commit, push de la rama `feature/HU-B1-venta-mostrador`, y apertura de PR. Después, continuar con **HU-B7** (comprobante fiscal completo con máquina de estados de facturación parcial/remitos), siguiendo la secuencia acordada B2 → B1 → B7.
