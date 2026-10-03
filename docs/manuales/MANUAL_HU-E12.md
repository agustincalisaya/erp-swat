# HU-E12 — Preparación de pedidos (Pick & Pack / Click & Collect)

**Roles:** Administrador E-commerce · Operador Pick & Pack

## ¿Qué permite hacer esta pantalla?

Permite trabajar la **cola de preparación** de los pedidos web pagados que el cliente va a retirar por el local. Cuando un pago de Mercado Pago se aprueba, el pedido entra solo a esta cola y espera a que un operador lo prepare. Cada pedido muestra qué productos hay que buscar, cuántas unidades faltan escanear y su progreso. Cuando se escanean todas las unidades, el operador marca el pedido como listo y el sistema lo pasa a estado **Listo para retiro**, con un plazo de retiro calculado automáticamente.

## Requisitos previos

- Estar autenticado con un usuario del ERP que tenga permiso de lectura de la cola (lo tienen **Administrador E-commerce** y **Operador Pick & Pack**).
- Para preparar pedidos (tomar, escanear, completar): rol **Operador Pick & Pack**.
- Para asignar o quitar prioridades: rol **Administrador E-commerce**.
- Para escanear con la cámara: un dispositivo con cámara y permiso de cámara otorgado al navegador. Si no hay cámara, se puede ingresar el código a mano.

## La cola de preparación

1. En el menú lateral, abra la sección **E-commerce** y haga clic en **Preparación de pedidos**.
2. Verá una tarjeta por cada pedido pendiente de preparación, ordenada según la regla del sistema: primero los que tienen **prioridad manual** (de mayor a menor), después por **fecha de pago confirmada** (los más antiguos primero). El orden no se puede cambiar desde la pantalla.
3. Cada tarjeta muestra:
   - **Número de venta** del pedido (por ejemplo, `V-2026-000007`).
   - Etiqueta de **Prioridad** si el pedido la tiene, y su estado.
   - **Fecha de pago confirmada**. Si el pedido es anterior a esta funcionalidad y no tiene fecha registrada, se muestra *"Fecha de pago no disponible (registro anterior)"* — es solo informativo, el pedido se puede preparar igual.
   - **Progreso**: unidades confirmadas sobre unidades requeridas y porcentaje.
4. Use el botón **Actualizar** para recargar la cola, y los botones **Anterior / Siguiente** para moverse entre páginas si hay muchos pedidos.

[CAPTURA PENDIENTE: Cola de preparación con pedidos y progreso]

## Administrador E-commerce — asignar prioridad

El Administrador puede ver la cola y cambiar la urgencia de los pedidos, pero **no** puede tomar pedidos, escanear ni completar preparaciones.

1. En la tarjeta de un pedido **sin operador asignado**, ubique el campo **Prioridad (1–100)**.
2. Escriba un número entre 1 y 100 (100 = máxima urgencia) y haga clic en **Aplicar**. El pedido se reordena según la nueva prioridad.
3. Para quitar la prioridad, deje el campo vacío y haga clic en **Quitar**.
4. Si el pedido ya fue tomado por un operador, el campo de prioridad no aparece: no se puede repriorizar un pedido en curso.

## Operador Pick & Pack — preparar un pedido

### Tomar el pedido

1. En la tarjeta de un pedido libre (sin operador asignado), haga clic en **Tomar pedido**.
2. El pedido queda asignado a su usuario y se abre directamente la pantalla de preparación. Si otro operador lo tomó primero, verá el aviso *"Otro operador ya tomó este pedido"* y la cola se actualiza sola.
3. Los pedidos asignados a usted muestran el botón **Continuar preparación**; los asignados a otro operador muestran "Asignado a otro operador" y no se pueden trabajar.

[CAPTURA PENDIENTE: Pedido con botón Tomar pedido]

### Escanear las unidades

1. En la pantalla de preparación verá, a la izquierda, los **ítems del pedido** con la cantidad requerida, la confirmada y lo que falta de cada línea.
2. A la derecha está el **escáner**: apunte la cámara al código de barras (EAN) o etiqueta SKU de cada prenda. Cada lectura válida confirma **una sola unidad**: si la línea pide 3 unidades, hay que escanear 3 veces.
3. Sin cámara, escriba el SKU o EAN en el campo de **entrada manual** y presione **Confirmar**.
4. Tras cada lectura correcta aparece el aviso *"Unidad confirmada: [producto] (n/m)"* y la barra de progreso avanza.

[CAPTURA PENDIENTE: Escaneo de pedido con cámara]

### Completar la preparación

1. El botón **Completar preparación** se habilita solo cuando todas las líneas llegaron al 100%.
2. Al hacer clic, el pedido pasa a estado **Listo para retiro** y se muestra el **plazo de retiro** hasta el que el cliente puede pasar a buscarlo.
3. Con **Volver a la cola** regresa al listado. El pedido completado ya no aparece en la cola de pendientes.

> El sistema genera internamente el código de retiro del cliente. El operador **no necesita verlo ni copiarlo**: el cliente lo recibe por su cuenta y la entrega se valida en la instancia de retiro correspondiente.

## Errores y mensajes frecuentes

| Lo que ve en pantalla | Qué significa | Qué hacer |
|---|---|---|
| "El producto escaneado no pertenece a este pedido." | El código leído no está entre los ítems del pedido. | Verifique que escaneó la prenda correcta o revise si corresponde a otro pedido. |
| "La cantidad requerida de este producto ya fue completada." | Esa línea ya tiene todas sus unidades escaneadas. | Pase al siguiente producto pendiente del pedido. |
| "Otro operador ya tomó este pedido." | Un compañero tomó el pedido mientras usted lo veía. | Actualice la cola y elija otro pedido libre. |
| "Conflicto de escaneo. Reintentá la lectura." | Una lectura quedó a mitad de camino por una falla técnica. | Vuelva a escanear la misma prenda. |
| "Todavía faltan unidades por confirmar." | Intentó completar sin llegar al 100%. | Termine de escanear las unidades que figuran como pendientes. |
| "No tenés permisos para esta operación." | Su usuario no tiene el permiso necesario (por ejemplo, un Administrador intentando escanear, o un Operador intentando priorizar). | Pida la operación al rol correspondiente. |
| "Tu sesión expiró." | La sesión caducó. | Vuelva a iniciar sesión; el progreso escaneado no se pierde. |
| La cámara no inicia | Permiso de cámara denegado o dispositivo sin cámara. | Habilite el permiso en el navegador o use la entrada manual. |

## Resultado esperado

- Los pedidos pagados aparecen ordenados en la cola apenas se confirma el pago.
- Un pedido solo lo puede preparar un operador a la vez; otro operador no puede escanear ni completar un pedido ajeno.
- El progreso se conserva aunque se cierre la sesión o el navegador.
- Al completar, el pedido queda **Listo para retiro** con su plazo de retiro definido, y la operación queda registrada en la auditoría del sistema.
