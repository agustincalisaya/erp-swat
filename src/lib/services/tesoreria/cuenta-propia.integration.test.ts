import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

/**
 * Test de integración de HU-G5 contra una base real (mismo patrón que
 * `cuenta-por-pagar.*` / `libro-iva.integration.test.ts`). Este gate NO corre
 * con `npm test`: requiere que el shell exporte `HU_G5_INTEGRATION_DATABASE_URL`
 * Y `ENCRYPTION_KEY_PROVEEDORES` (el runner no carga `.env`). Si faltan, el
 * archivo FALLA con un mensaje explícito en vez de saltarse en silencio — un
 * gate que no se ejecuta no puede reportar verde. Los imports son dinámicos
 * porque `cuenta-propia.service.ts` usa `import "server-only"`.
 *
 * Cubre a nivel de servicio (sin HTTP):
 *  - Cifrado por campo: el par `cbu_cifrado/cbu_iv` de la fila cruda difiere
 *    del CBU en claro y `decrypt()` lo recupera (G5-2/G5-6).
 *  - Cuentas sembradas cifradas en reposo y estables (idempotencia de seed).
 *  - Lectura enmascarada + asiento `tesoreria:datos_bancarios_consultados` SIN
 *    valores en `valor_nuevo` (G5-3/G5-4). El asiento lo escribe el listener de
 *    forma asíncrona (fire-and-forget), así que se espera acotadamente en vez
 *    de asumir sincronía.
 *  - Revelado explícito con `tesoreria:ver_datos_bancarios`.
 *  - G10 (HU-G5): `marcarCuentaPorPagarPagada()` rechaza una cuenta de origen
 *    desconocida o inactiva (`CUENTA_ORIGEN_INVALIDA`) y, con una válida,
 *    congela `cuenta_origen_etiqueta` de forma que sobrevive un rename.
 *
 * Corre con: `npm run test:integration:g5` (opt-in, base descartable migrada y
 * sembrada).
 */

const DATABASE_URL = process.env.HU_G5_INTEGRATION_DATABASE_URL;
const HAY_CLAVE = Boolean(process.env.ENCRYPTION_KEY_PROVEEDORES);
const FALTANTES_CONFIG = [
  !DATABASE_URL ? "HU_G5_INTEGRATION_DATABASE_URL" : null,
  !HAY_CLAVE ? "ENCRYPTION_KEY_PROVEEDORES" : null,
].filter((valor): valor is string => Boolean(valor));

// Falla FUERTE (nunca `skip` silencioso) si falta la configuración del gate.
if (FALTANTES_CONFIG.length > 0) {
  test("HU-G5 integración DB — configuración faltante (gate no ejecutado)", () => {
    assert.fail(
      `Faltan variables de entorno: ${FALTANTES_CONFIG.join(", ")}. ` +
        "Este gate NO se ejecuta con 'npm test'; exportá las variables y volvé a correr " +
        "'npm run test:integration:g5'.",
    );
  });
}

/**
 * Espera acotada hasta que `contar()` alcance `minimo` (o venza `timeoutMs`).
 * Necesario porque el asiento de auditoría se escribe de forma asíncrona desde
 * el listener (`domainEventBus.emit` → `registrarAuditLog(...)`); una lectura
 * inmediata es una carrera, no una garantía.
 */
async function esperarContador(
  contar: () => Promise<number>,
  minimo: number,
  timeoutMs: number,
): Promise<number> {
  const limite = Date.now() + timeoutMs;
  let actual = await contar();
  while (actual < minimo && Date.now() < limite) {
    await new Promise((resolver) => setTimeout(resolver, 25));
    actual = await contar();
  }
  return actual;
}

