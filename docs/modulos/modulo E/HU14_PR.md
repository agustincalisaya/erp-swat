# HU-E14 — Datos de venta en Preparación: número, cliente, fecha y unidades

## Resumen

Responde al pedido del profesor de «vincular el despacho con la venta»: cada tarjeta de Preparación de pedidos muestra ahora **número de venta, cliente, fecha de pago y unidades**, sin salir a otra pantalla. El **total y el medio de pago** aparecen solo para quien tiene el permiso `ecommerce:leer_historial_ordenes` (Administrador E-commerce), resuelto en el servidor; el Operador de Pick & Pack nunca los recibe. Implementa `docs/specs/spec_modulo_E.md` §6.3 (E14-1 a E14-5 y párrafo final). **Sin cambios de schema, migraciones ni seed.**

Detalle completo: [Evidencia](./HU14_MODULO_E.md) · [TASKS y registro de ejecución](./HU14_TASKS.md)

> ### 🔒 Seguridad
> - La proyección base **no consulta** `PedidoVenta.total`, `VentaMedioPago` ni `TransaccionPagoLog` (no se filtran después: no se piden). Lo comprueba un test que espía el SQL generado por Prisma.
> - En el JSON del operador **no viene la clave `pago`** (ausente, no `null`).
> - Nunca se exponen `VentaMedioPago.referencia` (payment_id), DNI, email ni teléfono: del cliente solo se lee `Cliente.nombre`.
> - La autorización es **por permiso, nunca por nombre de rol**. `usuarioTienePermiso` no cachea: revocar el permiso rige en el request siguiente.

## Cambios funcionales

| CA | Lo que ve el usuario |
|---|---|
| E14-1 | La tarjeta muestra número de venta, cliente, fecha de pago confirmado y unidades totales («1 unidad» / «N unidades», suma de ítems vigentes). |
| E14-2 | El Operador de Pick & Pack no ve total, medio de pago ni datos fiscales: el servidor no los consulta ni los envía. |
| E14-3 | Con `ecommerce:leer_historial_ordenes`, la tarjeta suma «Total» (`PedidoVenta.total` congelado, en ARS) y «Medio de pago» (p. ej. «Mercado Pago»). |
| E14-4 | El permiso se resuelve en el handler antes de consultar; la UI solo renderiza lo que llega en el JSON. |
| E14-5 | Sin enlace a un detalle de pedido. Se conservan las acciones de HU-E12 (Tomar, Continuar preparación, prioridad) y la barra de progreso. |
| Párrafo final | Cliente nulo, inactivo, dado de baja o fusionado → etiqueta fija «Cliente no disponible» (no se sigue `fusionado_en_id`, para no mostrar otra identidad). |

**Ejemplo de respuesta** (`GET /api/ecommerce/preparacion`, seed, V-2026-000006, abreviado):

Operador (`operador.pickpack.seed`) — sin `pago`:

```json
{
  "numero_venta": "V-2026-000006",
  "cliente_nombre": "Juan Pérez",
  "fecha_pago_confirmado": "2026-10-20T16:06:00.502Z",
  "unidades_totales": 1,
  "progreso": { "total_requerido": 1, "total_confirmado": 0, "porcentaje": 0, "completo": false }
}
```

Administrador (`admin.ecommerce.seed`) — el mismo ítem, más:

```json
"pago": { "total": "22800.00", "medios": ["MERCADO_PAGO"] }
```

## Cambios técnicos

**Servicio y tipos**
- `src/lib/services/ecommerce/pick-pack.types.ts` (mod.): `ColaPreparacionItemDto` gana `cliente_nombre` y `unidades_totales`; nuevos `DatosPagoColaPreparacionDto`, `ColaPreparacionItemConPagoDto`, `PaginacionColaPreparacionConPagoDto` y `OpcionesColaPreparacion`.
- `src/lib/services/ecommerce/pick-pack.service.ts` (mod.): `listarColaPreparacion(filtros, opciones?)` con dos overloads (default seguro `incluirDatosPago: false`). El `select` se arma según la opción; con pago suma `total` y una consulta a `VentaMedioPago` (`pedido_venta_id`, `medio`). Orden, conteo y paginación sin cambios.

**API**
- `src/app/api/ecommerce/preparacion/route.ts` (mod.): resuelve `usuarioTienePermiso(session.userId, "ecommerce:leer_historial_ordenes")` y pasa `{ incluirDatosPago }`. Envelope y códigos sin cambios.

