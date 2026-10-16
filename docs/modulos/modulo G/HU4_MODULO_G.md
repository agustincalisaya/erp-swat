# Documentación técnica de cierre — HU-G4 (Libro de IVA: consulta, PDF y TXT)

## ERP SWAT Indumentarias — Módulo G (Gestión de Caja y Tesorería)

**Documento generado desde el código real** el 15/10/2026, sobre la rama
`feature/hu-g-04-libro-iva-digital` (base `develop` en `2d2463f`, cambios aún sin
commit al momento de redactarlo). Mismo estándar que HU-G8 y HU-G10: lo que se
afirma está anclado a `archivo:línea`, y lo que no coincide con la spec está
marcado como hallazgo, no forzado para que cierre.

> **Aviso de origen.** La implementación inicial la hizo Codex a partir del
> relevamiento del 15/10/2026. Después se revisó, se corrigieron tres problemas
> (§7.1) y se aplicaron ajustes de presentación (§7.2). La spec de referencia es
> `docs/specs/spec_modulo_G.md` §9.6, Revisión 6.5.

---

## 1. Historia de Usuario y Criterios de Aceptación

**Como** Contador/Auditor **necesito** consultar y exportar las ventas y compras
del mes **para** revisar la consolidación de IVA sin un proceso manual.

- **Story Points:** 5
- **Roles autorizados:** Auditor y Administrador (matriz G).
- **Alcance:** libro interno con alícuota única del 21%. No se presenta ante
  ningún organismo ni promete conformidad con el aplicativo fiscal externo.

| CA | Resumen del contrato (spec §9.6) |
|---|---|
| G4-1 | Ventas por `ComprobanteFiscal.created_at` (A, B, Ticket y NC con importes negativos); compras activas por `fecha_emision`. Un comprobante, una línea. |
| G4-2 | `neto = redondear(total / 1.21, 2, HALF_UP)`, `IVA = total − neto`, signo de NC al final. Un negativo almacenado es error. Alícuota `21.00` fija. |
| G4-3 | TXT UTF-8 con `;`, una línea por comprobante, orden estable y 11 columnas exactas; texto saneado. |
| G4-4 | Códigos 001/003/006/008/011/051/083; documentos 80/96/99. NC sin tipo determinable = error. |
| G4-5 | Ventas: PV `00001`, últimos 8 dígitos del número de venta; la NC usa el número de su venta original. Compras: CUIT y número de H9, PV por defecto `00001`. Colisiones = error. |
| G4-6 | Título `Libro de IVA`, nombres `Libro de IVA - ventas - AAAA-MM.pdf/.txt` con fallback ASCII, sin banners técnicos. |
| G4-7 | `tesoreria:exportar_libro_iva` en servidor; solo Auditor y Administrador. |
| G4-8 | Cada descarga emite `tesoreria:libro_iva_exportado`, confirmado por D.3 antes del 200, sin datos personales. |
| G4-9 | Vista `/tesoreria/libro-iva`: selector mensual en español, pestañas, tarjetas, tabla con búsqueda y 15 filas por página. |
| G4-10 | PDF A4 horizontal con encabezado repetido, totales, fecha de generación y numeración de páginas. |
| G4-11 | `formato=txt\|pdf\|json` (por defecto `txt`); JSON sin auditoría; validación estricta y `private, no-store` + `nosniff`. |

---

## 2. Visión general de la implementación

### 2.1. Flujo

```
Página (server) ──permiso──▶ DescargasLibroIva (client)
                                 │  fetch ?formato=json  (consulta, sin auditoría)
                                 │  fetch ?formato=pdf|txt (descarga)
                                 ▼
GET /api/tesoreria/libro-iva/{ventas|compras}
   withPermission(tesoreria:exportar_libro_iva) → Zod estricto
   → generarLibroIva()  (consulta completa + reglas puras + Decimal)
   → pdf | txt          → auditarExportacionLibroIva()
                              │ espera confirmación por exportacion_id (≤ 30 s)
                              ▼
                       listener central D.3 → registrarAuditLog → confirma
   → 200 con el archivo  (o 503 si la auditoría no confirma)
```

