import assert from "node:assert/strict";
import test from "node:test";
import {
  ESTADOS_ECOMMERCE,
  evaluarAnulabilidad,
  MENSAJE_TRANSICION_INVALIDA_ANULACION,
  MOTIVO_ANULACION_TTL,
} from "./anulacion-orden.reglas.ts";

/** HU-E7 (spec E §2.7; task_relos.md D4, D13) — reglas puras de anulación. */

test("evaluarAnulabilidad: matriz completa de los 9 estados de EstadoEcommerce", () => {
  const esperado: Record<(typeof ESTADOS_ECOMMERCE)[number], ReturnType<typeof evaluarAnulabilidad>> = {
    PAGO_PENDIENTE: { anulable: true, camino: "PAGO_PENDIENTE" },
    PAGO_RECHAZADO: { anulable: true, camino: "PAGO_RECHAZADO" },
    PAGO_CONFIRMADO: { anulable: false },
    EN_PREPARACION: { anulable: false },
    LISTO_PARA_RETIRO: { anulable: false },
    ENTREGADO: { anulable: false },
    ANULADO: { anulable: false },
    CANCELADO: { anulable: false },
    VENCIDO_SIN_RETIRO: { anulable: false },
  };
  assert.equal(ESTADOS_ECOMMERCE.length, 9);
  for (const estado of ESTADOS_ECOMMERCE) {
    assert.deepEqual(evaluarAnulabilidad(estado), esperado[estado], estado);
  }
});

test("evaluarAnulabilidad: un estado desconocido no es anulable", () => {
  assert.deepEqual(evaluarAnulabilidad(""), { anulable: false });
  assert.deepEqual(evaluarAnulabilidad("pago_pendiente"), { anulable: false });
});

test("constantes: motivo de la vía automática y mensaje literal del 409 de la spec", () => {
  assert.equal(MOTIVO_ANULACION_TTL, "Reserva vencida sin pago (TTL)");
  assert.equal(
    MENSAJE_TRANSICION_INVALIDA_ANULACION,
    "Solo una orden no abonada (Pago Pendiente o Pago Rechazado) puede anularse por esta vía",
  );
});
