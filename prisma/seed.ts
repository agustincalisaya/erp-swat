// ============================================================================
// ERP SWAT — Seed Script unificado (Sprint 1 · Módulo D + HU-A3)
//
// Password de TODOS los usuarios de prueba sembrados por este archivo:
//
//     abc123456789
//
// Derivada con hashPassword() de lib/auth/password-hash-core.ts — el mismo
// algoritmo Argon2id que usa la app real. Este archivo importa el núcleo
// directo porque `prisma db seed` corre vía `tsx` fuera del bundler de
// Next.js, donde `server-only` lanzaría una excepción.
//
// ============================================================================

import { PrismaClient } from "@prisma/client";
import { hashPassword } from "@/lib/auth/password-hash-core";
import { generarSku, type Genero } from "@/lib/utils/sku";
import * as dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();

const PASSWORD_SEED = "abc123456789";

// ──────────────────────────────────────────────────────────────────────────────
// Patrón de reactivación para entidades RBAC definicionales
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Reactivación explícita para las filas RBAC PURAMENTE definicionales que
 * este seed posee por completo (`Permiso`, `Rol`, `RolPermiso`): si alguna
 * quedó soft-deleteada por una prueba manual, volver a correr el seed debe
 * restaurar el grafo RBAC de referencia a su estado conocido.
 * Deliberadamente NO se aplica a `Usuario`, `UsuarioRol` ni a entidades de
 * Módulo A — esas son sujetos de prueba habituales de flujos de baja lógica.
 */
const REACTIVAR_REFERENCIA_RBAC = {
  is_active: true,
  deleted_at: null,
  deleted_by: null,
  deletion_reason: null,
};

// ──────────────────────────────────────────────────────────────────────────────
// IDs fijos — idempotencia vía upsert
// ──────────────────────────────────────────────────────────────────────────────

// --- Origen: seed original (HU-7) ---
const USUARIO_SEED_ID = "8c682c21-d075-4665-9cd2-ed0285c80f91";
const PRODUCTO_MAESTRO_SEED_ID = "cccf5533-44b5-4ed2-99e5-0d29c20da167";
const VARIANTE_SKU_SEED_ID = "fadabd3f-991e-4e26-90f2-ad8cc97856c7";
const DEPOSITO_SEED_ID = "a61c8fe5-bac1-4c4f-a15a-9a2ff1c7c95a";
const STOCK_DEPOSITO_SEED_ID = "90bb1fa7-d5f4-40fa-aa0c-ffeab09082e6";
const MOVIMIENTO_EGRESO_1_ID = "a74c7b59-1d02-4d32-b839-205bd67f14ec";
const MOVIMIENTO_EGRESO_2_ID = "d0290236-d5b5-485f-9063-afe5e760548b";
const MOVIMIENTO_EGRESO_3_ID = "c7d4f09e-d987-4356-b052-121a67b14558";

// --- Origen: Módulo D (RBAC forense / gestión de roles) ---
const PERMISO_LEER_FORENSE_ID = "d45883eb-0c09-4564-8b95-beefcf61d05d";
const PERMISO_VERIFICAR_CADENA_ID = "8edff94c-5e73-4be4-b774-87409cafd8bb";
const PERMISO_ROLES_ADMINISTRAR_ID = "9b1217cb-3802-4ad0-b026-ed95b0b8b6e4";
const PERMISO_INVENTARIO_OPERAR_ID = "874a1bb2-fb27-4d51-97b0-c29288bfb01c";
const PERMISO_TRANSFERIR_STOCK_ID = "3e87e12f-091f-4a18-a645-8916fca01379";
const PERMISO_CONFIRMAR_RECEPCION_ID = "90cfd9eb-e6f1-47c5-a570-d7f92dc21d04";
const PERMISO_RESERVAR_STOCK_ID = "b1f7c2a4-3d9e-4c1b-8a6f-0e2d4c6a8b10";
const PERMISO_CONFIRMAR_RESERVA_ID = "c2e8d3b5-4a1f-4d2c-9b7a-1f3e5d7b9c21";
const PERMISO_MOVIMIENTOS_LEER_HISTORICO_ID = "e4a6f1d8-7c2b-4e9a-9d5f-3b8c1a6e4d02";
const ROL_AUDITOR_ID = "cfe51d79-332c-4217-8906-481f2a94a1cc";
const ROL_ADMINISTRADOR_ID = "2998bb21-960c-474c-8941-848d1f20038e";
const ROL_ENCARGADO_DEPOSITO_ID = "1ce2f5fc-8b66-4496-82de-36d434bc79aa";
const ROL_PERMISO_LEER_FORENSE_ID = "c05147a1-8b65-4362-91ef-f631ec30fa67";
const ROL_PERMISO_VERIFICAR_CADENA_ID = "cc582af5-de13-4345-b290-de1e478312ea";
const ROL_PERMISO_ROLES_ADMINISTRAR_ID = "8535ced4-40fb-4cc3-bb51-eec97c4ddc49";
const ROL_PERMISO_INVENTARIO_OPERAR_ID = "2f19285c-6494-4e97-aee6-99fdb48feadd";
const USUARIO_ADMIN_SEED_ID = "64a0a7e3-76e2-4637-828e-f7cb96756597";
const USUARIO_AUDITOR_SEED_ID = "0e273fcf-b944-4580-a610-062f7a92a384";
const USUARIO_ENCARGADO_SEED_ID = "77b685fd-ac1c-4af5-9f59-48830d96c9ea";
const USUARIO_ROL_ADMIN_ID = "9d8356d0-b396-4a95-9934-5824614d5c3a";
const USUARIO_ROL_AUDITOR_ID = "dd26a842-a1a1-4a21-a920-5dad6e4c5a9a";
const USUARIO_ROL_ENCARGADO_ID = "31827e93-6bdb-44ec-87e0-9607c51c1837";

// --- Origen: Módulo A — catálogo adicional ---
const PRODUCTO_CAMISA_TACTICA_ID = "9e717646-bd40-47d7-9bc3-1c5bf053becb";
const PRODUCTO_BORCEGOS_ID = "cf6b1caa-ef43-4554-ade4-f9e225a2993a";
const VARIANTE_CAMISA_TACTICA_1_ID = "407e729d-47c3-404d-a89a-0a9c1f85a3db"; // M, Verde, HOMBRE, Manga Larga
const VARIANTE_CAMISA_TACTICA_2_ID = "6fbb4612-9e6d-4661-b250-0bc62579089e"; // L, Negro, HOMBRE, Manga Corta
const VARIANTE_CAMISA_TACTICA_3_ID = "0929aab1-57fb-44bc-90b6-76417c76c016"; // S, Verde, MUJER, Manga Larga
const VARIANTE_BORCEGOS_1_ID = "864c2765-cbdd-41eb-837a-e12814b62868"; // 42, Negro, HOMBRE, Combate
const VARIANTE_BORCEGOS_2_ID = "79f41b7f-a667-4867-b3cc-2c73f6134086"; // 38, Negro, MUJER, Combate
const DEPOSITO_SHOWROOM_ID = "acafbd3f-3309-46f6-8199-3509ca1d37f9";
const DEPOSITO_MOVIL_ID = "453a9cda-87ca-4ae4-82de-9e25dab04d16";
const STOCK_CT1_CENTRAL_ID = "ec3dfab3-aae7-431f-a08d-c0aca9b21c5e";
const STOCK_CT2_CENTRAL_ID = "5325a4c7-e7af-4ea7-8eb1-73ace46a5e34";
const STOCK_CT3_CENTRAL_ID = "d0aa3ce0-b6e9-4739-acbc-78dfbf9fcce4";
const STOCK_B1_CENTRAL_ID = "11eabfe2-c03c-4f4a-b2c5-cb9983a79e8f";
const STOCK_B2_CENTRAL_ID = "8d6ecad3-812c-4eca-8f17-228946588ad0";
const STOCK_CT1_SHOWROOM_ID = "7bcdc606-fef2-443c-b501-8859c49ae7ad";
const STOCK_B1_SHOWROOM_ID = "9c1c70af-b0c6-4188-8771-3ad4e3a90940";
const STOCK_CT2_MOVIL_ID = "724c48d5-ea9d-4fb8-b44a-315a683bb0c1";

