/**
 * Sprint 5 · Cluster 4 — HU-G3 Repositorio digital de comprobantes fiscales.
 *
 * Tests escritos ANTES de la spec y de la implementación: cada caso está
 * marcado `{ todo: true }`, así falla (reportado como pendiente) sin romper
 * `npm test`. Al implementar, se quita el `todo` caso por caso.
 *
 * CONTRATO PROVISIONAL: las rutas de módulos y los nombres de funciones de
 * `CONTRATO` son una propuesta del Cluster 4, no de la spec. Si la spec del
 * PM define otros, se ajusta solo ese bloque.
 *
 * Datos del modelo actual que fijan los casos (prisma/schema.prisma):
 * - `ComprobanteFiscal` no tiene canal, cliente ni fecha de emisión propios:
 *   el canal y el cliente salen de `pedido_venta` y la fecha es `created_at`.
 * - La NC apunta a su original con `comprobante_original_id`
 *   (relación "ReversionFiscal"; inversa `notas_credito`).
 * - Sin soft delete ni `updated_at`: el comprobante es inmutable.
 *
 * Decisiones de negocio del Cluster 4 (15/10, a la espera de la spec):
 * 1. `tesoreria:leer_comprobantes` → CAJERO_POS, TESORERO_CENTRAL, AUDITOR y
 *    ADMINISTRADOR (matriz del Módulo G del Alcance). El GERENTE no (403).
 * 2. Fecha de emisión = `created_at` del ComprobanteFiscal (sin campo nuevo).
 * 3. Venta sin cliente (`cliente_id` null) se muestra como "Consumidor final".
 * 4. QR válido = PNG decodificable con el payload que arma HU-B7
 *    (`generarQrSimulado`, comprobante-fiscal.service.ts:74-93), no la URL de AFIP.
 *
 * Los casos de "Decisión 4 · QR" al final NO son `todo`: validan el seed
 * del Cluster 4, que ya está implementado.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInThisContext } from "node:vm";
import { inflateSync } from "node:zlib";
import { ModuleKind, transpileModule } from "typescript";
import { ServiceError } from "../../errors/service-error.ts";
import * as fechaNegocio from "../../utils/fecha-negocio.ts";

const requireReal = createRequire(import.meta.url);

const CONTRATO = {
  servicio: "./comprobantes-repositorio.service.ts",
  schema: "../../schemas/comprobantes-repositorio.schema.ts",
  pdf: "../ecommerce/comprobante-web-pdf.ts",
  rutaListado: "../../../app/api/tesoreria/comprobantes/route.ts",
  rutaDetalle: "../../../app/api/tesoreria/comprobantes/[id]/route.ts",
  rutaPdf: "../../../app/api/tesoreria/comprobantes/[id]/pdf/route.ts",
  sidebar: "../../../components/layout/Sidebar.tsx",
  seed: "../../../../prisma/seed.ts",
  permiso: "tesoreria:leer_comprobantes",
  permisoId: "1a2b3c4d-1111-4a1a-8a1a-000000000050",
} as const;

const leer = (ruta: string) => readFileSync(new URL(ruta, import.meta.url), "utf8");

/** Payload de HU-B7 (`generarQrSimulado`) para un comprobante de prueba. */
const payloadB7 = (numero: string, tipo: string, importe: number, cae: string) => ({
  ver: 1,
  simulado: true,
  cuitEmisor: "30000000007",
  tipoComprobante: tipo,
  numeroComprobante: numero,
  importe,
  moneda: "PES",
  cae,
});

async function qrB7(numero: string, tipo: string, importe: number, cae: string): Promise<string> {
  const QRCode = requireReal("qrcode") as { toDataURL: (texto: string, opciones: object) => Promise<string> };
  return QRCode.toDataURL(JSON.stringify(payloadB7(numero, tipo, importe, cae)), { errorCorrectionLevel: "M" });
}

/**
 * Decodifica el QR de un `data:image/png;base64,...` y devuelve su texto.
 * `@zxing/library` es dependencia directa; `pngjs` llega como dependencia de
 * `qrcode` (no se agrega ninguna dependencia nueva).
 */
