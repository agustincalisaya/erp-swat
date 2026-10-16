# Documentación técnica de cierre — HU-B10 (Representación gráfica del comprobante fiscal — PDF)

## ERP SWAT Indumentarias — Módulo B (Ventas)

**Documento generado desde el código real** el 15/10/2026, sobre `develop`. La HU
llegó en un único commit, `79be3f8` (`feat(ventas): representación gráfica del
comprobante fiscal (HU-B10)`), mergeado en el PR #257 (`2d2463f`). Mismo estándar
que HU-G4: lo que se afirma está anclado a `archivo:línea` del código actual, y lo
que no coincide con la spec está marcado como hallazgo, no forzado para que cierre.
La spec de referencia es `docs/specs/spec_modulo_B.md` §2.10 (Revisión 7); las
decisiones propias de la HU siguen **pendientes de revisión del PM**.

> **Fuentes y prioridad.** Alcance Funcional Técnico (Módulo B §3.1, G §2.3 y §3.3)
> \> Product Backlog (hoja Sprint 5, fila HU-B10) \> Asignación y Coordinación del
> Sprint 5 \> spec. Los tres primeros son documentos personales no versionados y se
> citan solo por nombre. Los 8 criterios de la spec (B10-1 a B10-8) coinciden uno a
> uno con los del Backlog.

---

## 1. Historia de Usuario y Criterios de Aceptación

**Como** Cliente Web / Tesorero Central **necesito** que el PDF de cada comprobante
fiscal muestre la identidad de SWAT, los datos del emisor y del cliente, el detalle
de ítems y los medios de pago, con el mismo diseño en la tienda y en el repositorio
de Tesorería **para** entregar un comprobante claro y archivar una representación
gráfica completa de cada venta.

- **Story Points:** 3 · Sprint 5 · Cluster 4.
- **Alcance:** solo el PDF. No crea rutas, permisos, modelos ni migraciones, y no
  emite, regenera ni renumera datos fiscales (HU-B7).

| CA | Resumen del contrato (spec §2.10) |
|---|---|
| B10-1 | Un único diseño para Factura A, B, Ticket y NC, usado por HU-E9 y HU-G3, sin cambiar rutas, permisos ni la firma de HU-E9. |
| B10-2 | Encabezado con identidad, tipo, número `00001` + 8 dígitos, fecha, y recuadro de letra y código (A 001, B 006, NC A 003, NC B 008, Ticket 083). |
| B10-3 | Leyenda `SIMULADO — SIN VALIDEZ FISCAL ANTE AFIP` destacada, no menor que en HU-G3. |
| B10-4 | Datos del emisor, del comprobante y del cliente (o «Consumidor final»). |
| B10-5 | Ítems, medios de pago con importe y referencia, y totales (subtotal, IVA contenido 21 %, total). |
| B10-6 | La NC identifica el original y muestra «Total acreditado» en negativo; en la base sigue positivo. |
| B10-7 | Pie con el QR archivado (sin regenerar), el CAE y la referencia; ítems en varias hojas con el encabezado repetido. |
| B10-8 | Textos extraíbles; los tests de HU-E9 y HU-G3 siguen pasando; test de regresión de la descarga web. |

---

## 2. Visión general de la implementación

### 2.1. Flujo

```
HU-E9  GET /api/tienda/mis-pedidos/[id]/comprobante/descargar   (sesión Cliente Web)
   └─ obtenerComprobanteOriginalWebCliente()  ── findFirst + SELECT_DETALLE_PDF
   └─ generarComprobanteWebPdf(dto) ──────────────┐   (firma intacta, solo delega)
                                                  ▼
                                   generarComprobanteFiscalPdf(dto)   ◀── un único renderer
                                   (comprobante-web-pdf.ts + pdf-marca.ts)
                                                  ▲
   └─ generarComprobanteFiscalPdf(dto) ───────────┘
   └─ obtenerComprobanteParaPdf()  ── findUnique + SELECT_PDF
HU-G3  GET /api/tesoreria/comprobantes/[id]/pdf   (tesoreria:leer_comprobantes)
```

Ambos loaders hacen una sola lectura de solo lectura y completan el mismo DTO con
`detallePdfDePedido()` (`comprobante-web-pdf.ts:95`). El renderer no consulta la base.

