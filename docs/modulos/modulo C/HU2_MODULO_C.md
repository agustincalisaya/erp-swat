# HU-C2 — Edición de datos de contacto y de direcciones de un cliente existente

**Módulo:** C — Gestión de Clientes
**Actor:** Vendedor / Administrador de CRM (permiso `clientes:editar`)
**Story points:** 2
**Estado:** Implementada (schemas Zod, service, dos rutas REST `PATCH`, dos Server Actions, modo edición en la ficha, Dialog de edición en el listado, auditoría con asientos `UPDATE`, tests unitarios + suite de integración de servicio). **Pendiente de commit.** Sin migración ni cambio de schema. Sin cambios en archivos compartidos de Módulo D (`event-types.ts`, `audit-log.listener.ts`).

## 1. Objetivo

Permitir que un Vendedor o Administrador de CRM mantenga actualizada la información de un cliente existente sin darlo de baja y volver a crearlo: corregir su nombre, teléfono y correo electrónico, y editar las direcciones ya cargadas.

**Historia:** Editar los datos de contacto de un cliente existente, para mantener actualizada la información sin necesidad de dar de baja y volver a crear el registro.

**Criterios de aceptación** (fuente: backlog de HU-C2 y `spec_modulo_C.md` §2.2):

1. Editables: nombre, teléfono, correo electrónico, dirección.
2. El DNI no es editable una vez creado el registro.
3. Toda edición genera un evento de auditoría (valor anterior / valor nuevo) hacia el Módulo D.
4. Respeta la matriz de permisos vigente del módulo (`clientes:editar`).
5. Solo se actualizan los campos recibidos (`PATCH` parcial): un campo no enviado nunca se sobreescribe.

### 1.1 Discrepancias entre la spec y lo implementado

| Punto | `spec_modulo_C.md` §2.2 | Implementación real | Motivo |
|---|---|---|---|
| Campo `direccion` en `EditarClienteSchema` | Lo incluye como `z.string().optional()` | **No existe.** La dirección se edita por su propio endpoint (`EditarDireccionClienteSchema`) | `Cliente` no tiene columna `direccion`: toda dirección vive en `DireccionCliente` (ver 2 y 3) |
| Rechazo de un `dni` en el payload | `409 Conflict`, código `DNI_INMUTABLE` | **`422`, código `CAMPOS_NO_EDITABLES`** | Se siguió el patrón ya vigente en el repo para campos inmutables, `EditarProveedorSchema` (`422 CAMPOS_NO_EDITABLES`), decidido en el relevamiento previo (`docs/tasks/task-chiki.md`). **La spec no fue actualizada**: si el equipo prefiere el contrato de la spec, el cambio se limita al wrapper HTTP y a la constante de código |
| Forma de la respuesta `200` | `{ cliente_id, campos_actualizados }` | `{ cliente_id, nombre, telefono, email, campos_modificados }` | La respuesta devuelve además el estado resultante, útil para la UI; el nombre `campos_modificados` es el mismo que usa el payload del evento (spec §4) |
| Vaciar `telefono` / `email` | No descripta | `""` persiste `null` | Sin esto un dato cargado por error no podría quitarse. `undefined` (ausente) sigue significando "no tocar" |

## 2. Decisión de alcance

El criterio de aceptación dice "dirección" como campo editable, pero el modelo no tiene un campo escalar de dirección en `Cliente`: se persiste como `DireccionCliente` (relación 1:N). HU-C3 implementó **alta y listado** de direcciones y su propio docstring declaró que editar o dar de baja una dirección quedaba fuera de su alcance. Como el permiso `clientes:editar` ya está sembrado y descripto como cubriendo "datos de contacto, direcciones y canal de contacto preferido (HU-C2/C3/C9)" (`prisma/seed.ts`), la edición de una dirección existente es responsabilidad de HU-C2. Por eso HU-C2 tiene **dos partes**:

1. Edición del contacto del `Cliente`: `nombre`, `telefono`, `email`.
2. Edición de una `DireccionCliente` existente: `rotulo`, `tipo`, `direccion_completa`.

**Explícitamente fuera de alcance:**