Los tres formatos salen de la misma proyección del servidor
(`libro-iva.service.ts`) y de las mismas sumas `Decimal`. La UI nunca recalcula
importes.

### 2.2. Archivos que componen la HU

**Nuevos**

| Archivo | Rol |
|---|---|
| `src/app/(dashboard)/tesoreria/libro-iva/page.tsx` | Página server: valida sesión y permiso (`:14`) y monta el componente. |
| `src/app/api/tesoreria/libro-iva/ventas/route.ts`, `.../compras/route.ts` | Route handlers de 3 líneas que delegan en `libro-iva.http.ts`. |
| `src/lib/services/tesoreria/libro-iva.http.ts` | Handler compartido: permiso, validación, formatos, cabeceras y mapeo de errores HTTP. |
| `src/lib/services/tesoreria/libro-iva.service.ts` | Consulta completa de ventas (núcleo de G3) y compras (H9), proyección fiscal, colisiones y totales. |
| `src/lib/services/tesoreria/libro-iva.reglas.ts` | Reglas puras: numeración, documentos, códigos, cálculo de neto/IVA, línea TXT y nombres de archivo. |
| `src/lib/services/tesoreria/libro-iva.pdf.ts` | Generador PDF A4 horizontal (pdf-lib, identidad SWAT). |
| `src/lib/services/tesoreria/libro-iva.constants.ts` | Tipos `LibroIvaVista` / `TipoLibroIva` y constantes. |
| `src/lib/services/tesoreria/libro-iva.presentacion.ts` | Formateo para la UI: `MESES_LIBRO`, moneda, fechas y tipos. |
| `src/lib/schemas/libro-iva.schema.ts` | Zod `.strict()` de `mes` y `formato`. |
| `src/components/tesoreria/DescargasLibroIva.tsx` | Vista cliente: selector, pestañas, tarjetas, tabla y descargas. |
| `src/lib/events/libro-iva-auditoria.ts` | Emite el evento y espera la confirmación de D.3. |
| `src/lib/events/libro-iva-confirmacion.ts` | Registro de esperas por `exportacion_id` (singleton de proceso, timeout por defecto 30 s en `:12`). |
| Tests: `libro-iva.reglas.test.ts` (7), `libro-iva.service.test.ts` (6), `libro-iva.pdf.test.ts` (2), `libro-iva-confirmacion.test.ts` (3), `libro-iva.integration.test.ts` (1 suite con 5 subtests) | Unitarios en `npm test`; integración con `npm run test:integration:g4`. |

**Modificados**

| Archivo | Cambio |
|---|---|
| `prisma/seed.ts` | `seedHuG4LibroIva()` (`:5126`, llamada en `:5094`): permiso `...051` para Auditor y Administrador. |
| `src/components/layout/Sidebar.tsx` | Entrada «Libro de IVA» en Tesorería, ícono `BookOpen`, permiso propio. |
| `src/lib/events/event-types.ts` | `LibroIvaExportadoPayload` y registro del evento `tesoreria:libro_iva_exportado`. |
| `src/lib/events/listeners/audit-log.listener.ts` | Handler de G4: whitelist de `valor_nuevo` y confirmación posterior al append. |
| `package.json` | Tests de G4 en `npm test` y script `test:integration:g4`. |
| `docs/specs/spec_modulo_G.md` | Revisiones 6.3, 6.4 y 6.5 de §9.6. |

No hay migración: G4 reutiliza `ComprobanteFiscal`, `ComprobanteProveedor` y
`AuditLog`.

---

## 3. Cumplimiento de cada Criterio de Aceptación

