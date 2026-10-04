import assert from "node:assert/strict";
import test from "node:test";
import {
  ActualizarFotoWebSchema,
  CrearContenidoWebSchema,
  EditarContenidoWebSchema,
  ListarCatalogoQuerySchema,
  SubirFotoMultipartSchema,
  SubirFotoProductoSchema,
} from "./ecommerce.schema.ts";

/** HU-E11 (spec E §2.11; task_relos.md §2, §6.1, D16, D19, D20) — schemas de contenido, fotos y listado. */

const UUID = "0b9f2d4e-1c2a-4f3b-9d8e-7a6b5c4d3e2f";
const CAMPO_EXTRA = "El cuerpo contiene campos no permitidos";
const formErrors = (r: { success: boolean; error?: { flatten: () => { formErrors: string[] } } }) =>
  r.error?.flatten().formErrors ?? [];
const camposConError = (r: { success: boolean; error?: { flatten: () => { fieldErrors: object } } }) =>
  Object.keys(r.error?.flatten().fieldErrors ?? {});

test("CrearContenidoWebSchema: válido, con trim", () => {
  assert.deepEqual(
    CrearContenidoWebSchema.parse({ producto_maestro_id: UUID, titulo_comercial: "  Gorra  ", descripcion: " Linda " }),
    { producto_maestro_id: UUID, titulo_comercial: "Gorra", descripcion: "Linda" },
  );
});

test("CrearContenidoWebSchema: id no UUID, textos vacíos o de solo espacios, faltantes y campo extra → error", () => {
  assert.deepEqual(camposConError(CrearContenidoWebSchema.safeParse({ producto_maestro_id: "x", titulo_comercial: "a", descripcion: "b" })), ["producto_maestro_id"]);
  assert.deepEqual(camposConError(CrearContenidoWebSchema.safeParse({ producto_maestro_id: UUID, titulo_comercial: "   ", descripcion: "b" })), ["titulo_comercial"]);
  assert.deepEqual(camposConError(CrearContenidoWebSchema.safeParse({ producto_maestro_id: UUID, titulo_comercial: "a", descripcion: "" })), ["descripcion"]);
  assert.deepEqual(camposConError(CrearContenidoWebSchema.safeParse({})).sort(), ["descripcion", "producto_maestro_id", "titulo_comercial"]);
  const extra = CrearContenidoWebSchema.safeParse({ producto_maestro_id: UUID, titulo_comercial: "a", descripcion: "b", visibilidad_web: true });
  assert.deepEqual(formErrors(extra), [CAMPO_EXTRA]);
  for (const raiz of [null, [], "texto"]) assert.equal(CrearContenidoWebSchema.safeParse(raiz).success, false);
});

test("EditarContenidoWebSchema: ninguno → error; uno → ok; ambos → ok; extra → error; vacío → error", () => {
  assert.deepEqual(formErrors(EditarContenidoWebSchema.safeParse({})), ["Debe indicar al menos un campo a modificar"]);
  assert.deepEqual(EditarContenidoWebSchema.parse({ titulo_comercial: " Nuevo " }), { titulo_comercial: "Nuevo" });
  assert.deepEqual(EditarContenidoWebSchema.parse({ descripcion: "Otra" }), { descripcion: "Otra" });
  assert.deepEqual(EditarContenidoWebSchema.parse({ titulo_comercial: "T", descripcion: "D" }), { titulo_comercial: "T", descripcion: "D" });
  assert.deepEqual(formErrors(EditarContenidoWebSchema.safeParse({ titulo_comercial: "T", visibilidad_web: true })), [CAMPO_EXTRA]);
  assert.deepEqual(formErrors(EditarContenidoWebSchema.safeParse({ descripcion: "D", producto_maestro_id: UUID })), [CAMPO_EXTRA]);
  assert.deepEqual(camposConError(EditarContenidoWebSchema.safeParse({ descripcion: "   " })), ["descripcion"]);
});

test("ActualizarFotoWebSchema: las dos operaciones válidas", () => {
  assert.deepEqual(ActualizarFotoWebSchema.parse({ es_principal: true }), { es_principal: true });
  assert.deepEqual(ActualizarFotoWebSchema.parse({ deletion_reason: "  Vieja  " }), { deletion_reason: "Vieja" });
});

