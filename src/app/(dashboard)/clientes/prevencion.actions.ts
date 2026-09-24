"use server";

import { getServerSession } from "@/lib/auth/session";
import { z } from "zod";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { prisma } from "@/lib/db/prisma";
import { ServiceError } from "@/lib/errors/service-error";
import { PERMISO_CREAR, PERMISO_LEER } from "@/lib/services/clientes/cliente.service";
import { consultarPrevencionAlta } from "@/lib/services/clientes/prevencion-duplicados.service";

const ConsultaPreventivaSchema = z.object({
  dni: z.string().regex(/^\d{7,8}$/, "El DNI debe tener 7 u 8 dígitos"),
  nombre: z.string().max(200).optional(),
  telefono: z.string().max(100).optional(),
  email: z.string().max(320).optional(),
});

export async function consultarPrevencionAltaAction(entrada: unknown) {
  const session = await getServerSession();
  if (!session) return { data: null, error: { code: "UNAUTHORIZED", message: "Sesión requerida" } };
  if (!(await usuarioTienePermiso(session.userId, PERMISO_CREAR))) {
    return { data: null, error: { code: "FORBIDDEN", message: "Sin permiso para dar de alta clientes" } };
  }
  const parsed = ConsultaPreventivaSchema.safeParse(entrada);
  if (!parsed.success) return { data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Datos inválidos" } };
  try {
    const resultado = await consultarPrevencionAlta(prisma, parsed.data);
    const puedeConsultar = await usuarioTienePermiso(session.userId, PERMISO_LEER);
    return { data: {
      existente: resultado.existente ? {
        id: puedeConsultar ? resultado.existente.id : null,
        is_active: puedeConsultar ? resultado.existente.is_active : null,
      } : null,
      posibles: puedeConsultar ? resultado.posibles : [],
      puedeConsultar,
    }, error: null };
  } catch (error) {
    return { data: null, error: error instanceof ServiceError
      ? { code: error.code, message: error.message }
      : { code: "INTERNAL_ERROR", message: "No se pudo consultar coincidencias" } };
  }
}