// --- Origen: Sprint 2 — Módulo H (Compras/Proveedores) y Módulo G (Cuentas por Pagar) ---
const PERMISO_PROVEEDORES_ADMINISTRAR_ID = "1a2b3c4d-1111-4a1a-8a1a-000000000001";
const PERMISO_COMPRAS_OPERAR_ID = "1a2b3c4d-1111-4a1a-8a1a-000000000002";
const PERMISO_RECEPCION_CONFIRMAR_ID = "1a2b3c4d-1111-4a1a-8a1a-000000000003";
const PERMISO_TESORERIA_OPERAR_ID = "1a2b3c4d-1111-4a1a-8a1a-000000000004";
const ROL_COMPRADOR_ID = "1a2b3c4d-2222-4a1a-8a1a-000000000001";
const ROL_TESORERO_ID = "1a2b3c4d-2222-4a1a-8a1a-000000000002";
const ROL_PERMISO_PROVEEDORES_ADMINISTRAR_ID = "1a2b3c4d-3333-4a1a-8a1a-000000000001";
const ROL_PERMISO_COMPRAS_OPERAR_ID = "1a2b3c4d-3333-4a1a-8a1a-000000000002";
const ROL_PERMISO_RECEPCION_CONFIRMAR_ID = "1a2b3c4d-3333-4a1a-8a1a-000000000003";
const ROL_PERMISO_TESORERIA_OPERAR_ID = "1a2b3c4d-3333-4a1a-8a1a-000000000004";
const ROL_SUPERVISOR_COMPRAS_ID = "1a2b3c4d-2222-4a1a-8a1a-000000000003";
const USUARIO_COMPRADOR_SEED_ID = "1a2b3c4d-4444-4a1a-8a1a-000000000001";
const USUARIO_TESORERO_SEED_ID = "1a2b3c4d-4444-4a1a-8a1a-000000000002";
const USUARIO_SUPERVISOR_COMPRAS_SEED_ID = "1a2b3c4d-4444-4a1a-8a1a-000000000003";
const USUARIO_ROL_COMPRADOR_ID = "1a2b3c4d-5555-4a1a-8a1a-000000000001";
const USUARIO_ROL_TESORERO_ID = "1a2b3c4d-5555-4a1a-8a1a-000000000002";
const USUARIO_ROL_SUPERVISOR_COMPRAS_ID = "1a2b3c4d-5555-4a1a-8a1a-000000000003";

// HU-H3 — permisos granulares por acción de OrdenCompra (spec_modulo_H.md
// §2.5: un permiso independiente por acción, NO un único `ordenes_compra:administrar`).
const PERMISO_OC_CREAR_ID = "1a2b3c4d-1111-4a1a-8a1a-000000000005";
const PERMISO_OC_ENVIAR_ID = "1a2b3c4d-1111-4a1a-8a1a-000000000006";
const PERMISO_OC_CONFIRMAR_ID = "1a2b3c4d-1111-4a1a-8a1a-000000000007";
const PERMISO_OC_CERRAR_ID = "1a2b3c4d-1111-4a1a-8a1a-000000000008";
const PERMISO_OC_CANCELAR_ID = "1a2b3c4d-1111-4a1a-8a1a-000000000009";

const PROVEEDOR_HOMOLOGADO_ID = "1a2b3c4d-6666-4a1a-8a1a-000000000001";
const PROVEEDOR_PENDIENTE_ID = "1a2b3c4d-6666-4a1a-8a1a-000000000002";

// HU-H3 — Camino A (spec_modulo_H.md §2.4): lista de precios sembrada
// directo por Prisma Client para el proveedor HOMOLOGADO, sin pasar por
// ningún endpoint (HU-H2 diferida). HU-H3 resuelve `precio_unitario` contra
// esta versión publicada.
const LISTA_PRECIO_HOMOLOGADO_ID = "1a2b3c4d-bbbb-4a1a-8a1a-000000000001";
const LISTA_PRECIO_VERSION_ID = "1a2b3c4d-cccc-4a1a-8a1a-000000000001";
const LISTA_PRECIO_ITEM_CAMISA_1_ID = "1a2b3c4d-dddd-4a1a-8a1a-000000000001";
const LISTA_PRECIO_ITEM_CAMISA_2_ID = "1a2b3c4d-dddd-4a1a-8a1a-000000000002";
const LISTA_PRECIO_ITEM_BORCEGOS_1_ID = "1a2b3c4d-dddd-4a1a-8a1a-000000000003";
const ORDEN_COMPRA_CONFIRMADA_ID = "1a2b3c4d-7777-4a1a-8a1a-000000000001";
const ORDEN_COMPRA_ITEM_1_ID = "1a2b3c4d-7778-4a1a-8a1a-000000000001";
const ORDEN_COMPRA_ITEM_2_ID = "1a2b3c4d-7778-4a1a-8a1a-000000000002";
const RECEPCION_SEED_ID = "1a2b3c4d-8888-4a1a-8a1a-000000000001";
const RECEPCION_ITEM_1_ID = "1a2b3c4d-8889-4a1a-8a1a-000000000001";
const RECEPCION_DISCREPANCIA_1_ID = "1a2b3c4d-8890-4a1a-8a1a-000000000001";
const CUENTA_POR_PAGAR_PROVISORIA_ID = "1a2b3c4d-9999-4a1a-8a1a-000000000001";
const EVALUACION_PROVEEDOR_SEED_ID = "1a2b3c4d-aaaa-4a1a-8a1a-000000000001";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers — Fechas
// ──────────────────────────────────────────────────────────────────────────────

function diasAtras(dias: number): Date {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() - dias);
  return fecha;
}

// ──────────────────────────────────────────────────────────────────────────────
// main
// ──────────────────────────────────────────────────────────────────────────────

