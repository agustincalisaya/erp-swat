# HU-H1 — Gestión y ciclo de vida de Proveedores (Módulo H)

**Issue de GitHub:** #<completar número de ticket>
**Rama:** `HU-H1` (mergeada a `develop`)
**Sprint:** Sprint 2, Módulo H (Proveedores y Abastecimiento)
**Rol:** Comprador / Supervisor de Compras

## Resumen

Se implementó la gestión completa del legajo comercial de proveedores: alta transaccional en estado `PENDIENTE`, edición parcial del legajo con re-cifrado de datos bancarios, máquina de estados de homologación (`PENDIENTE` / `HOMOLOGADO` / `SUSPENDIDO`) con transiciones manuales, baja lógica con motivo obligatorio y listado operativo con filtro por estado. Los datos bancarios se persisten cifrados con AES-256-GCM y cada operación crítica se audita de forma inmutable a través del bus de eventos de dominio (encadenamiento SHA-256 del Módulo D).

## Objetivo

Dar de alta y mantener el legajo comercial de los proveedores, controlando su habilitación para operar (homologación) y protegiendo la información sensible (Ley N.° 25.326), de modo que el circuito de compras solo pueda emitir órdenes contra proveedores homologados y vigentes.

## Alcance

**Implementado:**

- Alta de proveedor con legajo comercial (razón social, nombre de fantasía, CUIT, condiciones de pago, categorías, contactos y datos bancarios opcionales), siempre en estado `PENDIENTE`.
- Unicidad de CUIT contra registros activos: pre-verificación más captura del error de constraint de base datos (`P2002`) → `409 CUIT_DUPLICADO`.
- Cifrado AES-256-GCM de los datos bancarios (CBU / alias / banco) **antes** de persistir; el valor en claro nunca se expone en logs, eventos ni respuestas HTTP.
- Máquina de estados de homologación con transiciones manuales: `P→H`, `H→P`, `H→S`, `S→P`, `S→H`. Se rechazan la transición directa `P→S` y la transición a mismo estado (`422`).
- Motivo obligatorio al suspender (validación en el schema Zod y re-validación en el servicio).
- Edición parcial del legajo: no permite modificar `cuit` ni `estado`; los datos bancarios pueden reemplazarse (se re-cifran con un IV nuevo) pero nunca se descifran hacia el frontend.
- Baja lógica (soft delete) con motivo obligatorio: `is_active = false`, `deleted_at`, `deleted_by`, `deletion_reason`.
- Listado operativo de proveedores activos con filtro por estado, sin exponer campos bancarios.
- RBAC granular por acción y auditoría de todas las operaciones críticas vía eventos de dominio.

**Fuera de alcance:**

- Validación cruzada contra el Módulo I (RMA): no existe aún; el vínculo `rma_id` pertenece a la HU-A9.
- Solicitud de homologación iniciada por el Comprador (flujo de aprobación): fuera del alcance del sprint.
- Reutilización del CUIT de un proveedor dado de baja (requeriría un índice único parcial — ver deuda técnica).

## Modelo de datos

**No se modificó `schema.prisma`.** El modelo `Proveedor` y el enum `EstadoProveedor { PENDIENTE, HOMOLOGADO, SUSPENDIDO }` ya existían en el esquema unificado del Sprint 2, por lo que esta HU no generó ninguna migración. El contrato de datos quedó estable para el resto del Módulo H (HU-H3/H4/H5).

Campos relevantes utilizados:

- `cuit String @unique` — unicidad a nivel de base de datos (el servicio traduce la colisión a `409`).
- `estado EstadoProveedor @default(PENDIENTE)` — el alta nunca crea un proveedor `HOMOLOGADO`.
- `datos_bancarios_cifrado String?` + `datos_bancarios_iv String?` — ciphertext e IV del legajo bancario.
- Soft delete estricto: `is_active`, `deleted_at`, `deleted_by`, `deletion_reason`.
- Índice `@@index([estado, is_active])` para el listado operativo.

**Módulo de cifrado (nuevo):** `src/lib/crypto/aes.ts` — AES-256-GCM con IV aleatorio de 12 bytes por operación, almacenamiento en formato `hex(tag‖ct)` + IV en hex, y clave leída de la variable de entorno `ENCRYPTION_KEY_PROVEEDORES` (64 hex) validada de forma perezosa. La única capa que cifra/descifra es el servicio; el módulo no registra nunca el valor en claro.

