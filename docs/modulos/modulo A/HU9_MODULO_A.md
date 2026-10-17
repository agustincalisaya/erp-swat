# HU-A9 — Reclasificación de Devueltos (Módulo A)

**Issue de GitHub:** #<completar número de ticket>
**Rama:** `HU-A9` (mergeada a `develop`)
**Sprint:** Sprint 2, Módulo A (Inventario)
**Rol:** Encargado de Depósito / Administrador

## Resumen

Se implementó la resolución de las unidades devueltas (garantía o post-venta) mediante un control de calidad físico: la unidad puede reincorporarse al stock comercial (resultado **APTO** → estado `DISPONIBLE`) o darse de baja como merma (resultado **NO_APTO** → estado `BAJA_MERMA`, con **motivo obligatorio**). Cuando la cantidad a dar de baja **supera las 5 unidades**, la operación no se aplica directamente: se registra una **solicitud pendiente de aprobación** que solo un Administrador puede aprobar o rechazar. La operación se registra como un movimiento de stock **inmutable (append-only)** y queda trazada en la auditoría con encadenamiento SHA-256 (Módulo D). El vínculo con un RMA (Módulo I, futuro) es opcional y no bloquea la operación.

## Objetivo

Cerrar la transición `Devuelto` de la máquina de estados de stock, garantizando que ninguna unidad devuelta quede "congelada": o vuelve al stock apto para la venta, o se da de baja formalmente con su motivo. La regla de doble validación por umbral protege las bajas de mayor magnitud incorporando la aprobación de un responsable.

## Alcance

**Implementado:**

- Reclasificación de una unidad `DEVUELTO` a `DISPONIBLE` (APTO) o `BAJA_MERMA` (NO_APTO).
- Precondición de estado: solo se puede reclasificar una unidad cuyo **último movimiento** para el par (variante, depósito) esté en `DEVUELTO`; en caso contrario la operación se rechaza con `409`.
- Motivo obligatorio cuando el resultado es NO_APTO (validación de entrada y re-validación en el servicio).
- Doble validación por umbral: por encima de **5 unidades** la baja no se persiste directamente, sino que queda como solicitud pendiente de aprobación por un Administrador.
- Aprobación (efectiviza la baja) y rechazo (con motivo obligatorio) de las solicitudes pendientes.
- Registro inmutable del movimiento (cabecera + ítem) con los estados de origen y destino, sin modificar nunca movimientos anteriores.
- Reincorporación al stock del depósito **solo** cuando el resultado es APTO.
- Vínculo opcional con RMA (campo nullable, sin clave foránea: el Módulo I no existe aún).
- Auditoría completa del ciclo (reclasificación y solicitudes) vía eventos de dominio.
- Interfaz de usuario para el listado de devueltos, la reclasificación y la aprobación/rechazo de solicitudes.

**Fuera de alcance:**

- Validación de existencia del RMA contra el Módulo I (responsabilidad del Módulo I cuando se construya).
- Umbral configurable como parámetro persistido en base de datos (se implementó como constante de configuración en código).
- Paginación del listado de devueltos.

## Modelo de datos

Esta HU **sí modificó `schema.prisma`** con cambios aditivos (una única migración, sin tocar migraciones ya aplicadas):

**Campos nuevos en `MovimientoStockItem`:**

- `motivo String?` — motivo obligatorio a nivel de negocio cuando el estado destino es `BAJA_MERMA`.
- `rma_id String?` — referencia opcional a un ticket RMA del Módulo I. **Sin clave foránea**: el modelo destino no existe todavía; cuando se construya el Módulo I se agregará la relación. La validación cruzada será responsabilidad de ese módulo (aislamiento de dominio).

**Modelo nuevo `ReclasificacionSolicitud`:** registra las bajas que superan el umbral y su circuito de aprobación. Campos: `variante_sku_id`, `deposito_id`, `cantidad`, `motivo`, `rma_id?`, `estado`, `solicitada_por_id`, `aprobada_por_id?`, `aprobada_at?`, `rechazada_motivo?` y marcas de tiempo. Relaciones a `variantes_sku` y `depositos` con `onDelete: Restrict`.

