// ============================================================================
// Password de TODOS los usuarios de prueba sembrados por este archivo:
//
//     abc123456789
//
// Derivada con hashPassword() de lib/auth/password-hash-core.ts — el mismo
// algoritmo Argon2id que usa la app real (lib/auth/password.ts lo reexporta
// con el guard `server-only` puesto para el resto de la app; este archivo
// importa el núcleo directo porque `prisma db seed` corre vía `tsx` plano,
// fuera del bundler de Next.js, donde `server-only` lanzaría una excepción
// al cargar el módulo).
// ============================================================================
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "@/lib/auth/password-hash-core";

const prisma = new PrismaClient();

const PASSWORD_SEED = "abc123456789";

/**
 * Reactivación explícita para las filas RBAC PURAMENTE definicionales que
 * este seed posee por completo (`Permiso`, `Rol`, `RolPermiso`): si alguna
 * quedó soft-deleteada por una prueba manual (ej. un script de concurrencia
 * que reasigna permisos de prueba), volver a correr el seed debe restaurar
 * el grafo RBAC de referencia a su estado conocido. Deliberadamente NO se
 * aplica a `Usuario`, `UsuarioRol` ni a las entidades de Módulo A
 * (`ProductoMaestro`/`VarianteSKU`/`Deposito`/`StockDeposito`/
 * `MovimientoStock`) — esas sí son sujetos de prueba habituales de flujos
 * de baja lógica/cambio de estado, y reactivarlas solas silenciosamente
 * revertiría el estado de una prueba en curso (contradice el requisito de
 * "no pisar datos existentes").
 */
const REACTIVAR_REFERENCIA_RBAC = {
  is_active: true,
  deleted_at: null,
  deleted_by: null,
  deletion_reason: null,
};

/**
 * IDs fijos (no @default(uuid()) al insertar) para que el seed sea
 * idempotente vía `upsert` y para que
 * `src/app/(dashboard)/inventario/depositos/page.tsx` pueda referenciar
 * exactamente estos registros sin copiar/pegar el output de cada corrida.
 */
const USUARIO_SEED_ID = "8c682c21-d075-4665-9cd2-ed0285c80f91";
const PERMISO_LEER_FORENSE_ID = "d45883eb-0c09-4564-8b95-beefcf61d05d";
const PERMISO_VERIFICAR_CADENA_ID = "8edff94c-5e73-4be4-b774-87409cafd8bb";
const ROL_AUDITOR_ID = "cfe51d79-332c-4217-8906-481f2a94a1cc";
const ROL_PERMISO_LEER_FORENSE_ID = "c05147a1-8b65-4362-91ef-f631ec30fa67";
const ROL_PERMISO_VERIFICAR_CADENA_ID = "cc582af5-de13-4345-b290-de1e478312ea";
const PERMISO_ROLES_ADMINISTRAR_ID = "9b1217cb-3802-4ad0-b026-ed95b0b8b6e4";
const ROL_ADMINISTRADOR_ID = "2998bb21-960c-474c-8941-848d1f20038e";
const ROL_PERMISO_ROLES_ADMINISTRAR_ID = "8535ced4-40fb-4cc3-bb51-eec97c4ddc49";
const PRODUCTO_MAESTRO_SEED_ID = "cccf5533-44b5-4ed2-99e5-0d29c20da167";
const VARIANTE_SKU_SEED_ID = "fadabd3f-991e-4e26-90f2-ad8cc97856c7";
const DEPOSITO_SEED_ID = "a61c8fe5-bac1-4c4f-a15a-9a2ff1c7c95a";
const STOCK_DEPOSITO_SEED_ID = "90bb1fa7-d5f4-40fa-aa0c-ffeab09082e6";
const MOVIMIENTO_EGRESO_1_ID = "a74c7b59-1d02-4d32-b839-205bd67f14ec";
const MOVIMIENTO_EGRESO_2_ID = "d0290236-d5b5-485f-9063-afe5e760548b";
const MOVIMIENTO_EGRESO_3_ID = "c7d4f09e-d987-4356-b052-121a67b14558";