### 2.2. Archivos que componen la HU

**Nuevos**

| Archivo | Rol |
|---|---|
| `src/lib/services/ecommerce/pdf-marca.ts` | Identidad reutilizable: tokens y colores (`:16`, `:41`), CUIT y emisor (`:68`, `:83`), `numeroFiscalVisible` (`:97`), isotipo vectorial (`:123`) y helpers de texto (`:154`, `:159`, `:164`). Sin dependencias del proyecto. |
| `src/lib/services/ecommerce/pdf-marca.test.ts` | 6 tests: número fiscal, CUIT contra B7, emisor, colores contra `globals.css`, isotipo. |
| `src/lib/services/ecommerce/comprobante-fiscal-pdf.test.ts` | 12 tests del renderer con texto extraído de `PDFDocument.load`. |
| `src/lib/services/ecommerce/comprobante-pdf.test-helpers.ts` | Carga aislada por `vm` del renderer (`cargarComprobantePdf`, inyecta `./pdf-marca`) y extracción de texto/operadores (`extraerPdf`). |

**Modificados**

| Archivo | Cambio |
|---|---|
| `src/lib/services/ecommerce/comprobante-web-pdf.ts` | Rediseño completo: DTO ampliado (`:58`, `:120`), proyección y mapeo comunes (`:73`, `:95`), `identificar` (`:154`), layout (`:223-449`). |
| `src/lib/services/ecommerce/mis-pedidos.service.ts` | `ComprobanteWebDescargable extends DetalleComprobantePdf` (`:133`); el loader de E9 suma `...SELECT_DETALLE_PDF` (`:387`) y `...detallePdfDePedido(pedido)` (`:417`). |
| `src/lib/services/tesoreria/comprobantes-repositorio.service.ts` | `SELECT_PDF` (`:213`), `buscarComprobante` recibe la proyección (`:268`), `obtenerComprobanteParaPdf` arma el DTO ampliado (`:285`). |
| Tests ajustados | `comprobante-web-pdf.regresion.test.ts` (reescrito, 8 tests), `comprobante-web-pdf.test.ts`, `mis-pedidos.service.test.ts`, `comprobantes-repositorio.test.ts`, `comprobantes-repositorio.http.test.ts`, `comprobante-descarga.http.integration.test.ts` (solo rótulos). |
| `package.json` | `pdf-marca.test.ts` y `comprobante-fiscal-pdf.test.ts` en `npm test`. |
| `docs/specs/spec_modulo_B.md`, `spec_modulo_E.md`, `spec_modulo_G.md` | B Rev. 7 (§2.10 nueva), un bullet en E §2.9, G Rev. 6.2 (referencia en G3-3). |

Sin migración, sin cambios en `schema.prisma`, `prisma/seed.ts` ni
`comprobante-fiscal.service.ts` (HU-B7).

---

## 3. Cumplimiento de cada Criterio de Aceptación

> **Cómo se verificó.** Unitarios que generan el PDF, lo recargan con
> `PDFDocument.load` y comparan el texto extraído; HTTP simulado de G3 y de E9;
> verificación manual del 15/10 (ver §8). Abreviaturas: `CWP` =
> `comprobante-web-pdf.ts`, `PM` = `pdf-marca.ts`, `CFP` =
> `comprobante-fiscal-pdf.test.ts`, `REG` = `comprobante-web-pdf.regresion.test.ts`,
> `G3H` = `comprobantes-repositorio.http.test.ts`.

### ✅ B10-1 — Un único renderer para E9 y G3

- `generarComprobanteWebPdf` delega sin lógica propia (`CWP:272-274`); G3 llama a
  `generarComprobanteFiscalPdf` (`api/tesoreria/comprobantes/[id]/pdf/route.ts:62`)
  y E9 a `generarComprobanteWebPdf` (`api/tienda/.../descargar/route.ts:25`).
- Rutas, sesión, permiso, loader y firma (`generarComprobanteWebPdf.length === 1`)
  no cambian.
- Tests: `REG:94` (firma), `REG:99` (la ruta de E9 conserva sesión y loader y no
  referencia Tesorería), `REG:107` (el texto extraído de ambas entradas es idéntico).

### ✅ B10-2 — Encabezado, número y recuadro de letra/código

