/**
 * HU-E16 (spec E §6.2, E16-4) — confirmación in-process EXCLUSIVA del rechazo de
 * publicación web. Copia del patrón de `libro-iva-confirmacion.ts`: no cambia
 * EventEmitter ni transporta callbacks en el evento. Se registra antes de
 * emitir; una respuesta tardía no puede resolver otro intento.
 */
export const PLAZO_CONFIRMACION_RECHAZO_MS = 10_000;

type Espera = { resolver: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> };
export class ConfirmacionesPublicacionWeb {
  private readonly pendientes = new Map<string, Espera>();
  /** Plazo por defecto. Solo los tests lo sobrescriben (HU16_TASKS.md D12); sin clave de Configuración. */
  plazoMs = PLAZO_CONFIRMACION_RECHAZO_MS;

  get cantidadPendiente(): number { return this.pendientes.size; }

  esperar(id: string, plazoMs = this.plazoMs) {
    if (this.pendientes.has(id)) throw new Error("INTENTO_DUPLICADO");
    let resolver!: (ok: boolean) => void;
    const resultado = new Promise<boolean>((resolve) => { resolver = resolve; });
    const timer = setTimeout(() => this.confirmar(id, false), plazoMs);
    this.pendientes.set(id, { resolver, timer });
    return { resultado, cancelar: () => this.confirmar(id, false) };
  }

  confirmar(id: string, ok: boolean): void {
    const espera = this.pendientes.get(id);
    if (!espera) return;
    this.pendientes.delete(id);
    clearTimeout(espera.timer);
    espera.resolver(ok);
  }
}

// Conservar las esperas durante recargas de módulos, igual que el singleton Prisma.
const globalE16 = globalThis as unknown as { swatConfirmacionesPublicacionWeb?: ConfirmacionesPublicacionWeb };
export const confirmacionesPublicacionWeb = globalE16.swatConfirmacionesPublicacionWeb ??= new ConfirmacionesPublicacionWeb();
