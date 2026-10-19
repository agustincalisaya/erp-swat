import assert from "node:assert/strict";

const base = "http://localhost:3006";
const ruta = "/api/tesoreria/gastos-operativos";
async function pedir(method, path, cookie, body) {
  const response = await fetch(base + path, { method, headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json(), cookie: response.headers.get("set-cookie") };
}
async function login(email) {
  const r = await pedir("POST", "/api/auth/login", null, { email, password: "abc123456789" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.cookie.split(";")[0];
}
const tesorero = await login("tesorero.seed@erp-swat.local");
const admin = await login("admin.seed@erp-swat.local");
const cajero = await login("cajero.seed@erp-swat.local");
assert.equal((await pedir("GET", ruta)).status, 401);
assert.equal((await pedir("GET", ruta, admin)).status, 403);
assert.equal((await pedir("POST", ruta, cajero, { fecha: "2026-01-01" })).status, 403);
const pagina = await fetch(`${base}/tesoreria/gastos-operativos`, { headers: { cookie: tesorero } });
assert.equal(pagina.status, 200);
assert.ok((await pagina.text()).includes("Gastos operativos"));
const bloqueada = await fetch(`${base}/tesoreria/gastos-operativos`, { headers: { cookie: admin }, redirect: "manual" });
const cuerpoBloqueado = await bloqueada.text();
assert.ok(bloqueada.headers.get("location")?.includes("/no-autorizado") || cuerpoBloqueado.includes("/no-autorizado"));
const selector = await pedir("GET", "/api/tesoreria/categorias-gasto?selector=1", tesorero);
assert.equal(selector.status, 200);
const categoria_gasto_id = selector.data.data[0].id;
const fecha = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const mes = fecha.slice(0, 7);
const descripcion = `HTTP G13 ${Date.now()}`;
const alta = await pedir("POST", ruta, tesorero, { categoria_gasto_id, fecha, monto: "1250.00", descripcion });
assert.equal(alta.status, 201, JSON.stringify(alta.data));
const id = alta.data.data.id;
assert.equal(alta.data.data.monto, "1250.00");
assert.equal((await pedir("POST", ruta, tesorero, { categoria_gasto_id, fecha, monto: "1.001", descripcion })).status, 400);
const listado = await pedir("GET", `${ruta}?mes=${mes}&categoria_gasto_id=${categoria_gasto_id}&page=1&page_size=1`, tesorero);
assert.equal(listado.status, 200);
assert.ok(listado.data.data.total_registros >= 1);
assert.ok(Number(listado.data.data.total) >= 1250);
const sinCambio = await pedir("PATCH", `${ruta}/${id}`, tesorero, { monto: "1250.00" });
assert.equal(sinCambio.status, 200);
const edicion = await pedir("PATCH", `${ruta}/${id}`, tesorero, { monto: "1251.25" });
assert.equal(edicion.status, 200);
assert.equal(edicion.data.data.monto, "1251.25");
assert.equal((await pedir("PATCH", `${ruta}/${id}/baja`, tesorero, { deletion_reason: "abc" })).status, 400);
const baja = await pedir("PATCH", `${ruta}/${id}/baja`, tesorero, { deletion_reason: "Prueba HTTP completa" });
assert.equal(baja.status, 200);
assert.equal((await pedir("PATCH", `${ruta}/${id}`, tesorero, { monto: "2.00" })).status, 409);
console.log(JSON.stringify({ id, sinSesion: 401, sinPermiso: 403, alta: 201, edicion: 200, baja: 200, lista: listado.data.data.total_registros }));
