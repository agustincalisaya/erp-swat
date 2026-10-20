# HU-E15 — Claridad en checkout: plazo de reserva, medio de pago y confirmación

## Resumen

Hace explícito para el cliente web qué pasa al comprar: cuánto tiempo queda reservado el stock, con qué medio va a pagar y cuál es el total exacto antes de salir a Mercado Pago. Responde al comentario del profesor del 9 de octubre sobre la claridad del checkout y la reserva de stock. Implementa la spec `docs/specs/spec_modulo_E.md` §6.1 (E15-1 a E15-7) sin cambiar contratos de API, schema ni el flujo transaccional de HU-E1/E2.

Detalle completo: [PLAN](./HU15_MODULO_E.md) · [TASKS y registro de ejecución](./HU15_TASKS.md)

## Cambios funcionales

| CA | Lo que ve el cliente |
|---|---|
| E15-1 | En el carrito: «Proceder al pago» con cuenta vinculada, «Ingresar para comprar» como visitante y ninguna acción de compra con cuenta pendiente de vinculación. |
| E15-2 | Aviso en el carrito: la reserva descuenta stock durante N minutos y se libera si el pago no se confirma. Si la configuración falta o es inválida, se ve un texto genérico sin minutos. |
| E15-3 | En «Pago pendiente», selector informativo con una sola opción: Mercado Pago (incluye tarjeta de crédito y débito). |
| E15-4 | Antes de ir a Mercado Pago, un diálogo muestra el total, el medio y los minutos restantes. «Continuar» lleva al pago; «Volver» solo cierra. |
| E15-5 | El total mostrado es el del pedido (`PedidoVenta.total`, neto de cupón) y es idéntico al recargar. |
| E15-6 | Sin link de pago se mantiene el aviso de reintento de HU-E2 y no se ofrece el diálogo. |
| E15-7 | Con la reserva vencida se ve «Reserva vencida» y «Volver al catálogo», antes y después de que corra el job de liberación. |

## Cambios técnicos

**Servicios y reglas**
- `src/lib/services/ecommerce/pedido-web.reglas.ts` (mod.): `minutosDePlazoCheckout`, `minutosRestantesReserva` y `resolverPlazoCheckoutMinutos` (degradación sin default).
- `src/lib/services/ecommerce/checkout.service.ts` (mod.): `obtenerPlazoReservaCheckoutMinutos()` y `obtenerPedidoWebVencidoPorTtl()`.

**Páginas**
- `src/app/(tienda)/tienda/carrito/page.tsx` (mod.): lee los minutos en el servidor y los pasa al carrito.
- `src/app/(tienda)/tienda/checkout/pendiente/page.tsx` (mod.): usa la lectura post-job si E1/E2 no encuentran el pedido.
- `src/app/(tienda)/tienda/checkout/CheckoutPendienteVista.tsx` (mod.): integra el selector y el diálogo en lugar del link directo.

**Componentes**
- `src/components/tienda/CarritoCliente.tsx` (mod.): texto del botón y `AvisoPlazoReserva`.
- `src/components/tienda/SelectorMedioPagoInformativo.tsx` (nuevo): selector de solo lectura.
- `src/components/tienda/ConfirmarPagoDialog.tsx` (nuevo): diálogo de confirmación con minutos restantes.
- `src/components/tienda/compra.module.css` (mod.): estilos del selector.

**Tests**
- `src/lib/services/ecommerce/hu-e15.unit.test.ts` (nuevo): reglas puras de minutos y degradación.
- `src/lib/services/ecommerce/hu-e15.integration.test.ts` (nuevo): servicio y HTTP (H1–H5, gated por `HU_E15_INTEGRATION_BASE_URL`).
- `src/components/tienda/checkout-e15.test.tsx` (nuevo): aserciones de componentes sobre la fuente.
- `src/lib/services/ecommerce/hu-e8.http.integration.test.ts` (mod.): regex del botón ampliada para incluir «Proceder al pago».
- `package.json` (mod.): unit E15 dentro de `test` y nuevo script `test:integration:e15`.

**Docs**
- `docs/modulos/modulo E/HU15_MODULO_E.md` (nuevo): plan, decisiones y registro de cierre.
- `docs/modulos/modulo E/HU15_TASKS.md` (nuevo): tasks, gates y registro de ejecución.

## Lo que NO cambia

- Contrato de `POST /api/tienda/checkout`: mismo body, sigue rechazando `medio_pago` y `total` con 400.
- `CarritoVista` y `GET /api/tienda/carrito`.
- Schema de Prisma: sin migraciones.
- Adapter de Mercado Pago.
- Job de liberación de reservas.
- La spec (`spec_modulo_E.md`) no se modifica.

## Decisiones y desvíos relevantes

- **C3 — Lector dedicado de minutos:** los minutos se leen en `carrito/page.tsx` con `obtenerPlazoReservaCheckoutMinutos()` y no se agregan a `CarritoVista`. La clave y las horas nunca llegan al navegador.
- **C2 — Degradación sin default:** `CONFIGURACION_INVALIDA` y `CONFIGURACION_NO_ENCONTRADA` muestran el texto genérico (sin inventar 60 minutos); el resto de los errores se propaga.
- **C4 — Excepción acotada a la Regla 1:** `obtenerPedidoWebVencidoPorTtl` lee un pedido inactivo solo si fue anulado por TTL por Canal Web, es del cliente y del canal WEB. Es de solo lectura, no reactiva nada y devuelve `RESERVA_VENCIDA` sin link de pago ni cupón.
- **D4.1 — `router.refresh()` solo al cerrar el diálogo vencido:** es la única acción del diálogo que vuelve al servidor y no muta nada. Con reserva vigente, «Volver» no hace ninguna request.
- **T01-D1 (aprobado):** la degradación quedó en `pedido-web.reglas.ts` en vez del servicio, para testearla sin base (el servicio es `server-only`).
- **T02-D1:** los tests de componentes verifican la fuente porque Node no carga CSS modules.

