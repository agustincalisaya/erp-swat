# Editar datos de contacto desde la ficha del cliente

## ¿Qué permite hacer esta pantalla?

Permite corregir o actualizar el **nombre**, el **teléfono** y el **email** de un cliente que ya está registrado, sin tener que darlo de baja y volver a crearlo. La edición se hace directamente en la ficha del cliente, en el recuadro "Datos de contacto". El **DNI no se puede modificar**: se muestra solo como referencia. También permite **quitar** un teléfono o un email cargado por error, dejando el campo vacío. Cada cambio queda registrado en la auditoría del sistema, con el valor anterior y el nuevo.

## Requisitos previos

- Estar autenticado con un usuario de rol **Vendedor** o **Administrador de CRM** (permiso de edición de clientes). Con otro rol, el botón **Editar** no aparece.
- Que el cliente ya esté dado de alta en el sistema.
- Que el cliente esté **activo**. La ficha de un cliente dado de baja se muestra solo para consulta, con la etiqueta "Inactivo", y no ofrece el botón **Editar**.

## Paso a paso

1. En el menú lateral, abra la sección **Clientes** y haga clic en **Listado de clientes**.
2. En el listado, ubique al cliente y haga clic en **Ver ficha** al final de su fila (o haga clic sobre su DNI).
   📸 Captura: el listado de clientes con la columna "Acciones" visible y el link "Ver ficha" de la fila del cliente elegido.
3. En la ficha, en el recuadro **"Datos de contacto"**, haga clic en el botón **Editar** (ícono de lápiz), arriba a la derecha del recuadro.
   📸 Captura: el recuadro "Datos de contacto" en modo lectura, con nombre, teléfono y email visibles y el botón "Editar" arriba a la derecha.
4. En el formulario que reemplaza al recuadro, verifique el DNI del cliente, que aparece arriba como referencia y no se puede editar.
   📸 Captura: el formulario de edición abierto dentro de la ficha, con el DNI en solo lectura arriba y los campos Nombre, Teléfono y Email editables y precargados con los datos actuales.
5. En el campo **Nombre**, corrija el nombre del cliente (mínimo 2 caracteres).
6. En el campo **Teléfono**, escriba el nuevo teléfono, o borre todo el contenido del campo si quiere quitar el teléfono del cliente.
7. En el campo **Email**, escriba el nuevo email, o borre todo el contenido del campo si quiere quitar el email del cliente.
   📸 Captura: el formulario con los datos ya modificados (por ejemplo, un teléfono nuevo y el email borrado), mostrando el texto de ayuda "Vacío para quitarlo" en el campo vacío.
8. Haga clic en **Guardar cambios**, abajo a la derecha del formulario. Mientras se guarda, el botón muestra "Guardando…".
   📸 Captura: el recuadro "Datos de contacto" de vuelta en modo lectura, mostrando los valores nuevos (y "—" en el dato que se quitó).
9. Si prefiere descartar los cambios, haga clic en **Cancelar**, al lado de "Guardar cambios": el recuadro vuelve a mostrar los datos sin modificar.

## Captura de pantalla

Las capturas se indican debajo de cada paso del "Paso a paso" con el ícono 📸.

## Resultado esperado

- El recuadro **"Datos de contacto"** vuelve al modo lectura y muestra los datos nuevos en el momento, sin tener que recargar la página.
- Si quitó el teléfono o el email, ese dato se muestra como **"—"**.
- El DNI del cliente sigue siendo el mismo.
- Los cambios también se ven en el **Listado de clientes**.
- La modificación queda registrada en la auditoría, con el valor anterior y el nuevo de cada dato cambiado.
- Si hace clic en "Guardar cambios" sin haber modificado nada, el formulario se cierra normalmente y no se registra ningún cambio.

## Errores comunes

| Lo que ve en pantalla | Qué significa | Qué hacer |
|---|---|---|
| **"El nombre es obligatorio"** debajo del campo Nombre | El nombre quedó vacío o tiene un solo carácter. | Escriba el nombre completo (al menos 2 caracteres). |
| **"Email inválido"** debajo del campo Email | El email no tiene un formato válido (por ejemplo `juan@` o `juan.com`). | Corríjalo con el formato `nombre@dominio.com`. Si el cliente no tiene email, deje el campo **vacío**: vacío es válido y quita el dato. |
| No encuentra dónde cambiar el DNI | El DNI no se puede modificar una vez creado el cliente; en el formulario se muestra solo como referencia. | Si el DNI está mal cargado, consulte con el Administrador de CRM. No se corrige desde esta pantalla. |
| No aparece el botón **Editar** en "Datos de contacto" | Su usuario no tiene permiso para editar clientes, o el cliente está dado de baja (la ficha muestra la etiqueta "Inactivo"). | Pida el rol Vendedor o Administrador de CRM. Un cliente dado de baja no se puede editar. |
| Aviso rojo **"Cliente no encontrado o inactivo"** al guardar | Mientras usted editaba, otro usuario dio de baja a este cliente. | Recargue la página: la ficha se mostrará como inactiva y no se podrá editar. |
| Aviso rojo **"No tenés el permiso "clientes:editar""** al guardar | Le quitaron el permiso de edición mientras tenía la pantalla abierta. | Consulte con el administrador del sistema. |
| Aviso rojo **"Sesión requerida"** al guardar | Su sesión se venció. | Vuelva a iniciar sesión y repita la edición. |

