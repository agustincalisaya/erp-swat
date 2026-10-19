# Documentación técnica de cierre — HU-G5 (Cuentas bancarias y cajas propias)

## ERP SWAT Indumentarias — Módulo G (Gestión de Caja y Tesorería)

**Documento escrito desde el código real** el 2026-10-19, releyendo `HU-G5` ya
mergeada a `develop`. Cada afirmación está anclada a `archivo:línea`; lo que no
coincide con el contrato se marca como hallazgo (§9), sin forzar un PASS.

> **Estado (2026-10-19).** HU-G5 está **mergeada a `develop`** por el **PR #262**
> (`d828b78`, `Merge pull request #262 from agustincalisaya/HU-G5`; commits
> `861093a`, `97c7a15`, `7d07735` y merge de `develop` `6fc9394`). La migración
> `20261016021426_hu_g5_cuentas_propias` está aplicada: **37 migraciones** en
> `_prisma_migrations`, contenedor `swat_erp_postgres` healthy.
>
> **Evidencia de la entrega:** `npm test` **1191/1191** al merge;
> `test:integration:g5` **7/7** y `test:integration:g5-http` **1/1**.
> **Re-verificación 2026-10-19:** `npm test` **1229/1229** (suite completa sobre
> `HU-G7`, incluye G5), `test:integration:g5` **7/7** con
> `HU_G5_INTEGRATION_DATABASE_URL` + `ENCRYPTION_KEY_PROVEEDORES`, lint **0
> errores** (6 warnings preexistentes) y build **OK**. El gate HTTP no se
> re-ejecutó: exige `npm run build` + `npm start` y un servidor levantado.

---

## 1. Historia de Usuario y Criterios de Aceptación

**Como** Administrador, **necesito** dar de alta, editar y dar de baja las
cuentas bancarias y cajas propias, **para** que Tesorería opere con las cuentas
reales sin persistir ni exponer CBU/alias en texto plano y **para** retirar el
catálogo fijo del que dependía HU-G10.

| # | Criterio (spec G §9.7) | Estado | Evidencia |
|---|---|---|---|
| G5-1 | `CuentaPropia` con nombre, `BANCARIA\|CAJA`, banco, CBU, alias y baja lógica; `BANCARIA` exige datos bancarios con errores por campo; motivo de baja obligatorio, sin DELETE. | ✅ | `schema.prisma:2926`, `:2947`; `cuenta-propia.schema.ts:91-118`, `:157-163`; `cuenta-propia.service.ts:437-466` |
| G5-2 | Cifrado AES-256 por campo con `ENCRYPTION_KEY_PROVEEDORES`; nada en claro en DB, auditoría, logs, excepciones ni seeds; verificación directa de lo almacenado. | ✅ con salvedad (§9.2) | `aes.ts:74`, `:92`; `cuenta-propia.service.ts:280-292`; `cuenta-propia.integration.test.ts:118-131` |
| G5-3 | Lectura enmascarada (máx. 4 caracteres) con `:leer_cuentas_bancarias`; revelado explícito con `:ver_datos_bancarios` y `Cache-Control: no-store`; Cajero POS 403; permisos evaluados en servidor. | ✅ | `cuenta-propia.mascara.ts:24-29`; `cuenta-propia.service.ts:186-187`, `:480-513`; `revelar/route.ts:32`, `:51` |
| G5-4 | Toda lectura de CBU/alias por Auditor —aun enmascarada— audita actor/cuenta/momento, nunca valores, desde el servicio. | ✅ (más estricto: audita toda lectura) | `cuenta-propia.service.ts:135-151`, `:193-195`, `:235`, `:511`; `audit-log.listener.ts:2101-2119`; integración `:167-200` |
| G5-5 | Seed idempotente con los 3 IDs del catálogo; HU-G10 lista solo activas y valida en servicio; `cuenta_origen_id` sigue `String?` sin FK; etiqueta congelada al pagar + backfill. | ✅ | `seed.ts:5430-5483`; `cuenta-por-pagar.service.ts:567-596`; migración `:35-40`; `schema.prisma:1275`, `:1282` |
| G5-6 | Verificar el CBU cifrado de proveedores de Módulo H; no duplicar campo ni crear CBU de cliente. | ✅ por reutilización | `cuenta-propia.service.ts:35` importa la única capa `lib/crypto/aes.ts`; no se agregó CBU de cliente |
| G5-7 | Sin cartera de cheques/valores; `E_CHEQ` es medio de venta, no cuenta propia. | ✅ por ausencia | `TipoCuentaPropia` solo `BANCARIA\|CAJA` (`schema.prisma:2926-2929`) |
| G5-8 | Alta/edición/baja con `:gestionar_cuentas_bancarias` y eventos D.3 con antes/después no sensible; CBU/alias como `cambiado: true/false`, sin valor. | ✅ con salvedad (§9.1) | `cuenta-propia.service.ts:298-304`, `:413-421`, `:459-463`; `audit-log.listener.ts:2123-2194` |

