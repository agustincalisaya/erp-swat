# HU-C6 — Baja lógica de cliente

**Módulo:** C — Gestión de Clientes
**Actor:** Administrador de CRM (permiso `clientes:baja`)
**Estado:** Implementada (schema Zod, service, ruta REST `PATCH`, Server Action, evento de dominio + handler de auditoría, componente de UI en la ficha, tests unitarios + integración de servicio + integración HTTP + integración cruzada con HU-C4). Commiteada en `feature/HU-C6` (merge con `develop`, commit `33a7946`), **pendiente de push y de PR**. Sin migración: reutiliza las columnas de soft delete que `Cliente` ya tenía (`is_active`, `deleted_at`, `deleted_by`, `deletion_reason`).

## 1. Objetivo

Permitir que un Administrador de CRM dé de baja lógicamente a un cliente cuando corresponda (duplicado, error de carga, cliente que dejó de operar), sin perder su ficha ni su historial, y sin recurrir jamás a un `DELETE` físico (RULES.md Regla N.° 1).

**Criterios de aceptación** (fuente: `docs/tasks/task-chiki.md`, decisiones de diseño ya ratificadas antes de implementar):

1. La baja es exclusiva del Administrador de CRM: el Vendedor queda sin acceso **solo por RBAC** (no tiene el permiso `clientes:baja`) — no existe ni se implementa ningún mecanismo de "solicitud" persistida.
2. El motivo de la baja es **obligatorio**; no hay ninguna otra condición bloqueante: la baja **no** se bloquea por pedidos/presupuestos abiertos ni por saldo en cuenta corriente.
3. La baja marca `is_active = false` + `deleted_at` + `deleted_by` + `deletion_reason` (Regla N.° 1) — nunca borra la fila.
4. La ficha y el historial de compras de un cliente dado de baja **permanecen consultables** (`spec_modulo_C.md` §2.3): la baja lógica es reversible en términos de consulta, no de operatoria. Esto obligó a corregir un bug de alcance preexistente en dos consultas de lectura (§3).
5. Toda baja genera un evento de auditoría (`valor_anterior` / `valor_nuevo`) hacia el Módulo D, con encadenamiento SHA-256.

## 2. Modelo de datos involucrado

**Sin migración.** `Cliente` ya tenía el bloque de soft delete estricto desde su creación (`prisma/schema.prisma:1295-1299`): `is_active` (`Boolean @default(true)`), `deleted_at` (`DateTime?`), `deleted_by` (`String?`), `deletion_reason` (`String?`). HU-C6 es la primera HU que efectivamente **escribe** estos cuatro campos; hasta ahora solo se leían (`is_active`) o quedaban en `null`.

| Campo | Uso en HU-C6 |
|---|---|
| `id`, `is_active` | Guarda de concurrencia del `updateMany` (§3): `where { id, is_active: true }` |
| `is_active` → `false` | Lo único que otras HUs de escritura siguen chequeando para bloquear operaciones nuevas sobre el cliente |
| `deleted_at` | `new Date()` al momento de la baja |
| `deleted_by` | `usuarioId` del actor que ejecuta la baja |
| `deletion_reason` | Motivo obligatorio (validado con Zod, `min(1)` tras `trim()`) |

No se toca `fusionado_en_id` ni `clientes_fusionados`: la fusión de clientes (HU-C5) queda explícitamente fuera de alcance de esta HU.

## 3. Diseño e implementación

### 3.1 Permiso `clientes:baja` — RBAC

`PERMISO_BAJA = "clientes:baja"` (`cliente.service.ts:70`), junto a `PERMISO_CREAR`, `PERMISO_EDITAR` y `PERMISO_LEER`. Se resuelve en dos capas, igual que el resto del módulo:

- **Capa 1 (REST):** el Route Handler está envuelto en `withPermission(PERMISO_BAJA, handler)` → `401` sin sesión, `403` sin el permiso.
- **Capa 2 (Server Action):** `bajaCliente` en `clientes/actions.ts` vuelve a chequear `usuarioTienePermiso(session.userId, PERMISO_BAJA)` de forma independiente — ocultar el botón en la UI es solo presentación, nunca la única barrera.