**Componentes**
- `src/components/ecommerce/pick-pack-client.ts` (mod.): tipos JSON base / con pago, guard `tieneDatosPago`, `TEXTO_CLIENTE_NO_DISPONIBLE`, `ETIQUETA_MEDIO_PAGO` y formateadores de cliente, unidades, medios y total.
- `src/components/ecommerce/ConsolaPickPack.tsx` (mod.): `TarjetaPedidoCola` agrega la lista de datos de venta y, solo si el JSON trae `pago`, Total y Medio de pago.

**Tests**
- `src/lib/services/ecommerce/hu-e14.integration.test.ts` (nuevo): proyecciones base / con pago, espía de SQL, cliente no disponible, unidades, orden y paginación, regresión D7.
- `src/lib/services/ecommerce/hu-e14.http.integration.test.ts` (nuevo): JSON real de operador y admin, 403, revocación inmediata y 401.
- `src/components/ecommerce/ConsolaPickPack.test.tsx` (mod.): render con / sin pago, cliente no disponible, sin enlaces, acciones HU-E12.
- `src/components/ecommerce/pick-pack.client.test.ts` (mod.): guard y formateadores.
- `package.json` (mod.): `test:unit:e14`, `test:integration:e14` y `test:integration:e14-http`.

**Docs**
- `docs/modulos/modulo E/HU14_TASKS.md` (nuevo): decisiones, tasks, deuda y avance.
- `docs/modulos/modulo E/HU14_MODULO_E.md` (nuevo): evidencia de cierre.
- `docs/modulos/modulo E/HU14_PR.md` (nuevo): esta descripción.
- `docs/specs/spec_modulo_E.md` (mod.): nota aditiva de cierre al final de §6.3 (no normativa; no edita texto existente).

## Lo que NO cambia

- Schema de Prisma, migraciones y seed.
- Rutas tomar / scan / completar / prioridad / validar-retiro: siguen sin datos de pago (fijado por test de regresión).
- `PreparacionPedidoPanel`, `page.tsx` de Preparación y `PedidosWebAdmin`.
- `with-permission.ts` y la matriz de permisos.
- `mis-pedidos.service.ts` (E9).
- No se crean endpoints ni pantalla de detalle.

## Decisiones y desvíos relevantes

- **D1 — Permiso en el handler:** la ruta sigue exigiendo `leer_cola_preparacion`; el permiso de historial solo decide la proyección. Nunca se compara nombre de rol.
- **D2/D3 — Dos proyecciones:** la base no selecciona columnas ni tablas de pago; con pago, `total` es `toFixed(2)` como string (convención de lecturas administrativas, §2.13.15) y `medios` es una lista sin duplicados, sin `referencia` ni `importe`.
- **D5 / C5 — Cliente fusionado:** «Cliente no disponible», sin seguir `fusionado_en_id` (resuelto por el revisor).
- **C3 — «Detalle de preparación»:** no hay endpoint de detalle; el detalle es el panel de la consola, alimentado por el ítem de la cola y por scan/completar, que no traen pago.
- **C8 / DM-1 — Medios como lista:** un pedido web tiene un solo medio, pero se expone `MedioPagoVenta[]`; la UI los une con coma.
- **C9 — Seed sin cambios:** «Cliente no disponible» se demuestra con fixtures propios de los tests.
- **DM-4:** el test de servicio saca sus pedidos de la cola al terminar (baja lógica) para no romper el orden de `pick-pack.integration`.
- **DM-5:** el test D7 fija el conjunto real de claves de scan/completar, incluidos campos internos (DT-5).

## Tests

Base de test `swat_erp_test_e13_hu14` (migrate + seed; el prefijo `e13_` lo exige `exigirDbDeTest` de HU-E13). Servidor HTTP `next dev -p 3114` con `MP_MODO=simulado`. Corridas del 21/10/2026.

| Verificación | Resultado | Nota |
|---|---|---|
| `test:integration:e14` (nueva) | 8/8 | corrida dos veces sobre la misma base |
| `test:integration:e14-http` (nueva) | 6/6 | operador, admin, 403, revocación, 401 |
| `test:unit:e14` | 38/38 | `ConsolaPickPack.test.tsx` + `pick-pack.client.test.ts` |
| `pick-pack.integration.test.ts` | 53/53 | regresión HU-E12 (por ruta, sin script npm) |
| `hu-e2-e12.integration.test.ts` | 12/12 | regresión (por ruta, sin script npm) |
| `npm test` | 1264/1264 | — |
| `npx tsc --noEmit` | OK (exit 0) | — |
| `npm run lint` | 0 errores / 6 warnings | warnings preexistentes, ninguno en archivos de E14 |
| `npm run build` | OK | — |