---

## 2. Visión general

La lógica vive en un servicio `server-only`; rutas y Server Actions son wrappers
finos (sesión + permiso + Zod + delegación). El catálogo
`src/lib/tesoreria/cuentas-origen.ts` y su test fueron eliminados.

### 2.1. Lectura enmascarada y revelado

```
/tesoreria/cuentas-propias                      (RSC, force-dynamic: page.tsx:40)
  getServerSession() → sin sesión → /login      (:49-50)
  Promise.all(:leer, :gestionar, :ver_datos)    (:55-59); sin :leer → /no-autorizado (:60)
  listarCuentasPropias(usuarioId)               (service.ts:163)
    findMany activas → decrypt por campo → enmascararUltimos4 (:118-120)
    por fila: emit("tesoreria:datos_bancarios_consultados")   (:193-195)
  ListaCuentasPropias muestra "****4567" (:101) y BotonRevelarDatos si puedeRevelar (:108-109)
  revelarDatosBancariosAction(id)               (actions.ts:163)
    gate :ver_datos (:174) → el SERVICIO revalida (:484) → descifra (:508-509)
    audita la lectura (:511) → 200 + Cache-Control: no-store (revelar/route.ts:51)
```

`obtenerCuentaPropia` (`:206`) repite el contrato. El selector de HU-G10 usa
`listarCuentasPropiasActivas()` (`:257-263`), que proyecta solo
`{id,nombre,tipo}` y por eso no descifra ni audita.

### 2.2. Alta, edición y baja

```
POST /api/tesoreria/cuentas-propias             withPermission(:gestionar) (route.ts:52)
  CrearCuentaPropiaSchema.safeParse (:56) → crearCuentaPropia (:275)
    encrypt(cbu/alias) ANTES de la tx (:280-281) → create (:283-296)
    post-COMMIT emit("tesoreria:cuenta_propia_creada") (:298-304)
PATCH /api/tesoreria/cuentas-propias/[id]       ([id]/route.ts:31)
  editarCuentaPropia: lee dentro de la tx (:328-342)
    re-cifra con IV nuevo solo si cambió (:370-391); sin cambios → sin UPDATE ni evento (:395-397)
    post-COMMIT emit("tesoreria:cuenta_propia_editada") (:413-421)
POST /api/tesoreria/cuentas-propias/[id]/baja   (baja/route.ts:32)
  DarDeBajaCuentaPropiaSchema exige motivo → updateMany is_active=false + deleted_* (:442-450)
    NUNCA prisma.*.delete; post-COMMIT emit("..._baja_logica") (:459-463)
```

---

## 3. Modelo y migración

### 3.1. `CuentaPropia` (`schema.prisma:2947-2975`)

- `id String @id @default(uuid())`; las cuentas sembradas conservan IDs de texto.
- `tipo TipoCuentaPropia` (`BANCARIA | CAJA`, `:2926-2929`).
- Cifrado por campo: `cbu_cifrado`, `cbu_iv`, `alias_cifrado`, `alias_iv`
  (`:2955-2958`), cada uno un `DatoCifrado` (`aes.ts:61`).