- Banda con isotipo, «SWAT», «INDUMENTARIAS», título, `N.° <número>` y «Emitido el»
  en hora de Argentina (`CWP:230-237`, `PM:123`).
- Letra y código por tipo en `identificar` (`CWP:154-170`): A `001`, B `006`,
  Ticket `T`/`083`, NC A `003`, NC B `008`; el recuadro se dibuja en `CWP:241-249`.
- Número: `numeroFiscalVisible` (`PM:97`) → `00001-<últimos 8 dígitos>`; la NC usa el
  número de su venta original (`CWP:296-307`).
- Tests: `CFP:85`, `:144`, `:174`, `:192`; `pdf-marca.test.ts:22` y `:31`;
  `G3H:356` (Ticket `COD. 083`, NC web `COD. 008`).
- La NC sobre un Ticket o sin original no lleva recuadro ni código (`CWP:166-167`,
  `CFP:174`): decisión abierta con el PM (§10.3).

### ✅ B10-3 — Leyenda de simulado

`LEYENDA_SIMULADO` (`CWP:130`) se dibuja en `nuevaPagina` a 12 pt, negrita, sobre
`--warning` (`CWP:252-257`), así que sale en todas las hojas. Tests: `CFP:111` lee
el operador `Tf` y exige ≥ 12; `CFP:242` verifica la leyenda en cada página.

### ✅ B10-4 — Emisor, comprobante y cliente

- Tres columnas EMISOR / COMPROBANTE / CLIENTE (`CWP:313-339`). El emisor sale de
  `EMISOR` (`PM:83`): razón social, CUIT simulado `30-00000000-7`, domicilio y PV
  `00001`. El comprobante muestra pedido, canal (`—` si falta), fecha y CAE.
- Cliente: nombre y `DNI <dni>`, o «Consumidor final» sin cliente (`CWP:314`).
- Tests: `CFP:85`, `:192`; `pdf-marca.test.ts:37` (el CUIT coincide con
  `CUIT_EMISOR_SIMULADO` de B7) y `:46`.
- Domicilio y bajada son valores de ejemplo (`PM:79-82`), pendientes del PM.

### ✅ B10-5 — Ítems, pagos y totales

- Tabla de ítems con descripción, variante·SKU, cantidad, precio unitario y
  subtotal (`CWP:357-385`); el subtotal de línea aplica el descuento porcentual en
  centavos enteros (`CWP:187-190`).
- Medios de pago con etiqueta, referencia e importe (`CWP:403-412`).
- Totales (`CWP:388-422`): `TOTAL = monto_total` (el importe del QR), `Subtotal`
  si hay ítems, `Descuento` solo si `Subtotal > TOTAL`, e `IVA contenido (21 %)` =
  `total − round(total / 1,21)` (`CWP:393`).
- Tests: `CFP:85` (Factura B, IVA 7.688,43), `:117` (cupón: Subtotal 22.800,
  Descuento -3.420, IVA 3.363,47, TOTAL 19.380), `:132` (descuento de línea).

### ✅ B10-6 — Nota de Crédito

- Bloque «ANULA» con tipo, número fiscal, pedido y fecha del original, tomados de
  `comprobante_original` (la relación, no el número) (`CWP:343-354`).
- «COBRADO EN LA VENTA ORIGINAL» en positivo (`CWP:404`, `:409-410`) y «TOTAL
  ACREDITADO» con `signo * total` (`CWP:421-422`). El signo es solo de presentación:
  el DTO conserva `monto` positivo (`CFP:171`; `comprobantes-repositorio.test.ts:515`).
- Tests: `CFP:144`; `G3H:356` (NC web con `ANULA`, `TOTAL ACREDITADO`, `-$ 10.000,00`).
- Con descuento, la línea «Descuento» de la NC también sale en negativo (`CWP:396`;
  test `CFP:272`). Corregido después del cierre (ver §10.2).

### ✅ B10-7 — Pie con QR y paginación

- Pie con el QR embebido tal cual (`CWP:426`; regex y `embedPng` en `:282-292`,
  nunca se regenera), CAE, comprobante y referencia interna (`CWP:425-437`), solo
  en la última hoja.
- Si el siguiente ítem no entra, se abre una hoja con banda, leyenda y encabezado de
  tabla repetidos (`CWP:364-367`); la franja «Página n de N» va en todas (`:440-447`).
