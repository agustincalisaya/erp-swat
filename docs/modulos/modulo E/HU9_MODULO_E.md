# Especificación Técnica — HU-E9 (Historial y estado de pedidos, con código QR)

## ERP SWAT Indumentarias — Módulo E

**Story Points:** 3.
**Metodología:** documentación del núcleo implementado y verificado, diferenciada del contrato HTTP pendiente.
**Stack real:** Next.js 16 · TypeScript · Prisma ORM · PostgreSQL 16 · `qrcode` · Node.js `node:test`.
**Fuente:** `docs/specs/spec_modulo_E.md` §2.9 y código de HU-E9.
**Estado:** implementación parcial; **no Done**. La sesión de Cliente Web (HU-E8), las rutas y las pantallas aún no existen.

---

## 1. Historia de Usuario y Criterios de Aceptación

Como Cliente Web,
necesito consultar el historial y estado actual de mis pedidos y disponer del código QR cuando estén listos para retiro,
para conocer el avance de mis compras y contar con la identificación necesaria para retirarlas en la sucursal.

- [ ] **CA1** — El Cliente Web consulta únicamente sus propios pedidos. El servicio filtra por cliente, pero falta conectarlo a una identidad de sesión real mediante HU-E8.
- [ ] **CA2** — Se muestran pedidos `WEB`, incluidos entregados y cancelados/anulados propios según la política histórica. El listado y los componentes están probados, pero las pantallas autenticadas aún no están publicadas.
- [ ] **CA3** — Se muestra el estado actual y el detalle. DTO y componentes implementados; faltan las rutas y pantallas de HU-E8.
- [x] **CA4, núcleo de servicio** — La imagen QR se ofrece solo en `LISTO_PARA_RETIRO`, si existe token y `plazo_retiro_vencimiento` es nulo o `>= ahora`; no aparece en otros estados ni tras vencer el plazo. La presentación al Cliente Web queda pendiente de HU-E8.
- [x] **CA5** — HU-E9 no genera ni modifica el token QR; lee `PedidoVentaEcommerce.codigo_qr_retiro` y representa su imagen bajo demanda. HU-E12 es responsable de generar el token productivo.
- [x] **CA6, núcleo de servicio** — Pedido ajeno e inexistente producen el mismo `PEDIDO_NO_ENCONTRADO`; la equivalencia HTTP `404` requiere HU-E8.
- [ ] **CA7** — El comprobante solo puede consultarse si está asociado a un pedido propio. El servicio ya autoriza sus metadatos, pero el acceso web y la descarga definitiva están pendientes.
- [x] **CA8, núcleo de servicio** — Los DTO omiten logs de pago y datos financieros internos; el QR codifica únicamente el token opaco, sin DNI, nombre, email, monto ni datos de Mercado Pago. `total` y precios de ítems son los importes de compra necesarios para el detalle propio.

Los criterios de interfaz permanecen abiertos: estas marcas sobre el núcleo no certifican el flujo completo desde navegador.

---

## 2. Arquitectura de la pantalla

**Sin páginas ni endpoints públicos de esta HU por ahora.** `MisPedidosListado.tsx` y `DetallePedidoWeb.tsx` son componentes reutilizables, responsive y desacoplados del layout de tienda: muestran listado, detalle, estados de carga/error/sesión no disponible y, si corresponde, imagen QR y datos del comprobante. No se ubican en `app/(dashboard)` ni emplean la sesión `swat_session` del ERP interno. La UI indica «Comprobante no disponible para descarga» y no ofrece un PDF fiscal inventado.

Las rutas `/api/tienda/mis-pedidos`, `/api/tienda/mis-pedidos/[id]`, `/cuenta/pedidos` y `/cuenta/pedidos/[id]` figuran como **previstas, no implementadas**, hasta contar con el contrato de sesión de HU-E8. Tampoco existen pruebas HTTP/E2E autenticadas.

---

## 3. Modelo de datos involucrado

No se crea `PedidoWeb`/`OrdenWeb`, nueva tabla, enum, campo ni migración. El pedido es `PedidoVenta` de Módulo B con `canal = WEB` y relación 1:1 con `PedidoVentaEcommerce`; los estados provienen del `EstadoEcommerce` existente: `PAGO_PENDIENTE`, `PAGO_CONFIRMADO`, `PAGO_RECHAZADO`, `EN_PREPARACION`, `LISTO_PARA_RETIRO`, `ENTREGADO`, `ANULADO`, `CANCELADO` y `VENCIDO_SIN_RETIRO`.

«Mis pedidos» es una **consulta histórica explícita**: incluye pedidos propios `CANCELADO`/`ANULADO` aunque `PedidoVenta` o su extensión estén inactivos, así como los `ENTREGADO`. No reactiva ni elimina registros, no crea una cronología persistida de transiciones y no altera los filtros globales de baja lógica. `prisma/seed.ts` no se modificó.

---

## 4. Contrato de servicio y seguridad

**Identidad:** HU-E8 debe autenticar la cuenta web y obtener server-side `cuentaClienteWebId` y `clienteId`. El servicio recibe `clienteId` **ya validado por una capa superior**; nunca usa `clienteId` de query, body o form como identidad confiable, ni reutiliza `withPermission`/`Usuario` interno. No existe aún una ruta que acepte solicitudes del navegador.