---

# Editar datos de contacto desde el listado de clientes

## ¿Qué permite hacer esta pantalla?

Permite corregir el **nombre**, el **teléfono** y el **email** de un cliente directamente desde el listado, en una ventana emergente, sin necesidad de entrar a su ficha. Es la vía más rápida cuando solo hay que actualizar un dato de contacto.

## Requisitos previos

- **Es funcionalmente igual a "Editar datos de contacto desde la ficha del cliente"** (mismos campos, mismas reglas, mismo resultado y mismos errores). La única diferencia es **cómo se abre**: desde el botón **Editar** de la fila del listado, sin entrar a la ficha.
- Los mismos requisitos del documento anterior: rol **Vendedor** o **Administrador de CRM** y cliente dado de alta.
- El listado muestra **solo clientes activos**, así que todo cliente que aparece en él se puede editar.

## Paso a paso

1. En el menú lateral, abra la sección **Clientes** y haga clic en **Listado de clientes**.
2. En la fila del cliente, en la columna **"Acciones"**, haga clic en el botón **Editar** (ícono de lápiz, a la izquierda de "Ver ficha").
   📸 Captura: el listado de clientes con la columna "Acciones" y los botones "Editar" y "Ver ficha" visibles en la fila del cliente.
3. Se abre la ventana **"Editar datos de contacto"**. Verifique el DNI del cliente, que aparece arriba como referencia y no se puede editar.
   📸 Captura: la ventana "Editar datos de contacto" abierta sobre el listado, con el texto "El DNI no se puede modificar.", el DNI en solo lectura y los campos Nombre, Teléfono y Email precargados con los datos de la fila.
4. En la ventana, modifique **Nombre**, **Teléfono** y/o **Email** de la misma forma que en los pasos 5 a 7 del documento anterior (para quitar un teléfono o un email, deje el campo vacío).
5. Haga clic en **Guardar cambios**, abajo a la derecha de la ventana.
   📸 Captura: el listado de clientes con la ventana ya cerrada y la fila del cliente mostrando los datos actualizados.
6. Si prefiere descartar los cambios, haga clic en **Cancelar** o cierre la ventana: no se guarda nada.

## Captura de pantalla

Las capturas se indican debajo de cada paso del "Paso a paso" con el ícono 📸.

## Resultado esperado

- La ventana se cierra sola y la fila del cliente en el listado muestra los datos nuevos, sin recargar la página.
- El resto es idéntico al documento anterior (ver **"Resultado esperado"** de "Editar datos de contacto desde la ficha del cliente"): el DNI no cambia, los datos quitados se muestran como "—" en la ficha y el cambio queda auditado.

## Errores comunes

Son los mismos que en **"Errores comunes"** de "Editar datos de contacto desde la ficha del cliente". Los mensajes aparecen dentro de la ventana, y la ventana **no se cierra** hasta que se guarda correctamente o se cancela. Lo único propio de este punto de entrada:

| Lo que ve en pantalla | Qué significa | Qué hacer |
|---|---|---|
| No aparece el botón **Editar** en la columna "Acciones" (solo "Ver ficha") | Su usuario puede consultar clientes pero no editarlos. | Pida el rol Vendedor o Administrador de CRM. |
| El cliente no aparece en el listado | El listado muestra solo clientes activos; si fue dado de baja, no figura ahí. | Un cliente dado de baja no se puede editar. |

---

# Editar una dirección del cliente

## ¿Qué permite hacer esta pantalla?

Permite corregir una dirección ya cargada de un cliente: su **rótulo** (por ejemplo "Casa" o "Depósito"), su **tipo** (Facturación o Envío) y la **dirección** en sí. La edición se hace sobre la misma fila de la dirección, en la ficha del cliente. El sistema cuida una regla: **un cliente con direcciones de envío siempre tiene que conservar al menos una dirección de facturación**. Por eso no deja pasar a "Envío" la única dirección de facturación que tiene el cliente.

## Requisitos previos

- Estar autenticado con un usuario de rol **Vendedor** o **Administrador de CRM** (permiso de edición de clientes).
- Que el cliente esté dado de alta y **activo**. En la ficha de un cliente dado de baja las direcciones se ven, pero no se pueden editar.
- Que el cliente tenga **al menos una dirección cargada**. Si no tiene ninguna, primero hay que agregarla desde el recuadro "Agregar dirección" de la misma ficha.
- Esta pantalla **no permite eliminar** una dirección: solo modificarla.

