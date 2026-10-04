# HU-E11 — Contenido comercial y búsqueda del catálogo online (Módulo E)

Contrato: `docs/specs/spec_modulo_E.md` §2.11 y §2.11.a–§2.11.g (Revisión 6, aditiva) y §4. Task SDD: `docs/tasks/task_relos.md` (local: `docs/tasks/.gitignore` ignora todo el directorio, así que el task **no se versiona**; las decisiones vinculantes se copian en §3 de este cierre).

**Módulo:** E — Canal de Venta Online · **Responsable:** Adriel · **Sprint:** Sprint 4.
**Estado al 04/10/2026:** implementada y verificada con evidencia de ejecución sobre bases aisladas (`swat_erp_test_e11` y, para la regresión, `swat_erp_test_e11_reg_*`, todas creadas desde `template0`). Commit, PR e integración pendientes de ejecución manual por Adriel.

## 1. Historia de usuario y qué hace

**Como** Administrador E-commerce, **necesito** cargar el título comercial, la descripción y las fotos de cada producto, **para** que la tienda los muestre con búsqueda, filtros y orden sin duplicar el catálogo del Módulo A.

| Capacidad | Superficie | Resultado |
|---|---|---|
| Alta y edición del contenido | `POST /api/ecommerce/catalogo`, `PATCH /api/ecommerce/catalogo/[producto_web_id]`, pantalla `/ecommerce/catalogo` | Contenido 1:1 con el Producto Maestro, nace oculto |
| Fotos | `POST …/fotos` (multipart), `PATCH …/fotos/[foto_id]` | Hasta N fotos JPG/PNG/WebP validadas por firma de bytes; principal única; baja lógica |
| Almacenamiento | Gateway propio + Adapter de disco (`CATALOGO_FOTOS_DIR`), `GET /api/tienda/fotos/[archivo]` | Nombre generado por el servidor; ruta pública de solo lectura |
| Listado de la tienda | `GET /api/tienda/catalogo`, página `/tienda/catalogo` | Filtros por categoría, talle, color, género y modelo; búsqueda; orden por novedad y precio; paginación; valores de filtros |
| Trazabilidad | Cinco eventos `ecommerce:contenido_web_*` / `ecommerce:foto_web_*` | Asientos en el ledger encadenado SHA-256 |

## 2. Criterios de aceptación (7) — estado y evidencia

| CA | Criterio | Estado y evidencia |
|---|---|---|
| CA1 | Contenido asociado al Producto Maestro; talles/colores/géneros de sus variantes, nunca copiados | Aprobado: `hu-e11.integration` CA1 (6 casos: alta, 409 activo y de baja, alta concurrente, maestro inexistente/inactivo, edición, sin columnas de variante en el contenido); HTTP 201/400/404/409; Chrome (a) |
| CA2 | Hasta N fotos JPG/PNG/WebP, tamaño máximo configurable | Aprobado: unitarios de firma y tamaño (límite exacto y +1 byte); servicio: formato falso, vacía, grande sin guardar nada, N+1 concurrentes → exactamente N; HTTP: 422 por tamaño real, por `Content-Length` y por stream sin `Content-Length`, 409 al superar N; Chrome (b) |
| CA3 | Listado con filtros, búsqueda, orden por precio y novedad, paginación | Aprobado: `hu-e11.integration` CA3 (cada filtro, combinados por misma variante, solo variantes comprables, orden asc/desc con precios conocidos, novedad, paginación y página fuera de rango, `q`, valores de `filtros`); HTTP (400 por `orden`/`page`/`page_size`/largo; extras ignorados); Chrome (e) |
| CA4 | Detalle con fotos, descripción, precio vigente y selector de variante con disponibilidad en tiempo real | Ya cumplido por HU-E1, sin cambios (D28): `hu-e11.integration` CA4 (principal primero, foto de baja excluida, precio, disponible y cambio de stock visible en la lectura siguiente); Chrome (f) |
| CA5 | Solo se publica con foto, descripción, SKU con precio vigente y visibilidad web | Aprobado sin cambiar `comprabilidad.ts` (D18): servicio CA5 (sin foto, sin descripción, solo espacios, sin precio, oculto, completo, y baja de la única foto de un publicado); Chrome (d) con y sin foto |
| CA6 | Los cambios de contenido no afectan inventario ni POS | Aprobado: huella MD5 de `variantes_sku`, `stock_depositos`, `reservas` y `productos_maestros` idéntica antes y después de alta, edición, subidas, principal, bajas y listado |
| CA7 | Baja lógica de fotos y contenido con `is_active`, `deleted_at`, `deleted_by`, `deletion_reason` | Aprobado: baja de foto con los cuatro campos y `updated_at`, conteos de filas idénticos, archivo físico intacto; baja de contenido = HU-E5 reutilizada; Chrome (c) |

