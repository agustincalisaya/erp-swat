import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Tests source-regex sobre `pedido-venta.service.ts` (mismo patrón que
 * `presupuesto.service.test.ts` — sin mock de prisma, el archivo no puede
 * importarse en Node por `import "server-only"`). Verifican el CONTRATO del
 * servicio a nivel de código fuente; la verificación de comportamiento real
 * contra una base vive en `pedido-venta.integration.test.ts` (opt-in).
 */

const fuente = readFileSync(new URL("./pedido-venta.service.ts", import.meta.url), "utf8");

const sliceAutorizar = fuente.slice(
  fuente.indexOf("export async function autorizarOverrideDescuento"),
  fuente.indexOf(
    "// ──",
    fuente.indexOf("export async function autorizarOverrideDescuento") + 10,
  ),
);

// ── Permisos (contrato compartido con el seed y las rutas) ──────────────────

test("los permisos exportados coinciden literalmente con los códigos sembrados en el seed", () => {
  assert.match(fuente, /PERMISO_VENTAS_APLICAR_DESCUENTO_MARGEN = "ventas:aplicar_descuento_margen"/);
  assert.match(fuente, /PERMISO_VENTAS_AUTORIZAR_EXCEPCION_DESCUENTO = "ventas:autorizar_excepcion_descuento"/);

  const seed = readFileSync(new URL("../../../../prisma/seed.ts", import.meta.url), "utf8");
  assert.match(seed, /"ventas:aplicar_descuento_margen"/);
  assert.match(seed, /"ventas:autorizar_excepcion_descuento"/);
});

