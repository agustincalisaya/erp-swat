# Documentación técnica de cierre — HU-G3 (Repositorio de comprobantes fiscales)

## ERP SWAT Indumentarias — Módulo G (Gestión de Caja y Tesorería)

**Documento generado desde el código real** el 15/10/2026, sobre la rama
`feature/documentacion-hu-restantes` (base `develop` en `27110ac`). La HU se
integró en el PR #255 (merge `5db59f0`); sus commits de implementación son
`d73ac29` (permiso, seed y tests), `ba02deb` (test de regresión de E9) y
`99f792d` (servicio, rutas, vistas y seed de QR). Mismo estándar que HU-G4,
HU-G8 y HU-G10: lo que se afirma está anclado a `archivo:línea` del código
actual, y lo que no coincide con la spec o con otra fuente figura como hallazgo.

> **Aviso de estado.** HU-B10 (commit `79be3f8`, integrada en `2d2463f`)
> modificó después `comprobantes-repositorio.service.ts` y sus tests, y reemplazó el
> renderer del PDF. Este documento describe el estado **actual** (§7).
> Orden de prioridad de fuentes: Alcance Funcional Técnico > Product Backlog >
> Asignación y Coordinación del Sprint 5 > `docs/specs/spec_modulo_G.md` §9.5
> (Revisiones 6, 6.1 y 6.2). Los tres primeros son documentos personales no
> versionados.

---

## 1. Historia de Usuario y Criterios de Aceptación

**Como** Cajero POS, Tesorero Central, Contador/Auditor o Administrador
**necesito** consultar el repositorio digital de todos los comprobantes fiscales
emitidos (mostrador y tienda web) **para** disponer de un único punto de consulta
y respaldo documental de la facturación.

- **Story Points:** 5 (Backlog, fila 11).
- **Roles autorizados:** Cajero POS, Tesorero Central, Auditor y Administrador. El
  Gerente no tiene acceso. No existe un rol «Contador»: el Backlog lo nombra
  «Contador/Auditor» y en el sistema es `AUDITOR`.
- **Alcance:** solo lectura. Los comprobantes los emite HU-B7 (y la NC de reintegro, HU-E13);
  el repositorio no emite, copia ni corrige.

| CA | Contrato (spec §9.5) |
|---|---|
| G3-1 | Consulta de `ComprobanteFiscal` de ambos canales, sin reemitir ni corregir. |
| G3-2 | Filtros combinables (cliente DNI/nombre, período en hora Argentina, tipo, canal); orden `created_at DESC, id DESC`; paginación en base y conteo coherente; solo DNI y nombre del cliente. |
| G3-3 | Vista y descarga de PDF con CAE, QR válido y leyenda `SIMULADO — SIN VALIDEZ FISCAL ANTE AFIP`; QR inválido = error controlado, nunca un PDF incompleto; `?disposicion=inline`; desconocida = error de validación. Diseño del PDF: HU-B10. |
| G3-4 | La NC enlaza su original y el original sus NC, por `comprobante_original_id`; vista `/tesoreria/comprobantes/[id]` con links desde el listado. |
| G3-5 | Sin edición ni baja en servicio, API ni UI; la reversión es una NC. |
| G3-6 | `tesoreria:leer_comprobantes` cubre listado, vista y descarga; 403 para Gerente y sin permiso; el permiso web de E9 no habilita el repositorio. |

---

## 2. Visión general de la implementación

### 2.1. Flujo

```
/tesoreria/comprobantes (RSC) ──permiso──▶ FiltrosComprobantes (client, filtros en la URL)
        │ listarComprobantes()                     └▶ TablaComprobantes (links, paginación)
        ▼
/tesoreria/comprobantes/[id] (RSC) ── obtenerDetalleComprobante() ── "Ver PDF" / "Descargar PDF"
                                                                      │
GET /api/tesoreria/comprobantes            ┐                          ▼
GET /api/tesoreria/comprobantes/[id]       ├ withPermission(tesoreria:leer_comprobantes) → Zod
GET /api/tesoreria/comprobantes/[id]/pdf   ┘   → servicio de solo lectura (findMany/count/findUnique)
                                                 → pdf: generarComprobanteFiscalPdf() (renderer de B10)
                                                 → QR inválido: 422 COMPROBANTE_QR_INVALIDO
```