function decodificarQr(dataUrl: string): string {
  const base64 = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  assert.ok(base64, "data URL PNG en base64");
  const { PNG } = requireReal("pngjs") as {
    PNG: { sync: { read: (buffer: Buffer) => { width: number; height: number; data: Buffer } } };
  };
  const zxing = requireReal("@zxing/library") as typeof import("@zxing/library");
  const png = PNG.sync.read(Buffer.from(base64[1]!, "base64"));
  const luminancias = Uint8ClampedArray.from(
    { length: png.width * png.height },
    (_, i) => (png.data[i * 4]! + png.data[i * 4 + 1]! + png.data[i * 4 + 2]!) / 3,
  );
  const fuente = new zxing.RGBLuminanceSource(luminancias, png.width, png.height);
  return new zxing.QRCodeReader().decode(new zxing.BinaryBitmap(new zxing.HybridBinarizer(fuente))).getText();
}

/** Carga un módulo TS con dependencias inyectadas (mismo patrón que reporte-mensual.service.test.ts). */
function cargarModulo<T>(ruta: string, dependencias: Record<string, unknown>): T {
  const codigo = transpileModule(leer(ruta), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const modulo: { exports: Record<string, unknown> } = { exports: {} };
  const ejecutar = runInThisContext(`(function(require, module, exports) {\n${codigo}\n})`, { filename: ruta });
  ejecutar(
    (nombre: string) => {
      if (Object.hasOwn(dependencias, nombre)) return dependencias[nombre];
      if (!nombre.startsWith(".") && !nombre.startsWith("@/")) return requireReal(nombre);
      throw new Error(`Dependencia inesperada: ${nombre}`);
    },
    modulo,
    modulo.exports,
  );
  return modulo.exports as T;
}

// ── Doble de Prisma: registra los argumentos y devuelve filas fijas ──────────

type Llamada = { metodo: string; args: Record<string, unknown> };

function filaComprobante(over: Record<string, unknown> = {}) {
  return {
    id: "c0000000-0000-4000-8000-000000000001",
    tipo_comprobante: "FACTURA_B",
    cae_simulado: "68031598274563",
    qr_data_url: "data:image/png;base64,AAAA",
    es_simulado: true,
    monto_total: { toFixed: (n: number) => (45000).toFixed(n), toString: () => "45000" },
    comprobante_original_id: null,
    created_at: new Date("2026-10-08T15:30:00.000Z"),
    pedido_venta: {
      numero_venta: "V-2026-000001",
      canal: "MOSTRADOR",
      cliente: { dni: "30987654", nombre: "María Gómez" },
    },
    comprobante_original: null,
    notas_credito: [],
    ...over,
  };
}

function prismaDoble(filas: unknown[] = [filaComprobante()], total = filas.length) {
  const llamadas: Llamada[] = [];
  const registrar = (metodo: string, resultado: unknown) => async (args: Record<string, unknown> = {}) => {
    llamadas.push({ metodo, args });
    return resultado;
  };
  const comprobanteFiscal = {
    findMany: registrar("findMany", filas),
    count: registrar("count", total),
    findUnique: registrar("findUnique", filas[0] ?? null),
    findFirst: registrar("findFirst", filas[0] ?? null),
  };
  return {
    llamadas,
    prisma: { comprobanteFiscal, $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops) },
  };
}

interface Servicio {
  listarComprobantes: (filtros: Record<string, unknown>) => Promise<{ registros: Record<string, unknown>[]; total: number; page: number; page_size: number }>;
  obtenerDetalleComprobante: (id: string) => Promise<Record<string, unknown>>;
}

function cargarServicio(prisma: unknown): Servicio {
  return cargarModulo<Servicio>(CONTRATO.servicio, {
    "server-only": {},
    "@/lib/db/prisma": { prisma },
    "@/lib/errors/service-error": { ServiceError },
    "@/lib/utils/fecha-negocio": fechaNegocio,
  });
}

const whereDe = (llamadas: Llamada[], metodo = "findMany") =>
  llamadas.find((l) => l.metodo === metodo)?.args.where as Record<string, unknown> | undefined;

// ── CA1: lista mostrador y web desde lo archivado, sin duplicar emisión ──────