| Función (`mis-pedidos.service.ts`) | Comportamiento implementado |
|---|---|
| `listarPedidosWebCliente(clienteId, opciones)` | Filtra cliente + `canal = WEB` + extensión e-commerce; pagina server-side y ordena por fecha reciente; devuelve estado actual y resumen mínimo. |
| `obtenerPedidoWebCliente(clienteId, pedidoId, opciones)` | Busca en **un único predicado** `id` solicitado + `cliente_id` autenticado + `canal = WEB` + extensión e-commerce. Devuelve detalle, ítems, comprobante asociado y QR condicional; ajeno/inexistente dan el mismo `PEDIDO_NO_ENCONTRADO`. No usa `obtenerPedidoVenta(id)` administrativo. |
| `obtenerComprobanteWebCliente(clienteId, pedidoId, comprobanteId, opciones)` | Exige pedido `WEB` propio **y** comprobante asociado en la consulta; devuelve solo metadatos autorizados. No reutiliza la ruta administrativa `/api/ventas/comprobantes/[id]`. |

**QR:** HU-E9 solo lee `codigo_qr_retiro` y genera la imagen en memoria con `qrcode`; no persiste imagen, no genera ni modifica token y no usa el QR fiscal `ComprobanteFiscal.qr_data_url`. En `ENTREGADO`, `CANCELADO`, `VENCIDO_SIN_RETIRO` u otro estado distinto de `LISTO_PARA_RETIRO`, el QR no se entrega aunque el token siga almacenado. Sin token en un pedido listo y vigente, se informa indisponibilidad de forma segura.

**Separación de responsabilidades:** HU-E9 lee historial y detalle, presenta QR y metadatos autorizados del comprobante; HU-E8 provee sesión e identidad de Cliente Web; HU-E12 genera `codigo_qr_retiro` al completar preparación; HU-E3 valida QR y retiro; HU-E13 implementa cancelación/vencimiento; HU-F3 consume los eventos correspondientes para notificaciones internas. HU-E9 no emite eventos ni notifica al consultar pedidos. La emisión del comprobante pertenece a HU-E2/Módulo B.

---

## 5. Testing y evidencia

| Nivel | Archivo | Resultado verificado |
|---|---|---|
| Servicio unitario, Prisma simulado | `src/lib/services/ecommerce/mis-pedidos.service.test.ts` | 13 aprobados, 0 fallidos. Propiedad, canal, historial inactivo, QR por estado/plazo, minimización de DTO y comprobante ajeno. |
| Componentes | `src/components/ecommerce/mis-pedidos.test.tsx` | 4 aprobados, 0 fallidos. Listado, estados de UI, QR condicional y comprobante sin descarga ni jerga técnica. |
| Integración real Prisma/PostgreSQL | `src/lib/services/ecommerce/mis-pedidos.service.integration.test.ts` | 1 aprobado, 0 fallidos, 0 omitidos. Base local aislada `hu_e9_test`, fixtures propios para clientes A/B, pedidos WEB/mostrador/inactivo/listo y rollback verificado; opt-in mediante `HU_E9_INTEGRATION_DATABASE_URL`. No usa base compartida ni requiere HU-E8. |

**Total HU-E9:** 18 aprobados, 0 fallidos. `npx tsc --noEmit --incremental false`: OK; `npm run lint`: 0 errores (3 warnings preexistentes ajenos a HU-E9); `npm run build`: OK. Las pruebas HTTP/E2E de sesión y acceso por navegador no están ejecutadas porque HU-E8 no existe.

---

## 6. Puntos abiertos y dependencias (HU-E9 no Done)

1. **HU-E8:** sesión real y obtención server-side de identidad; después, crear los endpoints HTTP y las pantallas `/cuenta/pedidos` y `/cuenta/pedidos/[id]`, con pruebas autenticadas de IDOR, 404 uniforme y rechazo de `clienteId` suministrado por navegador.
2. **HU-E12:** generación productiva del token QR al pasar a `LISTO_PARA_RETIRO`. Un pedido listo sin token queda señalado como inconsistencia; HU-E9 no lo fabrica.
3. **HU-E3 / HU-E13 / HU-F3:** validación y entrega; cancelación y vencimiento; notificaciones internas, respectivamente. Son responsabilidades ajenas al servicio de lectura HU-E9.
4. **HU-E2/Módulo B y HU-E8:** comprobante web descargable definitivo, sujeto a autorización por pedido propio. HU-E9 no genera documentos fiscales ni expone la ruta administrativa.

---

## 7. Archivos de esta HU

| Archivo | Cambio |
|---|---|
| `src/lib/services/ecommerce/mis-pedidos.service.ts` | Nuevo — consultas server-only, DTOs, QR condicional y comprobante acotado al pedido propio |
| `src/lib/services/ecommerce/mis-pedidos.service.test.ts` | Nuevo — tests unitarios del servicio |
| `src/lib/services/ecommerce/mis-pedidos.service.integration.test.ts` | Nuevo — integración PostgreSQL con rollback |
| `src/components/ecommerce/MisPedidosListado.tsx` | Nuevo — presentación del listado y estados de UI |
| `src/components/ecommerce/DetallePedidoWeb.tsx` | Nuevo — detalle, QR e información de comprobante |
| `src/components/ecommerce/mis-pedidos.test.tsx` | Nuevo — tests de componentes |
| `docs/modulos/modulo E/HU9_MODULO_E.md` | Nuevo — este documento |

Sin cambios de HU-E9 en `prisma/schema.prisma`, migraciones, `prisma/seed.ts`, bus de eventos ni infraestructura de autenticación del ERP interno.
