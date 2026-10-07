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

import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "@/lib/auth/password-hash-core";
import { generarSku, type Genero } from "@/lib/utils/sku";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * Sprint 3 (cierre HU-H2/H6, fixture de variación crítica) — a diferencia del
 * resto de este archivo, este único bloque SÍ importa un service real
 * (`publicarNuevaVersionListaPrecio`), para no reimplementar el cálculo de
 * variación/umbral ni el encadenamiento SHA-256 del ledger fuera de su única
 * fuente de verdad (`lista-precios.service.ts` → evento
 * `proveedor:variacion_precio_critica` → `audit-log.listener.ts` →
 * `registrarAuditLog()`). Ese service (y su cadena de imports) usa
 * `import "server-only"`, que revienta bajo `tsx` a secas — por eso
 * `package.json`/`prisma.config.ts` corren `prisma db seed` con
 * `node --conditions=react-server --import tsx`, la MISMA condición de
 * exports que ya usan los scripts `test:integration:*` de este proyecto para
 * poder importar código con `server-only` fuera del bundler de Next
 * (`server-only` resuelve a un `empty.js` no-op bajo la condición
 * `react-server`, ver `node_modules/server-only/package.json`).
 */
import { publicarNuevaVersionListaPrecio } from "@/lib/services/proveedores/lista-precios.service";
import { obtenerCostoReposicionVigente } from "@/lib/services/proveedores/costo-reposicion.service";
import { encrypt } from "@/lib/crypto/aes";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import { verificarCadenaIntegridad } from "@/lib/services/auditoria/audit-log.service";

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

// --- Origen: HU-A9 — fixture de unidad DEVUELTO (reclasificación) ---
const MOVIMIENTO_DEVUELTO_SEED_ID = "1a2b3c4d-bbbb-4a1a-8a1a-000000000001";
const MOVIMIENTO_DEVUELTO_ITEM_SEED_ID = "1a2b3c4d-bbbb-4a1a-8a1a-000000000002";

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
const PERMISO_RECLASIFICAR_ID = "d3f9e6b0-5a2e-4e3d-9c8b-2a4f6e8d0c31";
const PERMISO_RECLASIFICAR_APROBAR_ID = "e4a0f7c1-6b3f-4f4e-ad9c-3b5f7f9e1d42";
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
const PERMISO_RECEPCIONES_REGISTRAR_ID = "1a2b3c4d-1111-4a1a-8a1a-000000000003";
const PERMISO_TESORERIA_OPERAR_ID = "1a2b3c4d-1111-4a1a-8a1a-000000000004";
const ROL_COMPRADOR_ID = "1a2b3c4d-2222-4a1a-8a1a-000000000001";
const ROL_TESORERO_ID = "1a2b3c4d-2222-4a1a-8a1a-000000000002";
const ROL_PERMISO_PROVEEDORES_ADMINISTRAR_ID = "1a2b3c4d-3333-4a1a-8a1a-000000000001";
const ROL_PERMISO_COMPRAS_OPERAR_ID = "1a2b3c4d-3333-4a1a-8a1a-000000000002";
// ROL_PERMISO_RECEPCION_CONFIRMAR_ID retirado en HU-H4: el permiso pasó a
// llamarse `recepciones:registrar` y su vínculo con los roles se upsertea por
// clave compuesta (rol_id + permiso_id), sin constante de id fija.
// ROL_PERMISO_TESORERIA_OPERAR_ID retirado en HU-G8: el vínculo
// tesoreria:operar ↔ TESORERO_CENTRAL se elimina vía deleteMany (ver más abajo).
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
// Permiso de lectura separado (Alcance Funcional §5, fila "Consultar el
// historial de precios y órdenes de un proveedor"). Antes las pantallas de
// listado/detalle usaban `ordenes_compra:crear` como gate de lectura, lo que
// dejaba fuera a roles de solo lectura (Auditor). Mismo patrón que
// `proveedores:leer` (HU-H1). Siguiente UUID libre del namespace: 020.
const PERMISO_OC_LEER_ID = "1a2b3c4d-1111-4a1a-8a1a-000000000020";

// HU-H1 — permisos granulares de Proveedor (spec_modulo_H.md §2.1/§2.2: un
// permiso independiente por acción, NO un único `proveedores:administrar`).
// Reemplazan al placeholder `PERMISO_PROVEEDORES_ADMINISTRAR_ID`.
const PERMISO_PROVEEDORES_CREAR_ID = "1a2b3c4d-1111-4a1a-8a1a-000000000010";
const PERMISO_PROVEEDORES_EDITAR_ID = "1a2b3c4d-1111-4a1a-8a1a-000000000011";
const PERMISO_PROVEEDORES_LEER_ID = "1a2b3c4d-1111-4a1a-8a1a-000000000012";
const PERMISO_PROVEEDORES_HOMOLOGAR_ID = "1a2b3c4d-1111-4a1a-8a1a-000000000013";
const PERMISO_PROVEEDORES_BAJA_ID = "1a2b3c4d-1111-4a1a-8a1a-000000000014";

// HU-G8 — permisos granulares de Cuenta por Pagar (spec_modulo_G.md §7).
// Reemplazan al placeholder `tesoreria:operar`. Mismo patrón que HU-H3:
// un permiso por acción, constante UUID fija, upsert idempotente.
// IDs a partir de ...015: los slots ...010–...014 los tomó HU-H1 (bloque
// anterior) al mergear develop; sus filas ya están publicadas y sembradas.
const PERMISO_CXP_LEER_ID = "1a2b3c4d-1111-4a1a-8a1a-000000000015";
const PERMISO_CXP_PAGAR_ID = "1a2b3c4d-1111-4a1a-8a1a-000000000016";

// HU-H9 — permisos granulares de ComprobanteProveedor (spec_modulo_H.md §2.7:
// un permiso por acción). `comprobantes_proveedor:anular` es EXCLUSIVO de
// Supervisor de Compras (una baja lógica sobre un comprobante ya presentado
// es una corrección sensible). Mismo patrón que HU-H1/H3/G8.
const PERMISO_COMPROBANTES_CREAR_ID = "1a2b3c4d-1111-4a1a-8a1a-000000000017";
const PERMISO_COMPROBANTES_LEER_ID = "1a2b3c4d-1111-4a1a-8a1a-000000000018";
const PERMISO_COMPROBANTES_ANULAR_ID = "1a2b3c4d-1111-4a1a-8a1a-000000000019";

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
const LISTA_PRECIO_ITEM_CAMISA_3_ID = "1a2b3c4d-dddd-4a1a-8a1a-000000000004";
const LISTA_PRECIO_ITEM_BORCEGOS_2_ID = "1a2b3c4d-dddd-4a1a-8a1a-000000000005";
const ORDEN_COMPRA_CONFIRMADA_ID = "1a2b3c4d-7777-4a1a-8a1a-000000000001";
const ORDEN_COMPRA_ITEM_1_ID = "1a2b3c4d-7778-4a1a-8a1a-000000000001";
const ORDEN_COMPRA_ITEM_2_ID = "1a2b3c4d-7778-4a1a-8a1a-000000000002";
const RECEPCION_SEED_ID = "1a2b3c4d-8888-4a1a-8a1a-000000000001";
const RECEPCION_ITEM_1_ID = "1a2b3c4d-8889-4a1a-8a1a-000000000001";
const RECEPCION_DISCREPANCIA_1_ID = "1a2b3c4d-8890-4a1a-8a1a-000000000001";
const CUENTA_POR_PAGAR_PROVISORIA_ID = "1a2b3c4d-9999-4a1a-8a1a-000000000001";
const EVALUACION_PROVEEDOR_SEED_ID = "1a2b3c4d-aaaa-4a1a-8a1a-000000000001";
// HU-H9 — fixture: OC ya RECIBIDA_COMPLETA para poder ejercitar la carga de
// comprobantes de proveedor (spec_modulo_H.md §2.7) sin depender de conducir
// una OC por toda la máquina de estados de H3/H4.
const ORDEN_COMPRA_RECIBIDA_ID = "1a2b3c4d-7777-4a1a-8a1a-000000000002";
const ORDEN_COMPRA_RECIBIDA_ITEM_ID = "1a2b3c4d-7778-4a1a-8a1a-000000000003";
// HU-H4 V2 — OC independiente, sin recepciones, para probar manualmente el
// único control físico operativo sin reutilizar los fixtures de H5/G8/H9.
const ORDEN_COMPRA_H4_V2_MANUAL_ID = "1b3c4d5e-7777-4a1a-8a1a-000000000003";
const ORDEN_COMPRA_H4_V2_MANUAL_ITEM_ID = "192b3c4d-7778-4a1a-8a1a-000000000004";

// --- Origen: Sprint 3 — Módulo H (cierre de Listas de Precios, HU-H2) ---
// Segunda ListaPrecioVersion sobre `proveedorHomologado`: representa la
// publicación de una nueva lista (HU-H2) posterior a la vigente sembrada en
// Sprint 2 (`LISTA_PRECIO_VERSION_ID`), dentro del umbral normal
// (`publicada = true` sin paso de aprobación). No reemplaza ni reordena el
// fixture de Sprint 2 — es la versión más nueva de la misma `ListaPrecio`.
const LISTA_PRECIO_VERSION_2_ID = "1a2b3c4d-5678-4a1a-8a1a-000000000001";
const LISTA_PRECIO_ITEM_V2_CAMISA_1_ID = "1a2b3c4d-9abc-4a1a-8a1a-000000000001";
const LISTA_PRECIO_ITEM_V2_CAMISA_2_ID = "1a2b3c4d-9abc-4a1a-8a1a-000000000002";
const LISTA_PRECIO_ITEM_V2_BORCEGOS_1_ID = "1a2b3c4d-9abc-4a1a-8a1a-000000000003";

// --- Origen: Sprint 3 — UI de Listas de Precios (HU-H2/H6/H7) ---
// Segundo proveedor HOMOLOGADO, exclusivamente para poder ejercitar HU-H7
// (comparativa de precios entre proveedores) contra una variante real que
// YA tiene precio vigente en `proveedorHomologado` (namespace `6666`,
// siguiente slot libre: `...002` lo ocupa `proveedorPendiente`).
const PROVEEDOR_SEGUNDO_HOMOLOGADO_ID = "1a2b3c4d-6666-4a1a-8a1a-000000000003";
// Namespace nuevo `b2b2` (no colisiona con ningún otro usado en este archivo
// — verificado por grep antes de elegirlo) para la ListaPrecio/Version/Items
// del segundo proveedor.
const LISTA_PRECIO_SEGUNDO_HOMOLOGADO_ID = "1a2b3c4d-b2b2-4a1a-8a1a-000000000001";
const LISTA_PRECIO_VERSION_SEGUNDO_ID = "1a2b3c4d-b2b2-4a1a-8a1a-000000000002";
const LISTA_PRECIO_ITEM_SEGUNDO_CAMISA_1_ID = "1a2b3c4d-b2b2-4a1a-8a1a-000000000003";
const LISTA_PRECIO_ITEM_SEGUNDO_BORCEGOS_1_ID = "1a2b3c4d-b2b2-4a1a-8a1a-000000000004";
// La tercera ListaPrecioVersion de `proveedorHomologado` (>20% de variación,
// pendiente de aprobación) NO tiene una constante de id fija: se publica vía
// el service real `publicarNuevaVersionListaPrecio()`, que genera su propio
// `id` (Prisma `@default(uuid())`) — ver el bloque de seed correspondiente,
// más abajo, que la identifica por `fecha_inicio_vigencia` fija en su lugar.

// --- Origen: Sprint 3 — Módulo C (Clientes) ---
// RBAC: permisos granulares de Cliente (spec_modulo_C.md §5 del Alcance) +
// `auditoria:leer_historico` (HU-C10 §2.9) + los dos permisos de publicación
// de listas de precios de HU-H2 (§2.3) que todavía no existían. Siguiente
// UUID libre del namespace `1111` (permisos): a partir de ...021, ya que
// ...001–...020 los ocupan los bloques de Sprint 2 de más arriba.
const PERMISO_CLIENTES_CREAR_ID = "1a2b3c4d-1111-4a1a-8a1a-000000000021";
const PERMISO_CLIENTES_EDITAR_ID = "1a2b3c4d-1111-4a1a-8a1a-000000000022";
const PERMISO_CLIENTES_GESTIONAR_CONSENTIMIENTO_ID =
  "1a2b3c4d-1111-4a1a-8a1a-000000000023";
const PERMISO_CLIENTES_BAJA_ID = "1a2b3c4d-1111-4a1a-8a1a-000000000025";
const PERMISO_CLIENTES_LEER_ID = "1a2b3c4d-1111-4a1a-8a1a-000000000026";
const PERMISO_CLIENTES_GESTIONAR_SEGMENTO_ID =
  "1a2b3c4d-1111-4a1a-8a1a-000000000027";
// Sembrado literal según spec_modulo_C.md §2.9 / spec_modulo_H.md §2.9 — a
// diferencia de lo que ambos documentos afirman, NO es el mismo código que
// ya usa la Consola de Auditoría Forense real (`auditoria:leer_forense`,
// sembrado más arriba como `PERMISO_LEER_FORENSE_ID`). Es una divergencia de
// nomenclatura conocida y aceptada por el equipo (ver reporte de
// relevamiento de esta tarea) — este permiso queda sembrado sin asignar a
// ningún Rol todavía, mismo patrón que otros permisos "stub" del proyecto.
const PERMISO_AUDITORIA_LEER_HISTORICO_ID =
  "1a2b3c4d-1111-4a1a-8a1a-000000000028";
// HU-C10: alcance exclusivo de asientos CREATE/UPDATE/DELETE_LOGICO sobre clientes.
// No reutiliza auditoria:leer_historico porque ese permiso también abre Proveedores.
const PERMISO_CLIENTES_LEER_AUDITORIA_ID =
  "1a2b3c4d-1111-4a1a-8a1a-000000000043";
// HU-E8: siguiente UUID libre del namespace `1111`; máximo remoto verificado: ...043.
const PERMISO_VALIDAR_IDENTIDAD_CLIENTE_WEB_ID =
  "1a2b3c4d-1111-4a1a-8a1a-000000000044";
const PERMISO_PROVEEDORES_PUBLICAR_LISTA_ID =
  "1a2b3c4d-1111-4a1a-8a1a-000000000029";
const PERMISO_PROVEEDORES_PUBLICAR_LISTA_CRITICA_ID =
  "1a2b3c4d-1111-4a1a-8a1a-000000000030";

// HU-H7 (spec_modulo_H.md §2.10): comparativa de precios entre proveedores.
// Un solo permiso, sin variante crítica ni umbral — siguiente UUID libre del
// namespace `1111` (permisos): el más alto ocupado hasta ahora es ...040
// (HU-B7, Módulo B), así que este toma ...041.
const PERMISO_PROVEEDORES_COMPARAR_PRECIOS_ID =
  "1a2b3c4d-1111-4a1a-8a1a-000000000041";

// HU-H8 (spec_modulo_H.md §2.11 / propose_HU-H8_FINAL.md §2.2 y T1): costo de
// reposición vigente. Permiso servicio-a-servicio, sin variante crítica ni
// umbral — siguiente UUID libre del namespace `1111` (permisos): el más
// alto ocupado hasta ahora es ...041 (HU-H7), así que este toma ...042.
const PERMISO_PROVEEDORES_LEER_COSTO_REPOSICION_ID =
  "1a2b3c4d-1111-4a1a-8a1a-000000000042";

// HU-C1 — Roles VENDEDOR y ADMINISTRADOR_CRM (spec_modulo_C.md, Alcance §5).
// No existían en el seed hasta esta tarea; siguiente UUID libre del
// namespace `2222` (roles), a partir de ...004 (...001–...003 los ocupan
// Comprador/Tesorero/Supervisor de Compras, más arriba).
const ROL_VENDEDOR_ID = "1a2b3c4d-2222-4a1a-8a1a-000000000004";
const ROL_ADMINISTRADOR_CRM_ID = "1a2b3c4d-2222-4a1a-8a1a-000000000005";

// Clientes de prueba (HU-C1/C3/C4/C5/C8/C9).
const CLIENTE_JUAN_PEREZ_ID = "1a2b3c4d-eeee-4a1a-8a1a-000000000001";
// Posible duplicado de CLIENTE_JUAN_PEREZ_ID para HU-C5: mismo nombre/teléfono
// aproximado, DNI DISTINTO (no confundir con el caso de DNI idéntico, que
// HU-C1 resuelve sola). Mismos valores de ejemplo que usa spec_modulo_C.md
// §2.1 en su respuesta de muestra de "posibles_duplicados".
const CLIENTE_JUAN_PEREZ_DUPLICADO_ID = "1a2b3c4d-eeee-4a1a-8a1a-000000000002";
// Par primario/secundario para ejercitar `Cliente.fusionado_en_id` (HU-C5).
const CLIENTE_MARIA_GOMEZ_PRIMARIO_ID = "1a2b3c4d-eeee-4a1a-8a1a-000000000003";
const CLIENTE_MARIA_GOMEZ_FUSIONADO_ID = "1a2b3c4d-eeee-4a1a-8a1a-000000000004";

const DIRECCION_JUAN_PEREZ_FACTURACION_ID =
  "1a2b3c4d-ffff-4a1a-8a1a-000000000001";
const DIRECCION_JUAN_PEREZ_ENVIO_ID = "1a2b3c4d-ffff-4a1a-8a1a-000000000002";

const CONSENTIMIENTO_JUAN_PEREZ_ID = "1a2b3c4d-1234-4a1a-8a1a-000000000001";
const CONSENTIMIENTO_JUAN_PEREZ_DUPLICADO_ID =
  "1a2b3c4d-1234-4a1a-8a1a-000000000002";
const CONSENTIMIENTO_MARIA_GOMEZ_PRIMARIO_ID =
  "1a2b3c4d-1234-4a1a-8a1a-000000000003";
const CONSENTIMIENTO_MARIA_GOMEZ_FUSIONADO_ID =
  "1a2b3c4d-1234-4a1a-8a1a-000000000004";

// HU-C3 (ronda de cobertura HTTP) — usuario de prueba con rol VENDEDOR.
// VENDEDOR se creó en HU-C1 pero quedó SIN ningún usuario asignado: como es
// el único rol no-auditor con `clientes:editar`, sin este usuario ni el
// camino feliz HTTP de `/api/clientes/[id]/direcciones` ni la ficha
// `/clientes/[id]` en `npm run dev` eran ejercitables por nadie del equipo.
// UUID ...006 de los namespaces `4444` (usuarios) / `5555` (UsuarioRol):
// ...001-...005 ya están ocupados (Comprador/Tesorero/Supervisor de Compras
// y Cajero/Supervisor de Ventas). Verificado sin colisiones en todo el repo.
const USUARIO_VENDEDOR_SEED_ID = "1a2b3c4d-4444-4a1a-8a1a-000000000006";
const USUARIO_ROL_VENDEDOR_ID = "1a2b3c4d-5555-4a1a-8a1a-000000000006";

// --- Origen: Sprint 3 — Módulo B (Ventas y Punto de Venta) ---
// RBAC: permisos granulares de Ventas (spec_modulo_B.md §2, uno por acción,
// mismo criterio que HU-H1/H3/G8/C1-C8: NO un único `ventas:administrar`).
// Reutiliza el permiso `auditoria:leer_historico` ya sembrado para Módulo C
// (`PERMISO_AUDITORIA_LEER_HISTORICO_ID`, HU-C10) para el scope "ventas" de
// HU-B6 §2.6 — confirmado en el Paso 0: `Permiso.codigo` es `@unique`, así
// que no se siembra una fila nueva con el mismo código; el filtro de
// dominio ("ventas" vs "clientes" vs "proveedores") se resuelve en la capa
// de servicios vía el query param `dominio`, no como una fila de Permiso
// separada por módulo. Ningún rol Cajero POS/Supervisor de
// Ventas/Vendedor/Administrador de CRM existe todavía — estos permisos
// quedan sembrados sin asignar a ningún Rol, misma decisión ya tomada en la
// ronda anterior. Siguiente UUID libre del namespace `1111` (permisos): a
// partir de ...031.
const PERMISO_VENTAS_REGISTRAR_MOSTRADOR_ID =
  "1a2b3c4d-1111-4a1a-8a1a-000000000031";
const PERMISO_VENTAS_GESTIONAR_TURNO_CAJA_ID =
  "1a2b3c4d-1111-4a1a-8a1a-000000000032";
const PERMISO_VENTAS_EMITIR_COTIZACION_ID =
  "1a2b3c4d-1111-4a1a-8a1a-000000000033";
const PERMISO_VENTAS_APLICAR_DESCUENTO_MARGEN_ID =
  "1a2b3c4d-1111-4a1a-8a1a-000000000034";
const PERMISO_VENTAS_AUTORIZAR_EXCEPCION_DESCUENTO_ID =
  "1a2b3c4d-1111-4a1a-8a1a-000000000035";
const PERMISO_VENTAS_GESTIONAR_CUENTA_CORRIENTE_ID =
  "1a2b3c4d-1111-4a1a-8a1a-000000000036";
const PERMISO_VENTAS_AUTORIZAR_EXCEPCION_CREDITO_ID =
  "1a2b3c4d-1111-4a1a-8a1a-000000000037";
const PERMISO_VENTAS_LEER_ID = "1a2b3c4d-1111-4a1a-8a1a-000000000038";
// Hallazgo 2 (auditoría de trazabilidad HU↔schema↔seed, corrección posterior
// a la ronda anterior): HU-B6 §2.6 y HU-B7 §2.8 nombran explícitamente estos
// dos permisos, ausentes de la ronda inicial. Mismo criterio: sin Rol.
const PERMISO_VENTAS_ANULAR_PEDIDO_ID = "1a2b3c4d-1111-4a1a-8a1a-000000000039";
const PERMISO_VENTAS_LEER_LOG_OPERATIVO_ID =
  "1a2b3c4d-1111-4a1a-8a1a-000000000040";
// HU-B9 (Sprint 4) — UUID aleatorio verificado contra seed.ts, sin continuar
// el namespace numerado `1111` (ver nota de colisión de HU-B8).
const PERMISO_VENTAS_GESTIONAR_LISTA_PRECIOS_ID =
  "377cbaff-d5e6-4ea7-8d25-c63a42cdcec0";

// HU-B8 — roles operativos de Ventas (agrupan los permisos `ventas:*` de
// arriba, ningún permiso nuevo). Mapeo confirmado en el relevamiento de
// HU-B8: CAJERO_POS agrupa registrar_venta_mostrador, gestionar_turno_caja,
// emitir_cotizacion, aplicar_descuento_margen, gestionar_cuenta_corriente,
// leer. SUPERVISOR_VENTAS agrupa todo lo anterior (decisión explícita del
// equipo — nota: spec_modulo_B.md §2.1/§2.3 documenta
// registrar_venta_mostrador/emitir_cotizacion como "exclusivo Cajero POS,
// Supervisor no tiene ✓ directo"; el equipo confirmó igual otorgárselos acá
// para que el Supervisor pueda operar como Cajero de respaldo — no es un
// olvido) más autorizar_excepcion_descuento, autorizar_excepcion_credito,
// anular_pedido y leer_log_operativo.
//
// CORRECCIÓN (post-HU-B4, diagnóstico de bug de producción): estos dos IDs
// originalmente reusaban por error "1a2b3c4d-2222-4a1a-8a1a-000000000004"/
// "...005", asumidos como "siguiente UUID libre del namespace `2222`" sin
// verificar que HU-C1 (Módulo C, ROL_VENDEDOR_ID/ROL_ADMINISTRADOR_CRM_ID,
// más arriba en este archivo) ya los había tomado. Como el bloque de HU-C1
// corre antes en este script, el upsert de Rol de acá caía siempre en la
// rama `update` (que solo reactiva is_active/deleted_*, nunca toca
// `nombre`/`descripcion`) — el nombre real en base quedaba "VENDEDOR"/
// "ADMINISTRADOR_CRM" para siempre, nunca "CAJERO_POS"/"SUPERVISOR_VENTAS",
// pese a que el UsuarioRol de cajero.seed/supervisor.ventas.seed apuntaba
// exactamente al rol_id correcto. Reemplazados acá por dos UUID aleatorios
// (`crypto.randomUUID()`) verificados contra un grep completo de TODO
// seed.ts para no repetir el mismo tipo de colisión — no se reutiliza el
// esquema de namespace numerado a mano (`2222`, `bbbb`, etc.) precisamente
// porque fue ese esquema el que originó el bug.
const ROL_CAJERO_POS_ID = "f6b9ebf5-196e-4ef1-945e-aa8e226edc11";
const ROL_SUPERVISOR_VENTAS_ID = "6c74bfba-617e-4c6d-bb52-3a012eeade23";

// Usuarios de prueba para Módulo B — desde HU-B8 tienen Rol asignado
// (ver ROL_CAJERO_POS_ID / ROL_SUPERVISOR_VENTAS_ID y su asignación más
// abajo). Siguen sirviendo también como FK realista para
// `registrado_por_id` / `usuario_id` / `emitido_por_id` / `creado_por_id`
// de las entidades de Ventas (RULES.md Regla N.° 2 exige responsable
// trazable en toda mutación).
const USUARIO_CAJERO_SEED_ID = "1a2b3c4d-4444-4a1a-8a1a-000000000004";
const USUARIO_SUPERVISOR_VENTAS_SEED_ID =
  "1a2b3c4d-4444-4a1a-8a1a-000000000005";

// HU-B8 — asignación Usuario → Rol de los dos usuarios de prueba de arriba.
const USUARIO_ROL_CAJERO_ID = "1a2b3c4d-5555-4a1a-8a1a-000000000004";
const USUARIO_ROL_SUPERVISOR_VENTAS_ID =
  "1a2b3c4d-5555-4a1a-8a1a-000000000005";

// HU-B2 §2.2: turno de caja abierto (fecha_cierre = null) del Cajero de prueba.
const TURNO_CAJA_ABIERTO_ID = "1a2b3c4d-be01-4a1a-8a1a-000000000001";

// HU-B1 §2.1: venta de mostrador completa — asociada a
// `CLIENTE_JUAN_PEREZ_ID` (confirmado en el Paso 0) para que HU-C7
// (spec_modulo_C.md §2.7) tenga historial de compras real, no vacío, al
// consultarlo por DNI.
const PEDIDO_VENTA_MOSTRADOR_ID = "1a2b3c4d-be02-4a1a-8a1a-000000000001";
const PEDIDO_VENTA_MOSTRADOR_ITEM_ID = "1a2b3c4d-be03-4a1a-8a1a-000000000001";
const VENTA_MEDIO_PAGO_EFECTIVO_ID = "1a2b3c4d-be04-4a1a-8a1a-000000000001";
const VENTA_MEDIO_PAGO_TRANSFERENCIA_ID =
  "1a2b3c4d-be04-4a1a-8a1a-000000000002";