- Baja: `is_active`, `deleted_at`, `deleted_by`, `deletion_reason`
  (`:2961-2964`); `deleted_by` sin FK a `Usuario` (decisión de diseño).
- `@@index([tipo, is_active])` (`:2973`); relación `saldos SaldoDiarioCuenta[]`
  para G7 (`:2970-2971`).

Zod: `CUENTAS_PROPIAS_TIPOS` (`:26`), CBU de 22 dígitos (`:31`), ID no vacío
—no UUID— (`:39`), alta (`:129-131`), edición parcial (`:144-146`) y baja con
motivo (`:157-163`). La regla condicional por tipo agrega un issue por campo
(`:91-118`).

### 3.2. Migración `20261016021426_hu_g5_cuentas_propias`

40 líneas, 100 % aditiva: `CREATE TYPE` (`:2`), `ADD COLUMN
cuenta_origen_etiqueta TEXT` nullable (`:5`), `CREATE TABLE cuentas_propias`
(`:8-25`), índice (`:28`) y tres `UPDATE` de backfill con guarda `IS NULL`
(`:35-40`). Sin `DROP INDEX`, `CHECK` manual, `DELETE` ni operación
destructiva.

### 3.3. `CuentaPorPagar` y HU-G10

`cuenta_origen_id` sigue `String?` **sin FK** (`:1275`); `cuenta_origen_etiqueta
String?` (`:1282`) se congela al pagar y sobrevive rename/baja. El JSDoc
`:1271-1281` documenta la decisión. El comentario de `:1272` aún nombra el
catálogo retirado; ver §9.4.

---

## 4. Permisos

| Permiso | UUID | Roles | Uso |
|---|---|---|---|
| `tesoreria:gestionar_cuentas_bancarias` | `…052` | ADMINISTRADOR | POST alta, PATCH edición, POST baja |
| `tesoreria:leer_cuentas_bancarias` | `…053` | TESORERO_CENTRAL, AUDITOR, ADMINISTRADOR, GERENTE | GET enmascarado; acceso a la página |
| `tesoreria:ver_datos_bancarios` | `…054` | TESORERO_CENTRAL, ADMINISTRADOR | POST revelado en claro |

Seed y reparto por `rolPermiso.upsert`: `seed.ts:5362-5423`. HU-G10 no recibe
permiso nuevo: sigue con `cuentas_por_pagar:pagar` (HU-G8).

Gates: página `page.tsx:55-60`; rutas `route.ts:30`/`:52`,
`[id]/route.ts:31`, `[id]/baja/route.ts:32`, `[id]/revelar/route.ts:32`;
actions `actions.ts:76`, `:112`, `:148`, `:174`. El revelado tiene doble control:
HOF de ruta + `usuarioTienePermiso` en el servicio (`:484-489`). Cajero POS no
tiene ninguno de los tres permisos: el gate HTTP histórico devolvió 403 en todas
las rutas (`cuenta-propia.http.integration.test.ts:76-77`, `:131-139`).

---

## 5. Eventos y auditoría

| Evento | Payload | Registro | Handler D.3 | Acción |
|---|---|---|---|---|
| `tesoreria:datos_bancarios_consultados` | `event-types.ts:1568-1572` | `:1892` | `audit-log.listener.ts:2101-2119` | `ACCESO_DATO_CIFRADO_AUDITADO` |
| `tesoreria:cuenta_propia_creada` | `:1578-1584` | `:1894` | `:2123-2146` | `CREATE` |
| `tesoreria:cuenta_propia_editada` | `:1591-1597` | `:1896` | `:2150-2172` | `UPDATE` |
| `tesoreria:cuenta_propia_baja_logica` | `:1603-1607` | `:1898` | `:2176-2194` | `DELETE_LOGICO` |