## Paso a paso

1. En el menú lateral, abra la sección **Clientes** y haga clic en **Listado de clientes**.
2. En el listado, haga clic en **Ver ficha** al final de la fila del cliente.
3. En la ficha, busque el recuadro **"Direcciones registradas"**, donde cada dirección aparece con su rótulo, una etiqueta de tipo (Facturación / Envío) y la dirección completa.
   📸 Captura: el recuadro "Direcciones registradas" con al menos dos direcciones, una con etiqueta "Facturación" y otra con etiqueta "Envío", y el botón "Editar" visible a la derecha de cada una.
4. En la fila de la dirección que quiere corregir, haga clic en el botón **Editar** (ícono de lápiz), a la derecha del rótulo.
   📸 Captura: la fila de la dirección convertida en formulario, con los campos Rótulo, Tipo (desplegable) y Dirección precargados con los valores actuales, y los botones "Cancelar" y "Guardar".
5. En el campo **Rótulo**, corrija el nombre con el que se identifica la dirección (por ejemplo "Casa", "Depósito").
6. En el desplegable **Tipo**, elija **Facturación** o **Envío**.
   📸 Captura: el desplegable "Tipo" abierto mostrando las opciones "Facturación" y "Envío".
7. En el campo **Dirección**, corrija la dirección completa (por ejemplo "Av. Siempreviva 742").
8. Haga clic en **Guardar**, abajo a la derecha de la fila. Mientras se guarda, el botón muestra "Guardando…".
   📸 Captura: el recuadro "Direcciones registradas" con la fila ya guardada, mostrando el rótulo, la etiqueta de tipo y la dirección actualizados.
9. Si prefiere descartar los cambios, haga clic en **Cancelar**, al lado de "Guardar": la fila vuelve a mostrar la dirección sin modificar.

## Captura de pantalla

Las capturas se indican debajo de cada paso del "Paso a paso" con el ícono 📸. Captura adicional para el error principal de esta pantalla:

📸 Captura: la fila en modo edición con el aviso rojo "Debe existir al menos una dirección de tipo FACTURACION antes de registrar una dirección de envío", tras intentar pasar a "Envío" la única dirección de facturación del cliente.

## Resultado esperado

- La fila vuelve a su vista normal y muestra el rótulo, la etiqueta de tipo y la dirección nuevos, sin recargar la página.
- Si cambió el tipo, la etiqueta pasa de "Facturación" a "Envío" (o al revés).
- El cambio queda registrado en la auditoría, con el valor anterior y el nuevo de cada dato modificado.
- Si hace clic en "Guardar" sin haber cambiado nada, la fila se cierra normalmente y no se registra ningún cambio.

## Errores comunes

| Lo que ve en pantalla | Qué significa | Qué hacer |
|---|---|---|
| Aviso rojo **"Debe existir al menos una dirección de tipo FACTURACION antes de registrar una dirección de envío"** al guardar | Intentó pasar a **Envío** la única dirección de **Facturación** del cliente. Si se permitiera, el cliente quedaría sin dirección de facturación. No se guardó ningún cambio. | Primero pase otra dirección del cliente a **Facturación** (o agregue una nueva de Facturación desde "Agregar dirección"). Después vuelva a editar esta y pásela a Envío. |
| **"El rótulo es obligatorio (ej. 'Casa', 'Depósito')"** debajo del campo Rótulo | El rótulo quedó vacío. | Escriba un nombre para identificar la dirección. |
| **"La dirección es obligatoria"** debajo del campo Dirección | La dirección quedó vacía o es demasiado corta (menos de 5 caracteres). | Escriba la dirección completa. |
| No aparece el botón **Editar** en las direcciones | Su usuario no tiene permiso para editar clientes, o el cliente está dado de baja. | Pida el rol Vendedor o Administrador de CRM. Las direcciones de un cliente dado de baja no se pueden editar. |
| No aparece el botón **Editar** en una dirección puntual, marcada como "Inactiva" | Esa dirección está inactiva y no se puede modificar. | Solo se editan direcciones activas. |
| Aviso rojo **"Dirección no encontrada para este cliente"** al guardar | La dirección dejó de estar disponible mientras usted la editaba. | Recargue la página y verifique las direcciones vigentes del cliente. |
| Aviso rojo **"Cliente no encontrado o inactivo"** al guardar | Mientras usted editaba, otro usuario dio de baja a este cliente. | Recargue la página: la ficha se mostrará como inactiva y no se podrá editar. |
| Aviso rojo **"No tenés el permiso "clientes:editar""** al guardar | Le quitaron el permiso de edición mientras tenía la pantalla abierta. | Consulte con el administrador del sistema. |
| No encuentra cómo borrar una dirección | Esta pantalla solo permite modificar direcciones, no eliminarlas. | Si una dirección ya no se usa, corrija sus datos. La baja de direcciones no está disponible por ahora. |
