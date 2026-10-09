import assert from "node:assert/strict";
import test from "node:test";

const DATABASE_URL = process.env.HU_E13_T06_INTEGRATION_DATABASE_URL;

test("HU-E13 T06 — refund HTTP idempotente", {
  skip: !DATABASE_URL,
  timeout: 120_000,
}, async (t) => {
  process.env.DATABASE_URL = DATABASE_URL;
  process.env.MP_MODO = "real";
  const adapter = await import("./adapter.ts");
  const fetchOriginal = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = fetchOriginal;
  });

  type Captura = { url: string; init: RequestInit };
  const capturas: Captura[] = [];

  function responder(status: "approved" | "rejected" | "pending", id = `refund-${capturas.length + 1}`) {
    globalThis.fetch = async (url, init) => {
      capturas.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ id, payment_id: "123456", amount: 1500, status }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
  }

  function header(captura: Captura, nombre: string) {
    return new Headers(captura.init.headers).get(nombre);
  }

  await t.test("refund total usa POST, endpoint y X-Idempotency-Key exactos", async () => {
    capturas.length = 0;
    responder("approved", "refund-approved");
    const resultado = await adapter.solicitarReembolso("123456", "e13-intento-1");
    assert.deepEqual(resultado, {
      refund_id: "refund-approved",
      payment_id: "123456",
      monto: 1500,
      estado: "APROBADO",
    });
    assert.equal(capturas.length, 1);
    assert.equal(capturas[0]!.url, "https://api.mercadopago.com/v1/payments/123456/refunds");
    assert.equal(capturas[0]!.init.method, "POST");
    assert.equal(capturas[0]!.init.body, undefined);
    assert.equal(header(capturas[0]!, "X-Idempotency-Key"), "e13-intento-1");
    const authorization = header(capturas[0]!, "Authorization");
    assert.ok(authorization?.startsWith("Bearer "));
    assert.ok(authorization && authorization.length > "Bearer ".length);
  });

  await t.test("misma key se transmite igual y una nueva key no reutiliza la anterior", async () => {
    capturas.length = 0;
    responder("approved");
    await adapter.solicitarReembolso("123456", "misma-key");
    await adapter.solicitarReembolso("123456", "misma-key");
    await adapter.solicitarReembolso("123456", "key-nueva");
    assert.deepEqual(capturas.map((captura) => header(captura, "X-Idempotency-Key")), [
      "misma-key",
      "misma-key",
      "key-nueva",
    ]);
  });

  await t.test("refund parcial conserva body amount", async () => {
    capturas.length = 0;
    responder("approved");
    await adapter.solicitarReembolso("123456", "parcial-1", 250.5);
    assert.equal(capturas[0]!.init.body, JSON.stringify({ amount: 250.5 }));
  });

  await t.test("key, payment y monto inválidos rechazan localmente sin HTTP", async () => {
    let requests = 0;
    globalThis.fetch = async () => {
      requests++;
      throw new Error("no debe ejecutarse");
    };
    await assert.rejects(() => adapter.solicitarReembolso("123456", "   "), (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "IDEMPOTENCY_KEY_INVALIDA");
    await assert.rejects(() => adapter.solicitarReembolso("", "key"), (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "PAYMENT_ID_INVALIDO");
    await assert.rejects(() => adapter.solicitarReembolso("123456", "key", 0), (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "MONTO_REEMBOLSO_INVALIDO");
    assert.equal(requests, 0);
  });

  await t.test("REJECTED y PENDING son resultados remotos, no errores técnicos", async () => {
    responder("rejected", "refund-rejected");
    const rechazado = await adapter.solicitarReembolso("123456", "rechazado-1");
    assert.equal(rechazado.estado, "RECHAZADO");
    assert.equal(rechazado.refund_id, "refund-rejected");
    responder("pending", "refund-pending");
    const pendiente = await adapter.solicitarReembolso("123456", "pending-1");
    assert.equal(pendiente.estado, "PENDIENTE");
    assert.equal(pendiente.refund_id, "refund-pending");
  });

  await t.test("timeout y red exponen error técnico reintentable sin filtrar key", async () => {
    for (const caso of ["TIMEOUT", "RED"] as const) {
      globalThis.fetch = async () => {
        const error = new Error(caso === "TIMEOUT" ? "abort" : "socket");
        if (caso === "TIMEOUT") error.name = "AbortError";
        throw error;
      };
      const key = `secreta-${caso}`;
      await assert.rejects(() => adapter.solicitarReembolso("123456", key), (error: unknown) => {
        assert.ok(adapter.esErrorTecnicoReintentableMercadoPago(error));
        assert.equal(error.causa, caso);
        assert.equal(error.reintentable, true);
        assert.doesNotMatch(error.message, new RegExp(key));
        assert.doesNotMatch(error.message, /Authorization|Bearer/i);
        return true;
      });
    }
  });

  await t.test("HTTP 429 y 5xx son técnicos; HTTP 400 es definitivo", async () => {
    for (const [status, causa] of [[429, "HTTP_429"], [503, "HTTP_5XX"]] as const) {
      globalThis.fetch = async () => new Response("{}", { status });
      await assert.rejects(() => adapter.solicitarReembolso("123456", `key-${status}`), (error: unknown) => {
        assert.ok(adapter.esErrorTecnicoReintentableMercadoPago(error));
        assert.equal(error.causa, causa);
        return true;
      });
    }
    globalThis.fetch = async () => new Response("{}", { status: 400 });
    await assert.rejects(() => adapter.solicitarReembolso("123456", "key-400"), (error: unknown) => {
      assert.equal(adapter.esErrorTecnicoReintentableMercadoPago(error), false);
      assert.ok(error instanceof Error && "code" in error && error.code === "PASARELA_RESPUESTA_INVALIDA");
      return true;
    });
  });

  await t.test("HTTP exitoso con respuesta ilegible es resultado remoto ambiguo reintentable", async () => {
    globalThis.fetch = async () => new Response("no-json", { status: 200 });
    await assert.rejects(() => adapter.solicitarReembolso("123456", "key-ambigua"), (error: unknown) => {
      assert.ok(adapter.esErrorTecnicoReintentableMercadoPago(error));
      assert.equal(error.causa, "RESPUESTA_AMBIGUA");
      assert.equal(error.code, "PASARELA_RESPUESTA_AMBIGUA");
      return true;
    });
  });

  await t.test("simulador reutiliza refund con misma key y diferencia una key nueva", async () => {
    process.env.MP_MODO = "simulado";
    const primero = await adapter.solicitarReembolso("123456", "sim-key-1", 100);
    const retry = await adapter.solicitarReembolso("123456", "sim-key-1", 100);
    const nuevo = await adapter.solicitarReembolso("123456", "sim-key-2", 100);
    assert.equal(retry.refund_id, primero.refund_id);
    assert.notEqual(nuevo.refund_id, primero.refund_id);
    process.env.MP_MODO = "real";
  });
});