Sembrado en `prisma/seed.ts:1459` (`PERMISO_CLIENTES_BAJA_ID`), asignado exclusivamente al rol `ADMINISTRADOR_CRM` (`seed.ts:1545`). El Vendedor **no** lo tiene: su 403 es un efecto directo de la matriz de permisos, sin código de excepción ni flujo de aprobación.

El usuario admin de prueba de la seed (`USUARIO_ADMIN_SEED_ID`) originalmente solo tenía el rol `ADMINISTRADOR` (`roles:administrar`), sin ningún `clientes:*`. Se le sumó `ADMINISTRADOR_CRM` vía `usuarioRol.upsert` (`seed.ts:1567-1580`) para poder ejercitar la baja end-to-end sin crear un usuario nuevo.

### 3.2 `bajaClienteTx` / `bajaCliente` — `cliente.service.ts`

Mismo patrón que el resto del módulo (`editarClienteTx`/`editarCliente`) y, en particular, replica exactamente `darDeBajaProveedor` (`proveedor.service.ts:283`):

```ts
// cliente.service.ts:1288
export async function bajaClienteTx(
  tx: Prisma.TransactionClient,
  clienteId: string,
  usuarioId: string,
  motivo: string,
): Promise<void> {
  const cambio = await tx.cliente.updateMany({
    where: { id: clienteId, is_active: true },
    data: {
      is_active: false,
      deleted_at: new Date(),
      deleted_by: usuarioId,
      deletion_reason: motivo,
    },
  });
  if (cambio.count === 0) {
    throw new ServiceError("CLIENTE_NO_ENCONTRADO", "Cliente no encontrado o ya dado de baja");
  }
}
```

- **`updateMany` + `where { id, is_active: true }` es la guarda de concurrencia.** No hay un `findUnique` + `update` separados: si dos bajas llegan casi al mismo tiempo, solo una hace match en el `WHERE` (Postgres serializa el `UPDATE` de la fila), la otra obtiene `count === 0` y recibe `CLIENTE_NO_ENCONTRADO` (→ `404`). Es la misma garantía atómica que usa `darDeBajaProveedor`.
- **Sin `CLIENTE_INACTIVO` aparte:** un cliente inexistente y uno ya dado de baja devuelven el mismo `404`/`CLIENTE_NO_ENCONTRADO`, coherente con la decisión ya ratificada en HU-C3 (§5.3 de ese documento) para las escrituras del módulo.
- **`bajaClienteTx` no abre transacción ni emite eventos** — el caller es dueño de ambos límites, mismo criterio que el resto de los núcleos transaccionales del módulo.
- **`bajaCliente`** (`cliente.service.ts:1318`) es el wrapper público: abre `prisma.$transaction`, delega en `bajaClienteTx` y emite `cliente:baja_logica` **después del COMMIT** — nunca dentro de la transacción, y nunca si la guarda de concurrencia rechazó la baja (la excepción corta antes del `emit`). Devuelve `{ cliente_id, is_active: false }`.
- `clienteId` es siempre el `[id]` del path — nunca se lee del body.

Validación del motivo: `BajaClienteSchema` (`clientes.schema.ts:132`), `z.object({ deletion_reason: z.string().trim().min(1, "El motivo de la baja es obligatorio") })`. Mismo shape que `DarDeBajaProveedorSchema`.

### 3.3 Endpoint REST — `PATCH /api/clientes/[id]/baja`

Archivo nuevo: `src/app/api/clientes/[id]/baja/route.ts`. Wrapper fino (spec §1): `withPermission(PERMISO_BAJA, handler)`, valida el body con `BajaClienteSchema`, delega en `bajaCliente()` y mapea el resultado. Mismo esqueleto que `PATCH /api/proveedores/[id]/baja`.

