# Especificación Técnica — HU-E9 (Historial y estado de pedidos, con código QR)

## ERP SWAT Indumentarias — Módulo E

**Story Points:** 3.
**Metodología:** Specification-Driven Development (SDD).
**Stack real:** Next.js 16 · TypeScript · Prisma ORM · PostgreSQL 16 · `qrcode` · Node.js `node:test`.
**Fuente:** `docs/specs/spec_modulo_E.md` §2.9 y código de HU-E9.
**Estado:** **IMPLEMENTADA Y VERIFICADA**. Lista para commit/PR manual.

---

## 1. Historia de Usuario y Criterios de Aceptación

Como Cliente Web,
necesito consultar el historial y estado actual de mis pedidos y disponer del código QR cuando estén listos para retiro,
para conocer el avance de mis compras y contar con la identificación necesaria para retirarlas en la sucursal.

- [x] **CA1 — Historial propio:** una cuenta vinculada consulta únicamente pedidos `WEB` propios, activos (`is_active = true`, `deleted_at = null`) y con extensión e-commerce activa/no eliminada, ordenados por `PedidoVenta.created_at DESC` y paginados server-side (`page`/`page_size`, 20 por defecto y máximo 50).
- [x] **CA2 — Fecha principal:** listado y detalle presentan `PedidoVenta.created_at` como «Fecha del pedido»; `fecha_pago_confirmado` no la sustituye.
- [x] **CA3 — Detalle propio:** muestra estado actual, productos, cantidades, precios congelados, total y metadatos mínimos del comprobante, sin datos de Mercado Pago, auditoría ni operación Pick & Pack.
- [x] **CA4 — Sesión E8:** ambos endpoints exigen `swat_tienda_session` mediante `withSesionClienteWeb`; sin sesión responden `401` y una cuenta pendiente responde `403 CUENTA_VINCULACION_PENDIENTE`.
- [x] **CA5 — IDOR:** el servidor obtiene `clienteId` exclusivamente de `sesion.clienteId`; pedido ajeno, inexistente, de otro canal o no visible produce el mismo `404 PEDIDO_NO_ENCONTRADO`.
- [x] **CA6 — QR antes y después de listo:** el QR no se expone antes de `LISTO_PARA_RETIRO` ni después de ese estado.
- [x] **CA7 — QR listo y vigente:** `qr_data_url` se genera server-side solo si el pedido propio está en `LISTO_PARA_RETIRO`, tiene `codigo_qr_retiro` y el plazo es nulo o `>= ahora`.
- [x] **CA8 — QR vencido:** si el plazo venció, E9 devuelve `qr_data_url = null` sin cambiar el estado; HU-E13 conserva la responsabilidad de vencerlo.
- [x] **CA9 — Responsabilidad E12:** E9 no genera ni modifica token/plazo; solo lee los valores creados por HU-E12.
- [x] **CA10 — Secreto y caché:** `codigo_qr_retiro` nunca es una propiedad pública; ambos endpoints responden `Cache-Control: private, no-store`, incluidas respuestas 401/403 de la guarda.
- [x] **CA11 — Comprobante:** solo se exponen `tipo`, `fecha_emision` y `monto`; no se exponen CAE, indicador simulado, QR fiscal ni IDs internos innecesarios.
- [x] **CA12 — Sin descarga ficticia:** la UI muestra «Comprobante no disponible para descarga»; E9 no genera PDFs ni reutiliza endpoints administrativos.
- [x] **CA13 — Navegación:** las páginas finales son `/tienda/cuenta/pedidos` y `/tienda/cuenta/pedidos/[id]`, con estados de carga, vacío, error y no encontrado.

---

## 2. Arquitectura final

### API Cliente Web

- `GET /api/tienda/mis-pedidos`
- `GET /api/tienda/mis-pedidos/[id]`

Ambos handlers ejecutan:

```text
request
→ withSesionClienteWeb
→ sesion.clienteId
→ servicio E9
→ respuesta mínima
→ Cache-Control: private, no-store
```

No aceptan `clienteId`, `cuentaId`, email, DNI ni `usuarioId` desde la request. La respuesta temprana de HU-E8 permanece intacta; T4.1 agregó únicamente el wrapper local `conCachePrivada` para que también 401/403 lleven `private, no-store`.

