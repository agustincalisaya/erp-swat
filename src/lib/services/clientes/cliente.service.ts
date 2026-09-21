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
  ActualizarSegmentoClienteInput,
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

// ──────────────────────────────────────────────────────────────────────────────
// §2.8 — HU-C8: segmentación comercial (Minorista / Mayorista / Cliente frecuente)
//
// `segmento` es un atributo simple de `Cliente` (NO una entidad propia): vive
// en la columna `segmento` con el enum `SegmentoComercial`
// `{ MINORISTA, MAYORISTA, CLIENTE_FRECUENTE }` ya fijado en `schema.prisma`,
// es `NOT NULL DEFAULT 'MINORISTA'` y es reasignable en cualquier momento — no
// hay máquina de estados ni transiciones prohibidas (spec §2.8). Este service
// nunca llama `prisma.*.delete()`/`deleteMany()`.
//
// La asignación es MANUAL: el sistema NO calcula el segmento por
// volumen/frecuencia de compra ni lo dispara por eventos de venta. Los umbrales
// de volumen/frecuencia NO existen como configuración parametrizable (spec §5,
// Fuera de Alcance) — por eso acá no hay ninguna tabla/entidad de configuración
// de umbrales y la asignación queda 100% en manos del usuario. El default
// reside en la columna DB: un alta (HU-C1) nunca escribe `segmento`
// explícitamente (spec §2.8). Cuando en el futuro se construya esa entidad de
// configuración, la automatización se puede agregar SIN refactor de este
// endpoint: la escritura sigue siendo un update de `Cliente.segmento`.
//
// CONTRATO DE CONSUMO — Módulo B (condiciones de precio y plan de pagos),
// documentado, NO construido en este sprint: la fuente ÚNICA es
// `Cliente.segmento`, leída por `cliente_id` (sin copia ni campo duplicado,
// para que el cambio de segmento no tenga que replicarse en dos lugares).
//  - `MINORISTA` es el default y NO habilita condiciones especiales.
//  - `MAYORISTA` habilitará condiciones de precio / plan de pagos en Módulo B.
//  - `CLIENTE_FRECUENTE` habilitará promociones, SIN alterar el límite de
//    crédito del cliente (spec §2.8, invariante sin efectos colaterales).
// HOY ninguna parte de Módulo B lee el segmento — verificado: cero referencias
// en `src/lib/services/ventas/**`, `src/app/api/ventas/**` y
// `src/components/ventas/**`. La spec NO afirma que ya lo consume; este módulo
// solo modela y persiste el dato ahora para que ese sprint no necesite
// refactorizar nada. Cuando Módulo B lo consuma, MUST leerlo por `cliente_id`.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Permiso granular de HU-C8 — separado de `clientes:editar` por decisión de
 * RBAC: gestionar el segmento comercial es una acción distinta de editar los
 * datos de contacto (spec §2.8, partición deliberada).
 */
export const PERMISO_GESTIONAR_SEGMENTO = "clientes:gestionar_segmento";

/** Resultado público de `actualizarSegmentoCliente` (shape del endpoint §2.8). */
export interface SegmentoActualizado {
  cliente_id: string;
  segmento_anterior: SegmentoComercial;
  segmento_nuevo: SegmentoComercial;
}

/**
 * Núcleo transaccional reutilizable de la actualización del segmento. No abre
 * transacción ni emite eventos: el caller es dueño de ambos límites (mismo
 * patrón que `crearClienteTx` / `actualizarCanalContactoTx`).
 *
 * La lectura del valor anterior y la escritura del nuevo ocurren en la MISMA
 * transacción, con el mismo `tx`: así el `segmento_anterior` que se audita es
 * exactamente el que existía justo antes del `update` y no puede ser pisado por
 * una escritura concurrente entre ambas operaciones.
 *
 * Cliente inexistente **o** `is_active = false` ⇒ `CLIENTE_NO_ENCONTRADO`
 * (→ 404). El caso inactivo es indistinguible del inexistente a propósito: NO
 * se agrega un código `CLIENTE_INACTIVO` ni un 409 (mismo contrato que HU-C9).
 */
export async function actualizarSegmentoClienteTx(
  tx: Prisma.TransactionClient,
  clienteId: string,
  input: ActualizarSegmentoClienteInput,
): Promise<{ anterior: SegmentoComercial; nuevo: SegmentoComercial }> {
  const cliente = await tx.cliente.findUnique({
    where: { id: clienteId },
    select: { id: true, is_active: true, segmento: true },
  });
  if (!cliente || !cliente.is_active) {
    throw new ServiceError("CLIENTE_NO_ENCONTRADO", "Cliente no encontrado o inactivo");
  }

  const anterior = cliente.segmento;
  const actualizado = await tx.cliente.update({
    where: { id: clienteId },
    data: { segmento: input.segmento },
    select: { segmento: true },
  });

  return { anterior, nuevo: actualizado.segmento };
}