**Enum nuevo `EstadoReclasificacionSolicitud { PENDIENTE_APROBACION, APROBADA, RECHAZADA }`.**

**Contexto del modelo de movimientos (HU-A11):** `MovimientoStock` es la cabecera del movimiento y `MovimientoStockItem` contiene los ítems con `variante_sku_id`, `cantidad`, `estado_origen` y `estado_destino`. Los estados de stock se modelan como texto libre en el ítem. `TipoMovimiento` es un enum cerrado (`INGRESO`, `EGRESO`, `TRANSFERENCIA`, `AJUSTE`).

## Reglas de negocio implementadas

- **Transición cerrada:** desde `DEVUELTO` solo son válidas `DISPONIBLE` (APTO) y `BAJA_MERMA` (NO_APTO). Cualquier otra transición se rechaza con `422 TRANSICION_INVALIDA`.
- **Precondición de estado:** se resuelve el **último movimiento** del par (variante, depósito) por fecha de creación y se verifica que su estado destino sea `DEVUELTO`. No existe un estado desnormalizado en el stock: el estado vigente es siempre el del último movimiento. La verificación corre dentro de la misma transacción que la escritura (sin ventana de carrera).
- **Motivo obligatorio en la merma:** exigido en el esquema de validación y re-validado en el servicio antes de tocar la base (`400 MOTIVO_REQUERIDO`).
- **Doble validación por umbral:** umbral de **5 unidades** definido como constante de configuración (`UMBRAL_BAJA_MERMA_UNIDADES`). Con cantidad menor o igual al umbral la operación se persiste directamente; con cantidad mayor, se registra **solo** la solicitud en estado `PENDIENTE_APROBACION` — sin crear movimiento y sin tocar el stock.
- **Aprobación exclusiva del Administrador:** el permiso `inventario:reclasificar_aprobar` es exclusivo del rol Administrador. Aprobar materializa la baja (crea el movimiento `BAJA_MERMA`); rechazar exige un **motivo de rechazo** obligatorio. Solo se pueden resolver solicitudes en estado pendiente (`422` en caso contrario).
- **Merma sobre el umbral nunca incrementa stock:** solo la reclasificación APTO reincorpora cantidad al stock del depósito.
- **Inmutabilidad:** cada reclasificación es un movimiento nuevo; nunca se actualiza un movimiento previo. Las correcciones se modelan como movimientos compensatorios.
- **Exclusión de duplicados en el listado:** una unidad con una solicitud pendiente no vuelve a ofrecerse para reclasificar, y una unidad ya reclasificada deja de aparecer en el listado de devueltos.
- **Permisos:** `inventario:reclasificar` (Administrador y Encargado de Depósito) para reclasificar y listar; `inventario:reclasificar_aprobar` (solo Administrador) para resolver solicitudes.

## Arquitectura y archivos

**Archivos nuevos:**

- `src/lib/services/inventario/reclasificacion.service.ts` — reclasificación, aprobación, rechazo y listados; contiene la matriz de transición, la precondición y el flujo de umbral.
- `src/lib/config/reclasificacion.config.ts` — constante del umbral y ayuda de decisión.
- `src/app/api/inventario/variantes/[id]/reclasificar-devuelto/route.ts` — `PATCH` de reclasificación (con mapeo explícito del error de estado a `409`).
- `src/app/api/inventario/reclasificaciones/[id]/aprobar/route.ts` y `.../rechazar/route.ts` — `PATCH` de resolución de solicitudes.
- `src/app/api/inventario/reclasificaciones/pendientes/route.ts` y `src/app/api/inventario/devoluciones/route.ts` — listados de lectura.
- `src/app/(dashboard)/inventario/devoluciones/page.tsx` + `actions.ts` — pantalla y Server Actions.
- `src/components/inventario/ModalReclasificacion.tsx` y `SolicitudesPendientesPanel.tsx` — modal de reclasificación y panel de aprobación.
- `src/lib/services/inventario/reclasificacion.service.test.ts` — tests del servicio y de los esquemas.

