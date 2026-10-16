/**
 * Sprint 5 · Cluster 4 — HU-G3, vista de detalle `/tesoreria/comprobantes/[id]`
 * (G3-3 "se visualiza" y G3-4 "la vista de la NC enlaza el original").
 *
 * Ejecuta el Server Component real: se transpila `page.tsx` con un
 * `jsx-runtime` que arma el árbol como objetos planos (sin React ni DOM) y se
 * reemplazan sesión, RBAC, servicio y `next/navigation` por dobles. Así se
 * prueba el gate, el 404 y los `href` que la página realmente renderiza.
 * `comprobantes-presentacion.ts` y el schema se cargan reales.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInThisContext } from "node:vm";
import { JsxEmit, ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { ServiceError } from "../../errors/service-error.ts";
import * as fechaNegocio from "../../utils/fecha-negocio.ts";

const requireReal = createRequire(import.meta.url);
const leer = (ruta: string) => readFileSync(new URL(ruta, import.meta.url), "utf8");

function cargarModulo<T>(ruta: string, dependencias: Record<string, unknown>): T {
  const compilerOptions = { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022, jsx: JsxEmit.ReactJSX, esModuleInterop: true };
  const codigo = transpileModule(leer(ruta), { compilerOptions, fileName: ruta }).outputText;
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

// ── Dobles ──────────────────────────────────────────────────────────────────

class Redireccion extends Error {
  readonly destino: string;
  constructor(destino: string) {
    super(`redirect(${destino})`);
    this.destino = destino;
  }
}
class NoEncontrado extends Error {}

interface Nodo {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
}

const jsxRuntime = {
  Fragment: "Fragment",
  jsx: (type: unknown, props: Nodo["props"]): Nodo => ({ type, props }),
  jsxs: (type: unknown, props: Nodo["props"]): Nodo => ({ type, props }),
};
const componente = (nombre: string) => Object.assign(() => null, { displayName: nombre });

const ID_ORIGINAL = "1a2b3c4d-be05-4a1a-8a1a-000000000001";
const ID_NC = "1a2b3c4d-be05-4a1a-8a1a-000000000002";

const cliente = { dni: "30123456", nombre: "Juan Pérez" };
const DETALLES: Record<string, unknown> = {
  [ID_NC]: {
    comprobante_id: ID_NC,
    numero: "NC-V-2026-000001",
    tipo_comprobante: "NOTA_CREDITO",
    canal: "MOSTRADOR",
    cliente,
    fecha_emision: "2026-10-15T18:57:46.255Z",
    monto_total: "45000.00",
    es_simulado: true,
    comprobante_original: { comprobante_id: ID_ORIGINAL, tipo_comprobante: "FACTURA_B", numero: "V-2026-000001" },
    notas_credito: [],
    cae_simulado: "68031598279001",
  },
  [ID_ORIGINAL]: {
    comprobante_id: ID_ORIGINAL,
    numero: "V-2026-000001",
    tipo_comprobante: "FACTURA_B",
    canal: "MOSTRADOR",
    cliente,
    fecha_emision: "2026-10-15T18:57:44.851Z",
    monto_total: "45000.00",
    es_simulado: true,
    comprobante_original: null,
    notas_credito: [{ comprobante_id: ID_NC, tipo_comprobante: "NOTA_CREDITO", numero: "NC-V-2026-000001" }],
    cae_simulado: "68031598274563",
  },
};

let sesionActual: { userId: string } | null = null;
const PERMISOS: Record<string, boolean> = { "u-cajero": true, "u-gerente": false };
const consultas: string[] = [];

const presentacion = cargarModulo<Record<string, (...args: never[]) => unknown>>(
  "../../../components/tesoreria/comprobantes-presentacion.ts",
  {},
);

const pagina = cargarModulo<{ default: (props: unknown) => Promise<Nodo> }>(
  "../../../app/(dashboard)/tesoreria/comprobantes/[id]/page.tsx",
  {
    "react/jsx-runtime": jsxRuntime,
    "next/link": { __esModule: true, default: componente("Link") },
    "next/navigation": {
      redirect: (destino: string) => {
        throw new Redireccion(destino);
      },
      notFound: () => {
        throw new NoEncontrado();
      },
    },
    "lucide-react": new Proxy({}, { get: (_, icono: string) => componente(icono) }),
    "@/lib/auth/session": { getServerSession: async () => sesionActual },
    "@/lib/auth/with-permission": {
      usuarioTienePermiso: async (usuarioId: string, codigo: string) =>
        codigo === "tesoreria:leer_comprobantes" && PERMISOS[usuarioId] === true,
    },
    "@/lib/errors/service-error": { ServiceError },
    "@/lib/schemas/comprobantes-repositorio.schema": cargarModulo("../../schemas/comprobantes-repositorio.schema.ts", {}),
    "@/lib/services/tesoreria/comprobantes-repositorio.service": {
      PERMISO_LEER_COMPROBANTES: "tesoreria:leer_comprobantes",
      obtenerDetalleComprobante: async (id: string) => {
        consultas.push(id);
        const detalle = DETALLES[id];
        if (!detalle) throw new ServiceError("COMPROBANTE_NO_ENCONTRADO", "No se encontró el comprobante solicitado");
        return detalle;
      },
    },
    "@/lib/utils/fecha-negocio": fechaNegocio,
    "@/components/tesoreria/comprobantes-presentacion": presentacion,
    "@/components/ui/badge": { Badge: componente("Badge") },
    "@/components/ui/button": { buttonVariants: () => "boton" },
    "@/components/ui/card": {
      Card: componente("Card"),
      CardContent: componente("CardContent"),
      CardDescription: componente("CardDescription"),
      CardHeader: componente("CardHeader"),
      CardTitle: componente("CardTitle"),
    },
  },
).default;

function renderizar(usuario: string | null, id: string, query: Record<string, string> = {}) {
  sesionActual = usuario ? { userId: usuario } : null;
  return pagina({ params: Promise.resolve({ id }), searchParams: Promise.resolve(query) });
}

/** Texto plano de un subárbol (los íconos y componentes vacíos no aportan texto). */
function texto(nodo: unknown): string {
  if (nodo === null || nodo === undefined || typeof nodo === "boolean") return "";
  if (typeof nodo === "string" || typeof nodo === "number") return String(nodo);
  if (Array.isArray(nodo)) return nodo.map(texto).join("");
  return texto((nodo as Nodo).props?.children);
}

