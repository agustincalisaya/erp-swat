/**
 * @module nombre-usuario
 * @description Transforma el `nombre_completo` de un usuario para mostrar en
 * la UI, quitando los sufijos técnicos de seed — corrección de presentación
 * previa al Sprint Review del 28/08. Nunca modifica el dato de origen en
 * base (`prisma/seed.ts`, tabla `usuarios` no cambian).
 *
 * Los usuarios sembrados por `prisma/seed.ts` llevan sufijos técnicos
 * ("Seed", "(Módulo X)") que no deben verse en pantalla:
 *
 *   "Administrador Seed (Módulo D)"          -> "Administrador"
 *   "Auditor Seed (Módulo D)"                -> "Auditor"
 *   "Encargado de Depósito Seed (Módulo A)"  -> "Encargado de Depósito"
 *
 * Un nombre real (dado de alta por un Administrador vía HU-1,
 * `crearUsuario()`) no lleva ninguno de estos sufijos, así que la función
 * es un no-op para él.
 */
export function limpiarNombreUsuario(nombreCompleto: string): string {
  return nombreCompleto
    // Sufijo final entre paréntesis, ej. " (Módulo D)".
    .replace(/\s*\([^)]*\)\s*$/, "")
    // Palabra "Seed" al final, ej. "Administrador Seed" -> "Administrador".
    .replace(/\s+Seed\s*$/i, "")
    .trim();
}