> **Cómo se verificó.** Tres niveles: (1) 18 tests unitarios en `npm test`;
> (2) integración real con PostgreSQL y HTTP en una base descartable
> (`swat_erp_test_e13_g4_v2`, 6/6 PASS); (3) verificación manual por HTTP
> contra la base de desarrollo el 15/10/2026, con los datos citados en §8.
> Abreviaturas: `SVC` = `libro-iva.service.ts`, `REG` = `libro-iva.reglas.ts`,
> `HTTP` = `libro-iva.http.ts`, `INT` = `libro-iva.integration.test.ts`.

### ✅ G4-1 — Universo completo de ventas y compras del período

- Ventas con el núcleo de consulta de G3, sin paginación ni filtros de pantalla y
  ordenadas por fecha/id (`SVC:64-65`).
- Compras con `is_active = true` y `fecha_emision` dentro del mes (`SVC:85-89`).
- Sin joins a pagos ni ítems, así que un comprobante produce una sola línea (`SVC:15-23`).
- Tests: `libro-iva.service.test.ts:43` (where sin take/skip), `:68` (compras);
  `INT:83` (ambos canales, fronteras diciembre/enero, NC de otro mes,
  independencia de pagos).

### ✅ G4-2 — Neto, IVA y signo

- `REG:73-83`: rechaza no finitos y negativos (`:76`); neto half-up (`:79`),
  IVA por diferencia (`:80`), signo de NC al final con cero normalizado (`:81`).
- Alícuota `21.00` agregada en la línea (`REG:100`).
- Test: `libro-iva.reglas.test.ts:41`.

### ✅ G4-3 — Formato TXT

- `REG:98-101`: `;`, CR y LF pasan a espacio con trim; LF al final de cada línea;
  libro vacío = 0 bytes; sin BOM ni cabecera.
- Test: `libro-iva.reglas.test.ts:54`.

### ✅ G4-4 — Códigos de comprobante y documento

- `REG:50-71`: ventas A/B/Ticket/NC A/NC B, compras A/B/C/M. Una NC cuyo original
  no es A/B produce error.
- Documentos: `96`/`99` en `REG:44-48`; `80` (CUIT de proveedor) en `SVC:93`.
- Test: `libro-iva.reglas.test.ts:32`.

### ✅ G4-5 — Numeración, contraparte y colisiones

- **Últimos 8 dígitos** con `numeroFiscalVisible` (`REG:38`); con menos de 8,
  `NUMERO_VENTA_INVALIDO` (`REG:39`).
- **NC con el número de su venta original** (`SVC:79`).
- **Más de una NC por original = error**, contando hermanas fuera del mes (`SVC:73`).
- **Clave de colisión** `emisor:tipo:pv:numero` (`SVC:48-49`); en compras el
  emisor es el CUIT normalizado, así que proveedores distintos pueden repetir número.
- **PV por defecto `00001`** cuando H9 no registra PV (`REG:25`).
- **Consumidor final `99`** sin cliente, y DNI presente corrupto = error (`REG:45-46`).
- Tests: `libro-iva.reglas.test.ts:7, :15, :26-28`; `libro-iva.service.test.ts:57, :63, :68, :74, :88`; `INT:97-102`.
- Evidencia manual: la compra `4568` (sin PV) sale como `00001;00004568`, y la
  NC de la venta `…26000001` repite ese número con código `008` (§8.3).

### ✅ G4-6 — Presentación y nombres de archivo

- Nombres en `REG:103-109` con fallback ASCII (`REG:107`); verificados por HTTP:
  `filename="Libro_IVA_ventas_2026-10.pdf"; filename*=UTF-8''Libro%20de%20IVA%20-%20ventas%20-%202026-10.pdf`.
- Título «Libro de IVA» (`DescargasLibroIva.tsx:113`); sin banners de simulación
  en la vista ni en el PDF.
- Tests: `libro-iva.reglas.test.ts:64-65`; `libro-iva.pdf.test.ts:31` e `INT:162`
  (no aparece `SUBCONJUNTO INTERNO`).
