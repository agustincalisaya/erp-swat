/**
 * Sprint 5 · Cluster 4 — HU-G3, matriz HTTP de las tres rutas GET.
 *
 * Ejecuta los Route Handlers reales con el `withPermission` real
 * (`with-permission.ts`), el servicio, el schema y el generador de PDF reales.
 * Solo se reemplazan la sesión y Prisma por dobles en memoria (mismo patrón de
 * carga aislada que `comprobantes-repositorio.test.ts`). La matriz de roles
 * del doble de RBAC se arma leyendo `seedSprint5Cluster4()` del seed, así que
 * un cambio en las asignaciones del seed cambia lo que se prueba acá.
 *
 * Cubre: 401 sin sesión, 403 para Gerente y para un usuario con solo
 * `ventas:leer`, 200 para los 4 roles habilitados, 400 por id mal formado y
 * por filtros inválidos, 404 por id inexistente, PDF válido con la leyenda de
 * simulado, PDF `inline` / `attachment` según `?disposicion=` (400 si es
 * desconocida), 422 por QR histórico inválido, vínculo NC ↔ original por HTTP
 * y ausencia de cualquier operación de escritura sobre la base.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInThisContext } from "node:vm";
import { inflateSync } from "node:zlib";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { ServiceError } from "../../errors/service-error.ts";
import * as fechaNegocio from "../../utils/fecha-negocio.ts";
import { cargarComprobantePdf } from "../ecommerce/comprobante-pdf.test-helpers.ts";

const requireReal = createRequire(import.meta.url);
const leer = (ruta: string) => readFileSync(new URL(ruta, import.meta.url), "utf8");

/**
 * Target moderno a propósito: con el ES5 por defecto de `transpileModule`,
 * una subclase de `Error` (`QrFiscalInvalidoError`) pierde su prototipo y el
 * `instanceof` de la ruta fallaría solo en el test, no en Next.
 */
function cargarModulo<T>(ruta: string, dependencias: Record<string, unknown>): T {
  const compilerOptions = { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 };
  const codigo = transpileModule(leer(ruta), { compilerOptions }).outputText;
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

const PERMISO = "tesoreria:leer_comprobantes";

// ── RBAC: roles con el permiso según el seed del Cluster 4 ──────────────────

function rolesSembradosConPermiso(): Set<string> {
  const seed = leer("../../../../prisma/seed.ts");
  const inicio = seed.indexOf("async function seedSprint5Cluster4(");
  const cuerpo = seed.slice(inicio, seed.indexOf("async function seedSprint5Cluster5(", inicio));
  const lista = /for \(const rol_id of \[([^\]]+)\]\)/.exec(cuerpo);
  assert.ok(lista, "seedSprint5Cluster4 asigna el permiso con un for sobre una lista de roles");
  return new Set(lista[1]!.split(",").map((rol) => rol.trim()));
}

const ROLES_CON_PERMISO = rolesSembradosConPermiso();

/** Usuario de prueba → constante de rol del seed (o permisos explícitos). */
const USUARIOS: Record<string, { rol?: string; permisos?: string[] }> = {
  "u-cajero": { rol: "ROL_CAJERO_POS_ID" },
  "u-tesorero": { rol: "ROL_TESORERO_ID" },
  "u-auditor": { rol: "ROL_AUDITOR_ID" },
  "u-admin": { rol: "ROL_ADMINISTRADOR_ID" },
  "u-gerente": { rol: "ROL_GERENTE_ID" },
  // `ventas:leer` abre `/api/ventas/comprobantes/[id]` (HU-B7), no el repositorio.
  "u-vendedor": { permisos: ["ventas:leer"] },
};

function tienePermiso(usuarioId: string, codigo: string): boolean {
  const usuario = USUARIOS[usuarioId];
  if (!usuario) return false;
  if (usuario.permisos) return usuario.permisos.includes(codigo);
  return codigo === PERMISO && ROLES_CON_PERMISO.has(usuario.rol!);
}

let sesionActual: { userId: string; nombreUsuario: string } | null = null;

