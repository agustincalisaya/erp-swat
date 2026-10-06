# SDD — HU-E9: Plan técnico y tasks de implementación

## Alcance y reglas

- SPEC congelada: `docs/modulos/modulo E/HU9_MODULO_E.md` y `docs/specs/spec_modulo_E.md` §2.9.
- T1 (cierre contractual) está aprobada y no se reabre en este plan.
- Este archivo define el backlog técnico ejecutable T2–T8; no implementa código.
- HU-E9 es de lectura: no muta pedidos, no emite eventos y no valida retiros.
- No se modifican `prisma/schema.prisma`, migraciones ni `prisma/seed.ts`.
- No se reutiliza `/api/ventas/comprobantes/[id]` ni se genera PDF.

## Estado de ejecución

| Task | Estado | Resultado |
|---|---|---|
| T2 | Completada | Schemas estrictos de paginación e ID; 7 tests. |
| T3 | Completada | Servicio con propietario/WEB/soft delete, DTO mínimo y QR condicional; 16 tests. |
| T4 | Completada | Route Handlers E9 con `withSesionClienteWeb` y `sesion.clienteId`. |
| T4.1 | Completada | Wrapper local E9 garantiza `Cache-Control: private, no-store` también en 401/403 sin modificar HU-E8; 6 tests. |
| T5 | Completada | Páginas RSC, acceso desde Mi cuenta, componentes y estados frontend; 6 tests. |
| T6 | Completada | Matriz HTTP/UI implementada y validada. |
| T6.1 | Completada | Matriz HTTP real sobre PostgreSQL dedicado: 8 pass / 0 fail / 0 skipped. |
| T7 | Completada | Integración real E8 → E2 → E12 → E9: 6 resultados TAP (1 contenedor + 5 subtests), 0 fail/skipped. |
| T8 | Completada | Auditoría final, verificación y documentación de cierre. |

---

## 1. Arquitectura final

### Flujo

```text
Navegador Cliente Web
  → páginas /tienda/cuenta/pedidos/**
  → GET /api/tienda/mis-pedidos/**
  → withSesionClienteWeb
  → sesion.clienteId
  → mis-pedidos.service.ts
  → Prisma (PedidoVenta + PedidoVentaEcommerce + items + comprobante)
```

La identidad nunca proviene de query, body, path, email o DNI. Los Route Handlers son adaptadores finos: validan entrada, toman `sesion.clienteId`, invocan el servicio y mapean la respuesta. El servicio conserva la propiedad y vigencia en el mismo `WHERE`.

### Contrato HTTP

| Método y ruta | Entrada | Éxito | Errores |
|---|---|---|---|
| `GET /api/tienda/mis-pedidos` | `page` entero >= 1; `page_size` entero 1..50; defaults 1/20 | `200 { data: { pedidos, total, pagina, por_pagina }, error: null }` | 400, 401, 403, 500 |
| `GET /api/tienda/mis-pedidos/[id]` | `id` UUID | `200 { data: PedidoWebDetalle, error: null }` | 400, 401, 403, 404 uniforme, 500 |

Errores:

- `400 VALIDATION_ERROR`: query o UUID inválido.
- `401 SESION_CLIENTE_WEB_REQUERIDA`: cookie ausente, JWT inválido/revocado o cuenta/cliente inactivo.
- `403 CUENTA_VINCULACION_PENDIENTE`: sesión válida pero pendiente.
- `404 PEDIDO_NO_ENCONTRADO`: pedido ajeno, inexistente, no WEB, inactivo o sin extensión e-commerce activa; misma forma y mensaje.
- `500 INTERNAL_ERROR`: error inesperado, sin incluir datos sensibles.

### Persistencia y proyecciones

Listado:

- `cliente_id = sesion.clienteId`.
- `canal = WEB`.
- `PedidoVenta.is_active = true AND deleted_at IS NULL`.
- `PedidoVentaEcommerce.is_active = true AND deleted_at IS NULL`.
- Orden `PedidoVenta.created_at DESC, PedidoVenta.id DESC`.
- Paginación server-side.
- Select mínimo; no seleccionar `codigo_qr_retiro`.

Detalle:

- Mismos predicados de propiedad, canal y soft delete en un único `WHERE`.
- Seleccionar token y plazo únicamente dentro de la consulta server-only necesaria para decidir/generar el QR.
- Nunca incluir el token en el DTO.
- Comprobante público: `{ tipo, fecha_emision, monto }`.
- Excluir CAE, indicador simulado, QR fiscal, Mercado Pago, operador, prioridad, escaneos y auditoría.

### QR y caché

`qr_data_url` se genera server-side solo si:

```text
estado_ecommerce = LISTO_PARA_RETIRO
AND codigo_qr_retiro IS NOT NULL
AND (plazo_retiro_vencimiento IS NULL OR plazo_retiro_vencimiento >= ahora)
```

- El endpoint de detalle responde `Cache-Control: private, no-store` siempre, porque la presencia del QR depende de datos autenticados y puede cambiar.
- El historial autenticado también responde `Cache-Control: private, no-store` para impedir caché compartida de datos del cliente.
- Las páginas autenticadas deben ser dinámicas y no prerenderizarse. Durante T5 se debe consultar la guía instalada de Next.js 16 antes de elegir la primitiva exacta; el acceso a `cookies()` mediante la sesión ya es dinámico, pero debe verificarse contra la versión instalada.
- No registrar token, `qr_data_url`, email, DNI, Mercado Pago ni payloads completos.
- No usar `localStorage` ni `sessionStorage`.

### Frontend

- `/tienda/cuenta/pedidos`: título “Mis pedidos”, listado, vacío, paginación, “Fecha del pedido”, estado amigable, total y acceso al detalle.
- `/tienda/cuenta/pedidos/[id]`: productos, cantidades, precios, total, fecha, estado, plazo, QR condicional y comprobante mínimo.
- Sin sesión: redirección al login siguiendo el patrón de `/tienda/cuenta`.
- Cuenta pendiente: estado bloqueado con mensaje y acceso a `/tienda/cuenta`; no invocar E9.
- Pedido ajeno/inexistente: misma pantalla 404.
- Agregar acceso “Mis pedidos” desde `/tienda/cuenta` solo para cuenta vinculada.
- Reutilizar `MisPedidosListado` y `DetallePedidoWeb`; no reescribirlos.
- Reemplazar enlaces históricos `/cuenta/pedidos/**` por `/tienda/cuenta/pedidos/**`.
- Eliminar IDs de ítems del DTO. Para `key` de React usar una clave de presentación estable dentro del pedido (por ejemplo, combinación de SKU/atributos más índice de la línea renderizada) sin ampliar el contrato público.

---

## 2. Archivos

### Crear

- `src/lib/schemas/mis-pedidos.schema.ts`
- `src/lib/schemas/mis-pedidos.schema.test.ts`
- `src/app/api/tienda/mis-pedidos/route.ts`
- `src/app/api/tienda/mis-pedidos/[id]/route.ts`
- `src/app/api/tienda/mis-pedidos/http.ts`
- `src/app/api/tienda/mis-pedidos/http.test.ts`
- `src/app/(tienda)/tienda/cuenta/pedidos/page.tsx`
- `src/app/(tienda)/tienda/cuenta/pedidos/loading.tsx`
- `src/app/(tienda)/tienda/cuenta/pedidos/error.tsx` solo si el patrón de Next.js 16 y el manejo esperado requieren un Client Error Boundary.
- `src/app/(tienda)/tienda/cuenta/pedidos/[id]/page.tsx`
- `src/app/(tienda)/tienda/cuenta/pedidos/[id]/loading.tsx`
- `src/components/tienda/AccesoPedidosCuenta.tsx`
- `src/lib/services/ecommerce/hu-e9.http.integration.test.ts`
- `src/lib/services/ecommerce/hu-e9-e8-e12.integration.test.ts`

### Modificar