- **Baja lógica de una dirección.** El AC no la pide y no existe hoy ni service, ni schema, ni ruta, ni acción de UI. Agregarla implica además definir qué pasa con la regla de FACTURACION al desactivar la única FACTURACION (ver 10). Queda para una HU futura.
- **El campo `dni`.** Inmutable por AC; la vía correcta ante un DNI mal cargado es la fusión de duplicados (HU-C5), nunca una edición.
- **Canal preferido y segmento**, que tienen su propia HU (HU-C9, HU-C8) y su propio endpoint.

## 3. Modelo de datos involucrado

**Sin cambio de schema ni migración.**

**`Cliente` (`clientes`)**

| Campo | Uso en HU-C2 |
|---|---|
| `id`, `is_active` | Lectura: resolver el cliente; inexistente o `is_active = false` ⇒ `CLIENTE_NO_ENCONTRADO` |
| `dni` | Solo lectura. Nunca se escribe; un `dni` en el input se rechaza |
| `nombre` | Lectura + escritura (obligatorio, mínimo 2 caracteres) |
| `telefono`, `email` | Lectura + escritura (opcionales; `""` ⇒ `null`) |

**`DireccionCliente` (`direcciones_cliente`)**

| Campo | Uso en HU-C2 |
|---|---|
| `id`, `cliente_id`, `is_active` | Lectura: la dirección debe pertenecer al cliente del path y estar activa |
| `rotulo`, `direccion_completa` | Lectura + escritura |
| `tipo` (`FACTURACION` \| `ENVIO`) | Lectura + escritura; su cambio puede disparar la regla de la sección 6 |

`DireccionCliente` no tiene unicidad de FACTURACION a nivel de base de datos: el invariante "un ENVIO requiere al menos una FACTURACION activa" se garantiza únicamente en la capa de servicios (`direccion-cliente.reglas.ts`), lo que es la razón del lock descripto en 6.3. `updated_at` se actualiza solo (`@updatedAt`). Ninguna función de HU-C2 usa `delete()` / `deleteMany()`.

## 4. Endpoints

Ambos son wrappers finos (spec §1): resuelven sesión y permiso con `withPermission("clientes:editar", …)`, validan el body con Zod, delegan en `cliente.service.ts` y mapean el resultado a `{ data, error }`. Ninguna regla de negocio vive en la capa HTTP. `cliente_id` y `direccion_id` llegan **siempre por el path**; una clave `cliente_id` espuria en el body se descarta en silencio (los schemas no son `.strict()`).

### 4.1 `PATCH /api/clientes/[id]` — contacto

Archivo: `src/app/api/clientes/[id]/route.ts`. Body (todos opcionales, al menos uno): `{ nombre?, telefono?, email? }`.

| Status | Cuándo | `error.code` |
|---|---|---|
| `200` | Edición exitosa, **incluida** la edición sin cambios reales (ver 5.2) | — |
| `400` | Body inválido: nombre de menos de 2 caracteres, email mal formado, payload sin ningún campo editable, JSON ilegible | `VALIDATION_ERROR` |
| `401` | Sin sesión | (lo resuelve `withPermission`) |
| `403` | Sesión válida sin `clientes:editar` | `FORBIDDEN` |
| `404` | Cliente inexistente **o** inactivo (mismo contrato que HU-C3/C8/C9, sin `CLIENTE_INACTIVO` ni `409`) | `CLIENTE_NO_ENCONTRADO` |
| `422` | El payload incluye `dni` | `CAMPOS_NO_EDITABLES` |
| `500` | Error inesperado (no se filtra detalle de DB ni stack) | `INTERNAL_ERROR` |

Respuesta `200`: `{ data: { cliente_id, nombre, telefono, email, campos_modificados: string[] }, error: null }`. `campos_modificados` vacío indica que ningún valor cambió.

### 4.2 `PATCH /api/clientes/[id]/direcciones/[direccionId]` — dirección

Archivo: `src/app/api/clientes/[id]/direcciones/[direccionId]/route.ts`. Body (todos opcionales, al menos uno): `{ rotulo?, tipo?, direccion_completa? }`, con las mismas validaciones de formato que el alta (`rotulo` no vacío, `direccion_completa` de al menos 5 caracteres, `tipo` del enum).