| Status | Cuándo | `error.code` |
|---|---|---|
| `200` | Baja exitosa | — |
| `400` | Motivo ausente o vacío, JSON ilegible | `VALIDATION_ERROR` (con `fieldErrors.deletion_reason`) |
| `401` | Sin sesión | (lo resuelve `withPermission`) |
| `403` | Sesión válida sin `clientes:baja` | `FORBIDDEN` |
| `404` | Cliente inexistente o ya dado de baja | `CLIENTE_NO_ENCONTRADO` |
| `500` | Error inesperado (no se filtra detalle de DB ni stack) | `INTERNAL_ERROR` |

Respuesta `200`: `{ data: { cliente_id, is_active: false }, error: null }`.

El verbo es `PATCH`, no `DELETE`: un `DELETE` con body falla en proxies intermedios y es semánticamente engañoso para una baja lógica — mismo criterio que la baja de proveedor.

### 3.4 Evento `cliente:baja_logica` y su handler de auditoría

`ClienteBajaLogicaPayload` (`event-types.ts:850`): `{ cliente_id: string, usuario_id: string, deletion_reason: string }`. Sin datos personales (`dni`/`email`/`telefono`) en el payload — la minimización que ya sigue el resto de los eventos del módulo.

`audit-log.listener.ts:1083` agrega el handler de `cliente:baja_logica`, replicando exactamente el de `proveedor:baja_logica`:

```ts
domainEventBus.on("cliente:baja_logica", (payload) => {
  void registrarAuditLog({
    usuario_id: payload.usuario_id,
    accion: "DELETE_LOGICO",
    tabla_afectada: "clientes",
    registro_id: payload.cliente_id,
    ip: "unknown",
    valor_anterior: { is_active: true },
    valor_nuevo: { is_active: false, deletion_reason: payload.deletion_reason },
  });
});
```

`valor_anterior: { is_active: true }` es un valor fijo, no una lectura de snapshot previo — y es correcto igual: la guarda `updateMany { is_active: true }` del service garantiza que el evento solo se emite cuando el cliente efectivamente estaba activo antes de la baja. `bajaCliente()` **nunca** llama `registrarAuditLog()` de forma directa: emite el evento post-COMMIT y este listener es la única vía de escritura a `AuditLog`, tal como exige el criterio unificado de Módulo D (mismo patrón documentado en el propio `audit-log.listener.ts`).

### 3.5 Server Action `bajaCliente` — el camino real del frontend

`src/app/(dashboard)/clientes/actions.ts:298`. **Es el camino que usa la UI — el frontend no llama al endpoint HTTP.** Mismo wrapper fino que las demás actions del archivo (`editarCliente`, `actualizarSegmentoCliente`, etc.):

```ts
export async function bajaCliente(
  clienteId: string,
  input: unknown,
): Promise<ActionResult<ClienteDadoDeBaja>> {
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");
  if (!(await usuarioTienePermiso(session.userId, PERMISO_BAJA))) {
    return fallo("FORBIDDEN", `No tenés el permiso "${PERMISO_BAJA}"`);
  }
  const parsed = BajaClienteSchema.safeParse(input);
  if (!parsed.success) {
    return fallo("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Datos inválidos");
  }
  try {
    const data = await bajaClienteService(clienteId, session.userId, parsed.data.deletion_reason);
    revalidatePath(`/clientes/${clienteId}`);
    revalidatePath(CLIENTES_PATH);
    return { data, error: null };
  } catch (err) {
    if (err instanceof ServiceError) return fallo(err.code, err.message);
    return fallo("INTERNAL_ERROR", "Error interno. Intentá nuevamente.");
  }
}
```

Sesión → permiso → parseo Zod → **la misma función de servicio** que invoca el Route Handler → `revalidatePath` de la ficha (`/clientes/[id]`) **y** del listado (`/clientes`, porque el cliente dado de baja debe desaparecer de ahí). `clienteId` viaja como argumento explícito, nunca dentro del `input` parseado.

El endpoint REST (§3.3) queda vigente y funcional en paralelo — es el contrato público de la API — pero el flujo real de la ficha corre íntegramente por Server Action, sin pasar por HTTP.

### 3.6 `DialogBajaCliente` — componente e integración en la ficha

`src/components/clientes/DialogBajaCliente.tsx` (nuevo), copiado del patrón de `DialogBaja` (baja de proveedor) — mismo `AlertDialog`, mismo textarea de motivo, mismo criterio de habilitación:

- `AlertDialog` con `AlertDialogTitle`/`AlertDialogDescription` explicando que es una baja lógica, que el cliente deja de poder operar pero su historial se conserva, y que no puede deshacerse desde ahí.
- Un `textarea` de `deletion_reason`; el botón "Confirmar baja" queda `disabled` hasta que `motivo.trim().length > 0` o mientras `isPending`.
- Errores del servidor (por ejemplo `CLIENTE_NO_ENCONTRADO` si alguien más ya lo dio de baja) se muestran en un `Alert variant="destructive"`.
- `useTransition` + `router.refresh()` al éxito; soporta modo controlado (`open`/`onOpenChange`) y modo con trigger propio (botón ghost "Dar de baja" con ícono `Trash2`).

**Integración:** se renderiza dentro de `DatosContactoCliente.tsx`, en el mismo header donde vive el botón "Editar" de HU-C2, condicionado a `puedeBaja && isActive` (`DatosContactoCliente.tsx`). `puedeBaja` la resuelve la página (`Promise.all` con `usuarioTienePermiso(session.userId, PERMISO_BAJA)`, `page.tsx:79,96`) y `isActive` es el `cliente.is_active` ya leído por la página.

### 3.7 Cómo se muestra un cliente inactivo en la ficha

`/clientes/[id]/page.tsx` calcula `const inactivo = !cliente.is_active` (`page.tsx:101`) y ya **no** hace `notFound()` por ese caso (ver §4 — era el mismo bug de alcance que en HU-C7). El resto de la página se ramifica sobre ese flag:

| Elemento | Cliente activo | Cliente inactivo (`is_active === false`) |
|---|---|---|
| Badge junto al DNI | — | `<Badge variant="destructive">Inactivo</Badge>` (`page.tsx:127`) |
| Alert bajo el encabezado | — | `Alert` rojo: "Este cliente está dado de baja y no puede operar. Su ficha y su historial se conservan en solo lectura." + `Motivo: {deletion_reason}` si existe (`page.tsx:132-146`) |
| Datos de contacto | Lectura + botón "Editar" | Solo lectura — `puedeEditar={puedeEditar && !inactivo}` (`page.tsx:164`); botón "Editar" oculto |
| "Dar de baja" | Visible si `puedeBaja` | Oculto (`puedeBaja && isActive`, §3.6) |
| Direcciones | Formulario de alta + edición por fila | Solo lectura — nueva prop `soloLectura` en `DireccionesCliente` (`page.tsx:173`): sin formulario de alta ni botones de edición por fila |
| Canal de contacto (`CanalContactoCliente`) | Formulario editable | **Oculto** — reemplazado por una card de solo lectura junto con Segmento (`page.tsx:176-198`) |
| Segmento (`SegmentoCliente`) | Formulario editable | **Modo lectura** — mismo reemplazo que Canal, mostrado como texto plano dentro de la card "Preferencias comerciales" |
| Consentimientos (`ConsentimientosCliente`, HU-C4) | Lectura + controles de gestión si corresponde | **Visible siempre, en modo lectura**: `puedeGestionar={puedeGestionarConsentimiento && !inactivo}`, `puedeAdministrar={esAdministradorCrm && !inactivo}` (`page.tsx:210-214`) — queda **fuera** del ternario de Canal/Segmento porque su propio componente ya sabe apagar todos sus controles de escritura con esos dos flags en `false` |

Nada de esto reemplaza el chequeo de servidor: ocultar un botón es solo presentación, y cada mutación (`editarCliente`, `actualizarCanalContacto`, `actualizarSegmentoCliente`, `regularizarConsentimientoCliente`, etc.) sigue rechazando por su cuenta un cliente inactivo con `CLIENTE_NO_ENCONTRADO`.

## 4. Bug de alcance corregido: `is_active` ocultaba el historial de un cliente dado de baja

**No es exclusivo de esta HU**, pero se detectó al implementarla y se corrigió en dos lugares, con el mismo diagnóstico y el mismo criterio de corrección.

### 4.1 Por qué violaba la spec

