import "server-only";

/**
 * @module proveedor.service
 * @description Capa de dominio de HU-H1 — Alta y Homologación de Proveedores
 * (spec_modulo_H.md §2.1, §2.2, §3.3, §3.4, §3.5).
 *
 * TODA la lógica de negocio del ciclo de vida del proveedor vive acá: los
 * Route Handlers (`app/api/proveedores/**`) y las Server Actions
 * (`app/(dashboard)/compras/proveedores/actions.ts`) son wrappers finos —
 * resuelven sesión + permiso granular, parsean el body con Zod, invocan una
 * función de este archivo y mapean el resultado/excepción al shape estándar
 * `{ data, error }` (spec §2). Está prohibido reimplementar cualquier regla
 * de acá en esas capas.
 *
 * Reglas transversales aplicadas (spec §3.3/§3.4/§3.5, RULES.md §1/§2):
 *  - Ninguna función de este archivo hace un borrado físico de fila alguna:
 *    no se invoca `prisma.*.delete` ni `deleteMany` bajo ninguna condición.
 *    `darDeBajaProveedor()` es baja lógica (`is_active=false` + `deleted_*`).
 *  - Toda escritura corre dentro de un único `prisma.$transaction`, con la
 *    lectura del estado origen DENTRO de la transacción (race-safe).
 *  - Los eventos de dominio se emiten DESPUÉS del `COMMIT`, nunca dentro
 *    (spec §3.4, patrón fire-and-forget de Módulo D — deuda técnica conocida).
 *  - El cifrado/descifrado de datos bancarios vive EXCLUSIVAMENTE en
 *    `lib/crypto/aes.ts`, invocado solo desde acá (spec §3.3). El valor en
 *    claro nunca va a logs, payloads de eventos ni respuestas HTTP.
 *  - Este servicio NUNCA escribe `AuditLog` directo: `audit-log.listener.ts`
 *    es el único escritor y reacciona a los eventos que emite este archivo.
 */

import { Prisma } from "@prisma/client";
import type { EstadoProveedor } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { encrypt } from "@/lib/crypto/aes";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import { ServiceError } from "@/lib/errors/service-error";
import type {
  CambiarEstadoProveedorInput,
  CrearProveedorInput,
  DarDeBajaProveedorInput,
  EditarProveedorInput,
} from "@/lib/schemas/proveedores.schema";

// ──────────────────────────────────────────────────────────────────────────────
// Permisos granulares (spec §2.1/§2.2 + matriz Alcance §5) — un permiso
// independiente por acción, nunca un único permiso de "administrar"
// genérico. Punto de verdad compartido por los Route Handlers y las Server
// Actions.
// ──────────────────────────────────────────────────────────────────────────────

export const PERMISO_CREAR = "proveedores:crear";
export const PERMISO_HOMOLOGAR = "proveedores:homologar";
export const PERMISO_BAJA = "proveedores:baja";
export const PERMISO_EDITAR = "proveedores:editar";
export const PERMISO_LEER = "proveedores:leer";

// ──────────────────────────────────────────────────────────────────────────────
// Máquina de estados de homologación (spec §2.2). Mapa explícito origen →
// destinos válidos (decisión D2, espeja `TRANSICIONES` de H3). `P→S` directo
// y misma→misma NO figuran → `422 TRANSICION_INVALIDA`.
// ──────────────────────────────────────────────────────────────────────────────

export const TRANSICIONES_VALIDAS: Record<EstadoProveedor, EstadoProveedor[]> = {
  PENDIENTE: ["HOMOLOGADO"],
  HOMOLOGADO: ["PENDIENTE", "SUSPENDIDO"],
  SUSPENDIDO: ["PENDIENTE", "HOMOLOGADO"],
};

// ──────────────────────────────────────────────────────────────────────────────
// Tipos públicos
// ──────────────────────────────────────────────────────────────────────────────

export interface ProveedorCreado {
  proveedor_id: string;
  estado: "PENDIENTE";
}

