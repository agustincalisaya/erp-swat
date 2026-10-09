import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const componente = readFileSync(new URL("./PedidosPagadosAdmin.tsx", import.meta.url), "utf8");
const servicio = readFileSync(new URL("../../lib/services/ecommerce/pedidos-pagados-admin.service.ts", import.meta.url), "utf8");
const pagina = readFileSync(new URL("../../app/(dashboard)/ecommerce/pedidos/pagados/page.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("../layout/Sidebar.tsx", import.meta.url), "utf8");

test("lectura T15 usa filtro local, paginación DB y una consulta anidada sin N+1", () => {
  for (const estado of ["PAGO_CONFIRMADO", "EN_PREPARACION", "LISTO_PARA_RETIRO", "CANCELADO", "VENCIDO_SIN_RETIRO"]) assert.ok(servicio.includes(`"${estado}"`));
  assert.match(servicio, /is_active: false[\s\S]*deleted_at: \{ not: null \}/);
  assert.match(servicio, /Promise\.all\(\[/);
  assert.match(servicio, /pedidoVentaEcommerce\.count/);
  assert.match(servicio, /pedidoVentaEcommerce\.findMany/);
  assert.match(servicio, /reintegro_pago:[\s\S]*intentos_refund:[\s\S]*where: \{ estado: "PENDIENTE" \}/);
  assert.match(servicio, /skip: \(page - 1\) \* pageSize/);
  assert.match(servicio, /take: pageSize/);
  assert.doesNotMatch(servicio, /for \([^)]*\)[\s\S]{0,120}await/);
});

test("página y navegación usan solo el permiso T15 y preservan el path HU-E7", () => {
  assert.match(pagina, /PERMISO_CANCELAR_PEDIDO_PAGADO/);
  assert.doesNotMatch(pagina, /PERMISO_ANULAR_ORDEN_NO_ABONADA|ADMINISTRADOR_ECOMMERCE/);
  assert.match(sidebar, /label: "Pedidos web"[\s\S]*href: "\/ecommerce\/pedidos"[\s\S]*permiso: "ecommerce:anular_orden_no_abonada"/);
  assert.match(sidebar, /label: "Pedidos pagados"[\s\S]*href: "\/ecommerce\/pedidos\/pagados"[\s\S]*permiso: "ecommerce:cancelar_pedido_pagado"/);
});

test("formularios envían motivo mínimo, bloquean doble submit y refrescan", () => {
  assert.match(componente, /motivo\.trim\(\)\.length > 0/);
  assert.match(componente, /enviandoRef\.current/);
  assert.match(componente, /JSON\.stringify\(\{ motivo: motivo\.trim\(\) \}\)/);
  assert.match(componente, /method: accion === "cancelar" \? "PATCH" : "POST"/);
  assert.match(componente, /router\.refresh\(\)/);
  assert.match(componente, /disabled=\{!motivoValido \|\| enviando\}/);
  assert.match(componente, /role="alert"/);
  assert.match(componente, /flex flex-col-reverse gap-2 sm:flex-row/);
});

test("UI consume flags, maneja intento reutilizado y no muestra secretos", () => {
  assert.match(componente, /fila\.acciones\.cancelar_pedido/);
  assert.match(componente, /fila\.acciones\.reintentar_reintegro/);
  assert.match(componente, /intento_reutilizado/);
  assert.match(componente, /Ya existe un reintegro en proceso para este pedido/);
  assert.match(componente, /Pedido cancelado correctamente\. Se inició el proceso de reintegro/);
  assert.match(componente, /Reintegro en proceso/);
  assert.match(componente, /Reintegro rechazado/);
  assert.match(componente, /Reintegro completado/);
  assert.doesNotMatch(componente, /dinero devuelto|Mercado Pago completó|refund aprobado/i);
  for (const secreto of ["clave_idempotencia", "mercadopago_payment_id", "refund_id", "nota_credito_id", "contra_asiento_ingreso_id", "ultimo_error_codigo", "access_token"]) {
    assert.ok(!componente.includes(secreto), `No debe contener ${secreto}`);
  }
});