`spec_modulo_C.md` §2.3 es explícita: la baja lógica **no afecta en absoluto** la consulta del historial previo del cliente, que "permanece íntegro y accesible de forma permanente — la baja lógica es reversible en términos de consulta, no de operatoria (un cliente dado de baja no puede operar, pero su historial sigue siendo consultable)". Es decir: el filtro `is_active = true` que RULES.md exige por defecto para las consultas operativas **no** debe aplicarse a las lecturas de historial/ficha de un cliente, solo a las escrituras.

Antes de HU-C6, dos funciones de lectura violaban esto:

- **`consultarClientePorDni`** (HU-C7, `cliente.service.ts:824`): filtraba `where: { dni, is_active: true }`. Tras una baja, el POS recibía `404 CLIENTE_NO_ENCONTRADO` para un DNI real, y el historial de compras dejaba de ser consultable — exactamente el escenario que la spec prohíbe.
- **`obtenerConsentimientosCliente`** (HU-C4, `consentimiento.service.ts:102`): hacía un `findUnique` de `is_active` y lanzaba `CLIENTE_NO_ENCONTRADO` si el cliente estaba inactivo, **antes** de leer ningún hecho de consentimiento. Mismo síntoma: la ficha de un cliente dado de baja rompía toda la página (el `Promise.all` de `page.tsx` la llama incondicionalmente), no solo mostraba una sección vacía.

### 4.2 Por qué la corrección es la misma en ambos casos

Las dos funciones son **lecturas puras** — no escriben nada — así que la corrección fue simétrica: sacar el filtro/chequeo de `is_active` de la consulta y devolver el dato igual.

- En `consultarClientePorDni`, el `where` pasó de `{ dni, is_active: true }` a `{ dni }`, y el `select` ahora incluye `is_active` (se agrega al tipo `ConsultaUnificadaCliente`) para que el frontend pueda mostrar "cliente inactivo". El mensaje del `404` (que sí puede darse, para un DNI que directamente no existe) pasó de `"No existe un cliente activo con el DNI…"` a `"No existe un cliente con el DNI…"`.
- En `obtenerConsentimientosCliente` se eliminó por completo el `findUnique` + `throw` — esa consulta a `Cliente` solo existía para el chequeo de `is_active`, así que la función queda con la validación del id y `leerHechos(clienteId, prisma)` directo.

En ningún caso se tocaron las **escrituras** de esas mismas HUs (`regularizarConsentimientoCliente`, `transicionarConsentimientoClienteTx`, y en general cualquier mutación de Módulo B/C sobre un cliente): esas siguen bloqueando explícitamente con `is_active` (vía `SELECT … FOR UPDATE` en el caso de consentimiento), porque **crear operaciones nuevas** sobre un cliente inactivo sí debe rechazarse — es el otro lado de la misma frase de la spec ("un cliente dado de baja no puede operar").

## 5. Decisiones de diseño

### 5.1 La baja no bloquea por pedidos/presupuestos abiertos ni por saldo en cuenta corriente

Decisión de diseño explícita, ratificada antes de implementar (no una omisión). El único requisito duro es el motivo. Es una diferencia deliberada con la baja de proveedor, que tampoco bloquea por ese tipo de condiciones — el criterio de "cliente sin poder operar" ya cubre el efecto práctico (nada nuevo se le puede facturar, presupuestar ni acreditar), sin necesidad de una validación adicional en el momento de la baja.

### 5.2 El Vendedor queda sin acceso solo por RBAC, sin flujo de solicitud persistida

No existe una tabla ni un estado de "solicitud de baja pendiente de aprobación". El control de acceso es puramente declarativo: el rol Vendedor no tiene `clientes:baja` sembrado, y el 403 de `withPermission` (y el de la Server Action) es la única barrera. Si en el futuro se necesitara un flujo de aprobación, sería una HU nueva y explícitamente distinta — no algo que deba inferirse ni construirse por adelantado acá.

### 5.3 El DNI no se libera tras la baja