**Archivos modificados:**

- `prisma/schema.prisma` + migración `add_reclasificacion_devueltos` — campos `motivo` y `rma_id`, modelo `ReclasificacionSolicitud` y enum de estado.
- `src/lib/schemas/inventario.schema.ts` — esquema de reclasificación (con validación condicional del motivo) y esquemas de aprobación/rechazo.
- `src/lib/events/event-types.ts` — cuatro payloads nuevos y sus entradas en el mapa de eventos.
- `src/lib/events/listeners/audit-log.listener.ts` — cuatro handlers nuevos y aditivos (ningún handler existente modificado).
- `prisma/seed.ts` — permisos granulares de reclasificación y fixture de unidades devueltas.
- `package.json` — enumeración del test nuevo.

## Flujo transaccional

**Reclasificación directa (hasta el umbral):** en una única transacción se validan variante y depósito activos, se resuelve el último movimiento del par y se verifica que esté en `DEVUELTO`, y se crea el movimiento (cabecera + ítem) con sus estados de origen y destino. Si el resultado es APTO, además se incrementa el stock del depósito de forma condicionada. Los eventos se emiten después del commit.

**Reclasificación sobre el umbral:** en una única transacción se validan precondiciones y se crea **solo** la solicitud en estado pendiente; no se crea movimiento ni se modifica el stock.

**Aprobación de una solicitud:** en una única transacción se cierra la solicitud de forma condicionada por su estado pendiente (lo que evita una doble aprobación concurrente) y se crea el movimiento de baja correspondiente. Luego se emiten los eventos de aprobación y de reclasificación.

## Eventos de dominio

- `stock:reclasificacion_devuelto` — reclasificación efectiva (aplica tanto a la vía directa como a la aprobación de una solicitud).
- `stock:reclasificacion_solicitud_creada` — se registró una baja que supera el umbral.
- `stock:reclasificacion_solicitud_aprobada` — un Administrador aprobó la solicitud.
- `stock:reclasificacion_solicitud_rechazada` — un Administrador rechazó la solicitud, con su motivo.

En el listener de auditoría, los handlers nuevos escriben con las acciones `RECLASIFICACION`, `SOLICITUD_CREADA`, `SOLICITUD_APROBADA` y `SOLICITUD_RECHAZADA` sobre las tablas `movimientos_stock` y `reclasificacion_solicitudes`, con `ip: "internal-event"`. El servicio nunca escribe el registro de auditoría.

## Manual de usuario

### Funcionalidad A — Reclasificar una unidad devuelta

**Rol:** Encargado de Depósito

**¿Qué permite hacer esta pantalla?**

Permite resolver el destino final de las unidades que fueron devueltas (por garantía o post-venta) a partir del control de calidad físico: reincorporar la unidad al stock comercial si está apta, o darla de baja como merma si presenta daños u obsolescencia. Cuando la cantidad a dar de baja supera las **5 unidades**, la operación no se aplica directamente: queda registrada como una **solicitud pendiente de aprobación** por un Administrador.

**Requisitos previos**

- Estar autenticado con un usuario que tenga el permiso de reclasificación de inventario (Encargado de Depósito).
- Que exista al menos una unidad en estado **DEVUELTO** en el depósito correspondiente.
- Para reclasificar como Baja/Merma: contar con el **motivo** (rotura, obsolescencia, etc.).
- El vínculo con RMA (garantía) es opcional.

**Paso a paso**

