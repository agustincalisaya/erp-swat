import assert from "node:assert/strict";
import test from "node:test";
import { enlacePaginaCatalogo, paginaCatalogoFueraDeRango } from "./catalogo-navegacion.ts";

test("paginación conserva búsqueda, filtros y orden, y cambia solo la página", () => {
  const activos = {
    q: "Equipo", categoria: "Prueba", talle: "M", color: "Oliva",
    genero: "HOMBRE", modelo: "Operativo",
  };
  const enlace = enlacePaginaCatalogo(activos, "precio_asc", 2);
  assert.equal(enlace.pathname, "/tienda/catalogo");
  assert.deepEqual(enlace.query, { ...activos, orden: "precio_asc", page: 2 });
  assert.deepEqual(enlacePaginaCatalogo({}, "novedad", 1).query, { page: 1 });
  assert.deepEqual(activos, {
    q: "Equipo", categoria: "Prueba", talle: "M", color: "Oliva",
    genero: "HOMBRE", modelo: "Operativo",
  });
});

test("una página posterior a la última tiene un estado propio", () => {
  assert.equal(paginaCatalogoFueraDeRango(1, 3), false);
  assert.equal(paginaCatalogoFueraDeRango(3, 3), false);
  assert.equal(paginaCatalogoFueraDeRango(9, 3), true);
  assert.equal(paginaCatalogoFueraDeRango(2, 1), true);
});