- Tests: `CFP:234` (mismo ancho de imagen que el PNG archivado), `:242` (30 ítems:
  > 1 hoja, encabezado, leyenda y paginación en cada una, QR solo en la última).

### ✅ B10-8 — Textos extraíbles y regresión

- Todo texto usa `drawText`; el signo negativo es el guion ASCII (`CWP:178-180`,
  `CFP:170`). Todos los tests extraen el texto con `PDFDocument.load`.
- Regresión de E9 reescrita sobre el diseño nuevo: `REG:114` (200, adjunto,
  `private, no-store`, el loader recibe el cliente de la sesión), `:132` (404 de
  pedido ajeno), `:138`, `:151` y `:155` (QR inválido nunca produce PDF).
- Los tests de G3 siguen en `npm test` (`comprobantes-repositorio.test.ts`,
  `comprobantes-repositorio.http.test.ts`). Los dos de E9 que corren aparte tienen
  salvedades (§10.4).

### Resumen

| CA | Estado | Cobertura automática |
|---|---|---|
| B10-1 | ✅ | Unitaria (`REG:94, :99, :107`) |
| B10-2 | ✅ | Unitaria + HTTP simulado de G3 |
| B10-3 | ✅ | Unitaria (`CFP:111`, `:242`) |
| B10-4 | ✅ | Unitaria (`CFP`, `pdf-marca.test.ts`) |
| B10-5 | ✅ | Unitaria (`CFP:85, :117, :132`) |
| B10-6 | ✅ | Unitaria + HTTP simulado de G3; la NC con descuento no tiene test |
| B10-7 | ✅ | Unitaria (`CFP:234, :242`) |
| B10-8 | ✅ | Unitaria + regresión; E9 de integración no se ejecutó (§8) |

---

## 4. Contratos reales

### 4.1. Qué contiene el PDF

A4 vertical, Helvetica estándar de `pdf-lib`, colores de los tokens del tema claro
(`PM:16`; `pdf-marca.test.ts:53` los compara con `globals.css`). De arriba abajo:

1. Banda `--sidebar` con isotipo (`ShieldCheck` de lucide, ISC, `PM:113`), «SWAT
   INDUMENTARIAS», bajada y domicilio, título, `N.° 00001-NNNNNNNN` y fecha.
2. Recuadro de letra y `COD. nnn`, centrado sobre el borde de la banda.
3. Leyenda de simulado y «CAE y QR generados localmente por el sistema».
4. EMISOR · COMPROBANTE · CLIENTE.
5. «ANULA» (solo NC).
6. Tabla de ítems; 7. medios de pago; 8. totales.
9. Pie: «QR FISCAL SIMULADO», CAE, `<título> <letra> · <número>` y referencia interna.
10. Franja inferior con «No válido como factura ante AFIP» y `Página n de N`.

Los textos largos (cliente, descripción, variante·SKU, referencia de pago) se
recortan con «...» (`PM:164`). Datos ausentes: sin `items` se omiten la tabla y el
Subtotal; sin `pagos`, el bloque; sin `canal`, `—`; sin `cliente`, «Consumidor final»
(`CFP:214`). Un cliente con nombre pero sin DNI muestra `Documento —` (`CWP:325`).

### 4.2. Rutas (sin cambios)

| Ruta | Respuestas |
|---|---|
| `GET /api/tienda/mis-pedidos/[id]/comprobante/descargar` (sesión Cliente Web) | 200 `application/pdf` adjunto `comprobante-<numero>.pdf` (`descargar/response.ts:3-12`) · 404 `PEDIDO_NO_ENCONTRADO` (`http.ts:31-36`) · 500 `INTERNAL_ERROR` (`http.ts:37-41`) |
| `GET /api/tesoreria/comprobantes/[id]/pdf[?disposicion=inline]` (`tesoreria:leer_comprobantes`) | 200 `application/pdf` · 400 `VALIDATION_ERROR` · 401/403 · 404 `COMPROBANTE_NO_ENCONTRADO` · 422 `COMPROBANTE_QR_INVALIDO` (`pdf/route.ts:74-79`) · 500 |

Ambas con `Cache-Control: private, no-store` y `X-Content-Type-Options: nosniff`.

