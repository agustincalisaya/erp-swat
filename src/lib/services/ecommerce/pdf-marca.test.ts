/**
 * HU-B10 — helpers de marca del PDF (spec_modulo_B.md §2.10): número fiscal
 * visible, constantes del emisor y colores del sistema.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { cargarPdfMarca } from "./comprobante-pdf.test-helpers.ts";

interface ModuloMarca {
  PUNTO_VENTA: string;
  CUIT_EMISOR_SIMULADO: string;
  EMISOR: { razon_social: string; cuit: string; domicilio: string; bajada: string };
  TOKENS: Record<string, string>;
  numeroFiscalVisible: (numeroVenta: string) => string | null;
  formatearCuit: (cuit: string) => string;
}

const marca = cargarPdfMarca<ModuloMarca>();
const leer = (ruta: string) => readFileSync(new URL(ruta, import.meta.url), "utf8");

test("B10-2 · número fiscal: PV 00001 y los últimos 8 dígitos del número de venta (Backlog, HU-G4)", () => {
  assert.equal(marca.PUNTO_VENTA, "00001");
  assert.equal(marca.numeroFiscalVisible("V-2026-000001"), "00001-26000001");
  assert.equal(marca.numeroFiscalVisible("V-2026-000010"), "00001-26000010");
  assert.equal(marca.numeroFiscalVisible("V-2026-123456"), "00001-26123456");
  // La referencia de la NC lleva el mismo número de venta.
  assert.equal(marca.numeroFiscalVisible("NC-V-2026-000002"), "00001-26000002");
});

test("B10-2 · número fiscal: sin 8 dígitos no se inventa ni se lanza error (null)", () => {
  for (const numero of ["", "V-propio", "V-12-345", "1234567"]) {
    assert.equal(marca.numeroFiscalVisible(numero), null, numero);
  }
});

test("B10-4 · el CUIT simulado del PDF es el mismo que usa HU-B7 en el QR", () => {
  const b7 = leer("../ventas/comprobante-fiscal.service.ts");
  const cuitB7 = /const CUIT_EMISOR_SIMULADO = "(\d{11})";/.exec(b7);
  assert.ok(cuitB7, "comprobante-fiscal.service.ts declara CUIT_EMISOR_SIMULADO");
  assert.equal(marca.CUIT_EMISOR_SIMULADO, cuitB7[1], "las dos constantes divergen: actualizar pdf-marca.ts");
  assert.equal(marca.EMISOR.cuit, "30-00000000-7");
  assert.equal(marca.formatearCuit("30111222334"), "30-11122233-4");
});

test("B10-4 · el emisor tiene razón social, domicilio y bajada de ejemplo editables", () => {
  assert.equal(marca.EMISOR.razon_social, "SWAT Indumentarias");
  assert.equal(marca.EMISOR.domicilio, "Sucursal Salta");
  assert.equal(marca.EMISOR.bajada, "Indumentaria táctica");
  assert.match(leer("./pdf-marca.ts"), /valores? de ejemplo/i);
});

test("B10-2 · los colores salen de los tokens del tema claro de globals.css", () => {
  const css = leer("../../../app/globals.css");
  assert.ok(Object.keys(marca.TOKENS).length >= 10);
  for (const [token, hex] of Object.entries(marca.TOKENS)) {
    // La primera declaración de cada token es la del tema claro (:root).
    const declarado = new RegExp(`--${token}:\\s*(#[0-9A-Fa-f]{6});`).exec(css);
    assert.ok(declarado, `globals.css declara --${token}`);
    assert.equal(hex.toUpperCase(), declarado[1]!.toUpperCase(), `--${token}`);
  }
});

test("B10-2 · el isotipo es el ShieldCheck de lucide del login, con su licencia ISC", () => {
  const fuente = leer("./pdf-marca.ts");
  const login = leer("../../../app/(auth)/login/page.tsx");
  assert.match(login, /<ShieldCheck className="size-8 text-sidebar-primary"/);
  assert.match(fuente, /ISC/);
  assert.match(fuente, /M20 13c0 5-3\.5 7\.5-7\.66 8\.95/);
  assert.match(fuente, /m9 12 2 2 4-4/);
});
