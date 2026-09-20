import "server-only";

/**
 * @module cliente.service
 * @description Capa de dominio de HU-C1 — Alta de Cliente con validación de
 * unicidad por DNI (spec_modulo_C.md §2.1, §3.1, §4).
 *
 * TODA la lógica de negocio del alta vive acá: el Route Handler
 * (`app/api/clientes/route.ts`) y la Server Action
 * (`app/(dashboard)/clientes/actions.ts`) son wrappers finos — resuelven
 * sesión + permiso granular, parsean el body con Zod, invocan la función de
 * este archivo y mapean el resultado a `{ data, error }`. Está prohibido
 * reimplementar cualquier regla de acá en esas capas (spec §1).
 *
 * Reglas transversales aplicadas (RULES.md §1/§2, spec §3.1/§3.3/§3.4):
 *  - Ninguna función de este archivo hace un borrado físico de fila alguna.
 *  - El alta corre dentro de un único `prisma.$transaction`, incluyendo el
 *    `ConsentimientoCliente` inicial obligatorio (spec §2.1). `crearClienteTx`
 *    es el núcleo reutilizable (recibe el `tx` del caller, no abre
 *    transacción ni emite eventos — mismo patrón que
 *    `registrarIngresoStockTx` en `movimiento.service.ts`); `crearCliente`
 *    es el wrapper público que abre `prisma.$transaction` y emite el evento
 *    post-COMMIT.
 *  - El evento de dominio se emite DESPUÉS del `COMMIT`, nunca dentro
 *    (patrón fire-and-forget del resto del proyecto) — y SOLO cuando el
 *    alta crea un registro nuevo, nunca al recuperar uno existente.
 *  - `posibles_duplicados` (coincidencia aproximada nombre+contacto) es
 *    criterio de aceptación de HU-C5 (spec §2.5), no de esta HU — spec §2.1
 *    solo la menciona de pasada ("descripta en HU-C5"). Queda deliberadamente
 *    fuera de este service; no se agrega el campo a la respuesta.
 */

import {
  Prisma,
  type CanalContacto,
  type SegmentoComercial,
  type TipoDireccionCliente,
} from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import { ServiceError } from "@/lib/errors/service-error";
import type {
  ActualizarCanalContactoInput,
  AgregarDireccionClienteInput,
  CrearClienteInput,
} from "@/lib/schemas/clientes.schema";
// Módulo puro alias-free (Deviation D1): la regla estructural se testea
// unitariamente bajo el runner nativo de Node, que no resuelve alias.
import { validarReglaDireccionEnvio } from "./direccion-cliente.reglas";

// ──────────────────────────────────────────────────────────────────────────────
// Permisos granulares (spec §2.1 + Alcance §5) — un permiso independiente
// por acción, punto de verdad compartido por Route Handler y Server Action.
// ──────────────────────────────────────────────────────────────────────────────

export const PERMISO_CREAR = "clientes:crear";
// HU-C3 (spec_modulo_C.md §2.3): alta/listado de direcciones reutilizan los
// permisos granulares ya sembrados de Módulo C — un permiso por acción, nunca
// un `administrar` genérico (RULES.md).
export const PERMISO_EDITAR = "clientes:editar";
export const PERMISO_LEER = "clientes:leer";

// ──────────────────────────────────────────────────────────────────────────────
// Consentimiento mínimo del alta (decisión de producto — no es un campo del
// formulario ni de CrearClienteSchema): HU-C1 exige un ConsentimientoCliente
// en la misma transacción (spec §2.1) pero CrearClienteSchema no trae
// alcance/finalidad (esos campos son de RegistrarConsentimientoSchema,
// endpoint separado de HU-C4). Estos valores fijos son el mínimo obligatorio
// para que el Cliente pueda existir; HU-C4 (`POST
// /clientes/[id]/consentimientos`) es la vía para ampliarlo o revocarlo
// después — este service nunca la reemplaza.
// ──────────────────────────────────────────────────────────────────────────────