/** Todos los elementos con `href`, en orden de render: `{ href, texto, target }`. */
function enlaces(nodo: unknown, acumulado: { href: string; texto: string; target?: unknown }[] = []) {
  if (Array.isArray(nodo)) nodo.forEach((hijo) => enlaces(hijo, acumulado));
  else if (nodo && typeof nodo === "object" && "props" in nodo) {
    const { props } = nodo as Nodo;
    if (typeof props.href === "string") acumulado.push({ href: props.href, texto: texto(props.children).trim(), target: props.target });
    enlaces(props.children, acumulado);
  }
  return acumulado;
}

// ── Gate y 404 ──────────────────────────────────────────────────────────────

test("detalle · el Gerente (sin tesoreria:leer_comprobantes) es redirigido a /no-autorizado sin consultar", async () => {
  const antes = consultas.length;
  await assert.rejects(renderizar("u-gerente", ID_NC), (error) => error instanceof Redireccion && error.destino === "/no-autorizado");
  assert.equal(consultas.length, antes);
});

test("detalle · sin sesión redirige a /login", async () => {
  await assert.rejects(renderizar(null, ID_NC), (error) => error instanceof Redireccion && error.destino === "/login");
});

test("detalle · id mal formado o inexistente → notFound()", async () => {
  const antes = consultas.length;
  await assert.rejects(renderizar("u-cajero", "no-es-un-uuid"), NoEncontrado);
  assert.equal(consultas.length, antes, "un id mal formado no llega al servicio");
  await assert.rejects(renderizar("u-cajero", "c0000000-0000-4000-8000-0000000000ff"), NoEncontrado);
});

// ── G3-4: vínculos NC ↔ original ────────────────────────────────────────────