## 3. Decisiones

D1–D16 se tomaron en la task antes de leer el código; D17–D30, sobre el reporte del Paso 1 (aprobadas por Adriel el 04/10/2026); D-P2-1 a D-P2-9, durante la implementación. Pendientes de validar con el equipo/PO las marcadas.

| Decisión | Contrato vigente |
|---|---|
| D1 | `[producto_web_id]` en todas las rutas (la spec escribe `[id]`; Next.js no admite dos nombres de segmento en el mismo nivel) |
| D2 (validar equipo) | El servidor recibe el archivo, valida formato por firma de bytes y tamaño real, y lo entrega a un Gateway propio; Adapter de disco local en `CATALOGO_FOTOS_DIR` |
| D3 + D21 (validar PO) | `ECOMMERCE_FOTOS_MAX_POR_PRODUCTO` = 8, `ECOMMERCE_FOTO_TAMANO_MAX_MB` = 5 (× 1024 × 1024), `ECOMMERCE_FOTO_FORMATOS_PERMITIDOS` = `JPG,PNG,WEBP` (CSV); getters con `CONFIGURACION_INVALIDA` |
| D4 (validar PO) + D23 | Una fila por Producto Maestro; contenido existente (activo o de baja) → 409 `CONTENIDO_WEB_EXISTENTE`, sin reactivar; maestro inexistente/inactivo → 404 `PRODUCTO_MAESTRO_NO_ENCONTRADO`; nace oculto |
| D5 + D24 | Edición solo de título/descripción; contenido de baja → 404; sin cambios → 200 sin UPDATE ni evento |
| D6 | Orden = máximo activo + 1; principal única entre activas; la primera queda principal; marcar otra desmarca la anterior; baja de la principal promueve la de menor `orden`; todo bajo `FOR UPDATE` del contenido |
| D7 | PATCH de foto: exactamente `{ es_principal: true }` o `{ deletion_reason }`; foto de baja → 404; sin DELETE ni borrado del archivo |
| D8 + D22 | 409 `LIMITE_FOTOS_ALCANZADO` (conteo bajo lock); 422 `ARCHIVO_VACIO` / `ARCHIVO_DEMASIADO_GRANDE` / `FORMATO_IMAGEN_NO_ADMITIDO`; tope del cuerpo = máximo + 64 KB por `Content-Length` o por stream |
| D9 + D18 | `comprabilidad.ts` y `whereContenidoPublicado` sin cambios: ya exigían foto, descripción, precio y visibilidad. Un producto sin SKU con precio se lista como "No disponible para la compra" (lo exige HU-E1) |
| D10 + D20 | Filtros contra atributos reales; una misma variante comprable cumple todos los filtros de variante; valores inexistentes → lista vacía; `orden`/`page`/`page_size`/largo inválido → 400; parámetros extra ignorados; orden por el precio vigente mínimo, sin precio al final |
| D11 + D20d | `filtros` con categorías, talles, colores, géneros y modelos de todo el catálogo publicado y comprable |
| D12 + D28 | Detalle de E1 sin cambios: ya cumplía el criterio 4; verificado con tests |
| D13 (validar equipo) | Sin `actions.ts`: la pantalla llama a los Route Handlers (mismo desvío que E5 y E7) |
| D14 + D25 | Cinco eventos post-COMMIT con handler de auditoría (§8) |
| D15 | Nada lee ni escribe `VarianteSKU`, `StockDeposito`, `Reserva` ni Módulo B |
| D16 | `.strict()` y `trim` en todos los bodies JSON; el multipart también rechaza campos extra |
| D17 | Migración aditiva aprobada: `ProductoWebFoto.updated_at` (`NOT NULL DEFAULT CURRENT_TIMESTAMP`) |
| D19 | `ProductoWebFoto.url` = `/api/tienda/fotos/<uuid>.<ext>`; el schema interno acepta URL absoluta o ruta con `/` |
| D24 | Ruta pública sin consultar la base (sirve fotos de baja); sin aviso a carritos al bajar la última foto; configuración inválida en el backoffice → 500; sin baja en cascada; el cupo cuenta solo activas; `CATALOGO_FOTOS_DIR=.catalogo-fotos` en `.env.example`, sin default en código |
| D26 | `respuesta-catalogo.ts` solo con códigos agregados; réplicas locales del helper post-COMMIT; lectura de administración nueva en `contenido-web.service.ts`; `visibilidad-web.service.ts` sin cambios |
| D27 | `GET /api/tienda/fotos/[archivo]`: nombre `<uuid>.(jpg|png|webp)`, contención en el directorio, `Content-Type` por extensión, `Cache-Control` inmutable, `nosniff`, sin sesión |
| D29 | Archivo huérfano (guardado y transacción fallida): se registra en el log con el nombre generado y no se borra, por la política del módulo de no eliminar archivos (coherente con la baja lógica, no con la Regla 1, que habla de `DELETE` en la base); limpieza pendiente |
| D-P2-1 | El patrón del nombre exige un UUID con guiones en su lugar (más estricto que `[0-9a-f-]{36}`) |
| D-P2-2 | `ActualizarFotoWebSchema` como objeto estricto + `superRefine` (equivalente al union del task, con mensajes en español por campo) |
| D-P2-3 | Gateway `guardarImagen({ contenido, formato }) → { nombre, url }` y `leerImagen(nombre)`; el nombre lo genera el Adapter; fábrica única `obtenerAlmacenamientoImagenes()`; los tests de servicio inyectan un Gateway en memoria |
| D-P2-4 | Pre-chequeo no vinculante del cupo antes de guardar el archivo (evita huérfanos en el caso común); la garantía es el conteo bajo lock |
| D-P2-5 | El rechazo temprano por tamaño responde con `Connection: close` (el cuerpo no se consumió; sin eso el cliente reutilizaba un socket roto: `ECONNRESET` observado en el test HTTP) |
| D-P2-6 | `listarCatalogo` acepta `orden` opcional (`ConsultaCatalogo`), así los llamadores de E1/E5 no cambian |
| D-P2-7 | `updated_at` declarado `@default(now()) @updatedAt` para que la migración tenga el `DEFAULT` de las filas existentes |
| D-P2-8 | `.next/dev` estaba corrupto (`routes.d.ts` truncado; el servidor de desarrollo enviaba toda ruta de API dinámica al catch-all del dashboard): se borró ese directorio generado e ignorado por git |
| D-P2-9 | La regresión corre cada suite en su propia base nueva desde `template0` (`swat_erp_test_e11_reg_<suite>`), porque varias suites modifican fixtures del seed |