const withPermission = cargarModulo<Record<string, unknown>>("../../auth/with-permission.ts", {
  "server-only": {},
  "@/lib/auth/session": { getServerSession: async () => sesionActual },
  "@/lib/db/prisma": {
    prisma: {
      usuarioRol: {
        findFirst: async ({ where }: { where: { usuario_id: string; rol: { permisos: { some: { permiso: { codigo: string } } } } } }) =>
          tienePermiso(where.usuario_id, where.rol.permisos.some.permiso.codigo) ? { id: "usuario-rol" } : null,
      },
    },
  },
});

// ── Datos: comprobantes archivados en un doble de Prisma que registra todo ──

const ID_TICKET = "c0000000-0000-4000-8000-000000000001";
const ID_FACTURA_WEB = "c0000000-0000-4000-8000-000000000002";
const ID_NC_WEB = "c0000000-0000-4000-8000-000000000003";
const ID_QR_INVALIDO = "c0000000-0000-4000-8000-000000000004";
const ID_INEXISTENTE = "c0000000-0000-4000-8000-0000000000ff";

async function qrB7(numero: string, tipo: string, importe: number, cae: string): Promise<string> {
  const QRCode = requireReal("qrcode") as { toDataURL: (texto: string, opciones: object) => Promise<string> };
  const payload = { ver: 1, simulado: true, cuitEmisor: "30000000007", tipoComprobante: tipo, numeroComprobante: numero, importe, moneda: "PES", cae };
  return QRCode.toDataURL(JSON.stringify(payload), { errorCorrectionLevel: "M" });
}

const decimal = (valor: number) => ({ toFixed: (n: number) => valor.toFixed(n) });
const vinculado = (id: string, tipo: string, numero_venta: string) => ({ id, tipo_comprobante: tipo, pedido_venta: { numero_venta } });
/** HU-B10: ítems y pagos activos del pedido, como los proyecta `SELECT_DETALLE_PDF`. */
const item = (descripcion: string, precio: number) => ({
  cantidad: 1,
  precio_unitario: decimal(precio),
  descuento_porcentual: null,
  variante_sku: { sku: "SKU-1", modelo: "Combate", talle: "42", color: "Negro", genero: "HOMBRE", producto_maestro: { nombre: descripcion } },
});
const pago = (medio: string, importe: number, referencia: string | null) => ({ medio, importe: decimal(importe), referencia });

const FILAS = [
  {
    id: ID_NC_WEB,
    tipo_comprobante: "NOTA_CREDITO",
    cae_simulado: "22222222222222",
    qr_data_url: await qrB7("NC-V-2026-000002", "NOTA_CREDITO", 10000, "22222222222222"),
    es_simulado: true,
    monto_total: decimal(10000),
    comprobante_original_id: ID_FACTURA_WEB,
    created_at: new Date("2026-10-09T15:30:00.000Z"),
    pedido_venta: { numero_venta: "V-2026-000002", canal: "WEB", cliente: { dni: "30987654", nombre: "María Gómez" }, items: [item("Camisa Táctica", 10000)], medios_pago: [pago("MERCADO_PAGO", 10000, "1320000000002")] },
    comprobante_original: { ...vinculado(ID_FACTURA_WEB, "FACTURA_B", "V-2026-000002"), created_at: new Date("2026-10-08T15:30:00.000Z") },
    notas_credito: [],
  },
  {
    id: ID_FACTURA_WEB,
    tipo_comprobante: "FACTURA_B",
    cae_simulado: "11111111111111",
    qr_data_url: await qrB7("V-2026-000002", "FACTURA_B", 10000, "11111111111111"),
    es_simulado: true,
    monto_total: decimal(10000),
    comprobante_original_id: null,
    created_at: new Date("2026-10-08T15:30:00.000Z"),
    pedido_venta: { numero_venta: "V-2026-000002", canal: "WEB", cliente: { dni: "30987654", nombre: "María Gómez" }, items: [item("Camisa Táctica", 10000)], medios_pago: [pago("MERCADO_PAGO", 10000, "1320000000002")] },
    comprobante_original: null,
    notas_credito: [vinculado(ID_NC_WEB, "NOTA_CREDITO", "V-2026-000002")],
  },
  {
    id: ID_TICKET,
    tipo_comprobante: "TICKET",
    cae_simulado: "68031598274563",
    qr_data_url: await qrB7("V-2026-000001", "TICKET", 45000, "68031598274563"),
    es_simulado: true,
    monto_total: decimal(45000),
    comprobante_original_id: null,
    created_at: new Date("2026-10-07T15:30:00.000Z"),
    pedido_venta: { numero_venta: "V-2026-000001", canal: "MOSTRADOR", cliente: null, items: [item("Borcegos", 45000)], medios_pago: [pago("EFECTIVO", 45000, null)] },
    comprobante_original: null,
    notas_credito: [],
  },
  {
    id: ID_QR_INVALIDO,
    tipo_comprobante: "FACTURA_B",
    cae_simulado: "33333333333333",
    qr_data_url: "data:image/png;base64,SIMULADO-SEED-NO-AFIP==",
    es_simulado: true,
    monto_total: decimal(1000),
    comprobante_original_id: null,
    created_at: new Date("2026-10-06T15:30:00.000Z"),
    pedido_venta: { numero_venta: "V-2026-000009", canal: "MOSTRADOR", cliente: null, items: [], medios_pago: [] },
    comprobante_original: null,
    notas_credito: [],
  },
];

