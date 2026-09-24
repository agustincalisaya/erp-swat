# HU-C4 — Gestión de consentimientos de clientes

**Módulo:** C — Gestión de Clientes
**Actores:** Vendedor y Administrador de CRM; ciertas resoluciones requieren un rol administrativo activo.
**Estado:** Implementada en el alta y en la ficha del cliente mediante Server Actions, rutas REST, servicio de consentimientos e historial de eventos.

## 1. Objetivo y alcance implementado

Registrar la manifestación expresa del cliente para dos finalidades: el tratamiento de datos necesario para operar con él (`VENTA_ASISTIDA`) y las comunicaciones comerciales (`COMUNICACIONES_COMERCIALES`). La ficha muestra el estado de cada finalidad, permite regularizar decisiones pendientes y registra solicitudes y resoluciones de revocación sin perder los hechos anteriores.

El consentimiento es una entidad propia (`ConsentimientoCliente`). Las decisiones y resoluciones se guardan en `EventoConsentimientoCliente`. La lectura del estado se obtiene del historial; una revocación no borra ni desactiva la aceptación histórica.

## 2. Roles, permisos y requisitos previos

| Operación | Permiso y condición |
|---|---|
| Dar de alta un cliente | `clientes:crear`; se exigen las decisiones del apartado 3. |
| Abrir la ficha y consultar consentimientos | `clientes:leer`. Un cliente inactivo conserva su historial visible, pero la ficha no ofrece controles de escritura. |
| Regularizar, revocar comunicaciones comerciales o solicitar revocación del tratamiento | `clientes:gestionar_consentimiento`, asignado a `VENDEDOR` y `ADMINISTRADOR_CRM` en el seed. El cliente debe estar activo. |
| Ejecutar o rechazar una solicitud de revocación; registrar una nueva aceptación tras una revocación | `clientes:gestionar_consentimiento` y una asignación activa a un rol activo `ADMINISTRADOR_CRM` **o** `ADMINISTRADOR`. El cliente debe estar activo. |

Las operaciones requieren sesión. La ficha comprueba el permiso de lectura antes de mostrar al cliente; las acciones y rutas verifican el permiso de gestión. El servicio vuelve a comprobar permiso y rol para las transiciones dentro de la transacción. Los identificadores del consentimiento y de la solicitud se validan contra el estado vigente: una pantalla desactualizada no autoriza una resolución.

Para regularizar, la finalidad debe estar `PENDIENTE_REGULARIZACION`. Un registro legado por sí solo no acredita aceptación expresa. Si el estado es `ERROR_INTEGRIDAD`, se muestra que requiere revisión y no se aceptan nuevas decisiones. Una aceptación ya vigente, una solicitud pendiente o una revocación resuelta tampoco se repiten por reenviar el formulario.

## 3. Alta del cliente

1. En `/clientes/nuevo`, cargar los datos del cliente y marcar **«El cliente acepta el tratamiento de sus datos personales necesario para registrarlo y operar con él»**.
2. Responder **«¿El cliente acepta recibir comunicaciones comerciales?»** con **«Sí, acepta»** o **«No, rechaza»**.
3. Confirmar el alta. Para un DNI nuevo, el servicio exige la aceptación del tratamiento y la decisión comercial, aunque el esquema de entrada permita omitirlas para recuperar un DNI ya existente. Si falta alguna, el alta devuelve un error y no crea al cliente.

La creación del cliente, la aceptación expresa del tratamiento y los eventos iniciales se realizan en una misma transacción. Si la decisión comercial es **ACEPTA**, se crea además una aceptación comercial y su evento. Si es **RECHAZA**, se registra `RECHAZO_COMERCIAL` sin crear un consentimiento comercial. El rechazo comercial no impide el alta. Si el DNI ya existe, HU-C1 recupera ese cliente sin registrar las decisiones de este intento.

## 4. Consulta y regularización desde la ficha

1. Abrir `/clientes/[id]` con `clientes:leer` y buscar la sección **Consentimientos**.
2. Leer por separado **Tratamiento de datos para operar con el cliente** y **Comunicaciones comerciales**. Cada sección muestra su estado, la última manifestación válida y quién la registró, si esos datos existen. También muestra las solicitudes de revocación pendientes.
3. Si una finalidad indica **Pendiente de regularización** y el usuario puede gestionarla, elegir una **Nueva manifestación expresa** y pulsar **Registrar decisión**. Para tratamiento solo se ofrece **Acepta**; para comunicaciones comerciales se ofrecen **Acepta** y **Rechaza**.
4. La ficha se actualiza tras guardar. El resultado es **Aceptado** o, solo para comunicaciones comerciales, **Rechazado**. La decisión queda en el historial cronológico.

La ficha de un cliente inactivo permite consultar los estados y el historial, sin regularizar ni registrar transiciones.