- `src/lib/services/ecommerce/mis-pedidos.service.ts`
- `src/lib/services/ecommerce/mis-pedidos.service.test.ts`
- `src/lib/services/ecommerce/mis-pedidos.service.integration.test.ts`
- `src/lib/services/ecommerce/respuesta-tienda.ts` quedó sin cambios; se implementó el mapper local `app/api/tienda/mis-pedidos/http.ts`.
- `src/components/ecommerce/MisPedidosListado.tsx`
- `src/components/ecommerce/DetallePedidoWeb.tsx`
- `src/components/ecommerce/mis-pedidos.test.tsx`
- `src/app/(tienda)/tienda/cuenta/page.tsx`
- `docs/modulos/modulo E/HU9_MODULO_E.md` solo en T8 para evidencia/estado final.
- `docs/specs/spec_modulo_E.md` solo en T8 para evidencia/estado final, sin cambiar el contrato.

### No tocar

- `prisma/schema.prisma`
- `prisma/migrations/**`
- `prisma/seed.ts`
- `src/lib/auth/sesion-cliente-web.ts`
- `src/lib/services/ecommerce/pick-pack.service.ts`
- `src/lib/events/**`
- `src/app/api/ventas/comprobantes/**`
- Endpoints o páginas internas `/api/ecommerce/**` y `/ecommerce/**`.
- HU-E3, HU-E12 o HU-E13, salvo importarlos desde tests de integración sin modificarlos.

---

## 3. Orden recomendado

```text
T2 schemas
→ T3 servicio
→ T4 HTTP + sesión E8
→ T5 frontend
→ T6 tests de superficie
→ T7 integración real E8/E12
→ T8 cierre
```

Justificación:

1. T2 congela entradas válidas antes de construir adaptadores.
2. T3 alinea la fuente de datos y DTO antes de exponerla por HTTP.
3. T4 publica una superficie pequeña sobre contratos ya probados.
4. T5 consume el contrato estable y reutiliza componentes.
5. T6 endurece todos los bordes HTTP/UI una vez definida la superficie completa.
6. T7 valida la integración costosa con dependencias reales sin usar fixtures que dupliquen E12.
7. T8 ejecuta verificación integral y actualiza solo evidencia documental.

---

## 4. Tasks ejecutables

### T2 — Schemas y contratos HTTP

- **Objetivo:** definir validación Zod de query y path sin aceptar identidad del navegador.
- **Dependencia:** T1 aprobada.
- **Archivos:**
  - Crear `src/lib/schemas/mis-pedidos.schema.ts`.
  - Crear `src/lib/schemas/mis-pedidos.schema.test.ts`.
- **Cambios permitidos:**
  - `MisPedidosQuerySchema`: `page` y `page_size` con coerción segura desde `URLSearchParams`, defaults 1/20, enteros, `page >= 1`, `1 <= page_size <= 50`.
  - `PedidoWebIdSchema`: UUID obligatorio.
  - Rechazar valores vacíos, fracciones, negativos, cero, `NaN`, exceso y UUID inválido.
  - Decidir explícitamente si parámetros desconocidos se ignoran o rechazan; `clienteId`, `cuentaId`, `email` y `dni` no forman parte del output y jamás se consumen como identidad.
- **Criterios de cierre:** schemas tipados, defaults estables y errores compatibles con `respuestaValidacion`.
- **Tests:** query vacía, strings numéricos, límites 1/50, inválidos, UUID válido/inválido y ausencia de identidad en output.
- **Riesgos:** coerción laxa (`"2.5"`, strings vacíos) o aceptar múltiples valores ambiguos.
- **No incluye:** DB, sesión, rutas o componentes.

### T3 — Ajuste mínimo del servicio E9

- **Objetivo:** alinear consultas y DTO existentes con soft delete y minimización contractual sin reescribir el servicio.
- **Dependencia:** T2.
- **Archivos:**
  - Modificar `mis-pedidos.service.ts`.
  - Modificar `mis-pedidos.service.test.ts`.
  - Modificar `mis-pedidos.service.integration.test.ts`.
- **Cambios permitidos:**
  - Listado: agregar filtros activos/no eliminados al pedido y extensión; conservar cliente, WEB, orden y paginación; select sin token.
  - Detalle: agregar los mismos filtros en el único `WHERE` de propiedad; mantener regla de QR congelada.
  - Cambiar `ComprobanteWeb` a `{ tipo, fecha_emision, monto }` y seleccionar `monto_total`/`created_at` únicamente.
  - Eliminar `id`, `cae_simulado`, `es_simulado` y QR fiscal del comprobante público.
  - Eliminar `id` de ítems públicos si no tiene uso contractual.
  - Evaluar si `obtenerComprobanteWebCliente` sigue aportando valor: si permanece, debe devolver el mismo DTO mínimo y aplicar soft delete; no crear endpoint de descarga.
  - Mantener `PedidoVenta.created_at` como `fecha` principal.