test("CA1 · sin filtros lista ambos canales, más recientes primero", { todo: true }, async () => {
  const doble = prismaDoble([
    filaComprobante({ id: "c0000000-0000-4000-8000-000000000002", pedido_venta: { numero_venta: "V-2026-000002", canal: "WEB", cliente: null } }),
    filaComprobante(),
  ]);
  const listado = await cargarServicio(doble.prisma).listarComprobantes({ page: 1, page_size: 25 });

  const args = doble.llamadas.find((l) => l.metodo === "findMany")!.args;
  assert.doesNotMatch(JSON.stringify(args.where ?? {}), /"canal"/, "sin filtro no restringe el canal");
  assert.deepEqual(args.orderBy, [{ created_at: "desc" }, { id: "desc" }]);
  assert.equal(listado.registros.length, 2);
  assert.deepEqual(listado.registros.map((r) => r.canal), ["WEB", "MOSTRADOR"]);
  assert.equal(listado.total, 2);
});

test("CA1 · decisión 2: la fecha de emisión es created_at del comprobante (ISO)", { todo: true }, async () => {
  const doble = prismaDoble([filaComprobante({ created_at: new Date("2026-10-08T15:30:00.000Z") })]);
  const [registro] = (await cargarServicio(doble.prisma).listarComprobantes({ page: 1, page_size: 25 })).registros;
  assert.equal(registro!.fecha_emision, "2026-10-08T15:30:00.000Z");
});

test("CA1 · decisión 3: una venta sin cliente se lista como Consumidor final", { todo: true }, async () => {
  const doble = prismaDoble([
    filaComprobante({ pedido_venta: { numero_venta: "V-2026-000003", canal: "MOSTRADOR", cliente: null } }),
    filaComprobante(),
  ]);
  const { registros } = await cargarServicio(doble.prisma).listarComprobantes({ page: 1, page_size: 25 });
  assert.deepEqual(registros[0]!.cliente, { dni: null, nombre: "Consumidor final" });
  assert.deepEqual(registros[1]!.cliente, { dni: "30987654", nombre: "María Gómez" });
});

test("CA1 · solo lee comprobantes archivados: no emite, no recalcula CAE ni QR", { todo: true }, () => {
  const fuente = leer(CONTRATO.servicio);
  assert.doesNotMatch(fuente, /comprobanteFiscal\.(create|createMany|upsert)\b/);
  assert.doesNotMatch(fuente, /emitirComprobanteFiscal|emitirNotaCredito|generarCaeSimulado|generarQrSimulado/);
  assert.doesNotMatch(fuente, /from\s+"qrcode"/);
});

// ── CA2: filtros + paginación ────────────────────────────────────────────────

interface SchemaFiltros {
  FiltrosComprobantesSchema: { safeParse: (v: unknown) => { success: boolean; data?: Record<string, unknown> } };
}

function cargarSchema(): SchemaFiltros {
  return cargarModulo<SchemaFiltros>(CONTRATO.schema, {});
}

test("CA2 · schema: tipo y canal cerrados, paginación con defaults 1/25 y tope 100", { todo: true }, () => {
  const { FiltrosComprobantesSchema: schema } = cargarSchema();
  for (const tipo of ["FACTURA_A", "FACTURA_B", "TICKET", "NOTA_CREDITO"]) {
    assert.equal(schema.safeParse({ tipo }).success, true, tipo);
  }
  assert.equal(schema.safeParse({ tipo: "FACTURA_C" }).success, false);
  for (const canal of ["MOSTRADOR", "WEB"]) assert.equal(schema.safeParse({ canal }).success, true, canal);
  assert.equal(schema.safeParse({ canal: "TELEFONO" }).success, false);

  const porDefecto = schema.safeParse({});
  assert.equal(porDefecto.success, true);
  assert.equal(porDefecto.data!.page, 1);
  assert.equal(porDefecto.data!.page_size, 25);
  assert.equal(schema.safeParse({ page_size: "101" }).success, false);
  assert.equal(schema.safeParse({ fecha_desde: "2026-10-31", fecha_hasta: "2026-10-01" }).success, false, "rango invertido");
});