| Status | Cuándo | `error.code` |
|---|---|---|
| `200` | Edición exitosa (incluida la edición sin cambios reales) | — |
| `400` | Body inválido o sin ningún campo editable | `VALIDATION_ERROR` |
| `401` / `403` | Sin sesión / sin `clientes:editar` | — / `FORBIDDEN` |
| `404` | Cliente inexistente o inactivo | `CLIENTE_NO_ENCONTRADO` |
| `404` | La dirección no existe, está inactiva **o pertenece a otro cliente** (no se filtra la existencia de direcciones ajenas) | `DIRECCION_NO_ENCONTRADA` |
| `422` | Se intenta pasar a `ENVIO` la única FACTURACION activa del cliente (sección 6) | `DIRECCION_FACTURACION_REQUERIDA` |
| `500` | Error inesperado | `INTERNAL_ERROR` |

Respuesta `200`: `{ data: { direccion_id, rotulo, tipo, direccion_completa, campos_modificados }, error: null }`.

### 4.3 Server Actions

`editarCliente(clienteId, input)` y `editarDireccionCliente(clienteId, direccionId, input)` en `src/app/(dashboard)/clientes/actions.ts` son equivalentes de las rutas: sesión (`UNAUTHORIZED`), permiso (`FORBIDDEN`), parseo Zod (`VALIDATION_ERROR`, o `CAMPOS_NO_EDITABLES` si llega un `dni`), invocación de **la misma función de servicio** que el Route Handler y `revalidatePath` de `/clientes/[id]` (la de contacto también revalida `/clientes`). Devuelven `ActionResult<T>` y los ids viajan como argumentos, nunca dentro del input.

## 5. Arquitectura

```
FormularioEditarContactoCliente ──► editarCliente() [Server Action] ─┐
 (ficha y Dialog del listado)                                          ├─► editarCliente() [service] ─► prisma.$transaction ─► editarClienteTx()
PATCH /api/clientes/[id] ─────────────────────────────────────────────┘                                   (post-COMMIT, solo si hubo cambios)
                                                                                                          emit "cliente:actualizado" (UPDATE / clientes)

FilaDireccionEdicion ─► editarDireccionCliente() [Server Action] ─┐
PATCH .../direcciones/[direccionId] ──────────────────────────────┴─► editarDireccionCliente() [service] ─► prisma.$transaction ─► editarDireccionClienteTx()
                                                                                                   (post-COMMIT, solo si hubo cambios)
                                                                                                   emit "cliente:actualizado" (UPDATE / direcciones_cliente)
```

Mismo patrón que HU-C1/C3/C9: un núcleo transaccional reutilizable (`...Tx`, recibe el `tx`, no abre transacción ni emite eventos) y un wrapper público que abre `prisma.$transaction` y emite el evento **después del COMMIT**. El valor anterior se lee y el `update` se ejecuta en la **misma transacción**, de modo que el `valor_anterior` auditado es exactamente el previo al cambio.

### 5.1 Schemas — `src/lib/schemas/clientes.schema.ts`

- `EditarClienteSchema`: `nombre` (`min(2)`), `telefono`, `email` (`email` o `""`), todos opcionales. Usa `.passthrough()` + `superRefine` para detectar `dni` y fallar con un mensaje que empieza con `CAMPOS_NO_EDITABLES` (patrón de `EditarProveedorSchema`); si no hay `dni`, exige al menos un campo editable. El `""` de `email` **no** se transforma a `undefined` (a diferencia de `CrearClienteSchema`): esa diferencia es lo que permite vaciar el dato.
- `esErrorClienteCamposNoEditables(error)`: lo usan el Route Handler y la Server Action para responder `422` en lugar de un `400` genérico.
- `EditarDireccionClienteSchema`: `rotulo`, `tipo`, `direccion_completa` opcionales, con un `refine` que exige al menos uno. La regla de FACTURACION **no** vive en el schema (requiere lectura de base de datos).

### 5.2 Service — `src/lib/services/clientes/cliente.service.ts`

| Función | Rol |
|---|---|
| `editarClienteTx` | Rechaza `dni` (`CAMPOS_NO_EDITABLES`, defensa en profundidad además del schema); resuelve el cliente activo; calcula el diff campo a campo contra lo persistido; hace `update` **solo de los campos que cambiaron** |
| `editarCliente` | Wrapper: abre la transacción y emite `cliente:actualizado` post-COMMIT |
| `editarDireccionClienteTx` | Lock del cliente, validación de pertenencia, diff, regla de FACTURACION y `update` (secuencia en 6.3) |
| `editarDireccionCliente` | Wrapper análogo, con `registro_id` = id de la dirección |

