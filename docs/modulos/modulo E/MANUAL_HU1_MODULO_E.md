# Comprar en la tienda web: catálogo y carrito

## ¿Qué permite hacer esta pantalla?

Permite recorrer el **catálogo** de la tienda online de SWAT Indumentarias y armar una compra para retirar en la Sucursal Salta. En el catálogo se ve el **precio actual** de cada producto y cuántas unidades hay **disponibles en este momento**: si un artículo se agota en el local, la tienda lo muestra agotado en cuanto se vuelve a cargar la página.

El cliente puede elegir talle y color, agregar productos al **carrito**, cambiar cantidades o quitarlos. El carrito se puede armar **sin haber ingresado** con una cuenta. Cuando ingresa, lo que había armado se **suma** al carrito de su cuenta, y ese carrito queda guardado: lo encuentra igual si entra desde otro celular o computadora.

Al hacer clic en **Iniciar compra**, la tienda **reserva los productos** a nombre del cliente por un **tiempo limitado**, para que nadie más se los lleve mientras paga. Si el pago no se confirma antes de la hora límite, la reserva vence y los productos vuelven a estar a la venta.

El **pago online no forma parte de esta pantalla**: este manual llega hasta la pantalla de pago pendiente. Cómo pagar con Mercado Pago se explica en su propio manual.

## Requisitos previos

- Para **ver el catálogo y armar el carrito** no hace falta tener cuenta.
- Para **iniciar la compra** hace falta ingresar con una **cuenta de Cliente Web habilitada**. Una cuenta que todavía está pendiente de validación de identidad en sucursal puede armar el carrito, pero no comprar.
- Cómo se llega: abriendo en el navegador la dirección **/tienda/catalogo** de la tienda (por ejemplo `http://localhost:3000/tienda/catalogo`). En cualquier pantalla de la tienda, el logo **"SWAT Tienda"** arriba a la izquierda también lleva al catálogo.

## Paso a paso

1. Entre a la tienda en **/tienda/catalogo**. Verá la página **"Catálogo"** con los productos publicados, su foto, su nombre y el precio ("desde …"). Puede usar **Buscar productos** y los filtros, y luego **Buscar** o **Aplicar filtros**.
2. Haga clic sobre el producto que le interesa para abrir su ficha, con fotos, descripción y precio.
3. En la lista **Variante**, elija la combinación de modelo, color, talle y género. Debajo del precio verá cuántas unidades quedan (por ejemplo "3 disponibles").
4. En **Cantidad**, indique cuántas unidades quiere y haga clic en **Agregar al carrito**. Aparece el aviso **"Agregado al carrito"** y el ícono del carrito, arriba a la derecha, muestra la cantidad de artículos.
5. Haga clic en el ícono del carrito, arriba a la derecha, para abrir **"Tu carrito"**. Para cambiar una cantidad, escriba el número nuevo en la casilla del artículo y haga clic fuera de ella; para sacar un artículo, haga clic en **Quitar**. El **Total** se actualiza solo.
6. Si no ingresó con su cuenta, haga clic en **Ingresar para comprar** (o en **Ingresar**, arriba a la derecha). Escriba su **Email** y su **Contraseña** y haga clic en **Ingresar**. Vuelve al carrito, y lo que había armado sin cuenta se suma a lo que ya tenía guardado en su cuenta (si un mismo artículo estaba en los dos, se suman las cantidades).
7. Revise el carrito y haga clic en **Iniciar compra**. Si tiene un cupón, puede escribirlo antes en la casilla **"Código de cupón (opcional)"**.
8. Se abre la pantalla **"Reservamos tu compra"**, con el número de pedido, el total y la **hora hasta la que se mantienen reservados** los artículos.

## Capturas de pantalla del paso a paso:

[Insertar las capturas en el mismo orden que los pasos.]

## Resultado esperado

- Se muestra la pantalla **"Reservamos tu compra"** con el aviso **"Pedido [número] — Pago pendiente"**.
- El aviso indica el **total** y la **hora límite** de la reserva: "Los artículos quedan reservados hasta las [hora]. Si el pago no se confirma antes, la reserva vence y el stock vuelve a estar disponible."
- El **carrito queda vacío**: al abrirlo se ve "Tu carrito está vacío." y el ícono del carrito ya no muestra artículos.
- Las unidades reservadas dejan de figurar como disponibles en la tienda hasta que pague o venza la reserva.
- Si después arma otro carrito e inicia otra compra, se crea **un pedido nuevo**, aparte del anterior.

## Errores comunes