/** Toda operación que llega a la base: `modelo.metodo`. */
const operaciones: string[] = [];
const comprobanteFiscal = {
  findMany: async () => FILAS,
  count: async () => FILAS.length,
  findUnique: async ({ where }: { where: { id: string } }) => FILAS.find((f) => f.id === where.id) ?? null,
};
const prismaDatos = new Proxy({} as Record<string, unknown>, {
  get: (_, modelo: string) =>
    new Proxy({} as Record<string, unknown>, {
      get: (__, metodo: string) => {
        operaciones.push(`${modelo}.${metodo}`);
        const real = modelo === "comprobanteFiscal" ? comprobanteFiscal[metodo as keyof typeof comprobanteFiscal] : undefined;
        return real ?? (async () => assert.fail(`operación inesperada sobre la base: ${modelo}.${metodo}`));
      },
    }),
});

const schema = cargarModulo<Record<string, unknown>>("../../schemas/comprobantes-repositorio.schema.ts", {});
const pdf = cargarComprobantePdf();
const servicio = cargarModulo<Record<string, unknown>>("./comprobantes-repositorio.service.ts", {
  "server-only": {},
  "@/lib/db/prisma": { prisma: prismaDatos },
  "@/lib/errors/service-error": { ServiceError },
  "@/lib/utils/fecha-negocio": fechaNegocio,
  "@/lib/services/ecommerce/comprobante-web-pdf": pdf,
});

type Handler = (req: unknown, context?: unknown) => Promise<Response>;

function cargarRuta(ruta: string): Handler {
  return cargarModulo<{ GET: Handler }>(ruta, {
    "@/lib/auth/with-permission": withPermission,
    "@/lib/errors/service-error": { ServiceError },
    "@/lib/schemas/comprobantes-repositorio.schema": schema,
    "@/lib/services/tesoreria/comprobantes-repositorio.service": servicio,
    "@/lib/services/ecommerce/comprobante-web-pdf": pdf,
  }).GET;
}

const RUTAS = {
  listado: "../../../app/api/tesoreria/comprobantes/route.ts",
  detalle: "../../../app/api/tesoreria/comprobantes/[id]/route.ts",
  pdf: "../../../app/api/tesoreria/comprobantes/[id]/pdf/route.ts",
} as const;

const GET = { listado: cargarRuta(RUTAS.listado), detalle: cargarRuta(RUTAS.detalle), pdf: cargarRuta(RUTAS.pdf) };

const { NextRequest } = requireReal("next/server") as typeof import("next/server");