## Tests

Base de test aislada `swat_erp_test_e15`, creada con `prisma migrate deploy` y seed. App con `MP_MODO=simulado`.

| Verificación | Baseline (T00) | Final | Diferencia |
|---|---|---|---|
| `npm test` | 1232/1232 | 1240/1240 | +8 (unit E15) |
| typecheck | OK | OK | — |
| lint | 0 errores / 6 warnings | 0 errores / 6 warnings | mismos warnings, ajenos a E15 |
| hu-e1 | 21/21 | 21/21 | — |
| hu-e2 | 11 ok / 2 fallan | 11 ok / 2 fallan | falla previa P-R2 (ver nota) |
| hu-e4 | 27/27 | 27/27 | — |
| hu-e7 | 11/11 | 11/11 | — |
| hu-e8-http | 13/13 | 13/13 | — |
| hu-e15 (nueva) | — | 17/17 | 10 servicio + 5 HTTP + 2 contenedores |
| componentes | — | 55/55 | 24 de E15 |
| `next build` | — | OK | — |

> **Nota hu-e2 P-R2:** `hu-e2.integration.test.ts:296` espera `EN_PREPARACION` y recibe `PAGO_CONFIRMADO` por el cambio de HU-E13 (R1). Ya fallaba en el baseline y es ajena a esta PR.

La interacción del diálogo en navegador no está automatizada: se verificó sobre la fuente y las reglas puras (ver «Cómo probar»).

## Cómo probar

Levantar con `MP_MODO=simulado npm run dev` (así «Continuar» abre el simulador y no el sandbox). Contraseña de las cuentas del seed: `abc123456789`. TTL del seed: 1 hora (60 minutos).

1. **Visitante** (incógnito): agregar un producto → el carrito muestra «Ingresar para comprar» y «60 minutos» → el botón lleva a `/tienda/ingresar`.
2. **María Gómez** (`maria.gomez@example.com`, pendiente de vinculación): sin botón de compra, aviso de cuenta pendiente y texto genérico del plazo. `/tienda/checkout/pendiente?pedido=<id>` redirige a `/tienda/cuenta`.
3. **Juan Pérez** (`juan.perez@example.com`, vinculado): «Proceder al pago» (opcional cupón `SWAT10`) → pantalla pendiente con selector y total → «Pagar con Mercado Pago» abre el diálogo. «Volver» cierra sin requests (verificar en Network); «Continuar» abre el simulador. Al recargar, el total es el mismo.
4. **Forzar vencimiento** (con el `<ID>` de `?pedido=`):
   ```bash
   docker exec swat_erp_postgres psql -U erpswat -d swat_erp_db -c "UPDATE reservas SET fecha_expiracion = (now() AT TIME ZONE 'utc') - interval '1 minute' WHERE id IN (SELECT reserva_id FROM pedido_venta_items WHERE pedido_venta_id = '<ID>')"
   ```
   - **Antes del job:** recargar → «Reserva vencida» y «Volver al catálogo»; el pedido sigue en `PAGO_PENDIENTE`.
   - **Después del job:** `npm run job:reservas` y recargar → sigue mostrando «Reserva vencida».
   - **Con el diálogo abierto:** usar `+ interval '1 minute'`, abrir el diálogo y esperar el vencimiento → en ≤15 s desaparece «Continuar»; al cerrar, la página se recarga y muestra «Reserva vencida».

## Pendientes fuera de alcance

- **C1:** la spec cita mal la ruta de T2 (`docs/tasks/tareas tecnicas/…`); la real es `docs/tareas tecnicas/T2-mercado-pago-local.md`.
- Actualizar el test P-R2 de HU-E2 al comportamiento de HU-E13.
- Hacer repetible la suite de HU-E7 sobre la misma base (anula un fixture del seed).
- **T02-O1:** el texto genérico del carrito dice «Al iniciar la compra…» junto al botón «Proceder al pago»; no se cambió en esta HU.

## Checklist para revisores

- [ ] Los tres perfiles del carrito muestran la acción correcta (E15-1).
- [ ] Ni la clave `ECOMMERCE_CHECKOUT_TTL_HORAS` ni las horas llegan al navegador; solo los minutos (E15-2).
- [ ] Con configuración inválida o ausente, el carrito responde 200 con texto genérico (C2).
- [ ] El body de `POST /api/tienda/checkout` no cambió y sigue rechazando `medio_pago`/`total` (E15-3).
- [ ] «Volver» del diálogo no hace requests; «Continuar» navega al `checkout_url` (E15-4).
- [ ] El total sale siempre de `PedidoVenta.total` y coincide al recargar, con y sin cupón (E15-5).
- [ ] Sin `checkout_url` se mantiene el reintento de HU-E2 y no se abre el diálogo (E15-6).
- [ ] «Reserva vencida» se ve antes y después del job; un pedido ajeno no se muestra (E15-7).
- [ ] La lectura de pedido anulado por TTL está acotada (dueño, canal WEB, motivo TTL) y es solo lectura (C4).
- [ ] Sin cambios en schema de Prisma, adapter de MP, job de reservas ni `CarritoVista`.
- [ ] `npm test`, typecheck, lint y `test:integration:e15` pasan localmente.