**Edición sin cambios reales:** si todos los valores enviados coinciden con los persistidos, el service devuelve `campos_modificados: []`, **no escribe y no emite evento** (no hay nada que auditar). El endpoint responde `200`.

### 5.3 Regla pura — `src/lib/services/clientes/direccion-cliente.reglas.ts`

`validarReglaEdicionDireccion(tipoActual, tipoNuevo, hayOtraFacturacionActiva)`, junto a `validarReglaDireccionEnvio` (HU-C3). Es un módulo sin dependencias de Next/Prisma (Deviation D1 de HU-C3), por lo que se testea con el runner nativo de Node.

## 6. Regla de negocio de FACTURACION en edición

### 6.1 Invariante

Una dirección `ENVIO` no puede existir sin al menos una `FACTURACION` activa en el cliente. HU-C3 la aplica al **alta**; HU-C2 la extiende a la **edición**.

### 6.2 Cuándo se dispara y cómo se calcula

La única transición de edición que puede romper el invariante es **`FACTURACION → ENVIO`**: la dirección deja de ser FACTURACION y pasa a ser ENVIO, por lo que el cliente necesita **otra** FACTURACION activa que la respalde. El service cuenta las FACTURACION activas del cliente **excluyendo la propia dirección** (`id: { not: direccionId }`). Si el conteo es cero, lanza `DIRECCION_FACTURACION_REQUERIDA` (`422`) **antes** del `update`, por lo que el rechazo implica cero escrituras y cero eventos.

Excluir el registro propio es lo que hace funcionar la regla: la dirección editada sigue siendo FACTURACION en la base al momento del conteo, y si se la incluyera se contaría a sí misma y la regla nunca dispararía. Esto también cubre el caso de un cliente cuya única dirección es una FACTURACION: pasarla a ENVIO dejaría un ENVIO como única dirección, lo que el alta prohíbe.

**No** dispara la regla: `ENVIO → FACTURACION` (agrega una FACTURACION, nunca la quita), tipo sin cambio o ausente del `PATCH` (`FACTURACION → FACTURACION`, `ENVIO → ENVIO`), y ediciones de solo `rotulo` / `direccion_completa`. En particular no se revalida un `ENVIO → ENVIO`, para no bloquear la corrección de un rótulo sobre datos heredados.

### 6.3 Lock de concurrencia

Sin un lock, dos ediciones simultáneas `FACTURACION → ENVIO` sobre las dos únicas FACTURACION de un cliente verían cada una a la otra como respaldo, ambas pasarían la regla y el cliente quedaría con envíos y sin facturación. Como el invariante no existe a nivel de base de datos (no hay constraint), se serializa por cliente. `editarDireccionClienteTx` ejecuta, como primera operación de la transacción, `SELECT id FROM clientes WHERE id = … FOR UPDATE` (mismo mecanismo que `cuenta-corriente.service.ts` de Módulo B). Toda edición de direcciones de un mismo cliente queda así serializada, y la segunda transacción ve el estado ya confirmado por la primera.

Secuencia completa de `editarDireccionClienteTx`: (1) lock del cliente; (2) cliente activo o `CLIENTE_NO_ENCONTRADO`; (3) dirección activa **del cliente del path** o `DIRECCION_NO_ENCONTRADA`; (4) diff; si `tipo` pasa de `FACTURACION` a `ENVIO`, conteo excluyendo la propia y regla; (5) `update` de los campos cambiados. Todas las lecturas ocurren antes de cualquier escritura.

### 6.4 Ejemplo verificado

Cliente con una FACTURACION "Casa" y un ENVIO "Depósito":

1. Pasar "Casa" a `ENVIO` → `422 DIRECCION_FACTURACION_REQUERIDA`; "Casa" sigue FACTURACION y no se emite evento.
2. Pasar "Depósito" a `FACTURACION` → permitido; ahora hay dos FACTURACION.
3. Repetir el paso 1 → permitido, porque existe otra FACTURACION activa.
4. "Depósito" es ahora la única FACTURACION: pasarla a `ENVIO` vuelve a dar `422`.

Este flujo es el escenario (d) de `test:integration:c2`.