Las páginas llaman al servicio directamente, sin `fetch` HTTP; las rutas son
wrappers finos sobre el mismo servicio. Nada escribe en la base, en `AuditLog` ni
emite eventos (`SVC:9`).

### 2.2. Archivos que componen la HU

**Nuevos** (abreviaturas: `SVC` = `src/lib/services/tesoreria/comprobantes-repositorio.service.ts`,
`SCH` = `src/lib/schemas/comprobantes-repositorio.schema.ts`)

| Archivo | Rol |
|---|---|
| `SVC` | Núcleo sin paginar (`:107-171`), listado (`:256`), detalle (`:275`) y DTO del PDF (`:285`). |
| `SCH` | Zod de filtros, `id` y `?disposicion=`. |
| `src/app/api/tesoreria/comprobantes/route.ts`, `[id]/route.ts`, `[id]/pdf/route.ts` | Las tres rutas `GET`. |
| `src/app/(dashboard)/tesoreria/comprobantes/page.tsx` | Listado (RSC). |
| `src/app/(dashboard)/tesoreria/comprobantes/[id]/page.tsx` | Detalle (RSC). |
| `src/components/tesoreria/FiltrosComprobantes.tsx`, `TablaComprobantes.tsx` | Filtros (client) y tabla (server). |
| `src/components/tesoreria/comprobantes-presentacion.ts` | Etiquetas, total con signo, hrefs y enlaces NC ↔ original, compartidos por listado y detalle. |
| Tests: `comprobantes-repositorio.test.ts` (36), `.http.test.ts` (15), `.detalle.test.ts` (10) | Unitarios, en `npm test`. |

**Modificados**

| Archivo | Cambio |
|---|---|
| `src/lib/utils/fecha-negocio.ts` | `rangoDiasNegocio()` (`:328-338`) + 6 tests en `fecha-negocio.test.ts:315-348`. |
| `src/lib/services/ecommerce/comprobante-web-pdf.ts` | G3 lo generalizó (`ComprobanteFiscalPdf`, `QrFiscalInvalidoError`) sin cambiar la firma de E9; hoy es el renderer de B10 (§7). |
| `prisma/seed.ts` | Permiso `…050` y rol-permiso (`:5168-5186`), QR válidos (`:5196-5234`), NC de demo (`:5255-5285`), dentro de `seedSprint5Cluster4()` (`:5162`, llamada en `:5093`). |
| `src/components/layout/Sidebar.tsx` | Entrada «Comprobantes» en Tesorería (`:307-314`). |
| `src/lib/services/ecommerce/comprobante-web-pdf.regresion.test.ts` | Regresión de E9 (hoy reescrito por B10). |
| `package.json`, `docs/specs/spec_modulo_G.md` | Tests de G3 en `npm test`; Revisiones 6.1 y 6.2. |

No hay migración: G3 lee `ComprobanteFiscal` tal como lo dejó HU-B7 (`schema.prisma:1854-1882`).

---

## 3. Cumplimiento de cada Criterio de Aceptación

> **Cómo se verificó.** Tests unitarios con Prisma y sesión reemplazados por dobles
> en memoria; las rutas y las páginas se ejecutan reales (ver §8). No hay test de
> integración contra PostgreSQL para G3. Abreviaturas de tests: `T` = `comprobantes-repositorio.test.ts`,
> `H` = `.http.test.ts`, `D` = `.detalle.test.ts`, `R` = `comprobante-web-pdf.regresion.test.ts`.

### ✅ G3-1 — Consulta de ambos canales, sin reemitir

