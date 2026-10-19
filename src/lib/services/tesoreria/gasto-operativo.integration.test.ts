import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { verificarCadenaIntegridad } from "@/lib/services/auditoria/audit-log.service";
import { crearGastoOperativo, editarGastoOperativo, darDeBajaGastoOperativo, listarGastosOperativos } from "./gasto-operativo.service";

if (!(process.env.DATABASE_URL ?? "").includes("127.0.0.1:55437/hu_g13")) throw new Error("La prueba requiere la base descartable HU-G13");
test("HU-G13 alta, edición, baja, total y auditoría", async () => {
  const actor = await prisma.usuario.findUniqueOrThrow({ where: { nombre_usuario: "tesorero.seed" }, select: { id: true } });
  const categoria = await prisma.categoriaGasto.create({ data: { nombre: `Prueba G13 ${randomUUID()}`, nombre_normalizado: randomUUID() } });
  const categoria2 = await prisma.categoriaGasto.create({ data: { nombre: `Destino G13 ${randomUUID()}`, nombre_normalizado: randomUUID() } });
  const ayer = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const mes = ayer.slice(0, 7);
  const descripcion = `Integración G13 ${randomUUID()}`;
  const primero = await crearGastoOperativo({ categoria_gasto_id: categoria.id, fecha: ayer, monto: "0.10", descripcion }, actor.id);
  const segundo = await crearGastoOperativo({ categoria_gasto_id: categoria.id, fecha: ayer, monto: "0.20", descripcion }, actor.id);
  const fila = await prisma.gastoOperativo.findUniqueOrThrow({ where: { id: primero.id } });
  assert.equal(fila.fecha.toISOString(), `${ayer}T00:00:00.000Z`);
  const lista = await listarGastosOperativos({ mes, categoria_gasto_id: categoria.id, page: 1, page_size: 1 });
  assert.equal(lista.total, "0.30"); assert.equal(lista.total_registros, 2); assert.equal(lista.items.length, 1);
  await assert.rejects(() => crearGastoOperativo({ categoria_gasto_id: categoria.id, fecha: "2026-02-30", monto: "1", descripcion }, actor.id), (e: { code?: string }) => e.code === "VALIDATION_ERROR");
  await assert.rejects(() => crearGastoOperativo({ categoria_gasto_id: categoria.id, fecha: "9999-01-01", monto: "1", descripcion }, actor.id), (e: { code?: string }) => e.code === "VALIDATION_ERROR");
  const sinCambio = await editarGastoOperativo(primero.id, { monto: "0.10" }, actor.id);
  assert.equal(sinCambio.monto, "0.10");
  await editarGastoOperativo(primero.id, { categoria_gasto_id: categoria2.id, monto: "1.25" }, actor.id);
  const baja = await darDeBajaGastoOperativo(primero.id, { deletion_reason: "Duplicado en prueba" }, actor.id);
  assert.equal(baja.is_active, false);
  await assert.rejects(() => editarGastoOperativo(primero.id, { monto: "2.00" }, actor.id), (e: { code?: string }) => e.code === "GASTO_OPERATIVO_DADO_DE_BAJA");
  await assert.rejects(() => darDeBajaGastoOperativo(primero.id, { deletion_reason: "Otra baja" }, actor.id), (e: { code?: string }) => e.code === "GASTO_OPERATIVO_DADO_DE_BAJA");
  const restante = await listarGastosOperativos({ mes, categoria_gasto_id: categoria.id, page: 1, page_size: 20 });
  assert.equal(restante.total, "0.20"); assert.equal(restante.total_registros, 1); assert.equal(restante.items[0].id, segundo.id);
  const vacio = await listarGastosOperativos({ mes: "2020-01", page: 1, page_size: 20 });
  assert.equal(vacio.total, "0.00");
  const historica = await prisma.categoriaGasto.create({ data: { nombre: `Histórica ${randomUUID()}`, nombre_normalizado: randomUUID() } });
  const gastoHistorico = await crearGastoOperativo({ categoria_gasto_id: historica.id, fecha: ayer, monto: "2.00", descripcion }, actor.id);
  await prisma.categoriaGasto.update({ where: { id: historica.id }, data: { is_active: false, deleted_at: new Date(), deleted_by: actor.id, deletion_reason: "Prueba histórica" } });
  await assert.rejects(() => crearGastoOperativo({ categoria_gasto_id: historica.id, fecha: ayer, monto: "1.00", descripcion }, actor.id), (e: { code?: string }) => e.code === "CATEGORIA_GASTO_INACTIVA");
  await assert.rejects(() => editarGastoOperativo(segundo.id, { categoria_gasto_id: historica.id }, actor.id), (e: { code?: string }) => e.code === "CATEGORIA_GASTO_INACTIVA");
  const conservado = await editarGastoOperativo(gastoHistorico.id, { descripcion: `${descripcion} modificado` }, actor.id);
  assert.equal(conservado.categoria_nombre, historica.nombre);
  const carrera = await Promise.allSettled([
    editarGastoOperativo(gastoHistorico.id, { monto: "3.00" }, actor.id),
    darDeBajaGastoOperativo(gastoHistorico.id, { deletion_reason: "Baja concurrente" }, actor.id),
  ]);
  assert.equal(carrera.filter((r) => r.status === "fulfilled").length >= 1, true);
  const finalCarrera = await prisma.gastoOperativo.findUniqueOrThrow({ where: { id: gastoHistorico.id } });
  assert.equal(finalCarrera.is_active, false);
  for (let i = 0; i < 40; i++) {
    if (await prisma.auditLog.count({ where: { tabla_afectada: "gastos_operativos", registro_id: primero.id } }) === 3) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const asientos = await prisma.auditLog.findMany({ where: { tabla_afectada: "gastos_operativos", registro_id: primero.id }, orderBy: { created_at: "asc" } });
  assert.deepEqual(asientos.map((a) => a.accion), ["CREATE", "UPDATE", "DELETE_LOGICO"]);
  assert.equal((await verificarCadenaIntegridad()).integra, true);
  await prisma.$disconnect();
});