## 4. Modelo de datos, configuración y seed

- `prisma/schema.prisma`: `ProductoWebFoto.updated_at DateTime @default(now()) @updatedAt`. Migración `prisma/migrations/20261004211846_hu_e11_foto_web_updated_at/migration.sql`, generada con `migrate dev --create-only` sobre `swat_erp_test_e11` y revisada a mano: una sola sentencia, `ALTER TABLE "fotos_producto_web" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;`, sin drift. `ProductoWebContenido` no cambia.
- `prisma/seed.ts`: solo las tres claves de fotos (módulo `E`, `upsert` con `update: {}`) y el comentario de PENDIENTES actualizado. El seed corre completo con la columna nueva (verificado en las 10 bases de test).
- `.env.example`: `CATALOGO_FOTOS_DIR=".catalogo-fotos"`. `.gitignore`: `/.catalogo-fotos/`.
- **PR, "Modificación de archivos esenciales":** marcar `prisma/schema.prisma` y `prisma/seed.ts`.

## 5. Contrato de los endpoints y permiso

Ver spec §2.11.a y §2.11.g. Permiso `ecommerce:gestionar_catalogo` en las cuatro rutas del backoffice (401 sin sesión, 403 sin permiso). La tienda y la ruta pública de fotos no piden sesión.