test(
  "HU-G5 — cuentas propias: cifrado, enmascarado, auditoría y congelado de etiqueta (G10)",
  { skip: FALTANTES_CONFIG.length > 0, timeout: 120_000 },
  async (t) => {
    process.env.DATABASE_URL = DATABASE_URL!;

    const [
      { prisma },
      { decrypt },
      cuentaPropia,
      cuentaPorPagar,
      { ServiceError },
      { iniciarAuditLogListener },
    ] = await Promise.all([
      import("../../db/prisma.ts"),
      import("../../crypto/aes.ts"),
      import("./cuenta-propia.service.ts"),
      import("./cuenta-por-pagar.service.ts"),
      import("../../errors/service-error.ts"),
      import("../../events/listeners/audit-log.listener.ts"),
    ]);
    iniciarAuditLogListener();
    t.after(async () => {
      await prisma.$disconnect();
    });

    const admin = await prisma.usuario.findUniqueOrThrow({
      where: { nombre_usuario: "administrador.seed" },
      select: { id: true },
    });
    const proveedor = await prisma.proveedor.findFirstOrThrow({ select: { id: true } });
    const sufijo = randomUUID().slice(0, 8);

    // ── Cifrado por campo ────────────────────────────────────────────────────
    const CBU = "0110599520000001234567";
    const ALIAS = `g5.alias.${sufijo}`;
    const creada = await cuentaPropia.crearCuentaPropia(
      {
        nombre: `Cuenta G5 ${sufijo}`,
        tipo: "BANCARIA",
        banco: "Banco Test",
        cbu: CBU,
        alias: ALIAS,
      },
      admin.id,
    );

    const filaCruda = await prisma.cuentaPropia.findUniqueOrThrow({
      where: { id: creada.cuenta_propia_id },
      select: { cbu_cifrado: true, cbu_iv: true, alias_cifrado: true, alias_iv: true },
    });
    assert.ok(filaCruda.cbu_cifrado, "cbu_cifrado persistido");
    assert.notEqual(filaCruda.cbu_cifrado, CBU, "el ciphertext no es el CBU en claro");
    assert.ok(!filaCruda.cbu_cifrado!.includes(CBU), "el CBU no aparece dentro del ciphertext");
    assert.equal(
      decrypt({ ciphertext: filaCruda.cbu_cifrado!, iv: filaCruda.cbu_iv! }),
      CBU,
      "decrypt() recupera el CBU original",
    );
    assert.equal(
      decrypt({ ciphertext: filaCruda.alias_cifrado!, iv: filaCruda.alias_iv! }),
      ALIAS,
    );

    // ── Cuentas sembradas: cifradas en reposo y estables (idempotencia) ──────
    await t.test("seed: cuentas propias cifradas en reposo y estables", async () => {
      const CBU_SEMBRADO = "0110599520000001234567"; // demo sintético de `prisma/seed.ts`.
      const sembrada = await prisma.cuentaPropia.findUniqueOrThrow({
        where: { id: "banco-nacion-cc-principal" },
        select: { cbu_cifrado: true, cbu_iv: true, alias_cifrado: true, alias_iv: true },
      });
      assert.ok(sembrada.cbu_cifrado, "la cuenta sembrada tiene CBU cifrado (no null)");
      assert.ok(sembrada.cbu_iv, "la cuenta sembrada tiene IV de CBU");
      assert.notEqual(
        sembrada.cbu_cifrado,
        CBU_SEMBRADO,
        "el seed no persiste el CBU en claro",
      );
      assert.ok(
        !sembrada.cbu_cifrado!.includes(CBU_SEMBRADO),
        "el CBU en claro no está contenido en el ciphertext sembrado",
      );
      assert.equal(
        decrypt({ ciphertext: sembrada.cbu_cifrado!, iv: sembrada.cbu_iv! }),
        CBU_SEMBRADO,
        "decrypt() recupera el CBU sembrado",
      );
      // Idempotencia: el `update` del seed NO toca las columnas de cifrado, así
      // que reejecutarlo preserva el ciphertext/IV existente. Releer la fila
      // confirma que el valor en reposo no se rota ni por lecturas ni por seed.
      const releida = await prisma.cuentaPropia.findUniqueOrThrow({
        where: { id: "banco-nacion-cc-principal" },
        select: { cbu_cifrado: true, cbu_iv: true },
      });
      assert.equal(releida.cbu_cifrado, sembrada.cbu_cifrado, "ciphertext estable entre lecturas");
      assert.equal(releida.cbu_iv, sembrada.cbu_iv, "IV estable entre lecturas");
    });

    await t.test("lectura enmascarada + asiento sin valores", async () => {
      const contarAsientosLectura = () =>
        prisma.auditLog.count({
          where: {
            accion: "ACCESO_DATO_CIFRADO_AUDITADO",
            registro_id: creada.cuenta_propia_id,
          },
        });
      const antes = await contarAsientosLectura();
      const listado = await cuentaPropia.listarCuentasPropias(admin.id);
      const propia = listado.find((c) => c.id === creada.cuenta_propia_id);
      assert.ok(propia, "la cuenta aparece en el listado");
      assert.equal(propia!.cbu_enmascarado, "****4567");
      assert.equal(propia!.alias_enmascarado, `****${ALIAS.slice(-4)}`);
      assert.ok(!JSON.stringify(propia).includes(CBU), "el CBU en claro no viaja en el DTO");

      // El asiento lo escribe el listener de forma asíncrona: esperar (bounded)
      // a que aparezca en vez de asumir que la lectura inmediata ya lo ve.
      const despues = await esperarContador(contarAsientosLectura, antes + 1, 5_000);
      assert.ok(
        despues > antes,
        `no se escribió el asiento ACCESO_DATO_CIFRADO_AUDITADO para ` +
          `${creada.cuenta_propia_id} en 5s (antes=${antes}, despues=${despues})`,
      );
      const asiento = await prisma.auditLog.findFirstOrThrow({
        where: { accion: "ACCESO_DATO_CIFRADO_AUDITADO", registro_id: creada.cuenta_propia_id },
        orderBy: { created_at: "desc" },
        select: { valor_nuevo: true, usuario_id: true },
      });
      assert.equal(asiento.usuario_id, admin.id);
      assert.deepEqual(Object.keys(asiento.valor_nuevo as object), ["timestamp"]);
      assert.ok(!JSON.stringify(asiento.valor_nuevo).includes(CBU), "sin CBU en el asiento");
    });

    await t.test("revelado explícito con permiso ver_datos_bancarios", async () => {
      const revelado = await cuentaPropia.revelarDatosBancarios(
        creada.cuenta_propia_id,
        admin.id,
      );
      assert.equal(revelado.cbu, CBU);
      assert.equal(revelado.alias, ALIAS);
    });

    // ── G10: rechazo de cuenta de origen inválida + congelado de etiqueta ─────
    const orden = await prisma.ordenCompra.create({
      data: {
        numero_orden: `G5-${sufijo}-${randomUUID()}`,
        proveedor_id: proveedor.id,
        estado: "CERRADA",
        creada_por_id: admin.id,
      },
    });
    const comprobante = await prisma.comprobanteProveedor.create({
      data: {
        orden_compra_id: orden.id,
        proveedor_id: proveedor.id,
        tipo: "FACTURA_M",
        numero_comprobante: `G5-${sufijo}`,
        fecha_emision: new Date(),
        monto_total: "100",
        registrado_por_id: admin.id,
      },
    });
    const cpp = await prisma.cuentaPorPagar.create({
      data: { orden_compra_id: orden.id, monto: "100", estado: "DEFINITIVA" },
    });
    const inputPago = (cuentaOrigenId: string) => ({
      medio_pago: "TRANSFERENCIA" as const,
      cuenta_origen_id: cuentaOrigenId,
      comprobante_proveedor_ids: [comprobante.id],
    });

    await t.test("cuenta de origen desconocida → CUENTA_ORIGEN_INVALIDA", async () => {
      await assert.rejects(
        () => cuentaPorPagar.marcarCuentaPorPagarPagada(cpp.id, inputPago("cuenta-fantasma"), admin.id),
        (err: unknown) => err instanceof ServiceError && err.code === "CUENTA_ORIGEN_INVALIDA",
      );
    });

    await t.test("cuenta de origen inactiva → CUENTA_ORIGEN_INVALIDA", async () => {
      await prisma.cuentaPropia.update({
        where: { id: creada.cuenta_propia_id },
        data: { is_active: false, deleted_at: new Date(), deleted_by: admin.id, deletion_reason: "test" },
      });
      await assert.rejects(
        () => cuentaPorPagar.marcarCuentaPorPagarPagada(cpp.id, inputPago(creada.cuenta_propia_id), admin.id),
        (err: unknown) => err instanceof ServiceError && err.code === "CUENTA_ORIGEN_INVALIDA",
      );
      // Reactivar (nunca DELETE) para el caso válido.
      await prisma.cuentaPropia.update({
        where: { id: creada.cuenta_propia_id },
        data: { is_active: true, deleted_at: null, deleted_by: null, deletion_reason: null },
      });
    });

    await t.test("pago válido congela la etiqueta y sobrevive al rename", async () => {
      const resultado = await cuentaPorPagar.marcarCuentaPorPagarPagada(
        cpp.id,
        inputPago(creada.cuenta_propia_id),
        admin.id,
      );
      assert.equal(resultado.cuenta_origen_etiqueta, `Cuenta G5 ${sufijo}`);

      const persistida = await prisma.cuentaPorPagar.findUniqueOrThrow({
        where: { id: cpp.id },
        select: { cuenta_origen_id: true, cuenta_origen_etiqueta: true },
      });
      assert.equal(persistida.cuenta_origen_id, creada.cuenta_propia_id);
      assert.equal(persistida.cuenta_origen_etiqueta, `Cuenta G5 ${sufijo}`);

      // Renombrar la cuenta: la etiqueta CONGELADA en el pago no cambia.
      await cuentaPropia.editarCuentaPropia(
        creada.cuenta_propia_id,
        { nombre: `Cuenta renombrada ${sufijo}` },
        admin.id,
      );
      const trasRename = await prisma.cuentaPorPagar.findUniqueOrThrow({
        where: { id: cpp.id },
        select: { cuenta_origen_etiqueta: true },
      });
      assert.equal(trasRename.cuenta_origen_etiqueta, `Cuenta G5 ${sufijo}`);
    });
  },
);
