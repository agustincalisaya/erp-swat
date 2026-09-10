/**
 * Error de negocio lanzado desde la capa de servicios. Los Route Handlers
 * y Server Actions lo capturan para mapear `code` a un status HTTP /
 * `{ data: null, error: { code, message } }` semántico.
 */
export class ServiceError extends Error {
  readonly code: string;
  /**
   * Detalle estructurado opcional del error (HU-G10). Se serializa dentro de
   * `error.details` SOLO en las rutas que explícitamente lo propagan. El resto
   * de los Route Handlers ignoran este campo y siguen exponiendo únicamente
   * `{ code, message }`.
   */
  readonly details?: unknown;

  constructor(code: string, message?: string, details?: unknown) {
    super(message ?? code);
    this.name = "ServiceError";
    this.code = code;
    this.details = details;
  }
}
