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

  for (const egreso of egresos) {
    await prisma.movimientoStock.upsert({
      where: { id: egreso.id },
      update: {},
      create: {
        id: egreso.id,
        variante_sku_id: varianteSku.id,
        deposito_origen_id: deposito.id,
        deposito_destino_id: null,
        tipo_movimiento: "EGRESO",
        estado_origen: "DISPONIBLE",
        cantidad: egreso.cantidad,
        comprobante_referencia: `SEED-EGRESO-${egreso.cantidad}`,
        registrado_por_id: usuario.id,
        created_at: diasAtras(egreso.hace_dias),
        is_active: true,
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

}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