### 4.3. DTO

`ComprobanteFiscalPdf` (`CWP:120`) extiende el DTO de E9 con `monto: number | string`
y `comprobante_original` (`numero`, `tipo`, `numero_venta?`, `fecha_emision?`). Los
campos nuevos son opcionales (`DetalleComprobantePdf`, `CWP:58`): `canal`,
`cliente`, `numero_venta`, `items`, `pagos`. Ítems y pagos se leen con
`is_active = true` y `deleted_at = null` (`CWP:66`, `:78`, `:89`), verificado en
`mis-pedidos.service.test.ts:13` y `comprobantes-repositorio.test.ts:515`.

---

## 5. Decisiones de diseño

(Las marcadas con † están **pendientes de revisión del PM**, igual que en la spec.)

### 5.1. † TOTAL = `monto_total`, con línea «Descuento»

El TOTAL es siempre el importe del QR. Si los ítems suman más (cupón de HU-E4 o
descuento de línea), se muestra la diferencia (`CWP:391`, `:396`). Caso real del
seed: `V-2026-000010`, ítems $ 22.800 y total $ 19.380 (`CFP:117`).

### 5.2. † IVA contenido con la regla del Libro de IVA

`neto = round(total / 1,21, 2)`, `IVA = total − neto` (`CWP:392-393`). En centavos
enteros no existen empates exactos (la fracción es múltiplo de 1/121), por lo que
`Math.round` coincide con HALF_UP. Los importes de ejemplo coinciden con los del
Libro de IVA (44.300 → IVA 7.688,43).

### 5.3. † NC de un Ticket sin recuadro ni código

El Backlog solo define NC A (003) y NC B (008). Misma pregunta abierta que en G4.

### 5.4. † Número `00001-<últimos 8 dígitos>`

Rige el Backlog (HU-G4) sobre «nunca se trunca» de la spec G4-5. Con menos de 8
dígitos `numeroFiscalVisible` devuelve `null` y el PDF muestra el número de venta
tal cual (`CWP:307`), sin error.

### 5.5. † Emisor de ejemplo

El CUIT duplica `CUIT_EMISOR_SIMULADO` de B7 (no exportada, no se modifica) y un
test de fuente falla si divergen (`pdf-marca.test.ts:37`). Domicilio y bajada son de
ejemplo, editables en `PM:83-88`.

### 5.6. Un solo renderer con identidad en un módulo aparte

La marca vive en `pdf-marca.ts`, sin dependencias del proyecto, para que la
reutilicen otros PDF (HU-G4). `mis-pedidos.service.ts` importa del renderer (valores)
y el renderer importa de él solo tipos, por lo que no hay ciclo en tiempo de ejecución.

### 5.7. Tests con `vm` y `./pdf-marca` inyectado

`comprobante-web-pdf.ts` importa `server-only`, que falla bajo
`--experimental-strip-types`. Los tests lo transpilan en memoria con target ES2022
(con ES5 `QrFiscalInvalidoError` perdería el prototipo) y deben inyectar
`./pdf-marca` mediante `comprobante-pdf.test-helpers.ts:46-51`; cargar el renderer
sin ese mapa lanza «Dependencia inesperada».

---

## 6. Integración con otras HU

- **HU-E9:** el PDF que descarga el cliente cambia de diseño; ruta, sesión, firma y
  códigos HTTP no. Su loader suma ítems, pagos, canal y cliente a su único `findFirst`.
  E9 solo sirve el comprobante original (`tipo_comprobante: { not: "NOTA_CREDITO" }`),
  así que la NC solo se renderiza desde G3.
- **HU-G3:** `obtenerComprobanteParaPdf` suma `SELECT_PDF` (ítems, pagos, fecha del
  original) con un solo `findUnique`; el listado y el detalle conservan sus proyecciones.
- **HU-B7:** B10 no emite nada. Embebe el QR persistido y reproduce el CUIT simulado
  con un test de fuente. La NC es siempre de reintegro total
  (`comprobante-fiscal.service.ts:215`).
- **HU-G4 (Libro de IVA):** ya consume `pdf-marca.ts`. `libro-iva.reglas.ts:2` y
  `:38` usan `numeroFiscalVisible`, y `libro-iva.pdf.ts:3` y `:46` usan `COLORES` y
  `dibujarIsotipo` (mergeado después, `27110ac`). No reutiliza el renderer del
  comprobante, solo la marca.