- La lectura se emite desde el servicio, no desde la UI
  (`cuenta-propia.service.ts:135-151`); el asiento guarda solo `{ timestamp }`
  (`audit-log.listener.ts:2104-2111`). La integración comprueba que las claves de
  `valor_nuevo` son exactamente `["timestamp"]` y que el CBU no aparece
  (`cuenta-propia.integration.test.ts:196-198`).
- Alta/edición/baja emiten post-COMMIT; edición reporta
  `cbu_cambiado`/`alias_cambiado` sin valor (`service.ts:413-421`; listener
  `:2160-2164`); baja usa `valor_anterior {is_active:true}` y `valor_nuevo
  {is_active:false,deletion_reason}` (`:2185-2186`).
- El servicio nunca llama `registrarAuditLog`: el listener es el único escritor
  y la cadena SHA-256 se mantiene en la capa de auditoría.

---

## 6. Integración con HU-G10

| Punto | Antes (G10) | Ahora (G5) | Ancla |
|---|---|---|---|
| Schema | `refine(esCuentaOrigenValida)` | `z.string().min(1)` (solo forma) | `cuentas-por-pagar.schema.ts:55` |
| Validez | decidida por el cliente | `findFirst` de `CuentaPropia` activa en la tx | `cuenta-por-pagar.service.ts:567-580` |
| Error | `VALIDATION_ERROR` | `CUENTA_ORIGEN_INVALIDA` → **422** | `pagar/route.ts:38` |
| Etiqueta | no existía | `cuenta_origen_etiqueta = nombre` al pagar | `service.ts:586-596`, `:619`, `:655` |
| Selector | catálogo const | `listarCuentasPropiasActivas()` | `cuentas-por-pagar/page.tsx:29`, `:70-72`; `FormularioRegistroPago.tsx:365-368` |

Regresión: la integración G5 cubre cuenta desconocida/inactiva →
`CUENTA_ORIGEN_INVALIDA` y un pago válido que congela la etiqueta y sobrevive al
rename (`cuenta-propia.integration.test.ts:239-287`). Los tests de HU-G10 siguen
en verde en `npm test` (1229/1229).

---

## 7. Archivos

| Archivo | Rol | Anclas |
|---|---|---|
| `prisma/schema.prisma` | Enum, modelo y columnas de etiqueta | `:2926`, `:2947`, `:2955-2958`, `:1275-1282` |
| `prisma/migrations/20261016021426_…/migration.sql` | Migración aditiva + backfill | `:1-40` |
| `src/lib/crypto/aes.ts` | Gateway AES-256-GCM (sin cambios) | `:61`, `:74`, `:92` |
| `.../cuenta-propia.mascara.ts` | Enmascarado puro | `:24-29` |
| `.../cuenta-propia.service.ts` | Dominio, permisos, cifrado, eventos | `:52-54`, `:163`, `:275`, `:322`, `:437`, `:480` |
| `.../cuenta-propia.schema.ts` | Zod de alta/edición/baja | `:91-118`, `:129`, `:144`, `:157` |
| `.../cuentas-propias/route.ts` | GET/POST | `:30`, `:52-56` |
| `.../[id]/route.ts` · `.../[id]/baja/route.ts` | PATCH · baja lógica | `:31-47` · `:32-48` |
| `.../[id]/revelar/route.ts` | Revelado con `no-store` | `:32-51` |
| `.../cuentas-propias/page.tsx` | RSC y gates | `:40`, `:55-62`, `:95-98` |
| `.../cuentas-propias/actions.ts` | Server Actions | `:61`, `:91`, `:127`, `:163` |
| `.../ListaCuentasPropias.tsx` · `FormularioCuentaPropia.tsx` · `BotonRevelarDatos.tsx` | UI | `:55` · `:115` · `:38` |
| `Sidebar.tsx` | Ítem «Cuentas propias» | `:333-338` |
| `event-types.ts` · `audit-log.listener.ts` | Payloads y handlers | `:1568-1607`, `:1892-1898` · `:2101-2194` |
| `prisma/seed.ts` | Permisos, cuentas y saldos G7 | `:5362-5423`, `:5430-5483` |
| `cuentas-por-pagar.schema.ts` · `cuenta-por-pagar.service.ts` | Integración G10 | `:55` · `:567-596` |