// --- Usuarios de ejemplo (uno por rol) ---
// NOTA: nombre_usuario "admin.seed" NO se usa acá a propósito — ya existe una
// fila manual con ese nombre_usuario (creada fuera de este seed, en estado
// INACTIVO) y nombre_usuario es @unique. Se usa "administrador.seed" para no
// pisarla ni asumir que es propiedad de este seed.
const USUARIO_ADMIN_SEED_ID = "64a0a7e3-76e2-4637-828e-f7cb96756597";
const USUARIO_AUDITOR_SEED_ID = "0e273fcf-b944-4580-a610-062f7a92a384";
const USUARIO_ENCARGADO_SEED_ID = "77b685fd-ac1c-4af5-9f59-48830d96c9ea";
const USUARIO_ROL_ADMIN_ID = "9d8356d0-b396-4a95-9934-5824614d5c3a";
const USUARIO_ROL_AUDITOR_ID = "dd26a842-a1a1-4a21-a920-5dad6e4c5a9a";
const USUARIO_ROL_ENCARGADO_ID = "31827e93-6bdb-44ec-87e0-9607c51c1837";

// --- RBAC mínimo para Encargado de Depósito (Módulo A) ---
const PERMISO_INVENTARIO_OPERAR_ID = "874a1bb2-fb27-4d51-97b0-c29288bfb01c";
const ROL_ENCARGADO_DEPOSITO_ID = "1ce2f5fc-8b66-4496-82de-36d434bc79aa";
const ROL_PERMISO_INVENTARIO_OPERAR_ID = "2f19285c-6494-4e97-aee6-99fdb48feadd";

// --- Módulo A: catálogo adicional ---
const PRODUCTO_CAMISA_TACTICA_ID = "9e717646-bd40-47d7-9bc3-1c5bf053becb";
const PRODUCTO_BORCEGOS_ID = "cf6b1caa-ef43-4554-ade4-f9e225a2993a";

const VARIANTE_CAMISA_TACTICA_1_ID = "407e729d-47c3-404d-a89a-0a9c1f85a3db"; // M, Verde, Masculino, Manga Larga
const VARIANTE_CAMISA_TACTICA_2_ID = "6fbb4612-9e6d-4661-b250-0bc62579089e"; // L, Negro, Masculino, Manga Corta
const VARIANTE_CAMISA_TACTICA_3_ID = "0929aab1-57fb-44bc-90b6-76417c76c016"; // S, Verde, Femenino, Manga Larga
const VARIANTE_BORCEGOS_1_ID = "864c2765-cbdd-41eb-837a-e12814b62868"; // 42, Negro, Masculino, Combate
const VARIANTE_BORCEGOS_2_ID = "79f41b7f-a667-4867-b3cc-2c73f6134086"; // 38, Negro, Femenino, Combate

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

function diasAtras(dias: number): Date {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() - dias);
  return fecha;
}

/**
 * Réplica del algoritmo determinístico de `spec_modulo_A.md` §2.1:
 * `[PRODUCTO]-[MODELO]-[TALLE]-[COLOR]-[GENERO]`, normalizado a mayúsculas
 * y sin espacios. NO se pudo importar la implementación real porque
 * `lib/services/inventario/producto.service.ts` está vacío (no implementado
 * todavía) al momento de escribir este seed — cuando exista, reemplazar este
 * helper por un import directo, no mantener dos copias del algoritmo.
 *
 * Nota: el `VarianteSKU` sembrado en rondas anteriores ("Camisa de Policía")
 * tiene un `sku` tipeado a mano ("CAMISA-POLICIA-M-AZUL-MASCULINO") que no
 * se recalcula con este helper — se deja intacto (upsert por `id`, no se
 * toca su valor existente) para no romper la referencia ya usada en
 * `depositos/page.tsx` y en los `MovimientoStock` de HU-7.
 */
const RANGO_DIACRITICOS_COMBINANTES_DESDE = 0x0300;
const RANGO_DIACRITICOS_COMBINANTES_HASTA = 0x036f;

function normalizarSegmentoSku(valor: string): string {
  // NFD separa cada letra acentuada en (letra base + marca diacrítica
  // combinante); filtrar el rango Unicode de marcas combinantes despoja
  // el acento sin tocar la letra base (Táctica -> Tactica -> TACTICA).
  const sinDiacriticos = Array.from(valor.normalize("NFD"))
    .filter((caracter) => {
      const codigo = caracter.codePointAt(0) ?? 0;
      return codigo < RANGO_DIACRITICOS_COMBINANTES_DESDE || codigo > RANGO_DIACRITICOS_COMBINANTES_HASTA;
    })
    .join("");

  return sinDiacriticos.toUpperCase().replace(/\s+/g, ""); // "sin espacios" (spec_modulo_A.md §2.1)
}

