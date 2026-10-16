/**
 * Confirmación in-process EXCLUSIVA de G4. No cambia EventEmitter ni transporta
 * callbacks en el evento. Se registra antes de emitir; una respuesta tardía no
 * puede resolver otra exportación. El rechazo se observa inmediatamente.
 */
type Espera = { resolver: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> };
export class ConfirmacionesLibroIva {
  private readonly pendientes = new Map<string, Espera>();

  get cantidadPendiente(): number { return this.pendientes.size; }

  esperar(id: string, plazoMs = 30_000) {
    if (this.pendientes.has(id)) throw new Error("EXPORTACION_DUPLICADA");
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
const globalG4 = globalThis as unknown as { swatConfirmacionesLibroIva?: ConfirmacionesLibroIva };
export const confirmacionesLibroIva = globalG4.swatConfirmacionesLibroIva ??= new ConfirmacionesLibroIva();