test("detalle · la NC muestra «Anula a» con link al detalle del original, conservando los filtros", async () => {
  const arbol = await renderizar("u-cajero", ID_NC, { cliente: "juan", page: "2", desconocido: "x" });
  const query = "cliente=juan&page=2";
  const links = enlaces(arbol);
  assert.ok(texto(arbol).includes("Anula a V-2026-000001"));
  assert.ok(links.some((l) => l.href === `/tesoreria/comprobantes/${ID_ORIGINAL}?${query}` && l.texto === "V-2026-000001"));
  assert.ok(!texto(arbol).includes("Notas de crédito"), "una NC no lista NC propias");
  assert.equal(links.find((l) => l.texto === "Volver al listado")?.href, `/tesoreria/comprobantes?${query}`);
  assert.ok(links.every((l) => !l.href.includes("desconocido")), "solo se arrastran los parámetros del listado");
});

test("detalle · el original lista sus Notas de crédito con link al detalle de cada una", async () => {
  const arbol = await renderizar("u-cajero", ID_ORIGINAL);
  const links = enlaces(arbol);
  assert.ok(texto(arbol).includes("Notas de crédito"));
  assert.ok(links.some((l) => l.href === `/tesoreria/comprobantes/${ID_NC}` && l.texto === "NC-V-2026-000001"));
  assert.ok(!texto(arbol).includes("Anula a"));
  assert.equal(links.find((l) => l.texto === "Volver al listado")?.href, "/tesoreria/comprobantes");
});

// ── G3-3: datos visibles y PDF ──────────────────────────────────────────────

test("detalle · muestra número, tipo, canal, cliente, fecha AR, total con − en la NC, CAE y el badge de simulado", async () => {
  const contenido = texto(await renderizar("u-cajero", ID_NC));
  for (const dato of [
    "NC-V-2026-000001",
    "Nota de Crédito",
    "Mostrador",
    "Juan Pérez",
    "DNI 30123456",
    fechaNegocio.formatearFechaNegocio("2026-10-15T18:57:46.255Z"),
    "− ",
    "68031598279001",
    "Simulado · sin validez ante AFIP",
  ]) {
    assert.ok(contenido.includes(dato), dato);
  }
  assert.ok(!texto(await renderizar("u-cajero", ID_ORIGINAL)).includes("− "), "el original no lleva signo negativo");
});

test("detalle · «Ver PDF» abre inline en pestaña nueva y «Descargar PDF» descarga, por la ruta gateada del repositorio", async () => {
  const links = enlaces(await renderizar("u-cajero", ID_NC));
  const ver = links.find((l) => l.texto === "Ver PDF");
  const descargar = links.find((l) => l.texto === "Descargar PDF");
  assert.equal(ver?.href, `/api/tesoreria/comprobantes/${ID_NC}/pdf?disposicion=inline`);
  assert.equal(ver?.target, "_blank");
  assert.equal(descargar?.href, `/api/tesoreria/comprobantes/${ID_NC}/pdf`);
  assert.equal(descargar?.target, undefined);
});

test("detalle · solo lectura: la página no ofrece acciones de edición ni baja (G3-5)", () => {
  const fuente = leer("../../../app/(dashboard)/tesoreria/comprobantes/[id]/page.tsx");
  assert.doesNotMatch(fuente, /method:\s*"(POST|PUT|PATCH|DELETE)"|<form|"use server"|fetch\(/);
});

// ── Presentación compartida con el listado ──────────────────────────────────

test("presentación · el query del listado conserva solo parámetros conocidos y no vacíos", () => {
  const query = presentacion.queryListadoComprobantes as (p: unknown) => string;
  assert.equal(query({ cliente: " juan ", tipo: "", canal: ["WEB", "MOSTRADOR"], foo: "bar" }), "cliente=juan&canal=WEB");
  assert.equal(query(new URLSearchParams("page=3&page_size=50&x=1")), "page=3&page_size=50");
  assert.equal(query({}), "");
});

test("listado · el número y «Vinculado» linkean al detalle con los filtros activos", () => {
  const tabla = leer("../../../components/tesoreria/TablaComprobantes.tsx");
  assert.match(tabla, /hrefDetalleComprobante\(c\.comprobante_id, query\)/);
  assert.match(tabla, /enlacesVinculados\(comprobante, query\)/);
  assert.match(tabla, /hrefPdfComprobante\(c\.comprobante_id, "attachment"\)/);
});