- **HU-B3 (facturación parcial):** ver §10.5.

---

## 7. Correcciones y cambios posteriores

Ninguno propio de B10: `git log 79be3f8..HEAD` sobre los archivos de la HU (renderer,
loaders y rutas de E9 y G3) no muestra commits, y `pdf-marca.ts` tiene un único
commit. El único cambio posterior que lo toca es de consumo: G4 empezó a importarlo
(§6), sin modificarlo.

---

## 8. Verificación realizada

### 8.1. Re-ejecutado para este documento (15/10/2026, sobre `develop` actual)

| Check | Resultado |
|---|---|
| `comprobante-fiscal-pdf.test.ts` | ✅ 12/12 (incluye el test de la NC con descuento, §10.2) |
| `pdf-marca.test.ts` | ✅ 6/6 |
| `comprobante-web-pdf.regresion.test.ts` | ✅ 8/8 |
| `comprobantes-repositorio.test.ts` | ✅ 36/36 |
| `comprobantes-repositorio.http.test.ts` | ✅ 15/15 |
| `comprobante-web-pdf.test.ts` + `mis-pedidos.service.test.ts` con `node --conditions=react-server --import tsx --test` | ✅ 25/25 |
| Los mismos dos con `node --experimental-strip-types --test` | ❌ `ERR_MODULE_NOT_FOUND` (ver §10.4) |
| `npm test` | ✅ 1127/1127 (incluye lo mergeado después de B10 y el test de §10.2) |
| `npx tsc --noEmit` | ✅ sin errores |

Comprobaciones puntuales con un script descartable fuera del repo (no versionado):
el PDF de una NC con descuento, el número con menos de 8 dígitos y los conteos de
hojas citados en §10.

### 8.2. Atribuido al cierre del 15/10/2026 (no re-ejecutado)

Según el relevamiento de la HU: `npm test` 926/926 en la rama de B10, ESLint sin
errores, `npm run build` correcto, y siete descargas reales contra una instancia
propia (G3 inline y adjunto de la NC `V-2026-000001`, Factura B de mostrador,
Facturas B web `V-2026-000007` y `V-2026-000010` por G3 y por E9), todas 200
`application/pdf`, con el TOTAL del PDF igual al importe del QR embebido y la tabla
`comprobantes_fiscales` sin cambios (mismo md5 antes y después).

### 8.3. No ejecutado

`comprobante-descarga.http.integration.test.ts` solo corre con sus variables de
entorno y una base sembrada; en el commit solo cambiaron sus rótulos. No hubo
verificación visual de este documento ni capturas del PDF.

---

## 9. Qué NO se implementó, y por qué

- **Emitir, regenerar o renumerar comprobantes, CAE o QR:** es de HU-B7.
- **Numeración fiscal persistida y punto de venta real:** `00001-<8 dígitos>` es
  solo un valor de presentación.
- **Datos fiscales del cliente (CUIT, condición de IVA):** no existen en el modelo.
- **Tema oscuro, fuentes propias embebidas, PDF/A:** fuera de alcance.
- **Vista HTML del comprobante y envío por correo.**
- **Cambiar los códigos HTTP de E9:** B10 no los modifica (ver §10.1).

---

## 10. Hallazgos

### 10.1. E9 responde 500 ante un QR inválido; G3 responde 422

Con el mismo dato histórico inválido, la ruta de G3 responde `422
COMPROBANTE_QR_INVALIDO` (`pdf/route.ts:74-79`, `G3H:379`) y la de E9 cae en el 500
genérico (`http.ts:37-41`), fijado a propósito por `REG:138`. Es consistente con
«sin cambios de códigos HTTP» pero es una inconsistencia entre los dos consumidores
del mismo renderer. Unificarla sería otra HU.

### 10.2. En la NC, «Descuento» salía en positivo — corregido