**Sobre la concurrencia:** la serialización por `FOR UPDATE` es un mecanismo de diseño y **no tiene un test dedicado** que dispare dos ediciones simultáneas (ver 9). El escenario de las dos FACTURACION concurrentes se razonó a partir del diseño; lo que la suite verifica es la regla secuencial de arriba.

## 7. Auditoría

Ambos casos se cubren bajo el evento existente `cliente:actualizado` (spec §4: "2.2, 2.3, 2.8, tras `COMMIT`"); **HU-C2 no introduce eventos nuevos ni modifica el listener**. `ClienteActualizadoPayload` ya admitía `accion` / `tabla_afectada` / `registro_id` opcionales desde HU-C9 y el handler de `audit-log.listener.ts` los deriva con `??`, dejando intactos los defaults de HU-C3 (`CREATE` / `direcciones_cliente`). La emisión es post-COMMIT y fire-and-forget; la única vía de escritura a `AuditLog` es el listener.

| Caso | `accion` | `tabla_afectada` | `registro_id` | `valor_anterior` / `valor_nuevo` |
|---|---|---|---|---|
| Contacto (`editarCliente`) | `UPDATE` | `clientes` | id del cliente | Solo los campos que cambiaron (ej. `{ telefono: null }` → `{ telefono: "3874001122" }`) |
| Dirección (`editarDireccionCliente`) | `UPDATE` | `direcciones_cliente` | id de la **dirección** (la fila realmente afectada) | Solo los campos que cambiaron (ej. `{ tipo: "FACTURACION" }` → `{ tipo: "ENVIO" }`) |

`campos_modificados` viaja en el evento y el listener lo pliega dentro de `valor_nuevo` (junto con `cliente_id`), ya que `AuditLog` no tiene esa columna. Una edición sin cambios reales, o rechazada (`404`, `422`), no genera asiento.

### 7.1 Decisión: email y teléfono no se enmascaran en el log

El AC exige `valor_anterior` / `valor_nuevo`, y para un cambio de teléfono o email eso implica registrar esos valores. **Se decidió no enmascararlos.**

- **Justificación de fondo:** `spec_modulo_C.md` (línea 392) cita el Alcance Funcional, sección 6.1 (Ley N.° 25.326): "el módulo no administra categorías de datos sensibles según la definición de la ley". Por eso Módulo C no cifra ningún campo de `Cliente`, y el único mecanismo de protección es el encadenamiento SHA-256 del `AuditLog` (Módulo D). Contacto no es un dato sensible en este ERP.
- **Tensión con la spec §4 (a resolver por el equipo):** ese mismo documento (línea 418) establece la convención de que el payload "evita incluir el email o teléfono completo del cliente **cuando no es estrictamente necesario** para el registro de auditoría". Se interpretó que en HU-C2 **sí es necesario**, porque el propio AC pide el valor anterior/nuevo. La minimización se conserva en el resto: el evento **no copia** los campos que no cambiaron, y el alta de dirección de HU-C3 sigue sin llevar contacto. Si el equipo prefiere que el log solo registre *qué campos* cambiaron (`campos_modificados`) sin los valores, el ajuste es acotado (el service deja de poblar `valor_anterior` / `valor_nuevo` para `telefono` / `email`), a costa de incumplir la letra del AC.
- El documento de Alcance Funcional no está en el repositorio; la referencia a la sección 6.1 se toma de la cita que hace `spec_modulo_C.md`.

## 8. Interfaz de usuario

### 8.1 Dos puntos de entrada a la edición de contacto

Ambos reutilizan **el mismo componente de formulario** y **el mismo permiso**:

- **Ficha del cliente** (`/clientes/[id]`): `DatosContactoCliente.tsx` muestra nombre, teléfono y email en lectura, con un botón "Editar" que alterna al formulario. Al guardar o cancelar vuelve a la vista de lectura.
- **Listado** (`/clientes`): `TablaClientes.tsx` suma un botón "Editar" (lápiz) junto a "Ver ficha", que abre `EditarClienteDialog.tsx`, un `Dialog` con el formulario precargado con los datos de la fila. `ClienteListado` ya trae `nombre`, `telefono` y `email`, por lo que no hay fetch adicional. Al guardar el Dialog se cierra y la tabla se refresca sin recargar la página. Se cambió el encabezado de esa columna de "Ficha" a "Acciones". El patrón visual sigue a `EditarProductoMaestroDialog` de Inventario.