### Frontend

- `/tienda/cuenta/pedidos`
- `/tienda/cuenta/pedidos/[id]`
- acceso «Mis pedidos» desde `/tienda/cuenta` solo para cuenta vinculada.

Las páginas son Server Components y llaman directamente a los helpers de sesión y al servicio server-only; no hacen self-fetch HTTP ni reenvían cookies manualmente. La cuenta pendiente redirige a `/tienda/cuenta` sin invocar el servicio. Las rutas antiguas `/cuenta/pedidos`, `/ecommerce/mis-pedidos` y `/api/ecommerce/mis-pedidos` no forman parte del runtime de HU-E9.

---

## 3. Modelo de datos involucrado

No se creó `PedidoWeb`, `OrdenWeb`, tabla, enum, campo, migración ni seed. Se reutilizan `PedidoVenta` con `canal = WEB`, `PedidoVentaEcommerce`, `PedidoVentaItem`, `VarianteSKU`, `ProductoMaestro` y el último `ComprobanteFiscal` asociado.

Filtros obligatorios:

- `PedidoVenta.cliente_id = sesion.clienteId`;
- `PedidoVenta.canal = WEB`;
- `PedidoVenta.is_active = true`;
- `PedidoVenta.deleted_at IS NULL`;
- `PedidoVentaEcommerce.is_active = true`;
- `PedidoVentaEcommerce.deleted_at IS NULL`.

`CANCELADO`, `ANULADO` y `PAGO_RECHAZADO` pueden mostrarse si los registros siguen activos. `ComprobanteFiscal` no recibe filtros de soft delete porque el modelo actual no posee esas columnas.

---

## 4. Contrato público

### Listado

```ts
{
  id: string;
  numero: string;
  fecha: string;
  total: number;
  estado: EstadoEcommerce;
  cantidad_items: number;
}
```

### Detalle

```ts
{
  id: string;
  numero: string;
  fecha: string;
  total: number;
  estado: EstadoEcommerce;
  items: {
    producto: string;
    sku: string;
    talle: string;
    color: string;
    cantidad: number;
    precio_unitario: number;
  }[];
  plazo_retiro_vencimiento: string | null;
  qr_data_url: string | null;
  comprobante: {
    tipo: TipoComprobanteVenta;
    fecha_emision: string;
    monto: number;
  } | null;
}
```

### Errores HTTP

- `400 VALIDATION_ERROR`: query estricta inválida o UUID mal formado.
- `401 SESION_CLIENTE_WEB_REQUERIDA`: cookie ausente, JWT inválido/revocado o cuenta/cliente inactivo.
- `403 CUENTA_VINCULACION_PENDIENTE`: sesión válida pero pendiente.
- `404 PEDIDO_NO_ENCONTRADO`: pedido ajeno, inexistente, no WEB, inactivo/eliminado o extensión no visible; mismo cuerpo siempre.
- `500 INTERNAL_ERROR`: error genérico sin stack, SQL, Prisma, identidad, QR ni pago.

404 contractual:

```json
{ "data": null, "error": { "code": "PEDIDO_NO_ENCONTRADO", "message": "El pedido solicitado no existe" } }
```

---

## 5. QR, secreto y responsabilidades

Regla exacta:

```text
estado_ecommerce = LISTO_PARA_RETIRO
AND codigo_qr_retiro IS NOT NULL
AND (plazo_retiro_vencimiento IS NULL OR plazo_retiro_vencimiento >= ahora)
→ qr_data_url presente
```

En cualquier otro caso `qr_data_url = null`. E9 lee el token únicamente server-side para generar el data URL y no lo devuelve. `qr_inconsistente` no existe en el DTO. E9 no cambia estado, plazo ni token, no valida retiro y no decodifica el QR para autorizar.

HU-E8 provee sesión e identidad; HU-E2 confirma el pago y dispara la admisión; HU-E12 prepara y genera token/plazo; HU-E9 solo lee y presenta. HU-E3 valida retiro y HU-E13 vence/cancela: ambos permanecen fuera del alcance.

---

## 6. Testing y evidencia final