function llamar(ruta: keyof typeof GET, { query = "", id = ID_TICKET, usuario }: { query?: string; id?: string; usuario: string | null }) {
  sesionActual = usuario ? { userId: usuario, nombreUsuario: usuario } : null;
  const sufijo = ruta === "listado" ? "" : ruta === "detalle" ? `/${id}` : `/${id}/pdf`;
  const req = new NextRequest(`http://localhost/api/tesoreria/comprobantes${sufijo}${query}`);
  return GET[ruta](req, { params: Promise.resolve({ id }) });
}

async function cuerpo(respuesta: Response) {
  return respuesta.json() as Promise<{ data: Record<string, unknown> | null; error: { code: string; message: string } | null }>;
}

async function textoPdf(bytes: Uint8Array): Promise<string> {
  const pdfLib = requireReal("pdf-lib") as typeof import("pdf-lib");
  const documento = await pdfLib.PDFDocument.load(bytes);
  const contents = documento.getPage(0).node.Contents()!;
  const refs = contents instanceof pdfLib.PDFArray ? contents.asArray() : [contents];
  const operadores = refs
    .map((ref) => {
      const stream = documento.context.lookup(ref);
      assert.ok(stream instanceof pdfLib.PDFRawStream);
      return inflateSync(stream.getContents()).toString("latin1");
    })
    .join("\n");
  return [...operadores.matchAll(/<([0-9A-F]+)> Tj/g)]
    .map((m) => Buffer.from(m[1]!, "hex").toString("latin1").replace(/\x97/g, "—"))
    .join("\n");
}

const RUTAS_G3 = ["listado", "detalle", "pdf"] as const;
const HABILITADOS = ["u-cajero", "u-tesorero", "u-auditor", "u-admin"];

// ── G3-6: autenticación y permiso en servidor ───────────────────────────────

test("G3-6 · el seed habilita exactamente a Cajero POS, Tesorero, Auditor y Administrador", () => {
  assert.deepEqual(
    [...ROLES_CON_PERMISO].sort(),
    ["ROL_ADMINISTRADOR_ID", "ROL_AUDITOR_ID", "ROL_CAJERO_POS_ID", "ROL_TESORERO_ID"],
  );
});

test("G3-6 · sin sesión interna las tres rutas responden 401 (la sesión de Cliente Web de E9 no cuenta)", async () => {
  for (const ruta of RUTAS_G3) {
    const respuesta = await llamar(ruta, { usuario: null });
    assert.equal(respuesta.status, 401, ruta);
    assert.equal((await cuerpo(respuesta)).error?.code, "UNAUTHORIZED", ruta);
  }
  for (const ruta of Object.values(RUTAS)) {
    assert.doesNotMatch(leer(ruta), /withSesionClienteWeb|sesion-cliente-web|swat_tienda_session/, ruta);
  }
});

test("G3-6 · el Gerente recibe 403 en listado, vista y descarga", async () => {
  for (const ruta of RUTAS_G3) {
    const respuesta = await llamar(ruta, { usuario: "u-gerente" });
    assert.equal(respuesta.status, 403, ruta);
    assert.equal((await cuerpo(respuesta)).error?.code, "FORBIDDEN", ruta);
  }
});

test("G3-6 · un usuario con ventas:leer pero sin el permiso recibe 403", async () => {
  for (const ruta of RUTAS_G3) {
    assert.equal((await llamar(ruta, { usuario: "u-vendedor" })).status, 403, ruta);
  }
});

test("G3-6 · los 4 roles habilitados reciben 200 en listado, vista y descarga", async () => {
  for (const usuario of HABILITADOS) {
    for (const ruta of RUTAS_G3) {
      const respuesta = await llamar(ruta, { usuario });
      assert.equal(respuesta.status, 200, `${usuario} ${ruta}`);
    }
  }
});

// ── G3-1/G3-2: listado ──────────────────────────────────────────────────────