const COMPROBANTE_FISCAL_MOSTRADOR_ID =
  "1a2b3c4d-be05-4a1a-8a1a-000000000001";

// HU-B3 §2.3: Presupuesto (cotización institucional de gran volumen) + su
// Reserva de Módulo A (`origen_reserva: "LICITACION"`, spec_modulo_B.md
// nota inicial — enum `OrigenReserva` SIN renombrar) + conversión a
// PedidoVenta (estado RESERVADO, todavía sin facturar/cobrar) sobre
// `CLIENTE_MARIA_GOMEZ_PRIMARIO_ID`.
const PRESUPUESTO_LICITACION_ID = "1a2b3c4d-be06-4a1a-8a1a-000000000001";
const PRESUPUESTO_LICITACION_ITEM_ID = "1a2b3c4d-be07-4a1a-8a1a-000000000001";
const RESERVA_PRESUPUESTO_LICITACION_ID =
  "1a2b3c4d-be08-4a1a-8a1a-000000000001";
const PEDIDO_VENTA_LICITACION_ID = "1a2b3c4d-be02-4a1a-8a1a-000000000002";
const PEDIDO_VENTA_LICITACION_ITEM_ID =
  "1a2b3c4d-be03-4a1a-8a1a-000000000002";

// Hallazgo 1 (HU-B5 §2.5): cuenta corriente de `clienteJuanPerez`, con las
// dos operaciones de ejemplo de la spec (montos idénticos a la respuesta
// `200 OK` de muestra: límite 500000.00 / saldo 120000.00 → disponible
// 380000.00).
const CUENTA_CORRIENTE_JUAN_PEREZ_ID = "1a2b3c4d-be09-4a1a-8a1a-000000000001";
const CUENTA_CORRIENTE_OPERACION_APROBADA_ID =
  "1a2b3c4d-be10-4a1a-8a1a-000000000001";
const CUENTA_CORRIENTE_OPERACION_RETENIDA_ID =
  "1a2b3c4d-be10-4a1a-8a1a-000000000002";

// Hallazgos 3 y 4: segundo PedidoVenta de `clienteJuanPerez`, en
// REMITO_EMITIDO (HU-B3 §3.1, entrega parcial) con un segundo ítem en
// espera de autorización (HU-B4 §2.4). El monto de esta orden (413000.00)
// excede el disponible de la cuenta corriente (380000.00) — de ahí que la
// operación de cuenta corriente asociada quede RETENIDA.
const PEDIDO_VENTA_REMITO_PARCIAL_ID = "1a2b3c4d-be02-4a1a-8a1a-000000000003";
const PEDIDO_VENTA_REMITO_PARCIAL_ITEM_ENTREGA_ID =
  "1a2b3c4d-be03-4a1a-8a1a-000000000003";
const PEDIDO_VENTA_REMITO_PARCIAL_ITEM_AUTORIZACION_ID =
  "1a2b3c4d-be03-4a1a-8a1a-000000000004";

// ──────────────────────────────────────────────────────────────────────────────
// Sprint 4 — Módulo E (E-commerce) + HU-B9 (Lista de Precios de Venta)
// UUID aleatorios (`crypto.randomUUID()`) verificados contra un grep completo
// de seed.ts — mismo criterio que ROL_CAJERO_POS_ID, sin namespace numerado a
// mano (ver la nota de colisión de HU-B8 más arriba).
// ──────────────────────────────────────────────────────────────────────────────

// HU-E10 (spec_modulo_E.md §2.10) — permisos `ecommerce:*`.
const PERMISO_ECOMMERCE_GESTIONAR_CATALOGO_ID = "18494e73-f0b7-4bec-84fb-7b65984c959b";
const PERMISO_ECOMMERCE_GESTIONAR_CUPONES_ID = "5c5140b1-8ad0-4e82-9ed2-c87352573aea";
const PERMISO_ECOMMERCE_ANULAR_ORDEN_NO_ABONADA_ID = "baa5e385-e1a2-49ca-a6fa-8b93d01d998e";
const PERMISO_ECOMMERCE_CANCELAR_PEDIDO_PAGADO_ID = "f8eb98d6-1c61-46b4-bfd1-06c4f7fc7255";
const PERMISO_ECOMMERCE_LEER_COLA_PREPARACION_ID = "248e72a2-0d6e-4a35-a977-edea583806d7";
const PERMISO_ECOMMERCE_PREPARAR_PEDIDO_ID = "79c4a42c-7382-48f2-97e8-1a7ce26ae2d5";
const PERMISO_ECOMMERCE_VALIDAR_RETIRO_QR_ID = "8549117c-fca7-47b9-8f73-d4f3f85e777c";
const PERMISO_ECOMMERCE_LEER_HISTORIAL_ORDENES_ID = "1a68c39a-f427-47c8-8923-56413c22a177";
const PERMISO_ECOMMERCE_EXPORTAR_METRICAS_ID = "c603f9c6-2bf4-4d95-b06c-e339f09ae303";
const PERMISO_ECOMMERCE_SOLICITAR_ACCESO_LOG_PAGOS_ID = "fe71b5b4-09ba-407a-bff0-1aa64656f656";
// Punto abierto 1 de HU-E10 (resuelto): priorizar la cola es un permiso propio,
// no "leer_cola_preparacion + rol Administrador" (CA5: nunca por nombre de rol).
const PERMISO_ECOMMERCE_PRIORIZAR_COLA_ID = "6481fbee-c5d3-4c40-ad62-261588c1d0cf";

// HU-E10 — roles y un usuario de prueba por rol (criterio "seed idempotente").
const ROL_ADMINISTRADOR_ECOMMERCE_ID = "5a4b283b-fdaf-4253-ab3e-be13c118d74d";
const ROL_OPERADOR_PICK_PACK_ID = "a0028adb-6bc1-48fe-b3e9-2a626d718d4e";
const USUARIO_ADMIN_ECOMMERCE_SEED_ID = "ff9df5a6-2f1a-4285-a935-c6969f933f1a";
const USUARIO_OPERADOR_PICK_PACK_SEED_ID = "62fd609c-ea3b-4e62-b9d2-5ccffad13849";
const USUARIO_ROL_ADMIN_ECOMMERCE_ID = "c6a749f0-5aa6-4983-83e7-7111b02ae5d7";
const USUARIO_ROL_OPERADOR_PICK_PACK_ID = "c9bb2cbe-1118-4411-ac03-3dd02880a709";

// spec_modulo_E.md §2.2 — usuario de sistema "Canal Web": `registrado_por_id`
// de los PedidoVenta de canal WEB. No es una persona ni tiene rol asignado.
const USUARIO_CANAL_WEB_ID = "b49a122e-fea6-43c4-8b8f-36a2491fddeb";

// HU-B9 (spec_modulo_B.md §2.9) — lista general + primera versión.
const LISTA_PRECIO_VENTA_GENERAL_ID = "16d1dbbf-b91e-4c07-93f0-007572d0d116";
const LISTA_PRECIO_VENTA_VERSION_1_ID = "f7bc2652-5022-4d5c-b235-be90b8f1677d";

// Sprint 4 — permisos de Módulos D (D.4), F y G (HU-G11).
const PERMISO_INTEGRACIONES_ADMINISTRAR_CONECTOR_ID = "b2b597a8-d562-4a4f-8cc2-b159c707eeac";
const PERMISO_NOTIFICACIONES_ADMINISTRAR_PLANTILLAS_ID = "5a8c727d-0c7e-4f24-b2d7-376d9dd2b948";
const PERMISO_CONFIGURACION_ADMINISTRAR_ID = "208089c2-9e4b-44eb-b3cc-87c698ff3ca8";
const PERMISO_CONFIGURACION_LEER_ID = "881b8fc2-11e6-46a4-a155-a04235e19836";
// Módulo F — rol Administrador de Plataforma (spec_modulo_F.md §2.1.1/§2.2),
// con un usuario de prueba. Los roles Desarrollador/DevOps y Marketing/
// Atención al Cliente de la misma matriz NO se siembran: la granularidad de
// permisos por acción para ellos está "a definir" en la spec.
const ROL_ADMINISTRADOR_PLATAFORMA_ID = "1e0efc5b-586f-431a-b1d4-f4dbdab7c60a";
const USUARIO_ADMIN_PLATAFORMA_SEED_ID = "245b3307-a299-4cf5-b1c6-238b45455848";
const USUARIO_ROL_ADMIN_PLATAFORMA_ID = "046702f5-330e-49e1-86e4-b8fead9244ee";
const PERMISO_TESORERIA_LEER_INGRESOS_WEB_ID ="27abe108-4c98-4f04-9010-6b5a901cef45";

// HU-F1 — Conector SANDBOX activo + bitácora de ejemplo.
const CONECTOR_PAGO_SANDBOX_ID = "5b2c56c2-ce9f-4b9f-82f0-f92c334f81d8";
const INVOCACION_CONECTOR_COBRO_OK_ID = "a183c9c5-fb10-4970-9474-387b5a5334fd";
const INVOCACION_CONECTOR_CONSULTA_FALLIDA_ID = "8b122bd0-5c8f-472e-a93f-a8745620f921";
const INVOCACION_CONECTOR_CONSULTA_OK_ID = "d63d8c84-5766-4838-a968-e4ac2354fd18";

// HU-E8 — cuentas de Cliente Web.
const CUENTA_WEB_JUAN_PEREZ_ID = "e9440ab2-091d-414d-9fc9-e02d312a1df5";
const CUENTA_WEB_MARIA_GOMEZ_ID = "49af5604-c606-447f-adf0-4637a045fa84";

// HU-E5/HU-E11 — producto extra para el caso `visibilidad_web = false`
// (los 3 ProductoMaestro previos ya cubren "publicable" y "no publicable").
const PRODUCTO_GORRA_TACTICA_ID = "92e96764-fc2b-4a4d-a615-258fd769968c";
const VARIANTE_GORRA_TACTICA_ID = "bc8d1631-2378-4c63-826f-16e2cc814eea";
const CONTENIDO_WEB_CAMISA_TACTICA_ID = "294e081c-f561-4cfe-98d8-1405326ba6db";
const CONTENIDO_WEB_BORCEGOS_ID = "46390457-e84e-4045-9cd2-bd9010f6fbf2";
const CONTENIDO_WEB_CAMISA_POLICIA_ID = "66882d66-81c4-4441-aeff-9066909b80ac";
const CONTENIDO_WEB_GORRA_TACTICA_ID = "a8ba9e46-5aa0-4224-8cde-b6faa676126f";
const FOTO_WEB_CAMISA_TACTICA_ID = "1e6f9b96-6dde-4528-8784-d84d30eb8f73";
const FOTO_WEB_BORCEGOS_ID = "8e490a11-2b5d-494a-91be-e0516f7727f5";
const FOTO_WEB_CAMISA_POLICIA_ID = "6378eec9-b0e2-449a-a426-55d160d4cb43";
const FOTO_WEB_GORRA_TACTICA_ID = "27e8250b-aaad-4f88-a0ca-8eafa3736357";

// HU-E1 — stock del depósito del canal web (Showroom) para las variantes
// con precio que todavía no tenían fila ahí.
const STOCK_CT2_SHOWROOM_ID = "d039332f-6f4f-4355-b6e7-6b340897ebdb";
const STOCK_CT3_SHOWROOM_ID = "676e1f19-bc5f-4fec-bbb5-5108365f94df";
const STOCK_B2_SHOWROOM_ID = "fe533994-5e90-43dd-8c07-eebbaf691c6f";
const STOCK_GORRA_SHOWROOM_ID = "d5f5e76e-6d21-42b4-ad87-f16f219d19bd";

// HU-E1 (docs/tasks/HU-E1.md §9) — fixtures del catálogo, carrito y checkout.
// UUID aleatorios verificados contra todo seed.ts (sin namespace numerado).
// SKU inactivo: baja lógica de la variante, CON precio y stock — la única
// razón de bloqueo es la desactivación (CA4, motivo SKU_INACTIVO).
const VARIANTE_CAMISA_TACTICA_INACTIVA_ID = "9f8b39ba-97af-42fc-9915-2f46a5fe67f9";
const STOCK_CT_INACTIVA_SHOWROOM_ID = "e66ce974-9448-4cb3-a9ea-5ee3f7a90bd5";
// Producto Maestro inactivo con variante activa, precio, stock y contenido
// web visible (motivo PRODUCTO_INACTIVO).
const PRODUCTO_CHALECO_TACTICO_ID = "db63470e-1617-443a-8555-6e1c44a96c05";
const VARIANTE_CHALECO_TACTICO_ID = "c0870f28-b4c6-4da6-861f-cee8e52092ae";
const STOCK_CHALECO_SHOWROOM_ID = "b0649afd-ed4f-4afb-bb43-b9e7869034c5";
const CONTENIDO_WEB_CHALECO_ID = "37de6c03-7014-41b0-81e4-ee667721642d";
const FOTO_WEB_CHALECO_ID = "4f67e568-71b7-4976-9f7b-56e39e61421a";
// Versión de la Lista de Precios de Venta con `vigente_desde` FUTURA (CA3).
const LISTA_PRECIO_VENTA_VERSION_FUTURA_ID = "d59ba4b5-1ed3-4be2-b5ae-8a19c8c71612";
// Cliente Web de prueba exclusivo de HU-E1 (D11): Juan Pérez no se toca.
const CLIENTE_CARLOS_RUIZ_ID = "cb682046-4e8c-484d-9cd1-dfad11a7d16d";
const CONSENTIMIENTO_CARLOS_RUIZ_ID = "b1dc1505-5bd4-4ae0-9aee-2bd8320fc011";
const CUENTA_WEB_CARLOS_RUIZ_ID = "f14aeb05-43e6-419e-aad0-61b096ecf13e";
const CARRITO_WEB_CARLOS_RUIZ_ID = "9694caaa-2f5b-4cb7-b848-7c005bdca884";
const CARRITO_ITEM_CARLOS_CT2_ID = "c29cea90-76fc-4e05-9a7b-9ba264d4bdda";
const CARRITO_ITEM_CARLOS_INACTIVA_ID = "edf2919c-4f48-4bc3-9fb8-6e2ca0809b56";
// Carrito de visitante (sin cuenta) para probar la fusión al iniciar sesión (CA7).
const CARRITO_WEB_VISITANTE_ID = "1fa6fdec-4aef-4c79-8174-9b41983b8147";
const CARRITO_ITEM_VISITANTE_CT3_ID = "6e08eb73-6768-4ab5-83ce-e6e3841166c4";
const CARRITO_ITEM_VISITANTE_CT2_ID = "e984b52c-1fb2-417e-9c71-93cceeeb408a";
// Valor crudo de `carrito_token` (la cookie lleva además la firma HMAC, HU-E1
// fase 2). Fijo para poder reproducir la fusión a mano.
const CARRITO_VISITANTE_TOKEN_SEED = "0b61c7bf18671e7ed1a096da1a17d9ea94c81004ed50d22a";

// HU-E4 — cupones y aplicaciones.
const CUPON_VIGENTE_ID = "1634c3e2-60fd-425a-8677-c0b180507d9a";
const CUPON_VENCIDO_ID = "d0eabb60-ec2c-422b-9f1e-c012013923ad";
const CUPON_AGOTADO_ID = "32d07824-4721-4128-b9d8-286278dd7151";
const CUPON_APLICACION_PENDIENTE_ID = "69486b09-0c4d-4750-8d25-f139a65b2c89";
const CUPON_APLICACION_AGOTADO_ID = "54072209-97b4-4705-88aa-fc8e8a29570f";