> [!WARNING]
> **Fallas preexistentes, ajenas a esta PR:** `test:integration:e13` (10/12) y `test:integration:e13-http` (5/10) fallan en `develop` desde **antes** de HU-E14, por cambios de E9 («Mis pedidos»): `obtenerPedidoWebCliente` ahora devuelve `historial_estados` y `verificarE9Terminal` (`hu-e13.test-fixtures.ts:675`) espera el conjunto de claves viejo; además un ANULADO legacy aparece en el listado E9 (`hu-e13.e2e.http.integration.test.ts:417`). **E14 no toca `mis-pedidos.service.ts`**; los casos de toma y preparación de e13-http pasan. Registrado como **DT-6** para el owner de E9/E13.

La verificación visual en navegador no se hizo durante la implementación (queda para revisión, ver «Cómo probar»); el render de la tarjeta está cubierto por tests de markup estático.

## Cómo probar

Levantar con `npm run dev` sobre una base con seed. Contraseña de las cuentas del seed: `abc123456789`.

1. **Operador:** ingresar con `operador.pickpack.seed` y abrir `/ecommerce/preparacion`. Las tarjetas de V-2026-000006 y V-2026-000007 muestran número, «Juan Pérez», fecha de pago y «1 unidad» / «2 unidades». **No** aparecen Total ni Medio de pago.
   - En DevTools → Network, abrir la respuesta de `GET /api/ecommerce/preparacion`: ningún ítem tiene la clave `pago` y el body no contiene `MERCADO_PAGO` ni `1320000000006` / `1320000000007`.
2. **Administrador:** ingresar con `admin.ecommerce.seed` en `/ecommerce/preparacion`. Las mismas tarjetas suman «Total» (`$ 22.800,00` / `$ 44.300,00`) y «Medio de pago: Mercado Pago».
   - En Network, cada ítem trae `pago: { total, medios }`; el body tampoco contiene los payment_id.
3. En ambos casos: las tarjetas no tienen enlaces a detalle y conservan Tomar / Continuar preparación / prioridad según el permiso.

## Pendientes fuera de alcance

- **DT-1:** `DetallePreparacionDto` sin consumidores y con ruta inexistente; borrarlo o implementarlo en otra HU.
- **DT-2:** tres mapas de etiquetas de `MedioPagoVenta` (PDF, reporte mensual, pick-pack); unificar en un módulo compartido.
- **DT-3:** serialización de `Decimal` mixta en el módulo E (`number` público / `string` administrativo); fijarla en la spec.
- **DT-4:** `listarColaPreparacion` incluye `operador_asignado` sin exponerlo; quitar el `include` en una limpieza.
- **DT-5:** scan/completar devuelven campos internos (`pve_id`, `cantidad_confirmada_anterior`, `vencimiento_iso`); proyectar el DTO documentado en HU-E12.
- **DT-6:** suites e13 / e13-http rotas por cambios de E9 (`historial_estados`, ANULADO legacy); reportar al owner de E9/E13.

## Checklist para revisores

- [ ] La tarjeta muestra número, cliente, fecha de pago y unidades para el operador (E14-1).
- [ ] El JSON del operador no trae la clave `pago` ni datos de pago o PII (E14-2).
- [ ] La proyección base no consulta `total`, `VentaMedioPago` ni `TransaccionPagoLog` (test del espía de SQL) (E14-2).
- [ ] El admin recibe `pago.total` (string, 2 decimales) y `pago.medios`, sin `referencia` (E14-3).
- [ ] El permiso se resuelve en el handler con `usuarioTienePermiso`, nunca por nombre de rol; la revocación rige en el request siguiente (E14-4).
- [ ] Sin enlaces a detalle; acciones de HU-E12 intactas (E14-5).
- [ ] Cliente nulo / inactivo / fusionado → «Cliente no disponible», sin nombre del primario.
- [ ] tomar / scan / completar / prioridad / validar-retiro sin cambios y sin datos de pago.
- [ ] Sin cambios en schema, migraciones ni seed.
- [ ] La nota de §6.3 solo agrega líneas.
- [ ] `npm test`, tsc, lint, `test:unit:e14`, `test:integration:e14` y `test:integration:e14-http` pasan localmente; las fallas de e13 / e13-http corresponden a DT-6.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