**Componente compartido:** `FormularioEditarContactoCliente.tsx` (react-hook-form + `zodResolver(EditarClienteSchema)` + componentes de `ui/form`). Recibe el cliente, un `dni` solo informativo (se muestra de solo lectura y **nunca** entra al payload), `onSuccess` y `onCancel`; no asume dónde está montado. Llama a la Server Action `editarCliente`, muestra los errores del servidor en un `Alert` y, al éxito, ejecuta `router.refresh()` y luego `onSuccess`. Un campo vacío en teléfono o email vacía el dato.

### 8.2 Permiso

Las páginas `/clientes` y `/clientes/[id]` resuelven `puedeEditar = usuarioTienePermiso(userId, "clientes:editar")` en el Server Component (`PERMISO_EDITAR` importado del service) y lo pasan hacia abajo; sin el permiso el botón no se renderiza. El servidor lo vuelve a exigir en la ruta y en la Server Action: ocultar el botón es solo de presentación.

### 8.3 Edición de direcciones

`DireccionesCliente.tsx` recibe `puedeEditar` y agrega a cada fila activa un botón "Editar" que reemplaza la fila por `FilaDireccionEdicion` (rótulo, tipo, dirección; misma validación del alta). Llama a `editarDireccionCliente`; el mensaje `DIRECCION_FACTURACION_REQUERIDA` del servidor se muestra en un `Alert` dentro de la fila. Solo hay `<select>` nativo, igual que en HU-C3 (no existe `ui/select`).

## 9. Testing

**Tests unitarios** (enumerados en el script `test`, sin base de datos):

| Archivo | Qué cubre |
|---|---|
| `src/lib/schemas/clientes.schema.test.ts` | `EditarClienteSchema`: edición parcial válida; `email: ""` se conserva (vaciar); email y nombre inválidos; `dni` ⇒ error `CAMPOS_NO_EDITABLES`; payload vacío ⇒ `400` y no `CAMPOS_NO_EDITABLES`. `EditarDireccionClienteSchema`: parcial válida, al menos un campo, `cliente_id` solo ⇒ inválido, formatos como el alta |
| `src/lib/services/clientes/direccion-cliente.reglas.test.ts` | `validarReglaEdicionDireccion`: `FACTURACION → ENVIO` sin otra FACTURACION lanza; con otra no lanza; `ENVIO → FACTURACION` nunca lanza; tipo sin cambio nunca lanza |

**Integración de servicio** — `npm run test:integration:c2`, archivo `edicion-cliente.integration.test.ts`, variable `HU_C2_INTEGRATION_DATABASE_URL` (se salta, no falla, si no está definida):

- (a) edición de contacto persistida; asiento `UPDATE` sobre `clientes` con valor anterior/nuevo; `""` vacía teléfono y email; el DNI no cambia.
- (b) edición sin cambios reales: sin escritura y sin asiento nuevo.
- (c) `dni` en el input ⇒ `CAMPOS_NO_EDITABLES` sin escrituras.
- (d) regla de FACTURACION en edición secuencial (ejemplo de 6.4), con verificación de que el rechazo no modifica la fila.
- (e) ediciones inocuas (rótulo, dirección, `ENVIO → FACTURACION`) no disparan la regla.
- (f) una dirección de otro cliente ⇒ `DIRECCION_NO_ENCONTRADA`.
- (g) asiento `UPDATE` sobre `direcciones_cliente` con `registro_id` = id de la dirección.

**Verificación:** la suite `c2` pasó 1/1 contra la base local; `test:integration:c3` y `test:integration:c9` siguen pasando 1/1 (no regresión del listener y del alta de dirección); `tsc` y `eslint` limpios sobre los archivos tocados.

**Lo que ningún test cubre hoy (gaps):**

- **Concurrencia:** no hay un test que dispare dos ediciones `FACTURACION → ENVIO` simultáneas. El `FOR UPDATE` está en el código y documentado, pero el escenario concurrente no se ejercitó. Un test dedicado requeriría dos transacciones interleaved (por ejemplo con `Promise.all` sobre dos conexiones) y asertar que exactamente una termina en `422`; el patrón existe en `cuenta-corriente.integration.test.ts`.
- **Capa HTTP:** no hay suite `http.integration` para los dos `PATCH` (códigos `401`/`403`/`422` por ruta) como sí tienen C3, C7, C8 y C9. Las rutas están cubiertas solo por tipado y por su equivalencia con el service.
- **UI:** el formulario compartido, el Dialog y la edición por fila no tienen test de navegador (el repo no tiene harness) y no se probaron manualmente en esta revisión.
- **Server Actions:** sin test de runtime propio.