- El servicio solo usa `findMany`, `count` y `findUnique` (`SVC:165, :263, :269`); no hay `update`, `delete` ni `upsert`.
- El canal sale de `pedido_venta.canal` (`SVC:191, :241`); no se filtra por `is_active`, así que los comprobantes de pedidos anulados siguen listados (`SVC:27-29`).
- El CAE y el QR se leen como quedaron archivados; no se recalculan.
- Tests: `T:181` (ambos canales, más recientes primero), `T:196`, `T:202`, `T:212`; `H:308`.

### ✅ G3-2 — Filtros, orden, paginación y minimización

- **Cliente:** si el texto, sin puntos, espacios ni guiones, es numérico, busca DNI exacto; si no, nombre parcial sin distinguir mayúsculas (`SVC:133-138`). Sin cliente: `{dni: null, nombre: "Consumidor final"}` (`SVC:242`).
- **Período:** días de Argentina, ambos incluidos, `[desde 00:00 AR, hasta+1 00:00 AR)` (`SVC:117-126`, `fecha-negocio.ts:328-338`); con un solo extremo el rango queda abierto. Un rango inválido llamado directo al servicio da `FILTRO_INVALIDO` (`SVC:123`).
- **Tipo y canal:** enums cerrados (`SCH:16, :19`); un parámetro vacío equivale a no filtrar (`SCH:22-23`).
- **Orden** `created_at DESC, id DESC` (`SVC:108`); **paginación** `skip/take` en base y `count` con el mismo `where` (`SVC:257-264`); `page_size` por defecto 25, máximo 100 (`SCH:43-44`).
- **Minimización:** solo `dni` y `nombre` del cliente (`SVC:195`); `monto_total` como string de dos decimales (`SVC:244`).
- Validación de rutas: `fecha_desde > fecha_hasta` o día inexistente = 400 (`SCH:25-28, :46-49`).
- Tests: `T:229-373` (14 casos, incluida la frontera 23:59/00:00 AR en `:308`), `H:320`, `fecha-negocio.test.ts:315-348`.

### ✅ G3-3 — Vista y descarga de PDF

- La ruta valida `id` y `disposicion` antes de consultar (`pdf/route.ts:50-58`); `inline` solo con `?disposicion=inline` (`:58`); `Content-Type: application/pdf`, `Cache-Control: private, no-store`, `nosniff` (`:64-72`).
- El PDF lo genera `generarComprobanteFiscalPdf()` (`comprobante-web-pdf.ts:281`), el mismo renderer que HU-E9: leyenda de simulado en cada hoja (`:130, :251-257`), CAE, QR archivado (`:426-437`) y bloque «ANULA» con el original en una NC (`:343-354`).
- **QR inválido:** el generador exige `data:image/png;base64,…` y un PNG embebible (`:282-292`) y lanza `QrFiscalInvalidoError`; la ruta responde 422 `COMPROBANTE_QR_INVALIDO` (`pdf/route.ts:74-80`). Nunca se genera un PDF sin QR.
- **Disposición desconocida** (`descargar`, `INLINE`) = 400 `VALIDATION_ERROR` (`SCH:65-67`).
- El diseño y el contenido del PDF los define HU-B10 (`spec_modulo_B.md` §2.10).
- Tests: `T:412, :435, :457, :515`; `H:344, :356, :379, :388, :407, :417`; `D:234`; `R:107, :138-155`.

### ✅ G3-4 — Vínculo NC ↔ original y vista de detalle

- `comprobante_original` y `notas_credito` se leen de la relación `ReversionFiscal` (`SVC:198-199, :246-247`); el número solo se muestra, nunca se usa para inferir el vínculo (`SVC:25`).
- Detalle: una NC muestra «Anula a» con link al original y el original lista sus NC (`[id]/page.tsx:196-221`); los links arrastran solo los parámetros conocidos del listado (`comprobantes-presentacion.ts:41-58, :86-99`).
- Listado: el número y la columna «Vinculado» enlazan al detalle (`TablaComprobantes.tsx:38-63, :110-114`).
- Página inexistente o `id` mal formado = `notFound()` (`[id]/page.tsx:65-74, :88`); el JSON del detalle no incluye `qr_data_url` (`SVC:277`, `H:341`).
- Tests: `T:467, :488, :566, :573, :581`; `H:332`; `D:194, :205, :258`.

