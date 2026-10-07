import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { TIPOS_EVENTO_DOMINIO } from "./event-types.ts";
import type {
  DomainEventMap,
  EcommercePedidoListoParaRetiroPayload,
  MotivoRetiroRechazado,
  PedidoEntregadoPayload,
  RetiroRechazadoPayload,
} from "./event-types.ts";

/**
 * HU-F2 — task §8, Punto abierto 4: `TIPOS_EVENTO_DOMINIO` (registro runtime)
 * debe coincidir exactamente con las claves de `DomainEventMap` (que es solo
 * un tipo). Se comparan contra la fuente porque el mapa no existe en runtime.
 */

const fuente = readFileSync(new URL("./event-types.ts", import.meta.url), "utf8");

function clavesDelMapa(): string[] {
  const inicio = fuente.indexOf("export interface DomainEventMap {");
  assert.ok(inicio > -1, "no se encontró DomainEventMap");
  const fin = fuente.indexOf("\n}", inicio);
  const bloque = fuente.slice(inicio, fin);
  return [...bloque.matchAll(/^\s+"([a-z_]+:[a-z_]+)":/gm)].map((m) => m[1]);
}

test("TIPOS_EVENTO_DOMINIO cubre exactamente las claves de DomainEventMap", () => {
  assert.deepEqual([...TIPOS_EVENTO_DOMINIO].sort(), clavesDelMapa().sort());
});

test("TIPOS_EVENTO_DOMINIO no tiene duplicados", () => {
  assert.equal(new Set(TIPOS_EVENTO_DOMINIO).size, TIPOS_EVENTO_DOMINIO.length);
});

test("los 4 eventos de HU-F2 están registrados", () => {
  for (const evento of [
    "notificacion_plantilla:creada",
    "notificacion_plantilla:actualizada",
    "notificacion_plantilla:baja_logica",
    "notificacion_plantilla:reactivada",
  ]) {
    assert.ok((TIPOS_EVENTO_DOMINIO as readonly string[]).includes(evento), evento);
  }
});

test("los 5 eventos de HU-E12 están registrados", () => {
  for (const evento of [
    "ecommerce:pedido_admitido_cola",
    "ecommerce:pedido_tomado",
    "ecommerce:prioridad_preparacion_cambiada",
    "ecommerce:unidad_preparacion_confirmada",
    "ecommerce:pedido_listo_para_retiro",
  ]) {
    assert.ok((TIPOS_EVENTO_DOMINIO as readonly string[]).includes(evento), evento);
  }
});

type Igual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type ClavesObligatorias<T> = {
  [K in keyof T]-?: object extends Pick<T, K> ? never : K;
}[keyof T];

test("HU-E3 registra ambos eventos con el mapa y payloads contractuales sin campos sensibles", () => {
  for (const evento of ["ecommerce:pedido_entregado", "ecommerce:retiro_rechazado"]) {
    assert.ok((TIPOS_EVENTO_DOMINIO as readonly string[]).includes(evento), evento);
  }

  const entregaEnMapa: Igual<DomainEventMap["ecommerce:pedido_entregado"], PedidoEntregadoPayload> = true;
  const rechazoEnMapa: Igual<DomainEventMap["ecommerce:retiro_rechazado"], RetiroRechazadoPayload> = true;
  const clavesEntrega: Igual<
    keyof PedidoEntregadoPayload,
    "evento_id" | "pedido_venta_id" | "pedido_venta_ecommerce_id" | "actor_id"
      | "estado_anterior" | "estado_nuevo" | "timestamp"
  > = true;
  const clavesRechazo: Igual<
    keyof RetiroRechazadoPayload,
    "evento_id" | "actor_id" | "motivo" | "timestamp" | "pedido_venta_id"
      | "pedido_venta_ecommerce_id"
  > = true;
  const obligatoriosEntrega: Igual<ClavesObligatorias<PedidoEntregadoPayload>, keyof PedidoEntregadoPayload> = true;
  const obligatoriosRechazo: Igual<
    ClavesObligatorias<RetiroRechazadoPayload>,
    "evento_id" | "actor_id" | "motivo" | "timestamp"
  > = true;
  assert.ok(entregaEnMapa && rechazoEnMapa && clavesEntrega && clavesRechazo);
  assert.ok(obligatoriosEntrega && obligatoriosRechazo);
});

