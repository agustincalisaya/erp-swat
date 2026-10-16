import assert from "node:assert/strict";
import test from "node:test";
import {
  clasificarEgresos,
  clasificarStock,
  compararSeveridad,
  construirClaveActiva,
  construirReferenciaEgresos,
  construirReferenciaStock,
  decidirTransicion,
  esEscaladaACritica,
  esMesVigente,
  formatearDetalleAlerta,
  parsearReferenciaEgresos,
  referenciaEgresosDeDiaIso,
  valorComparable,
  type AlertaVigente,
  type SeveridadAlerta,
  type Transicion,
} from "./alerta-desvio.reglas.ts";

const SEVERIDADES: readonly SeveridadAlerta[] = ["CRITICA", "ADVERTENCIA", "INFORMATIVA"];
const UMBRALES_SEMBRADOS = { informativa: 70, advertencia: 85, critica: 100 };

// ── clasificarStock (D1, D2) ──────────────────────────────────────────────────

for (const [cantidad, esperado] of [
  [5, "ADVERTENCIA"], // cantidad = punto_pedido (inclusivo)
  [6, null], // punto_pedido + 1
  [1, "ADVERTENCIA"],
  [0, "CRITICA"],
  [-2, "CRITICA"],
] as const) {
  test(`clasificarStock: cantidad ${cantidad} con punto de pedido 5 → ${esperado}`, () => {
    assert.equal(clasificarStock({ cantidad, punto_pedido: 5 }), esperado);
  });
}

