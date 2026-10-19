import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { prisma } from "@/lib/db/prisma";
import { verificarCadenaIntegridad } from "@/lib/services/auditoria/audit-log.service";
import { crearCategoriaGasto, editarCategoriaGasto, darDeBajaCategoriaGasto } from "./categoria-gasto.service";

const url = process.env.DATABASE_URL ?? "";
if (!url.includes("127.0.0.1:55436/hu_g12")) throw new Error("Esta prueba exige la base local descartable HU-G12 en 127.0.0.1:55436/hu_g12");

test("HU-G12 conserva gastos, reserva el nombre y audita solo transiciones efectivas", async () => {
  const admin = await prisma.usuario.findUniqueOrThrow({ where: { nombre_usuario: "administrador.seed" }, select: { id: true } });
  const nombre = `Integración ${randomUUID()}`;
  const creada = await crearCategoriaGasto({ nombre, descripcion: "inicial" }, admin.id);
  const gastoId = randomUUID();
  try {
    await prisma.gastoOperativo.create({ data: {
      id: gastoId, categoria_gasto_id: creada.id, monto: "125.00",
      fecha: new Date("2026-10-01T00:00:00.000Z"), descripcion: "Gasto de prueba HU-G12",
      registrado_por_id: admin.id,
    } });
    const sinCambio = await editarCategoriaGasto(creada.id, { nombre, descripcion: "inicial" }, admin.id);
    assert.equal(sinCambio.nombre, nombre);
    const editada = await editarCategoriaGasto(creada.id, { descripcion: "" }, admin.id);
    assert.equal(editada.descripcion, null);
    const baja = await darDeBajaCategoriaGasto(creada.id, { deletion_reason: "Motivo de prueba" }, admin.id);
    assert.equal(baja.is_active, false);
    const gasto = await prisma.gastoOperativo.findUniqueOrThrow({ where: { id: gastoId } });
    assert.equal(gasto.is_active, true);
    assert.equal(gasto.categoria_gasto_id, creada.id);
    const categoria = await prisma.categoriaGasto.findUniqueOrThrow({ where: { id: creada.id } });
    assert.equal(categoria.nombre_normalizado, nombre.toLowerCase());
    await assert.rejects(() => crearCategoriaGasto({ nombre: ` ${nombre.toUpperCase()} ` }, admin.id), (error: { code?: string }) => error.code === "CATEGORIA_GASTO_DUPLICADA");
    await assert.rejects(() => editarCategoriaGasto(creada.id, { nombre: "No permitido" }, admin.id), (error: { code?: string }) => error.code === "CATEGORIA_GASTO_YA_DADA_DE_BAJA");
    const nombreCarrera = `Carrera ${randomUUID()}`;
    const carrera = await Promise.allSettled([
      crearCategoriaGasto({ nombre: nombreCarrera }, admin.id),
      crearCategoriaGasto({ nombre: ` ${nombreCarrera.toUpperCase()} ` }, admin.id),
    ]);
    assert.equal(carrera.filter((resultado) => resultado.status === "fulfilled").length, 1);
    assert.equal(carrera.filter((resultado) => resultado.status === "rejected" && (resultado.reason as { code?: string }).code === "CATEGORIA_GASTO_DUPLICADA").length, 1);
    for (let intento = 0; intento < 40; intento++) {
      if (await prisma.auditLog.count({ where: { tabla_afectada: "categorias_gasto", registro_id: creada.id } }) === 3) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const asientos = await prisma.auditLog.findMany({
      where: { tabla_afectada: "categorias_gasto", registro_id: creada.id },
      orderBy: [{ created_at: "asc" }, { id: "asc" }],
    });
    assert.deepEqual(asientos.map((asiento) => asiento.accion), ["CREATE", "UPDATE", "DELETE_LOGICO"]);
    assert.ok(asientos.every((asiento) => asiento.hash_actual && asiento.hash_anterior));
    const integridad = await verificarCadenaIntegridad();
    assert.equal(integridad.integra, true, JSON.stringify(integridad));
  } finally {
    await prisma.$disconnect();
  }
});