async function main() {
  const passwordSeed = await hashPassword(PASSWORD_SEED);

  // ── Seed original HU-7: usuario base, producto, variante, depósito, stock ──

  const usuario = await prisma.usuario.upsert({
    where: { id: USUARIO_SEED_ID },
    update: {
      // Migración puntual: actualiza el hash placeholder al hash Argon2id real.
      password_hash: passwordSeed.hash,
      password_salt: passwordSeed.salt,
    },
    create: {
      id: USUARIO_SEED_ID,
      nombre_usuario: "seed.deposito",
      email: "seed.deposito@erp-swat.local",
      password_hash: passwordSeed.hash,
      password_salt: passwordSeed.salt,
      nombre_completo: "Usuario Seed (Encargado de Depósito)",
      is_active: true,
    },
  });

  const productoMaestro = await prisma.productoMaestro.upsert({
    where: { id: PRODUCTO_MAESTRO_SEED_ID },
    update: {},
    create: {
      id: PRODUCTO_MAESTRO_SEED_ID,
      codigo_producto: "CAMPOL",
      nombre: "Camisa de Policía",
      rubro: "Indumentaria",
      categoria: "Camisas",
      unidad_medida: "UNIDAD",
      descripcion: "Camisa táctica reglamentaria — datos de prueba HU-7",
      costo_estandar_referencia: 12500.0,
      is_active: true,
    },
  });

  const skuVarianteSeed = generarSku({
    codigoProducto: productoMaestro.codigo_producto,
    modelo: "Policía",
    talle: "M",
    codigoColor: "Azul",
    genero: "HOMBRE",
  });

  const varianteSku = await prisma.varianteSKU.upsert({
    where: { id: VARIANTE_SKU_SEED_ID },
    // `update` no vacío: si la fila ya existe con un SKU huérfano de una
    // versión anterior del seed (p.ej. generado con una función de SKU
    // divergente de generarSku()), volver a correr el seed la corrige en
    // vez de dejarla inconsistente.
    update: {
      sku: skuVarianteSeed,
      ean_qr: "7791234500017",
      talle: "M",
      color: "Azul",
      genero: "HOMBRE",
      modelo: "Policía",
      is_active: true,
    },
    create: {
      id: VARIANTE_SKU_SEED_ID,
      producto_maestro_id: productoMaestro.id,
      sku: skuVarianteSeed,
      ean_qr: "7791234500017",
      talle: "M",
      color: "Azul",
      genero: "HOMBRE",
      modelo: "Policía",
      is_active: true,
    },
  });

  const deposito = await prisma.deposito.upsert({
    where: { id: DEPOSITO_SEED_ID },
    update: {},
    create: {
      id: DEPOSITO_SEED_ID,
      nombre: "Depósito Central",
      tipo: "CENTRAL",
      direccion: "Sede Central — datos de prueba HU-7",
      is_active: true,
    },
  });

  const stockDeposito = await prisma.stockDeposito.upsert({
    where: { id: STOCK_DEPOSITO_SEED_ID },
    update: {},
    create: {
      id: STOCK_DEPOSITO_SEED_ID,
      variante_sku_id: varianteSku.id,
      deposito_id: deposito.id,
      cantidad: 40,
      punto_pedido: 10,
      stock_seguridad: 5,
      is_active: true,
    },
  });

  // 3 egresos históricos para HU-7 (promedio móvil)
  const egresos = [
    { id: MOVIMIENTO_EGRESO_1_ID, cantidad: 20, hace_dias: 50 },
    { id: MOVIMIENTO_EGRESO_2_ID, cantidad: 30, hace_dias: 30 },
    { id: MOVIMIENTO_EGRESO_3_ID, cantidad: 40, hace_dias: 10 },
  ];

  // HU-A11 (multi-ítem): MovimientoStock es cabecera pura — variante_sku_id/
  // cantidad/estado_origen migran a un MovimientoStockItem hijo (uno solo,
  // este seed sigue siendo de una única variante por egreso).
  for (const egreso of egresos) {
    await prisma.movimientoStock.upsert({
      where: { id: egreso.id },
      update: {},
      create: {
        id: egreso.id,
        deposito_origen_id: deposito.id,
        deposito_destino_id: null,
        tipo_movimiento: "EGRESO",
        comprobante_referencia: `SEED-EGRESO-${egreso.cantidad}`,
        registrado_por_id: usuario.id,
        created_at: diasAtras(egreso.hace_dias),
        is_active: true,
        items: {
          create: {
            variante_sku_id: varianteSku.id,
            cantidad: egreso.cantidad,
            estado_origen: "DISPONIBLE",
          },
        },
      },
    });
  }

  // ── Módulo D — RBAC: Consola de Auditoría Forense ──────────────────────────

  const permisoLeerForense = await prisma.permiso.upsert({
    where: { id: PERMISO_LEER_FORENSE_ID },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: {
      id: PERMISO_LEER_FORENSE_ID,
      codigo: "auditoria:leer_forense",
      descripcion:
        "Lectura ampliada del historial de AuditLog de cualquier usuario",
      modulo: "MODULO_D",
    },
  });

  const permisoVerificarCadena = await prisma.permiso.upsert({
    where: { id: PERMISO_VERIFICAR_CADENA_ID },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: {
      id: PERMISO_VERIFICAR_CADENA_ID,
      codigo: "auditoria:verificar_cadena",
      descripcion:
        "Ejecutar la verificación de integridad de la cadena de hashes de AuditLog",
      modulo: "MODULO_D",
    },
  });

  const rolAuditor = await prisma.rol.upsert({
    where: { id: ROL_AUDITOR_ID },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: {
      id: ROL_AUDITOR_ID,
      nombre: "AUDITOR",
      descripcion:
        "Solo lectura ampliada de auditoría forense — no gestiona usuarios ni roles",
    },
  });

  await prisma.rolPermiso.upsert({
    where: { id: ROL_PERMISO_LEER_FORENSE_ID },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: {
      id: ROL_PERMISO_LEER_FORENSE_ID,
      rol_id: rolAuditor.id,
      permiso_id: permisoLeerForense.id,
    },
  });

  await prisma.rolPermiso.upsert({
    where: { id: ROL_PERMISO_VERIFICAR_CADENA_ID },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: {
      id: ROL_PERMISO_VERIFICAR_CADENA_ID,
      rol_id: rolAuditor.id,
      permiso_id: permisoVerificarCadena.id,
    },
  });

  // ── Módulo D — RBAC: Gestión de Roles y Permisos ───────────────────────────

  const permisoRolesAdministrar = await prisma.permiso.upsert({
    where: { id: PERMISO_ROLES_ADMINISTRAR_ID },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: {
      id: PERMISO_ROLES_ADMINISTRAR_ID,
      codigo: "roles:administrar",
      descripcion:
        "Crear roles y administrar los permisos asignados a un rol existente",
      modulo: "MODULO_D",
    },
  });

  const rolAdministrador = await prisma.rol.upsert({
    where: { id: ROL_ADMINISTRADOR_ID },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: {
      id: ROL_ADMINISTRADOR_ID,
      nombre: "ADMINISTRADOR",
      descripcion:
        "Gestión de usuarios y RBAC — no incluye auditoría forense por defecto",
    },
  });

  await prisma.rolPermiso.upsert({
    where: { id: ROL_PERMISO_ROLES_ADMINISTRAR_ID },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: {
      id: ROL_PERMISO_ROLES_ADMINISTRAR_ID,
      rol_id: rolAdministrador.id,
      permiso_id: permisoRolesAdministrar.id,
    },
  });

  // ── Módulo D — RBAC: Encargado de Depósito (Módulo A — placeholder) ────────

  const permisoInventarioOperar = await prisma.permiso.upsert({
    where: { id: PERMISO_INVENTARIO_OPERAR_ID },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: {
      id: PERMISO_INVENTARIO_OPERAR_ID,
      codigo: "inventario:operar",
      descripcion:
        "PLACEHOLDER — permiso genérico temporal para el rol Encargado de Depósito. " +
        "Reemplazar por permisos granulares reales cuando se implemente el RBAC de Módulo A.",
      modulo: "MODULO_A",
    },
  });

  const permisoTransferirStock = await prisma.permiso.upsert({
    where: { id: PERMISO_TRANSFERIR_STOCK_ID },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: { id: PERMISO_TRANSFERIR_STOCK_ID, codigo: "inventario:transferir_stock", descripcion: "Despachar transferencias internas de stock", modulo: "MODULO_A" },
  });
  const permisoConfirmarRecepcion = await prisma.permiso.upsert({
    where: { id: PERMISO_CONFIRMAR_RECEPCION_ID },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: { id: PERMISO_CONFIRMAR_RECEPCION_ID, codigo: "inventario:confirmar_recepcion", descripcion: "Confirmar la recepción física de una transferencia", modulo: "MODULO_A" },
  });

  // HU-A10 — permisos granulares del servicio centralizado de Reserva
  // (spec_modulo_A.md §2.9). Separados por acción, mismo patrón que
  // `inventario:transferir_stock` / `inventario:confirmar_recepcion`.
  // Pendiente: asignar a rol de Módulo B/E cuando se implemente HU-B3/HU-E1
  const permisoReservarStock = await prisma.permiso.upsert({
    where: { id: PERMISO_RESERVAR_STOCK_ID },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: { id: PERMISO_RESERVAR_STOCK_ID, codigo: "inventario:reservar_stock", descripcion: "Congelar stock creando una Reserva (seña, licitación o pedido institucional)", modulo: "MODULO_A" },
  });
  const permisoConfirmarReserva = await prisma.permiso.upsert({
    where: { id: PERMISO_CONFIRMAR_RESERVA_ID },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: { id: PERMISO_CONFIRMAR_RESERVA_ID, codigo: "inventario:confirmar_reserva", descripcion: "Liberar una Reserva por venta confirmada (RESERVADO → VENDIDO)", modulo: "MODULO_A" },
  });

  // HU-A11 — historial operativo de movimientos (spec_modulo_A.md §2.10).
  // Distinto de `auditoria:leer_historico` (Consola Forense, Módulo D): este
  // permiso es de uso operativo, sin verificación de cadena SHA-256.
  const permisoMovimientosLeerHistorico = await prisma.permiso.upsert({
    where: { id: PERMISO_MOVIMIENTOS_LEER_HISTORICO_ID },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: { id: PERMISO_MOVIMIENTOS_LEER_HISTORICO_ID, codigo: "inventario:movimientos:leer_historico", descripcion: "Consultar el historial operativo de movimientos de stock", modulo: "MODULO_A" },
  });

  const rolEncargadoDeposito = await prisma.rol.upsert({
    where: { id: ROL_ENCARGADO_DEPOSITO_ID },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: {
      id: ROL_ENCARGADO_DEPOSITO_ID,
      nombre: "ENCARGADO_DEPOSITO",
      descripcion:
        "Operación de depósito (Módulo A) — permiso placeholder hasta que exista RBAC granular",
    },
  });

  await prisma.rolPermiso.upsert({
    where: {
      rol_id_permiso_id: {
        rol_id: rolEncargadoDeposito.id,
        permiso_id: permisoInventarioOperar.id,
      },
    },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: {
      id: ROL_PERMISO_INVENTARIO_OPERAR_ID,
      rol_id: rolEncargadoDeposito.id,
      permiso_id: permisoInventarioOperar.id,
    },
  });

  for (const rol of [rolEncargadoDeposito, rolAdministrador]) {
    for (const permiso of [permisoTransferirStock, permisoConfirmarRecepcion, permisoReservarStock, permisoConfirmarReserva, permisoMovimientosLeerHistorico]) {
      await prisma.rolPermiso.upsert({
        where: { rol_id_permiso_id: { rol_id: rol.id, permiso_id: permiso.id } },
        update: REACTIVAR_REFERENCIA_RBAC,
        create: { rol_id: rol.id, permiso_id: permiso.id },
      });
    }
  }

  // ── Módulo D — Usuarios de ejemplo (uno por rol) ───────────────────────────

  const usuarioAdmin = await prisma.usuario.upsert({
    where: { nombre_usuario: "administrador.seed" },
    update: {},
    create: {
      id: USUARIO_ADMIN_SEED_ID,
      nombre_usuario: "administrador.seed",
      email: "admin.seed@erp-swat.local",
      password_hash: passwordSeed.hash,
      password_salt: passwordSeed.salt,
      nombre_completo: "Administrador Seed (Módulo D)",
      estado: "ACTIVO",
      is_active: true,
    },
  });

  await prisma.usuarioRol.upsert({
    where: {
      usuario_id_rol_id: {
        usuario_id: usuarioAdmin.id,
        rol_id: rolAdministrador.id,
      },
    },
    update: {},
    create: {
      id: USUARIO_ROL_ADMIN_ID,
      usuario_id: usuarioAdmin.id,
      rol_id: rolAdministrador.id,
    },
  });

  const usuarioAuditor = await prisma.usuario.upsert({
    where: { nombre_usuario: "auditor.seed" },
    update: {},
    create: {
      id: USUARIO_AUDITOR_SEED_ID,
      nombre_usuario: "auditor.seed",
      email: "auditor.seed@erp-swat.local",
      password_hash: passwordSeed.hash,
      password_salt: passwordSeed.salt,
      nombre_completo: "Auditor Seed (Módulo D)",
      estado: "ACTIVO",
      is_active: true,
    },
  });

  await prisma.usuarioRol.upsert({
    where: {
      usuario_id_rol_id: {
        usuario_id: usuarioAuditor.id,
        rol_id: rolAuditor.id,
      },
    },
    update: {},
    create: {
      id: USUARIO_ROL_AUDITOR_ID,
      usuario_id: usuarioAuditor.id,
      rol_id: rolAuditor.id,
    },
  });

  const usuarioEncargado = await prisma.usuario.upsert({
    where: { nombre_usuario: "encargado.seed" },
    update: {},
    create: {
      id: USUARIO_ENCARGADO_SEED_ID,
      nombre_usuario: "encargado.seed",
      email: "encargado.seed@erp-swat.local",
      password_hash: passwordSeed.hash,
      password_salt: passwordSeed.salt,
      nombre_completo: "Encargado de Depósito Seed (Módulo A)",
      estado: "ACTIVO",
      is_active: true,
    },
  });

  await prisma.usuarioRol.upsert({
    where: {
      usuario_id_rol_id: {
        usuario_id: usuarioEncargado.id,
        rol_id: rolEncargadoDeposito.id,
      },
    },
    update: {},
    create: {
      id: USUARIO_ROL_ENCARGADO_ID,
      usuario_id: usuarioEncargado.id,
      rol_id: rolEncargadoDeposito.id,
    },
  });

  // ── Módulo A — Catálogo adicional: Camisa Táctica y Borcegos ───────────────

  const productoCamisaTactica = await prisma.productoMaestro.upsert({
    where: { id: PRODUCTO_CAMISA_TACTICA_ID },
    update: {},
    create: {
      id: PRODUCTO_CAMISA_TACTICA_ID,
      codigo_producto: "CAMTAC",
      nombre: "Camisa Táctica",
      rubro: "Indumentaria",
      categoria: "Camisas",
      unidad_medida: "UNIDAD",
      descripcion: "Camisa táctica de uso general — datos de prueba",
      costo_estandar_referencia: 15800.0,
      is_active: true,
    },
  });

  const productoBorcegos = await prisma.productoMaestro.upsert({
    where: { id: PRODUCTO_BORCEGOS_ID },
    update: {},
    create: {
      id: PRODUCTO_BORCEGOS_ID,
      codigo_producto: "BORCEG",
      nombre: "Borcegos",
      rubro: "Calzado",
      categoria: "Botas",
      unidad_medida: "PAR",
      descripcion: "Borcegos de combate — datos de prueba",
      costo_estandar_referencia: 42000.0,
      is_active: true,
    },
  });

  const variantesCamisaTactica: {
    id: string;
    talle: string;
    color: string;
    genero: Genero;
    modelo: string;
    ean_qr: string;
  }[] = [
    {
      id: VARIANTE_CAMISA_TACTICA_1_ID,
      talle: "M",
      color: "Verde",
      genero: "HOMBRE",
      modelo: "Manga Larga",
      ean_qr: "7791234500024",
    },
    {
      id: VARIANTE_CAMISA_TACTICA_2_ID,
      talle: "L",
      color: "Negro",
      genero: "HOMBRE",
      modelo: "Manga Corta",
      ean_qr: "7791234500031",
    },
    {
      id: VARIANTE_CAMISA_TACTICA_3_ID,
      talle: "S",
      color: "Verde",
      genero: "MUJER",
      modelo: "Manga Larga",
      ean_qr: "7791234500048",
    },
  ];

  const variantesBorcegos: {
    id: string;
    talle: string;
    color: string;
    genero: Genero;
    modelo: string;
    ean_qr: string;
  }[] = [
    {
      id: VARIANTE_BORCEGOS_1_ID,
      talle: "42",
      color: "Negro",
      genero: "HOMBRE",
      modelo: "Combate",
      ean_qr: "7791234500055",
    },
    {
      id: VARIANTE_BORCEGOS_2_ID,
      talle: "38",
      color: "Negro",
      genero: "MUJER",
      modelo: "Combate",
      ean_qr: "7791234500062",
    },
  ];

  const varianteSkuById = new Map<string, { id: string; sku: string }>();

  for (const v of variantesCamisaTactica) {
    const sku = generarSku({
      codigoProducto: productoCamisaTactica.codigo_producto,
      modelo: v.modelo,
      talle: v.talle,
      codigoColor: v.color,
      genero: v.genero,
    });
    const creada = await prisma.varianteSKU.upsert({
      where: { id: v.id },
      // Ver comentario en el upsert de `varianteSku` más arriba: `update`
      // no vacío para autocorregir filas con SKU huérfano de una versión
      // previa del seed.
      update: {
        sku,
        ean_qr: v.ean_qr,
        talle: v.talle,
        color: v.color,
        genero: v.genero,
        modelo: v.modelo,
        is_active: true,
      },
      create: {
        id: v.id,
        producto_maestro_id: productoCamisaTactica.id,
        sku,
        ean_qr: v.ean_qr,
        talle: v.talle,
        color: v.color,
        genero: v.genero,
        modelo: v.modelo,
        is_active: true,
      },
    });
    varianteSkuById.set(v.id, { id: creada.id, sku: creada.sku });
  }

  for (const v of variantesBorcegos) {
    const sku = generarSku({
      codigoProducto: productoBorcegos.codigo_producto,
      modelo: v.modelo,
      talle: v.talle,
      codigoColor: v.color,
      genero: v.genero,
    });
    const creada = await prisma.varianteSKU.upsert({
      where: { id: v.id },
      update: {
        sku,
        ean_qr: v.ean_qr,
        talle: v.talle,
        color: v.color,
        genero: v.genero,
        modelo: v.modelo,
        is_active: true,
      },
      create: {
        id: v.id,
        producto_maestro_id: productoBorcegos.id,
        sku,
        ean_qr: v.ean_qr,
        talle: v.talle,
        color: v.color,
        genero: v.genero,
        modelo: v.modelo,
        is_active: true,
      },
    });
    varianteSkuById.set(v.id, { id: creada.id, sku: creada.sku });
  }

  // ── Módulo A — Depósitos adicionales ───────────────────────────────────────

  const depositoShowroom = await prisma.deposito.upsert({
    where: { id: DEPOSITO_SHOWROOM_ID },
    update: {},
    create: {
      id: DEPOSITO_SHOWROOM_ID,
      nombre: "Showroom",
      tipo: "SHOWROOM",
      direccion: "Local de exhibición — datos de prueba",
      is_active: true,
    },
  });

  const depositoMovil = await prisma.deposito.upsert({
    where: { id: DEPOSITO_MOVIL_ID },
    update: {},
    create: {
      id: DEPOSITO_MOVIL_ID,
      nombre: "Móvil",
      tipo: "MOVIL",
      direccion: "Unidad móvil de despliegue — datos de prueba",
      is_active: true,
    },
  });

  // ── Módulo A — StockDeposito inicial ───────────────────────────────────────

  const stockEntries = [
    {
      id: STOCK_CT1_CENTRAL_ID,
      vid: VARIANTE_CAMISA_TACTICA_1_ID,
      did: deposito.id,
      qty: 25,
      pp: 8,
      ss: 3,
    },
    {
      id: STOCK_CT2_CENTRAL_ID,
      vid: VARIANTE_CAMISA_TACTICA_2_ID,
      did: deposito.id,
      qty: 18,
      pp: 0,
      ss: 0,
    },
    {
      id: STOCK_CT3_CENTRAL_ID,
      vid: VARIANTE_CAMISA_TACTICA_3_ID,
      did: deposito.id,
      qty: 12,
      pp: 0,
      ss: 0,
    },
    {
      id: STOCK_B1_CENTRAL_ID,
      vid: VARIANTE_BORCEGOS_1_ID,
      did: deposito.id,
      qty: 30,
      pp: 0,
      ss: 0,
    },
    {
      id: STOCK_B2_CENTRAL_ID,
      vid: VARIANTE_BORCEGOS_2_ID,
      did: deposito.id,
      qty: 14,
      pp: 0,
      ss: 0,
    },
    {
      id: STOCK_CT1_SHOWROOM_ID,
      vid: VARIANTE_CAMISA_TACTICA_1_ID,
      did: depositoShowroom.id,
      qty: 4,
      pp: 0,
      ss: 0,
    },
    {
      id: STOCK_B1_SHOWROOM_ID,
      vid: VARIANTE_BORCEGOS_1_ID,
      did: depositoShowroom.id,
      qty: 3,
      pp: 0,
      ss: 0,
    },
    {
      id: STOCK_CT2_MOVIL_ID,
      vid: VARIANTE_CAMISA_TACTICA_2_ID,
      did: depositoMovil.id,
      qty: 6,
      pp: 0,
      ss: 0,
    },
  ];

  for (const s of stockEntries) {
    await prisma.stockDeposito.upsert({
      where: {
        variante_sku_id_deposito_id: {
          variante_sku_id: s.vid,
          deposito_id: s.did,
        },
      },
      update: {},
      create: {
        id: s.id,
        variante_sku_id: s.vid,
        deposito_id: s.did,
        cantidad: s.qty,
        punto_pedido: s.pp,
        stock_seguridad: s.ss,
        is_active: true,
      },
    });
  }

  // ── Módulo D — RBAC: Sprint 2 (Compras/Proveedores — Módulo H, Tesorería — Módulo G) ─
  //
  // Mismo patrón placeholder que permisoInventarioOperar: permisos genéricos
  // por ahora, a reemplazar por RBAC granular cuando el equipo lo defina.

  const permisoProveedoresAdministrar = await prisma.permiso.upsert({
    where: { id: PERMISO_PROVEEDORES_ADMINISTRAR_ID },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: {
      id: PERMISO_PROVEEDORES_ADMINISTRAR_ID,
      codigo: "proveedores:administrar",
      descripcion:
        "PLACEHOLDER — alta, homologación y suspensión de proveedores (HU-H1). " +
        "Reemplazar por permisos granulares reales si el equipo lo define en Planning.",
      modulo: "MODULO_H",
    },
  });

  const permisoComprasOperar = await prisma.permiso.upsert({
    where: { id: PERMISO_COMPRAS_OPERAR_ID },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: {
      id: PERMISO_COMPRAS_OPERAR_ID,
      codigo: "compras:operar",
      descripcion:
        "PLACEHOLDER — crear y hacer seguimiento de órdenes de compra (HU-H3).",
      modulo: "MODULO_H",
    },
  });

  const permisoRecepcionConfirmar = await prisma.permiso.upsert({
    where: { id: PERMISO_RECEPCION_CONFIRMAR_ID },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: {
      id: PERMISO_RECEPCION_CONFIRMAR_ID,
      codigo: "compras:confirmar_recepcion",
      descripcion:
        "PLACEHOLDER — registrar recepción física de mercadería contra una OC (HU-H4).",
      modulo: "MODULO_H",
    },
  });

  const permisoTesoreriaOperar = await prisma.permiso.upsert({
    where: { id: PERMISO_TESORERIA_OPERAR_ID },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: {
      id: PERMISO_TESORERIA_OPERAR_ID,
      codigo: "tesoreria:operar",
      descripcion:
        "PLACEHOLDER — gestionar compromisos de pago y Cuentas por Pagar (HU-G8).",
      modulo: "MODULO_G",
    },
  });

  const rolComprador = await prisma.rol.upsert({
    where: { id: ROL_COMPRADOR_ID },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: {
      id: ROL_COMPRADOR_ID,
      nombre: "COMPRADOR",
      descripcion:
        "Gestión de proveedores y órdenes de compra (Módulo H) — permisos placeholder",
    },
  });

  const rolTesorero = await prisma.rol.upsert({
    where: { id: ROL_TESORERO_ID },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: {
      id: ROL_TESORERO_ID,
      nombre: "TESORERO_CENTRAL",
      descripcion:
        "Gestión de compromisos de pago y Cuentas por Pagar (Módulo G) — permisos placeholder",
    },
  });

  // ── HU-H3 — permisos granulares de OrdenCompra (spec_modulo_H.md §2.5) ─────
  //
  // Un permiso independiente por acción (NO un `ordenes_compra:administrar`).
  const permisosOrdenCompra = await Promise.all(
    (
      [
        [PERMISO_OC_CREAR_ID, "ordenes_compra:crear", "Crear/solicitar una orden de compra en estado BORRADOR (HU-H3 §2.4)"],
        [PERMISO_OC_ENVIAR_ID, "ordenes_compra:enviar", "Emitir (enviar) una orden BORRADOR → ENVIADA al proveedor — exclusivo Supervisor de Compras (Alcance §2.1/§5)"],
        [PERMISO_OC_CONFIRMAR_ID, "ordenes_compra:confirmar", "Confirmar una orden ENVIADA → CONFIRMADA con fecha de entrega (HU-H3 §2.5)"],
        [PERMISO_OC_CERRAR_ID, "ordenes_compra:cerrar", "Cerrar una orden RECIBIDA_COMPLETA → CERRADA (HU-H3 §2.5)"],
        [PERMISO_OC_CANCELAR_ID, "ordenes_compra:cancelar", "Cancelar (baja lógica) una orden BORRADOR/ENVIADA (HU-H3 §2.5)"],
      ] as const
    ).map(([id, codigo, descripcion]) =>
      prisma.permiso.upsert({
        where: { id },
        update: REACTIVAR_REFERENCIA_RBAC,
        create: { id, codigo, descripcion, modulo: "MODULO_H" },
      }),
    ),
  );
  const [
    permisoOcCrear,
    permisoOcEnviar,
    permisoOcConfirmar,
    permisoOcCerrar,
    permisoOcCancelar,
  ] = permisosOrdenCompra;

  // ── Rol Supervisor de Compras (Alcance Funcional §2.1 / §5) ───────────────
  // Decisión "Comprador Solicita / Supervisor Emite": el paso
  // BORRADOR → ENVIADA es exclusivo de este rol. Antes de esta tarea el rol
  // NO existía en el seed — se crea acá.
  const rolSupervisorCompras = await prisma.rol.upsert({
    where: { id: ROL_SUPERVISOR_COMPRAS_ID },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: {
      id: ROL_SUPERVISOR_COMPRAS_ID,
      nombre: "SUPERVISOR_COMPRAS",
      descripcion:
        "Supervisión del circuito de compras (Módulo H) — emite (envía) órdenes al proveedor; segregación de funciones frente al Comprador (Alcance §5)",
    },
  });

  // Reparto de permisos del circuito de OC entre Comprador y Supervisor.
  // Decisión final del equipo (Alcance §5 + acuerdo posterior):
  //   - ordenes_compra:crear     → Comprador Y Supervisor (ambos crean/solicitan)
  //   - ordenes_compra:enviar    → SOLO Supervisor de Compras
  //   - ordenes_compra:confirmar → Comprador Y Supervisor (registro de seguimiento)
  //   - ordenes_compra:cerrar    → Comprador Y Supervisor (conciliación administrativa)
  //   - ordenes_compra:cancelar  → SOLO Supervisor de Compras (revertir una orden
  //                                impacta la negociación — mismo criterio que enviar)
  const permisosComprador = [
    permisoProveedoresAdministrar,
    permisoComprasOperar,
    permisoRecepcionConfirmar,
    permisoOcCrear,
    permisoOcConfirmar,
    permisoOcCerrar,
  ];
  const permisosSupervisorCompras = [
    permisoOcCrear,
    permisoOcEnviar,
    permisoOcConfirmar,
    permisoOcCerrar,
    permisoOcCancelar,
  ];

  for (const permiso of permisosComprador) {
    await prisma.rolPermiso.upsert({
      where: {
        rol_id_permiso_id: { rol_id: rolComprador.id, permiso_id: permiso.id },
      },
      update: REACTIVAR_REFERENCIA_RBAC,
      create: { rol_id: rolComprador.id, permiso_id: permiso.id },
    });
  }

  for (const permiso of permisosSupervisorCompras) {
    await prisma.rolPermiso.upsert({
      where: {
        rol_id_permiso_id: {
          rol_id: rolSupervisorCompras.id,
          permiso_id: permiso.id,
        },
      },
      update: REACTIVAR_REFERENCIA_RBAC,
      create: { rol_id: rolSupervisorCompras.id, permiso_id: permiso.id },
    });
  }

  // El Comprador ya NO puede emitir (enviar) NI cancelar una orden — ambas
  // exclusivas del Supervisor de Compras. Si una corrida previa del seed dejó
  // los vínculos viejos, se eliminan (este seed es dueño de RolPermiso — ver
  // cabecera del archivo).
  await prisma.rolPermiso.deleteMany({
    where: {
      rol_id: rolComprador.id,
      permiso_id: { in: [permisoOcEnviar.id, permisoOcCancelar.id] },
    },
  });

  await prisma.rolPermiso.upsert({
    where: {
      rol_id_permiso_id: {
        rol_id: rolTesorero.id,
        permiso_id: permisoTesoreriaOperar.id,
      },
    },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: {
      id: ROL_PERMISO_TESORERIA_OPERAR_ID,
      rol_id: rolTesorero.id,
      permiso_id: permisoTesoreriaOperar.id,
    },
  });

  // ── Módulo D — Usuarios de ejemplo Sprint 2 (Comprador, Tesorero) ──────────

  const usuarioComprador = await prisma.usuario.upsert({
    where: { nombre_usuario: "comprador.seed" },
    update: {},
    create: {
      id: USUARIO_COMPRADOR_SEED_ID,
      nombre_usuario: "comprador.seed",
      email: "comprador.seed@erp-swat.local",
      password_hash: passwordSeed.hash,
      password_salt: passwordSeed.salt,
      nombre_completo: "Comprador Seed (Módulo H)",
      estado: "ACTIVO",
      is_active: true,
    },
  });

  await prisma.usuarioRol.upsert({
    where: {
      usuario_id_rol_id: {
        usuario_id: usuarioComprador.id,
        rol_id: rolComprador.id,
      },
    },
    update: {},
    create: {
      id: USUARIO_ROL_COMPRADOR_ID,
      usuario_id: usuarioComprador.id,
      rol_id: rolComprador.id,
    },
  });

  const usuarioSupervisorCompras = await prisma.usuario.upsert({
    where: { nombre_usuario: "supervisor.compras.seed" },
    update: {},
    create: {
      id: USUARIO_SUPERVISOR_COMPRAS_SEED_ID,
      nombre_usuario: "supervisor.compras.seed",
      email: "supervisor.compras.seed@erp-swat.local",
      password_hash: passwordSeed.hash,
      password_salt: passwordSeed.salt,
      nombre_completo: "Supervisor de Compras Seed (Módulo H)",
      estado: "ACTIVO",
      is_active: true,
    },
  });

  await prisma.usuarioRol.upsert({
    where: {
      usuario_id_rol_id: {
        usuario_id: usuarioSupervisorCompras.id,
        rol_id: rolSupervisorCompras.id,
      },
    },
    update: {},
    create: {
      id: USUARIO_ROL_SUPERVISOR_COMPRAS_ID,
      usuario_id: usuarioSupervisorCompras.id,
      rol_id: rolSupervisorCompras.id,
    },
  });

  const usuarioTesorero = await prisma.usuario.upsert({
    where: { nombre_usuario: "tesorero.seed" },
    update: {},
    create: {
      id: USUARIO_TESORERO_SEED_ID,
      nombre_usuario: "tesorero.seed",
      email: "tesorero.seed@erp-swat.local",
      password_hash: passwordSeed.hash,
      password_salt: passwordSeed.salt,
      nombre_completo: "Tesorero Central Seed (Módulo G)",
      estado: "ACTIVO",
      is_active: true,
    },
  });

  await prisma.usuarioRol.upsert({
    where: {
      usuario_id_rol_id: {
        usuario_id: usuarioTesorero.id,
        rol_id: rolTesorero.id,
      },
    },
    update: {},
    create: {
      id: USUARIO_ROL_TESORERO_ID,
      usuario_id: usuarioTesorero.id,
      rol_id: rolTesorero.id,
    },
  });

  // ── Módulo H — Proveedores (HU-H1) ─────────────────────────────────────────
  //
  // Dos proveedores: uno HOMOLOGADO (destraba a Tomás/HU-H3 sin esperar que
  // Rama termine la lógica real de homologación) y uno PENDIENTE (para poder
  // probar que un proveedor no homologado queda excluido de la selección en
  // una nueva OC).

  const proveedorHomologado = await prisma.proveedor.upsert({
    where: { id: PROVEEDOR_HOMOLOGADO_ID },
    update: {
      estado: "HOMOLOGADO",
      is_active: true,
    },
    create: {
      id: PROVEEDOR_HOMOLOGADO_ID,
      razon_social: "Indumentaria Táctica del Sur S.A.",
      nombre_fantasia: "InduSur",
      cuit: "30-71234567-8",
      condiciones_pago: "30 días FF",
      categorias: ["Textil Táctico", "Calzado"],
      estado: "HOMOLOGADO",
      contacto_nombre: "Marcela Ibáñez",
      contacto_email: "compras@indusur.example.com",
      contacto_telefono: "+54 387 400-1234",
      is_active: true,
    },
  });

  const proveedorPendiente = await prisma.proveedor.upsert({
    where: { id: PROVEEDOR_PENDIENTE_ID },
    update: {},
    create: {
      id: PROVEEDOR_PENDIENTE_ID,
      razon_social: "Calzado Norte SRL",
      nombre_fantasia: "Calzado Norte",
      cuit: "30-70987654-3",
      condiciones_pago: "Contado",
      categorias: ["Calzado"],
      estado: "PENDIENTE",
      contacto_nombre: "Julián Reyes",
      contacto_email: "ventas@calzadonorte.example.com",
      is_active: true,
    },
  });

  // ── Módulo H — Lista de precios vigente del proveedor HOMOLOGADO (HU-H3, Camino A) ─
  //
  // spec_modulo_H.md §2.4: HU-H2 (publicación de listas por endpoint) quedó
  // fuera de Sprint 2, así que la "lista de precios vigente" contra la que
  // HU-H3 arma la orden se siembra acá directo por Prisma Client. Una
  // ListaPrecio ancla + una ListaPrecioVersion `publicada = true` con
  // `fecha_inicio_vigencia` en el pasado + N ListaPrecioItem (precio por
  // VarianteSKU). HU-H3 resuelve el precio con:
  //   publicada = true AND fecha_inicio_vigencia <= now(), orden desc, take(1).

  const listaPrecioHomologado = await prisma.listaPrecio.upsert({
    where: { id: LISTA_PRECIO_HOMOLOGADO_ID },
    update: {},
    create: {
      id: LISTA_PRECIO_HOMOLOGADO_ID,
      proveedor_id: proveedorHomologado.id,
      is_active: true,
    },
  });

  const listaPrecioVersion = await prisma.listaPrecioVersion.upsert({
    where: { id: LISTA_PRECIO_VERSION_ID },
    update: { publicada: true, is_active: true },
    create: {
      id: LISTA_PRECIO_VERSION_ID,
      lista_precio_id: listaPrecioHomologado.id,
      fecha_inicio_vigencia: diasAtras(30),
      variacion_porcentual_maxima: 0,
      requiere_aprobacion: false,
      publicada: true,
      is_active: true,
    },
  });

  for (const [id, varianteSkuId, precio] of [
    [LISTA_PRECIO_ITEM_CAMISA_1_ID, VARIANTE_CAMISA_TACTICA_1_ID, 15800.0],
    [LISTA_PRECIO_ITEM_CAMISA_2_ID, VARIANTE_CAMISA_TACTICA_2_ID, 16250.0],
    [LISTA_PRECIO_ITEM_BORCEGOS_1_ID, VARIANTE_BORCEGOS_1_ID, 42000.0],
  ] as const) {
    await prisma.listaPrecioItem.upsert({
      where: { id },
      update: { precio_unitario: precio, is_active: true },
      create: {
        id,
        lista_precio_version_id: listaPrecioVersion.id,
        variante_sku_id: varianteSkuId,
        precio_unitario: precio,
        is_active: true,
      },
    });
  }

  // ── Módulo H — Orden de Compra confirmada (HU-H3) ──────────────────────────
  //
  // Estado CONFIRMADA: destraba a Emir/HU-H4 sin esperar que Tomás tenga el
  // wizard de creación de OC funcionando de punta a punta. Dos ítems, contra
  // variantes de Camisa Táctica y Borcegos que ya existen en el seed de
  // Módulo A.

  const ordenCompraConfirmada = await prisma.ordenCompra.upsert({
    where: { id: ORDEN_COMPRA_CONFIRMADA_ID },
    update: {},
    create: {
      id: ORDEN_COMPRA_CONFIRMADA_ID,
      numero_orden: "OC-2026-0001",
      proveedor_id: proveedorHomologado.id,
      estado: "CONFIRMADA",
      fecha_envio: diasAtras(5),
      fecha_confirmacion: diasAtras(4),
      observaciones: "OC de prueba — seed Sprint 2",
      creada_por_id: usuarioComprador.id,
      is_active: true,
    },
  });

  const ordenCompraItem1 = await prisma.ordenCompraItem.upsert({
    where: { id: ORDEN_COMPRA_ITEM_1_ID },
    update: {},
    create: {
      id: ORDEN_COMPRA_ITEM_1_ID,
      orden_compra_id: ordenCompraConfirmada.id,
      variante_sku_id: VARIANTE_CAMISA_TACTICA_1_ID,
      cantidad_solicitada: 20,
      precio_unitario: 15800.0,
      is_active: true,
    },
  });

  const ordenCompraItem2 = await prisma.ordenCompraItem.upsert({
    where: { id: ORDEN_COMPRA_ITEM_2_ID },
    update: {},
    create: {
      id: ORDEN_COMPRA_ITEM_2_ID,
      orden_compra_id: ordenCompraConfirmada.id,
      variante_sku_id: VARIANTE_BORCEGOS_1_ID,
      cantidad_solicitada: 10,
      precio_unitario: 42000.0,
      is_active: true,
    },
  });

  // ── Módulo H — Recepción con discrepancia (HU-H4) ──────────────────────────
  //
  // Recepción parcial del ítem de Camisa Táctica (18 de 20 solicitadas, con
  // una discrepancia de CANTIDAD documentada). Destraba a Adriel/HU-H5 sin
  // esperar que Emir tenga la lógica real de recepción funcionando.

  const recepcionSeed = await prisma.recepcion.upsert({
    where: { id: RECEPCION_SEED_ID },
    update: {},
    create: {
      id: RECEPCION_SEED_ID,
      orden_compra_id: ordenCompraConfirmada.id,
      numero_remito_proveedor: "REM-0001-00012345",
      fecha_recepcion: diasAtras(2),
      recibida_por_id: usuarioEncargado.id,
      observaciones: "Recepción parcial — seed Sprint 2",
      is_active: true,
    },
  });

  const recepcionItem1 = await prisma.recepcionItem.upsert({
    where: { id: RECEPCION_ITEM_1_ID },
    update: {},
    create: {
      id: RECEPCION_ITEM_1_ID,
      recepcion_id: recepcionSeed.id,
      orden_compra_item_id: ordenCompraItem1.id,
      cantidad_recibida: 18,
      is_active: true,
    },
  });

  await prisma.recepcionDiscrepancia.upsert({
    where: { id: RECEPCION_DISCREPANCIA_1_ID },
    update: {},
    create: {
      id: RECEPCION_DISCREPANCIA_1_ID,
      recepcion_item_id: recepcionItem1.id,
      tipo: "CANTIDAD",
      detalle: "Faltaron 2 unidades respecto de lo solicitado (20 → 18) — seed Sprint 2",
      is_active: true,
    },
  });

  // ── Módulo G — Cuenta por Pagar provisoria (HU-G8) ─────────────────────────
  //
  // Nace en PROVISORIO al enviarse la OC (ver decisión de diseño reportada
  // por Claude Code: "aprobarse la OC" se interpreta como el paso a ENVIADA
  // hasta que el equipo defina si hace falta un estado de aprobación
  // separado). Todavía sin recepcion_id definitivo porque la recepción de
  // arriba es parcial, no total.

  await prisma.cuentaPorPagar.upsert({
    where: { id: CUENTA_POR_PAGAR_PROVISORIA_ID },
    update: {},
    create: {
      id: CUENTA_POR_PAGAR_PROVISORIA_ID,
      orden_compra_id: ordenCompraConfirmada.id,
      monto: 736000.0, // 20 × 15800 + 10 × 42000, sobre lo solicitado (no lo recibido)
      estado: "PROVISORIO",
      is_active: true,
    },
  });

  // ── Módulo H — Evaluación de proveedor (HU-H5) ─────────────────────────────
  //
  // Un registro de evaluación ya cargado contra el proveedor homologado, para
  // que Adriel pueda programar el cálculo del puntaje ponderado sin esperar
  // más recepciones reales.

  await prisma.evaluacionProveedor.upsert({
    where: { id: EVALUACION_PROVEEDOR_SEED_ID },
    update: {},
    create: {
      id: EVALUACION_PROVEEDOR_SEED_ID,
      proveedor_id: proveedorHomologado.id,
      recepcion_id: recepcionSeed.id,
      puntaje_cumplimiento_plazos: 90,
      puntaje_calidad_recepcion: 80,
      puntaje_documentacion: 100,
      puntaje_total: 88.5,
      devoluciones_fabricacion: null, // insumo de Módulo I, todavía no existe
      observaciones: "Evaluación de prueba — seed Sprint 2",
      evaluado_por_id: usuarioComprador.id,
      fecha_evaluacion: diasAtras(1),
      is_active: true,
    },
  });

  // ── Resumen final ───────────────────────────────────────────────────────────

  console.log("\nSeed HU-7 completado:");
  console.table({
    usuario_id: usuario.id,
    producto_maestro_id: productoMaestro.id,
    variante_sku_id: varianteSku.id,
    deposito_id: deposito.id,
    stock_deposito_id: stockDeposito.id,
    movimiento_egreso_1_id: MOVIMIENTO_EGRESO_1_ID,
    movimiento_egreso_2_id: MOVIMIENTO_EGRESO_2_ID,
    movimiento_egreso_3_id: MOVIMIENTO_EGRESO_3_ID,
  });

  console.log("\nSeed RBAC — Módulo D completado:");
  console.table({
    permiso_leer_forense_id: permisoLeerForense.id,
    permiso_verificar_cadena_id: permisoVerificarCadena.id,
    permiso_roles_administrar_id: permisoRolesAdministrar.id,
    permiso_inventario_operar_id: permisoInventarioOperar.id,
    rol_auditor_id: rolAuditor.id,
    rol_administrador_id: rolAdministrador.id,
    rol_encargado_deposito_id: rolEncargadoDeposito.id,
  });

  console.log(
    `\nSeed usuarios de ejemplo completado (password: "${PASSWORD_SEED}"):`,
  );
  console.table({
    administrador_seed: `${usuarioAdmin.nombre_usuario}  <${usuarioAdmin.email}>`,
    auditor_seed: `${usuarioAuditor.nombre_usuario}       <${usuarioAuditor.email}>`,
    encargado_seed: `${usuarioEncargado.nombre_usuario}     <${usuarioEncargado.email}>`,
  });

  console.log("\nSeed Módulo A — catálogo adicional completado:");
  console.table({
    producto_camisa_tactica_id: productoCamisaTactica.id,
    producto_borcegos_id: productoBorcegos.id,
    deposito_showroom_id: depositoShowroom.id,
    deposito_movil_id: depositoMovil.id,
    ...Object.fromEntries(
      [...varianteSkuById.entries()].map(([id, v]) => [
        `variante_${id.slice(0, 8)}`,
        v.sku,
      ]),
    ),
  });

  console.log(
    `\nSeed Sprint 2 — Módulo H / Módulo G completado (password: "${PASSWORD_SEED}"):`,
  );
  console.table({
    comprador_seed: `${usuarioComprador.nombre_usuario}  <${usuarioComprador.email}>`,
    supervisor_compras_seed: `${usuarioSupervisorCompras.nombre_usuario}  <${usuarioSupervisorCompras.email}>`,
    tesorero_seed: `${usuarioTesorero.nombre_usuario}   <${usuarioTesorero.email}>`,
    proveedor_homologado_id: proveedorHomologado.id,
    proveedor_pendiente_id: proveedorPendiente.id,
    lista_precio_version_vigente_id: listaPrecioVersion.id,
    orden_compra_confirmada_id: ordenCompraConfirmada.id,
    orden_compra_numero: ordenCompraConfirmada.numero_orden,
    recepcion_id: recepcionSeed.id,
    cuenta_por_pagar_id: CUENTA_POR_PAGAR_PROVISORIA_ID,
    evaluacion_proveedor_id: EVALUACION_PROVEEDOR_SEED_ID,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
