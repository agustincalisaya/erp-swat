/** Confirmación local de persistencia, correlacionada por exportacion_id. */
type Espera = { resolver: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> };

export class ConfirmacionesReporteMensual {
  private readonly pendientes = new Map<string, Espera>();

  esperar(id: string, plazoMs = 30_000) {
    if (this.pendientes.has(id)) throw new Error("EXPORTACION_DUPLICADA");
    let resolver!: (ok: boolean) => void;
    const resultado = new Promise<boolean>((resolve) => { resolver = resolve; });
    const timer = setTimeout(() => this.confirmar(id, false), plazoMs);
    this.pendientes.set(id, { resolver, timer });
    return { resultado, cancelar: () => this.confirmar(id, false) };
  }

  confirmar(id: string, ok: boolean) {
    const espera = this.pendientes.get(id);
    if (!espera) return;
    this.pendientes.delete(id);
    clearTimeout(espera.timer);
    espera.resolver(ok);
  }
}

const globalReporte = globalThis as unknown as { swatConfirmacionesReporte?: ConfirmacionesReporteMensual };
export const confirmacionesReporteMensual = globalReporte.swatConfirmacionesReporte ??= new ConfirmacionesReporteMensual();
