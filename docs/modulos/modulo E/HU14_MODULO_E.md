# HU-E14 — Datos de venta en Preparación: evidencia de cierre

## ERP SWAT Indumentarias — Módulo E — Sprint 5 (backlog fila 10, 2 SP)

**Contrato:** `docs/specs/spec_modulo_E.md` §6.3 (E14-1 a E14-5 y párrafo final), con nota aditiva de cierre al final de §6.3.
**Plan:** `docs/modulos/modulo E/HU14_TASKS.md` (D1–D10, T01–T04 ejecutadas de corrido; STOP anulados por el revisor).

## 1. Qué cambió

| Archivo | Cambio |
|---|---|
| `src/lib/services/ecommerce/pick-pack.types.ts` | `ColaPreparacionItemDto` gana `cliente_nombre` y `unidades_totales`. Nuevos `DatosPagoColaPreparacionDto`, `ColaPreparacionItemConPagoDto`, `PaginacionColaPreparacionConPagoDto` y `OpcionesColaPreparacion`. |
| `src/lib/services/ecommerce/pick-pack.service.ts` | `listarColaPreparacion(filtros, opciones?)` con dos overloads (el base es el último). El `select` de `pedido_venta` se arma según `incluirDatosPago`: la base pide solo `id`, `numero_venta` y `cliente { nombre, is_active, deleted_at }`; con pago suma `total` y una consulta a `VentaMedioPago` (`pedido_venta_id`, `medio`). La baja lógica del cliente se aplica en el mapeo. Orden, conteo y paginación sin cambios. |
| `src/app/api/ecommerce/preparacion/route.ts` | Tras validar la query, `usuarioTienePermiso(session.userId, "ecommerce:leer_historial_ordenes")` y `listarColaPreparacion(parsed.data, { incluirDatosPago })`. |
| `src/components/ecommerce/pick-pack-client.ts` | Tipos JSON base / con pago, `tieneDatosPago`, `TEXTO_CLIENTE_NO_DISPONIBLE`, `formatearClienteCola`, `formatearUnidades`, `ETIQUETA_MEDIO_PAGO`, `formatearMediosPago` (coma), `formatearTotalPago` (ARS es-AR). |
| `src/components/ecommerce/ConsolaPickPack.tsx` | `TarjetaPedidoCola` agrega una lista Cliente / Unidades y, solo si el JSON trae `pago`, Total / Medio de pago. Sin enlaces; acciones HU-E12 intactas. |
| Tests | Nuevos: `hu-e14.integration.test.ts`, `hu-e14.http.integration.test.ts`. Extendidos: `ConsolaPickPack.test.tsx`, `pick-pack.client.test.ts`. |
| `package.json` | `test:unit:e14`, `test:integration:e14`, `test:integration:e14-http` (única edición). |

Sin cambios de `prisma/schema.prisma`, migraciones ni seed.

## 2. CA → prueba

| CA | Prueba |
|---|---|
| E14-1 | Servicio: «unidades_totales suma solo ítems vigentes» (2 + 3 + 5 dado de baja → 5). HTTP: operador ve `cliente_nombre`, `fecha_pago_confirmado` ISO y unidades 1 / 2 en V-2026-000006/7. UI: «sin `pago` muestra número, cliente, fecha y unidades». |
| E14-2 | Servicio: «proyección base: sin clave `pago`» (claves exactas) y «la proyección base no consulta pago ni datos fiscales» (SQL capturado). HTTP: el JSON del operador no tiene `pago`, `MERCADO_PAGO`, payment_ids, DNI, email ni teléfono. |
| E14-3 | Servicio: `pago.total === PedidoVenta.total.toFixed(2)` (`"12345.50"`), medios activos sin duplicados, `[]` sin medio. HTTP: admin recibe `pago` con el total de la BD y `["MERCADO_PAGO"]`. UI: total `$ 12.345,50` y «Mercado Pago». |
| E14-4 | Servicio: el espía de queries prueba que el `select` cambia según la opción. HTTP: 403 sin `leer_cola_preparacion` (aunque tenga historial) y revocación de `leer_historial_ordenes` (baja lógica de `RolPermiso`) con efecto en el request siguiente, misma sesión. UI: la tarjeta decide con `tieneDatosPago(pedido)`, sin referencias a permisos ni roles. |
| E14-5 | UI: el markup no contiene `<a` ni `href=`; «Tomar pedido», «Continuar preparación» y el control de prioridad siguen presentes. |
| Párrafo final | Servicio: `cliente_id` nulo, cliente inactivo, con `deleted_at` y secundario fusionado → `null`, sin el nombre del primario. UI: «Cliente no disponible». |
| D7 | Servicio: claves exactas de prioridad / tomar / scan / completar sin `pago`, `total`, medio ni `referencia`. `validar-retiro` arma en la ruta un literal `{ pedido_venta_id, numero, estado }` (verificado por lectura). |