const ALCANCE_CONSENTIMIENTO_ALTA = "VENTA_ASISTIDA" as const;
const FINALIDAD_CONSENTIMIENTO_ALTA =
  "Venta asistida — consentimiento mínimo registrado en el alta del cliente (HU-C1)";

// ──────────────────────────────────────────────────────────────────────────────
// Tipos públicos
// ──────────────────────────────────────────────────────────────────────────────

export interface ClienteCreado {
  cliente_id: string;
  dni: string;
  es_nuevo: boolean;
}

interface ClienteCreadoTx {
  cliente: { id: string; dni: string };
  esNuevo: boolean;
}

// ──────────────────────────────────────────────────────────────────────────────
// §2.1 — Alta de Cliente con validación de unicidad por DNI
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Núcleo transaccional reutilizable del alta. No abre transacción ni emite
 * eventos: el caller es dueño de ambos límites (mismo patrón que
 * `registrarIngresoStockTx`).
 *
 * Recuperación en vez de duplicado (spec §2.1, §3.1): si ya existe un
 * `Cliente` (activo o no — `dni` es `@unique` a nivel de DB y el criterio de
 * aceptación de HU-C1 no distingue estado) con ese `dni`, devuelve el
 * registro existente sin crear nada nuevo (`esNuevo: false`) — no es una
 * condición de error (spec: "esto es distinto de un 409 Conflict").
 *
 * DNI nuevo → crea el `Cliente` + su `ConsentimientoCliente` inicial (spec
 * §2.1: "no existe un Cliente sin al menos un consentimiento inicial
 * registrado").
 */
export async function crearClienteTx(
  tx: Prisma.TransactionClient,
  input: CrearClienteInput,
): Promise<ClienteCreadoTx> {
  // Pre-check DNI DENTRO de la transacción (mismo patrón race-safe que
  // `crearProveedor`, spec §2.1). Activo o no: HU-C1 recupera cualquier
  // registro existente, no solo los activos.
  const existente = await tx.cliente.findUnique({
    where: { dni: input.dni },
    select: { id: true, dni: true },
  });
  if (existente) {
    return { cliente: existente, esNuevo: false };
  }

  const creado = await tx.cliente.create({
    data: {
      dni: input.dni,
      nombre: input.nombre,
      telefono: input.telefono ?? null,
      email: input.email ?? null,
    },
    select: { id: true, dni: true },
  });

  await tx.consentimientoCliente.create({
    data: {
      cliente_id: creado.id,
      alcance: ALCANCE_CONSENTIMIENTO_ALTA,
      finalidad: FINALIDAD_CONSENTIMIENTO_ALTA,
    },
  });

  return { cliente: creado, esNuevo: true };
}

/**
 * Wrapper público invocado por el Route Handler y la Server Action. Abre
 * `prisma.$transaction`, delega en `crearClienteTx` y, SOLO si el alta creó
 * un registro nuevo, emite `cliente:creado` post-COMMIT (spec §3.1: "no hay
 * transición nueva" al recuperar un DNI existente, nada que auditar).
 *
 * `es_nuevo` es el discriminador que usa el wrapper HTTP/Server Action para
 * responder `201` (alta nueva) vs `200` (registro recuperado) — nunca un
 * `ServiceError` para el caso de recuperación.
 *
 * Carrera de dos altas concurrentes con el mismo DNI nuevo (mismo escenario
 * que "Race CUIT" de `crearProveedor`): el pre-check de `crearClienteTx`
 * puede pasar en ambas transacciones antes de que cualquiera haga el
 * `INSERT`; la que pierde la carrera recibe `P2002` del `@unique` de `dni`
 * — acá se traduce a una recuperación (`es_nuevo: false`), nunca un error,
 * porque HU-C1 nunca debe fallar por un DNI duplicado.
 */
export async function crearCliente(
  input: CrearClienteInput,
  usuarioId: string,
): Promise<ClienteCreado> {
  let resultado: ClienteCreadoTx;
  try {
    resultado = await prisma.$transaction((tx: Prisma.TransactionClient) =>
      crearClienteTx(tx, input),
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existente = await prisma.cliente.findUniqueOrThrow({
        where: { dni: input.dni },
        select: { id: true, dni: true },
      });
      return { cliente_id: existente.id, dni: existente.dni, es_nuevo: false };
    }
    throw error;
  }

  if (resultado.esNuevo) {
    domainEventBus.emit("cliente:creado", {
      cliente_id: resultado.cliente.id,
      dni: resultado.cliente.dni,
      usuario_id: usuarioId,
      es_nuevo: true,
    });
  }

  return {
    cliente_id: resultado.cliente.id,
    dni: resultado.cliente.dni,
    es_nuevo: resultado.esNuevo,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// §2.3 — HU-C3: registrar más de una dirección (facturación y envío)
//
// Mismo patrón que HU-C1 (arriba): un núcleo transaccional reutilizable
// (`agregarDireccionClienteTx`, recibe el `tx` del caller, no abre transacción
// ni emite eventos) + un wrapper público (`agregarDireccionCliente`) que abre
// `prisma.$transaction` y emite el evento de dominio post-COMMIT. La Server
// Action y el Route Handler son wrappers finos sobre el wrapper.
//
// CONTEXTO DE MODELO (directiva fijada, NO reinventar): `Cliente` no tiene
// campo `direccion` propio — toda dirección vive en `DireccionCliente`,
// incluida la primera (HU-C3 §2.3), con `tipo` del enum
// `TipoDireccionCliente { FACTURACION, ENVIO }` ya existente en
// `schema.prisma`. Ninguna dirección se borra físicamente (soft delete
// estricto), y este service nunca llama `prisma.*.delete()`/`deleteMany()`.
// ──────────────────────────────────────────────────────────────────────────────

/** Dirección devuelta por el alta (shape público del wrapper). */
export interface DireccionAgregada {
  direccion_id: string;
  rotulo: string;
  tipo: TipoDireccionCliente;
}

/** Opciones del listado de direcciones (spec §2.3). */
export interface ListarDireccionesOptions {
  /**
   * `true` solo para Auditoría (`auditoria:leer_forense`): incluye también
   * las direcciones con `is_active = false`. Default `false` — el listado
   * operativo filtra `is_active = true` (RULES.md §1, spec §3.4).
   */
  incluirInactivas?: boolean;
}

/** Fila de dirección tal como la expone `listarDireccionesCliente`. */
export interface DireccionClienteListada {
  id: string;
  rotulo: string;
  tipo: TipoDireccionCliente;
  direccion_completa: string;
  is_active: boolean;
  created_at: Date;
}

/**
 * Núcleo transaccional reutilizable del alta de una dirección. No abre
 * transacción ni emite eventos: el caller es dueño de ambos límites (mismo
 * patrón que `crearClienteTx`).
 *
 * Orden de operaciones (spec §2.3) — deliberadamente lectura-only antes de
 * cualquier escritura:
 *  1. `findUnique` del cliente (`{ id, is_active }`). No existe **o** está
 *     inactivo ⇒ `CLIENTE_NO_ENCONTRADO` (→ 404). El caso inactivo es
 *     indistinguible del inexistente a propósito: NO se agrega un código
 *     `CLIENTE_INACTIVO` ni un 409 (decisión humana ratificada). Coherente
 *     con el contrato global de baja lógica (los SELECT operativos filtran
 *     `is_active = true`).
 *  2. Si `tipo === "ENVIO"`: `count` (READ-ONLY) de las `FACTURACION`
 *     activas del cliente y aplicación de `validarReglaDireccionEnvio`
 *     ANTES del `create`. Esa es la garantía del 422
 *     `DIRECCION_FACTURACION_REQUERIDA`: si la regla falla, la transacción
 *     se aborta sin haber escrito una sola fila (cero direcciones creadas,
 *     cero eventos emitidos).
 *  3. `create` de la dirección, devolviendo `{ id, rotulo, tipo }`.
 *
 * CONTRATO DE CONSUMO FUTURO — Módulo E (checkout web), documentado, NO
 * construido en este sprint: Módulo E leerá las direcciones del cliente con
 * `listarDireccionesCliente(clienteId, { incluirInactivas: false })`, y
 * consumirá los campos `cliente_id`, `tipo`, `rotulo` y
 * `direccion_completa`; el resultado siempre viene filtrado por
 * `is_active = true`, y las filas con `tipo === "ENVIO"` son las candidatas
 * a despacho. HU-C3 solo modela y persiste el dato para que ese consumo
 * futuro no requiera refundar tablas. Módulo B NO consume
 * `DireccionCliente`: su único punto de integración con Módulo C es la
 * consulta unificada de HU-C7 (fuera de alcance acá).
 */
export async function agregarDireccionClienteTx(
  tx: Prisma.TransactionClient,
  clienteId: string,
  input: AgregarDireccionClienteInput,
): Promise<{ direccion: { id: string; rotulo: string; tipo: TipoDireccionCliente } }> {
  const cliente = await tx.cliente.findUnique({
    where: { id: clienteId },
    select: { id: true, is_active: true },
  });
  if (!cliente || !cliente.is_active) {
    // Inexistente o dado de baja lógica: misma respuesta (ver docstring).
    throw new ServiceError("CLIENTE_NO_ENCONTRADO", "Cliente no encontrado o inactivo");
  }

  if (input.tipo === "ENVIO") {
    const hayFacturacionActiva =
      (await tx.direccionCliente.count({
        where: { cliente_id: clienteId, tipo: "FACTURACION", is_active: true },
      })) > 0;
    // Lanza antes del `create` → la transacción revierte sin escrituras.
    validarReglaDireccionEnvio("ENVIO", hayFacturacionActiva);
  }

  const direccion = await tx.direccionCliente.create({
    data: {
      cliente_id: clienteId,
      rotulo: input.rotulo,
      tipo: input.tipo,
      direccion_completa: input.direccion_completa,
    },
    select: { id: true, rotulo: true, tipo: true },
  });

  return { direccion };
}

/**
 * Wrapper público invocado por el Route Handler
 * (`POST /api/clientes/[id]/direcciones`) y la Server Action. Abre
 * `prisma.$transaction`, delega en `agregarDireccionClienteTx` y emite
 * `cliente:actualizado` DESPUÉS del COMMIT (spec §4) — nunca dentro de la
 * transacción.
 *
 * `clienteId` es la única fuente de verdad del cliente: se resuelve en el
 * path `[id]` de la ruta y viaja como argumento explícito. Jamás se lee un
 * `cliente_id` del body (spec §2.3).
 *
 * El payload del evento NO copia datos personales (`email`/`telefono`) —
 * solo la referencia del cliente y los datos de la dirección creada
 * (spec §4, regla de minimización del payload).
 */
export async function agregarDireccionCliente(
  clienteId: string,
  input: AgregarDireccionClienteInput,
  usuarioId: string,
): Promise<DireccionAgregada> {
  const { direccion } = await prisma.$transaction((tx: Prisma.TransactionClient) =>
    agregarDireccionClienteTx(tx, clienteId, input),
  );

  // Post-COMMIT, fire-and-forget (spec §3.3/§4): la única vía de escritura a
  // `AuditLog` es `audit-log.listener.ts`, que reacciona a este evento.
  domainEventBus.emit("cliente:actualizado", {
    cliente_id: clienteId,
    usuario_id: usuarioId,
    campos_modificados: ["direcciones"],
    valor_anterior: null,
    valor_nuevo: { id: direccion.id, tipo: direccion.tipo, rotulo: direccion.rotulo },
  });

  return {
    direccion_id: direccion.id,
    rotulo: direccion.rotulo,
    tipo: direccion.tipo,
  };
}

/**
 * Listado de direcciones de un cliente (spec §2.3). SOLO LECTURA — no emite
 * eventos.
 *
 * `is_active = true` es el default operativo (RULES.md §1: los SELECT
 * operativos filtran la baja lógica); `incluirInactivas: true` es el bypass
 * de Auditoría, que el Route Handler habilita únicamente con
 * `usuarioTienePermiso(usuarioId, "auditoria:leer_forense")`. El service
 * recibe el flag ya resuelto: la autorización se decide en el wrapper, no
 * acá.
 *
 * Orden estable `created_at asc` para que la UI muestre las direcciones en
 * el orden en que fueron cargadas y las corridas de test sean deterministas.
 *
 * CONTRATO DE CONSUMO FUTURO — Módulo E: ver el docstring de
 * `agregarDireccionClienteTx` (campos consumidos `cliente_id`, `tipo`,
 * `rotulo`, `direccion_completa`; `ENVIO` = candidatas a despacho; Módulo E
 * NO se construye este sprint).
 */
export async function listarDireccionesCliente(
  clienteId: string,
  options: ListarDireccionesOptions = {},
): Promise<DireccionClienteListada[]> {
  return prisma.direccionCliente.findMany({
    where: {
      cliente_id: clienteId,
      ...(options.incluirInactivas ? {} : { is_active: true }),
    },
    select: {
      id: true,
      rotulo: true,
      tipo: true,
      direccion_completa: true,
      is_active: true,
      created_at: true,
    },
    orderBy: { created_at: "asc" },
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Listado de clientes (solo lectura) — pantalla `/clientes`
//
// Alimenta el listado del Módulo C (la entrada que faltaba para llegar a la
// ficha `/clientes/[id]`, donde viven las direcciones de HU-C3 y el canal
// preferido de HU-C9). No es una HU en sí: es la pantalla que conecta el alta
// con la ficha.
// ──────────────────────────────────────────────────────────────────────────────

/** Fila de cliente tal como la expone `listarClientes`. */
export interface ClienteListado {
  id: string;
  dni: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  canal_preferido: CanalContacto | null;
  segmento: SegmentoComercial;
}

/**
 * Listado de clientes activos para la pantalla `/clientes`. SOLO LECTURA — no
 * escribe, no emite eventos de dominio y jamás usa `delete()`.
 *
 * Filtra `is_active = true` (RULES.md Regla N.° 1 — baja lógica: un cliente
 * dado de baja permanece en la base para trazabilidad, pero queda fuera de
 * este listado). Ver los inactivos es privilegio de Auditoría
 * (`auditoria:leer_forense`) y está fuera del alcance de esta pantalla.
 *
 * Orden `created_at desc`: los últimos clientes cargados primero, que es el
 * caso de uso del Vendedor apenas da de alta uno nuevo.
 */
export async function listarClientes(): Promise<ClienteListado[]> {
  return prisma.cliente.findMany({
    where: { is_active: true },
    select: {
      id: true,
      dni: true,
      nombre: true,
      telefono: true,
      email: true,
      canal_preferido: true,
      segmento: true,
    },
    orderBy: { created_at: "desc" },
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// §2.3 — HU-C9: canal de contacto preferido (WhatsApp / Email / Ambos)
//
// `canal_preferido` es un atributo simple de `Cliente` (NO una entidad
// propia): vive en la columna `canal_preferido` con el enum `CanalContacto`
// `{ WHATSAPP, EMAIL, AMBOS }` ya fijado en `schema.prisma`, y es editable en
// cualquier momento — no hay máquina de estados (spec §2.3). Este service
// nunca llama `prisma.*.delete()`/`deleteMany()`.
//
// CONTRATO DE CONSUMO FUTURO — Módulo F (Motor de Notificaciones),
// documentado, NO construido en este sprint: la fuente ÚNICA es
// `Cliente.canal_preferido`, leída por `cliente_id` (sin copia ni tabla
// espejo, para que el cambio de canal no tenga que replicarse en dos
// lugares). Los tres valores posibles son WHATSAPP / EMAIL / AMBOS. El campo
// PUEDE ser `null` (el cliente nunca eligió canal): el consumidor decide su
// propio fallback y NO debe asumir un default — qué hacer ante `null` es una
// decisión de producto de Módulo F, no de este módulo. Módulo F no se
// construye este sprint; el dato se modela y persiste ahora para que ese
// sprint no necesite refactorizar nada.
// ──────────────────────────────────────────────────────────────────────────────

/** Resultado público de `actualizarCanalContacto` (shape del endpoint). */
export interface CanalContactoActualizado {
  cliente_id: string;
  canal_preferido: CanalContacto;
}

/**
 * Núcleo transaccional reutilizable de la actualización del canal de
 * contacto. No abre transacción ni emite eventos: el caller es dueño de
 * ambos límites (mismo patrón que `crearClienteTx` / `agregarDireccionClienteTx`).
 *
 * La lectura del valor anterior y la escritura del nuevo ocurren en la MISMA
 * transacción, con el mismo `tx`: así el `valor_anterior` que se audita es
 * exactamente el que existía justo antes del `update` y no puede ser
 * pisado por una escritura concurrente entre ambas operaciones.
 *
 * Cliente inexistente **o** `is_active = false` ⇒ `CLIENTE_NO_ENCONTRADO`
 * (→ 404). El caso inactivo es indistinguible del inexistente a propósito:
 * NO se agrega un código `CLIENTE_INACTIVO` ni un 409 (decisión humana
 * ratificada, coherente con el contrato global de baja lógica).
 */
export async function actualizarCanalContactoTx(
  tx: Prisma.TransactionClient,
  clienteId: string,
  input: ActualizarCanalContactoInput,
): Promise<{ anterior: CanalContacto | null; nuevo: CanalContacto }> {
  const cliente = await tx.cliente.findUnique({
    where: { id: clienteId },
    select: { id: true, is_active: true, canal_preferido: true },
  });
  if (!cliente || !cliente.is_active) {
    throw new ServiceError("CLIENTE_NO_ENCONTRADO", "Cliente no encontrado o inactivo");
  }

  const anterior = cliente.canal_preferido;
  const actualizado = await tx.cliente.update({
    where: { id: clienteId },
    data: { canal_preferido: input.canal_preferido },
    select: { canal_preferido: true },
  });

  return { anterior, nuevo: actualizado.canal_preferido! };
}

/**
 * Wrapper público invocado por el Route Handler
 * (`PATCH /api/clientes/[id]/canal-contacto`) y la Server Action. Abre
 * `prisma.$transaction`, delega en `actualizarCanalContactoTx` y emite
 * `cliente:actualizado` DESPUÉS del COMMIT (spec §3.3/§4) — nunca dentro de
 * la transacción, y nunca llamando a `registrarAuditLog()` (el listener de
 * auditoría es la única vía de escritura a `AuditLog`).
 *
 * `clienteId` es la única fuente de verdad del cliente: se resuelve en el
 * path `[id]` de la ruta y viaja como argumento explícito. Jamás se lee un
 * `cliente_id` del body (spec §2.3).
 *
 * HU-C9 aporta los campos opcionales `accion:"UPDATE"`,
 * `tabla_afectada:"clientes"` y `registro_id: clienteId` para que el
 * listener derive un asiento UPDATE sobre `clientes` en vez de los defaults
 * históricos de HU-C3 (`CREATE` / `direcciones_cliente`); ver
 * `audit-log.listener.ts` (design §2).
 */
export async function actualizarCanalContacto(
  clienteId: string,
  input: ActualizarCanalContactoInput,
  usuarioId: string,
): Promise<CanalContactoActualizado> {
  const { anterior, nuevo } = await prisma.$transaction((tx: Prisma.TransactionClient) =>
    actualizarCanalContactoTx(tx, clienteId, input),
  );

  // Post-COMMIT, fire-and-forget (spec §3.3/§4): la única vía de escritura a
  // `AuditLog` es `audit-log.listener.ts`, que reacciona a este evento.
  domainEventBus.emit("cliente:actualizado", {
    cliente_id: clienteId,
    usuario_id: usuarioId,
    campos_modificados: ["canal_preferido"],
    valor_anterior: { canal_preferido: anterior },
    valor_nuevo: { canal_preferido: nuevo },
    accion: "UPDATE",
    tabla_afectada: "clientes",
    registro_id: clienteId,
  });

  return { cliente_id: clienteId, canal_preferido: nuevo };
}