test("G3-1 · el listado trae ambos canales con el envelope y la paginación del precedente", async () => {
  const respuesta = await llamar("listado", { usuario: "u-tesorero" });
  const { data, error } = await cuerpo(respuesta);
  assert.equal(error, null);
  assert.deepEqual(Object.keys(data!).sort(), ["page", "page_size", "registros", "total"]);
  const registros = data!.registros as { canal: string; cliente: unknown; monto_total: string }[];
  assert.deepEqual([...new Set(registros.map((r) => r.canal))].sort(), ["MOSTRADOR", "WEB"]);
  assert.deepEqual(registros[2]!.cliente, { dni: null, nombre: "Consumidor final" });
  assert.equal(registros[2]!.monto_total, "45000.00");
  assert.deepEqual([data!.page, data!.page_size, data!.total], [1, 25, 4]);
});

test("G3-2 · filtros inválidos responden 400 VALIDATION_ERROR sin consultar la base", async () => {
  for (const query of ["?page_size=101", "?tipo=FACTURA_C", "?canal=TELEFONO", "?fecha_desde=2026-02-30", "?fecha_desde=2026-10-31&fecha_hasta=2026-10-01"]) {
    const antes = operaciones.length;
    const respuesta = await llamar("listado", { usuario: "u-auditor", query });
    assert.equal(respuesta.status, 400, query);
    assert.equal((await cuerpo(respuesta)).error?.code, "VALIDATION_ERROR", query);
    assert.equal(operaciones.length, antes, `${query} no llega a la base`);
  }
});

// ── G3-3/G3-4: vista, vínculos y PDF ────────────────────────────────────────

test("G3-4 · la vista de la NC trae su original y la del original trae sus NC", async () => {
  const nc = (await cuerpo(await llamar("detalle", { usuario: "u-admin", id: ID_NC_WEB }))).data!;
  assert.deepEqual(nc.comprobante_original, { comprobante_id: ID_FACTURA_WEB, tipo_comprobante: "FACTURA_B", numero: "V-2026-000002" });
  assert.equal(nc.numero, "NC-V-2026-000002");

  const original = (await cuerpo(await llamar("detalle", { usuario: "u-admin", id: ID_FACTURA_WEB }))).data!;
  assert.equal(original.comprobante_original, null);
  assert.deepEqual(original.notas_credito, [{ comprobante_id: ID_NC_WEB, tipo_comprobante: "NOTA_CREDITO", numero: "NC-V-2026-000002" }]);
  assert.equal(original.cae_simulado, "11111111111111");
  assert.equal("qr_data_url" in original, false, "la vista JSON no arrastra el PNG del QR");
});

test("G3-3 · id mal formado → 400 y id inexistente → 404, en vista y descarga", async () => {
  for (const ruta of ["detalle", "pdf"] as const) {
    const malFormado = await llamar(ruta, { usuario: "u-cajero", id: "no-es-un-uuid" });
    assert.equal(malFormado.status, 400, ruta);
    assert.equal((await cuerpo(malFormado)).error?.code, "VALIDATION_ERROR", ruta);

    const inexistente = await llamar(ruta, { usuario: "u-cajero", id: ID_INEXISTENTE });
    assert.equal(inexistente.status, 404, ruta);
    assert.equal((await cuerpo(inexistente)).error?.code, "COMPROBANTE_NO_ENCONTRADO", ruta);
  }
});

test("G3-3 · el PDF de mostrador y el de la NC web son application/pdf con CAE, QR y la leyenda de simulado", async () => {
  for (const [id, datos] of [
    // HU-B10: rótulos del diseño nuevo (spec_modulo_B.md §2.10), con ítems y pagos del pedido.
    [ID_TICKET, ["TICKET", "COD. 083", "N.° 00001-26000001", "V-2026-000001", "68031598274563", "Mostrador", "Consumidor final", "Borcegos", "Efectivo", "$ 45.000,00"]],
    [ID_NC_WEB, [
      "NOTA DE CRÉDITO", "COD. 008", "NC-V-2026-000002", "22222222222222", "Web", "María Gómez", "DNI 30987654",
      "ANULA", "Factura B N.° 00001-26000002  ·  Pedido V-2026-000002  ·  emitida el 08/10/2026",
      "COBRADO EN LA VENTA ORIGINAL", "Mercado Pago  ·  ref. 1320000000002", "TOTAL ACREDITADO", "-$ 10.000,00",
    ]],
  ] as const) {
    const respuesta = await llamar("pdf", { usuario: "u-tesorero", id });
    assert.equal(respuesta.status, 200);
    assert.equal(respuesta.headers.get("content-type"), "application/pdf");
    assert.match(respuesta.headers.get("content-disposition") ?? "", /^attachment; filename="comprobante-[A-Za-z0-9-]+\.pdf"$/);
    assert.equal(respuesta.headers.get("cache-control"), "private, no-store");
    const bytes = new Uint8Array(await respuesta.arrayBuffer());
    assert.equal(Buffer.from(bytes.subarray(0, 5)).toString(), "%PDF-");
    const texto = await textoPdf(bytes);
    assert.ok(texto.includes("SIMULADO — SIN VALIDEZ FISCAL ANTE AFIP"), id);
    for (const dato of datos) assert.ok(texto.includes(dato), `${id}: ${dato}`);
  }
});