## Reglas de negocio implementadas

- **Alta siempre en `PENDIENTE`:** la homologación es una transición explícita posterior, nunca un estado inicial.
- **CUIT único:** se valida contra proveedores activos y se captura la violación de constraint para cubrir condiciones de carrera entre requests concurrentes.
- **Cifrado en reposo:** los datos bancarios se cifran antes de construir el objeto de escritura; los payloads de eventos y las respuestas HTTP se construyen sin ellos.
- **Matriz de transiciones (flexibilidad operativa):** son válidas `P→H`, `H→P`, `H→S`, `S→P` y `S→H`; se rechazan `P→S` directo y la transición al mismo estado con `422 TRANSICION_INVALIDA`. `HOMOLOGADO` puede volver a `PENDIENTE` y `SUSPENDIDO` puede re-homologarse directamente.
- **Motivo obligatorio al suspender:** se exige tanto en la validación de entrada como en el servicio (defensa en profundidad); sin motivo no se toca la base.
- **La suspensión no invalida órdenes en curso:** bloquea la selección del proveedor en nuevas órdenes de compra, pero no afecta las órdenes ya `CONFIRMADA` (validación de aplicación, no de base de datos).
- **Baja lógica estricta:** prohibido el borrado físico; la baja conserva la fila con su motivo para trazabilidad.
- **Edición acotada:** `cuit` y `estado` no son editables por esta vía; los datos bancarios solo se reemplazan (nunca se muestran descifrados).
- **Un permiso por acción** (sin permisos genéricos): `proveedores:crear`, `proveedores:editar`, `proveedores:leer`, `proveedores:homologar`, `proveedores:baja`.

## Arquitectura y archivos

**Archivos nuevos:**

- `src/lib/crypto/aes.ts` + `src/lib/crypto/aes.test.ts` — módulo de cifrado AES-256-GCM y sus tests.
- `src/lib/services/proveedores/proveedor.service.ts` + `proveedor.service.test.ts` — alta, cambio de estado, baja, edición y listado, con las constantes de permisos y la matriz de transiciones.
- `src/app/api/proveedores/route.ts` — `POST` (alta) y `GET` (listado).
- `src/app/api/proveedores/[id]/estado/route.ts` — `PATCH` (homologar / suspender / volver a PENDIENTE).
- `src/app/api/proveedores/[id]/baja/route.ts` — `PATCH` (baja lógica).
- `src/app/api/proveedores/[id]/route.ts` — `PATCH` (edición del legajo).
- `src/app/(dashboard)/compras/proveedores/page.tsx` + `actions.ts` — pantalla y Server Actions.
- `src/components/compras/` — `TablaProveedores`, `FormularioNuevoProveedor`, `EstadoProveedorBadge`, `DialogHomologar`, `DialogSuspender`, `DialogVolverPendiente`, `DialogBaja` y `AccionesProveedorMenu`.

**Archivos modificados:**

- `src/lib/schemas/proveedores.schema.ts` — schemas de alta, cambio de estado, baja y edición (no se tocaron los de HU-H5).
- `src/lib/events/event-types.ts` — payloads `ProveedorBajaLogicaPayload` y `ProveedorLegajoEditadoPayload` + sus entradas en el mapa de eventos.
- `src/lib/events/listeners/audit-log.listener.ts` — dos handlers nuevos y aditivos (no se modificó ningún handler existente).
- `prisma/seed.ts` — permisos granulares del Módulo H (reemplazo del placeholder `proveedores:administrar`).
- `package.json` — enumeración de los tests nuevos.
- `.env.example` — documentación de `ENCRYPTION_KEY_PROVEEDORES`.

## Flujo transaccional

Cada escritura corre dentro de una única `prisma.$transaction`. En el cambio de estado, el estado de origen se valida **dentro** de la transacción (lectura + actualización condicionada), lo que elimina la ventana de carrera ante dos transiciones concurrentes. La edición y la baja usan actualizaciones condicionadas por `is_active`/`deleted_at` para garantizar que no se opera sobre un registro ya dado de baja.

