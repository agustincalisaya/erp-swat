import assert from "node:assert/strict";
import test from "node:test";
import { ValidarRetiroSchema } from "./retiro-e3.schema.ts";

const DNI_VALIDO = "12345678";
const QR_VALIDO = "token-QR_aceptado";

function rechazaSinEco(body: unknown, valoresSensibles: string[]) {
  const resultado = ValidarRetiroSchema.safeParse(body);
  assert.equal(resultado.success, false);
  if (resultado.success) return;

  const errores = JSON.stringify(resultado.error.issues);
  for (const valor of valoresSensibles) {
    assert.equal(errores.includes(valor), false);
  }
}

test("ValidarRetiroSchema acepta QR y DNI válidos y normaliza espacios externos", () => {
  const resultado = ValidarRetiroSchema.safeParse({
    qr_token: `  ${QR_VALIDO}  `,
    dni: `  ${DNI_VALIDO}  `,
  });
  assert.equal(resultado.success, true);
  if (resultado.success) {
    assert.deepEqual(resultado.data, { qr_token: QR_VALIDO, dni: DNI_VALIDO });
  }
});

test("ValidarRetiroSchema admite QR de 1 y 128 caracteres sin imponer formato base64url", () => {
  for (const qr_token of ["x", "q".repeat(128), "QR válido / contenido completo: ?=+"]) {
    const resultado = ValidarRetiroSchema.safeParse({ qr_token, dni: DNI_VALIDO });
    assert.equal(resultado.success, true);
    if (resultado.success) assert.equal(resultado.data.qr_token, qr_token);
  }
});

test("ValidarRetiroSchema rechaza QR de 129 caracteres, vacío o solo espacios sin eco", () => {
  const largo = "secreto".repeat(18) + "xyz";
  assert.equal(largo.length, 129);
  rechazaSinEco({ qr_token: largo, dni: DNI_VALIDO }, [largo]);
  rechazaSinEco({ qr_token: "", dni: DNI_VALIDO }, [DNI_VALIDO]);
  rechazaSinEco({ qr_token: "   ", dni: DNI_VALIDO }, [DNI_VALIDO]);
});

test("ValidarRetiroSchema acepta DNI de 7 u 8 dígitos y normaliza trim", () => {
  for (const dni of ["1234567", DNI_VALIDO]) {
    const resultado = ValidarRetiroSchema.safeParse({ qr_token: QR_VALIDO, dni: `  ${dni}  ` });
    assert.equal(resultado.success, true);
    if (resultado.success) assert.equal(resultado.data.dni, dni);
  }
});

test("ValidarRetiroSchema rechaza DNI corto, largo y con letras, guiones, puntos o espacios internos", () => {
  for (const dni of ["123456", "123456789", "1234567A", "12-34567", "12.34567", "123 4567"]) {
    rechazaSinEco({ qr_token: QR_VALIDO, dni }, [dni, QR_VALIDO]);
  }
});

test("ValidarRetiroSchema exige ambos campos y rechaza cuerpo vacío o raíz no objeto", () => {
  rechazaSinEco({ dni: DNI_VALIDO }, [DNI_VALIDO]);
  rechazaSinEco({ qr_token: QR_VALIDO }, [QR_VALIDO]);
  rechazaSinEco({}, []);
  rechazaSinEco("contenido-QR-sensible", ["contenido-QR-sensible"]);
});

test("ValidarRetiroSchema rechaza campos extra sin incluir sus valores en errores", () => {
  rechazaSinEco(
    { qr_token: QR_VALIDO, dni: DNI_VALIDO, pedido_venta_id: "pedido-sensible" },
    [QR_VALIDO, DNI_VALIDO, "pedido-sensible"],
  );
});
