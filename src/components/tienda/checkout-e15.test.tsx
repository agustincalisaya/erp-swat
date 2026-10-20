/**
 * HU-E15 — componentes de la tienda (docs/modulos/modulo E/HU15_TASKS.md).
 * Asserts sobre la fuente (mismo molde que `cancelar-pedido-web.test.ts`): los
 * componentes de la tienda importan CSS modules y el router de Next, que Node
 * no puede cargar fuera del bundler. El render real se cubre en las suites
 * HTTP de integración (T07).
 *
 *   node --import tsx --test src/components/tienda/checkout-e15.test.tsx
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const fuenteCarrito = readFileSync(new URL("./CarritoCliente.tsx", import.meta.url), "utf8");
const fuentePaginaCarrito = readFileSync(new URL("../../app/(tienda)/tienda/carrito/page.tsx", import.meta.url), "utf8");

// ── T02 — E15-1: texto del botón del carrito ─────────────────────────────────

test("E15-1 — con sesión vinculada el botón dice «Proceder al pago»; visitante «Ingresar para comprar»", () => {
  assert.match(fuenteCarrito, /conSesion \? "Proceder al pago" : "Ingresar para comprar"/);
  assert.doesNotMatch(fuenteCarrito, /"Iniciar compra"/);
});

test("E15-1 — cuenta pendiente (compraBloqueada): no se renderiza ninguna acción de compra", () => {
  assert.match(fuenteCarrito, /\{!compraBloqueada && \(\s*<Button className=\{styles\.primaryAction\}/);
});

test("E15-1 — el checkout sigue enviando solo el cupón (body del POST sin cambios)", () => {
  assert.match(fuenteCarrito, /fetch\("\/api\/tienda\/checkout", \{\s*method: "POST"/);
  assert.match(fuenteCarrito, /body: JSON\.stringify\(cupon \? \{ cupon_codigo: cupon \} : \{\}\)/);
  assert.doesNotMatch(fuenteCarrito, /medio_pago|total:\s*carrito/);
});

// ── T02 — E15-2: aviso del plazo en minutos ──────────────────────────────────

const aviso = fuenteCarrito.slice(
  fuenteCarrito.indexOf("export function AvisoPlazoReserva"),
  fuenteCarrito.indexOf("export function CarritoCliente"),
);

test("E15-2 — con plazo: informa los minutos, que se descuenta disponibilidad y que se libera sin pago", () => {
  assert.ok(aviso.length > 0, "AvisoPlazoReserva existe antes de CarritoCliente");
  assert.match(aviso, /durante \$\{minutos\} minutos/);
  assert.match(aviso, /deja de estar disponible para otros compradores/);
  assert.match(aviso, /Si el pago no se confirma en ese plazo, la reserva se libera/);
});

test("E15-2/D2 — sin plazo (configuración inválida o ausente): texto genérico sin número ni default", () => {
  assert.match(aviso, /minutos === null\s*\?\s*"Al iniciar la compra reservamos el stock por un tiempo limitado mientras completás el pago\."/);
  assert.doesNotMatch(aviso, /\?\?\s*\d|minutos \|\| \d|= \d+\s*[,;)]/, "sin valor por defecto numérico");
});

test("E15-2 — el componente nunca expone la clave de configuración ni horas", () => {
  assert.doesNotMatch(aviso, /hora/i);
  assert.doesNotMatch(fuenteCarrito, /ECOMMERCE_CHECKOUT_TTL_HORAS|obtenerTtlCheckoutHoras/);
});

test("E15-2/P3 — la cuenta pendiente conserva el texto genérico", () => {
  assert.match(fuenteCarrito, /<AvisoPlazoReserva minutos=\{compraBloqueada \? null : plazoReservaMinutos\} \/>/);
});

// ── T04 — E15-3: selector informativo de medio de pago ──────────────────────

const fuenteSelector = readFileSync(new URL("./SelectorMedioPagoInformativo.tsx", import.meta.url), "utf8");
const fuenteVista = () => readFileSync(new URL("../../app/(tienda)/tienda/checkout/CheckoutPendienteVista.tsx", import.meta.url), "utf8");

test("E15-3 — una única opción, marcada: Mercado Pago, con la aclaración de tarjetas", () => {
  assert.equal(fuenteSelector.match(/<input /g)?.length, 1, "una sola opción");
  assert.match(fuenteSelector, /<input type="radio" name="medio_pago_informativo" value="MERCADO_PAGO" checked readOnly \/>/);
  assert.match(fuenteSelector, /<strong>Mercado Pago<\/strong>/);
  assert.match(fuenteSelector, /Incluye tarjeta de crédito y débito dentro del checkout de Mercado Pago\./);
});

test("E15-3 — accesible: fieldset + legend + label que envuelve el control", () => {
  assert.match(fuenteSelector, /<fieldset[^>]*>\s*<legend[^>]*>Medio de pago<\/legend>/);
  assert.match(fuenteSelector, /<label className=\{styles\.paymentMethod\}>\s*<input /);
});

test("E15-3 — solo visual: sin formulario, sin handlers, sin red ni Server Actions", () => {
  const codigo = fuenteSelector.replace(/\/\*\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(codigo, /<form|action=|onChange|onClick|fetch\(|"use client"|"use server"/);
});

test("E15-3 — en la vista solo aparece con la reserva vigente (no en vencida ni en no encontrada)", () => {
  const vista = fuenteVista();
  const usos = vista.match(/<SelectorMedioPagoInformativo \/>/g) ?? [];
  assert.equal(usos.length, 1);
  const inicioVigente = vista.lastIndexOf("return (");
  assert.ok(vista.indexOf('if (pedido.estado_visible === "RESERVA_VENCIDA")') < inicioVigente);
  assert.ok(vista.indexOf("<SelectorMedioPagoInformativo />") > inicioVigente, "dentro del último return (reserva vigente)");
});

// ── T05 — E15-4/E15-5: diálogo de confirmación (D4, D4.1) ───────────────────

const fuenteDialogo = readFileSync(new URL("./ConfirmarPagoDialog.tsx", import.meta.url), "utf8");
/** Código sin comentarios, para no confundir la documentación con el comportamiento. */
const codigoDialogo = fuenteDialogo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