- El único texto técnico visible es la lista de IDs ante un 422 (ver §5.2).

### ✅ G4-7 — Permiso en servidor, solo Auditor y Administrador

- API: `withPermission(PERMISO_EXPORTAR_LIBRO_IVA)` envuelve los tres formatos y
  corre antes que la validación (`HTTP:19`).
- Página: `page.tsx:14`. Sidebar: entrada con el mismo permiso.
- Seed: `prisma/seed.ts:5146`, solo `ROL_AUDITOR_ID` y `ROL_ADMINISTRADOR_ID`.
- Tests: `INT:31-33` (roles sembrados), `INT:128-165` (cinco perfiles,
  401/403/200, revocación, redirección de la página), `INT:167-171` (403 en json/pdf).
- Evidencia manual: Cajero POS recibe 403 en las 6 combinaciones (§8.5).

### ✅ G4-8 — Auditoría confirmada por D.3

- Emisión con `exportacion_id = randomUUID()` (`libro-iva-auditoria.ts:12, 19-21`).
- El handler del listener guarda solo `exportacion_id`, `periodo`, `tipo_libro`,
  `formato` y `timestamp`; el actor va en `usuario_id`.
- El 200 se devuelve recién después del `await` de la confirmación (`HTTP:31`).
  Timeout por defecto de 30 s (`libro-iva-confirmacion.ts:12`) → excepción → 503 (`HTTP:14`).
- Tests: `libro-iva-confirmacion.test.ts:26` (confirma tras el append, sin PII),
  `:62` (ausencia, rechazo, timeout); `INT:191` (fallo real de append → 503 sin
  archivo ni asiento); `INT:208` (concurrencia y cadena íntegra).

### ✅ G4-9 — Vista responsive

`DescargasLibroIva.tsx`:

- Selectores de mes y año en español con anterior/siguiente (`:117-128`).
- Pestañas Ventas/Compras (`:133-141`).
- Tarjetas de comprobantes (con la cantidad de NC como subtítulo), neto, IVA y total (`:146-149`).
- Búsqueda local y `TAMANO_PAGINA = 15` (`:11, :95-99`).
- Totales del período completo (`libro.totales`, pie de tabla `:172`).
- `AbortController` para descartar respuestas viejas (`:39, :59`).
- Estados de carga, vacío y error por libro (`:166-168`).

Sin tests de componente: el proyecto no tiene infraestructura para eso. Se
verificó en el navegador (§8.6).

### ✅ G4-10 — PDF

`libro-iva.pdf.ts`:

- A4 horizontal (`:12`).
- Encabezado con isotipo en cada página (`:43-65`) y tarjetas de resumen (`:53`).
- Ajuste de línea de nombres (`:27-40, :83`) y fila de TOTAL (`:105-111`).
- «Generado … · Página i de n» en hora argentina (`:15, :112-116`).
- Mensaje de libro vacío (`:78-81`).

Tests: `libro-iva.pdf.test.ts:17` (60 filas, encabezado repetido, totales) y `:34` (PDF vacío válido).

### ✅ G4-11 — Formatos y contrato HTTP

- Schema `.strict()` con `formato` enum (`libro-iva.schema.ts:5`).
- `mes` o `formato` repetidos = 400 (`HTTP:20-23`).
- Por defecto `txt` (`HTTP:25`).
- JSON `{data, error:null}` sin auditoría (`HTTP:27`).
- Cabeceras de no-caché en todas las respuestas, incluidos errores (`HTTP:53-54`).
- Tests: `libro-iva.reglas.test.ts:68`; `INT:146, :167-189`.
- Evidencia manual: las consultas JSON hechas el 15/10 no generaron filas en
  `audit_logs`; las PDF/TXT sí (§8.4).

### Resumen