test("pedido_entregado exige estados e IDs de entrega", () => {
  const payload: DomainEventMap["ecommerce:pedido_entregado"] = {
    evento_id: "evento-entrega",
    pedido_venta_id: "venta",
    pedido_venta_ecommerce_id: "extension",
    actor_id: "operador",
    estado_anterior: "LISTO_PARA_RETIRO",
    estado_nuevo: "ENTREGADO",
    timestamp: "2026-10-06T12:00:00.000Z",
  };
  assert.deepEqual(Object.keys(payload).sort(), [
    "evento_id", "pedido_venta_id", "pedido_venta_ecommerce_id", "actor_id",
    "estado_anterior", "estado_nuevo", "timestamp",
  ].sort());
});

test("retiro_rechazado admite ambos IDs ausentes o ambos presentes", () => {
  const sinResolucion: DomainEventMap["ecommerce:retiro_rechazado"] = {
    evento_id: "evento-rechazo-1",
    actor_id: "operador",
    motivo: "TOKEN_NO_RESUELTO",
    timestamp: "2026-10-06T12:00:00.000Z",
  };
  const conResolucion: DomainEventMap["ecommerce:retiro_rechazado"] = {
    evento_id: "evento-rechazo-2",
    actor_id: "operador",
    motivo: "DNI_NO_COINCIDE",
    timestamp: "2026-10-06T12:01:00.000Z",
    pedido_venta_id: "venta",
    pedido_venta_ecommerce_id: "extension",
  };
  assert.equal("pedido_venta_id" in sinResolucion, false);
  assert.equal("pedido_venta_ecommerce_id" in sinResolucion, false);
  assert.equal(conResolucion.pedido_venta_id, "venta");
  assert.equal(conResolucion.pedido_venta_ecommerce_id, "extension");
});

test("motivos de retiro_rechazado son exactamente los seis aprobados", () => {
  const motivos: MotivoRetiroRechazado[] = [
    "TOKEN_NO_RESUELTO", "PEDIDO_NO_OPERABLE", "ESTADO_NO_LISTO",
    "PLAZO_VENCIDO", "DNI_NO_COINCIDE", "CLIENTE_NO_OPERABLE",
  ];
  const unionExacta: Igual<
    MotivoRetiroRechazado,
    "TOKEN_NO_RESUELTO" | "PEDIDO_NO_OPERABLE" | "ESTADO_NO_LISTO"
      | "PLAZO_VENCIDO" | "DNI_NO_COINCIDE" | "CLIENTE_NO_OPERABLE"
  > = true;
  assert.equal(unionExacta, true);
  assert.equal(new Set(motivos).size, 6);
});

test("LISTO exige destinatario nullable y número comercial para F3", () => {
  const camposRequeridos: Igual<
    Pick<EcommercePedidoListoParaRetiroPayload, "cliente_web_cuenta_id" | "numero_venta">,
    { cliente_web_cuenta_id: string | null; numero_venta: string }
  > = true;
  const base = {
    evento_id: "evento-listo",
    pedido_venta_id: "venta",
    pedido_venta_ecommerce_id: "extension",
    actor_id: "operador",
    estado_anterior: "EN_PREPARACION",
    estado_nuevo: "LISTO_PARA_RETIRO",
    plazo_retiro_vencimiento: "2026-10-10T12:00:00.000Z",
    timestamp: "2026-10-06T12:00:00.000Z",
  } as const;
  const ampliado: EcommercePedidoListoParaRetiroPayload = {
    ...base,
    cliente_web_cuenta_id: "cuenta",
    numero_venta: "V-2026-000123",
  };
  const sinCuenta: EcommercePedidoListoParaRetiroPayload = {
    ...base,
    cliente_web_cuenta_id: null,
    numero_venta: "V-2026-000123",
  };
  assert.equal(camposRequeridos, true);
  assert.equal(ampliado.cliente_web_cuenta_id, "cuenta");
  assert.equal(ampliado.numero_venta, "V-2026-000123");
  assert.equal(sinCuenta.cliente_web_cuenta_id, null);
});