/**
 * Wrapper público invocado por el Route Handler
 * (`PATCH /api/clientes/[id]/segmento`) y la Server Action. Abre
 * `prisma.$transaction`, delega en `actualizarSegmentoClienteTx` y emite
 * `cliente:actualizado` DESPUÉS del COMMIT (spec §3.3/§4) — nunca dentro de la
 * transacción, y nunca llamando a `registrarAuditLog()` (el listener de
 * auditoría es la única vía de escritura a `AuditLog`).
 *
 * `clienteId` es la única fuente de verdad del cliente: se resuelve en el path
 * `[id]` de la ruta y viaja como argumento explícito. Jamás se lee un
 * `cliente_id` del body (spec §2.8).
 *
 * Aporta `accion:"UPDATE"`, `tabla_afectada:"clientes"` y `registro_id:
 * clienteId` para que el listener derive un asiento UPDATE sobre `clientes` en
 * vez de los defaults históricos de HU-C3 (`CREATE` / `direcciones_cliente`)
 * igual que HU-C9; ver `audit-log.listener.ts`.
 */
export async function actualizarSegmentoCliente(
  clienteId: string,
  input: ActualizarSegmentoClienteInput,
  usuarioId: string,
): Promise<SegmentoActualizado> {
  const { anterior, nuevo } = await prisma.$transaction((tx: Prisma.TransactionClient) =>
    actualizarSegmentoClienteTx(tx, clienteId, input),
  );

  // Post-COMMIT, fire-and-forget (spec §3.3/§4): la única vía de escritura a
  // `AuditLog` es `audit-log.listener.ts`, que reacciona a este evento.
  domainEventBus.emit("cliente:actualizado", {
    cliente_id: clienteId,
    usuario_id: usuarioId,
    campos_modificados: ["segmento"],
    valor_anterior: { segmento: anterior },
    valor_nuevo: { segmento: nuevo },
    accion: "UPDATE",
    tabla_afectada: "clientes",
    registro_id: clienteId,
  });

  return { cliente_id: clienteId, segmento_anterior: anterior, segmento_nuevo: nuevo };
}

// ──────────────────────────────────────────────────────────────────────────────
// §2.7 — HU-C7: consulta unificada de un cliente por DNI
//
// Única operación de Módulo C estrictamente de SOLO LECTURA: no abre
// `$transaction`, no escribe ninguna fila y no emite ningún evento de
// dominio. Su fuente de historial es `PedidoVenta` — modelo de Módulo B —,
// que se LEE on-demand (nunca se cachea ni se persiste en Módulo C).
// ──────────────────────────────────────────────────────────────────────────────

/** Dirección tal como la expone la ficha unificada §2.7. */
export interface DireccionUnificada {
  direccion_id: string;
  rotulo: string;
  tipo: TipoDireccionCliente;
}

/**
 * Resumen de historial de compras (§2.7). `monto_total_historico` es un
 * `number` (no `Decimal`): Prisma serializa `Decimal` a string en JSON, y el
 * contrato del spec exige el número (`458000.00` → `458000`).
 */
export interface ResumenHistorialCompras {
  ultima_compra: Date | null;
  monto_total_historico: number;
  cantidad_operaciones: number;
}

/** Ficha unificada completa devuelta por `consultarClientePorDni` (§2.7). */
export interface ConsultaUnificadaCliente {
  cliente_id: string;
  dni: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  direcciones: DireccionUnificada[];
  canal_preferido: CanalContacto | null;
  historial_compras: ResumenHistorialCompras;
}

/**
 * HU-C7 (spec_modulo_C.md §2.7) — Ficha unificada en UNA sola llamada:
 * contacto + direcciones + canal preferido + resumen de historial de compras.
 *
 * SOLO LECTURA: no emite eventos de dominio, no escribe en la base y no abre
 * `$transaction`. Es la consulta que el POS usa antes de iniciar una venta
 * asistida, para no encadenar peticiones ("Historial de compras" del flujo).
 *
 * Reglas del contrato §2.7:
 *  - Resuelve el cliente por `dni` y `is_active = true` (baja lógica estricta,
 *    RULES.md Regla N.° 1: un cliente dado de baja es invisible a esta
 *    consulta, igual que para el resto de las operaciones).
 *  - Si no existe un cliente activo con ese DNI, lanza
 *    `CLIENTE_NO_ENCONTRADO` **con el DNI en el mensaje** — el POS lo
 *    interpreta como "cliente no registrado" y ofrece el alta, no como un
 *    error bloqueante.
 *  - `telefono`, `email` y `canal_preferido` pueden ser `null` y se propagan
 *    tal cual (nunca se default-ean).
 *  - Las direcciones se resuelven REUSANDO `listarDireccionesCliente`
 *    (default `is_active = true`) — no se escribe una query de direcciones
 *    nueva. El mapeo `id` → `direccion_id` y el recorte de la respuesta a
 *    `{ direccion_id, rotulo, tipo }` son parte del contrato: la ficha NO
 *    expone `is_active` ni `created_at`.
 *  - El payload NO incluye `segmento`, campos `deleted_*` ni
 *    `fusionado_en_id` (minimización del payload; HU-C8 y HU-C5 tienen sus
 *    propios contratos).
 *
 * @throws {ServiceError} `CLIENTE_NO_ENCONTRADO` si no hay cliente activo con ese DNI.
 */