| CA | Estado | Cobertura automática |
|---|---|---|
| G4-1 a G4-5 | ✅ | Unitaria + integración |
| G4-6 | ✅ | Unitaria + integración (el texto de la UI no tiene test) |
| G4-7, G4-8, G4-11 | ✅ | Integración (HTTP real) + unitaria |
| G4-9 | ✅ | Manual (sin tests de componente) |
| G4-10 | ✅ | Unitaria (la fecha de generación y el ajuste de línea no se asertan) |

---

## 4. Contratos reales

### 4.1. Endpoints

| Método | Ruta | Respuestas |
|---|---|---|
| GET | `/api/tesoreria/libro-iva/ventas?mes=AAAA-MM&formato=txt\|pdf\|json` | 200 · 400 `VALIDATION_ERROR` · 401 · 403 `FORBIDDEN` · 422 `LIBRO_IVA_DATOS_INVALIDOS` · 503 `LIBRO_IVA_AUDITORIA_NO_CONFIRMADA` · 500 |
| GET | `/api/tesoreria/libro-iva/compras?…` | Igual que ventas |

### 4.2. Cuerpo del 422

```json
{ "data": null,
  "error": { "code": "LIBRO_IVA_DATOS_INVALIDOS", "message": "…",
    "details": { "incidencias": [{ "comprobante_id": "<uuid>", "motivo": "NUMERO_VENTA_INVALIDO" }],
                 "total_incidencias": 25, "hay_mas": true } } }
```

`incidencias` se corta en 20 (`SVC:55`). Los `motivo` son constantes, sin
nombres, documentos ni importes (`libro-iva.service.test.ts:77`).

### 4.3. Evento y fila de auditoría

- Evento de bus: `tesoreria:libro_iva_exportado` (`LibroIvaExportadoPayload` en `event-types.ts`).
- Fila: `accion = LIBRO_IVA_EXPORTADO`, `tabla_afectada = libro_iva`,
  `registro_id = exportacion_id`, `valor_nuevo = {exportacion_id, periodo, tipo_libro, formato, timestamp}`.

### 4.4. Permiso

`tesoreria:exportar_libro_iva`, UUID `1a2b3c4d-1111-4a1a-8a1a-000000000051`,
asignado a AUDITOR y ADMINISTRADOR en `seedHuG4LibroIva()`. El seed falla si
el UUID o el código ya existen con otro dueño (`seed.ts:5134`) y avisa si hay
otros roles vinculados (`:5153-5158`).

---

## 5. Decisiones de diseño

### 5.1. Se conserva el TXT

El PDF pasó a ser la descarga principal, pero el TXT es lo «digital» de la HU y
lo exigen G4-3 y G4-11. Ambos salen de la misma proyección.

### 5.2. Los IDs técnicos se dejan en el 422

Cuando un comprobante tiene datos inválidos, el 422 lista hasta 20
`comprobante_id` y la UI los muestra en el mensaje de error
(`DescargasLibroIva.tsx:21-23`). Sirve para que el auditor pueda ubicar el
registro a corregir. Solo se muestran UUID y un motivo constante, sin datos personales.

### 5.3. Confirmación específica de auditoría, sin tocar el bus global

El bus es un `EventEmitter` síncrono y `emit` no confirma la escritura. G4 espera
la confirmación por `exportacion_id` con un registro propio, y el handler de G4
se identifica con `Symbol.for` para no duplicarse en recargas. No hay polling ni
reintentos, y no se modificó la semántica de otros eventos.

### 5.4. Compras por día calendario UTC

H9 guarda la fecha HTML como calendario, por eso compras usa `rangoMesFechaSolo`
y ventas usa instantes argentinos (`rangoMesNegocio`). No se transforman datos
históricos.

### 5.5. Selector de período propio

El `<input type="month">` se mostraba en el idioma del navegador. Se reemplazó
por dos `<select>` con `MESES_LIBRO` en español.

---

## 6. Integración con otras HU

- **HU-G3:** G4 reutiliza su núcleo de consulta de comprobantes, sin pasar por la
  API paginada. Los tests de G3 quedan sin cambios respecto de `develop`.