- **Criterios de cierre:** consultas mínimas, inactivos invisibles, DTO sin secretos/operación interna, QR correcto, errores IDOR indistinguibles.
- **Tests:** historial propio, activos, WEB, orden/paginación, detalle propio, ajeno/inexistente, estados QR, plazo nulo/vigente/vencido, token ausente del DTO y comprobante mínimo.
- **Riesgos:** filtros relacionales Prisma incorrectos; seleccionar token en listado; romper mocks por nueva forma de `where`/select; confundir monto fiscal con total del pedido.
- **No incluye:** HTTP, páginas, E12 o Prisma.

### T4 — Route Handlers y sesión E8

- **Objetivo:** implementar los dos GET autenticados como adaptadores finos.
- **Dependencia:** T2 y T3.
- **Archivos:**
  - Crear ambos `route.ts`.
  - Crear el mapper local `http.ts`; `respuesta-tienda.ts` no se modifica.
- **Cambios permitidos:**
  - Envolver ambos GET con `withSesionClienteWeb` usando opciones por defecto (pendientes rechazadas).
  - Pasar exclusivamente `sesion.clienteId` al servicio.
  - Parsear `request.nextUrl.searchParams` y `ctx.params` (`params` async conforme al patrón Next.js instalado).
  - Responder con `{ data, error }` usando helpers existentes.
  - Añadir `Cache-Control: private, no-store` a historial y detalle.
  - Loguear solo ruta/código técnico ante error inesperado, nunca request/DTO/QR/PII.
- **Criterios de cierre:** 200/400/401/403/404/500 según contrato; IDOR uniforme; headers de caché presentes.
- **Tests iniciales:** pruebas enfocadas del mapper y compilación; la matriz HTTP completa pertenece a T6.
- **Riesgos:** duplicar guardas E8; convertir ajeno e inexistente en respuestas distintas; usar firma de Route Handler obsoleta para Next.js 16.
- **No incluye:** modificar `sesion-cliente-web.ts`, aceptar identidad externa o crear permisos RBAC.

### T5 — Frontend y navegación

- **Objetivo:** publicar las páginas autenticadas reutilizando los componentes existentes.
- **Dependencia:** T4.
- **Archivos:**
  - Crear páginas/loading y, si corresponde, error boundaries listados en §2.
  - Modificar `MisPedidosListado.tsx`, `DetallePedidoWeb.tsx` y `/tienda/cuenta/page.tsx`.
- **Cambios permitidos:**
  - Página listado: sesión E8, bloqueo de pendiente, lectura de `searchParams`, listado, vacío y paginación.
  - Página detalle: sesión E8, validación UUID, detalle propio, `notFound()` para ajeno/inexistente, QR/plazo y comprobante.
  - Etiquetar `PedidoVenta.created_at` como “Fecha del pedido”.
  - Actualizar todos los enlaces a `/tienda/cuenta/pedidos/**`.
  - Agregar acceso desde “Mi cuenta” solo si la cuenta está vinculada.
  - Mostrar tipo, fecha de emisión y monto del comprobante, seguido de “Comprobante no disponible para descarga”.
  - Sustituir `item.id` como `key` por una clave local de presentación sin exponer ID interno.
- **Criterios de cierre:** mobile-first, accesible, listado/vacío/paginación/detalle/404/error/pendiente cubiertos; sin fetch client-side ni storage para QR.
- **Tests iniciales:** render de componentes y enlaces; matriz completa en T6.
- **Riesgos:** doble consulta de sesión/API; caché accidental; navegación con query inválida; un Error Boundary puede requerir `"use client"` según Next.js 16.
- **No incluye:** PDF, endpoint administrativo, local storage o mutaciones.

### T6 — Tests HTTP y frontend