## 5. Revocaciones y nueva aceptación

Todas estas operaciones se realizan en la sección **Consentimientos** de la ficha de un cliente activo. El formulario muestra un motivo opcional, salvo al rechazar una solicitud, donde es obligatorio (hasta 1000 caracteres).

| Estado previo y finalidad | Paso visible | Resultado esperado |
|---|---|---|
| **Aceptado**, comunicaciones comerciales | Pulsar **Revocar comunicaciones comerciales**. | Se añade `REVOCACION_EJECUTADA`; la finalidad queda **Revocada** sin afectar la aceptación del tratamiento ni la operatoria esencial del cliente. |
| **Aceptado**, tratamiento, sin solicitud pendiente | Pulsar **Solicitar revocación del tratamiento**. | Se añade `SOLICITUD_REVOCACION`. La solicitud aparece como pendiente y el tratamiento sigue **Aceptado** hasta su resolución. |
| Solicitud de tratamiento pendiente; usuario administrativo autorizado | Pulsar **Ejecutar revocación solicitada**. | Se añade `REVOCACION_EJECUTADA` vinculada a la solicitud; el tratamiento queda **Revocado**. |
| Solicitud de tratamiento pendiente; usuario administrativo autorizado | Indicar un motivo y pulsar **Rechazar solicitud**. | Se añade `SOLICITUD_RECHAZADA` vinculada a la solicitud; desaparece de pendientes y el tratamiento sigue **Aceptado**. |
| Finalidad **Revocada**; usuario administrativo autorizado | Marcar **«El cliente manifestó expresamente una nueva aceptación de esta finalidad»** y pulsar **Registrar nueva aceptación expresa**. | Se crea una nueva aceptación y el evento `NUEVA_ACEPTACION`; la finalidad vuelve a **Aceptado**. No se modifica la aceptación anterior. |

Las operaciones completadas muestran **«Operación registrada.»**. Si el estado cambió mientras la ficha estaba abierta, el servicio rechaza la operación obsoleta y muestra el error; no sobrescribe la decisión vigente.

## 6. Estados e historial

La ficha muestra `Pendiente de regularización`, `Aceptado`, `Rechazado`, `Revocado` o `Error de integridad` para cada finalidad. Debajo aparece **Historial cronológico** con tipo de hecho, finalidad, fecha, actor y, cuando corresponden, identificadores de consentimiento o solicitud y motivo. Los registros legados aparecen identificados como tales y no se interpretan como aceptación expresa.

Los tipos de evento implementados son `ACEPTACION_INICIAL`, `RECHAZO_COMERCIAL`, `SOLICITUD_REVOCACION`, `REVOCACION_EJECUTADA`, `SOLICITUD_RECHAZADA` y `NUEVA_ACEPTACION`. Una resolución agrega un evento que referencia la solicitud; no altera el evento original. El servicio publica `consentimiento:decision_registrada` después de confirmar la transacción para su auditoría central.

## 7. Notas técnicas: diferencias con la especificación

- La ficha usa `regularizarConsentimiento` y `registrarTransicionConsentimiento` de `src/app/(dashboard)/clientes/consentimientos.actions.ts`. Las rutas REST son `POST /api/clientes/[id]/consentimientos` para regularización y `POST /api/clientes/[id]/consentimientos/transiciones` para las demás operaciones.
- `docs/specs/spec_modulo_C.md` §2.4 todavía describe `registrarConsentimiento()` y `revocarConsentimiento()` en `clientes/actions.ts`, además de `PATCH /api/clientes/[id]/consentimientos/[consentimiento_id]/revocar`. Esas superficies no están implementadas; la revocación real usa la ruta y acción de transiciones anteriores.
- La especificación ejemplifica el alcance `AMBOS` y una revocación mediante baja lógica del consentimiento. Las decisiones nuevas del código usan las dos finalidades por separado; `AMBOS` puede aparecer en datos legados de lectura. La revocación real agrega `REVOCACION_EJECUTADA` y conserva intacta la fila histórica de `ConsentimientoCliente`.
- La especificación exige motivo para revocar. En la implementación, el motivo es opcional para la revocación comercial, la solicitud y la ejecución; solo **Rechazar solicitud** lo exige. Las finalidades de las decisiones nuevas son las cadenas fijas del servicio, no un texto libre enviado desde el formulario.
- La especificación exige un consentimiento inicial durante el alta. El código concreta esa exigencia para el tratamiento; la opción comercial **RECHAZA** registra un evento de rechazo, sin crear una aceptación comercial.

**Referencias de implementación:** `FormularioAltaCliente.tsx`, `cliente.service.ts`, `ConsentimientosCliente.tsx`, `consentimientos.actions.ts`, `consentimiento.service.ts`, `consentimiento.estado.ts` y `consentimientos.schema.ts`.