| Lo que ve en pantalla | Qué significa | Qué hacer |
|---|---|---|
| En la ficha del producto, la variante figura con **"— agotado"**, debajo del precio dice **"Agotado"** y el botón dice **"Agotado"** y no se puede presionar. En el catálogo, el producto muestra la etiqueta **"Agotado"**. | No quedan unidades de esa variante (o de ningún talle/color del producto) para la tienda online. | Elija otra variante en la lista **Variante**, o vuelva a consultar más tarde. |
| En el catálogo, la etiqueta **"No disponible para la compra"**. En la ficha, la variante figura con **"— no disponible"**, aparece **"Sin precio disponible"** y **"Este artículo no está disponible para la compra online."**, y el botón **Agregar al carrito** no se puede presionar. | El producto se puede ver pero hoy no se vende online (por ejemplo, todavía no tiene precio). | No es un error suyo. Elija otro producto o consulte en la sucursal. |
| Al hacer clic en **Ingresar para comprar** lo lleva a la pantalla **"Ingresar"**: "Ingresá con tu cuenta de la tienda para completar tu compra." | Para iniciar la compra hay que ingresar con una cuenta. | Ingrese con su email y contraseña: vuelve al carrito con sus artículos y puede hacer clic en **Iniciar compra**. Si no tiene cuenta, use **Crear cuenta**. |
| En el carrito, un artículo aparece remarcado con un aviso como **"Este artículo fue discontinuado. Quitalo para poder continuar."** (también puede decir "Este producto ya no se comercializa", "Este artículo no está disponible en la tienda online", "Este artículo no está publicado en la tienda online" o "Este artículo no tiene un precio vigente"). Al hacer clic en **Iniciar compra** aparece **"No pudimos iniciar la compra"** — **"Uno o más artículos del carrito ya no están disponibles"**, con el código de cada artículo afectado y el motivo. | Ese artículo dejó de venderse online después de que lo agregó. La compra queda **bloqueada** mientras siga en el carrito; no se reservó nada. También recibe un aviso en su cuenta. | Haga clic en **Quitar** en el artículo señalado y vuelva a hacer clic en **Iniciar compra**. |
| Al agregar al carrito o al cambiar una cantidad: **"No hay stock suficiente para la cantidad solicitada"**. | Pidió más unidades de las que quedan (contando las que ya tenía en el carrito). | Baje la cantidad. La ficha del producto muestra cuántas unidades quedan disponibles. |
| En el carrito, un artículo muestra **"Solo quedan [N] disponibles."** o **"Agotado."**. Al hacer clic en **Iniciar compra**: **"No pudimos iniciar la compra"** — **"No hay stock suficiente para uno o más artículos"**, con el código del artículo y "— disponibles: [N]". | Mientras tenía el carrito armado, otras personas compraron esas unidades. No se reservó nada. | Baje la cantidad a lo que queda disponible, o quite el artículo, y vuelva a hacer clic en **Iniciar compra**. |
| En la pantalla **"Ingresar"**: **"Email o contraseña incorrectos"**. | El email o la contraseña no coinciden, o la cuenta no está habilitada. | Revise lo que escribió e intente de nuevo. Si no recuerda la contraseña, use **Recuperar acceso**. |
| En la pantalla **"Ingresar"**: **"La cuenta está bloqueada temporalmente por intentos fallidos; la recuperación es presencial en sucursal"**. | Hubo demasiados intentos fallidos de ingreso. | Espere un rato antes de volver a intentar, o acérquese a la sucursal. |
| Al ingresar lo lleva a **"Mi cuenta"** con **"Cuenta pendiente de validación"**; en el carrito se ve **"Tu cuenta está pendiente de validación de identidad en sucursal."** y no aparece el botón **Iniciar compra**. | Su cuenta todavía no fue habilitada: falta validar su identidad en la sucursal. | Acérquese a la Sucursal Salta para validar su identidad. Mientras tanto puede seguir armando el carrito. |
| En el carrito: **"Tu carrito está vacío."** con el botón **Ver catálogo**, y no aparece **Iniciar compra**. | No hay artículos en el carrito (por ejemplo, porque ya inició la compra y el carrito se vació). | Haga clic en **Ver catálogo** y agregue productos. |
| **"No pudimos iniciar la compra"** — **"Ya hay una compra en curso para tu carrito; reintentá en unos segundos"**. | Se hizo clic en **Iniciar compra** dos veces muy seguidas (o desde dos pantallas a la vez). | Espere unos segundos y vuelva a intentar. No se duplica el pedido. |
| Pantalla **"Reserva vencida"**: **"Pedido [número] — Reserva vencida"** — "El pago no se confirmó antes de las [hora]: la reserva venció y los artículos volvieron a estar disponibles. Podés armar el carrito de nuevo e iniciar otra compra." | Pasó la hora límite sin que se confirmara el pago. Los productos ya no están reservados a su nombre. | Haga clic en **Volver al catálogo**, arme el carrito de nuevo y haga clic en **Iniciar compra**. |