export async function consultarClientePorDni(dni: string): Promise<ConsultaUnificadaCliente> {
  const cliente = await prisma.cliente.findFirst({
    where: { dni, is_active: true },
    select: {
      id: true,
      dni: true,
      nombre: true,
      telefono: true,
      email: true,
      canal_preferido: true,
    },
  });

  if (!cliente) {
    throw new ServiceError(
      "CLIENTE_NO_ENCONTRADO",
      `No existe un cliente activo con el DNI ${dni}`,
    );
  }

  const direcciones: DireccionUnificada[] = (await listarDireccionesCliente(cliente.id)).map(
    (direccion) => ({
      direccion_id: direccion.id,
      rotulo: direccion.rotulo,
      tipo: direccion.tipo,
    }),
  );

  const historial = await resolverHistorialCompras(cliente.id);

  return {
    cliente_id: cliente.id,
    dni: cliente.dni,
    nombre: cliente.nombre,
    telefono: cliente.telefono,
    email: cliente.email,
    direcciones,
    canal_preferido: cliente.canal_preferido,
    historial_compras: historial,
  };
}

/**
 * HU-C7 (spec_modulo_C.md §2.7) — Resumen del historial de compras de un
 * cliente. SOLO LECTURA.
 *
 * FUENTE ÚNICA: `PedidoVenta` (Módulo B), leída **on-demand** en cada
 * consulta — nunca cacheada ni persistida en Módulo C. Módulo C no es dueño
 * de los pedidos: este helper solo agrega, jamás escribe ni emite eventos.
 * Por eso no hay ningún campo `monto_total_historico` persistido en
 * `Cliente`: la verdad vive en los pedidos y se recalcula al consultar.
 *
 * FILTRO DE ESTADOS: solo cuentan las operaciones EFECTIVAS —
 * `FACTURADO`, `REMITO_EMITIDO` y `CERRADO`. `RESERVADO` (todavía no
 * facturado: un presupuesto convertido o una venta pendiente) y `ANULADO`
 * (pedido dado de baja lógica) NO son compras efectivas y quedan fuera de los
 * tres agregados. Los pedidos con `cliente_id = null` (mostrador sin cliente
 * identificado) tampoco entran: el filtro es por `cliente_id IN <clúster>`.
 *
 * CLÚSTER DE FUSIÓN (HU-C5): el historial del cliente primario incluye sus
 * propios pedidos MÁS los de los clientes secundarios cuyo `fusionado_en_id`
 * apunta a él. HU-C5 re-vincula el historial del duplicado al primario de
 * forma LÓGICA (el secundario conserva sus filas, con `fusionado_en_id`
 * seteado), y `spec_modulo_C.md` §5 delega expresamente esa resolución a esta
 * función. El clúster se arma como `[primario, ...secundarios]` porque el
 * primario NO tiene `fusionado_en_id` (es `null`): un `findMany` filtrando
 * `fusionado_en_id = primario` solo devolvería secundarios, nunca al propio
 * primario.
 *
 * La agregación usa `prisma.pedidoVenta.aggregate` (NO `findMany` + reduce):
 * aprovecha el índice `@@index([cliente_id, estado])` y evita traer filas o
 * ítems para sumar. `total` es `Decimal`, por eso `monto_total_historico` se
 * coerciona con `Number()`.
 *
 * NO emite eventos y NO escribe NADA — válido para ejecutarse tantas veces
 * como haga falta sin alterar la base ni la cadena de auditoría.
 */
export async function resolverHistorialCompras(
  clienteId: string,
): Promise<ResumenHistorialCompras> {
  const secundarios = await prisma.cliente.findMany({
    where: { fusionado_en_id: clienteId },
    select: { id: true },
  });

  // El primario va SIEMPRE explícito: su `fusionado_en_id` es `null`.
  const clusterIds = [clienteId, ...secundarios.map((secundario) => secundario.id)];

  const agregado = await prisma.pedidoVenta.aggregate({
    where: {
      cliente_id: { in: clusterIds },
      estado: { in: ["FACTURADO", "REMITO_EMITIDO", "CERRADO"] },
    },
    _sum: { total: true },
    _max: { fecha_facturacion: true },
    _count: { _all: true },
  });

  return {
    ultima_compra: agregado._max.fecha_facturacion ?? null,
    monto_total_historico: Number(agregado._sum.total ?? 0),
    cantidad_operaciones: agregado._count._all,
  };
}