El `dni` de un cliente dado de baja sigue siendo `@unique` a nivel de base de datos y **no se limpia** en `bajaClienteTx`. Esto es consistente con el comportamiento ya existente de HU-C1 ("recuperar en vez de duplicar": un alta con el mismo DNI de un cliente inactivo recupera el registro existente, no crea uno nuevo — ver `crearClienteTx`, que no distingue por `is_active` al buscar un DNI existente). Liberar el DNI rompería esa garantía y permitiría que dos clientes distintos compartieran históricamente el mismo documento.

### 5.4 Sin `CLIENTE_INACTIVO` ni `409` propios

Mismo código de error (`CLIENTE_NO_ENCONTRADO`, `404`) para "no existe" y "ya está inactivo", tanto en la baja misma (doble baja) como en el resto de las escrituras del módulo. Es la continuación directa de la decisión ya ratificada en HU-C3 §5.3, no una decisión nueva de HU-C6.

## 6. RBAC

| Permiso | VENDEDOR | ADMINISTRADOR_CRM |
|---|:---:|:---:|
| `clientes:baja` | ❌ | ✅ |

- **Capa 1 (REST):** `withPermission(PERMISO_BAJA)` → `401` sin sesión, `403` sin permiso.
- **Capa 2 (Server Action):** `bajaCliente` en `actions.ts` vuelve a chequear el permiso de forma independiente.
- **Capa 3 (UI):** el botón "Dar de baja" solo se renderiza si `puedeBaja && isActive`; ocultarlo es puramente presentación.

## 7. Testing

| Archivo | Tipo | Qué cubre |
|---|---|---|
| `src/lib/schemas/baja-cliente.schema.test.ts` | Unitario (sin DB, corre en `npm test`) | `BajaClienteSchema`: motivo ausente/vacío/solo espacios rechaza; motivo válido acepta; un `cliente_id` espurio en el body se descarta en silencio |
| `src/lib/services/clientes/baja-cliente.integration.test.ts` | Integración de servicio (`npm run test:integration:c6`, opt-in vía `HU_C6_INTEGRATION_DATABASE_URL`) | Baja exitosa setea los 4 campos y la fila permanece (nunca `DELETE` físico); asiento `DELETE_LOGICO` con `valor_anterior`/`valor_nuevo` correctos; doble baja sobre el mismo cliente → `404` sin pisar el motivo original y sin asiento nuevo; dos bajas concurrentes → exactamente una gana, la otra recibe `404` (verifica la guarda de `updateMany`); id inexistente → `404` |
| `src/lib/services/clientes/baja-cliente.http.integration.test.ts` | Integración HTTP (`npm run test:integration:c6-http`, opt-in vía `HU_C6_INTEGRATION_BASE_URL`, requiere servidor real) | `401` sin sesión; `403` con `vendedor.seed` (sin `clientes:baja`) y que la baja NO se ejecuta; `400` con motivo ausente o vacío; `200` con `administrador.seed` y el shape exacto `{ cliente_id, is_active: false }`; `404` en doble baja y con id inexistente; la ficha del cliente dado de baja sigue devolviendo `200` con `is_active: false` vía `GET /api/clientes/buscar` |
| `src/lib/services/clientes/baja-cliente.consentimientos.integration.test.ts` | Integración cruzada HU-C6 × HU-C4 (`npm run test:integration:c6-consentimientos`, opt-in vía `HU_C6_INTEGRATION_DATABASE_URL`) | Regresión específica del bug de §4: la lectura de consentimientos de un cliente dado de baja **no** lanza `CLIENTE_NO_ENCONTRADO` y devuelve el mismo estado e historial que tenía antes de la baja; las escrituras de consentimiento (`regularizarConsentimientoCliente`) siguen bloqueando al cliente inactivo |

También se ampliaron dos suites existentes de HU-C7 (`consulta-unificada.integration.test.ts` y su equivalente HTTP) con el escenario (e2): un cliente dado de baja lógica sigue devolviendo ficha e historial de compras, con `is_active: false` en la respuesta.

**Verificado en esta revisión:** `tsc --noEmit` limpio; `npm test` (unitarios) verde; las cuatro suites de integración de arriba corrieron 1/1 contra `swat_erp_db` (con la migración de HU-C4 ya aplicada) y contra un `next start` real en el puerto 3100. La UI (ficha en el navegador, con `admin.seed`/`vendedor.seed`) **no** se probó manualmente en esta revisión.