export interface ProveedorEstadoCambiado {
  proveedor_id: string;
  estado_anterior: EstadoProveedor;
  estado_nuevo: EstadoProveedor;
}

export interface ProveedorDadoDeBaja {
  proveedor_id: string;
  is_active: false;
}

export interface ProveedorEditado {
  proveedor_id: string;
  campos_editados: string[];
}

// ──────────────────────────────────────────────────────────────────────────────
// §2.1 — Alta de proveedor con legajo comercial
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Alta transaccional de un `Proveedor` en estado inicial `PENDIENTE` — nunca
 * `HOMOLOGADO` directo (spec §2.1); la homologación es una transición
 * explícita posterior.
 *
 * Unicidad de CUIT (decisión D9): el pre-check contra `is_active=true` corre
 * DENTRO de la transacción y el constraint `@unique` del schema es la
 * defensa final ante la carrera de dos altas concurrentes — el `P2002` se
 * traduce al mismo `409 CUIT_DUPLICADO`. Un CUIT dado de baja queda
 * bloqueado (índice único parcial = deuda técnica, sin cambio de schema).
 *
 * Si el payload trae `datos_bancarios`, se cifra con AES-256-GCM ANTES de
 * construir el objeto de escritura a Prisma (spec §3.3); el valor en claro
 * no aparece en ningún log, payload de evento ni respuesta HTTP.
 *
 * El modelo `Proveedor` no expone columna de "creado por" — el actor de la
 * operación no se persiste en el alta (el listado no lo muestra).
 */