---

## 8. Pruebas y evidencia

- **Unitarios:** `cuenta-propia.mascara.test.ts` (10) +
  `cuenta-propia.schema.test.ts` (15), ambos en la lista explícita de
  `package.json:13`.
- **Integración DB (7/7):** cifrado por campo y `decrypt` (`:118-131`), seed
  estable (`:134-164`), enmascarado `****4567` + asiento solo con timestamp
  (`:167-200`), revelado (`:201-208`), `CUENTA_ORIGEN_INVALIDA` por cuenta
  desconocida e inactiva (`:239-256`) y etiqueta congelada tras rename
  (`:262-287`).
- **HTTP (1/1 en la entrega):** 401 sin sesión, 403 de Cajero POS y de Tesorero
  en gestión, 403 de Auditor al revelar, 200 de Tesorero al revelar con
  `no-store`, 201/200/200 de Administrador (`cuenta-propia.http.integration.test.ts:51-53`,
  `:72-81`, `:121-145`, `:166-169`, `:181-183`). No se re-ejecutó.
- **Entorno:** 37 migraciones, `npm test` 1229/1229, lint 0 errores, build OK.

---

## 9. Limitaciones y hallazgos

1. **Booleanos `cambiado` sin aserción.** El service calcula
   `cbu_cambiado`/`alias_cambiado` (`:370-391`, `:413-421`) y el listener los
   persiste (`:2160-2164`), pero la integración solo edita `nombre`
   (`cuenta-propia.integration.test.ts:278-282`): no se verifica el booleano ni
   el re-cifrado con IV nuevo.
2. **Literales de CBU/alias en el seed.** `seed.ts:5443-5444`, `:5451-5452`
   contiene valores sintéticos en texto plano y los cifra antes del `create`
   (`:5466-5480`). Nada en claro se persiste, pero G5-2 dice "tampoco en seeds";
   son datos de demostración, mismo precedente que Módulo H.
3. **El gate DB deja filas.** La integración crea cuentas con sufijo aleatorio y
   no puede borrarlas (baja lógica). Cada corrida acumula filas en
   `swat_erp_db`; el gate HTTP también.
4. **Comentario obsoleto.** `schema.prisma:1272` sigue referenciando
   `src/lib/tesoreria/cuentas-origen.ts`, eliminado en esta HU; `:1274` conserva
   un `TODO(HU futura)` ya saldado por `CuentaPropia` (la FK se decidió no
   agregar, ADR-4).
5. **Backfill acotado.** Los tres `UPDATE` cubren solo los IDs del catálogo
   (`migration.sql:35-40`); cualquier `cuenta_origen_id` histórico distinto queda
   con etiqueta `NULL`. No hay casos conocidos.
6. **`deleted_by` sin FK.** `schema.prisma:2963` no garantiza integridad
   referencial del actor; llega desde la sesión y se audita por evento.
7. **El gate HTTP no está en `npm test`.** Exige servidor buildeado; sin
   `HU_G5_INTEGRATION_BASE_URL` falla explícitamente en vez de saltarse
   (`cuenta-propia.http.integration.test.ts:27-36`).

---

## 10. Referencias

| Recurso | Dónde |
|---|---|
| Spec | `docs/specs/spec_modulo_G.md` §9.7 y §9.1 |
| HU-G10 | `docs/modulos/modulo G/HU10_MODULO_G.md` |
| HU-G7 | `docs/modulos/modulo G/HU7_MODULO_G.md` |
| PR | **#262** → `d828b78`; commits `861093a`, `97c7a15`, `7d07735` |
| Gates | `test:integration:g5` 7/7 · `test:integration:g5-http` 1/1 (entrega) |