test("CA2 · cliente por DNI (exacto) o por nombre (parcial, sin mayúsculas)", { todo: true }, async () => {
  const porDni = prismaDoble();
  await cargarServicio(porDni.prisma).listarComprobantes({ cliente: "30987654", page: 1, page_size: 25 });
  assert.deepEqual(whereDe(porDni.llamadas)?.pedido_venta, { cliente: { dni: "30987654" } });

  const porNombre = prismaDoble();
  await cargarServicio(porNombre.prisma).listarComprobantes({ cliente: "gómez", page: 1, page_size: 25 });
  assert.deepEqual(whereDe(porNombre.llamadas)?.pedido_venta, {
    cliente: { nombre: { contains: "gómez", mode: "insensitive" } },
  });
});

test("CA2 · período de emisión en hora Argentina, día hasta inclusive", { todo: true }, async () => {
  const doble = prismaDoble();
  await cargarServicio(doble.prisma).listarComprobantes({
    fecha_desde: "2026-10-01",
    fecha_hasta: "2026-10-31",
    page: 1,
    page_size: 25,
  });
  const where = whereDe(doble.llamadas)!;
  assert.deepEqual(where.created_at, {
    gte: new Date("2026-10-01T03:00:00.000Z"),
    lt: new Date("2026-11-01T03:00:00.000Z"),
  });
  assert.match(leer(CONTRATO.servicio), /rangoDiasNegocio\(/, "reutiliza el helper de fecha-negocio");
});

test("CA2 · tipo y canal se combinan con paginación skip/take y el total usa el mismo where", { todo: true }, async () => {
  const doble = prismaDoble([filaComprobante()], 31);
  const listado = await cargarServicio(doble.prisma).listarComprobantes({
    tipo: "TICKET",
    canal: "MOSTRADOR",
    page: 2,
    page_size: 10,
  });
  const findMany = doble.llamadas.find((l) => l.metodo === "findMany")!.args;
  const where = findMany.where as Record<string, unknown>;
  assert.equal(where.tipo_comprobante, "TICKET");
  assert.deepEqual(where.pedido_venta, { canal: "MOSTRADOR" });
  assert.equal(findMany.skip, 10);
  assert.equal(findMany.take, 10);
  assert.deepEqual(whereDe(doble.llamadas, "count"), where);
  assert.deepEqual({ total: listado.total, page: listado.page, page_size: listado.page_size }, { total: 31, page: 2, page_size: 10 });
});

// ── CA3: PDF de cualquier comprobante, con CAE y QR, marcado simulado ───────

/** Texto y operadores de la primera página (mismo método que comprobante-web-pdf.test.ts). */
async function textosPdf(bytes: Uint8Array, pdfLib: typeof import("pdf-lib")): Promise<{ texto: string; operadores: string }> {
  const documento = await pdfLib.PDFDocument.load(bytes);
  const contents = documento.getPage(0).node.Contents();
  assert.ok(contents);
  const refs = contents instanceof pdfLib.PDFArray ? contents.asArray() : [contents];
  const operadores = refs
    .map((ref) => {
      const stream = documento.context.lookup(ref);
      assert.ok(stream instanceof pdfLib.PDFRawStream);
      return inflateSync(stream.getContents()).toString("latin1");
    })
    .join("\n");
  const texto = [...operadores.matchAll(/<([0-9A-F]+)> Tj/g)]
    .map((m) => Buffer.from(m[1]!, "hex").toString("latin1").replace(/\x97/g, "—"))
    .join("\n");
  return { texto, operadores };
}

interface PdfGeneral {
  generarComprobanteFiscalPdf: (comprobante: Record<string, unknown>) => Promise<Uint8Array>;
}

test("CA3 · PDF de un comprobante de mostrador sin cliente: CAE, QR, Consumidor final y leyenda de simulado", { todo: true }, async () => {
  const pdfLib = requireReal("pdf-lib") as typeof import("pdf-lib");
  const { generarComprobanteFiscalPdf } = cargarModulo<PdfGeneral>(CONTRATO.pdf, { "server-only": {} });
  const bytes = await generarComprobanteFiscalPdf({
    numero: "V-2026-000001",
    tipo: "TICKET",
    canal: "MOSTRADOR",
    fecha_emision: "2026-10-08T15:30:00.000Z",
    monto: 45000,
    cae_simulado: "68031598274563",
    qr_data_url: await qrB7("V-2026-000001", "TICKET", 45000, "68031598274563"),
    es_simulado: true,
    cliente: null,
    comprobante_original: null,
  });
  const { texto, operadores } = await textosPdf(bytes, pdfLib);
  for (const dato of ["TICKET", "V-2026-000001", "08/10/2026", "45.000,00", "68031598274563", "Mostrador", "Consumidor final", "simulado"]) {
    assert.ok(texto.includes(dato), dato);
  }
  assert.match(operadores, /\/Image-/, "QR embebido");
});

test("CA3 · PDF de una Nota de Crédito web muestra el comprobante original", { todo: true }, async () => {
  const pdfLib = requireReal("pdf-lib") as typeof import("pdf-lib");
  const { generarComprobanteFiscalPdf } = cargarModulo<PdfGeneral>(CONTRATO.pdf, { "server-only": {} });
  const bytes = await generarComprobanteFiscalPdf({
    numero: "NC-V-2026-000002",
    tipo: "NOTA_CREDITO",
    canal: "WEB",
    fecha_emision: "2026-10-09T15:30:00.000Z",
    monto: 10000,
    cae_simulado: "12345678901234",
    qr_data_url: await qrB7("NC-V-2026-000002", "NOTA_CREDITO", 10000, "12345678901234"),
    es_simulado: true,
    cliente: { dni: "30987654", nombre: "María Gómez" },
    comprobante_original: { numero: "V-2026-000002", tipo: "FACTURA_B" },
  });
  const { texto } = await textosPdf(bytes, pdfLib);
  for (const dato of ["NOTA CREDITO", "NC-V-2026-000002", "V-2026-000002", "Web", "30987654", "simulado"]) {
    assert.ok(texto.includes(dato), dato);
  }
});

test("CA3 · la ruta de descarga devuelve application/pdf como adjunto", { todo: true }, () => {
  const fuente = leer(CONTRATO.rutaPdf);
  assert.match(fuente, /export\s+const\s+GET\b|export\s+async\s+function\s+GET\b/);
  assert.match(fuente, /application\/pdf/);
  assert.match(fuente, /Content-Disposition/i);
  assert.match(fuente, /generarComprobanteFiscalPdf/);
});

// ── CA4: vínculo NC ↔ original en ambos sentidos ────────────────────────────

test("CA4 · el detalle de una NC trae su comprobante original", { todo: true }, async () => {
  const doble = prismaDoble([
    filaComprobante({
      id: "c0000000-0000-4000-8000-000000000003",
      tipo_comprobante: "NOTA_CREDITO",
      comprobante_original_id: "c0000000-0000-4000-8000-000000000002",
      comprobante_original: {
        id: "c0000000-0000-4000-8000-000000000002",
        tipo_comprobante: "FACTURA_B",
        pedido_venta: { numero_venta: "V-2026-000002" },
      },
    }),
  ]);
  const detalle = await cargarServicio(doble.prisma).obtenerDetalleComprobante("c0000000-0000-4000-8000-000000000003");
  assert.deepEqual(detalle.comprobante_original, {
    comprobante_id: "c0000000-0000-4000-8000-000000000002",
    tipo_comprobante: "FACTURA_B",
    numero: "V-2026-000002",
  });
});

test("CA4 · el detalle del original lista sus NC", { todo: true }, async () => {
  const doble = prismaDoble([
    filaComprobante({
      id: "c0000000-0000-4000-8000-000000000002",
      notas_credito: [
        { id: "c0000000-0000-4000-8000-000000000003", tipo_comprobante: "NOTA_CREDITO", created_at: new Date("2026-10-09T15:30:00.000Z") },
      ],
    }),
  ]);
  const detalle = await cargarServicio(doble.prisma).obtenerDetalleComprobante("c0000000-0000-4000-8000-000000000002");
  assert.deepEqual(
    (detalle.notas_credito as Record<string, unknown>[]).map((nc) => nc.comprobante_id),
    ["c0000000-0000-4000-8000-000000000003"],
  );
});

test("CA4 · el listado expone el vínculo (id del original en la NC, cantidad de NC en el original)", { todo: true }, async () => {
  const doble = prismaDoble();
  await cargarServicio(doble.prisma).listarComprobantes({ page: 1, page_size: 25 });
  const consulta = JSON.stringify(doble.llamadas.find((l) => l.metodo === "findMany")!.args);
  assert.match(consulta, /"comprobante_original_id"|"comprobante_original"/);
  assert.match(consulta, /"notas_credito"/);
});

test("CA4 · un id inexistente responde COMPROBANTE_NO_ENCONTRADO", { todo: true }, async () => {
  const doble = prismaDoble([]);
  await assert.rejects(
    cargarServicio(doble.prisma).obtenerDetalleComprobante("c0000000-0000-4000-8000-0000000000ff"),
    (error: unknown) => error instanceof ServiceError && error.code === "COMPROBANTE_NO_ENCONTRADO",
  );
});

// ── CA5: sin edición ni baja ────────────────────────────────────────────────

test("CA5 · las rutas de G3 solo exponen GET", { todo: true }, () => {
  for (const ruta of [CONTRATO.rutaListado, CONTRATO.rutaDetalle, CONTRATO.rutaPdf]) {
    const fuente = leer(ruta);
    assert.match(fuente, /export\s+(const|async\s+function)\s+GET\b/, ruta);
    assert.doesNotMatch(fuente, /export\s+(const|async\s+function)\s+(POST|PUT|PATCH|DELETE)\b/, ruta);
  }
});

test("CA5 · el servicio no modifica ni borra comprobantes", { todo: true }, () => {
  assert.doesNotMatch(
    leer(CONTRATO.servicio),
    /comprobanteFiscal\.(update|updateMany|delete|deleteMany|upsert)\b|\$executeRaw|UPDATE\s+comprobantes_fiscales|DELETE\s+FROM/i,
  );
});

// ── CA6: permiso tesoreria:leer_comprobantes verificado en servidor ─────────

function cuerpoSeedCluster4(): string {
  const seed = leer(CONTRATO.seed);
  const inicio = seed.indexOf("async function seedSprint5Cluster4(");
  assert.ok(inicio >= 0, "seedSprint5Cluster4 existe");
  const fin = seed.indexOf("async function seedSprint5Cluster5(", inicio);
  return seed.slice(inicio, fin);
}

test("CA6 · el seed siembra tesoreria:leer_comprobantes con su id preasignado …050", { todo: true }, () => {
  const seed = leer(CONTRATO.seed);
  // Tolera el salto de línea que mete el reflow de Prettier después del `=`.
  assert.match(seed, new RegExp(`const PERMISO_TESORERIA_LEER_COMPROBANTES_ID =\\s*"${CONTRATO.permisoId}";`));
  assert.match(cuerpoSeedCluster4(), new RegExp(`codigo: "${CONTRATO.permiso}"`));
});

test("CA6 · asignado a Cajero POS, Tesorero, Auditor y Administrador; NO al Gerente", { todo: true }, () => {
  const cuerpo = cuerpoSeedCluster4();
  for (const rol of ["ROL_CAJERO_POS_ID", "ROL_TESORERO_ID", "ROL_AUDITOR_ID", "ROL_ADMINISTRADOR_ID"]) {
    assert.match(cuerpo, new RegExp(`\\b${rol}\\b`), rol);
  }
  assert.doesNotMatch(cuerpo, /\bROL_GERENTE_ID\b/, "el Gerente no lee comprobantes (403)");
});

test("CA6 · las rutas se gatean en servidor con tesoreria:leer_comprobantes, no con ventas:leer", { todo: true }, () => {
  for (const ruta of [CONTRATO.rutaListado, CONTRATO.rutaDetalle, CONTRATO.rutaPdf]) {
    const fuente = leer(ruta);
    assert.match(fuente, /withPermission\(\s*(PERMISO_LEER_COMPROBANTES|"tesoreria:leer_comprobantes")/, ruta);
    assert.doesNotMatch(fuente, /PERMISO_VENTAS_LEER|"ventas:leer"/, ruta);
  }
  if (existsSync(new URL(CONTRATO.servicio, import.meta.url))) {
    assert.match(leer(CONTRATO.servicio), /PERMISO_LEER_COMPROBANTES\s*=\s*"tesoreria:leer_comprobantes"/);
  }
});

test("CA6 · Sidebar: ítem Comprobantes en Tesorería, con su permiso y en el orden acordado", { todo: true }, () => {
  const sidebar = leer(CONTRATO.sidebar);
  const tesoreria = sidebar.slice(sidebar.indexOf('label: "Tesorería"'));
  const item = /label:\s*"Comprobantes",\s*href:\s*"\/tesoreria\/comprobantes",\s*icon:\s*\w+,\s*permiso:\s*"tesoreria:leer_comprobantes"/;
  assert.match(tesoreria, item);
  // Orden fijo del grupo (doc Sprint 5): … Cuentas propias, Comprobantes, Libro de IVA, Alertas.
  const posicion = (label: string) => tesoreria.indexOf(`label: "${label}"`);
  assert.ok(posicion("Cuentas por Pagar") < posicion("Comprobantes"));
  for (const posterior of ["Libro de IVA", "Alertas"]) {
    if (posicion(posterior) >= 0) assert.ok(posicion("Comprobantes") < posicion(posterior), posterior);
  }
});

// ── Decisión 4 · QR válido = PNG decodificable con el payload de HU-B7 ──────
// No son `todo`: cubren lo que el Cluster 4 ya implementó (seed) y el
// contrato de B7 del que depende la descarga.

test("Decisión 4 · el QR que emite HU-B7 es un PNG decodificable con su payload", async () => {
  const creados: Record<string, unknown>[] = [];
  const servicioB7 = cargarModulo<{
    emitirComprobanteFiscal: (tx: unknown, params: Record<string, unknown>) => Promise<{ qr_data_url: string; cae_simulado: string }>;
  }>("../ventas/comprobante-fiscal.service.ts", {
    "server-only": {},
    // `import QRCode from "qrcode"` transpilado a CommonJS sin esModuleInterop lee `.default`.
    qrcode: { default: requireReal("qrcode") },
    "@prisma/client": { TipoComprobanteVenta: { NOTA_CREDITO: "NOTA_CREDITO" } },
    "@/lib/db/prisma": { prisma: {} },
    "@/lib/errors/service-error": { ServiceError },
  });
  const tx = { comprobanteFiscal: { create: async ({ data }: { data: Record<string, unknown> }) => creados.push(data) } };
  const emitido = await servicioB7.emitirComprobanteFiscal(tx, {
    pedido_venta_id: "c0000000-0000-4000-8000-0000000000aa",
    numero_venta: "V-2026-000001",
    tipo_comprobante: "TICKET",
    monto_total: 45000,
    emitido_por_id: "c0000000-0000-4000-8000-0000000000bb",
  });
  assert.equal(creados[0]!.qr_data_url, emitido.qr_data_url, "persiste el mismo QR que devuelve");
  assert.deepEqual(
    JSON.parse(decodificarQr(emitido.qr_data_url)),
    payloadB7("V-2026-000001", "TICKET", 45000, emitido.cae_simulado),
  );
});

test("Decisión 4 · el seed del Cluster 4 regenera los QR con el mismo payload y opciones que HU-B7", () => {
  const servicio = leer("../ventas/comprobante-fiscal.service.ts");
  const cuerpoB7 = servicio.slice(servicio.indexOf("async function generarQrSimulado("), servicio.indexOf("export async function emitirComprobanteFiscal("));
  const cuerpoSeed = cuerpoSeedCluster4();
  const claves = (fuente: string) =>
    [...(/JSON\.stringify\(\{([\s\S]*?)\}\)|const payload = \{([\s\S]*?)\};/.exec(fuente)?.slice(1).find(Boolean) ?? "")
      .matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);

  assert.deepEqual(claves(cuerpoSeed), claves(cuerpoB7));
  assert.deepEqual(claves(cuerpoB7), Object.keys(payloadB7("", "", 0, "")));
  assert.match(cuerpoSeed, /errorCorrectionLevel: "M"/);
  assert.match(servicio, /CUIT_EMISOR_SIMULADO = "30000000007"/);
  assert.match(cuerpoSeed, /cuitEmisor: "30000000007"/);
  // El placeholder viejo solo aparece como filtro de las filas a corregir.
  assert.equal(cuerpoSeed.match(/SIMULADO-SEED-NO-AFIP/g)?.length, 1);
  assert.match(cuerpoSeed, /where: \{ qr_data_url: "data:image\/png;base64,SIMULADO-SEED-NO-AFIP==" \}/);
});