Los eventos de dominio se emiten **después** de confirmado el commit (nunca dentro de la transacción). El servicio nunca escribe el registro de auditoría: lo hace exclusivamente el listener de auditoría.

## Eventos de dominio

- `proveedor:estado_cambiado` — ya existía (lo reutiliza también HU-H5 con `origen: "AUTOMATICO"`); esta HU lo emite con `origen: "MANUAL"` y el usuario de la sesión.
- `proveedor:baja_logica` — nuevo; registra la baja con su motivo.
- `proveedor:legajo_editado` — nuevo; registra qué campos se modificaron (sin valores de datos bancarios).

En el listener de auditoría, los handlers nuevos escriben con las acciones `UPDATE_ESTADO`, `DELETE_LOGICO` y `UPDATE` sobre la tabla `proveedores`, con `ip: "internal-event"` (evento emitido fuera de un request directo) y con el payload saneado (sin datos sensibles).

## Manual de usuario

### Gestión y ciclo de vida de Proveedores

**Rol:** Comprador / Supervisor de Compras

**¿Qué permite hacer esta pantalla?**

Permite administrar el legajo comercial completo de los proveedores y controlar su ciclo de vida dentro del circuito de compras: dar de alta proveedores nuevos, editar sus datos comerciales y de contacto, gestionar su estado de habilitación (Pendiente, Homologado o Suspendido) y dar de baja un registro cuando deja de operar. El listado muestra únicamente los proveedores activos y permite filtrarlos por estado.

**Requisitos previos**

- Estar autenticado con un usuario del módulo de Compras.
- Para crear o editar un proveedor: permiso de Comprador o de Supervisor de Compras.
- Para Homologar, Suspender o Dar de baja: permiso exclusivo de Supervisor de Compras (el Comprador no verá estas acciones).
- Contar con los datos del proveedor: razón social y CUIT como mínimo. Los datos bancarios son opcionales.

**Paso a paso**

1. Ingrese al sistema y, en el menú lateral, abra la sección **Compras** y haga clic en **Proveedores**.
2. Use el filtro por estado (Pendiente / Homologado / Suspendido) para acotar el listado si lo necesita.
3. Para **dar de alta un proveedor**, haga clic en el botón de alta y complete el formulario: razón social (obligatorio), nombre de fantasía, CUIT con formato **NN-NNNNNNNN-N** (obligatorio), condiciones de pago, categorías (al menos una), datos de contacto y datos bancarios opcionales (CBU de 22 dígitos, alias y banco).
4. Confirme el alta. El proveedor se crea siempre en estado **PENDIENTE**.
5. Para **editar el legajo**, haga clic en el botón **Editar** de la fila, modifique los datos necesarios y guarde. No es posible cambiar el CUIT ni el estado desde esta pantalla, y los datos bancarios se pueden reemplazar pero no se muestran en pantalla.
6. Para **cambiar el estado**, haga clic en el botón de tres puntos (**⋮ "Más acciones"**) al final de la fila. Las opciones dependen del estado:
   - **PENDIENTE**: Homologar · Dar de baja.
   - **HOMOLOGADO**: Suspender · Volver a PENDIENTE · Dar de baja.
   - **SUSPENDIDO**: Homologar · Volver a PENDIENTE · Dar de baja.
7. Complete la confirmación según la acción elegida:
   - **Homologar**: el proveedor queda habilitado para nuevas órdenes de compra.
   - **Suspender**: se solicita un **motivo obligatorio**; el proveedor deja de ser seleccionable para nuevas órdenes.
   - **Volver a PENDIENTE**: el proveedor regresa al estado inicial para su revisión.
   - **Dar de baja**: se solicita un **motivo obligatorio**; el registro deja de aparecer en el listado.
8. Confirme la acción: el diálogo se cierra y la tabla se actualiza automáticamente mostrando el nuevo estado.

**Capturas de pantalla del paso a paso:**

- [Insertar captura del listado de proveedores con el filtro por estado]
- [Insertar captura del formulario de alta de proveedor]
- [Insertar captura del formulario de edición abierto con el botón "Editar"]
- [Insertar captura del menú desplegable ⋮ "Más acciones" con las opciones según estado]
- [Insertar captura del cuadro de confirmación de "Suspender" con el campo de motivo]
- [Insertar captura del cuadro de confirmación de "Dar de baja" con el campo de motivo]
- [Insertar captura de la fila actualizada con el nuevo estado]