### ✅ G3-5 — Sin edición ni baja

- Las tres rutas exportan solo `GET` (`T:591`); el servicio no contiene operaciones de escritura (`T:599`); la página de detalle no tiene formularios, `fetch` ni `"use server"` (`D:244`).
- Una matriz HTTP completa solo produce `findMany`, `count` y `findUnique` (`H:427`).
- El modelo no tiene soft delete y las FK son `onDelete: Restrict` (`schema.prisma:1873-1875`). Coincide con el Alcance §2.4: un comprobante fiscal con CAE nunca admite baja lógica.

### ✅ G3-6 — Permiso en servidor

- Las tres rutas: `withPermission(PERMISO_LEER_COMPROBANTES, …)` (`route.ts:22`, `[id]/route.ts:31`, `pdf/route.ts:45`). Las dos páginas: `usuarioTienePermiso` y redirección a `/no-autorizado` (`page.tsx:57-58`, `[id]/page.tsx:83-84`). Sidebar con el mismo permiso (`Sidebar.tsx:313`).
- Seed: `tesoreria:leer_comprobantes`, UUID `1a2b3c4d-1111-4a1a-8a1a-000000000050` (`seed.ts:5168-5178`), para CAJERO_POS, TESORERO_CENTRAL, AUDITOR y ADMINISTRADOR (`:5180`); el Gerente no figura.
- La sesión de cliente web de E9 no cuenta: las rutas usan la sesión interna (`H:272`).
- Tests: `T:616-653`; `H:265-304` (401, 403 Gerente, 403 con solo `ventas:leer`, 200 para los 4 roles); `D:175-183`.

### Resumen

| CA | Estado | Cobertura automática |
|---|---|---|
| G3-1, G3-2 | ✅ | Unitaria (Prisma doblado) + HTTP en memoria |
| G3-3 | ✅ | Unitaria + HTTP en memoria; leyenda y datos asertados sobre el texto del PDF |
| G3-4 | ✅ | Unitaria + render real de la página de detalle |
| G3-5 | ✅ | Unitaria (análisis estático de fuentes + operaciones registradas) |
| G3-6 | ✅ | HTTP en memoria; la matriz de roles se lee del texto del seed, no de una base real |

---

## 4. Contratos reales

### 4.1. Endpoints

| Método | Ruta | Respuestas |
|---|---|---|
| GET | `/api/tesoreria/comprobantes?cliente&fecha_desde&fecha_hasta&tipo&canal&page&page_size` | 200 `{registros, total, page, page_size}` · 400 `VALIDATION_ERROR` / `FILTRO_INVALIDO` · 401 · 403 `FORBIDDEN` · 500 |
| GET | `/api/tesoreria/comprobantes/{id}` | 200 detalle · 400 · 401 · 403 · 404 `COMPROBANTE_NO_ENCONTRADO` · 500 |
| GET | `/api/tesoreria/comprobantes/{id}/pdf[?disposicion=inline\|attachment]` | 200 `application/pdf` · 400 · 401 · 403 · 404 · 422 `COMPROBANTE_QR_INVALIDO` · 500 |

Envelope `{data, error}`. En el listado, cualquier `ServiceError` se traduce a 400 (`route.ts:46-50`). Nombre de archivo del PDF: `comprobante-<numero>.pdf`, con el número saneado (`pdf/route.ts:63-68`).

### 4.2. Forma de un registro (`ComprobanteResumen`, `SVC:76-90`)

`comprobante_id`, `numero`, `tipo_comprobante`, `canal`, `cliente {dni, nombre}`, `fecha_emision` (ISO UTC),
`monto_total` (string, 2 decimales, positivo también en NC), `es_simulado`, `comprobante_original`,
`notas_credito[]`. El detalle agrega `cae_simulado` (`SVC:92-94`). La UI muestra la NC con signo negativo (`comprobantes-presentacion.ts:35-38`).