test("la ruta de override-descuento queda gateada por un ÚNICO withPermission, con ventas:aplicar_descuento_margen", () => {
  const ruta = readFileSync(
    new URL("../../../app/api/ventas/[id]/override-descuento/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(ruta, /export const POST = withPermission\(\s*\n\s*PERMISO_VENTAS_APLICAR_DESCUENTO_MARGEN/);
  // Nunca un segundo gate de permiso invocado en el Route Handler — la
  // validación de autorización vive en el servicio (docs/tasks/HU-B4.md §1.3).
  const invocaciones = ruta.match(/withPermission\(\s*\n/g) ?? [];
  assert.equal(invocaciones.length, 1);
});

// ── autorizarOverrideDescuento() — orden de validaciones (spec §2.4) ────────

test("valida PedidoVenta antes que el ítem, y el ítem antes que el permiso del Supervisor", () => {
  const idxPedido = sliceAutorizar.indexOf("PEDIDO_VENTA_NO_ENCONTRADO");
  const idxItem = sliceAutorizar.indexOf("El pedido no tiene ningún ítem pendiente");
  const idxSupervisor = sliceAutorizar.indexOf("SIN_PERMISO_AUTORIZACION");
  assert.ok(idxPedido > -1 && idxItem > -1 && idxSupervisor > -1);
  assert.ok(idxPedido < idxItem);
  assert.ok(idxItem < idxSupervisor);
});

test("rechaza un ítem ya autorizado con TRANSICION_INVALIDA (mensaje distinto al de no-match)", () => {
  assert.match(sliceAutorizar, /item\.autorizado_por_id !== null/);
  assert.match(sliceAutorizar, /"Este ítem ya fue autorizado"/);
});

test("valida el permiso del Supervisor contra supervisor_credencial.usuario_id, nunca contra usuarioSolicitanteId", () => {
  const bloquePermiso = sliceAutorizar.slice(
    sliceAutorizar.indexOf("const supervisorId = input.supervisor_credencial.usuario_id"),
    sliceAutorizar.indexOf("SIN_PERMISO_AUTORIZACION"),
  );
  assert.match(bloquePermiso, /id: supervisorId/);
  assert.doesNotMatch(bloquePermiso, /usuarioSolicitanteId/);
});

test("la validación del Supervisor exige usuario ACTIVO, is_active y el permiso de autorización en una sola condición", () => {
  const bloquePermiso = sliceAutorizar.slice(
    sliceAutorizar.indexOf("const supervisor = await tx.usuario.findFirst"),
    sliceAutorizar.indexOf("SIN_PERMISO_AUTORIZACION"),
  );
  assert.match(bloquePermiso, /is_active: true/);
  assert.match(bloquePermiso, /estado: "ACTIVO"/);
  assert.match(bloquePermiso, /codigo: PERMISO_VENTAS_AUTORIZAR_EXCEPCION_DESCUENTO/);
});

test("SIN_PERMISO_AUTORIZACION usa el código y mensaje exactos de spec §2.4", () => {
  assert.match(
    sliceAutorizar,
    /new ServiceError\(\s*\n?\s*"SIN_PERMISO_AUTORIZACION",\s*\n?\s*"Solo un Supervisor de Ventas puede autorizar excepciones de descuento"/,
  );
});

// ── Aplicación del override (spec §2.4, punto 4 de la task) ─────────────────

test("descuento_porcentual_solicitado mapea a descuento_porcentual; precio_lista_modificado mapea a precio_unitario", () => {
  assert.match(sliceAutorizar, /dataUpdate\.descuento_porcentual = input\.descuento_porcentual_solicitado/);
  assert.match(sliceAutorizar, /dataUpdate\.precio_unitario = input\.precio_lista_modificado/);
});

test("siempre setea autorizado_por y requiere_autorizacion: false, dentro de la transacción", () => {
  assert.match(sliceAutorizar, /autorizado_por: \{ connect: \{ id: supervisorId \} \}/);
  assert.match(sliceAutorizar, /requiere_autorizacion: false/);
  assert.match(sliceAutorizar, /await tx\.pedidoVentaItem\.update/);
});

// ── autorizacion_id — id de correlación, generado ANTES del commit ──────────

test("autorizacion_id se genera con crypto.randomUUID() antes de abrir la $transaction", () => {
  const idxRandom = sliceAutorizar.indexOf("crypto.randomUUID()");
  const idxTx = sliceAutorizar.indexOf("await prisma.$transaction");
  assert.ok(idxRandom > -1 && idxTx > -1);
  assert.ok(idxRandom < idxTx);
});

// ── Emisión de eventos — SIEMPRE después del COMMIT (spec §3.3) ─────────────

test("emite venta:descuento_fuera_margen y venta:cambio_precio_manual después de que la $transaction resuelve", () => {
  const idxTx = fuente.indexOf("await prisma.$transaction");
  const idxEmitDescuento = fuente.indexOf('domainEventBus.emit("venta:descuento_fuera_margen"');
  const idxEmitPrecio = fuente.indexOf('domainEventBus.emit("venta:cambio_precio_manual"');
  assert.ok(idxTx > -1 && idxEmitDescuento > idxTx && idxEmitPrecio > idxTx);
});

test("ambos eventos incluyen autorizacion_id en su payload", () => {
  const bloqueDescuento = fuente.slice(
    fuente.indexOf('domainEventBus.emit("venta:descuento_fuera_margen"'),
    fuente.indexOf("});", fuente.indexOf('domainEventBus.emit("venta:descuento_fuera_margen"')),
  );
  const bloquePrecio = fuente.slice(
    fuente.indexOf('domainEventBus.emit("venta:cambio_precio_manual"'),
    fuente.indexOf("});", fuente.indexOf('domainEventBus.emit("venta:cambio_precio_manual"')),
  );
  assert.match(bloqueDescuento, /autorizacion_id: autorizacionId/);
  assert.match(bloquePrecio, /autorizacion_id: autorizacionId/);
});

test("emite AMBOS eventos cuando vienen ambos campos a la vez (sin exclusión mutua a nivel de servicio)", () => {
  assert.match(fuente, /if \(input\.descuento_porcentual_solicitado !== undefined\) \{\s*\n\s*domainEventBus\.emit\("venta:descuento_fuera_margen"/);
  assert.match(fuente, /if \(input\.precio_lista_modificado !== undefined\) \{\s*\n\s*domainEventBus\.emit\("venta:cambio_precio_manual"/);
});

// ── Selectores de la UI ──────────────────────────────────────────────────────

test("listarSupervisoresVentas filtra usuarios ACTIVOS con ventas:autorizar_excepcion_descuento", () => {
  const bloque = fuente.slice(fuente.indexOf("export async function listarSupervisoresVentas"));
  assert.match(bloque, /estado: "ACTIVO"/);
  assert.match(bloque, /codigo: PERMISO_VENTAS_AUTORIZAR_EXCEPCION_DESCUENTO/);
});
