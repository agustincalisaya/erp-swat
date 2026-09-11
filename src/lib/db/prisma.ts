import { Prisma, PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * Reintenta una operación de Prisma (típicamente un `$transaction` con
 * `isolationLevel: Serializable`) cuando falla por conflicto de escritura
 * concurrente — código `P2034`, la forma en que Prisma reporta un
 * "serialization failure"/deadlock de Postgres bajo aislamiento
 * Serializable (https://www.prisma.io/docs/orm/reference/error-reference#p2034).
 *
 * Uso (Camino B, task_cali_roles_permisos.md — ronda de corrección
 * posterior al cierre de la tarea de Roles/Permisos): guardas de "no dejar
 * al sistema sin administrador funcional" que hacen un conteo de lectura y
 * después escriben en base a ese conteo — sin esto, dos operaciones
 * concurrentes que cada una remueve el permiso desde una fuente distinta
 * podrían ambas leer "todavía queda otra fuente" antes de que cualquiera
 * confirme su escritura, y las dos se permitirían, dejando al sistema en
 * cero administradores pese a que la guarda, evaluada en serie, habría
 * bloqueado a la segunda.
 *
 * No reintenta ningún otro tipo de error (ej. `ServiceError` de negocio,
 * como `SISTEMA_SIN_ADMINISTRADOR`) — esos se propagan de inmediato.
 *
 * @param intentos - Máximo de intentos totales (1 intento inicial + reintentos).
 */
export async function ejecutarConReintentoDeConflicto<T>(
  operacion: () => Promise<T>,
  intentos = 3,
): Promise<T> {
  for (let intento = 1; intento <= intentos; intento++) {
    try {
      return await operacion();
    } catch (err) {
      const esConflictoDeSerializacion =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034";

      if (!esConflictoDeSerializacion || intento === intentos) {
        throw err;
      }
    }
  }

  // Inalcanzable: el loop siempre retorna o lanza en su última iteración.
  throw new Error("ejecutarConReintentoDeConflicto: estado inesperado");
}