## 6. Reglas de servicio

- `validacion-imagen.ts` (puro): `detectarFormatoImagen`, `validarImagen` (vacío → tamaño → formato), `PATRON_NOMBRE_FOTO`.
- `contenido-web.service.ts`: `crearContenidoWeb`, `editarContenidoWeb`, `listarProductosSinContenido`, `obtenerDetalleContenidosAdmin`.
- `foto-web.service.ts`: `subirFotoProducto` (contenido activo → configuración → validación → pre-chequeo de cupo → Gateway → transacción con lock), `marcarFotoPrincipal`, `darDeBajaFoto`.
- `catalogo-web.service.ts`: `listarCatalogo` ampliado (pasada liviana + una llamada a `resolverPreciosVentaVigentes` + hidratación solo de la página). Limitación documentada: ids, atributos y precios del catálogo publicado en memoria por request.
- `lectura-multipart.ts`: lectura del cuerpo con tope antes de `formData()`.

## 7. Almacenamiento y despliegue

- El Adapter escribe en `path.resolve(CATALOGO_FOTOS_DIR)` con `flag: "wx"` y nunca borra. Sin la variable, las rutas de fotos responden 500 (`ALMACENAMIENTO_NO_CONFIGURADO`, no expuesto).
- Hoy la app corre en el host (`npm run dev` / `npm start`), así que el directorio persiste en el disco del host sin cambios en Docker. Cuando la app se contenedorice hará falta un volumen nombrado montado en `CATALOGO_FOTOS_DIR` (pendiente, §13; `docker-compose.yml` no se tocó).
- Un proveedor en la nube es un Adapter nuevo del mismo Gateway.

## 8. Auditoría y eventos

| Evento | Asiento |
|---|---|
| `ecommerce:contenido_web_creado` | `contenidos_producto_web` / contenido; `null` → `{ producto_maestro_id, titulo_comercial, descripcion, visibilidad_web: false }` |
| `ecommerce:contenido_web_editado` | `contenidos_producto_web` / contenido; `antes` → `despues` (solo campos cambiados) |
| `ecommerce:foto_web_subida` | `fotos_producto_web` / foto; `null` → `{ producto_web_id, url, formato, tamano_bytes, es_principal, orden, principal_anterior_id }` |
| `ecommerce:foto_web_principal_cambiada` | `fotos_producto_web` / foto; `{ es_principal: false, principal_anterior_id }` → `{ es_principal: true }` |
| `ecommerce:foto_web_baja` | `fotos_producto_web` / foto; `{ is_active: true, es_principal }` → `{ is_active: false, deleted_by, deletion_reason, principal_promovida_id }` |

