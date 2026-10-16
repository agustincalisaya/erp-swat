import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { TipoComprobanteVenta, CanalVenta } from "@prisma/client";

const DATABASE_URL = process.env.HU_G4_INTEGRATION_DATABASE_URL;

test("HU-G4 PostgreSQL + HTTP real, exclusivamente en base descartable", { skip: !DATABASE_URL, timeout: 240_000 }, async (t) => {
  const url = new URL(DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  assert.match(url.pathname, /^\/swat_erp_test_e13_g4_[a-z0-9_]+$/);
  process.env.DATABASE_URL = DATABASE_URL;
  const { prisma } = await import("../../db/prisma.ts");
  const [{ base }] = await prisma.$queryRaw<{ base: string }[]>`SELECT current_database() AS base`;
  assert.equal(base, url.pathname.slice(1), "comprobación de identidad antes de cualquier escritura");
  assert.equal(await prisma.pedidoVenta.count({ where: { numero_venta: { startsWith: "V-2090-" } } }), 0,
    "HU-G4 requiere una base descartable nueva, migrada y sembrada; no reutilizar fixtures de otra ejecución");
  t.after(async () => { await prisma.$disconnect(); });
  const { firmarSesionJwt } = await import("../../auth/jwt.ts");
  const { generarLibroIva } = await import("./libro-iva.service.ts");
  const { verificarCadenaIntegridad } = await import("../auditoria/audit-log.service.ts");
  const { domainEventBus, listenersRegistrados } = await import("../../events/domain-event-bus.ts");
  const { auditarExportacionLibroIva } = await import("../../events/libro-iva-auditoria.ts");
  await listenersRegistrados;

  const permiso = await prisma.permiso.findUniqueOrThrow({ where: { codigo: "tesoreria:exportar_libro_iva" }, include: { roles: { include: { rol: true } } } });
  assert.equal(permiso.id, "1a2b3c4d-1111-4a1a-8a1a-000000000051");
  assert.deepEqual(permiso.roles.map((r) => r.rol.nombre).sort(), ["ADMINISTRADOR", "AUDITOR"]);
  const perfiles = ["ADMINISTRADOR", "AUDITOR", "CAJERO_POS", "TESORERO_CENTRAL", "GERENTE"];
  const sesiones = new Map<string, { cookie: string; usuarioId: string; rolId: string }>();
  for (const nombre of perfiles) {
    const relacion = await prisma.usuarioRol.findFirstOrThrow({ where: { rol: { nombre }, is_active: true }, select: { usuario_id: true, rol_id: true } });
    const jti = randomUUID(); const expira = new Date(Date.now() + 600_000);
    await prisma.sesion.create({ data: { usuario_id: relacion.usuario_id, jwt_id: jti, ip_origen: "127.0.0.1", expira_en: expira } });
    const token = await firmarSesionJwt({ usuarioId: relacion.usuario_id, jti }, expira);
    sesiones.set(nombre, { cookie: `swat_session=${token}`, usuarioId: relacion.usuario_id, rolId: relacion.rol_id });
  }
  const actor = sesiones.get("ADMINISTRADOR")!.usuarioId;
  const sufijo = randomUUID().slice(0, 8);
  let secuencia = 0;
  async function factura(fecha: string, tipo: TipoComprobanteVenta = "FACTURA_B", canal: CanalVenta = "WEB") {
    const numero = `V-2090-${String(++secuencia).padStart(6, "0")}`;
    const pedido = await prisma.pedidoVenta.create({ data: { numero_venta: numero, canal, estado: "ANULADO", is_active: false, total: "121", registrado_por_id: actor } });
    const c = await prisma.comprobanteFiscal.create({ data: { pedido_venta_id: pedido.id, tipo_comprobante: tipo,
      monto_total: "121", emitido_por_id: actor, cae_simulado: "00000000000001", qr_data_url: "fixture-g4", created_at: new Date(fecha) } });
    return { pedido, c };
  }
  // Fixtures de lectura deliberados: no simulan ni modifican el circuito de emisión.
  await factura("2090-12-01T02:59:59.999Z");
  const primero = await factura("2090-12-01T03:00:00.000Z", "FACTURA_A", "MOSTRADOR");
  const cliente = await prisma.cliente.create({ data: { dni: "99111222", nombre: "Cliente sintético G4" } });
  await prisma.pedidoVenta.update({ where: { id: primero.pedido.id }, data: { cliente_id: cliente.id } });
  for (let i = 0; i < 125; i++) await factura("2090-12-02T15:00:00Z", i === 0 ? "TICKET" : "FACTURA_B", i % 2 ? "WEB" : "MOSTRADOR");
  await factura("2091-01-01T02:59:59.999Z");
  await factura("2091-01-01T03:00:00.000Z");
  const original = await factura("2090-11-15T12:00:00Z");
  await prisma.comprobanteFiscal.create({ data: { pedido_venta_id: original.pedido.id, tipo_comprobante: "NOTA_CREDITO", comprobante_original_id: original.c.id,
    monto_total: "121", emitido_por_id: actor, cae_simulado: "00000000000002", qr_data_url: "fixture-g4", created_at: new Date("2090-12-03T12:00:00Z") } });
  const sku = await prisma.varianteSKU.findFirstOrThrow({ select: { id: true } });
  await prisma.pedidoVentaItem.createMany({ data: [1, 2].map((cantidad) => ({ pedido_venta_id: primero.pedido.id, variante_sku_id: sku.id, cantidad, precio_unitario: "1" })) });
  await prisma.ventaMedioPago.createMany({ data: ["60", "61"].map((importe) => ({ pedido_venta_id: primero.pedido.id, medio: "EFECTIVO" as const, importe })) });
  const proveedor = await prisma.proveedor.findFirstOrThrow({ select: { id: true, cuit: true } });
  const otro = await prisma.proveedor.create({ data: { razon_social: "Proveedor sintético G4", cuit: "30-89999999-3", categorias: [], is_active: false } });
  async function compra(proveedorId: string, fecha: string, numero: string) {
    const oc = await prisma.ordenCompra.create({ data: { numero_orden: `G4-${sufijo}-${randomUUID()}`, proveedor_id: proveedorId, estado: "CERRADA", creada_por_id: actor } });
    return prisma.comprobanteProveedor.create({ data: { orden_compra_id: oc.id, proveedor_id: proveedorId, tipo: "FACTURA_M", numero_comprobante: numero,
      fecha_emision: new Date(fecha), monto_total: "242", registrado_por_id: actor } });
  }
  await compra(proveedor.id, "2090-11-30T23:59:59.999Z", "2-10");
  const c1 = await compra(proveedor.id, "2090-12-01T00:00:00Z", "0002-1");
  await prisma.cuentaPorPagar.create({ data: { orden_compra_id: c1.orden_compra_id, monto: "242", estado: "PAGADA", fecha_pago: new Date("2091-01-10T12:00:00Z") } });
  await prisma.ordenCompra.update({ where: { id: c1.orden_compra_id }, data: { is_active: false } });
  await compra(otro.id, "2090-12-01T00:00:00Z", "0002-1");
  await compra(proveedor.id, "2091-01-01T00:00:00Z", "2-11");
  const inactiva = await compra(proveedor.id, "2090-12-05T00:00:00Z", "2-12");
  await prisma.comprobanteProveedor.update({ where: { id: inactiva.id }, data: { is_active: false } });

  await t.test("fuentes completas, ambos canales, fronteras diciembre/enero, NC anterior e independencia de pagos", async () => {
    const ventas = await generarLibroIva("VENTAS", "2090-12");
    assert.equal(ventas.trimEnd().split("\n").length, 128);
    assert.ok(ventas.startsWith("20901201;001;"));
    assert.ok(ventas.includes("20901231;006;"));
    assert.ok(ventas.includes("20901203;008;"));
    assert.ok(ventas.includes(";-121.00;-100.00;-21.00;21.00\n"));
    const compras = await generarLibroIva("COMPRAS", "2090-12");
    assert.equal(compras.trimEnd().split("\n").length, 2);
    assert.equal(compras.split("\n")[0]!.split(";")[0], "20901201");
    assert.ok(compras.includes(";051;00002;00000001;80;"));
    const duplicada = await compra(proveedor.id, "2090-12-08T00:00:00Z", "2-00000001");
    await assert.rejects(generarLibroIva("COMPRAS", "2090-12"), /incompatibles/);
    await prisma.comprobanteProveedor.update({ where: { id: duplicada.id }, data: { is_active: false } });
    const multiple = await factura("2087-09-15T12:00:00Z");
    for (const fecha of ["2087-09-25T12:00:00Z", "2087-10-02T12:00:00Z"]) {
      await prisma.comprobanteFiscal.create({ data: { pedido_venta_id: multiple.pedido.id, tipo_comprobante: "NOTA_CREDITO", comprobante_original_id: multiple.c.id,
        monto_total: "121", emitido_por_id: actor, cae_simulado: "00000000000003", qr_data_url: "fixture-g4", created_at: new Date(fecha) } });
    }
    await assert.rejects(generarLibroIva("VENTAS", "2087-10"), /incompatibles/);
    // Conservar el fixture inconsistente en su mes separado; sin borrar comprobantes.
  });

  const port = await new Promise<number>((resolve, reject) => {
    const srv = createServer(); srv.once("error", reject); srv.listen(0, "127.0.0.1", () => { const address = srv.address(); assert.ok(address && typeof address !== "string"); srv.close(() => resolve(address.port)); });
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  const log = createWriteStream(join(tmpdir(), "swat-g4-http-server.log"));
  const servidor = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    env: { ...process.env, DATABASE_URL, APP_PUBLIC_URL: baseUrl, MP_MODO: "simulado", NEXT_TELEMETRY_DISABLED: "1" }, stdio: ["ignore", "pipe", "pipe"],
  });
  servidor.stdout.pipe(log); servidor.stderr.pipe(log);
  t.after(async () => { servidor.kill(); await new Promise<void>((resolve) => { if (servidor.exitCode !== null) resolve(); else servidor.once("exit", () => resolve()); }); log.end(); });
  const inicio = Date.now();
  while (true) {
    try { if ((await fetch(`${baseUrl}/api/tesoreria/libro-iva/ventas?mes=2080-01`)).status === 401) break; } catch { /* iniciar servidor */ }
    assert.ok(Date.now() - inicio < 30_000, "servidor de test no inició; revisar log temporal");
    assert.equal(servidor.exitCode, null, "next start requiere build previo");
    await new Promise((r) => setTimeout(r, 100));
  }
  const pedir = (tipo: string, perfil?: string, mes = "2080-01") => fetch(`${baseUrl}/api/tesoreria/libro-iva/${tipo}?mes=${mes}`, {
    headers: perfil ? { Cookie: sesiones.get(perfil)!.cookie } : {}, redirect: "manual",
  });
  const auditarCantidad = () => prisma.auditLog.count({ where: { accion: "LIBRO_IVA_EXPORTADO" } });

  await t.test("HTTP real: 401/403/200 ambos libros, cinco perfiles, vacío, cabeceras y auditoría antes de 200", async () => {
    for (const tipo of ["ventas", "compras"]) {
      assert.equal((await pedir(tipo)).status, 401);
      for (const perfil of perfiles) {
        const anterior = await auditarCantidad();
        const respuesta = await pedir(tipo, perfil);
        const permitido = ["ADMINISTRADOR", "AUDITOR"].includes(perfil);
        assert.equal(respuesta.status, permitido ? 200 : 403, `${tipo}/${perfil}`);
        assert.equal(respuesta.headers.get("cache-control"), "private, no-store");
        assert.equal(respuesta.headers.get("x-content-type-options"), "nosniff");
        assert.equal(await auditarCantidad(), anterior + (permitido ? 1 : 0));
        if (permitido) {
          assert.equal((await respuesta.arrayBuffer()).byteLength, 0);
          assert.equal(respuesta.headers.get("content-type"), "text/plain; charset=utf-8");
          assert.ok(decodeURIComponent(respuesta.headers.get("content-disposition")!).includes("Libro de IVA"));
        }
      }
    }
    for (const mes of ["2026-00", "2026-1", "0999-12", "2026-10&mes=2026-11", "2026-10&canal=WEB"]) assert.equal((await pedir("ventas", "ADMINISTRADOR", mes)).status, 400);
    assert.equal((await pedir("compras", "AUDITOR", "2090-12")).status, 200);
    const ventas = await pedir("ventas", "AUDITOR", "2090-12");
    assert.equal(ventas.status, 200);
    const lineas = (await ventas.text()).trimEnd().split("\n");
    assert.equal(lineas.length, 128);
    assert.ok(lineas[0]!.includes(";96;99111222;Cliente sintético G4;"));
    const error = await pedir("ventas", "AUDITOR", "2087-10");
    assert.equal(error.status, 422); assert.equal(error.headers.get("content-disposition"), null);
    assert.equal((await error.json()).error.code, "LIBRO_IVA_DATOS_INVALIDOS");
    const vinculo = { rol_id_permiso_id: { rol_id: sesiones.get("AUDITOR")!.rolId, permiso_id: permiso.id } };
    await prisma.rolPermiso.update({ where: vinculo, data: { is_active: false } });
    try { for (const tipo of ["ventas", "compras"]) assert.equal((await pedir(tipo, "AUDITOR")).status, 403); }
    finally { await prisma.rolPermiso.update({ where: vinculo, data: { is_active: true } }); }
    const pagina = await fetch(`${baseUrl}/tesoreria/libro-iva`, { headers: { Cookie: sesiones.get("ADMINISTRADOR")!.cookie } });
    assert.equal(pagina.status, 200); const html = await pagina.text();
    assert.ok(html.includes("Libro de IVA")); assert.ok(!html.includes("SUBCONJUNTO INTERNO"));
    const prohibida = await fetch(`${baseUrl}/tesoreria/libro-iva`, { headers: { Cookie: sesiones.get("GERENTE")!.cookie }, redirect: "manual" });
    assert.ok([307, 303].includes(prohibida.status)); assert.ok(prohibida.headers.get("location")?.includes("no-autorizado"));
  });

  await t.test("vista JSON y PDF: autorización, sin auditoría al consultar y exportación completa auditada", async () => {
    for (const tipo of ["ventas", "compras"]) {
      for (const formato of ["json", "pdf"]) {
        assert.equal((await pedir(tipo, undefined, `2090-12&formato=${formato}`)).status, 401);
        assert.equal((await pedir(tipo, "GERENTE", `2090-12&formato=${formato}`)).status, 403);
      }
      const anterior = await auditarCantidad();
      const vista = await pedir(tipo, "AUDITOR", "2090-12&formato=json");
      assert.equal(vista.status, 200);
      assert.equal(vista.headers.get("content-disposition"), null);
      const { data } = await vista.json();
      assert.equal(data.filas.length, tipo === "ventas" ? 128 : 2);
      assert.equal(data.totales.comprobantes, data.filas.length);
      assert.equal(await auditarCantidad(), anterior);
      const pdf = await pedir(tipo, "ADMINISTRADOR", "2090-12&formato=pdf");
      assert.equal(pdf.status, 200);
      assert.equal(pdf.headers.get("content-type"), "application/pdf");
      assert.ok(pdf.headers.get("content-disposition")!.includes(".pdf"));
      assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
      assert.equal(await auditarCantidad(), anterior + 1);
    }
    for (const extra of ["formato=csv", "formato=pdf&formato=json"]) assert.equal((await pedir("ventas", "AUDITOR", `2090-12&${extra}`)).status, 400);
  });

  await t.test("fallo PostgreSQL real de append: 503 sin TXT ni asiento; no polling productivo", async () => {
    await prisma.$executeRawUnsafe(`CREATE FUNCTION g4_fallo_append() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.accion = 'LIBRO_IVA_EXPORTADO' THEN RAISE EXCEPTION 'G4_FALLO_TEST'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER g4_fallo_append BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION g4_fallo_append()`);
    try {
      const anterior = await auditarCantidad();
      const pdf = await pedir("compras", "ADMINISTRADOR", "2080-01&formato=pdf");
      assert.equal(pdf.status, 503); assert.equal(pdf.headers.get("content-disposition"), null);
      const respuesta = await pedir("compras", "ADMINISTRADOR");
      assert.equal(respuesta.status, 503); assert.equal(respuesta.headers.get("content-disposition"), null);
      assert.equal((await respuesta.json()).error.code, "LIBRO_IVA_AUDITORIA_NO_CONFIRMADA");
      assert.equal(await auditarCantidad(), anterior);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER g4_fallo_append ON audit_logs`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION g4_fallo_append()`);
    }
  });

  await t.test("concurrencia HTTP/proceso, listener ausente y cadena D.3 íntegra", async () => {
    const anterior = await auditarCantidad();
    await Promise.all([
      ...Array.from({ length: 6 }, async () => { assert.equal((await pedir("ventas", "ADMINISTRADOR")).status, 200); }),
      ...Array.from({ length: 6 }, () => auditarExportacionLibroIva({ usuario_id: actor, periodo: "2080-01", tipo_libro: "COMPRAS" })),
    ]);
    assert.equal(await auditarCantidad(), anterior + 12);
    assert.equal((await verificarCadenaIntegridad()).integra, true);
    const filas = await prisma.auditLog.findMany({ where: { accion: "LIBRO_IVA_EXPORTADO" }, select: { usuario_id: true, registro_id: true, valor_nuevo: true } });
    assert.equal(new Set(filas.map((f) => f.registro_id)).size, filas.length);
    for (const f of filas) {
      assert.ok(f.usuario_id);
      assert.deepEqual(Object.keys(f.valor_nuevo as object).sort(), ["exportacion_id", "formato", "periodo", "timestamp", "tipo_libro"]);
    }
    const handlers = domainEventBus.listeners("tesoreria:libro_iva_exportado");
    domainEventBus.removeAllListeners("tesoreria:libro_iva_exportado");
    try { await assert.rejects(auditarExportacionLibroIva({ usuario_id: actor, periodo: "2080-01", tipo_libro: "VENTAS" }), /registrar la exportación/); }
    finally { for (const h of handlers) domainEventBus.on("tesoreria:libro_iva_exportado", h as () => void); }
    assert.ok(c1.id);
  });
});