### 4.3. Permiso

`tesoreria:leer_comprobantes` — UUID `…000000000050`, módulo `MODULO_G`. No genera eventos ni filas de auditoría.

---

## 5. Decisiones de diseño

1. **Fecha de emisión = `created_at` del comprobante**, mostrada en hora de Argentina; el modelo no tiene fecha propia (`SVC:19-21`).
2. **Número visible = convención de B7:** `numero_venta` y `NC-<numero_venta>` (`SVC:223-225`). El PDF muestra otro número (§10.4).
3. **Núcleo sin paginar reutilizable.** `construirWhereComprobantes` y `consultarComprobantes` (`SVC:141-171`) los reutiliza HU-G4 (`libro-iva.service.ts`) con su propia proyección; test `T:374`.
4. **Vista de detalle y PDF inline.** Además del listado, `/tesoreria/comprobantes/[id]` con «Ver PDF» (`?disposicion=inline`, pestaña nueva) y «Descargar PDF»; el helper `comprobantes-presentacion.ts` evita duplicar hrefs y etiquetas entre listado y detalle.
5. **QR inválido = 422 en G3.** E9 conserva su respuesta histórica (500, `R:138`); la asimetría es deliberada para no cambiar la descarga web.
6. **El seed corrige los QR existentes y siembra una NC de demostración** (`seed.ts:5216-5285`): solo toca filas con el placeholder `SIMULADO-SEED-NO-AFIP==`; la NC es de mostrador sobre `V-2026-000001`, con id `1a2b3c4d-be05-4a1a-8a1a-000000000002` y CAE `68031598279001` (reservados, T1 no debe repetirlos), `update: {}` (inmutable), y sin efectos laterales (test `T:780`).
7. **El helper de QR del seed replica `generarQrSimulado()` de B7** porque B7 no lo exporta. Los tests `T:686, :731, :747` comparan el QR del seed con el de B7 y el de la NC de E13 y fallan si divergen.
8. **Filtros en la URL y consulta directa desde el RSC**, sin `fetch` HTTP; cambiar filtros reinicia a la página 1 (`FiltrosComprobantes.tsx:55`).

---

## 6. Integración con otras HU

- **HU-B7:** origen de los comprobantes, el CAE y el QR (`comprobante-fiscal.service.ts`). G3 no lo modifica.
- **HU-E9:** comparte el renderer del PDF; su firma `generarComprobanteWebPdf` queda intacta (`comprobante-web-pdf.ts:272-274`) y la descarga web no cambia (`R:94, :99`).
- **HU-E13:** la NC web de reintegro aparece vinculada a su original; el QR del seed se compara con el de esa NC (`T:747`).
- **HU-B10:** definió el contenido y diseño del PDF y lo unificó para E9 y G3 (renderer en `src/lib/services/ecommerce/comprobante-web-pdf.ts`, marca en `pdf-marca.ts`). Ver §7.
- **HU-G4:** consume el núcleo de consulta (§5.3). La NC usa el número de su venta original (decisión D4 de la Asignación; ver `HU4_MODULO_G.md`). Una NC sobre Ticket no tiene letra ni código en el PDF (`comprobante-web-pdf.ts:166`): pregunta abierta para el PM.
- **T1 (seed histórico):** el id y el CAE de la NC de demo quedan reservados (§5.6).

---

## 7. Correcciones y cambios posteriores

**HU-B10 (`79be3f8`, integrada en `2d2463f`)** modificó G3 después de su merge:

| Cambio | Dónde |
|---|---|
| El DTO del PDF suma número de venta, ítems, pagos y fecha del original con una sola lectura (`SELECT_PDF`) | `SVC:208-217, :285-309` |
| `comprobante-web-pdf.ts` pasa a ser el renderer único de E9 y G3 (identidad de SWAT, ítems, medios de pago, totales, paginación) | `comprobante-web-pdf.ts:281-449` |
| Nuevo módulo de marca reutilizable (`numeroFiscalVisible`, `EMISOR`, `PUNTO_VENTA`) | `pdf-marca.ts` |
| Tests de G3 ajustados a los rótulos del diseño nuevo; test de regresión de E9 reescrito | `T:515`, `H:356`, `R:94-157` |