test("ActualizarFotoWebSchema: ambas, ninguna, es_principal false, motivo vacío y campo extra → error", () => {
  const exactamenteUna = "Indicá exactamente una operación: marcar como principal o dar de baja con motivo";
  assert.deepEqual(formErrors(ActualizarFotoWebSchema.safeParse({ es_principal: true, deletion_reason: "x" })), [exactamenteUna]);
  assert.deepEqual(formErrors(ActualizarFotoWebSchema.safeParse({})), [exactamenteUna]);
  assert.deepEqual(camposConError(ActualizarFotoWebSchema.safeParse({ es_principal: false })), ["es_principal"]);
  assert.deepEqual(camposConError(ActualizarFotoWebSchema.safeParse({ deletion_reason: "   " })), ["deletion_reason"]);
  assert.deepEqual(formErrors(ActualizarFotoWebSchema.safeParse({ es_principal: true, orden: 2 })), [CAMPO_EXTRA]);
  for (const raiz of [null, [], "x"]) assert.equal(ActualizarFotoWebSchema.safeParse(raiz).success, false);
});

test("SubirFotoProductoSchema (resultado del Gateway, D19): URL absoluta o ruta que empieza con /", () => {
  assert.deepEqual(SubirFotoProductoSchema.parse({ url: `/api/tienda/fotos/${UUID}.jpg` }), {
    url: `/api/tienda/fotos/${UUID}.jpg`,
    es_principal: false,
  });
  assert.equal(SubirFotoProductoSchema.parse({ url: "https://cdn.ejemplo.com/a.webp", es_principal: true }).es_principal, true);
  for (const url of ["fotos/a.jpg", "//otro-host/a.jpg", "", "/ con espacios"]) {
    assert.equal(SubirFotoProductoSchema.safeParse({ url }).success, false, url);
  }
});

test("SubirFotoMultipartSchema: archivo obligatorio y único; es_principal solo \"true\"/\"false\"; sin campos extra", () => {
  const archivo = new File([new Uint8Array([1])], "x.jpg");
  assert.equal(SubirFotoMultipartSchema.parse({ archivo }).es_principal, false);
  assert.equal(SubirFotoMultipartSchema.parse({ archivo, es_principal: "true" }).es_principal, true);
  assert.deepEqual(camposConError(SubirFotoMultipartSchema.safeParse({})), ["archivo"]);
  assert.deepEqual(camposConError(SubirFotoMultipartSchema.safeParse({ archivo: "texto" })), ["archivo"]);
  assert.deepEqual(camposConError(SubirFotoMultipartSchema.safeParse({ archivo: [archivo, archivo] })), ["archivo"]);
  assert.deepEqual(camposConError(SubirFotoMultipartSchema.safeParse({ archivo, es_principal: "si" })), ["es_principal"]);
  assert.deepEqual(formErrors(SubirFotoMultipartSchema.safeParse({ archivo, url: "/x" })), [CAMPO_EXTRA]);
});

test("ListarCatalogoQuerySchema: valores válidos, defaults y parámetros extra ignorados", () => {
  assert.deepEqual(ListarCatalogoQuerySchema.parse({}), { orden: "novedad", page: 1, page_size: 12 });
  const completo = ListarCatalogoQuerySchema.parse({
    q: " gorra ",
    categoria: "Accesorios",
    talle: "M",
    color: "Negro",
    genero: "UNISEX",
    modelo: "Operativa",
    orden: "precio_desc",
    page: "2",
    page_size: "24",
    utm_source: "ignorado",
  });
  assert.deepEqual(completo, {
    q: "gorra",
    categoria: "Accesorios",
    talle: "M",
    color: "Negro",
    genero: "UNISEX",
    modelo: "Operativa",
    orden: "precio_desc",
    page: 2,
    page_size: 24,
  });
  // Un valor inexistente de filtro es válido: el servicio devuelve lista vacía (D20b).
  assert.equal(ListarCatalogoQuerySchema.safeParse({ talle: "XXXL-no-existe" }).success, true);
});

test("ListarCatalogoQuerySchema: orden desconocido, page/page_size inválidos y largos excesivos → error", () => {
  assert.deepEqual(camposConError(ListarCatalogoQuerySchema.safeParse({ orden: "barato" })), ["orden"]);
  assert.deepEqual(camposConError(ListarCatalogoQuerySchema.safeParse({ page: "0" })), ["page"]);
  assert.deepEqual(camposConError(ListarCatalogoQuerySchema.safeParse({ page: "abc" })), ["page"]);
  assert.deepEqual(camposConError(ListarCatalogoQuerySchema.safeParse({ page_size: "49" })), ["page_size"]);
  assert.deepEqual(camposConError(ListarCatalogoQuerySchema.safeParse({ color: "x".repeat(101) })), ["color"]);
});