## 8. Pendiente de verificar

**La suite de integración propia de HU-C4** (`consentimiento.integration.test.ts`, `consentimiento.http.integration.test.ts`) **no se pudo ejecutar en este entorno**: fija un Postgres en `127.0.0.1:55434`, una base (`hu_c4_validate_20260921_4d7e2a`) y un `system_identifier` de cluster concretos, disponibles solo en el entorno de quien la escribió — no en `swat_erp_db`. La verificación de que el fix de `obtenerConsentimientosCliente` (§4) no rompe ningún caso de HU-C4 se hizo **por lectura de código**, no por ejecución: se revisaron los tres escenarios de esas dos suites que involucran un cliente inactivo y los tres son sobre **escrituras** (`regularizarConsentimientoCliente` sobre un inactivo, `POST /consentimientos` sobre un inactivo, `POST /transiciones` sobre un id inexistente) — ninguno ejercita la lectura que se modificó, así que ningún assert de esas suites debería cambiar de resultado. Queda pendiente que alguien con acceso a ese entorno lo confirme por ejecución.

**Tampoco se corrieron `test:integration:c6-http` y `test:integration:c7-http` en la corrida final** posterior al merge con `develop` (sí se corrieron antes del merge, cuando el código de HU-C6 estaba aislado) — conviene re-ejecutarlas contra un `next start` que incluya ya el código de HU-C4 mergeado, para descartar cualquier interacción a nivel de build.

## 9. Impacto en otros archivos

| Archivo | Cambio |
|---|---|
| `src/lib/services/clientes/cliente.service.ts` | `PERMISO_BAJA`, `ClienteDadoDeBaja`, `bajaClienteTx`, `bajaCliente`; fix de `consultarClientePorDni` (§4) |
| `src/lib/services/clientes/consentimiento.service.ts` | Fix de `obtenerConsentimientosCliente` (§4) — archivo originalmente de HU-C4 |
| `src/lib/schemas/clientes.schema.ts` | `BajaClienteSchema` |
| `src/app/api/clientes/[id]/baja/route.ts` | **Nuevo** — `PATCH` |
| `src/app/(dashboard)/clientes/actions.ts` | Server Action `bajaCliente` |
| `src/components/clientes/DialogBajaCliente.tsx` | **Nuevo** |
| `src/components/clientes/DatosContactoCliente.tsx` | Integra `DialogBajaCliente`, nuevas props `puedeBaja`/`isActive` |
| `src/components/clientes/DireccionesCliente.tsx` | Nueva prop `soloLectura` |
| `src/app/(dashboard)/clientes/[id]/page.tsx` | Elimina el `notFound()` por `!is_active` (§4); resuelve `puedeBaja`; ramifica Canal/Segmento a modo lectura y apaga los controles de Consentimientos para un inactivo |
| `src/lib/events/event-types.ts` | `ClienteBajaLogicaPayload`, entrada `"cliente:baja_logica"` en `DomainEventMap` |
| `src/lib/events/listeners/audit-log.listener.ts` | Handler de `cliente:baja_logica` → `DELETE_LOGICO` |
| `prisma/seed.ts` | Asignación de `ADMINISTRADOR_CRM` al usuario admin de prueba (ya tenía `clientes:baja` sembrado desde antes en el rol) |
| `src/lib/services/clientes/consulta-unificada.integration.test.ts` y su http | Escenario (e2): cliente dado de baja sigue devolviendo ficha e historial |
| tests + `package.json` | `baja-cliente.schema.test.ts`, `baja-cliente.integration.test.ts`, `baja-cliente.http.integration.test.ts`, `baja-cliente.consentimientos.integration.test.ts`; scripts `test:integration:c6`, `c6-http`, `c6-consentimientos` |

**Explícitamente fuera de alcance** (no implementado, y no debe agregarse por iniciativa propia): fusión de clientes (HU-C5) y cualquier flujo de solicitud/aprobación de baja.