1. En el menú lateral, abra la sección **Inventario** y haga clic en **Devoluciones**.
2. Verá el **listado de unidades en estado DEVUELTO**, con su producto/SKU, cantidad, depósito y fecha de devolución.
3. Ubique la unidad y haga clic en **Reclasificar**.
4. Seleccione el **resultado del control de calidad**: **APTO** (la unidad vuelve al stock como Disponible) o **NO_APTO** (se dará de baja como Baja/Merma).
5. Si eligió **NO_APTO**, complete el **Motivo** (obligatorio). Si la devolución proviene de una garantía, puede indicar el **RMA** (opcional).
6. Indique la **cantidad** a reclasificar y confirme.
7. **Regla del umbral:** hasta **5 unidades** la reclasificación se aplica en el acto. Si la cantidad **supera las 5 unidades**, el sistema registra una **solicitud pendiente de aprobación** y la unidad deja de mostrarse en el listado hasta que un Administrador la resuelva.
8. Si reclasificó como APTO, verifique que el stock del depósito se haya incrementado.

**Capturas de pantalla del paso a paso:**

- [Insertar captura del listado de unidades DEVUELTO]
- [Insertar captura del cuadro de reclasificación con las opciones APTO / NO_APTO]
- [Insertar captura del campo Motivo obligatorio al seleccionar NO_APTO]
- [Insertar captura del campo RMA opcional]
- [Insertar captura de la confirmación exitosa de la reclasificación]

**Resultado esperado**

- **APTO**: la unidad pasa a Disponible y la cantidad se reincorpora al stock del depósito indicado.
- **NO_APTO (hasta 5 unidades)**: la unidad queda registrada como Baja/Merma con su motivo, sin afectar el stock.
- **NO_APTO (más de 5 unidades)**: se genera una solicitud pendiente; la baja se efectiviza recién cuando un Administrador la apruebe.
- La unidad procesada desaparece del listado y el cambio queda registrado en la auditoría.

**Errores comunes**

- **"La unidad no está en estado DEVUELTO para reclasificar"**: la unidad ya fue reclasificada o su último movimiento no corresponde a una devolución; actualice la pantalla para ver el estado vigente.
- **No se puede confirmar la baja sin motivo**: al elegir NO_APTO el motivo es obligatorio.
- **La unidad desaparece del listado tras confirmar**: no es un error; si la cantidad superó el umbral, quedó en proceso de aprobación.
- **No aparece el botón Reclasificar**: su usuario no tiene el permiso de reclasificación de inventario.
- **El stock no cambió tras una baja/merma**: es correcto; solo la reclasificación como APTO reincorpora unidades al stock.

### Funcionalidad B — Aprobar o rechazar solicitudes de reclasificación

**Rol:** Administrador

**¿Qué permite hacer esta pantalla?**

Permite resolver las solicitudes de baja/merma que superaron el umbral de 5 unidades y que, por su impacto, quedaron pendientes de autorización: el Administrador revisa cada solicitud y decide si la aprueba (efectivizando la baja de las unidades) o si la rechaza, dejando constancia del motivo. Es la segunda validación del circuito.

**Requisitos previos**

- Estar autenticado con un usuario Administrador (permiso exclusivo de aprobación de reclasificaciones).
- Que exista al menos una solicitud en estado **PENDIENTE_APROBACION**.
- Para rechazar: contar con el **motivo del rechazo** (obligatorio).

**Paso a paso**

1. En el menú lateral, abra la sección **Inventario** y haga clic en **Devoluciones**.
2. En la parte inferior verá el panel **"Solicitudes pendientes de aprobación"**, con un contador de solicitudes por resolver.
3. Revise los datos de cada solicitud: producto/SKU, cantidad, depósito, fecha, motivo informado y, si corresponde, el RMA asociado.
4. Para **aprobar**, haga clic en **Aprobar (baja/merma)**: el sistema efectiviza la baja de las unidades y da la solicitud por aprobada.
5. Para **rechazar**, escriba el **motivo del rechazo** en el campo correspondiente y haga clic en **Rechazar**: la solicitud queda rechazada y no se da de baja ninguna unidad.
6. La pantalla se actualiza automáticamente y la solicitud procesada desaparece del panel.