La spec §2.10 («NC en negativo solo en la presentación») dice que subtotales,
subtotal, descuento, IVA y total se muestran con signo negativo. El código usa
`-signo * descuento` (`CWP:396`), así que en una NC la línea sale positiva. Generando
una NC de $ 19.380 con ítems por $ 22.800 se obtuvo: Subtotal -$ 22.800,00,
Descuento $ 3.420,00, IVA -$ 3.363,47, TOTAL ACREDITADO -$ 19.380,00. Aritméticamente
es coherente (-22.800 + 3.420 = -19.380), pero no es lo que dice la spec, y ningún
test cubría una NC con descuento.

**Corrección (15/10/2026, rama `feature/documentacion-hu-restantes`):** se siguió la
spec. La línea pasa a `-descuento` (`CWP:396`), sin depender del signo del
comprobante: en la factura y en la NC el descuento sale negativo. Ahora la NC muestra
Subtotal -$ 22.800,00, Descuento -$ 3.420,00, IVA -$ 3.363,47 y TOTAL ACREDITADO
-$ 19.380,00. Lo cubre el test `CFP:272`. La factura no cambia, porque con
`signo = 1` el resultado era el mismo.

### 10.3. Decisiones abiertas con el PM

NC de un Ticket sin recuadro ni código (§5.3); línea «Descuento» (§5.1); «últimos 8
dígitos» contra G4-5 (§5.4); domicilio fiscal real del emisor (§5.5).

### 10.4. Dos tests de E9 fuera de `npm test`

`comprobante-web-pdf.test.ts` y `mis-pedidos.service.test.ts` no figuran en el script
`test`. Con `--experimental-strip-types` fallan (el primero por el import extensionless
de `./pdf-marca`, el segundo por el alias `@/lib`); pasan con
`--conditions=react-server --import tsx` (25/25). Antes de B10 el primero ya estaba
fuera del script; no se detectaría una regresión en ellos desde `npm test`.

### 10.5. Los ítems salen del pedido, no del comprobante

El modelo no vincula ítems con comprobantes. Si un pedido tuviera más de un original
por entregas parciales (HU-B3), cada PDF mostraría todos los ítems del pedido con su
TOTAL propio y la diferencia aparecería rotulada como «Descuento». Hoy ningún pedido
tiene más de un original, y la NC es siempre total (`comprobante-fiscal.service.ts:215`),
por lo que el caso no ocurre. Limitación documentada en la spec.

### 10.6. Hoja final solo con totales y pie

El pie y los totales exigen espacio libre hasta `Y_PIE + 24 = 174` (`CWP:206`, `:210`,
`:401`), mientras que los ítems llegan hasta `Y_MINIMO = 56` (`CWP:208`). Medido con
una Factura B con un pago: hasta 8 ítems caben en una hoja; con 9 a 12 ítems el PDF
tiene 2 hojas y la segunda no lleva ítems; con 30 ítems son 3 hojas y la última tampoco.
Es correcto según la spec («después del último ítem»), pero poco prolijo, y
`CFP:242` solo exige `> 1` hoja.

### 10.7. Detalles menores

- Sin test: número de venta con menos de 8 dígitos dentro del PDF (solo el helper,
  `pdf-marca.test.ts:31`); «—» cuando falta el canal; recorte con «...».
- `pdf-marca.test.ts:37` compara el CUIT leyendo el texto de B7: si B7 cambia el
  formato de la constante, el test falla aunque el valor no divergiera.
- El docstring de la ruta de G3 (`pdf/route.ts:6`) aún dice que reutiliza el renderizado
  de HU-E9; hoy el renderer es el de HU-B10.

---

## 11. Referencias cruzadas

- Spec: `docs/specs/spec_modulo_B.md` §2.10 (Revisión 7); `spec_modulo_E.md` §2.9
  (bullet «PDF del comprobante»); `spec_modulo_G.md` G3-3 (Revisión 6.2).
- HU-E9: `src/lib/services/ecommerce/mis-pedidos.service.ts`,
  `src/app/api/tienda/mis-pedidos/[id]/comprobante/descargar/`.
- HU-G3: `src/lib/services/tesoreria/comprobantes-repositorio.service.ts`,
  `src/app/api/tesoreria/comprobantes/[id]/pdf/route.ts`.
- HU-B7: `src/lib/services/ventas/comprobante-fiscal.service.ts`.
- HU-G4: `docs/modulos/modulo G/HU4_MODULO_G.md`, `src/lib/services/tesoreria/libro-iva.*`.
