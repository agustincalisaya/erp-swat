# HU-C6 — Dar de baja a un cliente

**Rol:** Administrador de CRM

## ¿Qué permite hacer esta pantalla?

Permite dar de baja a un cliente que ya no debe operar con la empresa: por ejemplo, un cliente duplicado por error de carga o un cliente que dejó de comprar. La baja **no borra al cliente**. Lo deja **inactivo**: desde ese momento no puede usarse para nuevos presupuestos, ventas ni movimientos de cuenta corriente, pero su ficha y todo su historial de compras se conservan y se pueden seguir consultando. Así el listado de clientes muestra solo a los que operan, sin perder la información del pasado. Cada baja exige indicar un **motivo**, que queda visible en la ficha y registrado en la auditoría del sistema.

## Requisitos previos

- Estar autenticado con un usuario de rol **Administrador de CRM**. Es el único rol que puede dar de baja clientes.
- Que el cliente que se quiere dar de baja exista en el sistema y esté **activo** (que figure en el Listado de clientes).
- Tener claro el **motivo** de la baja (por ejemplo, "Cliente duplicado por error de carga"). Es obligatorio.
- Tener en cuenta que la baja **no se puede deshacer** desde esta pantalla.

## Paso a paso

1. En el menú lateral, abra la sección **Clientes** y haga clic en **Listado de clientes**.
2. En el listado, ubique al cliente y haga clic en **Ver ficha** al final de su fila (o haga clic sobre su DNI).
3. En la ficha del cliente, en el recuadro **"Datos de contacto"**, haga clic en el botón **Dar de baja** (ícono de papelera), que está arriba a la derecha del recuadro, al lado del botón "Editar".
4. Se abre la ventana **"Dar de baja a [nombre del cliente]"**. Lea el aviso: explica que el cliente dejará de poder operar, que su ficha y su historial se conservan, y que la baja no puede deshacerse desde ahí. El botón **Confirmar baja** aparece deshabilitado hasta que escriba un motivo.
5. En el campo **"Motivo de la baja"**, escriba por qué se da de baja al cliente (por ejemplo, "Cliente duplicado por error de carga").
6. Haga clic en **Confirmar baja**. Mientras se procesa, el botón muestra "Dando de baja…".
7. La ventana se cierra y la ficha del cliente se actualiza sola. Verifique que junto al DNI aparece la etiqueta **"Inactivo"** y, debajo del encabezado, el aviso rojo con el motivo de la baja.
8. En el menú lateral, vuelva a **Clientes → Listado de clientes** y verifique que el cliente ya no aparece en el listado.

> Si abrió la ventana por error, haga clic en **Volver**: la ventana se cierra y no se da de baja al cliente.

## Captura de pantalla de paso a paso

- **Captura 1:** el menú lateral con la sección **Clientes** desplegada y la opción **"Listado de clientes"** visible.
- **Captura 2:** el Listado de clientes con el cliente que se va a dar de baja visible en su fila, junto con el link **"Ver ficha"** de la columna "Acciones".
- **Captura 3:** el encabezado de la ficha del cliente **activo** (nombre y DNI, sin la etiqueta "Inactivo") y el recuadro **"Datos de contacto"** con los botones **"Editar"** y **"Dar de baja"** (con su ícono de papelera) visibles arriba a la derecha, antes de hacer clic.
- **Captura 4:** la ventana **"Dar de baja a [nombre del cliente]"** recién abierta, con el título en rojo, el texto explicativo completo, el campo **"Motivo de la baja"** vacío (con el ejemplo en gris "Ej: Cliente duplicado por error de carga."), la aclaración "Campo obligatorio — no se puede dar de baja sin un motivo." y el botón **"Confirmar baja" deshabilitado** (atenuado), junto al botón "Volver".
- **Captura 5:** la misma ventana con el **motivo ya escrito** en el campo y el botón **"Confirmar baja" habilitado** (en rojo intenso).
- **Captura 6:** la ventana en el momento de confirmar, con el botón mostrando **"Dando de baja…"** (opcional, dura muy poco).
- **Captura 7:** la ficha del cliente después de la baja: etiqueta roja **"Inactivo"** junto al DNI; aviso rojo "Este cliente está dado de baja y no puede operar. Su ficha y su historial se conservan en solo lectura." con el **Motivo** escrito en el paso 5; el recuadro "Datos de contacto" **sin** los botones "Editar" ni "Dar de baja"; la sección de direcciones sin el formulario "Agregar dirección"; y el recuadro "Preferencias comerciales" en modo lectura.
- **Captura 8:** el Listado de clientes (recuadro "Clientes activos") en el que **ya no figura** el cliente dado de baja.

## Resultado esperado

- En la ficha del cliente aparece la etiqueta roja **"Inactivo"** junto al DNI.
- Debajo del encabezado se muestra el aviso **"Este cliente está dado de baja y no puede operar. Su ficha y su historial se conservan en solo lectura."**, seguido del **motivo** que se escribió al dar la baja.
- Toda la ficha queda en **solo lectura**: los datos de contacto, las direcciones, el canal de contacto, el segmento y los consentimientos se pueden consultar, pero ya no se ofrecen botones para editarlos ni para agregar direcciones. El botón "Dar de baja" también desaparece.
- El cliente **ya no aparece en el Listado de clientes**, que muestra solo a los clientes activos.
- El cliente no se borra: su información y su historial se conservan, y la baja queda registrada en la auditoría del sistema con el usuario que la hizo, la fecha y el motivo.

## Errores comunes

| Lo que ve en pantalla | Qué significa | Qué hacer |
|---|---|---|
| El botón **Confirmar baja** está deshabilitado y no se puede hacer clic | Todavía no escribió un motivo, o solo escribió espacios en blanco. El motivo es obligatorio. | Escriba el motivo de la baja en el campo "Motivo de la baja"; el botón se habilita solo. |
| Aviso rojo **"Cliente no encontrado o ya dado de baja"** dentro de la ventana, al confirmar | Otro Administrador de CRM dio de baja a este mismo cliente mientras usted tenía la ventana abierta. La baja ya estaba hecha; no se registró una segunda. | Haga clic en **Volver** y recargue la página: la ficha mostrará al cliente como "Inactivo", con el motivo que cargó el otro Administrador. |
| No aparece el botón **Dar de baja** en la ficha | Su usuario no es Administrador de CRM. Por ejemplo, un **Vendedor** puede consultar y editar clientes, pero **no** darlos de baja, así que nunca ve este botón. | Si corresponde dar de baja al cliente, pídaselo a un Administrador de CRM. |
| No aparece el botón **Dar de baja** y la ficha muestra la etiqueta "Inactivo" | El cliente ya está dado de baja. | No hace falta hacer nada: la baja ya está registrada y el motivo se ve en el aviso rojo de la ficha. |
| No encuentra al cliente en el Listado de clientes | El listado muestra solo clientes activos; un cliente dado de baja no figura ahí. | Es el comportamiento esperado después de una baja. |
| Quiere reactivar a un cliente dado de baja | La baja no se puede deshacer desde esta pantalla. | Consulte con el administrador del sistema. |
