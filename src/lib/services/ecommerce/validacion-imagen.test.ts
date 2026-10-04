import assert from "node:assert/strict";
import test from "node:test";
import { imagenMinima, jpgDeTamano, textoComoImagen } from "./hu-e11.test-fixtures.ts";
import { detectarFormatoImagen, PATRON_NOMBRE_FOTO, validarImagen } from "./validacion-imagen.ts";

/** HU-E11 (spec E §2.11; task_relos.md §3.1, §6.1, D21, D22) — validación de imagen por firma de bytes. */

const TODOS = ["JPG", "PNG", "WEBP"] as const;
const MB = 1024 * 1024;

test("detectarFormatoImagen reconoce las tres firmas válidas", () => {
  assert.equal(detectarFormatoImagen(imagenMinima("JPG")), "JPG");
  assert.equal(detectarFormatoImagen(imagenMinima("PNG")), "PNG");
  assert.equal(detectarFormatoImagen(imagenMinima("WEBP")), "WEBP");
});

test("detectarFormatoImagen: texto con nombre .jpg, vacío, firmas truncadas y RIFF que no es WEBP → null", () => {
  assert.equal(detectarFormatoImagen(textoComoImagen()), null);
  assert.equal(detectarFormatoImagen(new Uint8Array()), null);
  assert.equal(detectarFormatoImagen(new Uint8Array([0xff, 0xd8])), null);
  assert.equal(detectarFormatoImagen(imagenMinima("PNG").subarray(0, 7)), null);
  const riffWave = new TextEncoder().encode("RIFF\0\0\0\0WAVEfmt ");
  assert.equal(detectarFormatoImagen(riffWave), null);
  // GIF: formato real, pero no admitido por el sistema.
  assert.equal(detectarFormatoImagen(new TextEncoder().encode("GIF89a")), null);
});

test("validarImagen acepta las tres firmas válidas cuando están permitidas", () => {
  for (const formato of TODOS) {
    assert.deepEqual(
      validarImagen({ buffer: imagenMinima(formato), formatosPermitidos: TODOS, tamanoMaxBytes: 5 * MB }),
      { ok: true, formato },
    );
  }
});

test("validarImagen: un .jpg cuyo contenido es texto → FORMATO_IMAGEN_NO_ADMITIDO", () => {
  assert.deepEqual(
    validarImagen({ buffer: textoComoImagen(), formatosPermitidos: TODOS, tamanoMaxBytes: 5 * MB }),
    { ok: false, error: "FORMATO_IMAGEN_NO_ADMITIDO" },
  );
});

test("validarImagen: archivo vacío → ARCHIVO_VACIO", () => {
  assert.deepEqual(
    validarImagen({ buffer: new Uint8Array(), formatosPermitidos: TODOS, tamanoMaxBytes: 5 * MB }),
    { ok: false, error: "ARCHIVO_VACIO" },
  );
});

test("validarImagen: tamaño exactamente en el límite se admite; un byte más → ARCHIVO_DEMASIADO_GRANDE", () => {
  const limite = 5 * MB;
  assert.deepEqual(
    validarImagen({ buffer: jpgDeTamano(limite), formatosPermitidos: TODOS, tamanoMaxBytes: limite }),
    { ok: true, formato: "JPG" },
  );
  assert.deepEqual(
    validarImagen({ buffer: jpgDeTamano(limite + 1), formatosPermitidos: TODOS, tamanoMaxBytes: limite }),
    { ok: false, error: "ARCHIVO_DEMASIADO_GRANDE" },
  );
});

test("validarImagen: formato real pero no permitido por la configuración → FORMATO_IMAGEN_NO_ADMITIDO", () => {
  assert.deepEqual(
    validarImagen({ buffer: imagenMinima("WEBP"), formatosPermitidos: ["JPG", "PNG"], tamanoMaxBytes: 5 * MB }),
    { ok: false, error: "FORMATO_IMAGEN_NO_ADMITIDO" },
  );
});

test("PATRON_NOMBRE_FOTO solo admite UUID + extensión generada por el servidor", () => {
  assert.ok(PATRON_NOMBRE_FOTO.test("0b9f2d4e-1c2a-4f3b-9d8e-7a6b5c4d3e2f.jpg"));
  for (const nombre of [
    "../.env",
    "..%2F.env",
    "0b9f2d4e-1c2a-4f3b-9d8e-7a6b5c4d3e2f.svg",
    "0b9f2d4e-1c2a-4f3b-9d8e-7a6b5c4d3e2f.jpg/../x",
    "/etc/passwd",
    "foto.jpg",
    "0B9F2D4E-1C2A-4F3B-9D8E-7A6B5C4D3E2F.JPG",
  ]) {
    assert.equal(PATRON_NOMBRE_FOTO.test(nombre), false, nombre);
  }
});
