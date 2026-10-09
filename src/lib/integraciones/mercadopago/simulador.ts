/**
 * Simulador LOCAL de Mercado Pago, SOLO para desarrollo (task HU-E2 §10):
 * permite probar checkout y webhook con Postman sin cuenta ni red. Se activa
 * con `MP_MODO=simulado` y está prohibido con `NODE_ENV=production`.
 *
 * Los pagos simulados viven en `.mp-simulador/pagos.json` (raíz del repo); los
 * registra `npm run mp:firmar -- --pago … --estado … --monto … --ref …`, que
 * además imprime la firma del webhook. Función pura de archivo, sin Prisma.
 *
 * Solo cubre `consultarPago`; las ramas simuladas de `iniciarCobro`,
 * `cerrarCobro`, `solicitarReembolso` y `healthCheck` viven en `adapter.ts`.
 *
 * Owner: HU-E2 (Chiki). Definitivo, acordado con Rama (HU-F1) el 2026-10-08.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface PagoSimulado {
  id: string;
  status: string;
  status_detail: string;
  transaction_amount: number;
  currency_id: string;
  external_reference: string | null;
  date_approved: string | null;
}

const DIRECTORIO = join(process.cwd(), ".mp-simulador");
const ARCHIVO = join(DIRECTORIO, "pagos.json");

export function simuladorActivo(): boolean {
  if (process.env.MP_MODO !== "simulado") return false;
  if (process.env.NODE_ENV === "production") {
    throw new Error("[mercadopago/simulador] MP_MODO=simulado está prohibido en producción");
  }
  return true;
}

function leer(): Record<string, PagoSimulado> {
  if (!existsSync(ARCHIVO)) return {};
  return JSON.parse(readFileSync(ARCHIVO, "utf8")) as Record<string, PagoSimulado>;
}

export function obtenerPagoSimulado(paymentId: string): PagoSimulado | null {
  return leer()[paymentId] ?? null;
}

export function guardarPagoSimulado(pago: PagoSimulado): void {
  const pagos = leer();
  pagos[pago.id] = pago;
  mkdirSync(DIRECTORIO, { recursive: true });
  writeFileSync(ARCHIVO, JSON.stringify(pagos, null, 2));
}