## 10. Decisiones abiertas y pendientes

1. **Contrato de la spec §2.2 desactualizado** respecto a lo implementado (`409 DNI_INMUTABLE` vs `422 CAMPOS_NO_EDITABLES`; `campos_actualizados` vs `campos_modificados`; campo `direccion`). Decidir si se actualiza la spec o se ajusta el código (ver 1.1).
2. **Email y teléfono en el log de auditoría** (7.1): confirmar la interpretación de "estrictamente necesario" de la spec §4.
3. **Baja lógica de dirección** (fuera de alcance). Cuando se aborde, el *owner* de la regla de negocio debería ser el mismo módulo `direccion-cliente.reglas.ts`, con una función análoga a `validarReglaEdicionDireccion`: desactivar la única FACTURACION activa de un cliente que tiene ENVIO activos rompe el mismo invariante y debe resolverse con la misma técnica (conteo excluyendo la propia + lock por cliente). Falta definir el comportamiento deseado (bloquear con `422`, o exigir desactivar antes los ENVIO). Como el permiso `clientes:editar` cubre "direcciones" en la seed, habrá que decidir también si la baja reutiliza ese permiso o justifica uno propio (como hace `clientes:baja` para la baja del cliente).
4. **Test de concurrencia y suite HTTP** para los dos `PATCH` (sección 9).
5. **Edición de contacto concurrente sin control de versión:** dos ediciones simultáneas del mismo cliente aplican "el último gana" campo a campo (sin lock ni `updated_at` optimista). Es coherente con HU-C9 y HU-C8 y cada una queda auditada con su propio valor anterior; no se consideró necesario un control de concurrencia optimista para datos de contacto.

## 11. Impacto en otros archivos

| Archivo | Cambio |
|---|---|
| `src/lib/schemas/clientes.schema.ts` | `EditarClienteSchema`, `esErrorClienteCamposNoEditables`, `EditarDireccionClienteSchema` |
| `src/lib/services/clientes/cliente.service.ts` | `editarClienteTx`, `editarCliente`, `editarDireccionClienteTx`, `editarDireccionCliente` y sus tipos de resultado |
| `src/lib/services/clientes/direccion-cliente.reglas.ts` | `validarReglaEdicionDireccion` |
| `src/app/api/clientes/[id]/route.ts` | **Nuevo** — `PATCH` de contacto |
| `src/app/api/clientes/[id]/direcciones/[direccionId]/route.ts` | **Nuevo** — `PATCH` de dirección |
| `src/app/(dashboard)/clientes/actions.ts` | Server Actions `editarCliente` y `editarDireccionCliente` |
| `src/components/clientes/FormularioEditarContactoCliente.tsx` | **Nuevo** — formulario compartido |
| `src/components/clientes/DatosContactoCliente.tsx` | **Nuevo** — contacto de la ficha con modo edición (usa el formulario compartido) |
| `src/components/clientes/EditarClienteDialog.tsx` | **Nuevo** — botón + Dialog del listado |
| `src/components/clientes/DireccionesCliente.tsx` | Edición por fila (`FilaDireccionEdicion`) y prop `puedeEditar` |
| `src/components/clientes/TablaClientes.tsx` | Botón "Editar" por fila, prop `puedeEditar`, columna "Acciones" |
| `src/app/(dashboard)/clientes/page.tsx` | Resuelve `puedeEditar` y lo pasa a la tabla |
| `src/app/(dashboard)/clientes/[id]/page.tsx` | Lee `telefono`/`email`, resuelve `puedeEditar`, monta `DatosContactoCliente` |
| tests + `package.json` | Casos nuevos en los dos tests unitarios, `edicion-cliente.integration.test.ts` y el script `test:integration:c2` |

Sin migración, sin cambio de `schema.prisma`, sin nuevos permisos ni seed, y sin tocar los archivos compartidos de Módulo D.
