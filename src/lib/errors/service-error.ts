/**
 * Error de negocio lanzado desde la capa de servicios. Los Route Handlers
 * y Server Actions lo capturan para mapear `code` a un status HTTP /
 * `{ data: null, error: { code, message } }` semántico.
 */
export class ServiceError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "ServiceError";
    this.code = code;
  }
}