- **HU-B7/B10:** `numeroFiscalVisible` da los últimos 8 dígitos del número de venta.
- **HU-E13:** la NC de reintegro total usa el número de la venta original. Rechazar
  más de una NC por original es una limitación de este libro, no una regla del dominio.
- **HU-H9:** origen de compras (`numero_comprobante`, `fecha_emision`, CUIT del proveedor).
- **Módulo D (D.3):** el listener central es la única vía a `registrarAuditLog`;
  `INT:208` verifica la cadena SHA-256 íntegra bajo concurrencia.

---

## 7. Correcciones y cambios posteriores

### 7.1. Correcciones al trabajo de Codex

1. **Test inestable.** Se estabilizó un test de Codex que fallaba de forma
   intermitente. En las corridas del 15/10, `npm test` y la integración pasan completos.
2. **Test de G3 restaurado.** Codex había modificado un test de G3. Se restauró
   al estado de `develop`: hoy
   `git diff -- src/lib/services/tesoreria/comprobantes-repositorio*` está vacío.
3. **Permiso movido a `seedHuG4LibroIva()`.** El test G3 «Paso 1 · la NC» recorta
   el texto del seed entre los bloques de Cluster 4 y Cluster 5 y prohíbe el
   UUID `000000000051` en ese tramo. El permiso de G4 se movió a una función
   propia, definida antes de `seedSprint5Cluster4` (`seed.ts:5126`) y llamada
   entre Cluster 4 y Cluster 5 (`:5093-5095`).

### 7.2. Cambios posteriores

| Cambio | Dónde |
|---|---|
| Selector de mes/año en español (dos `<select>` en lugar del control del navegador) | `DescargasLibroIva.tsx:117-128` |
| Plural de notas de crédito («1 nota» / «N notas de crédito») | `DescargasLibroIva.tsx:146` |
| Ícono `BookOpen` en el Sidebar | `Sidebar.tsx` |
| Color del selector en tema claro: `text-sidebar-foreground`, porque la regla base de `globals.css` pinta los `<select>` con `--foreground` (oscuro en tema claro) | `DescargasLibroIva.tsx:13-15` |

---

## 8. Verificación realizada (15/10/2026)

### 8.1. Gates técnicos

| Check | Resultado |
|---|---|
| `npm test` | ✅ 944/944 |
| `npx tsc --noEmit` | ✅ sin errores |
| `npx eslint` sobre los archivos de G4 | ✅ 0 errores (2 avisos previos en `seed.ts:138-139`, ya presentes en `develop`) |
| `npm run lint` global | ❌ 15 errores, todos en `.claude/skills/**/*.cjs` (setup local, fuera del repo) |
| `next build` | ✅ incluye `/tesoreria/libro-iva` y las dos APIs |
| `npm run test:integration:g4` en `swat_erp_test_e13_g4_v2` (base nueva, migrada y sembrada) | ✅ 6/6 |

### 8.2. Ventas 2026-10 (auditor.seed)

| Formato | HTTP | Content-Type | Tamaño |
|---|---|---|---|
| PDF | 200 | `application/pdf` | 4093 B |
| TXT | 200 | `text/plain; charset=utf-8` | 507 B (6 líneas) |

Cabeceras: `cache-control: private, no-store`, `x-content-type-options: nosniff`,
`content-disposition: attachment; filename="Libro_IVA_ventas_2026-10.txt"; filename*=UTF-8''Libro%20de%20IVA%20-%20ventas%20-%202026-10.txt`.

```text
20261001;006;00001;26000009;96;30123456;Juan Pérez;21500.00;17768.60;3731.40;21.00
20261012;006;00001;26000008;96;30123456;Juan Pérez;22800.00;18842.98;3957.02;21.00
20261013;006;00001;26000007;96;30123456;Juan Pérez;44300.00;36611.57;7688.43;21.00
20261014;006;00001;26000006;96;30123456;Juan Pérez;22800.00;18842.98;3957.02;21.00
20261015;006;00001;26000001;96;30123456;Juan Pérez;45000.00;37190.08;7809.92;21.00
20261015;008;00001;26000001;96;30123456;Juan Pérez;-45000.00;-37190.08;-7809.92;21.00
```