`usuario_id` = actor de la sesión; `ip = "internal-event"`; emisión post-COMMIT con captura local; handler con `.catch(codigoDiagnosticoAuditoria)`; registrados en `TIPOS_EVENTO_DOMINIO`. Un no-op no emite. Verificado: `audit-log.listener.e11.test.ts` (10 casos, incluido el rechazo sin `unhandledRejection` ni fuga de datos) y `hu-e11.integration` D25 (`verificarCadenaIntegridad()` íntegra).

## 9. Pantallas

- **`/ecommerce/catalogo`** (extensión de `CatalogoWebAdmin.tsx` + `ContenidoWebFormularios.tsx` nuevo): botón "Crear contenido" con selector de Productos Maestros activos sin contenido; por tarjeta, miniatura de la principal, descripción y botones "Editar" y "Fotos". El gestor de fotos muestra los límites (formatos, tamaño, cuántas quedan), miniaturas con la principal marcada, "Marcar como principal" y "Dar de baja" con motivo obligatorio y casilla de confirmación; mensajes en español para formato, tamaño y límite. Tras cada acción, `router.refresh()`; el diálogo de fotos queda abierto y se actualiza.
- **`/tienda/catalogo`**: formulario GET con búsqueda, cinco filtros (valores del servicio), orden y "Limpiar"; la paginación conserva filtros y orden; estado vacío claro.
- **`/tienda/catalogo/[producto_web_id]`**: sin cambios (D28).
- Imágenes con `next/image` + `unoptimized` (patrón existente): sin cambios en `next.config.ts`.

## 10. Cómo probar

```bash
docker exec swat_erp_postgres psql -U erpswat -d postgres -c "CREATE DATABASE swat_erp_test_e11 TEMPLATE template0"
export TEST_DB="postgresql://erpswat:<password>@localhost:5432/swat_erp_test_e11?schema=public"
# Misma ENCRYPTION_KEY_PROVEEDORES en el seed, los tests y el servidor; definida fuera del repo.
DATABASE_URL=$TEST_DB npx prisma migrate deploy && DATABASE_URL=$TEST_DB npx prisma db seed

npm test
HU_E11_INTEGRATION_DATABASE_URL=$TEST_DB npm run test:integration:e11
DATABASE_URL=$TEST_DB CATALOGO_FOTOS_DIR=<directorio temporal fuera del repo> npx next dev -p 3111
HU_E11_INTEGRATION_BASE_URL=http://localhost:3111 HU_E11_INTEGRATION_DATABASE_URL=$TEST_DB npm run test:integration:e11-http
```

Los dos tests verifican `current_database()` y fallan si la base no es de test. Las imágenes son mínimas y válidas, generadas en el test; los tests de servicio usan un Gateway en memoria y uno prueba el Adapter de disco en un directorio temporal fuera del repo.

**Resultados del 04/10/2026:** `npm test` 709/709 · `test:integration:e11` 21/21 · `test:integration:e11-http` 12/12 · regresión (cada una en su base nueva): `e1` 21/21, `e1-http` 15/15, `e2` 11/11, `e4` 27/27, `e4-http` 10/10, `e5` 18/18, `e5-http` 8/8, `e7` 11/11, `e7-http` 6/6 · `npm run lint` 0 errores (4 warnings preexistentes en archivos no tocados) · `npx tsc --noEmit` 0 errores · `npm run build` OK.

## 11. Prueba manual en Chrome (04/10/2026, base `swat_erp_test_e11`, servidor en el puerto 3111)

La ventana de Chrome del agente estaba oculta (`document.visibilityState = "hidden"`): **no se pudieron tomar capturas** ni cambiar el tamaño de la ventana. La UI real se manejó por referencias del DOM (clics, tipeo y formularios de las pantallas) y se verificó leyendo el DOM, la API y la base. Fixture propio: Producto Maestro "Chomba Manual E11" (talles M con stock 5 y L con stock 0, con precio), creado solo en `swat_erp_test_e11`.