function calcularSkuDeterministico(params: {
  nombreProducto: string;
  modelo: string;
  talle: string;
  color: string;
  genero: string;
}): string {
  return [params.nombreProducto, params.modelo, params.talle, params.color, params.genero]
    .map(normalizarSegmentoSku)
    .join("-");
}

async function main() {
  const passwordSeed = await hashPassword(PASSWORD_SEED);

  const usuario = await prisma.usuario.upsert({
    where: { id: USUARIO_SEED_ID },
    update: {
      // Migración puntual: este usuario se sembró en una ronda anterior
      // (antes de que `lib/auth/password.ts` existiera) con un hash falso
      // marcado explícitamente como "no es una credencial real". Ahora que
      // hashPassword() existe, se lo actualiza a una credencial real y
      // consistente con el resto de los usuarios de este seed.
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
      nombre: "Camisa de Policía",
      rubro: "Indumentaria",
      categoria: "Camisas",
      unidad_medida: "UNIDAD",
      descripcion: "Camisa táctica reglamentaria — datos de prueba HU-7",
      costo_estandar_referencia: 12500.0,
      is_active: true,
    },
  });

  const varianteSku = await prisma.varianteSKU.upsert({
    where: { id: VARIANTE_SKU_SEED_ID },
    update: {},
    create: {
      id: VARIANTE_SKU_SEED_ID,
      producto_maestro_id: productoMaestro.id,
      sku: "CAMISA-POLICIA-M-AZUL-MASCULINO",
      ean_qr: "7791234500017",
      talle: "M",
      color: "Azul",
      genero: "Masculino",
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

  // 3 egresos dentro de los últimos 2 meses, para que
  // calcularPromedioMovilEgresos (meses_historico default = 3) tenga
  // historial real con el que calcular el promedio móvil sugerido.
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

  // ──────────────────────────────────────────────────────────────────────
  // Datos de referencia RBAC — D.3 (Consola de Auditoría Forense)
  // Mínimo indispensable para que la regla de segregación de funciones
  // (spec_modulo_D.md §3.1 punto 3 / §4.3) sea comprobable: los permisos
  // `auditoria:leer_forense` y `auditoria:verificar_cadena` deben existir
  // como filas reales de `Permiso`, distintas entre sí (nunca un único
  // permiso genérico de auditoría). El CRUD completo de Roles/Permisos
  // queda para una tarea separada — esto es solo la referencia mínima.
  // ──────────────────────────────────────────────────────────────────────
  const permisoLeerForense = await prisma.permiso.upsert({
    where: { id: PERMISO_LEER_FORENSE_ID },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: {
      id: PERMISO_LEER_FORENSE_ID,
      codigo: "auditoria:leer_forense",
      descripcion: "Lectura ampliada del historial de AuditLog de cualquier usuario",
      modulo: "MODULO_D",
    },
  });

  const permisoVerificarCadena = await prisma.permiso.upsert({
    where: { id: PERMISO_VERIFICAR_CADENA_ID },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: {
      id: PERMISO_VERIFICAR_CADENA_ID,
      codigo: "auditoria:verificar_cadena",
      descripcion: "Ejecutar la verificación de integridad de la cadena de hashes de AuditLog",
      modulo: "MODULO_D",
    },
  });

  const rolAuditor = await prisma.rol.upsert({
    where: { id: ROL_AUDITOR_ID },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: {
      id: ROL_AUDITOR_ID,
      nombre: "AUDITOR",
      descripcion: "Solo lectura ampliada de auditoría forense — no gestiona usuarios ni roles",
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

  // ──────────────────────────────────────────────────────────────────────
  // Datos de referencia RBAC — Endpoints 2.2.5/2.2.6 (Gestión de Roles y
  // Permisos). `roles:administrar` es el permiso que habilita crear roles
  // y reasignar sus permisos (POST/PATCH /api/auth/roles/**) — sin al
  // menos un Rol que lo tenga, nadie podría administrar RBAC ni siquiera
  // para el primer alta. No se asigna a ningún usuario de seed por
  // defecto (mismo patrón que AUDITOR arriba) — el único usuario sembrado
  // hoy es "seed.deposito" (Encargado de Depósito), y no correspondería
  // semánticamente convertirlo también en administrador de RBAC.
  // ──────────────────────────────────────────────────────────────────────
  const permisoRolesAdministrar = await prisma.permiso.upsert({
    where: { id: PERMISO_ROLES_ADMINISTRAR_ID },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: {
      id: PERMISO_ROLES_ADMINISTRAR_ID,
      codigo: "roles:administrar",
      descripcion: "Crear roles y administrar los permisos asignados a un rol existente",
      modulo: "MODULO_D",
    },
  });

  const rolAdministrador = await prisma.rol.upsert({
    where: { id: ROL_ADMINISTRADOR_ID },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: {
      id: ROL_ADMINISTRADOR_ID,
      nombre: "ADMINISTRADOR",
      descripcion: "Gestión de usuarios y RBAC — no incluye auditoría forense por defecto",
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

  // ──────────────────────────────────────────────────────────────────────
  // Rol mínimo para Encargado de Depósito (Módulo A).
  //
  // Ningún Route Handler/Server Action de Módulo A verifica hoy un permiso
  // "inventario:*" — `producto.service.ts`, `variante.service.ts`,
  // `deposito.service.ts` y `movimiento.service.ts` están vacíos (no
  // implementados) al momento de escribir este seed; solo
  // `legajo-prueba.service.ts` (HU-A3) y `stock.service.ts` (HU-7) existen,
  // y ninguno de los dos llama a `withPermission()` todavía.
  // `inventario:operar` es un PLACEHOLDER: existe únicamente para que este
  // rol no quede sin permisos (principio de menor privilegio,
  // spec_modulo_D.md §3.4) y para que "encargado.seed" tenga un rol
  // asignado. Cuando se implemente el RBAC real de Módulo A, reemplazar
  // este código por los permisos granulares reales (ej.
  // "inventario:crear", "inventario:mover") según la convención
  // `withPermission("inventario:<accion>")` de spec_modulo_A.md §2.
  // ──────────────────────────────────────────────────────────────────────
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
      descripcion: "Operación de depósito (Módulo A) — permiso placeholder hasta que exista RBAC granular",
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

  // ──────────────────────────────────────────────────────────────────────
  // Usuarios de ejemplo — uno por rol, todos con la misma password fija
  // documentada al inicio de este archivo. Upsert por `nombre_usuario`
  // (campo único de negocio), no por `id` fijo: a diferencia de las
  // entidades de referencia de arriba, no hay ningún otro archivo que
  // necesite referenciar el `id` exacto de estos usuarios.
  // ──────────────────────────────────────────────────────────────────────
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
    where: { usuario_id_rol_id: { usuario_id: usuarioAdmin.id, rol_id: rolAdministrador.id } },
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
    where: { usuario_id_rol_id: { usuario_id: usuarioAuditor.id, rol_id: rolAuditor.id } },
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
    where: { usuario_id_rol_id: { usuario_id: usuarioEncargado.id, rol_id: rolEncargadoDeposito.id } },
    update: {},
    create: {
      id: USUARIO_ROL_ENCARGADO_ID,
      usuario_id: usuarioEncargado.id,
      rol_id: rolEncargadoDeposito.id,
    },
  });

  // ──────────────────────────────────────────────────────────────────────
  // Módulo A — Catálogo adicional (complementa la Camisa de Policía de
  // HU-7, no la reemplaza). 2 ProductoMaestro nuevos, 2-3 VarianteSKU cada
  // uno, con `sku` calculado por `calcularSkuDeterministico()` (ver nota
  // arriba sobre por qué no se importa desde producto.service.ts).
  // ──────────────────────────────────────────────────────────────────────
  const productoCamisaTactica = await prisma.productoMaestro.upsert({
    where: { id: PRODUCTO_CAMISA_TACTICA_ID },
    update: {},
    create: {
      id: PRODUCTO_CAMISA_TACTICA_ID,
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
      nombre: "Borcegos",
      rubro: "Calzado",
      categoria: "Botas",
      unidad_medida: "PAR",
      descripcion: "Borcegos de combate — datos de prueba",
      costo_estandar_referencia: 42000.0,
      is_active: true,
    },
  });

  const variantesCamisaTactica = [
    {
      id: VARIANTE_CAMISA_TACTICA_1_ID,
      talle: "M",
      color: "Verde",
      genero: "Masculino",
      modelo: "Manga Larga",
      ean_qr: "7791234500024",
    },
    {
      id: VARIANTE_CAMISA_TACTICA_2_ID,
      talle: "L",
      color: "Negro",
      genero: "Masculino",
      modelo: "Manga Corta",
      ean_qr: "7791234500031",
    },
    {
      id: VARIANTE_CAMISA_TACTICA_3_ID,
      talle: "S",
      color: "Verde",
      genero: "Femenino",
      modelo: "Manga Larga",
      ean_qr: "7791234500048",
    },
  ];

  const variantesBorcegos = [
    {
      id: VARIANTE_BORCEGOS_1_ID,
      talle: "42",
      color: "Negro",
      genero: "Masculino",
      modelo: "Combate",
      ean_qr: "7791234500055",
    },
    {
      id: VARIANTE_BORCEGOS_2_ID,
      talle: "38",
      color: "Negro",
      genero: "Femenino",
      modelo: "Combate",
      ean_qr: "7791234500062",
    },
  ];

  const varianteSkuById = new Map<string, { id: string; sku: string }>();

  for (const v of variantesCamisaTactica) {
    const sku = calcularSkuDeterministico({
      nombreProducto: productoCamisaTactica.nombre,
      modelo: v.modelo,
      talle: v.talle,
      color: v.color,
      genero: v.genero,
    });
    const creada = await prisma.varianteSKU.upsert({
      where: { sku },
      update: {},
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
    const sku = calcularSkuDeterministico({
      nombreProducto: productoBorcegos.nombre,
      modelo: v.modelo,
      talle: v.talle,
      color: v.color,
      genero: v.genero,
    });
    const creada = await prisma.varianteSKU.upsert({
      where: { sku },
      update: {},
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

  // ──────────────────────────────────────────────────────────────────────
  // Módulo A — Depósitos adicionales (complementan el Depósito Central).
  // ──────────────────────────────────────────────────────────────────────
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

  // ──────────────────────────────────────────────────────────────────────
  // Módulo A — StockDeposito inicial. La mayoría queda con
  // punto_pedido=0/stock_seguridad=0 ("sin configurar", comportamiento por
  // defecto del schema); la combinación Camisa Táctica M-Verde-Masculino
  // en Depósito Central se deja con umbrales reales para poder probar
  // HU-7 sin configurarlos a mano primero (complementa la combinación ya
  // sembrada de la Camisa de Policía, que también los tiene).
  // ──────────────────────────────────────────────────────────────────────
  await prisma.stockDeposito.upsert({
    where: {
      variante_sku_id_deposito_id: {
        variante_sku_id: VARIANTE_CAMISA_TACTICA_1_ID,
        deposito_id: deposito.id,
      },
    },
    update: {},
    create: {
      id: STOCK_CT1_CENTRAL_ID,
      variante_sku_id: VARIANTE_CAMISA_TACTICA_1_ID,
      deposito_id: deposito.id,
      cantidad: 25,
      punto_pedido: 8,
      stock_seguridad: 3,
      is_active: true,
    },
  });

  await prisma.stockDeposito.upsert({
    where: {
      variante_sku_id_deposito_id: {
        variante_sku_id: VARIANTE_CAMISA_TACTICA_2_ID,
        deposito_id: deposito.id,
      },
    },
    update: {},
    create: {
      id: STOCK_CT2_CENTRAL_ID,
      variante_sku_id: VARIANTE_CAMISA_TACTICA_2_ID,
      deposito_id: deposito.id,
      cantidad: 18,
      punto_pedido: 0,
      stock_seguridad: 0,
      is_active: true,
    },
  });

  await prisma.stockDeposito.upsert({
    where: {
      variante_sku_id_deposito_id: {
        variante_sku_id: VARIANTE_CAMISA_TACTICA_3_ID,
        deposito_id: deposito.id,
      },
    },
    update: {},
    create: {
      id: STOCK_CT3_CENTRAL_ID,
      variante_sku_id: VARIANTE_CAMISA_TACTICA_3_ID,
      deposito_id: deposito.id,
      cantidad: 12,
      punto_pedido: 0,
      stock_seguridad: 0,
      is_active: true,
    },
  });

  await prisma.stockDeposito.upsert({
    where: {
      variante_sku_id_deposito_id: {
        variante_sku_id: VARIANTE_BORCEGOS_1_ID,
        deposito_id: deposito.id,
      },
    },
    update: {},
    create: {
      id: STOCK_B1_CENTRAL_ID,
      variante_sku_id: VARIANTE_BORCEGOS_1_ID,
      deposito_id: deposito.id,
      cantidad: 30,
      punto_pedido: 0,
      stock_seguridad: 0,
      is_active: true,
    },
  });

  await prisma.stockDeposito.upsert({
    where: {
      variante_sku_id_deposito_id: {
        variante_sku_id: VARIANTE_BORCEGOS_2_ID,
        deposito_id: deposito.id,
      },
    },
    update: {},
    create: {
      id: STOCK_B2_CENTRAL_ID,
      variante_sku_id: VARIANTE_BORCEGOS_2_ID,
      deposito_id: deposito.id,
      cantidad: 14,
      punto_pedido: 0,
      stock_seguridad: 0,
      is_active: true,
    },
  });

  await prisma.stockDeposito.upsert({
    where: {
      variante_sku_id_deposito_id: {
        variante_sku_id: VARIANTE_CAMISA_TACTICA_1_ID,
        deposito_id: depositoShowroom.id,
      },
    },
    update: {},
    create: {
      id: STOCK_CT1_SHOWROOM_ID,
      variante_sku_id: VARIANTE_CAMISA_TACTICA_1_ID,
      deposito_id: depositoShowroom.id,
      cantidad: 4,
      punto_pedido: 0,
      stock_seguridad: 0,
      is_active: true,
    },
  });

  await prisma.stockDeposito.upsert({
    where: {
      variante_sku_id_deposito_id: {
        variante_sku_id: VARIANTE_BORCEGOS_1_ID,
        deposito_id: depositoShowroom.id,
      },
    },
    update: {},
    create: {
      id: STOCK_B1_SHOWROOM_ID,
      variante_sku_id: VARIANTE_BORCEGOS_1_ID,
      deposito_id: depositoShowroom.id,
      cantidad: 3,
      punto_pedido: 0,
      stock_seguridad: 0,
      is_active: true,
    },
  });

  await prisma.stockDeposito.upsert({
    where: {
      variante_sku_id_deposito_id: {
        variante_sku_id: VARIANTE_CAMISA_TACTICA_2_ID,
        deposito_id: depositoMovil.id,
      },
    },
    update: {},
    create: {
      id: STOCK_CT2_MOVIL_ID,
      variante_sku_id: VARIANTE_CAMISA_TACTICA_2_ID,
      deposito_id: depositoMovil.id,
      cantidad: 6,
      punto_pedido: 0,
      stock_seguridad: 0,
      is_active: true,
    },
  });

  console.log("Seed HU-7 completado:");
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

  console.log("Seed RBAC — D.3 (Consola de Auditoría Forense) completado:");
  console.table({
    permiso_leer_forense_id: permisoLeerForense.id,
    permiso_verificar_cadena_id: permisoVerificarCadena.id,
    rol_auditor_id: rolAuditor.id,
  });

  console.log("Seed RBAC — Roles y Permisos (roles:administrar) completado:");
  console.table({
    permiso_roles_administrar_id: permisoRolesAdministrar.id,
    rol_administrador_id: rolAdministrador.id,
  });

  console.log("Seed RBAC — Encargado de Depósito (placeholder Módulo A) completado:");
  console.table({
    permiso_inventario_operar_id: permisoInventarioOperar.id,
    rol_encargado_deposito_id: rolEncargadoDeposito.id,
  });

  console.log(`Seed usuarios de ejemplo completado (password: "${PASSWORD_SEED}"):`);
  console.table({
    administrador_seed: `${usuarioAdmin.nombre_usuario} <${usuarioAdmin.email}>`,
    auditor_seed: `${usuarioAuditor.nombre_usuario} <${usuarioAuditor.email}>`,
    encargado_seed: `${usuarioEncargado.nombre_usuario} <${usuarioEncargado.email}>`,
  });

  console.log("Seed Módulo A — catálogo adicional completado:");
  console.table({
    producto_camisa_tactica_id: productoCamisaTactica.id,
    producto_borcegos_id: productoBorcegos.id,
    deposito_showroom_id: depositoShowroom.id,
    deposito_movil_id: depositoMovil.id,
    ...Object.fromEntries(
      [...varianteSkuById.entries()].map(([id, v]) => [`variante_${id.slice(0, 8)}`, v.sku]),
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