### 8.3. Compras 2026-10 (auditor.seed)

La base de desarrollo no tenía comprobantes de proveedor. Se registraron dos por
el flujo real de HU-H9 (`POST /api/ordenes-compra/{id}/comprobantes`, como
`comprador.seed`, ambos 201):

| OC | Tipo | `numero_comprobante` | Fecha | Total |
|---|---|---|---|---|
| OC-2026-0002 | FACTURA_A | `0002-00004567` | 2026-10-14 | 242000 |
| OC-2026-0001 | FACTURA_B | `4568` (sin PV) | 2026-10-15 | 60500 |

| Formato | HTTP | Content-Type | Tamaño |
|---|---|---|---|
| PDF | 200 | `application/pdf` | 3200 B |
| TXT | 200 | `text/plain; charset=utf-8` | 224 B |

```text
20261014;001;00002;00004567;80;30712345678;Indumentaria Táctica del Sur S.A.;242000.00;200000.00;42000.00;21.00
20261015;006;00001;00004568;80;30712345678;Indumentaria Táctica del Sur S.A.;60500.00;50000.00;10500.00;21.00
```

El JSON del mismo período devuelve `totales: {comprobantes: 2, notas_credito: 0,
neto: "250000.00", iva: "52500.00", total: "302500.00"}`. El CUIT
`30-71234567-8` sale normalizado a 11 cifras, y el comprobante sin PV toma `00001`.

### 8.4. Registros de auditoría

```sql
SELECT a.created_at, u.nombre_usuario AS actor, a.accion, a.tabla_afectada,
       a.valor_nuevo->>'tipo_libro' AS tipo, a.valor_nuevo->>'periodo' AS periodo,
       a.valor_nuevo->>'formato' AS formato, a.valor_nuevo->>'exportacion_id' AS exportacion_id,
       left(a.hash_actual, 12) AS hash
FROM audit_logs a LEFT JOIN usuarios u ON u.id = a.usuario_id
WHERE a.accion = 'LIBRO_IVA_EXPORTADO'
ORDER BY a.created_at DESC;
```

| actor | tipo | periodo | formato | exportacion_id | hash |
|---|---|---|---|---|---|
| auditor.seed | COMPRAS | 2026-10 | TXT | `2d146f15-…` | `660416f7a877` |
| auditor.seed | COMPRAS | 2026-10 | PDF | `5ec9f35d-…` | `ea3798c75a2c` |
| auditor.seed | VENTAS | 2026-10 | TXT | `b79a6b73-…` | `299f7e8301db` |
| auditor.seed | VENTAS | 2026-10 | PDF | `1fb14010-…` | `cbfe0da06d0b` |
| administrador.seed | VENTAS | 2026-10 | PDF | `6b1db9a0-…` | `c013d53785f0` |
| administrador.seed | VENTAS / COMPRAS | 2026-01 / 2026-10 | *(null)* | 3 filas | — |

Las tres filas con `formato` nulo son de corridas anteriores al agregado de ese
campo. Las consultas `formato=json` del mismo día no dejaron filas, como pide G4-11.

### 8.5. Cajero POS (cajero.seed)

| Libro | txt | pdf | json |
|---|---|---|---|
| ventas | 403 | 403 | 403 |
| compras | 403 | 403 | 403 |

Cuerpo: `{"data":null,"error":{"code":"FORBIDDEN","message":"No tenés el permiso requerido para realizar esta acción"}}`.

### 8.6. Vista en el navegador

Colores calculados con auditor.seed sobre `/tesoreria/libro-iva` (Octubre 2026):