| # | Escenario | Resultado |
|---|---|---|
| a | Crear contenido para un Producto Maestro sin contenido | Probado: "Crear contenido" → selector → título y descripción → aviso "Queda oculto en la tienda"; la tarjeta aparece "Oculto en la tienda · 0 fotos" |
| b | Subir fotos; formato falso; demasiado grande; límite | Probado: dos PNG generados en la página subidos por el `<input type=file>` real (miniaturas y "Podés subir 6 de 8"); `.jpg` con texto → "El archivo no es una imagen admitida…"; 5 MB + 1 byte → "La imagen supera el tamaño máximo de 5 MB."; al llegar a 8, "Podés subir 0 de 8" y botón deshabilitado; una novena por la API → 409 `LIMITE_FOTOS_ALCANZADO` |
| c | Marcar la segunda como principal y dar de baja una foto | Probado: la segunda pasa a "Principal" y queda primera; "Confirmar baja" deshabilitado sin motivo; baja con motivo y confirmación → "Foto dada de baja.", 7 activas; en la base la foto tiene `is_active = false`, `deleted_by` y el motivo |
| d | Mostrarla en la tienda (interruptor de E5), con y sin foto | Probado: oculta no aparece; "Mostrar en tienda" → listada comprable, `desde $ 18.000`, foto principal; tras dar de baja las 7 fotos por la API, desaparece del listado y el detalle responde 404 |
| e | Filtros, búsqueda, orden y paginación en `/tienda/catalogo` | Probado con el formulario: categoría "Manual E11" + talle M + orden precio descendente + "chomba" → un resultado; color sin coincidencias → estado vacío; orden por precio ascendente correcto en la página 1; la paginación conserva `orden` y `q` y la página 2 sigue el orden |
| f | Detalle con fotos y selector de variante | Probado: 7 fotos, la principal primero, todas servidas como `image/png`; selector "Polo · Azul · Talle M" y "Polo · Blanco · Talle L — agotado"; al elegir la L el botón pasa a "Agotado" |
| g | Usuario sin permiso | Probado: `operador.pickpack.seed` → `/ecommerce/catalogo` redirige a `/no-autorizado`; alta, edición y subida de foto → 403 `FORBIDDEN` |
| h | Viewport de teléfono | **No verificado**: la ventana oculta no aceptó el cambio de tamaño (`innerWidth` siguió en 1707). Las pantallas usan una columna por defecto y dos desde `md` (clases mobile-first), sin evidencia de ejecución en ese ancho |

El login del Operador se hizo con `POST /api/auth/login` desde la página: el tipeo en la ventana oculta no llegó al formulario. Las credenciales son las del seed de test.

## 12. Hallazgos reportados, sin corregir

1. **RULES §3 exige Docker, pero la app no está en `docker-compose.yml`** (solo Postgres y el cron opcional). Cuando se contenerice, `CATALOGO_FOTOS_DIR` necesitará un volumen persistente.
2. **`.next/dev` corrupto otra vez** (mismo síntoma que E7, D-P2-7 de HU-E7): con `routes.d.ts` truncado, `next dev` enviaba toda ruta de API dinámica al catch-all `(dashboard)/[...catchAll]` (404 HTML; un POST multipart aparecía como "Failed to find Server Action") y `next build` fallaba en TypeScript. Se resolvió borrando el directorio generado. Conviene que el equipo sepa que un `next dev` cortado puede dejarlo así.
3. **Título del documento** de las pantallas del backoffice y de la tienda: "Create Next App" (layouts, no de esta HU; ya reportado en E7).
4. **`whereContenidoPublicado` compara `descripcion` sin `trim`** mientras `evaluarComprabilidad` sí lo aplica: una descripción de solo espacios (solo posible por escritura directa) se lista como no comprable. No se toca por D18.
5. **`spec_modulo_D.md` §6.2** sigue sin las claves de E (incluidas las tres de fotos); coordinación pendiente con su owner.
6. **`docs/tasks/.gitignore` ignora el task** (`*`): este documento replica sus decisiones.