test("E15-4 — usa el Dialog del proyecto, controlado", () => {
  assert.match(codigoDialogo, /from "@\/components\/ui\/dialog"/);
  assert.match(codigoDialogo, /<Dialog open=\{abierto\} onOpenChange=\{cambiarApertura\}>/);
});

test("E15-4/E15-5 — muestra el total recibido (servidor), Mercado Pago y los minutos restantes", () => {
  assert.match(codigoDialogo, /\{formatearPrecio\(total\)\}/);
  assert.match(codigoDialogo, /<dd className="font-medium">Mercado Pago<\/dd>/);
  assert.match(codigoDialogo, /minutosRestantesReserva\(new Date\(ttlExpiracion\), new Date\(\)\)/);
  assert.doesNotMatch(codigoDialogo, /precio_unitario|subtotal|reduce\(|cantidad \*/, "el total nunca se recalcula en el cliente");
});

test("E15-4 — minutos calculados al abrir y refrescados solo mientras está abierto, con limpieza", () => {
  assert.match(codigoDialogo, /if \(nuevoEstado\) \{\s*recalcular\(\);\s*setAbierto\(true\);/);
  assert.match(codigoDialogo, /if \(!abierto\) return;\s*const intervalo = window\.setInterval\(recalcular, REFRESCO_MINUTOS_MS\);\s*return \(\) => window\.clearInterval\(intervalo\);/);
  assert.match(codigoDialogo, /useState<number \| null>\(null\)/, "sin cálculo de reloj en el render del servidor");
});

test("E15-4 — «Continuar» navega al checkout_url recibido; «Volver» solo cierra", () => {
  assert.match(codigoDialogo, /onClick=\{\(\) => window\.location\.assign\(checkoutUrl\)\}>\s*Continuar/);
  assert.match(codigoDialogo, /onClick=\{\(\) => cambiarApertura\(false\)\}>\s*Volver\s*</);
});

test("E15-4/I5 — sin red ni mutación: ni fetch, ni POST, ni Server Actions, ni creación de preferencia", () => {
  assert.doesNotMatch(codigoDialogo, /fetch\(|method:|"use server"|obtenerOCrearPreferencia|iniciarCobro|\/api\//);
});

test("D4.1 — router.refresh() una sola vez y solo al cerrar en estado vencido", () => {
  assert.equal(codigoDialogo.match(/router\.refresh\(\)/g)?.length, 1);
  assert.match(codigoDialogo, /setAbierto\(false\);\s*if \(vencida\) router\.refresh\(\);/);
  assert.match(codigoDialogo, /const vencida = minutos !== null && minutos <= 0;/);
});

test("D4.1 — vencida: sin «Continuar», mensaje de reserva vencida y «Volver al catálogo»", () => {
  const ramaVencida = codigoDialogo.slice(codigoDialogo.indexOf("{vencida ? ("), codigoDialogo.indexOf(") : ("));
  assert.ok(ramaVencida.length > 0);
  assert.doesNotMatch(ramaVencida, /Continuar|checkoutUrl/);
  assert.match(ramaVencida, /Reserva vencida/);
  assert.match(ramaVencida, /los artículos volvieron a estar\s+disponibles/);
  assert.match(ramaVencida, /<Link href="\/tienda\/catalogo"[^>]*>\s*Volver al catálogo/);
});

test("E15-4 — la vista vigente usa el diálogo con datos del servidor y ya no el enlace directo", () => {
  const vista = fuenteVista();
  assert.match(vista, /<ConfirmarPagoDialog total=\{pedido\.total\} ttlExpiracion=\{pedido\.ttl_expiracion\} checkoutUrl=\{checkoutUrl\} \/>/);
  assert.doesNotMatch(vista, /<a href=\{checkoutUrl\}/);
});

// ── T06 — E15-6 / E15-7: enlace ausente y reserva vencida en la vista ───────

const ramaVista = (desde: string, hasta: string) => {
  const vista = fuenteVista();
  return vista.slice(vista.indexOf(desde), vista.indexOf(hasta, vista.indexOf(desde) + desde.length));
};

test("E15-6 — sin checkout_url: aviso de reintento de HU-E2 intacto y sin disparador del diálogo", () => {
  const ramaSinUrl = ramaVista(") : (", "</Alert>");
  assert.match(ramaSinUrl, /<AlertTitle>No pudimos conectar con Mercado Pago<\/AlertTitle>/);
  assert.match(ramaSinUrl, /Tu reserva sigue vigente\. <Link href=\{`\/tienda\/checkout\/pendiente\?pedido=\$\{pedido\.pedido_venta_id\}`\}>Reintentá<\/Link>/);
  assert.doesNotMatch(ramaSinUrl, /ConfirmarPagoDialog|Continuar/);
  assert.match(fuenteVista(), /\{checkoutUrl \? \(\s*<div className=\{styles\.stateActions\}>/);
});

test("E15-6 — el reintento sigue siendo recargar la página (E2): la vista no crea preferencias", () => {
  assert.doesNotMatch(fuenteVista(), /obtenerOCrearPreferencia|fetch\(|"use client"/);
});

test("E15-7 — vencida: explica la liberación, ofrece volver al catálogo; sin selector, diálogo ni pago", () => {
  const ramaVencida = ramaVista('if (pedido.estado_visible === "RESERVA_VENCIDA")', "</section></div>");
  assert.match(ramaVencida, /<h1 className=\{styles\.stateTitle\}>Reserva vencida<\/h1>/);
  assert.match(ramaVencida, /los artículos volvieron a estar\s+disponibles\. Podés armar el carrito de nuevo e iniciar otra compra\./);
  assert.match(ramaVencida, /\{volverAlCatalogo\}/);
  assert.doesNotMatch(ramaVencida, /SelectorMedioPagoInformativo|ConfirmarPagoDialog|checkoutUrl|Mercado Pago/);
});

test("E15-7 — la página llega al bloque vencido antes del job (TTL) y después (lectura acotada T03)", () => {
  const pagina = readFileSync(new URL("../../app/(tienda)/tienda/checkout/pendiente/page.tsx", import.meta.url), "utf8");
  assert.match(pagina, /pedido = await obtenerPedidoWebVencidoPorTtl\(pedidoId\.data, sesion\.clienteId, await obtenerUsuarioCanalWebId\(\)\);/);
  assert.match(pagina, /if \(pedido\.estado_visible === "RESERVA_VENCIDA"\) \{\s*return <CheckoutPendienteVista pedido=\{pedido\} vencimiento=\{vencimiento\} checkoutUrl=\{null\} \/>;/);
  // La lectura acotada corre DESPUÉS de las lecturas E1/E2 y del redirect a resultado.
  assert.ok(pagina.indexOf("obtenerResultadoPago(pedidoId.data") < pagina.indexOf("obtenerPedidoWebVencidoPorTtl(pedidoId.data"));
});

test("E15-2/P1 — la página lee los minutos en el servidor y no amplía CarritoVista", () => {
  assert.match(fuentePaginaCarrito, /obtenerPlazoReservaCheckoutMinutos\(\)/);
  assert.match(fuentePaginaCarrito, /plazoReservaMinutos=\{plazoReservaMinutos\}/);
  assert.doesNotMatch(fuentePaginaCarrito, /obtenerTtlCheckoutHoras|ECOMMERCE_CHECKOUT_TTL_HORAS/);
});