// HU-E2 y consumidoras — un pedido web por estado (ver bloque en main).
const PEDIDO_WEB_PAGO_PENDIENTE_IDS = { pedido: "f8aad0fc-85a3-4dd4-81cf-4fbf3fc14f6b", ecommerce: "385f3f34-2984-4b69-aa63-c61458c3cc9e", items: [{ item: "1c9c09b9-9451-4168-ace1-0615292b174c", reserva: "19345ba5-4a77-4c8a-9c2f-0ac389ebec2f" }] };
const PEDIDO_WEB_PAGO_RECHAZADO_IDS = { pedido: "a78b0893-c771-4ed1-b726-e5a3bc257645", ecommerce: "93c07b31-7058-402d-b66a-b65d2f9e373a", items: [{ item: "d5dd6dd4-5511-4c3d-9437-92149afc8169", reserva: "2a9f2d2e-6fe2-4520-931e-b0ff888e5976" }], transaccion: "0e9f2bb0-698e-4a4a-99d9-9e9b3b113b26" };
const PEDIDO_WEB_EN_PREPARACION_LIBRE_IDS = { pedido: "91a9f1cf-e278-4f9c-8584-4ee166c6c01d", ecommerce: "c62a900f-d1bf-43b9-a7a1-58472d152e0d", items: [{ item: "b83f44c5-82b1-447f-86d7-3a5f7b611768", reserva: "a15ad7a1-dc9c-475d-bf77-df09e01286fd" }], comprobante: "f0e7aa08-6870-4ae4-9597-5cf5a00741f4", medio_pago: "c7c02aa8-737f-41e7-9e6a-06a8d5304916", transaccion: "9c4c5bdd-0702-4a09-a12c-a38d479ec7f6" };
const PEDIDO_WEB_EN_PREPARACION_ASIGNADO_IDS = { pedido: "77c6531f-bd36-482a-b91a-e8e1f81ee39d", ecommerce: "900a0cab-0528-4f13-8988-452b2e8b3313", items: [{ item: "4225b4cc-5e82-40a5-bac4-dd3ee2a4217c", reserva: "10e71c6c-81e4-4bf2-8165-8dbad5cf7002" }, { item: "24eae8f3-6083-49a3-8486-86b31fd29cfe", reserva: "d822526c-28e4-44c2-8442-883654f17f81" }], comprobante: "a3014651-763c-4df3-a199-786cac67add6", medio_pago: "b2e4db08-7264-425b-9631-bf4bf94ed91d", transaccion: "2851c532-a653-4ca9-a5ed-a4fa8f32f89c" };
const PEDIDO_WEB_LISTO_PARA_RETIRO_IDS = { pedido: "ba514a5b-d5e1-47c0-8325-92684b9e9c62", ecommerce: "8dde8baf-1f08-48d7-b003-82241444b163", items: [{ item: "f8b690b0-6e74-43e2-882d-a0162a145241", reserva: "7b92537c-e2c4-4071-a5f0-3ef2af4f6f6b" }], comprobante: "1c4b8624-f1c5-434a-90cf-24ecee1f1282", medio_pago: "5881d6ec-33da-4be6-bd24-7ba650552c54", transaccion: "72c41d41-b73b-4d0e-95d3-f8c9a4455e6e" };
const PEDIDO_WEB_LISTO_PLAZO_VENCIDO_IDS = { pedido: "09997231-c847-4c99-b18d-59ee9588cd6d", ecommerce: "2c4cadd4-40ff-47e6-82d0-8d3fd4f32788", items: [{ item: "567e86ef-d1c8-4584-b3e2-caac1f6f49d4", reserva: "0588503d-cff2-4815-81f9-f7e92528126a" }], comprobante: "b01350d1-5412-41d1-bdb8-8203428d4734", medio_pago: "a96b2eb5-e54e-4583-8aa8-410bbdaf8b0d", transaccion: "b3f6d30d-a20a-4837-ae99-e67a49481f84" };
const PEDIDO_WEB_ENTREGADO_IDS = { pedido: "e8559382-2cc2-414c-9adf-6afcd5f0552f", ecommerce: "31b0b43a-60fe-4f0b-86a6-f1be089290a9", items: [{ item: "abaeb811-cad0-4e93-a7c2-afc890134f09", reserva: "2d495408-8e38-42b8-97d4-01e6b78466b3" }], comprobante: "4c338928-a46f-4571-a7ad-38dce5af86ec", medio_pago: "9dcde0b7-9429-4ffc-845c-79ddc08d458a", transaccion: "c98abda4-a319-4858-92e0-807096528e4c" };
const PEDIDO_WEB_ANULADO_IDS = { pedido: "d0ebfcb9-743b-412b-89c1-12a38a117ffd", ecommerce: "10326af2-d711-4365-98ff-509c598af7a5", items: [{ item: "c6f49d12-c32b-4ca9-8c0f-c132e5f42e92", reserva: "7e7802c0-8e7a-4ed0-8dba-1fb5bcb6a4d2" }] };

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

  // ── Módulo H — Proveedor HOMOLOGADO (InduSur) ──────────────────────────────
  //
  // Se crea ACÁ, antes de cualquier `VarianteSKU`, porque `proveedor_id` en
  // VarianteSKU es NOT NULL (FK onDelete: Restrict, solo HOMOLOGADO): toda
  // variante del seed se inserta apuntando a este proveedor. `proveedorPendiente`
  // y el resto del bloque de Módulo H siguen más abajo, sin moverse.
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
      proveedor_id: proveedorHomologado.id,
      is_active: true,
    },
    create: {
      id: VARIANTE_SKU_SEED_ID,
      producto_maestro_id: productoMaestro.id,
      proveedor_id: proveedorHomologado.id,
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

  // HU-A9 — permisos granulares de Reclasificación de Devueltos
  // (spec_modulo_A.md §2.8/§3.8). `inventario:reclasificar` habilita la
  // reclasificación directa (bajo umbral) y el listado de devueltos —
  // ADMINISTRADOR + ENCARGADO_DEPOSITO. `inventario:reclasificar_aprobar`
  // habilita aprobar/rechazar solicitudes sobre el umbral — SOLO
  // ADMINISTRADOR (matriz RBAC del Alcance). Asignaciones propias abajo, sin
  // tocar el loop existente de Módulo A (integridad de tests previos).
  const permisoReclasificar = await prisma.permiso.upsert({
    where: { id: PERMISO_RECLASIFICAR_ID },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: { id: PERMISO_RECLASIFICAR_ID, codigo: "inventario:reclasificar", descripcion: "Reclasificar unidades DEVUELTO (APTO→DISPONIBLE / NO_APTO→BAJA_MERMA) y listar devueltos", modulo: "MODULO_A" },
  });
  const permisoReclasificarAprobar = await prisma.permiso.upsert({
    where: { id: PERMISO_RECLASIFICAR_APROBAR_ID },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: { id: PERMISO_RECLASIFICAR_APROBAR_ID, codigo: "inventario:reclasificar_aprobar", descripcion: "Aprobar o rechazar solicitudes de reclasificación que superan el umbral (solo Administrador)", modulo: "MODULO_A" },
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

  // HU-A9 — `inventario:reclasificar` para ADMINISTRADOR + ENCARGADO_DEPOSITO
  // (mismo criterio que transferir/recepcionar/reservar).
  for (const rol of [rolEncargadoDeposito, rolAdministrador]) {
    await prisma.rolPermiso.upsert({
      where: { rol_id_permiso_id: { rol_id: rol.id, permiso_id: permisoReclasificar.id } },
      update: REACTIVAR_REFERENCIA_RBAC,
      create: { rol_id: rol.id, permiso_id: permisoReclasificar.id },
    });
  }

  // HU-A9 — `inventario:reclasificar_aprobar` SOLO ADMINISTRADOR (matriz RBAC
  // del Alcance: "Aprobar ajustes que superan el umbral crítico" es acción
  // exclusiva del Administrador, sin equivalente para ningún otro rol).
  await prisma.rolPermiso.upsert({
    where: {
      rol_id_permiso_id: {
        rol_id: rolAdministrador.id,
        permiso_id: permisoReclasificarAprobar.id,
      },
    },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: { rol_id: rolAdministrador.id, permiso_id: permisoReclasificarAprobar.id },
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
        proveedor_id: proveedorHomologado.id,
        is_active: true,
      },
      create: {
        id: v.id,
        producto_maestro_id: productoCamisaTactica.id,
        proveedor_id: proveedorHomologado.id,
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
        proveedor_id: proveedorHomologado.id,
        is_active: true,
      },
      create: {
        id: v.id,
        producto_maestro_id: productoBorcegos.id,
        proveedor_id: proveedorHomologado.id,
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

  await prisma.permiso.upsert({
    where: { id: PERMISO_PROVEEDORES_ADMINISTRAR_ID },
    update: {
      // El placeholder queda permanentemente desactivado: lo reemplazan los
      // permisos granulares de HU-H1 (bloque siguiente). Idempotente: el
      // update re-afirma el estado inactivo en cada corrida del seed.
      is_active: false,
      deletion_reason:
        "Reemplazado por permisos granulares de HU-H1 (proveedores:crear|editar|leer|homologar|baja)",
    },
    create: {
      id: PERMISO_PROVEEDORES_ADMINISTRAR_ID,
      codigo: "proveedores:administrar",
      descripcion:
        "PLACEHOLDER — alta, homologación y suspensión de proveedores (HU-H1). " +
        "Reemplazado por permisos granulares de HU-H1 (proveedores:crear|editar|leer|homologar|baja).",
      modulo: "MODULO_H",
      is_active: false,
      deletion_reason:
        "Reemplazado por permisos granulares de HU-H1 (proveedores:crear|editar|leer|homologar|baja)",
    },
  });

  // Se le quitan los vínculos viejos al placeholder (este seed es dueño de
  // RolPermiso — precedente: limpieza de vínculos de OC del Comprador).
  await prisma.rolPermiso.deleteMany({
    where: { permiso_id: PERMISO_PROVEEDORES_ADMINISTRAR_ID },
  });

  // ── HU-H1 — permisos granulares de Proveedor (spec_modulo_H.md §2.1/§2.2) ─
  //
  // Un permiso independiente por acción (NO un único `proveedores:administrar`).
  // Reparto (matriz Alcance §5 + decisión del equipo):
  //   - proveedores:crear     → Comprador Y Supervisor de Compras
  //   - proveedores:editar    → Comprador Y Supervisor de Compras
  //   - proveedores:leer      → Comprador Y Supervisor de Compras (+ AUDITOR, lectura — bloque más abajo)
  //   - proveedores:homologar → SOLO Supervisor de Compras
  //   - proveedores:baja      → SOLO Supervisor de Compras
  const permisosProveedores = await Promise.all(
    (
      [
        [PERMISO_PROVEEDORES_CREAR_ID, "proveedores:crear", "Crear (alta) un proveedor en estado PENDIENTE con legajo comercial (HU-H1 §2.1)"],
        [PERMISO_PROVEEDORES_EDITAR_ID, "proveedores:editar", "Editar el legajo comercial de un proveedor — razón social, contactos, categorías y reemplazo de datos bancarios re-cifrados (HU-H1)"],
        [PERMISO_PROVEEDORES_LEER_ID, "proveedores:leer", "Consultar el listado de proveedores activos con filtro por estado (HU-H1)"],
        [PERMISO_PROVEEDORES_HOMOLOGAR_ID, "proveedores:homologar", "Homologar o suspender un proveedor (transición manual de estado) — exclusivo Supervisor de Compras (HU-H1 §2.2)"],
        [PERMISO_PROVEEDORES_BAJA_ID, "proveedores:baja", "Dar de baja lógica el registro de un proveedor — exclusivo Supervisor de Compras (HU-H1 · RULES.md Regla N.° 1)"],
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
    permisoProveedoresCrear,
    permisoProveedoresEditar,
    permisoProveedoresLeer,
    permisoProveedoresHomologar,
    permisoProveedoresBaja,
  ] = permisosProveedores;

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

  const permisoRecepcionesRegistrar = await prisma.permiso.upsert({
    where: { id: PERMISO_RECEPCIONES_REGISTRAR_ID },
    update: {
      ...REACTIVAR_REFERENCIA_RBAC,
      codigo: "recepciones:registrar",
      descripcion: "Registrar recepciones físicas de mercadería contra órdenes de compra (HU-H4)",
      modulo: "MODULO_H",
    },
    create: {
      id: PERMISO_RECEPCIONES_REGISTRAR_ID,
      codigo: "recepciones:registrar",
      descripcion: "Registrar recepciones físicas de mercadería contra órdenes de compra (HU-H4)",
      modulo: "MODULO_H",
    },
  });

  // Descripción compartida entre `create` y `update`: en bases de dev que ya
  // tenían la fila `tesoreria:operar` (con el texto PLACEHOLDER viejo), re-correr
  // el seed también reescribe la descripción al texto SUPERSEDIDO — no solo en
  // una base fresca.
  const DESCRIPCION_TESORERIA_OPERAR_SUPERSEDIDO =
    "SUPERSEDIDO (HU-G8) — reemplazado por los permisos granulares " +
    "cuentas_por_pagar:leer y cuentas_por_pagar:pagar. La fila Permiso se " +
    "conserva para no orfanar referencias históricas del AuditLog; su " +
    "vínculo con TESORERO_CENTRAL fue retirado.";

  const permisoTesoreriaOperar = await prisma.permiso.upsert({
    where: { id: PERMISO_TESORERIA_OPERAR_ID },
    update: {
      ...REACTIVAR_REFERENCIA_RBAC,
      descripcion: DESCRIPCION_TESORERIA_OPERAR_SUPERSEDIDO,
    },
    create: {
      id: PERMISO_TESORERIA_OPERAR_ID,
      codigo: "tesoreria:operar",
      descripcion: DESCRIPCION_TESORERIA_OPERAR_SUPERSEDIDO,
      modulo: "MODULO_G",
    },
  });

  // ── HU-G8 — permisos granulares de Cuenta por Pagar (spec_modulo_G.md §7) ──
  //
  // Reemplazan al placeholder `tesoreria:operar`. Mismo patrón que los
  // permisos granulares de OrdenCompra (HU-H3): un permiso por acción,
  // constante UUID fija, upsert idempotente.
  const permisosCuentaPorPagar = await Promise.all(
    (
      [
        [PERMISO_CXP_LEER_ID, "cuentas_por_pagar:leer", "Consultar el listado de Cuentas por Pagar y su estado (HU-G8)"],
        [PERMISO_CXP_PAGAR_ID, "cuentas_por_pagar:pagar", "Marcar una Cuenta por Pagar DEFINITIVA como PAGADA (HU-G8) — exclusivo Tesorero Central"],
      ] as const
    ).map(([id, codigo, descripcion]) =>
      prisma.permiso.upsert({
        where: { id },
        update: REACTIVAR_REFERENCIA_RBAC,
        create: { id, codigo, descripcion, modulo: "MODULO_G" },
      }),
    ),
  );
  const [permisoCxpLeer, permisoCxpPagar] = permisosCuentaPorPagar;

  // ── HU-H9 — permisos granulares de ComprobanteProveedor (spec_modulo_H.md §2.7) ──
  //   - comprobantes_proveedor:crear  → Comprador Y Supervisor de Compras
  //   - comprobantes_proveedor:leer   → Comprador, Supervisor de Compras, Auditor
  //   - comprobantes_proveedor:anular → SOLO Supervisor de Compras (baja lógica
  //                                     de un comprobante presentado — corrección sensible)
  const permisosComprobantes = await Promise.all(
    (
      [
        [PERMISO_COMPROBANTES_CREAR_ID, "comprobantes_proveedor:crear", "Registrar un comprobante fiscal (Factura A/B/C/M) de proveedor contra una OC recibida (HU-H9 §2.7)"],
        [PERMISO_COMPROBANTES_LEER_ID, "comprobantes_proveedor:leer", "Consultar los comprobantes de proveedor registrados, por OC o global (HU-H9 §2.7)"],
        [PERMISO_COMPROBANTES_ANULAR_ID, "comprobantes_proveedor:anular", "Anular (baja lógica) un comprobante de proveedor con motivo obligatorio — exclusivo Supervisor de Compras (HU-H9 §2.7 · RULES.md Regla N.° 1)"],
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
    permisoComprobantesCrear,
    permisoComprobantesLeer,
    permisoComprobantesAnular,
  ] = permisosComprobantes;

  // ── HU-H2 — permisos de publicación de Lista de Precios (spec_modulo_H.md §2.3) ──
  //   - proveedores:publicar_lista          → dentro del umbral normal (Comprador, Supervisor)
  //   - proveedores:publicar_lista_critica  → por encima del umbral crítico — exclusivo Supervisor
  // Creados originalmente como permisos "stub" (sin asignar a ningún Rol,
  // antes de que existiera la capa de servicios de HU-H2). Ahora que
  // `lista-precios.service.ts` y sus endpoints ya están implementados
  // (Pieza 1), se asignan a los Roles reales más abajo — mismo reparto de
  // `propose.md` decisión 5, ya cerrada.
  const permisosPublicarLista = await Promise.all(
    (
      [
        [PERMISO_PROVEEDORES_PUBLICAR_LISTA_ID, "proveedores:publicar_lista", "Publicar una nueva ListaPrecioVersion dentro del umbral normal de variación (HU-H2 §2.3)"],
        [PERMISO_PROVEEDORES_PUBLICAR_LISTA_CRITICA_ID, "proveedores:publicar_lista_critica", "Publicar/aprobar una ListaPrecioVersion que supera el umbral crítico de variación — exclusivo Supervisor de Compras (HU-H2 §2.3)"],
      ] as const
    ).map(([id, codigo, descripcion]) =>
      prisma.permiso.upsert({
        where: { id },
        update: REACTIVAR_REFERENCIA_RBAC,
        create: { id, codigo, descripcion, modulo: "MODULO_H" },
      }),
    ),
  );
  const [permisoProveedoresPublicarLista, permisoProveedoresPublicarListaCritica] =
    permisosPublicarLista;

  // ── HU-H7 — comparativa de precios entre proveedores (spec_modulo_H.md
  // §2.10). Permiso único, sin variante crítica ni umbral — asignado directo
  // a Comprador y Supervisor de Compras más abajo (T2), ningún otro rol.
  const permisoProveedoresCompararPrecios = await prisma.permiso.upsert({
    where: { id: PERMISO_PROVEEDORES_COMPARAR_PRECIOS_ID },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: {
      id: PERMISO_PROVEEDORES_COMPARAR_PRECIOS_ID,
      codigo: "proveedores:comparar_precios",
      descripcion:
        "Consultar la vista comparativa de precios vigentes entre proveedores, por SKU o por categoría (HU-H7 §2.10)",
      modulo: "MODULO_H",
    },
  });

  // ── HU-H8 — costo de reposición vigente (spec_modulo_H.md §2.11). Permiso
  // servicio-a-servicio: el actor es "Sistema", no un usuario humano
  // (propose_HU-H8_FINAL.md §2.2, decisión ya cerrada). NO se asigna a
  // ningún rol humano de producción (Comprador, Supervisor de Compras, etc.)
  // ni se expone en ningún menú. `withPermission` sigue siendo el único
  // guardián del endpoint HTTP; Módulo D consume el servicio directo,
  // intra-proceso, sin pasar por este permiso.
  //
  // N6 (Apply, confirmado): no existe en este seed ningún usuario ni rol
  // técnico al que asignar el permiso. El único precedente real de "servicio
  // sin consumidor humano directo" es HU-A10 (`inventario:reservar_stock` /
  // `inventario:confirmar_reserva`, más arriba) — pero ese precedente NO
  // coincide con lo que el Propose asumía como hipótesis: en el seed real,
  // esos dos permisos terminaron asignados directamente a roles humanos
  // (`ENCARGADO_DEPOSITO` + `ADMINISTRADOR`), no dejados sin asignar a la
  // espera de un fixture. No se replica ese patrón acá porque la decisión de
  // §2.2 para HU-H8 es explícita y no depende de ese precedente: el permiso
  // queda sembrado en el catálogo (necesario para que `withPermission` lo
  // pueda validar) sin asignar a ningún Rol del seed. La asignación para
  // tests se resuelve con un fixture puntual en T16, no acá.
  await prisma.permiso.upsert({
    where: { id: PERMISO_PROVEEDORES_LEER_COSTO_REPOSICION_ID },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: {
      id: PERMISO_PROVEEDORES_LEER_COSTO_REPOSICION_ID,
      codigo: "proveedores:leer_costo_reposicion",
      descripcion:
        "Consultar el costo de reposición vigente de una VarianteSKU — servicio-a-servicio, sin consumidor humano directo (HU-H8 §2.11)",
      modulo: "MODULO_H",
    },
  });

  // ── Módulo C (Sprint 3) — permisos granulares de Cliente (spec_modulo_C.md,
  // sección "Permisos RBAC" del Alcance) ──────────────────────────────────────
  //   - clientes:crear                  → Vendedor, Administrador de CRM
  //   - clientes:editar                 → datos de contacto + direcciones (HU-C3) +
  //                                        canal de contacto (HU-C9) — mismo permiso
  //   - clientes:gestionar_consentimiento → alta/revocación de ConsentimientoCliente (HU-C4)
  //   - clientes:baja                   → exclusivo Administrador de CRM (HU-C6)
  //   - clientes:leer                   → Vendedor, Administrador de CRM, Auditor (HU-C7)
  //   - clientes:gestionar_segmento     → separado de `clientes:editar` por decisión de
  //                                        granularidad de la Rev. 2 del spec (§2.8) (HU-C8)
  // Ningún rol Vendedor/Administrador de CRM existe todavía en el seed — estos
  // permisos quedan sembrados sin asignar a ningún Rol, a la espera de esa tarea.
  await Promise.all(
    (
      [
        [PERMISO_CLIENTES_CREAR_ID, "clientes:crear", "Dar de alta un Cliente con validación de unicidad por DNI (HU-C1 §2.1)"],
        [PERMISO_CLIENTES_EDITAR_ID, "clientes:editar", "Editar datos de contacto, direcciones y canal de contacto preferido de un Cliente (HU-C2/C3/C9 §2.2/§2.3)"],
        [PERMISO_CLIENTES_GESTIONAR_CONSENTIMIENTO_ID, "clientes:gestionar_consentimiento", "Registrar y revocar el ConsentimientoCliente de tratamiento de datos personales (HU-C4 §2.4)"],
        [PERMISO_CLIENTES_BAJA_ID, "clientes:baja", "Dar de baja lógica un Cliente con motivo obligatorio — exclusivo Administrador de CRM (HU-C6 §2.6)"],
        [PERMISO_CLIENTES_LEER_ID, "clientes:leer", "Consultar un Cliente y su ficha unificada por DNI (HU-C7 §2.7)"],
        [PERMISO_CLIENTES_GESTIONAR_SEGMENTO_ID, "clientes:gestionar_segmento", "Actualizar el segmento comercial de un Cliente — permiso granular separado de `clientes:editar` (HU-C8 §2.8)"],
      ] as const
    ).map(([id, codigo, descripcion]) =>
      prisma.permiso.upsert({
        where: { id },
        update: REACTIVAR_REFERENCIA_RBAC,
        create: { id, codigo, descripcion, modulo: "MODULO_C" },
      }),
    ),
  );

  // HU-C10 (spec_modulo_C.md §2.9): sembrado LITERAL según lo que piden
  // spec_modulo_C.md §2.9 y spec_modulo_H.md §2.9 — pese a que ambos afirman
  // que "ya usa Módulo H" el mismo permiso, el código real usa
  // `auditoria:leer_forense` (`PERMISO_LEER_FORENSE_ID`, más arriba) en todas
  // sus rutas/servicios/UI. `auditoria:leer_historico` NO existe hoy en
  // ningún otro lado del proyecto — es una divergencia de nomenclatura
  // conocida y aceptada explícitamente por el equipo para esta tarea (ver
  // reporte de relevamiento), no un error de este seed.
  await prisma.permiso.upsert({
    where: { id: PERMISO_AUDITORIA_LEER_HISTORICO_ID },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: {
      id: PERMISO_AUDITORIA_LEER_HISTORICO_ID,
      codigo: "auditoria:leer_historico",
      descripcion:
        "Consultar el log de auditoría histórico filtrado por dominio (HU-C10 §2.9, scope 'clientes') — el filtro de dominio se aplica en la capa de servicios, no en este permiso",
      modulo: "MODULO_C",
    },
  });

  const permisoLeerAuditoriaClientes = await prisma.permiso.upsert({
    where: { id: PERMISO_CLIENTES_LEER_AUDITORIA_ID },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: {
      id: PERMISO_CLIENTES_LEER_AUDITORIA_ID,
      codigo: "clientes:leer_auditoria",
      descripcion: "Consultar los asientos de altas, cambios y bajas lógicas de clientes",
      modulo: "MODULO_C",
    },
  });

  const permisoValidarIdentidadClienteWeb = await prisma.permiso.upsert({
    where: { id: PERMISO_VALIDAR_IDENTIDAD_CLIENTE_WEB_ID },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: {
      id: PERMISO_VALIDAR_IDENTIDAD_CLIENTE_WEB_ID,
      codigo: "ventas:validar_identidad_cliente_web",
      descripcion: "Validar identidad y habilitar recuperación presencial de cuentas web",
      modulo: "MODULO_E",
    },
  });

  // ── HU-C1 — Roles VENDEDOR y ADMINISTRADOR_CRM ─────────────────────────────
  // Reparto de los 6 permisos `clientes:*` de esta sección (task-chiki.md, prerrequisito de
  // roles):
  //   - VENDEDOR            → crear, editar, gestionar_consentimiento,
  //                           gestionar_segmento, leer. NO baja.
  //   - ADMINISTRADOR_CRM   → los 6, directo.
  //   - AUDITOR (ya existía) → se le agrega clientes:leer +
  //                           auditoria:leer_historico (HU-C10 §2.9, ya
  //                           sembrado más arriba sin asignar a ningún Rol).
  const rolVendedor = await prisma.rol.upsert({
    where: { id: ROL_VENDEDOR_ID },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: {
      id: ROL_VENDEDOR_ID,
      nombre: "VENDEDOR",
      descripcion:
        "Atención y alta de clientes, venta asistida (Módulo C) — sin permiso de baja",
    },
  });

  const rolAdministradorCrm = await prisma.rol.upsert({
    where: { id: ROL_ADMINISTRADOR_CRM_ID },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: {
      id: ROL_ADMINISTRADOR_CRM_ID,
      nombre: "ADMINISTRADOR_CRM",
      descripcion:
        "Gestión completa del padrón de clientes (Módulo C), incluida baja lógica",
    },
  });

  const permisosVendedor = [
    PERMISO_CLIENTES_CREAR_ID,
    PERMISO_CLIENTES_EDITAR_ID,
    PERMISO_CLIENTES_GESTIONAR_CONSENTIMIENTO_ID,
    PERMISO_CLIENTES_GESTIONAR_SEGMENTO_ID,
    PERMISO_CLIENTES_LEER_ID,
  ];
  permisosVendedor.push(permisoValidarIdentidadClienteWeb.id);
  for (const permisoId of permisosVendedor) {
    await prisma.rolPermiso.upsert({
      where: { rol_id_permiso_id: { rol_id: rolVendedor.id, permiso_id: permisoId } },
      update: REACTIVAR_REFERENCIA_RBAC,
      create: { rol_id: rolVendedor.id, permiso_id: permisoId },
    });
  }

  const permisosAdministradorCrm = [
    PERMISO_CLIENTES_CREAR_ID,
    PERMISO_CLIENTES_EDITAR_ID,
    PERMISO_CLIENTES_GESTIONAR_CONSENTIMIENTO_ID,
    PERMISO_CLIENTES_BAJA_ID,
    PERMISO_CLIENTES_LEER_ID,
    PERMISO_CLIENTES_GESTIONAR_SEGMENTO_ID,
  ];
  for (const permisoId of permisosAdministradorCrm) {
    await prisma.rolPermiso.upsert({
      where: {
        rol_id_permiso_id: { rol_id: rolAdministradorCrm.id, permiso_id: permisoId },
      },
      update: REACTIVAR_REFERENCIA_RBAC,
      create: { rol_id: rolAdministradorCrm.id, permiso_id: permisoId },
    });
  }

  for (const permisoId of [PERMISO_CLIENTES_LEER_ID, PERMISO_AUDITORIA_LEER_HISTORICO_ID]) {
    await prisma.rolPermiso.upsert({
      where: { rol_id_permiso_id: { rol_id: rolAuditor.id, permiso_id: permisoId } },
      update: REACTIVAR_REFERENCIA_RBAC,
      create: { rol_id: rolAuditor.id, permiso_id: permisoId },
    });
  }

  // HU-C10: permiso acotado para Auditor y Administrador CRM; Vendedor no lo recibe.
  for (const rolId of [rolAuditor.id, rolAdministradorCrm.id]) {
    await prisma.rolPermiso.upsert({
      where: { rol_id_permiso_id: { rol_id: rolId, permiso_id: permisoLeerAuditoriaClientes.id } },
      update: REACTIVAR_REFERENCIA_RBAC,
      create: { rol_id: rolId, permiso_id: permisoLeerAuditoriaClientes.id },
    });
  }

  // HU-C6 — el usuario admin de prueba (`administrador.seed`) solo tenía el rol
  // ADMINISTRADOR (`roles:administrar`), sin ningún `clientes:*`. Se le suma
  // ADMINISTRADOR_CRM (que ya incluye `clientes:baja`) para poder ejercitar la
  // baja lógica end-to-end sin crear un usuario nuevo.
  await prisma.usuarioRol.upsert({
    where: {
      usuario_id_rol_id: {
        usuario_id: USUARIO_ADMIN_SEED_ID,
        rol_id: rolAdministradorCrm.id,
      },
    },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: { usuario_id: USUARIO_ADMIN_SEED_ID, rol_id: rolAdministradorCrm.id },
  });

  // HU-C3 (ronda de cobertura HTTP) — usuario de prueba con rol VENDEDOR.
  // Se crea y se le asigna el rol acá, dentro del bloque RBAC de Módulo C,
  // porque el rol (y sus permisos `clientes:*`) ya existen desde el upsert de
  // arriba; asignarlo antes sería una FK inválida. Upserts idempotentes, como
  // el resto del seed.
  const usuarioVendedor = await prisma.usuario.upsert({
    where: { nombre_usuario: "vendedor.seed" },
    update: {},
    create: {
      id: USUARIO_VENDEDOR_SEED_ID,
      nombre_usuario: "vendedor.seed",
      email: "vendedor.seed@erp-swat.local",
      password_hash: passwordSeed.hash,
      password_salt: passwordSeed.salt,
      nombre_completo: "Vendedor Seed (Módulo C)",
      estado: "ACTIVO",
      is_active: true,
    },
  });

  await prisma.usuarioRol.upsert({
    where: {
      usuario_id_rol_id: {
        usuario_id: usuarioVendedor.id,
        rol_id: rolVendedor.id,
      },
    },
    update: {},
    create: {
      id: USUARIO_ROL_VENDEDOR_ID,
      usuario_id: usuarioVendedor.id,
      rol_id: rolVendedor.id,
    },
  });

  // ── Módulo B (Sprint 3) — permisos granulares de Ventas (spec_modulo_B.md
  // §2, un permiso por acción, mismo criterio que el resto del proyecto) ──
  //   - ventas:registrar_venta_mostrador     → exclusivo Cajero POS (HU-B1 §2.1)
  //   - ventas:gestionar_turno_caja          → exclusivo Cajero POS (HU-B2 §2.2)
  //   - ventas:emitir_cotizacion             → exclusivo Cajero POS (HU-B3 §2.3)
  //   - ventas:aplicar_descuento_margen      → Cajero POS, dentro de su margen habilitado (HU-B4 §2.4)
  //   - ventas:autorizar_excepcion_descuento → exclusivo Supervisor de Ventas (HU-B4 §2.4)
  //   - ventas:gestionar_cuenta_corriente    → Cajero POS y Supervisor de Ventas (HU-B5 §2.5)
  //   - ventas:autorizar_excepcion_credito   → exclusivo Supervisor de Ventas (HU-B5 §2.5)
  //   - ventas:leer                          → todos los roles del módulo (catálogo/precios/comprobantes propios)
  //   - ventas:anular_pedido                 → exclusivo Supervisor de Ventas (HU-B7 §2.8)
  //   - ventas:leer_log_operativo            → exclusivo Supervisor de Ventas, acceso restringido (HU-B6 §2.6)
  //   - ventas:gestionar_lista_precios       → exclusivo Supervisor de Ventas (HU-B9 §2.9, Sprint 4)
  // HU-B8 crea los roles CAJERO_POS y SUPERVISOR_VENTAS y les asigna estos
  // permisos — ver bloque "Módulo B (Sprint 3) — Roles operativos de
  // Ventas" más abajo, junto a los usuarios de prueba.
  await Promise.all(
    (
      [
        [PERMISO_VENTAS_REGISTRAR_MOSTRADOR_ID, "ventas:registrar_venta_mostrador", "Registrar una venta de mostrador con cobro multimedio — exclusivo Cajero POS (HU-B1 §2.1)"],
        [PERMISO_VENTAS_GESTIONAR_TURNO_CAJA_ID, "ventas:gestionar_turno_caja", "Abrir y cerrar el turno de caja propio, con arqueo ciego — exclusivo Cajero POS (HU-B2 §2.2)"],
        [PERMISO_VENTAS_EMITIR_COTIZACION_ID, "ventas:emitir_cotizacion", "Emitir un Presupuesto con congelamiento de stock y aceptar su conversión a PedidoVenta — exclusivo Cajero POS (HU-B3 §2.3)"],
        [PERMISO_VENTAS_APLICAR_DESCUENTO_MARGEN_ID, "ventas:aplicar_descuento_margen", "Aplicar un descuento dentro del margen habilitado por perfil, sin autorización de terceros (HU-B4 §2.4)"],
        [PERMISO_VENTAS_AUTORIZAR_EXCEPCION_DESCUENTO_ID, "ventas:autorizar_excepcion_descuento", "Autorizar un descuento o cambio de precio por fuera del margen habilitado — exclusivo Supervisor de Ventas (HU-B4 §2.4)"],
        [PERMISO_VENTAS_GESTIONAR_CUENTA_CORRIENTE_ID, "ventas:gestionar_cuenta_corriente", "Consultar y registrar operaciones sobre la CuentaCorrienteCliente de un cliente (HU-B5 §2.5)"],
        [PERMISO_VENTAS_AUTORIZAR_EXCEPCION_CREDITO_ID, "ventas:autorizar_excepcion_credito", "Autorizar una operación de cuenta corriente que excede el límite de crédito disponible — exclusivo Supervisor de Ventas (HU-B5 §2.5)"],
        [PERMISO_VENTAS_LEER_ID, "ventas:leer", "Consultar catálogo, precios, disponibilidad de stock y comprobantes propios del pedido (HU-B7 §2.7)"],
        [PERMISO_VENTAS_ANULAR_PEDIDO_ID, "ventas:anular_pedido", "Anular un PedidoVenta en estado RESERVADO — exclusivo Supervisor de Ventas (HU-B7 §2.8)"],
        [PERMISO_VENTAS_GESTIONAR_LISTA_PRECIOS_ID, "ventas:gestionar_lista_precios", "Publicar versiones de la Lista de Precios de Venta y consultar la sugerencia de precio — exclusivo Supervisor de Ventas (HU-B9 §2.9)"],
        [PERMISO_VENTAS_LEER_LOG_OPERATIVO_ID, "ventas:leer_log_operativo", "Consultar el log de auditoría del módulo con alcance restringido a las operaciones propias o escaladas al Supervisor, sin verificar_integridad (HU-B6 §2.6)"],
      ] as const
    ).map(([id, codigo, descripcion]) =>
      prisma.permiso.upsert({
        where: { id },
        update: REACTIVAR_REFERENCIA_RBAC,
        create: { id, codigo, descripcion, modulo: "MODULO_B" },
      }),
    ),
  );

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
        [PERMISO_OC_LEER_ID, "ordenes_compra:leer", "Consultar el listado y el detalle de órdenes de compra (Alcance §5 — acceso de lectura, separado de crear)"],
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
    permisoOcLeer,
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
  //   - ordenes_compra:leer      → Comprador Y Supervisor (directo, Alcance §5). El
  //                                Auditor lo recibe aparte (bloque de más abajo).
  //                                Personal de Depósito NO: su fila es "△ solicita"
  //                                y su consulta puntual la cubre el flujo de
  //                                recepción (HU-H4), igual que `proveedores:leer`.
  const permisosComprador = [
    permisoProveedoresCrear,
    permisoProveedoresEditar,
    permisoProveedoresLeer,
    permisoComprasOperar,
    permisoOcCrear,
    permisoOcConfirmar,
    permisoOcCerrar,
    permisoOcLeer,
    // HU-H9: el Comprador registra y consulta comprobantes, pero NO los anula.
    permisoComprobantesCrear,
    permisoComprobantesLeer,
    // HU-H2 (propose.md decisión 5): publicación dentro del umbral normal.
    permisoProveedoresPublicarLista,
    // HU-H7 §2.10: comparativa de precios, directo (sin variante crítica).
    permisoProveedoresCompararPrecios,
  ];
  const permisosSupervisorCompras = [
    permisoProveedoresCrear,
    permisoProveedoresEditar,
    permisoProveedoresLeer,
    permisoProveedoresHomologar,
    permisoProveedoresBaja,
    permisoOcCrear,
    permisoOcEnviar,
    permisoOcConfirmar,
    permisoOcCerrar,
    permisoOcCancelar,
    permisoOcLeer,
    // HU-H9: el Supervisor de Compras registra, consulta y es el ÚNICO que anula.
    permisoComprobantesCrear,
    permisoComprobantesLeer,
    permisoComprobantesAnular,
    // HU-H2 (propose.md decisión 5): publicación normal + exclusivo crítico.
    permisoProveedoresPublicarLista,
    permisoProveedoresPublicarListaCritica,
    // HU-H7 §2.10: comparativa de precios, directo (sin variante crítica).
    permisoProveedoresCompararPrecios,
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

  // HU-H4: el placeholder del Comprador se retira mediante baja lógica.
  await prisma.rolPermiso.updateMany({
    where: {
      rol_id: rolComprador.id,
      permiso_id: permisoRecepcionesRegistrar.id,
      is_active: true,
    },
    data: {
      is_active: false,
      deleted_at: new Date(),
      deletion_reason: "HU-H4: recepción física segregada del rol COMPRADOR",
    },
  });

  for (const rol of [rolEncargadoDeposito, rolAdministrador]) {
    await prisma.rolPermiso.upsert({
      where: {
        rol_id_permiso_id: {
          rol_id: rol.id,
          permiso_id: permisoRecepcionesRegistrar.id,
        },
      },
      update: REACTIVAR_REFERENCIA_RBAC,
      create: {
        rol_id: rol.id,
        permiso_id: permisoRecepcionesRegistrar.id,
      },
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

  // Sprint 3 (cierre HU-H6/UI de Listas de Precios) — `auditoria:leer_historico`
  // (sembrado en el bloque de Módulo C, `PERMISO_AUDITORIA_LEER_HISTORICO_ID`)
  // habilita `GET /api/proveedores/auditoria` (H6) y la consola
  // `/auditoria/logs?modulo=proveedores`. Hasta acá solo lo tenía AUDITOR — se
  // suma SUPERVISOR_COMPRAS (decisión explícita del usuario: NO se le da a
  // COMPRADOR, que no debe poder consultar el historial forense del circuito
  // que él mismo opera).
  await prisma.rolPermiso.upsert({
    where: {
      rol_id_permiso_id: {
        rol_id: rolSupervisorCompras.id,
        permiso_id: PERMISO_AUDITORIA_LEER_HISTORICO_ID,
      },
    },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: {
      rol_id: rolSupervisorCompras.id,
      permiso_id: PERMISO_AUDITORIA_LEER_HISTORICO_ID,
    },
  });

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

  // ── HU-G8 — el placeholder `tesoreria:operar` queda supersedido ───────────
  // Su vínculo con TESORERO_CENTRAL se retira (este seed es dueño de
  // RolPermiso — ver cabecera del archivo). La fila Permiso se conserva. El
  // acceso de Tesorería pasa a los permisos granulares cuentas_por_pagar:*.
  await prisma.rolPermiso.deleteMany({
    where: {
      rol_id: rolTesorero.id,
      permiso_id: permisoTesoreriaOperar.id,
    },
  });

  // cuentas_por_pagar:leer → TESORERO_CENTRAL, AUDITOR, ADMINISTRADOR.
  // CAJERO_POS ya existe desde HU-B8, pero deliberadamente NO se le asigna
  // este permiso acá: es de Módulo G (Cuentas por Pagar), que todavía no
  // tiene código implementado — spec_modulo_G.md §5 lo deja como pendiente
  // explícito, fuera del alcance de HU-B8 (decisión confirmada en su
  // relevamiento). Queda documentado como deuda pendiente, a resolver
  // cuando se implemente el módulo de Cuentas por Pagar.
  for (const rol of [rolTesorero, rolAuditor, rolAdministrador]) {
    await prisma.rolPermiso.upsert({
      where: {
        rol_id_permiso_id: { rol_id: rol.id, permiso_id: permisoCxpLeer.id },
      },
      update: REACTIVAR_REFERENCIA_RBAC,
      create: { rol_id: rol.id, permiso_id: permisoCxpLeer.id },
    });
  }

  // cuentas_por_pagar:pagar → SOLO TESORERO_CENTRAL.
  await prisma.rolPermiso.upsert({
    where: {
      rol_id_permiso_id: {
        rol_id: rolTesorero.id,
        permiso_id: permisoCxpPagar.id,
      },
    },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: { rol_id: rolTesorero.id, permiso_id: permisoCxpPagar.id },
  });

  // ── HU-H9 — comprobantes_proveedor:leer → también AUDITOR ─────────────────
  // Comprador y Supervisor de Compras ya lo reciben vía `permisosComprador` /
  // `permisosSupervisorCompras` (arriba). El Auditor lo necesita para la
  // trazabilidad documental — mismo criterio que `cuentas_por_pagar:leer`.
  await prisma.rolPermiso.upsert({
    where: {
      rol_id_permiso_id: {
        rol_id: rolAuditor.id,
        permiso_id: permisoComprobantesLeer.id,
      },
    },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: { rol_id: rolAuditor.id, permiso_id: permisoComprobantesLeer.id },
  });

  // ── HU-H3 (consistencia) — ordenes_compra:leer → también AUDITOR ──────────
  // Alcance §5, fila "Consultar el historial de precios y órdenes de un
  // proveedor": el Auditor tiene acceso de lectura directo (✓). Comprador y
  // Supervisor de Compras ya lo reciben vía `permisosComprador` /
  // `permisosSupervisorCompras`. Mismo criterio que `cuentas_por_pagar:leer` y
  // `comprobantes_proveedor:leer` — acceso de lectura ampliado del Auditor, sin
  // capacidad de ejecutar ninguna transición (crear/enviar/confirmar/cerrar/
  // cancelar siguen exclusivas de sus permisos granulares).
  await prisma.rolPermiso.upsert({
    where: {
      rol_id_permiso_id: {
        rol_id: rolAuditor.id,
        permiso_id: permisoOcLeer.id,
      },
    },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: { rol_id: rolAuditor.id, permiso_id: permisoOcLeer.id },
  });

  // ── HU-H1 (consistencia) — proveedores:leer → también AUDITOR ─────────────
  // Matriz Alcance §5: el Auditor tiene acceso de lectura directo (✓) a los
  // legajos de proveedores. Comprador y Supervisor de Compras ya lo reciben
  // vía `permisosComprador` / `permisosSupervisorCompras`. Mismo criterio que
  // `cuentas_por_pagar:leer`, `comprobantes_proveedor:leer` y
  // `ordenes_compra:leer` — lectura ampliada del Auditor, sin capacidad de
  // ejecutar ninguna transición (crear/editar/homologar/baja siguen
  // exclusivas de sus permisos granulares).
  await prisma.rolPermiso.upsert({
    where: {
      rol_id_permiso_id: {
        rol_id: rolAuditor.id,
        permiso_id: permisoProveedoresLeer.id,
      },
    },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: { rol_id: rolAuditor.id, permiso_id: permisoProveedoresLeer.id },
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
  // `proveedorHomologado` (InduSur) se crea más arriba, antes de las variantes
  // (ver comentario allá — `VarianteSKU.proveedor_id` es NOT NULL). Acá queda
  // solo `proveedorPendiente`, para probar que un proveedor no homologado
  // queda excluido de la selección en una nueva OC / Matriz de Variantes.

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
    update: { publicada: true, is_active: true, creada_por_id: usuarioComprador.id },
    create: {
      id: LISTA_PRECIO_VERSION_ID,
      lista_precio_id: listaPrecioHomologado.id,
      fecha_inicio_vigencia: diasAtras(30),
      variacion_porcentual_maxima: 0,
      requiere_aprobacion: false,
      publicada: true,
      is_active: true,
      creada_por_id: usuarioComprador.id,
    },
  });

  for (const [id, varianteSkuId, precio] of [
    [LISTA_PRECIO_ITEM_CAMISA_1_ID, VARIANTE_CAMISA_TACTICA_1_ID, 15800.0],
    [LISTA_PRECIO_ITEM_CAMISA_2_ID, VARIANTE_CAMISA_TACTICA_2_ID, 16250.0],
    [LISTA_PRECIO_ITEM_BORCEGOS_1_ID, VARIANTE_BORCEGOS_1_ID, 42000.0],
    [LISTA_PRECIO_ITEM_CAMISA_3_ID, VARIANTE_CAMISA_TACTICA_3_ID, 15950.0],
    [LISTA_PRECIO_ITEM_BORCEGOS_2_ID, VARIANTE_BORCEGOS_2_ID, 41500.0],
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

  // ── Módulo H — Nueva versión de Lista de Precios (HU-H2, Sprint 3) ────────
  //
  // Publicación de una nueva ListaPrecioVersion sobre la misma ListaPrecio
  // ancla (`listaPrecioHomologado`), con `fecha_inicio_vigencia` posterior a
  // la de Sprint 2 — pasa a ser la versión vigente resuelta por
  // `resolverListaPrecioVigente()` (publicada = true, sin fecha futura,
  // orden desc). Dentro del umbral normal: `publicada = true` de inmediato,
  // sin paso de aprobación (spec_modulo_H.md §2.3). No reemplaza ni modifica
  // `listaPrecioVersion` (Sprint 2) — HU-H2 es inmutabilidad estricta por
  // versionado, nunca UPDATE sobre una versión ya persistida (spec §3.4).

  const listaPrecioVersion2 = await prisma.listaPrecioVersion.upsert({
    where: { id: LISTA_PRECIO_VERSION_2_ID },
    update: { publicada: true, is_active: true, creada_por_id: usuarioComprador.id },
    create: {
      id: LISTA_PRECIO_VERSION_2_ID,
      lista_precio_id: listaPrecioHomologado.id,
      fecha_inicio_vigencia: diasAtras(2),
      variacion_porcentual_maxima: 4.0,
      requiere_aprobacion: false,
      publicada: true,
      is_active: true,
      creada_por_id: usuarioComprador.id,
    },
  });

  for (const [id, varianteSkuId, precio] of [
    [LISTA_PRECIO_ITEM_V2_CAMISA_1_ID, VARIANTE_CAMISA_TACTICA_1_ID, 16400.0],
    [LISTA_PRECIO_ITEM_V2_CAMISA_2_ID, VARIANTE_CAMISA_TACTICA_2_ID, 16900.0],
    [LISTA_PRECIO_ITEM_V2_BORCEGOS_1_ID, VARIANTE_BORCEGOS_1_ID, 43500.0],
  ] as const) {
    await prisma.listaPrecioItem.upsert({
      where: { id },
      update: { precio_unitario: precio, is_active: true },
      create: {
        id,
        lista_precio_version_id: listaPrecioVersion2.id,
        variante_sku_id: varianteSkuId,
        precio_unitario: precio,
        is_active: true,
      },
    });
  }

  // ── Módulo H — Segundo proveedor HOMOLOGADO (HU-H7, comparativa) ──────────
  //
  // Único propósito: poder ejercitar la comparativa de precios (HU-H7) con
  // más de un proveedor ofreciendo la MISMA variante. Comparte
  // VARIANTE_CAMISA_TACTICA_1_ID (más barato que la vigente de
  // `proveedorHomologado`, 15600 < 16400) y VARIANTE_BORCEGOS_1_ID (más caro,
  // 45200 > 43500) con `listaPrecioVersion2`. `VarianteSKU.proveedor_id` NO
  // cambia (sigue apuntando a `proveedorHomologado` — es el "proveedor
  // habitual" de Módulo A, un campo distinto de "quién más la vende"):
  // `comparativa-precios.service.ts` descubre proveedores candidatos vía
  // `ListaPrecioItem`, nunca vía `VarianteSKU.proveedor_id` (verificado
  // contra `resolverCandidatosPorVariante`).
  const proveedorSegundoHomologado = await prisma.proveedor.upsert({
    where: { id: PROVEEDOR_SEGUNDO_HOMOLOGADO_ID },
    update: { estado: "HOMOLOGADO", is_active: true, deleted_at: null },
    create: {
      id: PROVEEDOR_SEGUNDO_HOMOLOGADO_ID,
      razon_social: "Suministros Tácticos Cuyo S.A.",
      nombre_fantasia: "Tácticos Cuyo",
      cuit: "30-71987654-2",
      condiciones_pago: "30 días",
      categorias: ["Textil Táctico", "Calzado"],
      estado: "HOMOLOGADO",
      contacto_nombre: "Marina Ibáñez",
      contacto_email: "compras@tacticoscuyo.example.com",
      is_active: true,
    },
  });

  const listaPrecioSegundoHomologado = await prisma.listaPrecio.upsert({
    where: { id: LISTA_PRECIO_SEGUNDO_HOMOLOGADO_ID },
    update: {},
    create: {
      id: LISTA_PRECIO_SEGUNDO_HOMOLOGADO_ID,
      proveedor_id: proveedorSegundoHomologado.id,
      is_active: true,
    },
  });

  const listaPrecioVersionSegundo = await prisma.listaPrecioVersion.upsert({
    where: { id: LISTA_PRECIO_VERSION_SEGUNDO_ID },
    update: { publicada: true, is_active: true, creada_por_id: usuarioComprador.id },
    create: {
      id: LISTA_PRECIO_VERSION_SEGUNDO_ID,
      lista_precio_id: listaPrecioSegundoHomologado.id,
      fecha_inicio_vigencia: diasAtras(3),
      variacion_porcentual_maxima: 0,
      requiere_aprobacion: false,
      publicada: true,
      is_active: true,
      creada_por_id: usuarioComprador.id,
    },
  });

  for (const [id, varianteSkuId, precio] of [
    [LISTA_PRECIO_ITEM_SEGUNDO_CAMISA_1_ID, VARIANTE_CAMISA_TACTICA_1_ID, 15600.0], // más barato que 16400 (proveedorHomologado)
    [LISTA_PRECIO_ITEM_SEGUNDO_BORCEGOS_1_ID, VARIANTE_BORCEGOS_1_ID, 45200.0], // más caro que 43500 (proveedorHomologado)
  ] as const) {
    await prisma.listaPrecioItem.upsert({
      where: { id },
      update: { precio_unitario: precio, is_active: true },
      create: {
        id,
        lista_precio_version_id: listaPrecioVersionSegundo.id,
        variante_sku_id: varianteSkuId,
        precio_unitario: precio,
        is_active: true,
      },
    });
  }

  // ── Módulo H — Versión PENDIENTE DE APROBACIÓN + evento de auditoría real ─
  //
  // Publica (vía el service REAL, no un insert directo) una tercera versión
  // sobre la MISMA ListaPrecio de `proveedorHomologado`, con una variación de
  // Camisa 1 muy por encima del umbral crítico (21000 vs. 16400 vigente ≈
  // +28.05% > UMBRAL_VARIACION_CRITICA_PORCENTUAL=20) → queda
  // `publicada = false` / `requiere_aprobacion = true`, y dispara el evento
  // `proveedor:variacion_precio_critica` post-COMMIT, que `audit-log.listener.ts`
  // escribe en el ledger real (`registrarAuditLog`, encadenado SHA-256) — NO
  // se inserta ningún `AuditLog` a mano.
  //
  // Fecha "hoy" (inicio de día UTC) calculada al correr la seed — así, al
  // aprobarla, queda más nueva que `listaPrecioVersion2` (`diasAtras(2)`) y
  // `fecha_inicio_vigencia <= now()`, por lo que pasa a ser la VIGENTE
  // (`resolverListaPrecioVigente()`/`derivarEstadoListaPrecioVersion`). Antes
  // era una fecha fija (2026-01-15) que quedaba vieja apenas pasaba esa
  // fecha real — nunca podía ser vigente tras aprobarse.
  //
  // Idempotente por `(lista_precio_id, requiere_aprobacion=true,
  // publicada=false)`: si ya existe una versión pendiente de aprobación para
  // esta ListaPrecio (fecha "hoy" de una corrida anterior, o ya aprobada en
  // otra corrida), no se publica una segunda — la fecha fija anterior ya no
  // sirve de clave de idempotencia porque cambia en cada corrida. El ledger
  // es append-only — la seed nunca borra ni reescribe filas de `AuditLog`;
  // si la cadena no verifica, solo lo reporta.
  //
  // A3 (auditoría transversal Módulo H, 2026-09-26): esta versión de 1 solo
  // ítem (Camisa 1 = VARIANTE_CAMISA_TACTICA_1_ID, M/Verde) es también el
  // caso que reprodujo el hallazgo A3 — al aprobarla (rol Supervisor de
  // Compras, botón "Aprobar" del historial de `/compras/listas-precios`),
  // pasa a ser la versión más nueva y publicada de `proveedorHomologado`,
  // pero NO incluye Camisa 2 (L/Negro) ni Borcegos 1, que sí tenían precio en
  // `listaPrecioVersion2`. Antes de la corrección de `obtenerVersionVigente()`
  // (`lista-precios.service.ts`), aprobarla dejaba esas dos variantes SIN
  // precio vigente (exactamente el bug que encontró la auditoría). Con la
  // resolución por variante ya corregida, aprobarla es ahora un ejemplo
  // correcto del comportamiento de "delta": Camisa 1 resuelve contra esta
  // versión nueva (21000) y Camisa 2/Borcegos 1 siguen resolviendo contra
  // `listaPrecioVersion2` (16900 / 43500) — se deja la demo tal cual para que
  // siga sirviendo de caso de prueba manual, ya no de regresión.
  const FECHA_LISTA_PRECIO_VERSION_PENDIENTE = new Date();
  FECHA_LISTA_PRECIO_VERSION_PENDIENTE.setUTCHours(0, 0, 0, 0);

  const versionPendienteExistente = await prisma.listaPrecioVersion.findFirst({
    where: {
      lista_precio_id: listaPrecioHomologado.id,
      requiere_aprobacion: true,
      publicada: false,
    },
    select: { id: true },
  });

  if (!versionPendienteExistente) {
    // `audit-log.listener.ts` se registra vía un import() dinámico disparado
    // al crearse el singleton de `domainEventBus` (ver docstring de
    // `domain-event-bus.ts`) — una promesa, no una operación síncrona. Se
    // espera activamente a que el listener quede registrado antes de emitir.
    for (let intento = 0; intento < 50; intento++) {
      if (domainEventBus.listenerCount("proveedor:variacion_precio_critica") > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    await publicarNuevaVersionListaPrecio(
      proveedorHomologado.id,
      FECHA_LISTA_PRECIO_VERSION_PENDIENTE,
      [{ variante_sku_id: VARIANTE_CAMISA_TACTICA_1_ID, precio_unitario: 21000.0 }], // +28.05% vs 16400 → crítico
      usuarioComprador.id,
    );

    // Deja que `colaLedger` drene antes de verificar.
    await new Promise((resolve) => setTimeout(resolve, 300));

    const integridad = await verificarCadenaIntegridad();
    if (!integridad.integra) {
      console.error("[seed] La cadena de AuditLog no verifica tras publicar la versión crítica de HU-H2.", integridad);
    }
  }

  // ── Módulo H — Orden de Compra controlada (HU-H4 V2) ───────────────────────
  //
  // El fixture compartido con H5/G8 representa un único control ya finalizado:
  // H4 V2 deja la OC en RECIBIDA_COMPLETA aunque alguna línea no haya llegado.

  const ordenCompraConfirmada = await prisma.ordenCompra.upsert({
    where: { id: ORDEN_COMPRA_CONFIRMADA_ID },
    update: {
      estado: "RECIBIDA_COMPLETA",
      observaciones: "OC controlada — fixture HU-H4 V2",
      is_active: true,
      deleted_at: null,
    },
    create: {
      id: ORDEN_COMPRA_CONFIRMADA_ID,
      numero_orden: "OC-2026-0001",
      proveedor_id: proveedorHomologado.id,
      estado: "RECIBIDA_COMPLETA",
      fecha_envio: diasAtras(5),
      fecha_confirmacion: diasAtras(4),
      observaciones: "OC controlada — fixture HU-H4 V2",
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

  await prisma.ordenCompraItem.upsert({
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
  // Control único del ítem de Camisa Táctica (18 de 20 solicitadas, con una
  // discrepancia de CANTIDAD). La línea de Borcegos no llegó y se omite, sin
  // RecepcionItem en cero ni saldo funcional. El ID se conserva para H5/G8.

  const recepcionSeed = await prisma.recepcion.upsert({
    where: { id: RECEPCION_SEED_ID },
    update: {
      deposito_destino_id: deposito.id,
      clave_idempotencia: RECEPCION_SEED_ID,
      payload_hash: "ceda5427d257e5ac7cc0c2c486c0d9ad0aea836f3779a16f01d087abd542cbb3",
      observaciones: "Control finalizado HU-H4 V2 — la línea de Borcegos no llegó",
      is_active: true,
      deleted_at: null,
    },
    create: {
      id: RECEPCION_SEED_ID,
      orden_compra_id: ordenCompraConfirmada.id,
      deposito_destino_id: deposito.id,
      clave_idempotencia: RECEPCION_SEED_ID,
      // Marca SHA-256 histórica documentada en la migración HU-H4.
      payload_hash: "ceda5427d257e5ac7cc0c2c486c0d9ad0aea836f3779a16f01d087abd542cbb3",
      numero_remito_proveedor: "REM-0001-00012345",
      fecha_recepcion: diasAtras(2),
      recibida_por_id: usuarioEncargado.id,
      observaciones: "Control finalizado HU-H4 V2 — la línea de Borcegos no llegó",
      is_active: true,
    },
  });

  const recepcionItem1 = await prisma.recepcionItem.upsert({
    where: { id: RECEPCION_ITEM_1_ID },
    update: { cantidad_aceptada: 18 },
    create: {
      id: RECEPCION_ITEM_1_ID,
      recepcion_id: recepcionSeed.id,
      orden_compra_item_id: ordenCompraItem1.id,
      cantidad_recibida: 18,
      cantidad_aceptada: 18,
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
  // separado). Permanece PROVISORIO hasta que H3 cierre la OC; recién entonces
  // G8 recalcula el monto definitivo sobre la cantidad aceptada.

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

  // ── Módulo H — Orden de Compra RECIBIDA_COMPLETA (fixture HU-H9) ───────────
  //
  // OC totalmente recibida contra el proveedor homologado, para poder
  // ejercitar el alta/anulación de Comprobantes de Proveedor (HU-H9 §2.7) de
  // punta a punta: la precondición del alta exige `estado` ∈
  // {RECIBIDA_COMPLETA, CERRADA}. Un único ítem, sin recepción sembrada (el
  // estado ya refleja el resultado final — HU-H9 no lee `RecepcionItem`).

  const ordenCompraRecibida = await prisma.ordenCompra.upsert({
    where: { id: ORDEN_COMPRA_RECIBIDA_ID },
    update: {},
    create: {
      id: ORDEN_COMPRA_RECIBIDA_ID,
      numero_orden: "OC-2026-0002",
      proveedor_id: proveedorHomologado.id,
      estado: "RECIBIDA_COMPLETA",
      fecha_envio: diasAtras(12),
      fecha_confirmacion: diasAtras(11),
      observaciones: "OC recibida — fixture HU-H9 (carga de comprobantes)",
      creada_por_id: usuarioComprador.id,
      is_active: true,
    },
  });

  await prisma.ordenCompraItem.upsert({
    where: { id: ORDEN_COMPRA_RECIBIDA_ITEM_ID },
    update: {},
    create: {
      id: ORDEN_COMPRA_RECIBIDA_ITEM_ID,
      orden_compra_id: ordenCompraRecibida.id,
      variante_sku_id: VARIANTE_BORCEGOS_1_ID,
      cantidad_solicitada: 8,
      precio_unitario: 42000.0,
      is_active: true,
    },
  });

  // ── HU-H4 V2 — OC CONFIRMADA exclusiva para prueba manual ─────────────────
  // No comparte recepciones, evaluaciones ni CxP con los fixtures de H5/G8/H9.
  // Una reejecución no revierte su estado si ya fue recibida; los tests de
  // integración crean sus propias OC aisladas.
  const ordenCompraH4V2Manual = await prisma.ordenCompra.upsert({
    where: { id: ORDEN_COMPRA_H4_V2_MANUAL_ID },
    update: {},
    create: {
      id: ORDEN_COMPRA_H4_V2_MANUAL_ID,
      numero_orden: "OC-2026-0003",
      proveedor_id: proveedorHomologado.id,
      estado: "CONFIRMADA",
      fecha_envio: diasAtras(2),
      fecha_confirmacion: diasAtras(1),
      observaciones: "OC exclusiva para prueba manual HU-H4 V2",
      creada_por_id: usuarioComprador.id,
      is_active: true,
    },
  });

  await prisma.ordenCompraItem.upsert({
    where: { id: ORDEN_COMPRA_H4_V2_MANUAL_ITEM_ID },
    update: {
      cantidad_solicitada: 10,
      precio_unitario: 15800.0,
      is_active: true,
      deleted_at: null,
    },
    create: {
      id: ORDEN_COMPRA_H4_V2_MANUAL_ITEM_ID,
      orden_compra_id: ordenCompraH4V2Manual.id,
      variante_sku_id: VARIANTE_CAMISA_TACTICA_1_ID,
      cantidad_solicitada: 10,
      precio_unitario: 15800.0,
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

  // ── HU-A9 — Fixture de unidad DEVUELTO (reclasificación de devueltos) ────────
  // Una CAMISA_TACTICA_1 devuelta en DEPOSITO_SHOWROOM: item con
  // `estado_destino = "DEVUELTO"` (VENDIDO → DEVUELTO) hace 3 días (create) o
  // refrescado al momento actual (update). Cantidad = 6 unidades: permite
  // probar la DOBLE VALIDACIÓN por umbral (> 5 → ReclasificacionSolicitud
  // PENDIENTE_APROBACION para aprobación de Administrador). El `update`
  // refresca la cabecera con `created_at` actual para que el fixture sea el
  // ÚLTIMO movimiento del par variante+depósito tras re-seed (re-testing
  // después de consumir la unidad en una reclasificación previa). Los
  // movimientos del seed no aplican deltas de stock: las cantidades se
  // siembran directo en `stock_depositos`.
  await prisma.movimientoStock.upsert({
    where: { id: MOVIMIENTO_DEVUELTO_SEED_ID },
    update: {
      deposito_destino_id: depositoShowroom.id,
      tipo_movimiento: "AJUSTE",
      comprobante_referencia: "SEED-DEVUELTO-GARANTIA",
      registrado_por_id: usuarioEncargado.id,
      created_at: new Date(),
      is_active: true,
      items: {
        upsert: {
          where: { id: MOVIMIENTO_DEVUELTO_ITEM_SEED_ID },
          create: {
            id: MOVIMIENTO_DEVUELTO_ITEM_SEED_ID,
            variante_sku_id: VARIANTE_CAMISA_TACTICA_1_ID,
            cantidad: 6,
            estado_origen: "VENDIDO",
            estado_destino: "DEVUELTO",
            motivo: "Devolución por garantía — seed HU-A9",
            is_active: true,
          },
          update: {
            variante_sku_id: VARIANTE_CAMISA_TACTICA_1_ID,
            cantidad: 6,
            estado_origen: "VENDIDO",
            estado_destino: "DEVUELTO",
            motivo: "Devolución por garantía — seed HU-A9",
            is_active: true,
          },
        },
      },
    },
    create: {
      id: MOVIMIENTO_DEVUELTO_SEED_ID,
      deposito_destino_id: depositoShowroom.id,
      tipo_movimiento: "AJUSTE",
      comprobante_referencia: "SEED-DEVUELTO-GARANTIA",
      registrado_por_id: usuarioEncargado.id,
      created_at: diasAtras(3),
      is_active: true,
      items: {
        create: {
          id: MOVIMIENTO_DEVUELTO_ITEM_SEED_ID,
          variante_sku_id: VARIANTE_CAMISA_TACTICA_1_ID,
          cantidad: 6,
          estado_origen: "VENDIDO",
          estado_destino: "DEVUELTO",
          motivo: "Devolución por garantía — seed HU-A9",
          is_active: true,
        },
      },
    },
  });

  // ── Módulo C — Clientes de prueba (Sprint 3) ──────────────────────────────
  //
  // HU-C1/C3/C4: cliente estándar con dirección FACTURACION + ENVIO y su
  // ConsentimientoCliente inicial — toda alta exige uno en la misma
  // transacción (spec_modulo_C.md §2.1); acá se siembra por separado porque
  // no hay transacción real en este script, pero la relación es la misma.
  const clienteJuanPerez = await prisma.cliente.upsert({
    where: { id: CLIENTE_JUAN_PEREZ_ID },
    update: {},
    create: {
      id: CLIENTE_JUAN_PEREZ_ID,
      dni: "30123456",
      nombre: "Juan Pérez",
      telefono: "3874001234",
      email: "juan.perez@example.com",
      canal_preferido: "WHATSAPP",
      segmento: "MINORISTA",
      is_active: true,
    },
  });

  await prisma.direccionCliente.upsert({
    where: { id: DIRECCION_JUAN_PEREZ_FACTURACION_ID },
    update: {},
    create: {
      id: DIRECCION_JUAN_PEREZ_FACTURACION_ID,
      cliente_id: clienteJuanPerez.id,
      rotulo: "Casa",
      tipo: "FACTURACION",
      direccion_completa: "Belgrano 123, Salta Capital",
      is_active: true,
    },
  });

  await prisma.direccionCliente.upsert({
    where: { id: DIRECCION_JUAN_PEREZ_ENVIO_ID },
    update: {},
    create: {
      id: DIRECCION_JUAN_PEREZ_ENVIO_ID,
      cliente_id: clienteJuanPerez.id,
      rotulo: "Depósito",
      tipo: "ENVIO",
      direccion_completa: "Ruta 9 Km 4, Salta",
      is_active: true,
    },
  });

  await prisma.consentimientoCliente.upsert({
    where: { id: CONSENTIMIENTO_JUAN_PEREZ_ID },
    update: {},
    create: {
      id: CONSENTIMIENTO_JUAN_PEREZ_ID,
      cliente_id: clienteJuanPerez.id,
      alcance: "AMBOS",
      finalidad: "Venta asistida y comunicaciones comerciales",
      fecha_consentimiento: diasAtras(10),
      is_active: true,
    },
  });

  // HU-C5: posible duplicado de `clienteJuanPerez` — mismo nombre/teléfono
  // aproximado, DNI DISTINTO (no confundir con el caso de DNI idéntico, que
  // HU-C1 resuelve por sí sola sin necesitar un caso de seed especial). Mismos
  // valores de ejemplo que usa spec_modulo_C.md §2.1 en su respuesta de
  // muestra de "posibles_duplicados".
  const clienteJuanPerezDuplicado = await prisma.cliente.upsert({
    where: { id: CLIENTE_JUAN_PEREZ_DUPLICADO_ID },
    update: {},
    create: {
      id: CLIENTE_JUAN_PEREZ_DUPLICADO_ID,
      dni: "30987654",
      nombre: "Juan Perez",
      telefono: "3874001234",
      segmento: "MINORISTA",
      is_active: true,
    },
  });

  await prisma.consentimientoCliente.upsert({
    where: { id: CONSENTIMIENTO_JUAN_PEREZ_DUPLICADO_ID },
    update: {},
    create: {
      id: CONSENTIMIENTO_JUAN_PEREZ_DUPLICADO_ID,
      cliente_id: clienteJuanPerezDuplicado.id,
      alcance: "VENTA_ASISTIDA",
      finalidad: "Venta asistida",
      fecha_consentimiento: diasAtras(1),
      is_active: true,
    },
  });

  // HU-C5: par primario/secundario ya fusionado — ejercita
  // `Cliente.fusionado_en_id` (autorreferencial, onDelete: Restrict) y el
  // patrón de baja lógica con `deletion_reason: "duplicado"` fijo, inmutable
  // (spec §2.5/§3.2). El primario no cambia de estado por la fusión.
  const clienteMariaGomezPrimario = await prisma.cliente.upsert({
    where: { id: CLIENTE_MARIA_GOMEZ_PRIMARIO_ID },
    update: {},
    create: {
      id: CLIENTE_MARIA_GOMEZ_PRIMARIO_ID,
      dni: "27555111",
      nombre: "María Gómez",
      telefono: "3874002222",
      email: "maria.gomez@example.com",
      canal_preferido: "EMAIL",
      segmento: "MINORISTA",
      is_active: true,
    },
  });

  await prisma.consentimientoCliente.upsert({
    where: { id: CONSENTIMIENTO_MARIA_GOMEZ_PRIMARIO_ID },
    update: {},
    create: {
      id: CONSENTIMIENTO_MARIA_GOMEZ_PRIMARIO_ID,
      cliente_id: clienteMariaGomezPrimario.id,
      alcance: "AMBOS",
      finalidad: "Venta asistida y comunicaciones comerciales",
      fecha_consentimiento: diasAtras(20),
      is_active: true,
    },
  });

  const clienteMariaGomezFusionado = await prisma.cliente.upsert({
    where: { id: CLIENTE_MARIA_GOMEZ_FUSIONADO_ID },
    update: {
      fusionado_en_id: clienteMariaGomezPrimario.id,
      is_active: false,
      deleted_by: usuarioAdmin.id,
      deletion_reason: "duplicado",
    },
    create: {
      id: CLIENTE_MARIA_GOMEZ_FUSIONADO_ID,
      dni: "27555222",
      nombre: "Maria Gomez",
      telefono: "3874002222",
      segmento: "MINORISTA",
      fusionado_en_id: clienteMariaGomezPrimario.id,
      is_active: false,
      deleted_at: diasAtras(5),
      deleted_by: usuarioAdmin.id,
      deletion_reason: "duplicado",
    },
  });

  await prisma.consentimientoCliente.upsert({
    where: { id: CONSENTIMIENTO_MARIA_GOMEZ_FUSIONADO_ID },
    update: {},
    create: {
      id: CONSENTIMIENTO_MARIA_GOMEZ_FUSIONADO_ID,
      cliente_id: clienteMariaGomezFusionado.id,
      alcance: "VENTA_ASISTIDA",
      finalidad: "Venta asistida",
      fecha_consentimiento: diasAtras(25),
      is_active: true,
    },
  });

  // ── Módulo B (Sprint 3) — Usuarios de prueba ────────────────────────────────
  const usuarioCajero = await prisma.usuario.upsert({
    where: { nombre_usuario: "cajero.seed" },
    update: {},
    create: {
      id: USUARIO_CAJERO_SEED_ID,
      nombre_usuario: "cajero.seed",
      email: "cajero.seed@erp-swat.local",
      password_hash: passwordSeed.hash,
      password_salt: passwordSeed.salt,
      nombre_completo: "Cajero POS Seed (Módulo B)",
      estado: "ACTIVO",
      is_active: true,
    },
  });

  const usuarioSupervisorVentas = await prisma.usuario.upsert({
    where: { nombre_usuario: "supervisor.ventas.seed" },
    update: {},
    create: {
      id: USUARIO_SUPERVISOR_VENTAS_SEED_ID,
      nombre_usuario: "supervisor.ventas.seed",
      email: "supervisor.ventas.seed@erp-swat.local",
      password_hash: passwordSeed.hash,
      password_salt: passwordSeed.salt,
      nombre_completo: "Supervisor de Ventas Seed (Módulo B)",
      estado: "ACTIVO",
      is_active: true,
    },
  });

  // ── Módulo B (Sprint 3) — Roles operativos de Ventas (HU-B8) ────────────────
  // Agrupan los permisos `ventas:*` ya sembrados más arriba — ningún permiso
  // nuevo se crea acá (ver ROL_CAJERO_POS_ID / ROL_SUPERVISOR_VENTAS_ID para
  // el detalle del mapeo confirmado y la nota sobre la superposición con
  // spec_modulo_B.md §2.1/§2.3).
  const rolCajeroPos = await prisma.rol.upsert({
    where: { id: ROL_CAJERO_POS_ID },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: {
      id: ROL_CAJERO_POS_ID,
      nombre: "CAJERO_POS",
      descripcion: "Operación de punto de venta (Módulo B) — cobro de mostrador, turno de caja y cotizaciones",
    },
  });

  const rolSupervisorVentas = await prisma.rol.upsert({
    where: { id: ROL_SUPERVISOR_VENTAS_ID },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: {
      id: ROL_SUPERVISOR_VENTAS_ID,
      nombre: "SUPERVISOR_VENTAS",
      descripcion: "Supervisión del circuito de Ventas (Módulo B) — autoriza excepciones de descuento/crédito, anula pedidos y consulta el log operativo",
    },
  });

  const permisosCajeroPos = [
    PERMISO_VENTAS_REGISTRAR_MOSTRADOR_ID,
    PERMISO_VENTAS_GESTIONAR_TURNO_CAJA_ID,
    PERMISO_VENTAS_EMITIR_COTIZACION_ID,
    PERMISO_VENTAS_APLICAR_DESCUENTO_MARGEN_ID,
    PERMISO_VENTAS_GESTIONAR_CUENTA_CORRIENTE_ID,
    PERMISO_VENTAS_LEER_ID,
  ];

  for (const permiso_id of permisosCajeroPos) {
    await prisma.rolPermiso.upsert({
      where: { rol_id_permiso_id: { rol_id: rolCajeroPos.id, permiso_id } },
      update: REACTIVAR_REFERENCIA_RBAC,
      create: { rol_id: rolCajeroPos.id, permiso_id },
    });
  }

  // SUPERVISOR_VENTAS agrupa todo lo de CAJERO_POS más sus 5 permisos
  // exclusivos (el 5.° es `ventas:gestionar_lista_precios`, HU-B9 §2.9).
  const permisosSupervisorVentas = [
    ...permisosCajeroPos,
    PERMISO_VENTAS_AUTORIZAR_EXCEPCION_DESCUENTO_ID,
    PERMISO_VENTAS_AUTORIZAR_EXCEPCION_CREDITO_ID,
    PERMISO_VENTAS_ANULAR_PEDIDO_ID,
    PERMISO_VENTAS_LEER_LOG_OPERATIVO_ID,
    PERMISO_VENTAS_GESTIONAR_LISTA_PRECIOS_ID,
  ];

  for (const permiso_id of permisosSupervisorVentas) {
    await prisma.rolPermiso.upsert({
      where: { rol_id_permiso_id: { rol_id: rolSupervisorVentas.id, permiso_id } },
      update: REACTIVAR_REFERENCIA_RBAC,
      create: { rol_id: rolSupervisorVentas.id, permiso_id },
    });
  }

  await prisma.usuarioRol.upsert({
    where: {
      usuario_id_rol_id: {
        usuario_id: usuarioCajero.id,
        rol_id: rolCajeroPos.id,
      },
    },
    update: {},
    create: {
      id: USUARIO_ROL_CAJERO_ID,
      usuario_id: usuarioCajero.id,
      rol_id: rolCajeroPos.id,
    },
  });

  await prisma.usuarioRol.upsert({
    where: {
      usuario_id_rol_id: {
        usuario_id: usuarioSupervisorVentas.id,
        rol_id: rolSupervisorVentas.id,
      },
    },
    update: {},
    create: {
      id: USUARIO_ROL_SUPERVISOR_VENTAS_ID,
      usuario_id: usuarioSupervisorVentas.id,
      rol_id: rolSupervisorVentas.id,
    },
  });

  // ── Módulo B — Turno de caja abierto (HU-B2 §2.2) ───────────────────────────
  const turnoCajaAbierto = await prisma.turnoCaja.upsert({
    where: { id: TURNO_CAJA_ABIERTO_ID },
    update: {},
    create: {
      id: TURNO_CAJA_ABIERTO_ID,
      usuario_id: usuarioCajero.id,
      fondo_fijo_inicial: 5000.0,
      fecha_apertura: diasAtras(1),
      is_active: true,
    },
  });

  // ── Módulo B — Venta de mostrador completa (HU-B1 §2.1), con cobro
  // multimedio y comprobante fiscal simulado (HU-B7 §2.7), asociada a
  // `clienteJuanPerez` para que HU-C7 (spec_modulo_C.md §2.7) tenga
  // historial de compras real, no vacío, al consultarlo por DNI ─────────────
  const pedidoVentaMostrador = await prisma.pedidoVenta.upsert({
    where: { id: PEDIDO_VENTA_MOSTRADOR_ID },
    update: {},
    create: {
      id: PEDIDO_VENTA_MOSTRADOR_ID,
      numero_venta: "V-2026-000001",
      cliente_id: clienteJuanPerez.id,
      turno_caja_id: turnoCajaAbierto.id,
      estado: "FACTURADO",
      total: 45000.0,
      fecha_facturacion: diasAtras(2),
      registrado_por_id: usuarioCajero.id,
      is_active: true,
    },
  });

  await prisma.pedidoVentaItem.upsert({
    where: { id: PEDIDO_VENTA_MOSTRADOR_ITEM_ID },
    update: {},
    create: {
      id: PEDIDO_VENTA_MOSTRADOR_ITEM_ID,
      pedido_venta_id: pedidoVentaMostrador.id,
      // Camisa Táctica 2 (L, Negro, HOMBRE, Manga Corta) — stock sembrado en
      // el depósito central (`STOCK_CT2_CENTRAL_ID`, 18 unidades).
      variante_sku_id: VARIANTE_CAMISA_TACTICA_2_ID,
      cantidad: 1,
      precio_unitario: 45000.0,
      // Venta 100% de mostrador sin cotización previa: `reserva_id` queda
      // nulo (spec_modulo_B.md §2.1, "flujo de egreso directo" de Módulo A).
      cantidad_facturada: 1,
      cantidad_entregada: 1,
      is_active: true,
    },
  });

  // Cobro multimedio real (criterio de aceptación explícito de HU-B1 §2.1):
  // dos medios combinados que suman exactamente el total de la venta.
  await prisma.ventaMedioPago.upsert({
    where: { id: VENTA_MEDIO_PAGO_EFECTIVO_ID },
    update: {},
    create: {
      id: VENTA_MEDIO_PAGO_EFECTIVO_ID,
      pedido_venta_id: pedidoVentaMostrador.id,
      medio: "EFECTIVO",
      importe: 20000.0,
      is_active: true,
    },
  });

  await prisma.ventaMedioPago.upsert({
    where: { id: VENTA_MEDIO_PAGO_TRANSFERENCIA_ID },
    update: {},
    create: {
      id: VENTA_MEDIO_PAGO_TRANSFERENCIA_ID,
      pedido_venta_id: pedidoVentaMostrador.id,
      medio: "TRANSFERENCIA",
      importe: 25000.0,
      referencia: "OP-887654",
      is_active: true,
    },
  });

  // HU-B7 §2.7: CAE y QR enteramente simulados, generados localmente — SIN
  // ningún campo que sugiera una llamada externa real a AFIP (nota inicial
  // de spec_modulo_B.md). Sin bloque de soft delete (spec §3.4).
  await prisma.comprobanteFiscal.upsert({
    where: { id: COMPROBANTE_FISCAL_MOSTRADOR_ID },
    update: {},
    create: {
      id: COMPROBANTE_FISCAL_MOSTRADOR_ID,
      pedido_venta_id: pedidoVentaMostrador.id,
      tipo_comprobante: "FACTURA_B",
      cae_simulado: "68031598274563",
      qr_data_url: "data:image/png;base64,SIMULADO-SEED-NO-AFIP==",
      es_simulado: true,
      monto_total: 45000.0,
      emitido_por_id: usuarioCajero.id,
    },
  });

  // ── Módulo B — Presupuesto con reserva de stock (HU-B3 §2.3) + conversión
  // a PedidoVenta, cotización institucional de gran volumen sobre
  // `clienteMariaGomezPrimario`. `origen_reserva: "LICITACION"` usa el enum
  // `OrigenReserva` de Módulo A TAL COMO EXISTE HOY, sin renombrar (nota
  // inicial de spec_modulo_B.md, decisión ya tomada por el equipo) ─────────
  // `fecha_expiracion` = `vigencia_hasta` del Presupuesto (diasAtras(-4)):
  // con el cron de HU-A10 Rev. 3 (`fecha_expiracion <= now()`), el valor
  // anterior (inicio + 72h = "ahora") liberaba la reserva apenas corría y
  // dejaba huérfanos al Presupuesto y al PedidoVenta de licitación. Va
  // también en `update` para corregir bases ya sembradas al re-correr (no
  // "des-libera" una reserva que el cron ya haya cerrado: en ese caso hay que
  // resetear `fecha_fin_reserva` a mano).
  const reservaPresupuestoLicitacion = await prisma.reserva.upsert({
    where: { id: RESERVA_PRESUPUESTO_LICITACION_ID },
    update: { fecha_expiracion: diasAtras(-4) },
    create: {
      id: RESERVA_PRESUPUESTO_LICITACION_ID,
      // Borcegos 1 (42, Negro, HOMBRE, Combate) — stock sembrado en el
      // depósito central (`STOCK_B1_CENTRAL_ID`, 30 unidades).
      variante_sku_id: VARIANTE_BORCEGOS_1_ID,
      deposito_id: deposito.id,
      cantidad: 10,
      fecha_inicio_reserva: diasAtras(3),
      fecha_expiracion: diasAtras(-4),
      motivo: "Cotización institucional — Presupuesto Módulo B (HU-B3)",
      origen_reserva: "LICITACION",
      registrado_por_id: usuarioCajero.id,
      is_active: true,
    },
  });

  const presupuestoLicitacion = await prisma.presupuesto.upsert({
    where: { id: PRESUPUESTO_LICITACION_ID },
    update: {},
    create: {
      id: PRESUPUESTO_LICITACION_ID,
      cliente_id: clienteMariaGomezPrimario.id,
      estado: "EMITIDO",
      vigencia_dias: 7,
      // Emitido diasAtras(3) + 7 días de vigencia = vence dentro de 4 días.
      vigencia_hasta: diasAtras(-4),
      condiciones_comerciales:
        "Cotización institucional — pago contra entrega",
      creado_por_id: usuarioCajero.id,
      is_active: true,
    },
  });

  await prisma.presupuestoItem.upsert({
    where: { id: PRESUPUESTO_LICITACION_ITEM_ID },
    update: {},
    create: {
      id: PRESUPUESTO_LICITACION_ITEM_ID,
      presupuesto_id: presupuestoLicitacion.id,
      variante_sku_id: VARIANTE_BORCEGOS_1_ID,
      cantidad: 10,
      precio_cotizado: 38000.0,
      reserva_id: reservaPresupuestoLicitacion.id,
      is_active: true,
    },
  });

  // Conversión a PedidoVenta (estado RESERVADO — todavía sin facturar ni
  // cobrar, spec §3.1): reutiliza la MISMA Reserva del PresupuestoItem
  // origen, sin congelar stock una segunda vez (spec §2.3/§3.2).
  const pedidoVentaLicitacion = await prisma.pedidoVenta.upsert({
    where: { id: PEDIDO_VENTA_LICITACION_ID },
    update: {},
    create: {
      id: PEDIDO_VENTA_LICITACION_ID,
      numero_venta: "V-2026-000002",
      cliente_id: clienteMariaGomezPrimario.id,
      presupuesto_origen_id: presupuestoLicitacion.id,
      estado: "RESERVADO",
      total: 380000.0,
      registrado_por_id: usuarioCajero.id,
      is_active: true,
    },
  });

  await prisma.pedidoVentaItem.upsert({
    where: { id: PEDIDO_VENTA_LICITACION_ITEM_ID },
    update: {},
    create: {
      id: PEDIDO_VENTA_LICITACION_ITEM_ID,
      pedido_venta_id: pedidoVentaLicitacion.id,
      variante_sku_id: VARIANTE_BORCEGOS_1_ID,
      cantidad: 10,
      precio_unitario: 38000.0,
      reserva_id: reservaPresupuestoLicitacion.id,
      is_active: true,
    },
  });

  // ── Módulo B — Segundo PedidoVenta de `clienteJuanPerez` (HU-B3 §3.1,
  // entrega parcial) con un ítem en espera de autorización (HU-B4 §2.4).
  // Ítem A ya facturado por completo pero con remito parcial
  // (`cantidad_entregada` < `cantidad`); Ítem B bloqueado pendiente de que
  // un Supervisor de Ventas autorice el descuento/precio fuera de margen —
  // por eso avanza en 0 tanto en facturación como en entrega ────────────────
  const pedidoVentaRemitoParcial = await prisma.pedidoVenta.upsert({
    where: { id: PEDIDO_VENTA_REMITO_PARCIAL_ID },
    update: {},
    create: {
      id: PEDIDO_VENTA_REMITO_PARCIAL_ID,
      numero_venta: "V-2026-000003",
      cliente_id: clienteJuanPerez.id,
      turno_caja_id: turnoCajaAbierto.id,
      estado: "REMITO_EMITIDO",
      total: 413000.0,
      fecha_facturacion: diasAtras(1),
      registrado_por_id: usuarioCajero.id,
      is_active: true,
    },
  });

  await prisma.pedidoVentaItem.upsert({
    where: { id: PEDIDO_VENTA_REMITO_PARCIAL_ITEM_ENTREGA_ID },
    update: {},
    create: {
      id: PEDIDO_VENTA_REMITO_PARCIAL_ITEM_ENTREGA_ID,
      pedido_venta_id: pedidoVentaRemitoParcial.id,
      variante_sku_id: VARIANTE_CAMISA_TACTICA_1_ID,
      cantidad: 10,
      precio_unitario: 16400.0,
      cantidad_facturada: 10,
      cantidad_entregada: 6,
      is_active: true,
    },
  });

  await prisma.pedidoVentaItem.upsert({
    where: { id: PEDIDO_VENTA_REMITO_PARCIAL_ITEM_AUTORIZACION_ID },
    update: {},
    create: {
      id: PEDIDO_VENTA_REMITO_PARCIAL_ITEM_AUTORIZACION_ID,
      pedido_venta_id: pedidoVentaRemitoParcial.id,
      variante_sku_id: VARIANTE_BORCEGOS_2_ID,
      cantidad: 6,
      precio_unitario: 41500.0,
      requiere_autorizacion: true,
      autorizado_por_id: null,
      cantidad_facturada: 0,
      cantidad_entregada: 0,
      is_active: true,
    },
  });

  // ── Módulo B — Cuenta corriente de `clienteJuanPerez` (HU-B5 §2.5).
  // Montos idénticos al ejemplo de respuesta `200 OK` de spec_modulo_B.md
  // §2.5 (límite 500000.00 / saldo 120000.00 → disponible 380000.00) ───────
  const cuentaCorrienteJuanPerez = await prisma.cuentaCorrienteCliente.upsert({
    where: { id: CUENTA_CORRIENTE_JUAN_PEREZ_ID },
    update: {},
    create: {
      id: CUENTA_CORRIENTE_JUAN_PEREZ_ID,
      cliente_id: clienteJuanPerez.id,
      limite_credito_autorizado: 500000.0,
      saldo_actual: 120000.0,
      is_active: true,
    },
  });

  // Operación APROBADA: dentro del disponible (45000.00 < 380000.00),
  // asociada a la venta de mostrador ya facturada.
  await prisma.cuentaCorrienteOperacion.upsert({
    where: { id: CUENTA_CORRIENTE_OPERACION_APROBADA_ID },
    update: {},
    create: {
      id: CUENTA_CORRIENTE_OPERACION_APROBADA_ID,
      cuenta_corriente_id: cuentaCorrienteJuanPerez.id,
      pedido_venta_id: pedidoVentaMostrador.id,
      monto: 45000.0,
      estado: "APROBADA",
      autorizado_por_id: null,
      is_active: true,
    },
  });

  // Operación RETENIDA: excede el disponible (413000.00 > 380000.00) — caso
  // real de espera de autorización del Supervisor de Ventas, sin resolver
  // (`autorizado_por_id: null`), asociada al PedidoVenta con remito parcial.
  await prisma.cuentaCorrienteOperacion.upsert({
    where: { id: CUENTA_CORRIENTE_OPERACION_RETENIDA_ID },
    update: {},
    create: {
      id: CUENTA_CORRIENTE_OPERACION_RETENIDA_ID,
      cuenta_corriente_id: cuentaCorrienteJuanPerez.id,
      pedido_venta_id: pedidoVentaRemitoParcial.id,
      monto: 413000.0,
      estado: "RETENIDA",
      autorizado_por_id: null,
      is_active: true,
    },
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Sprint 4 — Módulo E (E-commerce), HU-B9 y ConfiguracionSistema (D.4)
  // ══════════════════════════════════════════════════════════════════════════

  // ── Usuario de sistema "Canal Web" (spec_modulo_E.md §2.2) ──────────────────
  // Registrante de los PedidoVenta de canal WEB. Contraseña aleatoria que no
  // se persiste ni se imprime en ningún lado: la cuenta existe como
  // responsable trazable (RULES.md Regla N.° 2), no para iniciar sesión.
  const passwordCanalWeb = await hashPassword(randomBytes(32).toString("hex"));
  const usuarioCanalWeb = await prisma.usuario.upsert({
    where: { nombre_usuario: "canal.web.sistema" },
    update: {},
    create: {
      id: USUARIO_CANAL_WEB_ID,
      nombre_usuario: "canal.web.sistema",
      email: "canal.web.sistema@erp-swat.local",
      password_hash: passwordCanalWeb.hash,
      password_salt: passwordCanalWeb.salt,
      nombre_completo: "Canal Web (usuario de sistema — Módulo E)",
      estado: "ACTIVO",
      is_active: true,
    },
  });

  // ── HU-E10 — permisos `ecommerce:*` (matriz de spec_modulo_E.md §2.10) ──────
  // `ventas:validar_identidad_cliente_web` (§2.8) se siembra para el rol VENDEDOR.
  await Promise.all(
    (
      [
        [PERMISO_ECOMMERCE_GESTIONAR_CATALOGO_ID, "ecommerce:gestionar_catalogo", "Alta/edición del contenido web y visibilidad de productos — exclusivo Administrador E-commerce (HU-E5/HU-E11)"],
        [PERMISO_ECOMMERCE_GESTIONAR_CUPONES_ID, "ecommerce:gestionar_cupones", "Alta, edición y baja de cupones de descuento — exclusivo Administrador E-commerce (HU-E4)"],
        [PERMISO_ECOMMERCE_ANULAR_ORDEN_NO_ABONADA_ID, "ecommerce:anular_orden_no_abonada", "Anular manualmente una orden web no abonada — exclusivo Administrador E-commerce (HU-E7)"],
        [PERMISO_ECOMMERCE_CANCELAR_PEDIDO_PAGADO_ID, "ecommerce:cancelar_pedido_pagado", "Cancelar un pedido web pagado antes de su entrega — exclusivo Administrador E-commerce (HU-E13)"],
        [PERMISO_ECOMMERCE_LEER_COLA_PREPARACION_ID, "ecommerce:leer_cola_preparacion", "Consultar la cola de preparación Click & Collect — Administrador E-commerce y Operador de Pick & Pack (HU-E12; priorizar es ecommerce:priorizar_cola)"],
        [PERMISO_ECOMMERCE_PREPARAR_PEDIDO_ID, "ecommerce:preparar_pedido", "Tomar, confirmar ítems por escaneo y completar la preparación de un pedido — exclusivo Operador de Pick & Pack (HU-E12)"],
        [PERMISO_ECOMMERCE_VALIDAR_RETIRO_QR_ID, "ecommerce:validar_retiro_qr", "Validar el retiro Click & Collect por QR + DNI — exclusivo Operador de Pick & Pack (HU-E12)"],
        [PERMISO_ECOMMERCE_PRIORIZAR_COLA_ID, "ecommerce:priorizar_cola", "Priorizar manualmente el orden de la cola de preparación Click & Collect — exclusivo Administrador E-commerce (HU-E12)"],
        [PERMISO_ECOMMERCE_LEER_HISTORIAL_ORDENES_ID, "ecommerce:leer_historial_ordenes", "Consultar el historial de órdenes web de todos los clientes — exclusivo Administrador E-commerce (HU-E10)"],
        [PERMISO_ECOMMERCE_EXPORTAR_METRICAS_ID, "ecommerce:exportar_metricas", "Exportar métricas del canal web — exclusivo Administrador E-commerce (HU-E10; endpoint sin contrato todavía, spec §5)"],
        [PERMISO_ECOMMERCE_SOLICITAR_ACCESO_LOG_PAGOS_ID, "ecommerce:solicitar_acceso_log_pagos", "Solicitar acceso al log de pagos, sujeto a aprobación — Administrador E-commerce (HU-E6; mecanismo de aprobación sin definir, spec §2.6)"],
      ] as const
    ).map(([id, codigo, descripcion]) =>
      prisma.permiso.upsert({
        where: { id },
        update: REACTIVAR_REFERENCIA_RBAC,
        create: { id, codigo, descripcion, modulo: "MODULO_E" },
      }),
    ),
  );

  // ── HU-E10 — roles de e-commerce ────────────────────────────────────────────
  const rolAdministradorEcommerce = await prisma.rol.upsert({
    where: { id: ROL_ADMINISTRADOR_ECOMMERCE_ID },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: {
      id: ROL_ADMINISTRADOR_ECOMMERCE_ID,
      nombre: "ADMINISTRADOR_ECOMMERCE",
      descripcion: "Administración del canal web (Módulo E) — catálogo, cupones, anulaciones/cancelaciones, historial y priorización de la cola",
    },
  });

  const rolOperadorPickPack = await prisma.rol.upsert({
    where: { id: ROL_OPERADOR_PICK_PACK_ID },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: {
      id: ROL_OPERADOR_PICK_PACK_ID,
      nombre: "OPERADOR_PICK_PACK",
      descripcion: "Preparación y entrega Click & Collect (Módulo E) — sin acceso a datos de facturación ni de pago",
    },
  });

  const permisosPorRolEcommerce: Array<[string, string[]]> = [
    [
      rolAdministradorEcommerce.id,
      [
        PERMISO_ECOMMERCE_GESTIONAR_CATALOGO_ID,
        PERMISO_ECOMMERCE_GESTIONAR_CUPONES_ID,
        PERMISO_ECOMMERCE_ANULAR_ORDEN_NO_ABONADA_ID,
        PERMISO_ECOMMERCE_CANCELAR_PEDIDO_PAGADO_ID,
        PERMISO_ECOMMERCE_LEER_COLA_PREPARACION_ID,
        PERMISO_ECOMMERCE_PRIORIZAR_COLA_ID,
        PERMISO_ECOMMERCE_LEER_HISTORIAL_ORDENES_ID,
        PERMISO_ECOMMERCE_EXPORTAR_METRICAS_ID,
        PERMISO_ECOMMERCE_SOLICITAR_ACCESO_LOG_PAGOS_ID,
      ],
    ],
    [
      rolOperadorPickPack.id,
      [
        PERMISO_ECOMMERCE_LEER_COLA_PREPARACION_ID,
        PERMISO_ECOMMERCE_PREPARAR_PEDIDO_ID,
        PERMISO_ECOMMERCE_VALIDAR_RETIRO_QR_ID,
      ],
    ],
  ];

  for (const [rol_id, permisos] of permisosPorRolEcommerce) {
    for (const permiso_id of permisos) {
      await prisma.rolPermiso.upsert({
        where: { rol_id_permiso_id: { rol_id, permiso_id } },
        update: REACTIVAR_REFERENCIA_RBAC,
        create: { rol_id, permiso_id },
      });
    }
  }

  // ── HU-E10 — un usuario de prueba por rol ───────────────────────────────────
  const usuarioAdminEcommerce = await prisma.usuario.upsert({
    where: { nombre_usuario: "admin.ecommerce.seed" },
    update: {},
    create: {
      id: USUARIO_ADMIN_ECOMMERCE_SEED_ID,
      nombre_usuario: "admin.ecommerce.seed",
      email: "admin.ecommerce.seed@erp-swat.local",
      password_hash: passwordSeed.hash,
      password_salt: passwordSeed.salt,
      nombre_completo: "Administrador E-commerce Seed (Módulo E)",
      estado: "ACTIVO",
      is_active: true,
    },
  });

  const usuarioOperadorPickPack = await prisma.usuario.upsert({
    where: { nombre_usuario: "operador.pickpack.seed" },
    update: {},
    create: {
      id: USUARIO_OPERADOR_PICK_PACK_SEED_ID,
      nombre_usuario: "operador.pickpack.seed",
      email: "operador.pickpack.seed@erp-swat.local",
      password_hash: passwordSeed.hash,
      password_salt: passwordSeed.salt,
      nombre_completo: "Operador de Pick & Pack Seed (Módulo E)",
      estado: "ACTIVO",
      is_active: true,
    },
  });

  for (const [id, usuario_id, rol_id] of [
    [USUARIO_ROL_ADMIN_ECOMMERCE_ID, usuarioAdminEcommerce.id, rolAdministradorEcommerce.id],
    [USUARIO_ROL_OPERADOR_PICK_PACK_ID, usuarioOperadorPickPack.id, rolOperadorPickPack.id],
  ] as const) {
    await prisma.usuarioRol.upsert({
      where: { usuario_id_rol_id: { usuario_id, rol_id } },
      update: {},
      create: { id, usuario_id, rol_id },
    });
  }

  // ── D.4 — ConfiguracionSistema (spec_modulo_D.md §6.2) ──────────────────────
  // Solo las 4 claves definidas en la tabla de §6.2, con sus valores de
  // ejemplo (el depósito del canal web es el Showroom real de este seed).
  // `update: {}`: re-correr el seed nunca pisa un valor ya ajustado por un
  // Administrador.
  //
  // PENDIENTES — NO sembradas a propósito (ninguna spec las define todavía;
  // dependen de una decisión del owner de Módulo D):
  //   - umbral de arqueo ciego (HU-B2) y % máximo de descuento por perfil
  //     (HU-B4) — spec_modulo_B.md §5;
  //   - intentos fallidos de login de Cliente Web (HU-E8) — spec_modulo_E.md §5.
  // Las tres claves de fotos de HU-E11 ya se siembran abajo (spec E §2.11,
  // Revisión 6; valores pendientes de validar con el PO y con el owner de D).
  for (const [clave, valor, descripcion, modulo] of [
    ["ECOMMERCE_DEPOSITO_CANAL_WEB_ID", depositoShowroom.id, "Depósito cuyo stock se publica en el canal web (HU-E1) y donde se ubica físicamente la preparación (HU-E12)", "E"],
    ["ECOMMERCE_CHECKOUT_TTL_HORAS", "1", "TTL en horas de la reserva de stock del checkout web (HU-E1 → ttl_horas de HU-A10)", "E"],
    ["ECOMMERCE_CUENTA_WEB_MAX_INTENTOS", "5", "Intentos fallidos antes de bloquear temporalmente una cuenta web (HU-E8)", "E"],
    ["ECOMMERCE_CUENTA_WEB_BLOQUEO_MINUTOS", "15", "Duración en minutos del bloqueo temporal de una cuenta web (HU-E8)", "E"],
    ["ECOMMERCE_PLAZO_RETIRO_DIAS", "10", "Días desde LISTO_PARA_RETIRO hasta VENCIDO_SIN_RETIRO (HU-E13)", "E"],
    ["ECOMMERCE_CARRITO_ABANDONADO_DIAS", "7", "Días sin actividad (carritos_web.updated_at) tras los que un carrito web se da de baja lógica por abandono (HU-E5; valor 7 pendiente de validar con el PO)", "E"],
    ["ECOMMERCE_FOTOS_MAX_POR_PRODUCTO", "8", "Cantidad máxima de fotos activas por contenido web (HU-E11; valor 8 pendiente de validar con el PO)", "E"],
    ["ECOMMERCE_FOTO_TAMANO_MAX_MB", "5", "Tamaño máximo por foto del catálogo web, en MB de 1024 × 1024 bytes (HU-E11; valor 5 pendiente de validar con el PO)", "E"],
    ["ECOMMERCE_FOTO_FORMATOS_PERMITIDOS", "JPG,PNG,WEBP", "Formatos de foto admitidos en el catálogo web, separados por coma; detectados por firma de bytes (HU-E11)", "E"],
    ["ECOMMERCE_ACCESO_LOG_PAGOS_EXPIRACION_DIAS", "30", "Días de validez de un acceso aprobado al log de pagos online (HU-E6; valor 30 pendiente de validar con el PO)", "E"],
    ["VENTAS_MARGEN_SUGERIDO_PRECIO_VENTA", "0.35", "Margen para el precio sugerido: costo de reposición × (1 + margen) (HU-B9)", "B"],
  ] as const) {
    await prisma.configuracionSistema.upsert({
      where: { clave },
      update: {},
      create: { clave, valor, descripcion, modulo, actualizado_por_id: usuarioAdmin.id },
    });
  }

  // ── HU-B9 — Lista de Precios de Venta general + versión 1 ───────────────────
  // `costo_reposicion_referencia` = costo vigente que devuelve el servicio
  // real de HU-H8 (`obtenerCostoReposicionVigente()`: menor precio vigente
  // entre proveedores, ignorando versiones pendientes de aprobación) sobre los
  // fixtures de Módulo H de este mismo seed. Con esos fixtures da:
  //   Camisa 1 = 15600 · Camisa 2 = 16900 · Camisa 3 = 15950
  //   Borcegos 1 = 43500 · Borcegos 2 = 41500
  // `precio_venta` = costo × (1 + VENTAS_MARGEN_SUGERIDO_PRECIO_VENTA),
  // redondeado a la centena — la misma sugerencia de HU-B9. Ningún ítem queda
  // bajo costo. Publica el Supervisor de Ventas (único rol con
  // `ventas:gestionar_lista_precios`, spec_modulo_B.md §2.9).
  //
  // Corrección de fixture (Sprint 4): la primera versión de este bloque usaba
  // los precios de la ListaPrecioVersion 1 de Módulo H (Camisa 1/2 y
  // Borcegos 1 no coincidían con HU-H8). Por eso precio y costo también van
  // en `update`: re-correr el seed corrige bases ya sembradas.
  const listaPrecioVentaGeneral = await prisma.listaPrecioVenta.upsert({
    where: { id: LISTA_PRECIO_VENTA_GENERAL_ID },
    update: {},
    create: { id: LISTA_PRECIO_VENTA_GENERAL_ID },
  });

  const listaPrecioVentaVersion1 = await prisma.listaPrecioVentaVersion.upsert({
    where: { id: LISTA_PRECIO_VENTA_VERSION_1_ID },
    update: {},
    create: {
      id: LISTA_PRECIO_VENTA_VERSION_1_ID,
      lista_id: listaPrecioVentaGeneral.id,
      vigente_desde: diasAtras(1),
      publicado_por_id: usuarioSupervisorVentas.id,
    },
  });

  const margenSugerido = Number(
    (
      await prisma.configuracionSistema.findUniqueOrThrow({
        where: { clave: "VENTAS_MARGEN_SUGERIDO_PRECIO_VENTA" },
      })
    ).valor,
  );
  const redondearCentena = (monto: number) => Math.round(monto / 100) * 100;

  /** Precio de venta vigente por variante — lo reutilizan los pedidos web. */
  const precioVentaPorVariante = new Map<string, number>();

  for (const variante_sku_id of [
    VARIANTE_CAMISA_TACTICA_1_ID,
    VARIANTE_CAMISA_TACTICA_2_ID,
    VARIANTE_CAMISA_TACTICA_3_ID,
    VARIANTE_BORCEGOS_1_ID,
    VARIANTE_BORCEGOS_2_ID,
  ]) {
    const costoVigente = await obtenerCostoReposicionVigente(variante_sku_id, { prisma });
    if (!costoVigente) {
      // Los fixtures de Módulo H de este seed siempre dan costo para estas 5
      // variantes: si no, el seed quedó inconsistente y conviene cortar acá.
      throw new Error(
        `[seed HU-B9] HU-H8 no devolvió costo de reposición para la variante ${variante_sku_id}`,
      );
    }
    const costo_reposicion_referencia = costoVigente.precio_unitario;
    const precio_venta = redondearCentena(costo_reposicion_referencia * (1 + margenSugerido));
    precioVentaPorVariante.set(variante_sku_id, precio_venta);

    await prisma.listaPrecioVentaItem.upsert({
      where: {
        version_id_variante_sku_id: { version_id: listaPrecioVentaVersion1.id, variante_sku_id },
      },
      update: { precio_venta, costo_reposicion_referencia },
      create: {
        version_id: listaPrecioVentaVersion1.id,
        variante_sku_id,
        precio_venta,
        costo_reposicion_referencia,
      },
    });
  }

  // ── Sprint 4 — permisos de D.4 / F / G ──────────────────────────────────────
  // Asignación según el texto de cada spec:
  //   - configuracion:administrar     → ADMINISTRADOR ("exclusivo Administrador", D §6.3)
  //   - tesoreria:leer_ingresos_web   → TESORERO_CENTRAL, ADMINISTRADOR y AUDITOR
  //                                     (G §7 lo sembraba provisional solo para
  //                                     TESORERO_CENTRAL; HU-G11 amplía el alcance a
  //                                     ADMINISTRADOR y AUDITOR, aprobado por el equipo)
  //   - integraciones:administrar_conector, notificaciones:administrar_plantillas →
  //     ADMINISTRADOR_PLATAFORMA (F §2.1.1/§2.2; rol sembrado abajo). Los otros
  //     roles que habilita la spec (Desarrollador/DevOps, Marketing/Atención al
  //     Cliente) no se siembran: su granularidad de permisos está "a definir".
  //   - configuracion:leer            → SIN ASIGNAR: D §6.3 no nombra rol para el
  //     Route Handler HTTP (los consumidores internos no pasan por este permiso).
  // `ventas:validar_identidad_cliente_web` (E §2.8) se asigna al rol VENDEDOR.
  await Promise.all(
    (
      [
        [PERMISO_INTEGRACIONES_ADMINISTRAR_CONECTOR_ID, "integraciones:administrar_conector", "Alta, health-check, bitácora y baja del Conector de Mercado Pago — exclusivo Administrador de Plataforma (HU-F1)", "MODULO_F"],
        [PERMISO_NOTIFICACIONES_ADMINISTRAR_PLANTILLAS_ID, "notificaciones:administrar_plantillas", "Alta, edición y baja de plantillas de notificación — exclusivo Administrador de Plataforma (HU-F2)", "MODULO_F"],
        [PERMISO_CONFIGURACION_ADMINISTRAR_ID, "configuracion:administrar", "Actualizar valores de ConfiguracionSistema — exclusivo Administrador (D.4 §6.3)", "MODULO_D"],
        [PERMISO_CONFIGURACION_LEER_ID, "configuracion:leer", "Consultar ConfiguracionSistema por el Route Handler HTTP (D.4 §6.3; los servicios internos leen sin este permiso)", "MODULO_D"],
        [PERMISO_TESORERIA_LEER_INGRESOS_WEB_ID, "tesoreria:leer_ingresos_web", "Consultar y reprocesar ingresos de Tesorería por cobros web (HU-G11) — TESORERO_CENTRAL, ADMINISTRADOR y AUDITOR", "MODULO_G"],
      ] as const
    ).map(([id, codigo, descripcion, modulo]) =>
      prisma.permiso.upsert({
        where: { id },
        update: REACTIVAR_REFERENCIA_RBAC,
        create: { id, codigo, descripcion, modulo },
      }),
    ),
  );

  // ── Módulo F — rol Administrador de Plataforma + usuario de prueba ──────────
  const rolAdministradorPlataforma = await prisma.rol.upsert({
    where: { id: ROL_ADMINISTRADOR_PLATAFORMA_ID },
    update: REACTIVAR_REFERENCIA_RBAC,
    create: {
      id: ROL_ADMINISTRADOR_PLATAFORMA_ID,
      nombre: "ADMINISTRADOR_PLATAFORMA",
      descripcion: "Administración de la plataforma (Módulo F) — Conector de Mercado Pago y plantillas de notificación",
    },
  });

  const usuarioAdminPlataforma = await prisma.usuario.upsert({
    where: { nombre_usuario: "admin.plataforma.seed" },
    update: {},
    create: {
      id: USUARIO_ADMIN_PLATAFORMA_SEED_ID,
      nombre_usuario: "admin.plataforma.seed",
      email: "admin.plataforma.seed@erp-swat.local",
      password_hash: passwordSeed.hash,
      password_salt: passwordSeed.salt,
      nombre_completo: "Administrador de Plataforma Seed (Módulo F)",
      estado: "ACTIVO",
      is_active: true,
    },
  });

  await prisma.usuarioRol.upsert({
    where: {
      usuario_id_rol_id: { usuario_id: usuarioAdminPlataforma.id, rol_id: rolAdministradorPlataforma.id },
    },
    update: {},
    create: {
      id: USUARIO_ROL_ADMIN_PLATAFORMA_ID,
      usuario_id: usuarioAdminPlataforma.id,
      rol_id: rolAdministradorPlataforma.id,
    },
  });

  for (const [rol_id, permiso_id] of [
    [rolAdministrador.id, PERMISO_CONFIGURACION_ADMINISTRAR_ID],
    [rolTesorero.id, PERMISO_TESORERIA_LEER_INGRESOS_WEB_ID],
    [rolAdministrador.id, PERMISO_TESORERIA_LEER_INGRESOS_WEB_ID],
    [rolAuditor.id, PERMISO_TESORERIA_LEER_INGRESOS_WEB_ID],
    [rolAdministradorPlataforma.id, PERMISO_INTEGRACIONES_ADMINISTRAR_CONECTOR_ID],
    [rolAdministradorPlataforma.id, PERMISO_NOTIFICACIONES_ADMINISTRAR_PLANTILLAS_ID],
  ] as const) {
    await prisma.rolPermiso.upsert({
      where: { rol_id_permiso_id: { rol_id, permiso_id } },
      update: REACTIVAR_REFERENCIA_RBAC,
      create: { rol_id, permiso_id },
    });
  }

  // ── Cifrado AES (lib/crypto/aes.ts) ─────────────────────────────────────────
  // `encrypt()` exige ENCRYPTION_KEY_PROVEEDORES. Sin ella, se saltan los dos
  // bloques que guardan datos cifrados (ConectorPago + su bitácora, y
  // TransaccionPagoLog) en vez de abortar todo el seed.
  const hayClaveCifrado = Boolean(process.env.ENCRYPTION_KEY_PROVEEDORES);
  if (!hayClaveCifrado) {
    console.warn(
      "[seed] ENCRYPTION_KEY_PROVEEDORES no está definida: se omiten ConectorPago SANDBOX, " +
        "InvocacionConectorPago y TransaccionPagoLog (requieren lib/crypto/aes.ts).",
    );
  }

  // ── HU-F1 — Conector de Mercado Pago SANDBOX, ACTIVO ────────────────────────
  // Credenciales FICTICIAS (no son de ninguna cuenta real de Mercado Pago),
  // cifradas igual que en la app: un par ciphertext/IV por secreto. SANDBOX
  // puede activarse sin health-check (F §2.1.1), por eso
  // `ultimo_health_check_exitoso_at` queda null.
  //
  // HU-E2 (task §3.2, P3): si están definidas MP_SANDBOX_ACCESS_TOKEN,
  // MP_SANDBOX_PUBLIC_KEY y MP_SANDBOX_WEBHOOK_SECRET (credenciales de PRUEBA de
  // una cuenta real de Mercado Pago), se cifran ESAS; si falta alguna, quedan
  // las ficticias (sirven con MP_MODO=simulado). `update` reescribe las tres
  // para que cargar las variables y re-sembrar las aplique. Nunca se imprimen.
  const credencialesMpReales = Boolean(
    process.env.MP_SANDBOX_ACCESS_TOKEN && process.env.MP_SANDBOX_PUBLIC_KEY && process.env.MP_SANDBOX_WEBHOOK_SECRET,
  );
  if (hayClaveCifrado) {
    if (!credencialesMpReales) {
      console.warn(
        "[seed] MP_SANDBOX_* incompletas: el Conector SANDBOX queda con credenciales FICTICIAS " +
          "(usar MP_MODO=simulado para probar HU-E2 sin Mercado Pago).",
      );
    }
    const accessToken = encrypt(process.env.MP_SANDBOX_ACCESS_TOKEN || "TEST-0000000000000000-SEED-ACCESS-TOKEN-FICTICIO");
    const publicKey = encrypt(process.env.MP_SANDBOX_PUBLIC_KEY || "TEST-SEED-PUBLIC-KEY-FICTICIA");
    const webhookSecret = encrypt(process.env.MP_SANDBOX_WEBHOOK_SECRET || "seed-webhook-secret-ficticio");
    const credencialesCifradas = {
      access_token_cifrado: accessToken.ciphertext,
      access_token_iv: accessToken.iv,
      public_key_cifrada: publicKey.ciphertext,
      public_key_iv: publicKey.iv,
      webhook_secret_cifrado: webhookSecret.ciphertext,
      webhook_secret_iv: webhookSecret.iv,
    };

    const conectorSandbox = await prisma.conectorPago.upsert({
      where: { id: CONECTOR_PAGO_SANDBOX_ID },
      update: { ...credencialesCifradas, estado: "ACTIVO", is_active: true, deleted_at: null },
      create: {
        id: CONECTOR_PAGO_SANDBOX_ID,
        nombre: "Mercado Pago — Sandbox (seed)",
        entorno: "SANDBOX",
        estado: "ACTIVO",
        ...credencialesCifradas,
      },
    });

    for (const [id, operacion, exitosa, detalle_error, hace_horas] of [
      [INVOCACION_CONECTOR_COBRO_OK_ID, "INICIAR_COBRO", true, null, 30],
      [INVOCACION_CONECTOR_CONSULTA_FALLIDA_ID, "CONSULTAR_PAGO", false, "timeout", 29],
      [INVOCACION_CONECTOR_CONSULTA_OK_ID, "CONSULTAR_PAGO", true, null, 28],
    ] as const) {
      await prisma.invocacionConectorPago.upsert({
        where: { id },
        update: {},
        create: {
          id,
          conector_id: conectorSandbox.id,
          operacion,
          exitosa,
          detalle_error,
          created_at: new Date(Date.now() - hace_horas * 60 * 60 * 1000),
        },
      });
    }
  }

  // ── HU-E8 — Cuentas de Cliente Web ──────────────────────────────────────────
  // Misma contraseña de prueba que el resto del seed (argon2id vía
  // hashPassword; la sal viaja embebida en el hash PHC, por eso alcanza con
  // `password_hash`). Juan Pérez: cuenta operativa (ya tiene consentimiento
  // vigente). María Gómez: DNI ya existente como Cliente de mostrador →
  // `vinculacion_pendiente = true`, inhabilitada para checkout (E §2.8).
  const cuentaWebJuanPerez = await prisma.cuentaClienteWeb.upsert({
    where: { cliente_id: clienteJuanPerez.id },
    update: {},
    create: {
      id: CUENTA_WEB_JUAN_PEREZ_ID,
      cliente_id: clienteJuanPerez.id,
      email: "juan.perez@example.com",
      password_hash: passwordSeed.hash,
    },
  });

  const cuentaWebMariaGomez = await prisma.cuentaClienteWeb.upsert({
    where: { cliente_id: clienteMariaGomezPrimario.id },
    update: {},
    create: {
      id: CUENTA_WEB_MARIA_GOMEZ_ID,
      cliente_id: clienteMariaGomezPrimario.id,
      email: "maria.gomez@example.com",
      password_hash: passwordSeed.hash,
      vinculacion_pendiente: true,
    },
  });

  // ── HU-E5/HU-E11 — Producto extra para `visibilidad_web = false` ────────────
  // Los 3 ProductoMaestro previos ya se usan para "publicable" (Camisa
  // Táctica, Borcegos) y "no publicable por falta de precio" (Camisa de
  // Policía). La Gorra cumple todos los requisitos de publicación (foto,
  // descripción, precio, stock) salvo la bandera, que queda en false.
  const productoGorraTactica = await prisma.productoMaestro.upsert({
    where: { id: PRODUCTO_GORRA_TACTICA_ID },
    update: {},
    create: {
      id: PRODUCTO_GORRA_TACTICA_ID,
      codigo_producto: "GORTAC",
      nombre: "Gorra Táctica",
      rubro: "Indumentaria",
      categoria: "Accesorios",
      unidad_medida: "UNIDAD",
      descripcion: "Gorra táctica — datos de prueba (Sprint 4, caso visibilidad web desactivada)",
      costo_estandar_referencia: 7000.0,
      is_active: true,
    },
  });

  await prisma.varianteSKU.upsert({
    where: { id: VARIANTE_GORRA_TACTICA_ID },
    update: {},
    create: {
      id: VARIANTE_GORRA_TACTICA_ID,
      producto_maestro_id: productoGorraTactica.id,
      proveedor_id: proveedorHomologado.id,
      sku: generarSku({
        codigoProducto: productoGorraTactica.codigo_producto,
        modelo: "Operativa",
        talle: "U",
        codigoColor: "Negro",
        genero: "UNISEX",
      }),
      ean_qr: "7791234500099",
      talle: "U",
      color: "Negro",
      genero: "UNISEX",
      modelo: "Operativa",
      is_active: true,
    },
  });

  // Precio manual: la Gorra no tiene ListaPrecio de proveedor, así que HU-H8
  // respondería SIN_COSTO_REPOSICION_DISPONIBLE → `costo_reposicion_referencia`
  // null y sin validación de bajo costo (B §2.9).
  await prisma.listaPrecioVentaItem.upsert({
    where: {
      version_id_variante_sku_id: {
        version_id: listaPrecioVentaVersion1.id,
        variante_sku_id: VARIANTE_GORRA_TACTICA_ID,
      },
    },
    update: {},
    create: {
      version_id: listaPrecioVentaVersion1.id,
      variante_sku_id: VARIANTE_GORRA_TACTICA_ID,
      precio_venta: 9500.0,
      costo_reposicion_referencia: null,
    },
  });

  // ── HU-E1/HU-E11 — Contenido web del catálogo ───────────────────────────────
  // URLs de placeholder: el storage de fotos no está definido (E §5).
  for (const c of [
    {
      id: CONTENIDO_WEB_CAMISA_TACTICA_ID,
      foto_id: FOTO_WEB_CAMISA_TACTICA_ID,
      producto_maestro_id: productoCamisaTactica.id,
      titulo_comercial: "Camisa Táctica Ripstop",
      descripcion: "Camisa táctica de tela ripstop, manga corta o larga. Datos de prueba.",
      visibilidad_web: true,
      foto: "https://placehold.co/800x800?text=Camisa+Tactica",
    },
    {
      id: CONTENIDO_WEB_BORCEGOS_ID,
      foto_id: FOTO_WEB_BORCEGOS_ID,
      producto_maestro_id: productoBorcegos.id,
      titulo_comercial: "Borcegos de Combate",
      descripcion: "Borcegos de combate con suela antideslizante. Datos de prueba.",
      visibilidad_web: true,
      foto: "https://placehold.co/800x800?text=Borcegos",
    },
    {
      // No publicable: tiene foto, descripción y visibilidad, pero su única
      // variante no tiene precio en la Lista de Precios de Venta (E §2.11).
      id: CONTENIDO_WEB_CAMISA_POLICIA_ID,
      foto_id: FOTO_WEB_CAMISA_POLICIA_ID,
      producto_maestro_id: productoMaestro.id,
      titulo_comercial: "Camisa de Policía",
      descripcion: "Camisa reglamentaria. Datos de prueba — sin precio de venta vigente.",
      visibilidad_web: true,
      foto: "https://placehold.co/800x800?text=Camisa+Policia",
    },
    {
      // Publicable en todo salvo la bandera (HU-E5).
      id: CONTENIDO_WEB_GORRA_TACTICA_ID,
      foto_id: FOTO_WEB_GORRA_TACTICA_ID,
      producto_maestro_id: productoGorraTactica.id,
      titulo_comercial: "Gorra Táctica Operativa",
      descripcion: "Gorra táctica con abrojo para parche. Datos de prueba — visibilidad web desactivada.",
      visibilidad_web: false,
      foto: "https://placehold.co/800x800?text=Gorra+Tactica",
    },
  ]) {
    const contenido = await prisma.productoWebContenido.upsert({
      where: { producto_maestro_id: c.producto_maestro_id },
      update: {},
      create: {
        id: c.id,
        producto_maestro_id: c.producto_maestro_id,
        titulo_comercial: c.titulo_comercial,
        descripcion: c.descripcion,
        visibilidad_web: c.visibilidad_web,
      },
    });
    await prisma.productoWebFoto.upsert({
      where: { id: c.foto_id },
      update: {},
      create: {
        id: c.foto_id,
        producto_web_contenido_id: contenido.id,
        url: c.foto,
        es_principal: true,
        orden: 0,
      },
    });
  }

  // ── HU-E1 — Stock del canal web (Showroom) ──────────────────────────────────
  // Filas NUEVAS; las ya sembradas (CT1 = 4, B1 = 3 en Showroom) no se tocan.
  // Mismo criterio del resto del seed: la cantidad se siembra directo en
  // `stock_depositos` (los movimientos del seed no aplican deltas) y
  // representa el DISPONIBLE ya descontado lo que consumen los pedidos web de
  // abajo:
  //   CT2: 12 − 1 reservada (PAGO_PENDIENTE) − 4 vendidas = 7
  //   CT3:  8 − 2 vendidas = 6 (PAGO_RECHAZADO y ANULADO liberaron la suya)
  //   B2:   0 → caso "agotado en la web"
  for (const s of [
    { id: STOCK_CT2_SHOWROOM_ID, vid: VARIANTE_CAMISA_TACTICA_2_ID, qty: 7 },
    { id: STOCK_CT3_SHOWROOM_ID, vid: VARIANTE_CAMISA_TACTICA_3_ID, qty: 6 },
    { id: STOCK_B2_SHOWROOM_ID, vid: VARIANTE_BORCEGOS_2_ID, qty: 0 },
    { id: STOCK_GORRA_SHOWROOM_ID, vid: VARIANTE_GORRA_TACTICA_ID, qty: 5 },
  ]) {
    await prisma.stockDeposito.upsert({
      where: {
        variante_sku_id_deposito_id: { variante_sku_id: s.vid, deposito_id: depositoShowroom.id },
      },
      update: {},
      create: {
        id: s.id,
        variante_sku_id: s.vid,
        deposito_id: depositoShowroom.id,
        cantidad: s.qty,
        punto_pedido: 0,
        stock_seguridad: 0,
        is_active: true,
      },
    });
  }

  // ── HU-E1 — Fixtures de catálogo, carrito y checkout (task HU-E1 §9) ────────
  // Los `update` RE-AFIRMAN el estado del fixture (no `{}`): re-correr el seed
  // deja los casos listos para volver a probar a mano (la fusión da de baja el
  // carrito visitante; el checkout puede tocar el carrito de Carlos). Nunca se
  // borra nada: lo que sobra se da de baja lógica.
  const BAJA_FIXTURE_E1 = {
    is_active: false,
    deleted_by: usuarioAdminEcommerce.id,
  };

  // (1) SKU inactivo — Camisa Táctica XL/Verde/HOMBRE/Manga Larga.
  const skuCamisaInactiva = generarSku({
    codigoProducto: productoCamisaTactica.codigo_producto,
    modelo: "Manga Larga",
    talle: "XL",
    codigoColor: "Verde",
    genero: "HOMBRE",
  });
  await prisma.varianteSKU.upsert({
    where: { id: VARIANTE_CAMISA_TACTICA_INACTIVA_ID },
    update: { ...BAJA_FIXTURE_E1, deletion_reason: "Discontinuado — fixture HU-E1" },
    create: {
      id: VARIANTE_CAMISA_TACTICA_INACTIVA_ID,
      producto_maestro_id: productoCamisaTactica.id,
      proveedor_id: proveedorHomologado.id,
      sku: skuCamisaInactiva,
      ean_qr: "7791234500109",
      talle: "XL",
      color: "Verde",
      genero: "HOMBRE",
      modelo: "Manga Larga",
      ...BAJA_FIXTURE_E1,
      deleted_at: diasAtras(1),
      deletion_reason: "Discontinuado — fixture HU-E1",
    },
  });

  // (2) Producto Maestro inactivo con variante ACTIVA — Chaleco Táctico.
  const productoChaleco = await prisma.productoMaestro.upsert({
    where: { id: PRODUCTO_CHALECO_TACTICO_ID },
    update: { ...BAJA_FIXTURE_E1, deletion_reason: "Producto discontinuado — fixture HU-E1" },
    create: {
      id: PRODUCTO_CHALECO_TACTICO_ID,
      codigo_producto: "CHATAC",
      nombre: "Chaleco Táctico",
      rubro: "Indumentaria",
      categoria: "Chalecos",
      unidad_medida: "UNIDAD",
      descripcion: "Chaleco táctico — datos de prueba (HU-E1, Producto Maestro inactivo)",
      costo_estandar_referencia: 30000.0,
      ...BAJA_FIXTURE_E1,
      deleted_at: diasAtras(1),
      deletion_reason: "Producto discontinuado — fixture HU-E1",
    },
  });
  await prisma.varianteSKU.upsert({
    where: { id: VARIANTE_CHALECO_TACTICO_ID },
    update: {},
    create: {
      id: VARIANTE_CHALECO_TACTICO_ID,
      producto_maestro_id: productoChaleco.id,
      proveedor_id: proveedorHomologado.id,
      sku: generarSku({
        codigoProducto: productoChaleco.codigo_producto,
        modelo: "Operativo",
        talle: "L",
        codigoColor: "Negro",
        genero: "UNISEX",
      }),
      ean_qr: "7791234500116",
      talle: "L",
      color: "Negro",
      genero: "UNISEX",
      modelo: "Operativo",
      is_active: true,
    },
  });
  const contenidoChaleco = await prisma.productoWebContenido.upsert({
    where: { producto_maestro_id: productoChaleco.id },
    update: {},
    create: {
      id: CONTENIDO_WEB_CHALECO_ID,
      producto_maestro_id: productoChaleco.id,
      titulo_comercial: "Chaleco Táctico Operativo",
      descripcion: "Chaleco táctico. Datos de prueba — Producto Maestro dado de baja (HU-E1).",
      visibilidad_web: true,
    },
  });
  await prisma.productoWebFoto.upsert({
    where: { id: FOTO_WEB_CHALECO_ID },
    update: {},
    create: {
      id: FOTO_WEB_CHALECO_ID,
      producto_web_contenido_id: contenidoChaleco.id,
      url: "https://placehold.co/800x800?text=Chaleco+Tactico",
      es_principal: true,
      orden: 0,
    },
  });

  // Precio manual en la versión 1 (sin ListaPrecio de proveedor, igual que la
  // Gorra) y stock en el depósito del canal web, para los dos casos de arriba.
  for (const [variante_sku_id, precio_venta] of [
    [VARIANTE_CAMISA_TACTICA_INACTIVA_ID, 22800.0],
    [VARIANTE_CHALECO_TACTICO_ID, 40500.0],
  ] as const) {
    await prisma.listaPrecioVentaItem.upsert({
      where: { version_id_variante_sku_id: { version_id: listaPrecioVentaVersion1.id, variante_sku_id } },
      update: {},
      create: { version_id: listaPrecioVentaVersion1.id, variante_sku_id, precio_venta, costo_reposicion_referencia: null },
    });
  }
  for (const s of [
    { id: STOCK_CT_INACTIVA_SHOWROOM_ID, vid: VARIANTE_CAMISA_TACTICA_INACTIVA_ID, qty: 5 },
    { id: STOCK_CHALECO_SHOWROOM_ID, vid: VARIANTE_CHALECO_TACTICO_ID, qty: 4 },
  ]) {
    await prisma.stockDeposito.upsert({
      where: { variante_sku_id_deposito_id: { variante_sku_id: s.vid, deposito_id: depositoShowroom.id } },
      update: {},
      create: { id: s.id, variante_sku_id: s.vid, deposito_id: depositoShowroom.id, cantidad: s.qty, is_active: true },
    });
  }

  // (3) Versión FUTURA de la Lista de Precios de Venta (CA3): la Gorra cuesta
  // 9500 en la versión 1 vigente y 9900 en esta, que NO debe aplicarse antes
  // de tiempo. `vigente_desde` se refresca en cada corrida (mismo criterio que
  // la reserva PAGO_PENDIENTE) para que el fixture no "envejezca" y se vuelva
  // vigente sola.
  const vigenteDesdeFutura = diasAtras(-30);
  const listaPrecioVentaVersionFutura = await prisma.listaPrecioVentaVersion.upsert({
    where: { id: LISTA_PRECIO_VENTA_VERSION_FUTURA_ID },
    update: { vigente_desde: vigenteDesdeFutura },
    create: {
      id: LISTA_PRECIO_VENTA_VERSION_FUTURA_ID,
      lista_id: listaPrecioVentaGeneral.id,
      vigente_desde: vigenteDesdeFutura,
      publicado_por_id: usuarioSupervisorVentas.id,
    },
  });
  await prisma.listaPrecioVentaItem.upsert({
    where: {
      version_id_variante_sku_id: {
        version_id: listaPrecioVentaVersionFutura.id,
        variante_sku_id: VARIANTE_GORRA_TACTICA_ID,
      },
    },
    update: {},
    create: {
      version_id: listaPrecioVentaVersionFutura.id,
      variante_sku_id: VARIANTE_GORRA_TACTICA_ID,
      precio_venta: 9900.0,
      costo_reposicion_referencia: null,
    },
  });

  // (4) Cliente Web de prueba exclusivo de HU-E1 (D11) — operativo, sin
  // pedidos web previos (Juan Pérez ya tiene un PAGO_PENDIENTE sembrado).
  const clienteCarlosRuiz = await prisma.cliente.upsert({
    where: { id: CLIENTE_CARLOS_RUIZ_ID },
    update: {},
    create: {
      id: CLIENTE_CARLOS_RUIZ_ID,
      dni: "33444555",
      nombre: "Carlos Ruiz",
      telefono: "3874005555",
      email: "carlos.ruiz@example.com",
      canal_preferido: "EMAIL",
      segmento: "MINORISTA",
      is_active: true,
    },
  });
  await prisma.consentimientoCliente.upsert({
    where: { id: CONSENTIMIENTO_CARLOS_RUIZ_ID },
    update: {},
    create: {
      id: CONSENTIMIENTO_CARLOS_RUIZ_ID,
      cliente_id: clienteCarlosRuiz.id,
      alcance: "AMBOS",
      finalidad: "Venta online y comunicaciones comerciales",
      fecha_consentimiento: diasAtras(3),
      is_active: true,
    },
  });
  const cuentaWebCarlosRuiz = await prisma.cuentaClienteWeb.upsert({
    where: { cliente_id: clienteCarlosRuiz.id },
    update: {},
    create: {
      id: CUENTA_WEB_CARLOS_RUIZ_ID,
      cliente_id: clienteCarlosRuiz.id,
      email: "carlos.ruiz@example.com",
      password_hash: passwordSeed.hash,
    },
  });

  // (5) Carrito persistente de Carlos: CT2 ×1 + SKU inactivo ×1 (CA4 directo
  // y CA7 desde otro navegador). Re-afirmado en cada corrida: cualquier otro
  // carrito activo de la cuenta o ítem extra queda de baja lógica (índice
  // único parcial — un solo carrito activo por cuenta, D5).
  const reseedE1 = { deleted_at: new Date(), deleted_by: usuarioAdminEcommerce.id };
  await prisma.carritoWeb.updateMany({
    where: { cuenta_cliente_web_id: cuentaWebCarlosRuiz.id, id: { not: CARRITO_WEB_CARLOS_RUIZ_ID }, is_active: true },
    data: { is_active: false, ...reseedE1, deletion_reason: "RESEED_FIXTURE_HU_E1" },
  });
  const ACTIVO_E1 = { is_active: true, deleted_at: null, deleted_by: null, deletion_reason: null };
  await prisma.carritoWeb.upsert({
    where: { id: CARRITO_WEB_CARLOS_RUIZ_ID },
    update: { ...ACTIVO_E1, cuenta_cliente_web_id: cuentaWebCarlosRuiz.id, carrito_token: null },
    create: { id: CARRITO_WEB_CARLOS_RUIZ_ID, cuenta_cliente_web_id: cuentaWebCarlosRuiz.id },
  });

  // (6) Carrito de VISITANTE (sin cuenta), token fijo: CT3 ×2 + CT2 ×1 — CT2
  // repetido con el de Carlos para probar la suma en la fusión (CA7).
  await prisma.carritoWeb.upsert({
    where: { id: CARRITO_WEB_VISITANTE_ID },
    update: { ...ACTIVO_E1, carrito_token: CARRITO_VISITANTE_TOKEN_SEED, cuenta_cliente_web_id: null },
    create: { id: CARRITO_WEB_VISITANTE_ID, carrito_token: CARRITO_VISITANTE_TOKEN_SEED },
  });

  const itemsFixtureE1 = [
    { id: CARRITO_ITEM_CARLOS_CT2_ID, carrito_id: CARRITO_WEB_CARLOS_RUIZ_ID, variante_sku_id: VARIANTE_CAMISA_TACTICA_2_ID, cantidad: 1 },
    { id: CARRITO_ITEM_CARLOS_INACTIVA_ID, carrito_id: CARRITO_WEB_CARLOS_RUIZ_ID, variante_sku_id: VARIANTE_CAMISA_TACTICA_INACTIVA_ID, cantidad: 1 },
    { id: CARRITO_ITEM_VISITANTE_CT3_ID, carrito_id: CARRITO_WEB_VISITANTE_ID, variante_sku_id: VARIANTE_CAMISA_TACTICA_3_ID, cantidad: 2 },
    { id: CARRITO_ITEM_VISITANTE_CT2_ID, carrito_id: CARRITO_WEB_VISITANTE_ID, variante_sku_id: VARIANTE_CAMISA_TACTICA_2_ID, cantidad: 1 },
  ];
  await prisma.carritoWebItem.updateMany({
    where: {
      carrito_id: { in: [CARRITO_WEB_CARLOS_RUIZ_ID, CARRITO_WEB_VISITANTE_ID] },
      id: { notIn: itemsFixtureE1.map((i) => i.id) },
      is_active: true,
    },
    data: { is_active: false, ...reseedE1, deletion_reason: "RESEED_FIXTURE_HU_E1" },
  });
  for (const item of itemsFixtureE1) {
    await prisma.carritoWebItem.upsert({
      where: { id: item.id },
      update: { ...ACTIVO_E1, cantidad: item.cantidad },
      create: item,
    });
  }

  // (7) Plantilla del evento de CA4 (spec_modulo_F.md §3.3: ADVERTENCIA,
  // Cliente Web dueño del carrito). `{{sku}}` viaja en el payload del evento.
  await prisma.plantillaNotificacion.upsert({
    where: { tipo_evento: "ecommerce:carrito_articulo_no_disponible" },
    update: {},
    create: {
      tipo_evento: "ecommerce:carrito_articulo_no_disponible",
      asunto: "Un artículo de tu carrito ya no está disponible",
      cuerpo:
        "El artículo {{sku}} de tu carrito ya no está disponible y bloqueó la confirmación de tu compra. Quitalo del carrito para continuar.",
      prioridad_default: "ADVERTENCIA",
    },
  });

  // ── HU-E4 — Cupones ─────────────────────────────────────────────────────────
  const cuponVigente = await prisma.cuponDescuento.upsert({
    where: { codigo: "SWAT10" },
    update: {},
    create: {
      id: CUPON_VIGENTE_ID,
      codigo: "SWAT10",
      tipo_beneficio: "PORCENTAJE",
      valor: 10,
      vigente_desde: diasAtras(10),
      vigente_hasta: diasAtras(-30),
      limite_uso_por_cliente: 1,
    },
  });

  await prisma.cuponDescuento.upsert({
    where: { codigo: "INVIERNO5000" },
    update: {},
    create: {
      id: CUPON_VENCIDO_ID,
      codigo: "INVIERNO5000",
      tipo_beneficio: "MONTO_FIJO",
      valor: 5000,
      vigente_desde: diasAtras(60),
      vigente_hasta: diasAtras(30),
      limite_uso_por_cliente: 1,
    },
  });

  // Agotado: límite global 1, ya consumido por la aplicación confirmada del
  // pedido ENTREGADO de abajo.
  const cuponAgotado = await prisma.cuponDescuento.upsert({
    where: { codigo: "LANZAMIENTO15" },
    update: {},
    create: {
      id: CUPON_AGOTADO_ID,
      codigo: "LANZAMIENTO15",
      tipo_beneficio: "PORCENTAJE",
      valor: 15,
      vigente_desde: diasAtras(30),
      vigente_hasta: diasAtras(-30),
      limite_uso_global: 1,
      limite_uso_por_cliente: 1,
    },
  });

  // ── HU-E2 y consumidoras — Pedidos web, uno por estado ──────────────────────
  // Correspondencia `estado_ecommerce` ↔ `PedidoVenta.estado` según E §3.1.
  // Todos: canal WEB, registrado por `canal.web.sistema`, cliente Juan Pérez,
  // depósito del canal web (Showroom), `origen_reserva` null (el valor para
  // checkout web no está decidido — E §2.2). `numero_venta` continúa la
  // secuencia de `generarNumeroVenta()` (`V-<año>-<count+1>`): V-2026-000004
  // en adelante, contiguos, para que el generador no choque con ellos.
  // Los pagados llevan comprobante Factura B, cobro MERCADO_PAGO,
  // TransaccionPagoLog e IngresoTesoreria en PENDIENTE_CONCILIACION.
  // Sin MovimientoStock: mismo patrón que los pedidos de Sprint 3.
  //
  // LIMITACIÓN: las fechas son relativas al momento en que se corre el seed
  // y `update: {}` no las refresca. Una base sembrada hace días "envejece":
  // el plazo de retiro del pedido LISTO_PARA_RETIRO termina venciendo. La
  // única excepción es la reserva del pedido PAGO_PENDIENTE, que se refresca
  // en cada corrida (ver `update` abajo).
  const leerConfigNumero = async (clave: string) =>
    Number((await prisma.configuracionSistema.findUniqueOrThrow({ where: { clave } })).valor);
  const ttlCheckoutHoras = await leerConfigNumero("ECOMMERCE_CHECKOUT_TTL_HORAS");
  const plazoRetiroDias = await leerConfigNumero("ECOMMERCE_PLAZO_RETIRO_DIAS");
  const sumarHoras = (fecha: Date, horas: number) => new Date(fecha.getTime() + horas * 60 * 60 * 1000);
  const redondearCentavos = (monto: number) => Math.round(monto * 100) / 100;

  const datosFacturacionJuanPerez = JSON.stringify({
    nombre: clienteJuanPerez.nombre,
    email: clienteJuanPerez.email,
  });

  interface PedidoWebSeed {
    ids: {
      pedido: string;
      ecommerce: string;
      items: readonly { item: string; reserva: string }[];
      comprobante?: string;
      medio_pago?: string;
      transaccion?: string;
    };
    numero_venta: string;
    estado_ecommerce:
      | "PAGO_PENDIENTE"
      | "PAGO_RECHAZADO"
      | "EN_PREPARACION"
      | "LISTO_PARA_RETIRO"
      | "ENTREGADO"
      | "ANULADO";
    estado_venta: "RESERVADO" | "FACTURADO" | "CERRADO" | "ANULADO";
    fecha_checkout: Date;
    variantes: string[];
    pago?: { estado: "APROBADO" | "RECHAZADO"; mercadopago_payment_id: string };
    cupon?: { aplicacion_id: string; cupon_id: string; porcentaje: number; confirmada: boolean };
    operador?: { id: string; prioridad_manual?: number };
    fecha_listo?: Date;
    anulacion?: { motivo: string };
  }

  const pedidosWeb: PedidoWebSeed[] = [
    {
      // Reserva vigente + cupón aplicado sin confirmar (HU-E2/E4/E7).
      ids: PEDIDO_WEB_PAGO_PENDIENTE_IDS,
      numero_venta: "V-2026-000004",
      estado_ecommerce: "PAGO_PENDIENTE",
      estado_venta: "RESERVADO",
      fecha_checkout: new Date(),
      variantes: [VARIANTE_CAMISA_TACTICA_2_ID],
      cupon: { aplicacion_id: CUPON_APLICACION_PENDIENTE_ID, cupon_id: cuponVigente.id, porcentaje: 10, confirmada: false },
    },
    {
      // Rechazado: reserva liberada de inmediato, sin IngresoTesoreria (E §2.2).
      ids: PEDIDO_WEB_PAGO_RECHAZADO_IDS,
      numero_venta: "V-2026-000005",
      estado_ecommerce: "PAGO_RECHAZADO",
      estado_venta: "RESERVADO",
      fecha_checkout: diasAtras(2),
      variantes: [VARIANTE_CAMISA_TACTICA_3_ID],
      pago: { estado: "RECHAZADO", mercadopago_payment_id: "1320000000005" },
    },
    {
      // En la cola, todavía sin tomar (HU-E12 "ingreso automático").
      ids: PEDIDO_WEB_EN_PREPARACION_LIBRE_IDS,
      numero_venta: "V-2026-000006",
      estado_ecommerce: "EN_PREPARACION",
      estado_venta: "FACTURADO",
      fecha_checkout: diasAtras(1),
      variantes: [VARIANTE_CAMISA_TACTICA_2_ID],
      pago: { estado: "APROBADO", mercadopago_payment_id: "1320000000006" },
    },
    {
      // Tomado por el Operador, con prioridad manual; dos ítems para el
      // escaneo ítem por ítem de HU-E12.
      ids: PEDIDO_WEB_EN_PREPARACION_ASIGNADO_IDS,
      numero_venta: "V-2026-000007",
      estado_ecommerce: "EN_PREPARACION",
      estado_venta: "FACTURADO",
      fecha_checkout: diasAtras(2),
      variantes: [VARIANTE_CAMISA_TACTICA_2_ID, VARIANTE_CAMISA_TACTICA_3_ID],
      pago: { estado: "APROBADO", mercadopago_payment_id: "1320000000007" },
      operador: { id: usuarioOperadorPickPack.id, prioridad_manual: 1 },
    },
    {
      ids: PEDIDO_WEB_LISTO_PARA_RETIRO_IDS,
      numero_venta: "V-2026-000008",
      estado_ecommerce: "LISTO_PARA_RETIRO",
      estado_venta: "FACTURADO",
      fecha_checkout: diasAtras(3),
      variantes: [VARIANTE_CAMISA_TACTICA_2_ID],
      pago: { estado: "APROBADO", mercadopago_payment_id: "1320000000008" },
      operador: { id: usuarioOperadorPickPack.id },
      fecha_listo: diasAtras(2),
    },
    {
      // Listo hace más que ECOMMERCE_PLAZO_RETIRO_DIAS: el job de HU-E13
      // todavía no lo pasó a VENCIDO_SIN_RETIRO (ese estado no se siembra).
      ids: PEDIDO_WEB_LISTO_PLAZO_VENCIDO_IDS,
      numero_venta: "V-2026-000009",
      estado_ecommerce: "LISTO_PARA_RETIRO",
      estado_venta: "FACTURADO",
      fecha_checkout: diasAtras(14),
      variantes: [VARIANTE_CAMISA_TACTICA_3_ID],
      pago: { estado: "APROBADO", mercadopago_payment_id: "1320000000009" },
      operador: { id: usuarioOperadorPickPack.id },
      fecha_listo: diasAtras(12),
    },
    {
      // Historial: retirado con QR + DNI → PedidoVenta REMITO_EMITIDO →
      // CERRADO en el mismo commit (E §3.1). Consumió el cupón agotado.
      ids: PEDIDO_WEB_ENTREGADO_IDS,
      numero_venta: "V-2026-000010",
      estado_ecommerce: "ENTREGADO",
      estado_venta: "CERRADO",
      fecha_checkout: diasAtras(20),
      variantes: [VARIANTE_CAMISA_TACTICA_2_ID],
      pago: { estado: "APROBADO", mercadopago_payment_id: "1320000000010" },
      cupon: { aplicacion_id: CUPON_APLICACION_AGOTADO_ID, cupon_id: cuponAgotado.id, porcentaje: 15, confirmada: true },
      operador: { id: usuarioOperadorPickPack.id },
      fecha_listo: diasAtras(19),
    },
    {
      // Orden no abonada anulada manualmente por el Administrador E-commerce
      // (E §2.7): baja lógica en PedidoVenta y en su extensión.
      ids: PEDIDO_WEB_ANULADO_IDS,
      numero_venta: "V-2026-000011",
      estado_ecommerce: "ANULADO",
      estado_venta: "ANULADO",
      fecha_checkout: diasAtras(5),
      variantes: [VARIANTE_CAMISA_TACTICA_3_ID],
      anulacion: { motivo: "El cliente desistió de la compra antes de pagar" },
    },
  ];

  const pedidoWebPorEstado = new Map<string, { id: string; numero_venta: string }>();

  for (const p of pedidosWeb) {
    const fechaPago = sumarHoras(p.fecha_checkout, 10 / 60);
    const fechaAnulacion = sumarHoras(p.fecha_checkout, 2);
    const reservaVigente = p.estado_ecommerce === "PAGO_PENDIENTE";
    const pagoAprobado = p.pago?.estado === "APROBADO";

    // Cierre de la reserva: confirmada por venta al aprobarse el pago;
    // liberada al rechazarse el pago o al anularse la orden.
    const fechaFinReserva = reservaVigente
      ? null
      : p.anulacion
        ? fechaAnulacion
        : fechaPago;

    const subtotal = p.variantes.reduce((acc, vid) => acc + precioVentaPorVariante.get(vid)!, 0);
    const descuento = p.cupon ? redondearCentavos((subtotal * p.cupon.porcentaje) / 100) : 0;
    const total = Math.max(0, redondearCentavos(subtotal - descuento));

    const baja = p.anulacion
      ? {
          is_active: false,
          deleted_at: fechaAnulacion,
          deleted_by: usuarioAdminEcommerce.id,
          deletion_reason: p.anulacion.motivo,
        }
      : {};

    const pedido = await prisma.pedidoVenta.upsert({
      where: { id: p.ids.pedido },
      update: {},
      create: {
        id: p.ids.pedido,
        numero_venta: p.numero_venta,
        cliente_id: clienteJuanPerez.id,
        canal: "WEB",
        estado: p.estado_venta,
        total,
        fecha_facturacion: pagoAprobado ? fechaPago : null,
        registrado_por_id: usuarioCanalWeb.id,
        created_at: p.fecha_checkout,
        ...baja,
      },
    });
    pedidoWebPorEstado.set(`${p.estado_ecommerce}:${p.numero_venta}`, pedido);

    // HU-E4: vencimiento más próximo de las reservas del pedido = `reserva_hasta`
    // de su aplicación de cupón pendiente.
    let vencimientoReserva: Date | null = null;
    for (const [i, variante_sku_id] of p.variantes.entries()) {
      const { item, reserva } = p.ids.items[i];
      // PAGO_PENDIENTE: la expiración (24h) excede a propósito
      // ECOMMERCE_CHECKOUT_TTL_HORAS para que el fixture sobreviva una jornada
      // de desarrollo, y se refresca en cada corrida del seed.
      const fechaExpiracion = reservaVigente
        ? sumarHoras(new Date(), 24)
        : sumarHoras(p.fecha_checkout, ttlCheckoutHoras);
      if (!vencimientoReserva || fechaExpiracion < vencimientoReserva) vencimientoReserva = fechaExpiracion;

      await prisma.reserva.upsert({
        where: { id: reserva },
        update: reservaVigente
          ? { fecha_inicio_reserva: new Date(), fecha_expiracion: fechaExpiracion, fecha_fin_reserva: null }
          : {},
        create: {
          id: reserva,
          variante_sku_id,
          deposito_id: depositoShowroom.id,
          cantidad: 1,
          fecha_inicio_reserva: p.fecha_checkout,
          fecha_expiracion: fechaExpiracion,
          fecha_fin_reserva: fechaFinReserva,
          motivo: `Checkout web — ${p.numero_venta}`,
          origen_reserva: null,
          registrado_por_id: usuarioCanalWeb.id,
        },
      });

      await prisma.pedidoVentaItem.upsert({
        where: { id: item },
        update: {},
        create: {
          id: item,
          pedido_venta_id: pedido.id,
          variante_sku_id,
          cantidad: 1,
          precio_unitario: precioVentaPorVariante.get(variante_sku_id)!,
          reserva_id: reserva,
          cantidad_facturada: pagoAprobado ? 1 : 0,
          cantidad_entregada: p.estado_ecommerce === "ENTREGADO" ? 1 : 0,
        },
      });
    }

    if (p.cupon) {
      // HU-E4: la pendiente acompaña a su reserva (que se refresca en cada
      // corrida); nunca se tocan los campos de baja.
      const reservaHasta = p.cupon.confirmada ? null : vencimientoReserva;
      await prisma.cuponAplicacion.upsert({
        where: { id: p.cupon.aplicacion_id },
        update: p.cupon.confirmada ? {} : { reserva_hasta: reservaHasta },
        create: {
          id: p.cupon.aplicacion_id,
          cupon_id: p.cupon.cupon_id,
          pedido_venta_id: pedido.id,
          cliente_id: clienteJuanPerez.id,
          monto_descontado: descuento,
          confirmada: p.cupon.confirmada,
          reserva_hasta: reservaHasta,
          created_at: p.fecha_checkout,
        },
      });
    }

    await prisma.pedidoVentaEcommerce.upsert({
      where: { pedido_venta_id: pedido.id },
      update: {},
      create: {
        id: p.ids.ecommerce,
        pedido_venta_id: pedido.id,
        estado_ecommerce: p.estado_ecommerce,
        mercadopago_payment_id: p.pago?.mercadopago_payment_id ?? null,
        cupon_aplicacion_id: p.cupon?.aplicacion_id ?? null,
        // Token único por pedido; se conserva en ENTREGADO como historial (la
        // validez del QR se resuelve siempre contra `estado_ecommerce`, E §2.3).
        codigo_qr_retiro: p.fecha_listo
          ? createHash("sha256").update(`seed-qr-retiro:${p.ids.ecommerce}`).digest("hex")
          : null,
        plazo_retiro_vencimiento: p.fecha_listo
          ? sumarHoras(p.fecha_listo, plazoRetiroDias * 24)
          : null,
        operador_asignado_id: p.operador?.id ?? null,
        prioridad_manual: p.operador?.prioridad_manual ?? null,
        fecha_pago_confirmado: pagoAprobado ? fechaPago : null,
        created_at: p.fecha_checkout,
        ...baja,
      },
    });

    // HU-E2: mientras el fixture PAGO_PENDIENTE siga pendiente, re-sembrar le
    // quita la preferencia de Mercado Pago (la reserva se refrescó arriba y la
    // preferencia vieja ya venció): el próximo checkout/pago crea una nueva.
    if (reservaVigente) {
      await prisma.pedidoVentaEcommerce.updateMany({
        where: { id: p.ids.ecommerce, estado_ecommerce: "PAGO_PENDIENTE" },
        data: { mercadopago_preference_id: null, mercadopago_checkout_url: null },
      });
    }

    if (!p.pago) continue;

    // Traza de la notificación (append-only desde HU-E2: sin clave única,
    // idempotente por `payment_id` acá con findFirst + create).
    const trazaWebhook = await prisma.webhookPagoLog.findFirst({
      where: { mercadopago_payment_id: p.pago.mercadopago_payment_id },
      select: { id: true },
    });
    if (!trazaWebhook) {
      await prisma.webhookPagoLog.create({
        data: {
          mercadopago_payment_id: p.pago.mercadopago_payment_id,
          topic: "payment",
          resultado: "SEED",
          created_at: fechaPago,
        },
      });
    }

    if (hayClaveCifrado && p.ids.transaccion) {
      const datosFacturacion = encrypt(datosFacturacionJuanPerez);
      await prisma.transaccionPagoLog.upsert({
        where: { id: p.ids.transaccion },
        update: {},
        create: {
          id: p.ids.transaccion,
          pedido_venta_ecommerce_id: p.ids.ecommerce,
          mercadopago_payment_id: p.pago.mercadopago_payment_id,
          monto: total,
          estado_pago: p.pago.estado,
          resultado_webhook: JSON.stringify({
            id: p.pago.mercadopago_payment_id,
            status: pagoAprobado ? "approved" : "rejected",
            status_detail: pagoAprobado ? "accredited" : "cc_rejected_insufficient_amount",
            transaction_amount: total,
          }),
          datos_facturacion_cifrados: datosFacturacion.ciphertext,
          datos_facturacion_iv: datosFacturacion.iv,
          created_at: fechaPago,
        },
      });
    }

    if (!pagoAprobado) continue;

    await prisma.ventaMedioPago.upsert({
      where: { id: p.ids.medio_pago! },
      update: {},
      create: {
        id: p.ids.medio_pago!,
        pedido_venta_id: pedido.id,
        medio: "MERCADO_PAGO",
        importe: total,
        referencia: p.pago.mercadopago_payment_id,
      },
    });

    // E §2.2: el cliente web no elige comprobante — siempre Factura B.
    await prisma.comprobanteFiscal.upsert({
      where: { id: p.ids.comprobante! },
      update: {},
      create: {
        id: p.ids.comprobante!,
        pedido_venta_id: pedido.id,
        tipo_comprobante: "FACTURA_B",
        cae_simulado: `6803159827${p.numero_venta.slice(-4)}`,
        qr_data_url: "data:image/png;base64,SIMULADO-SEED-NO-AFIP==",
        es_simulado: true,
        monto_total: total,
        emitido_por_id: usuarioCanalWeb.id,
        created_at: fechaPago,
      },
    });

    // HU-G11: caja virtual constante, sin TurnoCaja.
    await prisma.ingresoTesoreria.upsert({
      where: { pedido_venta_id: pedido.id },
      update: {},
      create: {
        pedido_venta_id: pedido.id,
        mercadopago_payment_id: p.pago.mercadopago_payment_id,
        monto: total,
        fecha: fechaPago,
      },
    });
  }

  // ── HU-F2 — Plantillas de notificación ──────────────────────────────────────
  // De la tabla de F §3.3 se siembran solo eventos con nombre confirmado:
  //   - stock:umbral_critico_alcanzado → existe en event-types.ts.
  //   - ecommerce:pedido_listo_para_retiro / ecommerce:pedido_vencido_sin_retiro →
  //     mismo nombre en F §3.3 y E §4; todavía no están en event-types.ts
  //     (se agregan al implementar HU-E12/HU-E13).
  // Sin plantilla, a propósito: `usuario:suspendido_automaticamente` (ejercita
  // el texto por defecto — F §2.2 lo usa de ejemplo). No se siembran los tres
  // "a confirmar" de F §3.3. Tampoco `ecommerce:pedido_pago_confirmado` ni
  // `ecommerce:plazo_retiro_por_vencer` (la de
  // `ecommerce:carrito_articulo_no_disponible` la siembra el bloque HU-E1,
  // más arriba, porque HU-E1 ya emite ese evento): sus nombres ya quedaron alineados
  // entre F §3.3 y E §4, pero se dejan sin plantilla para no ampliar este
  // fixture (el Motor cae al texto por defecto).
  // Placeholders: solo campos que el payload del evento trae (F §3.2).
  const plantillasPorEvento = new Map<string, { id: string; asunto: string; cuerpo: string }>();
  for (const [tipo_evento, asunto, cuerpo, prioridad_default] of [
    [
      "stock:umbral_critico_alcanzado",
      "Stock en umbral crítico",
      "Una variante alcanzó el umbral crítico: quedan {{cantidad_resultante}} unidades (punto de pedido {{punto_pedido}}).",
      "ADVERTENCIA",
    ],
    [
      "ecommerce:pedido_listo_para_retiro",
      "Tu pedido está listo para retirar",
      "Tu pedido {{numero_venta}} ya está listo para retirar en Sucursal Salta.",
      "INFORMATIVA",
    ],
    [
      "ecommerce:pedido_vencido_sin_retiro",
      "Tu pedido venció sin ser retirado",
      "El plazo para retirar tu pedido {{numero_venta}} venció.",
      "CRITICA",
    ],
    [
      // HU-E2 (task §3.2, P10): consumidor de F3 para el Cliente Web.
      "ecommerce:pedido_pago_confirmado",
      "Recibimos tu pago",
      "Tu pedido {{numero_venta}} está confirmado. Te avisamos cuando esté listo para retirar en Sucursal Salta.",
      "INFORMATIVA",
    ],
  ] as const) {
    const plantilla = await prisma.plantillaNotificacion.upsert({
      where: { tipo_evento },
      update: {},
      create: { tipo_evento, asunto, cuerpo, prioridad_default },
    });
    plantillasPorEvento.set(tipo_evento, plantilla);
  }

  // ── HU-F3 — Notificaciones de ejemplo ───────────────────────────────────────
  // `clave_idempotencia` con la fórmula de F §2.3 para eventos sin
  // `evento_id` propio: sha256(tipo_evento:registro_id:destinatario_id). El
  // listener de F3 todavía no existe, así que no hay helper exportado que
  // reutilizar — si al implementarlo cambia la fórmula, estas filas quedan
  // con una clave distinta (sin efecto práctico: son fixtures).
  const claveIdempotencia = (tipoEvento: string, registroId: string, destinatarioId: string) =>
    createHash("sha256").update(`${tipoEvento}:${registroId}:${destinatarioId}`).digest("hex");
  const renderizar = (texto: string, variables: Record<string, string | number>) =>
    Object.entries(variables).reduce(
      (acc, [clave, valor]) => acc.replaceAll(`{{${clave}}}`, String(valor)),
      texto,
    );

  const plantillaUmbral = plantillasPorEvento.get("stock:umbral_critico_alcanzado")!;
  const plantillaListo = plantillasPorEvento.get("ecommerce:pedido_listo_para_retiro")!;
  const archivada = (fecha: Date) => ({ is_active: false, deleted_at: fecha, deleted_by: usuarioEncargado.id });

  // Personal interno — `encargado.seed` (Rol Encargado de Depósito, único
  // destinatario de `stock:umbral_critico_alcanzado` en F §3.3). Las tres son
  // ADVERTENCIA: es la prioridad de ese evento y el Encargado no recibe
  // ningún otro evento de la tabla.
  for (const n of [
    { registro_id: STOCK_CT1_CENTRAL_ID, cantidad: 7, punto_pedido: 8, leida_at: diasAtras(4), extra: {} },
    { registro_id: STOCK_B1_SHOWROOM_ID, cantidad: 2, punto_pedido: 3, leida_at: null, extra: {} },
    { registro_id: STOCK_CT1_SHOWROOM_ID, cantidad: 1, punto_pedido: 2, leida_at: diasAtras(9), extra: archivada(diasAtras(8)) },
  ]) {
    const clave_idempotencia = claveIdempotencia("stock:umbral_critico_alcanzado", n.registro_id, usuarioEncargado.id);
    await prisma.notificacion.upsert({
      where: { clave_idempotencia },
      update: {},
      create: {
        plantilla_id: plantillaUmbral.id,
        tipo_evento: "stock:umbral_critico_alcanzado",
        asunto: plantillaUmbral.asunto,
        cuerpo: renderizar(plantillaUmbral.cuerpo, {
          cantidad_resultante: n.cantidad,
          punto_pedido: n.punto_pedido,
        }),
        prioridad: "ADVERTENCIA",
        clave_idempotencia,
        usuario_destinatario_id: usuarioEncargado.id,
        leida_at: n.leida_at,
        ...n.extra,
      },
    });
  }

  // Cliente Web — Juan Pérez: un aviso de "listo para retirar" por cada
  // pedido que pasó por LISTO_PARA_RETIRO.
  for (const n of [
    { pedido: pedidoWebPorEstado.get("LISTO_PARA_RETIRO:V-2026-000008")!, leida_at: null, extra: {} },
    { pedido: pedidoWebPorEstado.get("LISTO_PARA_RETIRO:V-2026-000009")!, leida_at: diasAtras(11), extra: {} },
    {
      pedido: pedidoWebPorEstado.get("ENTREGADO:V-2026-000010")!,
      leida_at: diasAtras(19),
      extra: { is_active: false, deleted_at: diasAtras(17), deleted_by: cuentaWebJuanPerez.id },
    },
  ]) {
    const clave_idempotencia = claveIdempotencia(
      "ecommerce:pedido_listo_para_retiro",
      n.pedido.id,
      cuentaWebJuanPerez.id,
    );
    await prisma.notificacion.upsert({
      where: { clave_idempotencia },
      update: {},
      create: {
        plantilla_id: plantillaListo.id,
        tipo_evento: "ecommerce:pedido_listo_para_retiro",
        asunto: plantillaListo.asunto,
        cuerpo: renderizar(plantillaListo.cuerpo, { numero_venta: n.pedido.numero_venta }),
        prioridad: "INFORMATIVA",
        clave_idempotencia,
        cuenta_cliente_web_destinatario_id: cuentaWebJuanPerez.id,
        leida_at: n.leida_at,
        ...n.extra,
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

  console.log(
    `\nSeed Sprint 2 — Módulo H / Módulo G completado (password: "${PASSWORD_SEED}"):`,
  );
  console.table({
    comprador_seed: `${usuarioComprador.nombre_usuario}  <${usuarioComprador.email}>`,
    supervisor_compras_seed: `${usuarioSupervisorCompras.nombre_usuario}  <${usuarioSupervisorCompras.email}>`,
    tesorero_seed: `${usuarioTesorero.nombre_usuario}   <${usuarioTesorero.email}>`,
    permiso_cuentas_por_pagar_leer_id: permisoCxpLeer.id,
    permiso_cuentas_por_pagar_pagar_id: permisoCxpPagar.id,
    proveedor_homologado_id: proveedorHomologado.id,
    proveedor_pendiente_id: proveedorPendiente.id,
    lista_precio_version_vigente_id: listaPrecioVersion.id,
    orden_compra_confirmada_id: ordenCompraConfirmada.id,
    orden_compra_numero: ordenCompraConfirmada.numero_orden,
    orden_compra_recibida_id: ordenCompraRecibida.id,
    orden_compra_recibida_numero: ordenCompraRecibida.numero_orden,
    orden_compra_h4_v2_manual_id: ordenCompraH4V2Manual.id,
    orden_compra_h4_v2_manual_numero: ordenCompraH4V2Manual.numero_orden,
    permiso_comprobantes_crear_id: permisoComprobantesCrear.id,
    permiso_comprobantes_leer_id: permisoComprobantesLeer.id,
    permiso_comprobantes_anular_id: permisoComprobantesAnular.id,
    recepcion_id: recepcionSeed.id,
    cuenta_por_pagar_id: CUENTA_POR_PAGAR_PROVISORIA_ID,
    evaluacion_proveedor_id: EVALUACION_PROVEEDOR_SEED_ID,
  });

  console.log("\nSeed Sprint 3 — Módulo C (Clientes) + cierre Módulo H completado:");
  console.table({
    vendedor_seed: `${usuarioVendedor.nombre_usuario}  <${usuarioVendedor.email}>`,
    lista_precio_version_2_id: listaPrecioVersion2.id,
    proveedor_segundo_homologado_id: proveedorSegundoHomologado.id,
    lista_precio_version_segundo_id: listaPrecioVersionSegundo.id,
    permiso_clientes_leer_id: PERMISO_CLIENTES_LEER_ID,
    permiso_auditoria_leer_historico_id: PERMISO_AUDITORIA_LEER_HISTORICO_ID,
    permiso_proveedores_publicar_lista_id: PERMISO_PROVEEDORES_PUBLICAR_LISTA_ID,
    cliente_juan_perez_id: clienteJuanPerez.id,
    cliente_juan_perez_duplicado_id: clienteJuanPerezDuplicado.id,
    cliente_maria_gomez_primario_id: clienteMariaGomezPrimario.id,
    cliente_maria_gomez_fusionado_id: clienteMariaGomezFusionado.id,
  });

  console.log(
    `\nSeed Sprint 3 — Módulo B (Ventas y Punto de Venta) completado (password: "${PASSWORD_SEED}"):`,
  );
  console.table({
    cajero_seed: `${usuarioCajero.nombre_usuario}  <${usuarioCajero.email}>`,
    supervisor_ventas_seed: `${usuarioSupervisorVentas.nombre_usuario}  <${usuarioSupervisorVentas.email}>`,
    permiso_ventas_registrar_mostrador_id: PERMISO_VENTAS_REGISTRAR_MOSTRADOR_ID,
    permiso_ventas_leer_id: PERMISO_VENTAS_LEER_ID,
    permiso_ventas_anular_pedido_id: PERMISO_VENTAS_ANULAR_PEDIDO_ID,
    permiso_ventas_leer_log_operativo_id: PERMISO_VENTAS_LEER_LOG_OPERATIVO_ID,
    turno_caja_abierto_id: turnoCajaAbierto.id,
    pedido_venta_mostrador_id: pedidoVentaMostrador.id,
    pedido_venta_mostrador_numero: pedidoVentaMostrador.numero_venta,
    pedido_venta_mostrador_cliente: clienteJuanPerez.nombre,
    comprobante_fiscal_mostrador_id: COMPROBANTE_FISCAL_MOSTRADOR_ID,
    presupuesto_licitacion_id: presupuestoLicitacion.id,
    reserva_presupuesto_licitacion_id: reservaPresupuestoLicitacion.id,
    pedido_venta_licitacion_id: pedidoVentaLicitacion.id,
    pedido_venta_licitacion_numero: pedidoVentaLicitacion.numero_venta,
    pedido_venta_remito_parcial_id: pedidoVentaRemitoParcial.id,
    pedido_venta_remito_parcial_numero: pedidoVentaRemitoParcial.numero_venta,
    cuenta_corriente_juan_perez_id: cuentaCorrienteJuanPerez.id,
    cuenta_corriente_operacion_aprobada_id: CUENTA_CORRIENTE_OPERACION_APROBADA_ID,
    cuenta_corriente_operacion_retenida_id: CUENTA_CORRIENTE_OPERACION_RETENIDA_ID,
  });

  console.log(
    `\nSeed Sprint 4 — Módulo E / HU-B9 / ConfiguracionSistema completado (password: "${PASSWORD_SEED}"):`,
  );
  console.table({
    admin_ecommerce_seed: `${usuarioAdminEcommerce.nombre_usuario}  <${usuarioAdminEcommerce.email}>`,
    operador_pickpack_seed: `${usuarioOperadorPickPack.nombre_usuario}  <${usuarioOperadorPickPack.email}>`,
    admin_plataforma_seed: `${usuarioAdminPlataforma.nombre_usuario}  <${usuarioAdminPlataforma.email}>`,
    rol_administrador_plataforma_id: rolAdministradorPlataforma.id,
    usuario_canal_web_id: `${usuarioCanalWeb.id}  (sistema, sin login)`,
    rol_administrador_ecommerce_id: rolAdministradorEcommerce.id,
    rol_operador_pick_pack_id: rolOperadorPickPack.id,
    lista_precio_venta_general_id: listaPrecioVentaGeneral.id,
    lista_precio_venta_version_1_id: listaPrecioVentaVersion1.id,
    ecommerce_deposito_canal_web_id: depositoShowroom.id,
    cuenta_web_juan_perez: `${cuentaWebJuanPerez.email}  (password: "${PASSWORD_SEED}")`,
    cuenta_web_maria_gomez_pendiente: `${cuentaWebMariaGomez.email}  (vinculacion_pendiente)`,
    conector_pago_sandbox: hayClaveCifrado
      ? `${CONECTOR_PAGO_SANDBOX_ID}  (credenciales ${credencialesMpReales ? "MP_SANDBOX_* del entorno" : "FICTICIAS"})`
      : "OMITIDO (sin ENCRYPTION_KEY_PROVEEDORES)",
    hu_e2_pedido_pendiente_external_reference: `${PEDIDO_WEB_PAGO_PENDIENTE_IDS.ecommerce}  (V-2026-000004, Juan Pérez)`,
    cupones: "SWAT10 (vigente) · INVIERNO5000 (vencido) · LANZAMIENTO15 (agotado)",
    producto_web_no_visible: productoGorraTactica.nombre,
    hu_e1_cuenta_web: `${cuentaWebCarlosRuiz.email}  (password: "${PASSWORD_SEED}")`,
    hu_e1_sku_inactivo: skuCamisaInactiva,
    hu_e1_producto_maestro_inactivo: productoChaleco.nombre,
    hu_e1_carrito_visitante_token: CARRITO_VISITANTE_TOKEN_SEED,
    ...Object.fromEntries(
      [...pedidoWebPorEstado.entries()].map(([clave, pedido]) => [
        `pedido_web_${clave.split(":")[0].toLowerCase()}_${pedido.numero_venta.slice(-2)}`,
        pedido.numero_venta,
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
