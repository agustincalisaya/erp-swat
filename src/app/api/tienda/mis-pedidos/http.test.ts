import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest, NextResponse } from "next/server";
import { ServiceError } from "@/lib/errors/service-error";
import { MisPedidosQuerySchema, PedidoWebIdSchema } from "@/lib/schemas/mis-pedidos.schema";
import { conCachePrivada, respuestaMisPedidosError, respuestaMisPedidosOk, respuestaMisPedidosValidacion } from "./http.ts";

async function body(response: Response) {
  return response.json() as Promise<{ data: unknown; error: null | { code: string; message: string } }>;
}

function assertPrivada(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
}

test("wrapper preserva 401/403 HU-E8 y agrega únicamente caché privada", async () => {
  const casos = [
    { status: 401, code: "SESION_CLIENTE_WEB_REQUERIDA", message: "Debe iniciar sesión para continuar" },
    { status: 403, code: "CUENTA_VINCULACION_PENDIENTE", message: "Tu cuenta está pendiente de validación de identidad en sucursal" },
  ];
  for (const caso of casos) {
    const guardedHandler = async () => NextResponse.json(
      { data: null, error: { code: caso.code, message: caso.message } },
      { status: caso.status, headers: { "X-Guard": "HU-E8", "Set-Cookie": "preservada=1; Path=/; HttpOnly" } },
    );
    const response = await conCachePrivada(guardedHandler)(new NextRequest("http://localhost/api/tienda/mis-pedidos"), undefined);
    assert.equal(response.status, caso.status);
    assert.equal(response.headers.get("x-guard"), "HU-E8");
    assert.equal(response.headers.get("set-cookie"), "preservada=1; Path=/; HttpOnly");
    assert.deepEqual(await body(response), { data: null, error: { code: caso.code, message: caso.message } });
    assertPrivada(response);
  }
});

test("query inválida produce 400 sin detalles internos", async () => {
  const parsed = MisPedidosQuerySchema.safeParse({ page: "0" });
  assert.equal(parsed.success, false);
  if (parsed.success) return;
  const response = respuestaMisPedidosValidacion(parsed.error);
  assert.equal(response.status, 400);
  assert.deepEqual(await body(response), {
    data: null,
    error: { code: "VALIDATION_ERROR", message: "Los datos enviados no son válidos" },
  });
  assertPrivada(response);
});

test("UUID inválido produce el mismo 400 mínimo", async () => {
  const parsed = PedidoWebIdSchema.safeParse("id-manipulado/otro");
  assert.equal(parsed.success, false);
  if (parsed.success) return;
  const response = respuestaMisPedidosValidacion(parsed.error);
  assert.equal(response.status, 400);
  assert.deepEqual(await body(response), {
    data: null,
    error: { code: "VALIDATION_ERROR", message: "Los datos enviados no son válidos" },
  });
  assertPrivada(response);
});

test("PEDIDO_NO_ENCONTRADO produce un 404 estable e indistinguible", async () => {
  for (const message of ["ajeno", "inactivo", "mostrador", "inexistente"]) {
    const response = respuestaMisPedidosError(new ServiceError("PEDIDO_NO_ENCONTRADO", message), "ruta-segura");
    assert.equal(response.status, 404);
    assert.deepEqual(await body(response), {
      data: null,
      error: { code: "PEDIDO_NO_ENCONTRADO", message: "El pedido solicitado no existe" },
    });
    assertPrivada(response);
  }
});

test("error inesperado produce 500 genérico sin filtrar la causa", async () => {
  const original = console.error;
  const logs: unknown[][] = [];
  console.error = (...args: unknown[]) => logs.push(args);
  try {
    const response = respuestaMisPedidosError(new Error("SQL codigo_qr_retiro secreto"), "GET /ruta-segura");
    assert.equal(response.status, 500);
    assert.deepEqual(await body(response), {
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" },
    });
    assertPrivada(response);
    assert.deepEqual(logs, [["[GET /ruta-segura] Error inesperado"]]);
  } finally {
    console.error = original;
  }
});

test("respuesta exitosa conserva DTO y aplica caché privada no-store", async () => {
  const data = { pedidos: [], total: 0, pagina: 1, por_pagina: 20 };
  const response = respuestaMisPedidosOk(data);
  assert.equal(response.status, 200);
  assert.deepEqual(await body(response), { data, error: null });
  assertPrivada(response);
});