| Nivel | Archivo | Evidencia |
|---|---|---|
| Schemas T2 | `src/lib/schemas/mis-pedidos.schema.test.ts` | 7 pass / 0 fail / 0 skipped |
| Servicio T3 | `src/lib/services/ecommerce/mis-pedidos.service.test.ts` | 16 pass / 0 fail / 0 skipped |
| HTTP focalizado T4/T4.1 | `src/app/api/tienda/mis-pedidos/http.test.ts` | 6 pass / 0 fail / 0 skipped |
| Frontend T5/T6 | `src/components/ecommerce/mis-pedidos.test.tsx` | 6 pass / 0 fail / 0 skipped |
| HTTP real T6/T6.1 | `src/lib/services/ecommerce/hu-e9.http.integration.test.ts` | 8 pass / 0 fail / 0 skipped |
| Integración real T7 | `src/lib/services/ecommerce/hu-e9-e8-e12.integration.test.ts` | 6 pass / 0 fail / 0 skipped |

La cuenta TAP de T7 es 6 porque contiene 1 test contenedor más 5 subtests: detalle E9 antes de listo, flujo E12, detalle autorizado, IDOR del Cliente B e historiales A/B.

La integración T7 usó PostgreSQL dedicado, login HU-E8 real, pago HU-E2 con pasarela simulada inyectable, endpoints reales HU-E12 (`tomar`, `scan`, `completar`) y consultas HTTP reales HU-E9. E12 generó token/plazo; Cliente A recibió `qr_data_url`, y Cliente B recibió el 404 contractual.

Verificación adicional: TypeScript, ESLint, `git diff --check` y `npm run build` exitosos. Next.js reconoce ambas páginas E9 como rutas dinámicas.

---

## 7. Archivos de esta HU

| Archivo | Cambio |
|---|---|
| `src/lib/schemas/mis-pedidos.schema.ts` | Validación estricta de paginación e ID |
| `src/lib/schemas/mis-pedidos.schema.test.ts` | Tests T2 |
| `src/lib/services/ecommerce/mis-pedidos.service.ts` | Consultas server-only, DTO mínimo, soft delete y QR condicional |
| `src/lib/services/ecommerce/mis-pedidos.service.test.ts` | Tests T3 |
| `src/lib/services/ecommerce/mis-pedidos.service.integration.test.ts` | Integración PostgreSQL del servicio |
| `src/app/api/tienda/mis-pedidos/route.ts` | Historial HTTP autenticado |
| `src/app/api/tienda/mis-pedidos/[id]/route.ts` | Detalle HTTP autenticado |
| `src/app/api/tienda/mis-pedidos/http.ts` | Mapper E9 y wrapper local de caché |
| `src/app/api/tienda/mis-pedidos/http.test.ts` | Tests T4/T4.1 |
| `src/app/(tienda)/tienda/cuenta/pedidos/page.tsx` | Listado RSC |
| `src/app/(tienda)/tienda/cuenta/pedidos/loading.tsx` | Estado de carga del listado |
| `src/app/(tienda)/tienda/cuenta/pedidos/[id]/page.tsx` | Detalle RSC |
| `src/app/(tienda)/tienda/cuenta/pedidos/[id]/loading.tsx` | Estado de carga del detalle |
| `src/components/ecommerce/MisPedidosListado.tsx` | Listado y paginación |
| `src/components/ecommerce/DetallePedidoWeb.tsx` | Detalle, QR y comprobante mínimo |
| `src/components/ecommerce/mis-pedidos.test.tsx` | Tests frontend |
| `src/components/tienda/AccesoPedidosCuenta.tsx` | Acceso condicionado desde Mi cuenta |
| `src/app/(tienda)/tienda/cuenta/page.tsx` | Integración del acceso |
| `src/lib/services/ecommerce/hu-e9.http.integration.test.ts` | Matriz HTTP real T6 |
| `src/lib/services/ecommerce/hu-e9-e8-e12.integration.test.ts` | Integración E8/E2/E12/E9 real T7 |
| `docs/modulos/modulo E/HU9_MODULO_E.md` | Documentación final |
| `docs/modulos/modulo E/HU9_TASKS.md` | Trazabilidad T2–T8 |
| `docs/specs/spec_modulo_E.md` | Estado contractual actualizado |

Sin cambios en `prisma/schema.prisma`, `prisma/migrations/**`, `prisma/seed.ts`, HU-E8, HU-E12, HU-E2, HU-E3 ni HU-E13.