- **Objetivo:** certificar la superficie pública completa y sus bordes de seguridad.
- **Dependencia:** T4 y T5.
- **Archivos:**
  - Crear `hu-e9.http.integration.test.ts`.
  - Modificar `mis-pedidos.test.tsx`.
  - Agregar tests de páginas solo si el patrón actual permite aislarlas; la navegación real se verifica preferentemente contra servidor Next.
- **Matriz HTTP obligatoria:**
  - 401 sin cookie y con sesión inválida/revocada.
  - 403 para cuenta pendiente.
  - 400 para query inválida y UUID inválido.
  - Historial con sesión vinculada, orden y paginación.
  - Detalle propio 200.
  - Ajeno 404 e inexistente con cuerpo idéntico.
  - `clienteId`/`cuentaId` enviados por query no alteran identidad ni amplían resultados.
  - Sin Mercado Pago, Pick & Pack, token literal, CAE, QR fiscal ni IDs internos innecesarios.
  - `Cache-Control: private, no-store` en ambos GET.
- **Matriz frontend obligatoria:**
  - listado, vacío, paginación y navegación;
  - “Fecha del pedido”, estado amigable y total;
  - detalle/productos/cantidades/precios;
  - QR condicional y plazo;
  - comprobante mínimo sin enlace de descarga;
  - no encontrado, error, sin sesión y pendiente.
- **Criterios de cierre:** toda la matriz pasa sobre un servidor Next real para sesión/cookies; tests no inspeccionan ni imprimen secretos.
- **Riesgos:** React Server Components requieren runner/condiciones correctas; `react-dom/server` no debe ejecutarse bajo condiciones `react-server` incompatibles.

### T7 — Integración real E8/E12

- **Objetivo:** demostrar que la identidad real E8 y la transición real E12 producen un QR visible solo al propietario.
- **Dependencia:** T3, T4 y T6.
- **Archivo:** crear `src/lib/services/ecommerce/hu-e9-e8-e12.integration.test.ts`.
- **Escenario implementado:**
  1. Crear dos clientes y una `CuentaClienteWeb` vinculada para cada uno.
  2. Iniciar sesión por el endpoint E8 y conservar `swat_tienda_session`.
  3. Crear el pedido WEB de Cliente A mediante carrito/checkout real y confirmarlo con `procesarNotificacionPago` usando la pasarela inyectable simulada ya prevista; la admisión E12 real lo deja en `EN_PREPARACION`.
  4. Ejecutar los Route Handlers reales E12 (`tomar`, `scan`, `completar`) con sesión interna de operador para generar estado, token y plazo; no escribir esas salidas manualmente.
  5. Consultar detalle E9 con sesión A y verificar `qr_data_url` + plazo persistido por E12.
  6. Verificar que el token persistido no aparece en JSON ni headers.
  7. Consultar con sesión B y verificar el 404 contractual.
  8. Verificar que el listado nunca contiene QR/token.
- **Aislamiento:** PostgreSQL dedicado opt-in, fixtures con IDs únicos y cleanup/rollback según viabilidad de los servicios reales; nunca base compartida.
- **Criterios de cierre:** flujo E8 → E12 → E9 verde, sin duplicar lógica de generación E12 y sin modificar estado desde E9.
- **Riesgos:** `completarPreparacion` usa transacciones y eventos post-commit, por lo que un rollback exterior puede no ser viable; diseñar cleanup explícito seguro en base dedicada. Configuración `ECOMMERCE_PLAZO_RETIRO_DIAS`, operador, SKU y escaneos deben existir.
- **No incluye:** E3, entrega, vencimiento E13 o notificaciones.

### T8 — Verificación final y documentación

- **Objetivo:** verificar integralmente HU-E9 y registrar evidencia sin cambiar el contrato.
- **Dependencia:** T2–T7.
- **Archivos:**
  - Actualizar `HU9_MODULO_E.md` y `spec_modulo_E.md` solo con estado, archivos y resultados.
  - Mantener este TASKS como trazabilidad; marcar tareas realizadas si la convención del equipo lo requiere.