test("G3-3 · un QR histórico inválido responde 422 COMPROBANTE_QR_INVALIDO, nunca un PDF", async () => {
  const respuesta = await llamar("pdf", { usuario: "u-tesorero", id: ID_QR_INVALIDO });
  assert.equal(respuesta.status, 422);
  assert.match(respuesta.headers.get("content-type") ?? "", /application\/json/);
  const { data, error } = await cuerpo(respuesta);
  assert.equal(data, null);
  assert.equal(error?.code, "COMPROBANTE_QR_INVALIDO");
});

test("G3-3 · ?disposicion=inline abre el PDF en el navegador; sin parámetro o con attachment se descarga", async () => {
  for (const [query, disposicion] of [
    ["?disposicion=inline", "inline"],
    ["", "attachment"],
    ["?disposicion=attachment", "attachment"],
    ["?disposicion=", "attachment"],
  ] as const) {
    const respuesta = await llamar("pdf", { usuario: "u-cajero", id: ID_NC_WEB, query });
    assert.equal(respuesta.status, 200, query);
    assert.equal(respuesta.headers.get("content-type"), "application/pdf", query);
    assert.equal(
      respuesta.headers.get("content-disposition"),
      `${disposicion}; filename="comprobante-NC-V-2026-000002.pdf"`,
      query,
    );
    assert.equal(Buffer.from(new Uint8Array(await respuesta.arrayBuffer()).subarray(0, 5)).toString(), "%PDF-", query);
  }
});

test("G3-3 · una disposición desconocida responde 400 VALIDATION_ERROR sin consultar la base", async () => {
  for (const query of ["?disposicion=descargar", "?disposicion=INLINE"]) {
    const antes = operaciones.length;
    const respuesta = await llamar("pdf", { usuario: "u-cajero", id: ID_NC_WEB, query });
    assert.equal(respuesta.status, 400, query);
    assert.equal((await cuerpo(respuesta)).error?.code, "VALIDATION_ERROR", query);
    assert.equal(operaciones.length, antes, `${query} no llega a la base`);
  }
});

test("G3-3 · ?disposicion=inline mantiene el permiso y el 422 del QR inválido", async () => {
  assert.equal((await llamar("pdf", { usuario: "u-gerente", id: ID_NC_WEB, query: "?disposicion=inline" })).status, 403);
  assert.equal((await llamar("pdf", { usuario: null, id: ID_NC_WEB, query: "?disposicion=inline" })).status, 401);
  const invalido = await llamar("pdf", { usuario: "u-tesorero", id: ID_QR_INVALIDO, query: "?disposicion=inline" });
  assert.equal(invalido.status, 422);
  assert.equal((await cuerpo(invalido)).error?.code, "COMPROBANTE_QR_INVALIDO");
});

// ── G3-5: solo lectura ──────────────────────────────────────────────────────

test("G3-5 · ninguna llamada de esta matriz escribió en la base: solo findMany, count y findUnique", () => {
  assert.ok(operaciones.length > 0);
  assert.deepEqual(
    [...new Set(operaciones)].sort(),
    ["comprobanteFiscal.count", "comprobanteFiscal.findMany", "comprobanteFiscal.findUnique"],
  );
});