### Cómo se prueba que la base no consulta datos de pago

`hu-e14.integration.test.ts` instala un `PrismaClient` con `log: query` en `globalThis.prisma` **antes** del `import()` dinámico de `db/prisma.ts` y del servicio, y asierta que `db/prisma.ts` lo reutiliza (`prisma === espia`). En la proyección base primero exige haber capturado una query sobre `pedidos_venta_ecommerce` y después que ninguna mencione `venta_medios_pago`, `log_transacciones_pago`, `comprobantes_fiscales` ni `"pedidos_venta"."total"`. En la proyección con pago exige `"pedidos_venta"."total"` y `venta_medios_pago`, y nunca `"referencia"`.

## 3. Corridas de verificación (21/10/2026)

Base de test: `swat_erp_test_e13_hu14` (PostgreSQL local, migrate + seed; el prefijo `e13_` lo exige `exigirDbDeTest` de HU-E13). Servidor HTTP: `next dev -p 3114` apuntado a esa base con `MP_MODO=simulado`.

| Comando | Resultado |
|---|---|
| `npm run test:integration:e14` | 8 / 8 (corrido dos veces sobre la misma base) |
| `npm run test:integration:e14-http` | 6 / 6 |
| `npm run test:unit:e14` (`ConsolaPickPack.test.tsx` + `pick-pack.client.test.ts`) | 38 / 38 |
| `pick-pack.integration.test.ts` | 53 / 53 (dos corridas, intercaladas con E14) |
| `hu-e2-e12.integration.test.ts` | 12 / 12 |
| `npm run test:integration:e13` | 10 / 12: falla T12 en `verificarE9Terminal` (ver §5, ajena a E14) |
| `npm run test:integration:e13-http` | 5 / 10: 3 fallas por `historial_estados` en E9 y 1 por ANULADO legacy en el listado E9 (ver §5, ajenas a E14). Pasan los casos de toma y preparación reales. |
| `npm test` | 1264 / 1264 |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | 0 errores, 6 warnings preexistentes (ninguno en archivos de E14) |
| `npm run build` | compila |

## 4. JSON de ejemplo (`GET /api/ecommerce/preparacion`, seed)

Operador (`operador.pickpack.seed`), ítem V-2026-000006 (líneas abreviadas):

```json
{
  "pedido_venta_id": "91a9f1cf-e278-4f9c-8584-4ee166c6c01d",
  "pedido_venta_ecommerce_id": "c62a900f-d1bf-43b9-a7a1-58472d152e0d",
  "numero_venta": "V-2026-000006",
  "cliente_nombre": "Juan Pérez",
  "fecha_pago_confirmado": "2026-10-20T16:06:00.502Z",
  "prioridad_manual": null,
  "estado_ecommerce": "EN_PREPARACION",
  "operador_asignado_id": null,
  "unidades_totales": 1,
  "lineas": ["…"],
  "progreso": { "total_requerido": 1, "total_confirmado": 0, "porcentaje": 0, "completo": false }
}
```

Administrador (`admin.ecommerce.seed`): el mismo ítem, más

```json
"pago": { "total": "22800.00", "medios": ["MERCADO_PAGO"] }
```

(V-2026-000007: `unidades_totales: 2`, `pago.total: "44300.00"`.)

## 5. Hallazgos ajenos a E14

- **E9 / «Mis pedidos»:** `obtenerPedidoWebCliente` ya devuelve `historial_estados`, y `verificarE9Terminal` (`hu-e13.test-fixtures.ts:675`) espera el conjunto de claves anterior. Rompe T12 de `hu-e13.integration` y 3 casos de `hu-e13.e2e.http`. Además, en `hu-e13.e2e.http.integration.test.ts:417` un ANULADO legacy aparece en el listado E9. Ninguno de estos caminos usa archivos modificados por E14 (`mis-pedidos.service.ts` no se tocó). Se reporta al owner de E9/E13.
- **Campos internos en respuestas HU-E12:** `confirmarItem` devuelve también `pve_id` y `cantidad_confirmada_anterior`, y `completarPreparacion` devuelve `pve_id` y `vencimiento_iso`, que las rutas serializan tal cual. No son datos de pago ni PII. Registrado como DT-5.

## 6. Decisiones, conflictos y deuda

Ver `HU14_TASKS.md` §9 (conflictos C1–C10, todos resueltos o sin acción), §10 (DT-1 a DT-6) y §11 (decisiones menores).

## 7. Verificación manual

No se hizo la verificación visual con capturas en el navegador durante la implementación; queda a cargo del revisor (pasos en el reporte de cierre). El render de la tarjeta está cubierto por los tests de markup estático.
