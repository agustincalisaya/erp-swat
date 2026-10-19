import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = process.env.HU_G12_URL ?? "http://127.0.0.1:3006";
const clave = process.env.HU_G12_SEED_PASSWORD ?? "abc123456789";
const ruta = "/api/tesoreria/categorias-gasto";

async function solicitud(metodo, path, cookie, body) {
  const respuesta = await fetch(base + path, {
    method: metodo,
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: respuesta.status, json: await respuesta.json(), cookie: respuesta.headers.get("set-cookie") };
}

async function login(email) {
  const respuesta = await solicitud("POST", "/api/auth/login", null, { email, password: clave });
  assert.equal(respuesta.status, 200, JSON.stringify(respuesta.json));
  return respuesta.cookie.split(";")[0];
}

const admin = await login("admin.seed@erp-swat.local");
const tesorero = await login("tesorero.seed@erp-swat.local");
const sinSesion = await solicitud("GET", ruta);
assert.equal(sinSesion.status, 401);
assert.equal(sinSesion.json.error.code, "UNAUTHORIZED");
const sinPermiso = await solicitud("GET", ruta, tesorero);
assert.equal(sinPermiso.status, 403);
assert.equal(sinPermiso.json.error.code, "FORBIDDEN");
assert.equal((await solicitud("POST", ruta, tesorero, { nombre: "No autorizado" })).status, 403);
const paginaTesorero = await fetch(`${base}/tesoreria/categorias-gasto`, { headers: { cookie: tesorero }, redirect: "manual" });
const cuerpoTesorero = await paginaTesorero.text();
assert.ok(paginaTesorero.headers.get("location")?.includes("/no-autorizado") || cuerpoTesorero.includes("/no-autorizado"));
assert.equal(cuerpoTesorero.includes("Sueldos"), false);
const paginaAdmin = await fetch(`${base}/tesoreria/categorias-gasto`, { headers: { cookie: admin } });
assert.equal(paginaAdmin.status, 200);

const nombre = `Prueba G12 ${randomUUID().slice(0, 8)}`;
const creada = await solicitud("POST", ruta, admin, { nombre: `  ${nombre}  `, descripcion: "temporal" });
assert.equal(creada.status, 201, JSON.stringify(creada.json));
const id = creada.json.data.id;
assert.equal(creada.json.data.nombre, nombre);
const duplicada = await solicitud("POST", ruta, admin, { nombre: ` ${nombre.toUpperCase()} ` });
assert.equal(duplicada.status, 409);
assert.equal(duplicada.json.error.code, "CATEGORIA_GASTO_DUPLICADA");
const sinCambios = await solicitud("PATCH", `${ruta}/${id}`, admin, { nombre, descripcion: "temporal" });
assert.equal(sinCambios.status, 200);
const editada = await solicitud("PATCH", `${ruta}/${id}`, admin, { descripcion: "" });
assert.equal(editada.status, 200);
assert.equal(editada.json.data.descripcion, null);
const motivoCorto = await solicitud("PATCH", `${ruta}/${id}/baja`, admin, { deletion_reason: " ab " });
assert.equal(motivoCorto.status, 400);
assert.equal(motivoCorto.json.error.code, "VALIDATION_ERROR");
const baja = await solicitud("PATCH", `${ruta}/${id}/baja`, admin, { deletion_reason: " Prueba de baja " });
assert.equal(baja.status, 200);
assert.equal(baja.json.data.is_active, false);
assert.equal((await solicitud("PATCH", `${ruta}/${id}`, admin, { nombre: `${nombre} editada` })).status, 409);
assert.equal((await solicitud("PATCH", `${ruta}/${id}/baja`, admin, { deletion_reason: "Otra baja" })).status, 409);
assert.equal((await solicitud("POST", ruta, admin, { nombre })).status, 409);
const activas = await solicitud("GET", ruta, admin);
assert.equal(activas.status, 200);
assert.equal(activas.json.data.some((categoria) => categoria.id === id), false);
const todas = await solicitud("GET", `${ruta}?incluir_inactivas=1`, admin);
assert.equal(todas.status, 200);
assert.equal(todas.json.data.some((categoria) => categoria.id === id), true);
const selector = await solicitud("GET", `${ruta}?selector=1`, tesorero);
assert.equal(selector.status, 200);
assert.equal(selector.json.data.some((categoria) => categoria.id === id), false);
assert.equal(selector.json.data.some((categoria) => categoria.nombre === "Sueldos"), true);
console.log(JSON.stringify({ id, nombre, resultados: { sinSesion: 401, sinPermiso: 403, alta: 201, duplicado: 409, edicion: 200, baja: 200, motivoCorto: 400 } }));