**Resultado esperado**

- El proveedor nuevo queda registrado en estado **PENDIENTE** y visible en el listado.
- Las ediciones del legajo se guardan y se reflejan de inmediato.
- Cada cambio de estado se aplica de forma persistente y se ve en el listado con su etiqueta de estado.
- Las bajas dejan de mostrarse en el listado (el registro se conserva internamente para trazabilidad).
- Todas las acciones quedan registradas en la auditoría del sistema.

**Errores comunes**

- **"Ya existe un proveedor activo con el CUIT…"**: el CUIT ya pertenece a un proveedor registrado; verifíquelo antes de crear uno nuevo.
- **CUIT con formato incorrecto**: debe respetar exactamente el formato NN-NNNNNNNN-N.
- **No se puede guardar el alta**: revise la razón social, al menos una categoría y que el CBU (si se carga) tenga 22 dígitos.
- **No aparece la opción "Suspender" en un proveedor PENDIENTE**: es el comportamiento correcto; un proveedor nunca homologado no puede suspenderse.
- **No se ven las acciones Homologar, Suspender o Dar de baja**: su usuario no tiene el permiso de Supervisor de Compras.
- **El sistema pide un motivo al Suspender o Dar de baja**: el motivo es obligatorio en ambas acciones.
- **Los datos bancarios no se muestran al editar**: por seguridad el sistema no expone el CBU ni el alias almacenados; solo permite reemplazarlos.

## Verificación

- `npm test`, `npm run lint` y `npm run build` en verde en cada entrega de la rama.
- Prueba funcional de los flujos de alta, edición, homologación, suspensión y baja, con verificación de persistencia en base de datos y del registro de auditoría (acciones `UPDATE_ESTADO`, `UPDATE`, `DELETE_LOGICO`).
- Los datos bancarios se verificaron cifrados en base y ausentes en respuestas HTTP y payloads de eventos.

## Actualizaciones post-entrega

Sobre la rama ya mergeada se aplicaron correcciones detectadas en pruebas manuales y en revisión de equipo:

- **Filtro por estado robusto:** un valor inválido en el filtro ya no produce un error de render; el listado se muestra completo.
- **Modales utilizables:** los modales de alta y edición ahora tienen altura máxima con desplazamiento interno y los botones de acción siempre visibles.
- **Transiciones completas en la interfaz:** se agregó la acción "Volver a PENDIENTE" para proveedores Homologados y Suspendidos (la matriz ya la permitía, la interfaz no la ofrecía).
- **Columna de acciones:** las acciones secundarias se agruparon en un menú desplegable (⋮) para que la fila no desborde.
- **RBAC del Auditor:** se otorgó `proveedores:leer` al rol Auditor, conforme a la matriz de permisos del Documento de Alcance (§5), para que pueda consultar los legajos sin recibir un error de autorización.
- **Menú de acciones operativo:** tras la migración de la librería de componentes (Radix → Base UI), el menú dejó de abrir sus diálogos por un mecanismo de disparo sintético sobre controles ocultos. Se refactorizaron los cuatro diálogos a modo controlado (`open` / `onOpenChange`) y el menú pasó a manejar un único estado de acción abierta, sin controles ocultos. "Editar" quedó intacto.

## Deuda técnica y decisiones sujetas a revisión

- **Emisión de eventos post-commit fire-and-forget:** una caída del proceso entre el commit y la emisión del evento puede perder el registro de auditoría. Es consistente con el resto del proyecto (Módulo D) y quedó documentado en la especificación del módulo.
- **CUIT de proveedores dados de baja:** el índice único es total, por lo que un CUIT de un proveedor dado de baja no puede reutilizarse. Permitirlo requeriría un índice único parcial (otro sprint).
- **Clave de cifrado:** `ENCRYPTION_KEY_PROVEEDORES` debe estar presente en el entorno; está documentada en `.env.example` y nunca se versiona su valor.
- **Actor del alta:** el modelo `Proveedor` no tiene columna de creador, por lo que el alta no persiste qué usuario la realizó (el resto de las escrituras sí registran el usuario). Si se necesita, requiere un campo nuevo y su migración.