export async function crearProveedor(
  input: CrearProveedorInput,
): Promise<ProveedorCreado> {
  // Cifrado previo a la transacción: `datos_bancarios_cifrado`/`_iv` ya van
  // cifrados al `create` (spec §3.3 — en ningún punto el dato en claro llega
  // a `prisma.proveedor.create`).
  const bancarios = input.datos_bancarios
    ? encrypt(JSON.stringify(input.datos_bancarios))
    : null;

  try {
    const creado = await prisma.$transaction(async (tx) => {
      // Pre-check CUIT activo DENTRO de la transacción (spec §2.1).
      const cuitExistente = await tx.proveedor.findFirst({
        where: { cuit: input.cuit, is_active: true, deleted_at: null },
        select: { id: true },
      });
      if (cuitExistente) {
        throw new ServiceError(
          "CUIT_DUPLICADO",
          `Ya existe un proveedor activo con el CUIT ${input.cuit}`,
        );
      }

      return tx.proveedor.create({
        data: {
          razon_social: input.razon_social,
          nombre_fantasia: input.nombre_fantasia ?? null,
          cuit: input.cuit,
          condiciones_pago: input.condiciones_pago ?? null,
          categorias: input.categorias,
          estado: "PENDIENTE",
          contacto_nombre: input.contacto_nombre ?? null,
          contacto_email: input.contacto_email ?? null,
          contacto_telefono: input.contacto_telefono ?? null,
          datos_bancarios_cifrado: bancarios?.ciphertext ?? null,
          datos_bancarios_iv: bancarios?.iv ?? null,
        },
        select: { id: true },
      });
    });

    return { proveedor_id: creado.id, estado: "PENDIENTE" };
  } catch (error) {
    // Traducción de la carrera CUIT (spec §2.1 / escenario Race CUIT).
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new ServiceError(
        "CUIT_DUPLICADO",
        `Ya existe un proveedor activo con el CUIT ${input.cuit}`,
      );
    }
    throw error;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// §2.2 — Homologar / suspender (máquina de transiciones manual)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Transición manual de `Proveedor.estado` según `TRANSICIONES_VALIDAS`.
 * La lectura del estado origen y el `UPDATE` corren en la MISMA transacción
 * (race-safe, patrón `cambiarEstadoOrdenCompra` de H3): si otra request
 * movió el estado en el interín, `count === 0` → 422.
 *
 * `motivo` es obligatorio para `SUSPENDIDO` (schema refine + chequeo acá,
 * defensa en profundidad). Toda transición válida emite
 * `proveedor:estado_cambiado` post-COMMIT con `origen: "MANUAL"` y el
 * `usuario_id` de sesión (spec §2.2, §4). Suspender NO afecta OC
 * `CONFIRMADA` en curso — esa validación vive en la capa de servicios de
 * HU-H3 al crear nuevas OC (`resolverContextoPrecios`), nunca a nivel de BD.
 */
export async function cambiarEstadoProveedor(
  proveedorId: string,
  input: CambiarEstadoProveedorInput,
  usuarioId: string,
): Promise<ProveedorEstadoCambiado> {
  if (
    input.nuevo_estado === "SUSPENDIDO" &&
    (input.motivo === undefined || input.motivo.trim().length === 0)
  ) {
    throw new ServiceError(
      "TRANSICION_INVALIDA",
      "El motivo es obligatorio al suspender un proveedor",
    );
  }

  const resultado = await prisma.$transaction(async (tx) => {
    // Lectura del estado origen DENTRO de la transacción que hace el UPDATE
    // (spec §3.4): evita la carrera entre dos requests concurrentes.
    const proveedor = await tx.proveedor.findFirst({
      where: { id: proveedorId },
      select: { id: true, estado: true, is_active: true, deleted_at: true },
    });
    if (!proveedor || !proveedor.is_active || proveedor.deleted_at !== null) {
      throw new ServiceError(
        "PROVEEDOR_NO_ENCONTRADO",
        "El proveedor indicado no existe",
      );
    }

    const destinosValidos = TRANSICIONES_VALIDAS[proveedor.estado] ?? [];
    if (!destinosValidos.includes(input.nuevo_estado)) {
      throw new ServiceError(
        "TRANSICION_INVALIDA",
        `Un proveedor ${proveedor.estado} no puede transicionar directamente a ${input.nuevo_estado}`,
      );
    }

    // UPDATE condicionado al estado origen leído: si otra transacción lo
    // cambió en el interín, `count === 0` → 422.
    const cambio = await tx.proveedor.updateMany({
      where: {
        id: proveedorId,
        estado: proveedor.estado,
        is_active: true,
        deleted_at: null,
      },
      data: { estado: input.nuevo_estado },
    });
    if (cambio.count === 0) {
      throw new ServiceError(
        "TRANSICION_INVALIDA",
        "El estado del proveedor cambió durante la operación; reintentá",
      );
    }

    return { estado_anterior: proveedor.estado };
  });

  // Post-COMMIT: evento de dominio → Módulo D (auditoría SHA-256). El
  // listener de `proveedor:estado_cambiado` ya existe (HU-H5) — acá solo se
  // emite, con `origen: "MANUAL"` y `usuario_id` real (spec §2.2).
  domainEventBus.emit("proveedor:estado_cambiado", {
    proveedor_id: proveedorId,
    usuario_id: usuarioId,
    estado_anterior: resultado.estado_anterior,
    estado_nuevo: input.nuevo_estado,
    origen: "MANUAL",
    motivo: input.motivo ?? "",
  });

  return {
    proveedor_id: proveedorId,
    estado_anterior: resultado.estado_anterior,
    estado_nuevo: input.nuevo_estado,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Baja lógica del registro (Regla N.° 1 — NUNCA un DELETE físico)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Baja lógica de un `Proveedor`: `UPDATE` de `is_active=false` +
 * `deleted_at` + `deleted_by` + `deletion_reason` (motivo obligatorio,
 * validado en schema). El `updateMany` condicionado a
 * `{ id, is_active: true, deleted_at: null }` hace de guarda de concurrencia:
 * `count === 0` → `404 PROVEEDOR_NO_ENCONTRADO` (ya está dado de baja o no
 * existe), sin evento.
 *
 * La fila permanece consultable para la trazabilidad (spec §3.5): nunca
 * desaparece de los reportes.
 */
export async function darDeBajaProveedor(
  proveedorId: string,
  input: DarDeBajaProveedorInput,
  usuarioId: string,
): Promise<ProveedorDadoDeBaja> {
  const ahora = new Date();

  await prisma.$transaction(async (tx) => {
    const cambio = await tx.proveedor.updateMany({
      where: { id: proveedorId, is_active: true, deleted_at: null },
      data: {
        is_active: false,
        deleted_at: ahora,
        deleted_by: usuarioId,
        deletion_reason: input.deletion_reason,
      },
    });
    if (cambio.count === 0) {
      throw new ServiceError(
        "PROVEEDOR_NO_ENCONTRADO",
        "El proveedor indicado no existe o ya está dado de baja",
      );
    }
  });

  // Post-COMMIT: evento de dominio → Módulo D (auditoría SHA-256). El
  // handler `proveedor:baja_logica` (DELETE_LOGICO) es aditivo en
  // `audit-log.listener.ts`.
  domainEventBus.emit("proveedor:baja_logica", {
    proveedor_id: proveedorId,
    usuario_id: usuarioId,
    motivo: input.deletion_reason,
  });

  return { proveedor_id: proveedorId, is_active: false };
}

// ──────────────────────────────────────────────────────────────────────────────
// Edición parcial del legajo (PATCH /api/proveedores/[id])
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Edición parcial del legajo comercial. Campos editables: `razon_social`,
 * `nombre_fantasia`, `condiciones_pago`, `categorias`, `contacto_*`.
 * `cuit`/`estado` → `422 CAMPOS_NO_EDITABLES` (defensa en profundidad: el
 * schema Zod ya los rechaza vía `superRefine`).
 *
 * `datos_bancarios` es un REPLAZAMIENTO: se re-cifra con AES-256-GCM y un IV
 * NUEVO (spec §3.3 — "nueva versión auditada del legajo"; el valor anterior
 * cifrado queda accesible para reconstrucción forense). El frontend nunca
 * ve un CBU descifrado: ni el listado ni la edición lo exponen.
 *
 * `campos_editados` = claves con valor distinto al actual (incluye
 * `"datos_bancarios"` si se reemplazó — NUNCA el valor). Si ningún campo
 * cambió, no hay escritura ni evento. El evento `proveedor:legajo_editado`
 * se emite post-COMMIT con la metadata, sin dato bancario alguno.
 */
export async function editarProveedor(
  proveedorId: string,
  input: EditarProveedorInput,
  usuarioId: string,
): Promise<ProveedorEditado> {
  if ("cuit" in input || "estado" in input) {
    throw new ServiceError(
      "CAMPOS_NO_EDITABLES",
      "El CUIT y el estado del proveedor no se pueden editar en el legajo",
    );
  }

  // Re-cifrado con IV NUEVO antes de persistir (spec §3.3).
  const bancarios = input.datos_bancarios
    ? encrypt(JSON.stringify(input.datos_bancarios))
    : null;

  const resultado = await prisma.$transaction(async (tx) => {
    const actual = await tx.proveedor.findFirst({
      where: { id: proveedorId },
      select: {
        id: true,
        razon_social: true,
        nombre_fantasia: true,
        condiciones_pago: true,
        categorias: true,
        contacto_nombre: true,
        contacto_email: true,
        contacto_telefono: true,
        is_active: true,
        deleted_at: true,
      },
    });
    if (!actual || !actual.is_active || actual.deleted_at !== null) {
      throw new ServiceError(
        "PROVEEDOR_NO_ENCONTRADO",
        "El proveedor indicado no existe",
      );
    }

    const data: Prisma.ProveedorUpdateManyMutationInput = {};
    const camposEditados: string[] = [];

    if (
      input.razon_social !== undefined &&
      input.razon_social !== actual.razon_social
    ) {
      data.razon_social = input.razon_social;
      camposEditados.push("razon_social");
    }
    if (
      input.nombre_fantasia !== undefined &&
      (input.nombre_fantasia ?? null) !== actual.nombre_fantasia
    ) {
      data.nombre_fantasia = input.nombre_fantasia ?? null;
      camposEditados.push("nombre_fantasia");
    }
    if (
      input.condiciones_pago !== undefined &&
      (input.condiciones_pago ?? null) !== actual.condiciones_pago
    ) {
      data.condiciones_pago = input.condiciones_pago ?? null;
      camposEditados.push("condiciones_pago");
    }
    if (
      input.categorias !== undefined &&
      (input.categorias.length !== actual.categorias.length ||
        input.categorias.some((c, i) => c !== actual.categorias[i]))
    ) {
      data.categorias = input.categorias;
      camposEditados.push("categorias");
    }
    if (
      input.contacto_nombre !== undefined &&
      (input.contacto_nombre ?? null) !== actual.contacto_nombre
    ) {
      data.contacto_nombre = input.contacto_nombre ?? null;
      camposEditados.push("contacto_nombre");
    }
    if (
      input.contacto_email !== undefined &&
      (input.contacto_email ?? null) !== actual.contacto_email
    ) {
      data.contacto_email = input.contacto_email ?? null;
      camposEditados.push("contacto_email");
    }
    if (
      input.contacto_telefono !== undefined &&
      (input.contacto_telefono ?? null) !== actual.contacto_telefono
    ) {
      data.contacto_telefono = input.contacto_telefono ?? null;
      camposEditados.push("contacto_telefono");
    }
    if (input.datos_bancarios !== undefined && bancarios) {
      data.datos_bancarios_cifrado = bancarios.ciphertext;
      data.datos_bancarios_iv = bancarios.iv;
      camposEditados.push("datos_bancarios");
    }

    // Sin cambios → sin escritura (Prisma rechaza `updateMany` con `data: {}`)
    // y sin evento: no hay nada nuevo que auditar.
    if (camposEditados.length === 0) {
      return { camposEditados };
    }

    const cambio = await tx.proveedor.updateMany({
      where: { id: proveedorId, is_active: true, deleted_at: null },
      data,
    });
    if (cambio.count === 0) {
      throw new ServiceError(
        "PROVEEDOR_NO_ENCONTRADO",
        "El proveedor indicado no existe",
      );
    }

    return { camposEditados };
  });

  if (resultado.camposEditados.length > 0) {
    domainEventBus.emit("proveedor:legajo_editado", {
      proveedor_id: proveedorId,
      usuario_id: usuarioId,
      campos_editados: resultado.camposEditados,
    });
  }

  return {
    proveedor_id: proveedorId,
    campos_editados: resultado.camposEditados,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Lectura para la UI (listado / selectores)
// ──────────────────────────────────────────────────────────────────────────────

export interface FiltrosListadoProveedores {
  estado?: EstadoProveedor;
}

export interface ProveedorListado {
  id: string;
  razon_social: string;
  nombre_fantasia: string | null;
  cuit: string;
  condiciones_pago: string | null;
  categorias: string[];
  estado: EstadoProveedor;
  contacto_nombre: string | null;
  contacto_email: string | null;
  contacto_telefono: string | null;
  created_at: Date;
}

/**
 * Listado operativo de proveedores activos (spec §2.1 / §3.5: los `SELECT`
 * operativos filtran por defecto `is_active=true`), con filtro opcional por
 * `estado` y orden estable por razón social. NUNCA selecciona
 * `datos_bancarios_cifrado` / `datos_bancarios_iv` — el dato bancario no se
 * expone en ninguna proyección de listado (spec §3.3).
 */
export async function listarProveedores(
  filtros: FiltrosListadoProveedores = {},
): Promise<ProveedorListado[]> {
  const where: Prisma.ProveedorWhereInput = {
    is_active: true,
    deleted_at: null,
  };
  if (filtros.estado) where.estado = filtros.estado;

  return prisma.proveedor.findMany({
    where,
    orderBy: { razon_social: "asc" },
    select: {
      id: true,
      razon_social: true,
      nombre_fantasia: true,
      cuit: true,
      condiciones_pago: true,
      categorias: true,
      estado: true,
      contacto_nombre: true,
      contacto_email: true,
      contacto_telefono: true,
      created_at: true,
    },
  });
}