- **Verificación obligatoria:**
  - tests de schemas;
  - tests unitarios de servicio;
  - tests de componentes/páginas;
  - integración E9 PostgreSQL;
  - integración HTTP E9;
  - integración E8/E12;
  - regresión E8 y E12 relevante;
  - `npx tsc --noEmit --incremental false`;
  - `npm run lint`;
  - `npm run build`;
  - `git diff --check` solo cuando las restricciones Git de la etapa lo permitan.
- **Criterios de cierre:** 13 criterios de aceptación documentados con evidencia; sin cambios Prisma/migraciones/seed; sin secretos o datos operativos en DTO; rutas y caché contractuales verificadas.
- **Riesgos:** integraciones opt-in pueden quedar skipped si PostgreSQL/servidor no están habilitados; debe reportarse, no falsearse ni cambiar configuración productiva.

---

## 5. Matriz consolidada de tests

| Nivel | Caso | Tarea |
|---|---|---|
| Schema | defaults, límites, coerción, UUID, identidad ausente | T2 |
| Servicio | historial propio/activo/WEB, orden y paginación | T3 |
| Servicio | detalle propio, IDOR y soft delete | T3 |
| Servicio | QR antes/listo vigente/plazo null/vencido/después | T3 |
| Servicio | token ausente del DTO y comprobante mínimo | T3 |
| HTTP | 400/401/403/404/500 y cuerpos uniformes | T6 |
| HTTP | query de identidad no altera sesión | T6 |
| HTTP | ausencia MP/Pick&Pack/token/CAE/IDs | T6 |
| HTTP | `private, no-store` | T6 |
| Frontend | listado, vacío, paginación, enlaces | T6 |
| Frontend | detalle, estados, QR/plazo, comprobante | T6 |
| Integración | login E8 → historial propio | T7 |
| Integración | E12 completar → detalle E9 con QR | T7 |
| Integración | otro cliente → 404; token nunca público | T7 |

---

## 6. Cierre, riesgos y bloqueos

### Estado final

HU-E9 quedó implementada y verificada. T2–T8 están completadas; no hay bloqueos funcionales abiertos.

### Evidencia consolidada

- T2 schemas: 7 pass / 0 fail / 0 skipped.
- T3 servicio: 16 pass / 0 fail / 0 skipped.
- T4/T4.1 HTTP focalizado: 6 pass / 0 fail / 0 skipped.
- T5/T6 frontend: 6 pass / 0 fail / 0 skipped.
- T6.1 HTTP real con PostgreSQL/Next dedicados: 8 pass / 0 fail / 0 skipped.
- T7 real E8 → E2 → E12 → E9: 6 resultados TAP / 0 fail / 0 skipped.
- `npx tsc --noEmit --incremental false`: exitoso.
- ESLint de archivos HU-E9: exitoso.
- `git diff --check`: exitoso.
- `npm run build`: exitoso; páginas E9 dinámicas.

### Decisiones resueltas

1. Soft delete aplicado a `PedidoVenta` y `PedidoVentaEcommerce`; `ComprobanteFiscal` no tiene columnas de baja lógica.
2. DTO fiscal reducido a `{ tipo, fecha_emision, monto }`; sin CAE, flag simulado, QR fiscal ni IDs internos.
3. IDs de ítems eliminados del contrato; React usa `sku + índice` como clave local.
4. `Cache-Control: private, no-store` se aplica por mapper local E9 a 200/400/404/500 y por wrapper local a 401/403; HU-E8 no fue modificada.
5. Las páginas RSC llaman al servicio con `sesion.clienteId`; no hay self-fetch ni reenvío manual de cookies.
6. T7 ejecutó E12 real por Route Handlers; E9 no genera ni muta token/plazo/estado.
7. Se creó un mapper local E9 para `PEDIDO_NO_ENCONTRADO` sin alterar el mapper compartido de otras HU.
8. La paginación valida enteros seguros, límites y overflow.

### Riesgos/deuda residual

- Las suites T6.1/T7 son opt-in y requieren PostgreSQL dedicado, seed y servidor Next local; fuera de ese entorno quedan skipped por diseño.
- No se creó un harness RSC artificial para invocar páginas con `cookies()`/`redirect()`; esa superficie quedó cubierta por helpers, componentes, build y pruebas HTTP reales.
- HU-E3, HU-E13 y un PDF/documento descargable real permanecen fuera del alcance de HU-E9.