## 13. Pendientes

- Validar con el equipo/PO: D2 (subida por el servidor con Gateway y disco local), D3 (8 fotos, 5 MB, JPG/PNG/WebP), D4 (sin reactivación del contenido dado de baja) y D13 (sin Server Actions).
- Despliegue: volumen persistente para `CATALOGO_FOTOS_DIR` cuando la app se contenedorice (sin modificar `docker-compose.yml` en esta HU).
- Procedimiento de limpieza de archivos huérfanos (archivos sin fila en `fotos_producto_web`, identificables por el log `[HU-E11] Archivo de foto huérfano`).
- Proveedor en la nube (S3, Vercel Blob u otro): un Adapter nuevo del Gateway.
- Recorte, redimensionado y compresión de imágenes: fuera de alcance.
- Viewport de teléfono sin verificación de ejecución (§11 h).

## 14. Archivos

**Nuevos:**
`prisma/migrations/20261004211846_hu_e11_foto_web_updated_at/migration.sql`,
`src/app/api/ecommerce/catalogo/route.ts`,
`src/app/api/ecommerce/catalogo/[producto_web_id]/route.ts`,
`src/app/api/ecommerce/catalogo/[producto_web_id]/fotos/route.ts`,
`src/app/api/ecommerce/catalogo/[producto_web_id]/fotos/[foto_id]/route.ts`,
`src/app/api/tienda/fotos/[archivo]/route.ts`,
`src/components/ecommerce/ContenidoWebFormularios.tsx`,
`src/lib/services/ecommerce/validacion-imagen.ts`, `src/lib/services/ecommerce/validacion-imagen.test.ts`,
`src/lib/services/ecommerce/almacenamiento-imagenes.gateway.ts`, `src/lib/services/ecommerce/almacenamiento-imagenes.local.adapter.ts`,
`src/lib/services/ecommerce/contenido-web.service.ts`, `src/lib/services/ecommerce/foto-web.service.ts`,
`src/lib/services/ecommerce/lectura-multipart.ts`,
`src/lib/services/ecommerce/hu-e11.test-fixtures.ts`, `src/lib/services/ecommerce/hu-e11.integration.test.ts`, `src/lib/services/ecommerce/hu-e11.http.integration.test.ts`,
`src/lib/schemas/contenido-web.schema.test.ts`,
`src/lib/events/listeners/audit-log.listener.e11.test.ts`,
y este documento.

**Modificados:** `prisma/schema.prisma` (D17), `prisma/seed.ts` (tres claves), `.env.example`, `.gitignore`, `package.json` (scripts `test:integration:e11`, `test:integration:e11-http` y tres tests unitarios en `npm test`), `src/lib/schemas/ecommerce.schema.ts`, `src/lib/services/ecommerce/catalogo-web.service.ts`, `src/lib/services/ecommerce/respuesta-catalogo.ts` (solo códigos agregados), `src/lib/services/sistema/configuracion.service.ts`, `src/lib/events/event-types.ts`, `src/lib/events/listeners/audit-log.listener.ts`, `src/components/ecommerce/CatalogoWebAdmin.tsx`, `src/app/(dashboard)/ecommerce/catalogo/page.tsx`, `src/app/(tienda)/tienda/catalogo/page.tsx`, `docs/specs/spec_modulo_E.md` (Revisión 6).

**No modificados:** `comprabilidad.ts`, `visibilidad-web.service.ts`, `checkout.service.ts`, `carrito.service.ts`, `pago-web.service.ts`, `anulacion-orden.*`, `cupon.service.ts`, la página de detalle de la tienda y `SelectorVarianteWeb.tsx`, nada de Módulo A ni B, `next.config.ts`, `docker-compose.yml`.
