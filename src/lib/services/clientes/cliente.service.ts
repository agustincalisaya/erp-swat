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

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import type { CrearClienteInput } from "@/lib/schemas/clientes.schema";

// ──────────────────────────────────────────────────────────────────────────────
// Permisos granulares (spec §2.1 + Alcance §5) — un permiso independiente
// por acción, punto de verdad compartido por Route Handler y Server Action.
// ──────────────────────────────────────────────────────────────────────────────

export const PERMISO_CREAR = "clientes:crear";

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