**Capturas de pantalla del paso a paso:**

- [Insertar captura del panel "Solicitudes pendientes de aprobación" con el contador]
- [Insertar captura del detalle de una solicitud pendiente]
- [Insertar captura del botón "Aprobar (baja/merma)"]
- [Insertar captura del campo de motivo de rechazo y el botón "Rechazar"]
- [Insertar captura del panel actualizado sin la solicitud procesada]

**Resultado esperado**

- **Aprobación**: las unidades quedan efectivamente dadas de baja como Baja/Merma y la operación se registra en la auditoría.
- **Rechazo**: la solicitud queda rechazada con su motivo, sin afectar el inventario.
- En ambos casos la solicitud desaparece del panel de pendientes y la pantalla se refresca sola.

**Errores comunes**

- **No aparece el panel de solicitudes**: su usuario no tiene el permiso de aprobación o no hay solicitudes pendientes.
- **No se puede rechazar sin motivo**: el motivo del rechazo es obligatorio para dejar trazabilidad.
- **La solicitud ya no está disponible al confirmar**: pudo haber sido resuelta por otra sesión; actualice la pantalla.
- **La unidad no aparece en el listado superior de devueltos**: es correcto; mientras la solicitud está pendiente, la unidad queda excluida para evitar una reclasificación duplicada.
- **El inventario no se modificó tras el rechazo**: es el comportamiento esperado.

## Verificación

- `npm test`, `npm run lint` y `npm run build` en verde en cada entrega de la rama.
- Cobertura de los escenarios de la especificación: transición inválida, reclasificación APTO y NO_APTO, motivo faltante, doble validación por umbral, aprobación y rechazo de solicitudes, vínculo con RMA presente y ausente, y control de permisos.
- Verificación de inmutabilidad del movimiento y del incremento de stock únicamente en el caso APTO.
- Pruebas manuales del equipo sobre la interfaz completa (listado, modal y panel de aprobación).

## Actualizaciones post-entrega

Correcciones aplicadas sobre la rama ya mergeada, a partir de la verificación y de las pruebas manuales:

- **Precondición estricta:** la verificación de estado pasó de buscar "la última devolución" a resolver el **último movimiento del par** y comprobar su estado. Esto cierra el caso de una doble reclasificación de la misma unidad.
- **Actualización automática de la tabla:** tras reclasificar, enviar una solicitud, aprobar o rechazar, la pantalla se refresca sola (antes había que recargar manualmente para ver el resultado).
- **Listado consistente:** el listado de devueltos ahora resuelve el **último movimiento por par** (los movimientos son inmutables y acumulativos, por lo que no alcanza con listar los ítems históricos en estado DEVUELTO) y **excluye las unidades con una solicitud pendiente**, de modo que no queden filas procesables ni duplicadas.
- **Fixture de pruebas:** el seed siembra unidades devueltas suficientes para ejercitar la regla del umbral (más de 5 unidades) y validar el circuito de aprobación de punta a punta.

## Deuda técnica y decisiones sujetas a revisión

- **Runner de pruebas sin base de datos:** el verificador de tests del proyecto no resuelve el alias de importación de los servicios, por lo que parte de la verificación del servicio son aserciones sobre el código fuente más los datos del seed, y no ejecuciones reales contra la base (misma limitación existente en el resto del proyecto).
- **Umbral como constante de configuración:** el umbral de 5 unidades vive en un módulo de configuración de código (no en una tabla de parámetros). Es una decisión ratificada para acotar el alcance; si el negocio requiere editarlo en runtime, se migra a un parámetro persistido.
- **Eventos post-commit fire-and-forget:** consistente con el resto del proyecto; una caída del proceso entre el commit y la emisión puede perder el registro de auditoría.
- **Estados de stock como texto libre:** los estados (`DEVUELTO`, `DISPONIBLE`, `BAJA_MERMA`) no están restringidos por un enum en el modelo de movimientos; su consistencia depende de la capa de servicios.