| Tema | Mes/año en el encabezado | Lista desplegable |
|---|---|---|
| Claro | `#E9EDE5` | texto `#202521` sobre `#FFFFFF` |
| Oscuro | `#E9EDE5` | texto `#E9EDE5` sobre `#1D221D` |

> 📷 **Captura 1 — Encabezado en tema claro** *(pendiente: la agrega el responsable)*

> 📷 **Captura 2 — Encabezado en tema oscuro** *(pendiente)*

> 📷 **Captura 3 — Tabla de Ventas, Octubre 2026** *(pendiente)*

> 📷 **Captura 4 — Tabla de Compras, Octubre 2026** *(pendiente)*

### 8.7. Cómo correr las pruebas

```bash
npm test
# Integración: base descartable nueva, migrada y sembrada, y `next build` previo
HU_G4_INTEGRATION_DATABASE_URL="postgresql://…@localhost:5432/swat_erp_test_e13_g4_<sufijo>?schema=public" \
  npm run test:integration:g4
```

El test rechaza cualquier base que no sea `localhost/swat_erp_test_e13_g4_*` o que
ya tenga fixtures de otra corrida (`INT:14-22`). Cada corrida necesita una base nueva.

---

## 9. Qué NO se implementó, y por qué

- **Integración o presentación ante AFIP/ARCA:** fuera de alcance; es un libro interno.
- **IVA real por alícuota:** se usa 21% fijo, como simplificación explícita.
- **Más de una NC por original:** se informa como error del libro; el dominio no
  impone esa unicidad.
- **Tests de componente para la vista:** el proyecto no tiene infraestructura de
  tests de UI; G4-9 se verificó a mano.

---

## 10. Hallazgos

### 10.1. La spec citaba un archivo de tasks que no existe — corregido

Las Revisiones 6.3 y 6.4 de `spec_modulo_G.md` remitían en tres lugares a
`docs/modulos/modulo G/HU4_TASKS.md` (y a sus §§4–6) como contrato operativo
versionado. Ese archivo nunca existió: el proyecto no versiona tasks. La
Revisión 6.5 (15/10/2026) reemplazó las tres referencias: el contrato es la
propia §9.6, y la implementación y la evidencia están en este documento.

### 10.2. Código más estricto o más amplio que la spec

- `REG:76` también rechaza totales con más de dos decimales; G4-2 solo pide
  «finito no negativo». Es una restricción adicional con test (`libro-iva.reglas.test.ts:51`).
- `LibroIvaExportadoPayload.formato` es opcional en el tipo, y el listener usa
  `TXT` si falta. El productor siempre lo envía (`HTTP:31`).
- Las filas JSON incluyen el `id` del comprobante, y `totales.comprobantes` /
  `notas_credito` son números. G4-11 solo exige importes como string, y lo son.

### 10.3. Detalles menores

- Las pestañas son `button aria-pressed`, no `role="tab"`.
- `DescargasLibroIva.tsx` empieza con BOM UTF-8; no afecta el build.
- `libro-iva-confirmacion.test.ts` usa timers cortos (2–100 ms). Hoy pasa, pero
  en una máquina muy cargada podría volverse inestable.
- El timeout de 30 s de producción no se aserta; los tests usan 100–200 ms.

### 10.4. Documentos externos

Según la revisión del 15/10, el backlog actualizado es la copia local
(gitignorada); el de Drive y el Alcance (§2.3, §3.4, matriz §5) seguían con el
texto anterior «exportación TXT formato AFIP».

---

## 11. Referencias cruzadas

- Spec: `docs/specs/spec_modulo_G.md` §9.6 (Revisión 6.5).
- HU-G3: `src/lib/services/tesoreria/comprobantes-repositorio*`.
- HU-H9: `src/app/api/ordenes-compra/[id]/comprobantes/route.ts`.
- D.3: `src/lib/events/listeners/audit-log.listener.ts`, `src/lib/services/auditoria/audit-log.service.ts`.
