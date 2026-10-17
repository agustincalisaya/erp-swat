/**
 * HU-E13 T18 — proceso hijo para las carreras multiproceso.
 *
 * Lo lanza `hu-e13.concurrencia.integration.test.ts` como proceso del sistema
 * operativo independiente (`node --conditions=react-server --import tsx`):
 * carga su propia instancia de los módulos, su propio PrismaClient y su propia
 * `colaLedger`, sin memoria compartida con el padre ni con otros hijos.
 *
 * Entrada: un JSON en argv[2]. Salida: una línea `RESULTADO:<json>` en stdout.
 * `inicio` es una barrera de arranque (epoch ms): los hijos esperan hasta ese
 * instante para llamar al servicio a la vez; no serializa nada.
 */
import { createHash } from "node:crypto";

type Orden =
  | { accion: "audit"; inicio: number; prefijo: string; cantidad: number }
  | { accion: "audit-idempotente"; inicio: number; accion_audit: string; tabla: string; registro_id: string; etiqueta: string }
  | { accion: "reintento-manual"; inicio: number; reintegro_id: string; usuario_id: string; motivo: string; demora_f1_ms: number }
  | { accion: "verificar-cadena" };

const URL_BASE = process.env.DATABASE_URL ?? "";

async function esperarInicio(inicio: number): Promise<void> {
  const espera = inicio - Date.now();
  if (espera > 0) await new Promise((resolve) => setTimeout(resolve, espera));
}

async function main(): Promise<unknown> {
  const orden = JSON.parse(process.argv[2] ?? "{}") as Orden;
  const f = await import("./hu-e13.test-fixtures.ts");
  f.exigirDbDeTest(URL_BASE);
  const auditoria = await import("../auditoria/audit-log.service.ts");

  if (orden.accion === "verificar-cadena") {
    // Solo lectura: no repara ni recalcula el ledger.
    return auditoria.verificarCadenaIntegridad();
  }

  if (orden.accion === "audit") {
    await esperarInicio(orden.inicio);
    await Promise.all(Array.from({ length: orden.cantidad }, (_, i) => auditoria.registrarAuditLog({
      usuario_id: null,
      accion: "T18_MULTIPROCESO",
      tabla_afectada: "t18_ledger",
      registro_id: `${orden.prefijo}-${i}`,
      ip: "internal-test",
      valor_nuevo: { proceso: process.pid, prefijo: orden.prefijo, i },
    })));
    return { pid: process.pid, escritos: orden.cantidad };
  }

  if (orden.accion === "audit-idempotente") {
    await esperarInicio(orden.inicio);
    const resultado = await auditoria.registrarAuditLogIdempotente({
      usuario_id: null,
      accion: orden.accion_audit,
      tabla_afectada: orden.tabla,
      registro_id: orden.registro_id,
      ip: "internal-test",
      valor_nuevo: { proceso: process.pid, etiqueta: orden.etiqueta },
    });
    return { pid: process.pid, resultado };
  }

  // Reintento manual real (T08) desde este proceso: los listeners T09 de este
  // proceso auditan el hecho manual. El F1 aprueba tras una demora y con un
  // refund_id derivado de la key, como haría MP ante la misma X-Idempotency-Key.
  const [{ prisma }, { listenersRegistrados }, refund] = await Promise.all([
    import("../../db/prisma.ts"),
    import("../../events/domain-event-bus.ts"),
    import("./reintegro-refund.service.ts"),
  ]);
  await listenersRegistrados;
  const servicio = refund.crearServicioReintegroRefund({
    solicitarReembolso: async (paymentId: string, key: string) => {
      await new Promise((resolve) => setTimeout(resolve, orden.demora_f1_ms));
      const intento = await prisma.reintegroRefundIntento.findUniqueOrThrow({
        where: { clave_idempotencia: key },
        select: { reintegro: { select: { monto_total: true } } },
      });
      return {
        refund_id: `T18-REF-${createHash("sha256").update(key).digest("hex").slice(0, 24)}`,
        payment_id: paymentId,
        monto: intento.reintegro.monto_total.toNumber(),
        estado: "APROBADO" as const,
      };
    },
  });
  await esperarInicio(orden.inicio);
  let salida: unknown;
  try {
    const resultado = await servicio.solicitarReintentoManualRefund({
      reintegro_id: orden.reintegro_id,
      usuario_id: orden.usuario_id,
      motivo: orden.motivo,
    });
    salida = { pid: process.pid, resultado: resultado.resultado, intento_reutilizado: resultado.intento_reutilizado };
  } catch (error) {
    salida = { pid: process.pid, error: (error as { code?: string }).code ?? String(error) };
  }
  await f.drenarListeners();
  await prisma.$disconnect();
  return salida;
}

main().then(
  (resultado) => {
    process.stdout.write(`RESULTADO:${JSON.stringify(resultado)}\n`);
    process.exit(0);
  },
  (error: unknown) => {
    process.stdout.write(`RESULTADO:${JSON.stringify({ fallo: String((error as Error)?.stack ?? error) })}\n`);
    process.exit(1);
  },
);