El servicio de G3 no cambió desde entonces: el último cambio es B10. HU-G4 (PR #259) lo reutiliza sin modificarlo.

---

## 8. Verificación

Ejecutado el 15/10/2026 sobre esta rama, sin tocar la base de datos (los tests de G3 usan dobles de Prisma):

| Check | Resultado |
|---|---|
| `node --experimental-strip-types --test` sobre los 5 archivos de G3 (`T` 36, `H` 15, `D` 10, `R` 8, `fecha-negocio.test.ts` 43) | ✅ 112/112 |
| `T` ejecutado 6 veces más en forma aislada | ✅ 36/36 las 6 veces |
| `npm test` completo, 1.ª corrida | ❌ 1 fallo: `T:747` (ver §10.1) |
| `npm test` completo, 2.ª corrida | ✅ 1126/1126 |
| Tras la corrección de §10.1: `npm test` completo | ✅ 1127/1127 |
| `npx tsc --noEmit` | ✅ sin errores |
| `npx eslint` sobre los archivos de G3, Sidebar y `fecha-negocio.ts` | ✅ sin errores ni avisos |

**No se ejecutó:** `next build`, verificación manual por HTTP o navegador, ni tests de integración, porque G3 no tiene script `test:integration:*`. El relevamiento personal del 15/10/2026 (cierre de G3, antes de B10) registra 905/905 tests; no se volvió a comprobar.

> 📷 **Captura 1 — Listado `/tesoreria/comprobantes` con filtros** *(pendiente: la agrega el responsable)*
>
> 📷 **Captura 2 — Detalle de una Nota de Crédito con link al original** *(pendiente)*
>
> 📷 **Captura 3 — PDF de un comprobante con la leyenda de simulado** *(pendiente)*

```bash
npm test
node --experimental-strip-types --test \
  src/lib/services/tesoreria/comprobantes-repositorio.test.ts \
  src/lib/services/tesoreria/comprobantes-repositorio.http.test.ts \
  src/lib/services/tesoreria/comprobantes-repositorio.detalle.test.ts \
  src/lib/services/ecommerce/comprobante-web-pdf.regresion.test.ts \
  src/lib/utils/fecha-negocio.test.ts
```

---

## 9. Qué NO se implementó, y por qué

- **Edición, baja o reemisión de comprobantes:** prohibido por G3-5 y por el Alcance §2.4.
- **Integración con AFIP/ARCA:** fuera de alcance; CAE y QR son locales y simulados.
- **Auditoría de las consultas:** la HU es de lectura; no emite eventos ni escribe `AuditLog` (`SVC:9`).
- **QR, ítems y pagos en la vista de detalle:** solo aparecen en el PDF; la vista muestra los datos de cabecera y los vínculos.
- **Test de integración contra PostgreSQL y tests de componente:** el listado (`page.tsx`) y los filtros no tienen test de render; la tabla se verifica por análisis de fuente (`D:258`).

---

## 10. Hallazgos

### 10.1. Un test de G3 era inestable — corregido

`T:747` («Paso 0.b/0.c · Nota de Crédito») falló en 1 de 2 corridas completas de `npm test` con
`FormatException` de `@zxing/library` al decodificar el QR de la NC (`decodificarQr`, `T:81-95`), y no falló en 7 corridas aisladas del archivo. El CAE de B7 depende del instante de emisión (`comprobante-fiscal.service.ts:118, :241`), así que el contenido del QR cambia en cada corrida y a veces zxing no lo decodifica. El mismo patrón aparece en `T:659`. Es un test de G3, no un defecto del producto.

**Causa confirmada y corrección (15/10/2026, rama `feature/documentacion-hu-restantes`):**
se generaron 2000 QR con el mismo payload de B7 y CAE aleatorios. Sin hints, `QRCodeReader`
falló en 4 (≈ 0,2 %). Con el hint `PURE_BARCODE` falló en 0, y decodificó el texto exacto en
todos los casos. El QR de B7 es válido; lo que falla es la detección heurística de zxing.
`decodificarQr` ahora pasa `PURE_BARCODE` (`T:93-94`), porque la imagen es el QR limpio que
genera `qrcode`. No cambia código de producto.

### 10.2. Fuentes que no coinciden

- La Asignación (§Cluster 4) habla de «dos QR inválidos»; el seed siembra **seis** comprobantes con el placeholder: el de mostrador (`seed.ts:3198`) y cinco de la tienda web, creados en un bucle (`:4719`).
- La corrección filtra por el texto exacto del placeholder (`seed.ts:5217`): un QR inválido con otro contenido seguiría respondiendo 422. Es coherente con G3-3, pero no se corrige solo.
- El Backlog dice «Contador/Auditor»; solo existe el rol `AUDITOR`.
- El comentario del Sidebar nombra «Cuentas propias» en el orden del grupo (`Sidebar.tsx:308`), que aún no existe (G5); el test lo tolera (`T:649-651`).

### 10.3. UX ante un QR inválido

«Ver PDF» y «Descargar PDF» son enlaces directos a la ruta (`[id]/page.tsx:120-135`, `TablaComprobantes.tsx:127-134`). Si el QR es inválido, el usuario ve el JSON del 422 en la pestaña, no un mensaje de la aplicación.

### 10.4. Numeración visible distinta entre listado y PDF

El listado y el detalle muestran `V-2026-000001` y `NC-V-2026-000001` (`SVC:223-225`); el PDF muestra `N.° 00001-26000001` y, en una NC, el número de la venta original (`comprobante-web-pdf.ts:298-307`); el número del listado queda en «Referencia interna» (`:433`). La spec de G3 no define el número, así que no es un incumplimiento, pero un mismo comprobante tiene dos identificaciones visibles.

### 10.5. Detalles menores

- `page_size` no se arrastra al paginar ni al entrar al detalle: `queryBase` solo toma cinco filtros (`page.tsx:51, :75-79`). La UI no ofrece `page_size`, solo la API y la URL.
- El badge «Simulado · sin validez ante AFIP» del detalle es texto fijo (`[id]/page.tsx:115`), no depende de `es_simulado`.
- Página y conteo del listado van en dos consultas sin transacción (`SVC:258-264`).
- No hay índices en `created_at` ni `tipo_comprobante` (`schema.prisma:1879-1880`), que son los filtros del listado; con el volumen actual no es un problema.
- La matriz de roles de `H` se arma leyendo el texto del seed, no una base sembrada; los filtros no se probaron contra PostgreSQL real (`ILIKE`, frontera de día AR).

### 10.6. Documentos externos

El Alcance (§2.3, §3.3 y matriz del §5) y el Backlog (fila 11) coinciden con el comportamiento del código para G3. La spec §9.5 (Revisiones 6.1 y 6.2) también; no se encontró contradicción entre el código y la spec.

---

## 11. Referencias cruzadas

- Spec: `docs/specs/spec_modulo_G.md` §9.5 (Revisiones 6, 6.1, 6.2).
- HU-B7: `src/lib/services/ventas/comprobante-fiscal.service.ts` (CAE, QR, NC de reintegro).
- HU-B10 / HU-E9: `src/lib/services/ecommerce/comprobante-web-pdf.ts`, `pdf-marca.ts`; `docs/specs/spec_modulo_B.md` §2.10.
- HU-G4: `docs/modulos/modulo G/HU4_MODULO_G.md`; `src/lib/services/tesoreria/libro-iva.service.ts`.
- RBAC: `src/lib/auth/with-permission.ts`; seed `prisma/seed.ts:5162-5186`.