for (const puntoPedido of [0, null, undefined, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
  test(`clasificarStock: punto de pedido ${String(puntoPedido)} es "sin control" (sin alerta con stock 0, negativo o positivo)`, () => {
    for (const cantidad of [0, -1, 3]) {
      assert.equal(clasificarStock({ cantidad, punto_pedido: puntoPedido }), null);
    }
  });
}

// ── valorComparable (D26) ─────────────────────────────────────────────────────

test("valorComparable: devuelve el porcentaje tal cual, sin redondear", () => {
  assert.equal(valorComparable(69.99), 69.99);
  assert.equal(valorComparable(78.4615384615), 78.4615384615);
  assert.equal(valorComparable(0), 0);
});

test("valorComparable: null, undefined, NaN e Infinity no son calculables", () => {
  for (const valor of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(valorComparable(valor), null);
  }
});

// ── clasificarEgresos (D2) ────────────────────────────────────────────────────

for (const [porcentaje, esperado] of [
  [69.99, null],
  [70, { severidad: "INFORMATIVA", umbral_aplicado: 70 }],
  [84.99, { severidad: "INFORMATIVA", umbral_aplicado: 70 }],
  [85, { severidad: "ADVERTENCIA", umbral_aplicado: 85 }],
  [99.99, { severidad: "ADVERTENCIA", umbral_aplicado: 85 }],
  [100, { severidad: "CRITICA", umbral_aplicado: 100 }],
  [250, { severidad: "CRITICA", umbral_aplicado: 100 }],
] as const) {
  test(`clasificarEgresos: ${porcentaje}% con 70/85/100 → ${esperado ? esperado.severidad : "null"}`, () => {
    assert.deepEqual(clasificarEgresos(porcentaje, UMBRALES_SEMBRADOS), esperado);
  });
}

test("clasificarEgresos: porcentaje no calculable (null, undefined, NaN, Infinity) → null", () => {
  for (const valor of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(clasificarEgresos(valor, UMBRALES_SEMBRADOS), null);
  }
});

test("clasificarEgresos: umbrales personalizados 50/60/80, bordes inclusivos", () => {
  const umbrales = { informativa: 50, advertencia: 60, critica: 80 };
  assert.equal(clasificarEgresos(49.99, umbrales), null);
  assert.deepEqual(clasificarEgresos(50, umbrales), { severidad: "INFORMATIVA", umbral_aplicado: 50 });
  assert.deepEqual(clasificarEgresos(60, umbrales), { severidad: "ADVERTENCIA", umbral_aplicado: 60 });
  assert.deepEqual(clasificarEgresos(79.99, umbrales), { severidad: "ADVERTENCIA", umbral_aplicado: 60 });
  assert.deepEqual(clasificarEgresos(80, umbrales), { severidad: "CRITICA", umbral_aplicado: 80 });
  // Con 50/60/80, 85 (advertencia de los sembrados) ya es crítica.
  assert.deepEqual(clasificarEgresos(85, umbrales), { severidad: "CRITICA", umbral_aplicado: 80 });
});

// ── decidirTransicion (D3, D8) ────────────────────────────────────────────────

const activa = (severidad: SeveridadAlerta): AlertaVigente => ({ severidad, estado: "ACTIVA" });
const resuelta = (severidad: SeveridadAlerta): AlertaVigente => ({ severidad, estado: "RESUELTA" });

/**
 * Tabla completa, escrita a mano (no derivada de la implementación):
 * actual ∈ {sin alerta, ACTIVA×3, RESUELTA×3} × nueva ∈ {null, CRITICA, ADVERTENCIA, INFORMATIVA}.
 */
const TABLA_TRANSICIONES: readonly [AlertaVigente | null, SeveridadAlerta | null, Transicion][] = [
  [null, null, "NADA"],
  [null, "CRITICA", "CREAR"],
  [null, "ADVERTENCIA", "CREAR"],
  [null, "INFORMATIVA", "CREAR"],

  [activa("CRITICA"), null, "RESOLVER"],
  [activa("CRITICA"), "CRITICA", "NADA"],
  [activa("CRITICA"), "ADVERTENCIA", "CAMBIAR_NIVEL"],
  [activa("CRITICA"), "INFORMATIVA", "CAMBIAR_NIVEL"],

  [activa("ADVERTENCIA"), null, "RESOLVER"],
  [activa("ADVERTENCIA"), "CRITICA", "CAMBIAR_NIVEL"],
  [activa("ADVERTENCIA"), "ADVERTENCIA", "NADA"],
  [activa("ADVERTENCIA"), "INFORMATIVA", "CAMBIAR_NIVEL"],

  [activa("INFORMATIVA"), null, "RESOLVER"],
  [activa("INFORMATIVA"), "CRITICA", "CAMBIAR_NIVEL"],
  [activa("INFORMATIVA"), "ADVERTENCIA", "CAMBIAR_NIVEL"],
  [activa("INFORMATIVA"), "INFORMATIVA", "NADA"],

  [resuelta("CRITICA"), null, "NADA"],
  [resuelta("CRITICA"), "CRITICA", "CREAR"],
  [resuelta("CRITICA"), "ADVERTENCIA", "CREAR"],
  [resuelta("CRITICA"), "INFORMATIVA", "CREAR"],

  [resuelta("ADVERTENCIA"), null, "NADA"],
  [resuelta("ADVERTENCIA"), "CRITICA", "CREAR"],
  [resuelta("ADVERTENCIA"), "ADVERTENCIA", "CREAR"],
  [resuelta("ADVERTENCIA"), "INFORMATIVA", "CREAR"],

  [resuelta("INFORMATIVA"), null, "NADA"],
  [resuelta("INFORMATIVA"), "CRITICA", "CREAR"],
  [resuelta("INFORMATIVA"), "ADVERTENCIA", "CREAR"],
  [resuelta("INFORMATIVA"), "INFORMATIVA", "CREAR"],
];

test("decidirTransicion: la tabla cubre las 28 combinaciones sin repetir", () => {
  const combinaciones = new Set(
    TABLA_TRANSICIONES.map(([actual, nueva]) => `${actual?.estado ?? "-"}:${actual?.severidad ?? "-"}:${nueva ?? "-"}`),
  );
  assert.equal(combinaciones.size, 28);
});

for (const [actual, nueva, esperado] of TABLA_TRANSICIONES) {
  const nombreActual = actual ? `${actual.estado} ${actual.severidad}` : "sin alerta";
  test(`decidirTransicion: ${nombreActual} + ${nueva ?? "null"} → ${esperado}`, () => {
    assert.equal(decidirTransicion(actual, nueva), esperado);
  });
}

test("decidirTransicion: casos explícitos de la task (sube, baja, resuelve, no-op, reapertura)", () => {
  assert.equal(decidirTransicion(null, null), "NADA");
  assert.equal(decidirTransicion(null, "ADVERTENCIA"), "CREAR");
  assert.equal(decidirTransicion(activa("ADVERTENCIA"), "CRITICA"), "CAMBIAR_NIVEL"); // sube
  assert.equal(decidirTransicion(activa("CRITICA"), "INFORMATIVA"), "CAMBIAR_NIVEL"); // baja
  assert.equal(decidirTransicion(activa("CRITICA"), "CRITICA"), "NADA"); // evento repetido
  assert.equal(decidirTransicion(activa("CRITICA"), null), "RESOLVER");
  assert.equal(decidirTransicion(resuelta("CRITICA"), "CRITICA"), "CREAR"); // episodio nuevo
  assert.equal(decidirTransicion(resuelta("ADVERTENCIA"), null), "NADA");
});

// ── esEscaladaACritica (D11) y compararSeveridad ──────────────────────────────

/** Las únicas 3 combinaciones (de 16) que avisan: llegar a CRITICA desde otro nivel o desde "sin alerta". */
const ESCALADAS = new Set(["null>CRITICA", "ADVERTENCIA>CRITICA", "INFORMATIVA>CRITICA"]);
for (const anterior of [null, ...SEVERIDADES]) {
  for (const nueva of [null, ...SEVERIDADES]) {
    const esperado = ESCALADAS.has(`${anterior}>${nueva}`);
    test(`esEscaladaACritica: ${anterior ?? "null"} → ${nueva ?? "null"} = ${esperado}`, () => {
      assert.equal(esEscaladaACritica(anterior, nueva), esperado);
    });
  }
}

const RANGO_ESPERADO: Record<SeveridadAlerta, number> = { CRITICA: 3, ADVERTENCIA: 2, INFORMATIVA: 1 };
for (const a of SEVERIDADES) {
  for (const b of SEVERIDADES) {
    const signo = Math.sign(RANGO_ESPERADO[a] - RANGO_ESPERADO[b]);
    test(`compararSeveridad: ${a} vs ${b} → signo ${signo}`, () => {
      assert.equal(Math.sign(compararSeveridad(a, b)), signo);
    });
  }
}

test("compararSeveridad: ordena de más grave a menos grave", () => {
  const ordenadas = (["INFORMATIVA", "CRITICA", "ADVERTENCIA"] as SeveridadAlerta[]).sort((x, y) =>
    compararSeveridad(y, x),
  );
  assert.deepEqual(ordenadas, ["CRITICA", "ADVERTENCIA", "INFORMATIVA"]);
});

// ── Referencias y claves (D3, D5) ─────────────────────────────────────────────

test("construirReferenciaStock y construirClaveActiva", () => {
  const referencia = construirReferenciaStock("var-1", "dep-9");
  assert.equal(referencia, "var-1:dep-9");
  assert.equal(construirClaveActiva("STOCK_BAJO_PUNTO_PEDIDO", referencia), "STOCK_BAJO_PUNTO_PEDIDO:var-1:dep-9");
  assert.equal(construirClaveActiva("EGRESOS_SOBRE_INGRESOS", "2026-10"), "EGRESOS_SOBRE_INGRESOS:2026-10");
});

test("construirReferenciaEgresos: mes con dos dígitos", () => {
  assert.equal(construirReferenciaEgresos(2026, 1), "2026-01");
  assert.equal(construirReferenciaEgresos(2026, 10), "2026-10");
  assert.equal(construirReferenciaEgresos(2026, 12), "2026-12");
});

test("construirReferenciaEgresos: año o mes inválido → RangeError", () => {
  for (const [anio, mes] of [[2026, 0], [2026, 13], [2026, 1.5], [26, 1], [Number.NaN, 1]]) {
    assert.throws(() => construirReferenciaEgresos(anio!, mes!), RangeError);
  }
});

test("parsearReferenciaEgresos: válidas", () => {
  assert.deepEqual(parsearReferenciaEgresos("2026-10"), { anio: 2026, mes: 10 });
  assert.deepEqual(parsearReferenciaEgresos("2027-01"), { anio: 2027, mes: 1 });
  assert.deepEqual(parsearReferenciaEgresos("2026-12"), { anio: 2026, mes: 12 });
});

test("parsearReferenciaEgresos: inválidas (mes 0, mes 13, formato roto) → null", () => {
  for (const referencia of ["2026-00", "2026-13", "2026-1", "2026/10", "2026-10-01", "26-10", "", " 2026-10", "abcd-ef"]) {
    assert.equal(parsearReferenciaEgresos(referencia), null, referencia);
  }
});

test("parsearReferenciaEgresos es inversa de construirReferenciaEgresos", () => {
  for (let mes = 1; mes <= 12; mes += 1) {
    assert.deepEqual(parsearReferenciaEgresos(construirReferenciaEgresos(2026, mes)), { anio: 2026, mes });
  }
});

test("referenciaEgresosDeDiaIso: fechas de borde de año y de mes", () => {
  assert.equal(referenciaEgresosDeDiaIso("2026-12-31"), "2026-12");
  assert.equal(referenciaEgresosDeDiaIso("2027-01-01"), "2027-01");
  assert.equal(referenciaEgresosDeDiaIso("2026-10-31"), "2026-10");
  assert.equal(referenciaEgresosDeDiaIso("2026-11-01"), "2026-11");
});

test("referenciaEgresosDeDiaIso: formato inválido → RangeError", () => {
  for (const dia of ["2026-13-01", "2026-00-10", "2026-10", "2026-10-15T03:00:00.000Z", "15/10/2026", ""]) {
    assert.throws(() => referenciaEgresosDeDiaIso(dia), RangeError, dia);
  }
});

test("esMesVigente: solo el mes del día de negocio de hoy", () => {
  assert.equal(esMesVigente("2026-10", "2026-10-15"), true);
  assert.equal(esMesVigente("2026-10", "2026-10-31"), true);
  assert.equal(esMesVigente("2026-10", "2026-11-01"), false); // mes terminado
  assert.equal(esMesVigente("2026-12", "2027-01-01"), false); // cambio de año
  assert.equal(esMesVigente("2027-01", "2027-01-01"), true);
  assert.equal(esMesVigente("2026-11", "2026-10-15"), false); // mes futuro
  assert.equal(esMesVigente("2026-13", "2026-10-15"), false); // referencia inválida
});

// ── formatearDetalleAlerta (D12, D26) ─────────────────────────────────────────

test("formatearDetalleAlerta: ejemplos de D12", () => {
  assert.equal(
    formatearDetalleAlerta({ indicador: "STOCK_BAJO_PUNTO_PEDIDO", cantidad_actual: 0, punto_pedido: 5 }),
    "Stock 0 (punto de pedido 5)",
  );
  assert.equal(
    formatearDetalleAlerta({ indicador: "EGRESOS_SOBRE_INGRESOS", porcentaje_egresos: 78.4, umbral_aplicado: 70 }),
    "78,4% (umbral 70%)",
  );
});

test("formatearDetalleAlerta: un decimal con coma y redondeo", () => {
  const egresos = (porcentaje_egresos: number, umbral_aplicado: number | null = 70) =>
    formatearDetalleAlerta({ indicador: "EGRESOS_SOBRE_INGRESOS", porcentaje_egresos, umbral_aplicado });
  assert.equal(egresos(78.4615384615), "78,5% (umbral 70%)");
  assert.equal(egresos(78.44), "78,4% (umbral 70%)");
  assert.equal(egresos(99.96, 85), "100,0% (umbral 85%)");
  assert.equal(egresos(100, 100), "100,0% (umbral 100%)");
});

test("formatearDetalleAlerta: sin umbral aplicado muestra solo el porcentaje; no calculable", () => {
  assert.equal(
    formatearDetalleAlerta({ indicador: "EGRESOS_SOBRE_INGRESOS", porcentaje_egresos: 65.25, umbral_aplicado: null }),
    "65,3%",
  );
  assert.equal(
    formatearDetalleAlerta({ indicador: "EGRESOS_SOBRE_INGRESOS", porcentaje_egresos: 40, umbral_aplicado: undefined }),
    "40,0%",
  );
  assert.equal(
    formatearDetalleAlerta({ indicador: "EGRESOS_SOBRE_INGRESOS", porcentaje_egresos: null, umbral_aplicado: null }),
    "No calculable",
  );
});
