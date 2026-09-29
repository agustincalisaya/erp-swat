import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Test source-regex sobre `prisma/seed.ts` (mismo patrón que
 * `roles-hu-b8.test.ts` — sin DB, corre en el `npm test` default).
 * Complementa (no reemplaza) `rbac-hu-e10.integration.test.ts`
 * (`npm run test:integration:e10`), que verifica contra una base real.
 *
 * Cubre la matriz de spec_modulo_E.md §2.10 (docs/tasks/HU-E10.md §3.1):
 * ADMINISTRADOR_ECOMMERCE agrupa 8 permisos `ecommerce:*`, OPERADOR_PICK_PACK
 * agrupa 3.
 *
 * Unicidad de UUID: acotada a los 16 UUID de HU-E10 contra el resto de
 * seed.ts, no a todas las constantes del archivo — `seed.ts` ya arrastra una
 * colisión preexistente (`MOVIMIENTO_DEVUELTO_SEED_ID` /
 * `LISTA_PRECIO_HOMOLOGADO_ID`, deuda técnica reportada desde HU-B4) que no es
 * de esta HU (ver HU10_MODULO_E.md §6).
 */

const seed = readFileSync(new URL("../../../../prisma/seed.ts", import.meta.url), "utf8");

const PERMISOS_ECOMMERCE: Record<string, [codigo: string, uuid: string]> = {
  PERMISO_ECOMMERCE_GESTIONAR_CATALOGO_ID: ["ecommerce:gestionar_catalogo", "18494e73-f0b7-4bec-84fb-7b65984c959b"],
  PERMISO_ECOMMERCE_GESTIONAR_CUPONES_ID: ["ecommerce:gestionar_cupones", "5c5140b1-8ad0-4e82-9ed2-c87352573aea"],
  PERMISO_ECOMMERCE_ANULAR_ORDEN_NO_ABONADA_ID: ["ecommerce:anular_orden_no_abonada", "baa5e385-e1a2-49ca-a6fa-8b93d01d998e"],
  PERMISO_ECOMMERCE_CANCELAR_PEDIDO_PAGADO_ID: ["ecommerce:cancelar_pedido_pagado", "f8eb98d6-1c61-46b4-bfd1-06c4f7fc7255"],
  PERMISO_ECOMMERCE_LEER_COLA_PREPARACION_ID: ["ecommerce:leer_cola_preparacion", "248e72a2-0d6e-4a35-a977-edea583806d7"],
  PERMISO_ECOMMERCE_PREPARAR_PEDIDO_ID: ["ecommerce:preparar_pedido", "79c4a42c-7382-48f2-97e8-1a7ce26ae2d5"],
  PERMISO_ECOMMERCE_VALIDAR_RETIRO_QR_ID: ["ecommerce:validar_retiro_qr", "8549117c-fca7-47b9-8f73-d4f3f85e777c"],
  PERMISO_ECOMMERCE_LEER_HISTORIAL_ORDENES_ID: ["ecommerce:leer_historial_ordenes", "1a68c39a-f427-47c8-8923-56413c22a177"],
  PERMISO_ECOMMERCE_EXPORTAR_METRICAS_ID: ["ecommerce:exportar_metricas", "c603f9c6-2bf4-4d95-b06c-e339f09ae303"],
  PERMISO_ECOMMERCE_SOLICITAR_ACCESO_LOG_PAGOS_ID: ["ecommerce:solicitar_acceso_log_pagos", "fe71b5b4-09ba-407a-bff0-1aa64656f656"],
};

const RBAC_ECOMMERCE: Record<string, string> = {
  ROL_ADMINISTRADOR_ECOMMERCE_ID: "5a4b283b-fdaf-4253-ab3e-be13c118d74d",
  ROL_OPERADOR_PICK_PACK_ID: "a0028adb-6bc1-48fe-b3e9-2a626d718d4e",
  USUARIO_ADMIN_ECOMMERCE_SEED_ID: "ff9df5a6-2f1a-4285-a935-c6969f933f1a",
  USUARIO_OPERADOR_PICK_PACK_SEED_ID: "62fd609c-ea3b-4e62-b9d2-5ccffad13849",
  USUARIO_ROL_ADMIN_ECOMMERCE_ID: "c6a749f0-5aa6-4983-83e7-7111b02ae5d7",
  USUARIO_ROL_OPERADOR_PICK_PACK_ID: "c9bb2cbe-1118-4411-ac03-3dd02880a709",
};

const PERMISOS_ADMINISTRADOR_ECOMMERCE = [
  "PERMISO_ECOMMERCE_GESTIONAR_CATALOGO_ID",
  "PERMISO_ECOMMERCE_GESTIONAR_CUPONES_ID",
  "PERMISO_ECOMMERCE_ANULAR_ORDEN_NO_ABONADA_ID",
  "PERMISO_ECOMMERCE_CANCELAR_PEDIDO_PAGADO_ID",
  "PERMISO_ECOMMERCE_LEER_COLA_PREPARACION_ID",
  "PERMISO_ECOMMERCE_LEER_HISTORIAL_ORDENES_ID",
  "PERMISO_ECOMMERCE_EXPORTAR_METRICAS_ID",
  "PERMISO_ECOMMERCE_SOLICITAR_ACCESO_LOG_PAGOS_ID",
];

const PERMISOS_OPERADOR_PICK_PACK = [
  "PERMISO_ECOMMERCE_LEER_COLA_PREPARACION_ID",
  "PERMISO_ECOMMERCE_PREPARAR_PEDIDO_ID",
  "PERMISO_ECOMMERCE_VALIDAR_RETIRO_QR_ID",
];

/** Constantes `PERMISO_*_ID` listadas en el array de permisos de un rol dentro de `permisosPorRolEcommerce`. */
function permisosDelRol(variableRol: string): string[] {
  const inicioMatriz = seed.indexOf("const permisosPorRolEcommerce");
  assert.ok(inicioMatriz !== -1, "seed.ts debería declarar permisosPorRolEcommerce");
  const inicioRol = seed.indexOf(`${variableRol}.id,`, inicioMatriz);
  assert.ok(inicioRol !== -1, `permisosPorRolEcommerce debería incluir ${variableRol}.id`);
  const inicioLista = seed.indexOf("[", inicioRol);
  const bloque = seed.slice(inicioLista, seed.indexOf("]", inicioLista));
  return bloque.match(/PERMISO_[A-Z0-9_]+_ID/g) ?? [];
}

test("el seed declara los 10 permisos ecommerce:* con su UUID y modulo MODULO_E", () => {
  for (const [constante, [codigo, uuid]] of Object.entries(PERMISOS_ECOMMERCE)) {
    assert.match(seed, new RegExp(`const ${constante} = "${uuid}";`), `${constante} debería valer ${uuid}`);
    assert.match(
      seed,
      new RegExp(`\\[${constante}, "${codigo}", "`),
      `${constante} debería sembrarse con el código ${codigo}`,
    );
  }

  const inicio = seed.indexOf("// ── HU-E10 — permisos `ecommerce:*`");
  const bloque = seed.slice(inicio, seed.indexOf("// ── HU-E10 — roles de e-commerce", inicio));
  assert.match(bloque, /create:\s*\{\s*id,\s*codigo,\s*descripcion,\s*modulo:\s*"MODULO_E"\s*\}/);
});

test("el seed define los roles ADMINISTRADOR_ECOMMERCE y OPERADOR_PICK_PACK y los usuarios de prueba con sus UUID", () => {
  for (const [constante, uuid] of Object.entries(RBAC_ECOMMERCE)) {
    assert.match(seed, new RegExp(`const ${constante} = "${uuid}";`), `${constante} debería valer ${uuid}`);
  }
  assert.match(seed, /id:\s*ROL_ADMINISTRADOR_ECOMMERCE_ID,\s*\n\s*nombre:\s*"ADMINISTRADOR_ECOMMERCE"/);
  assert.match(seed, /id:\s*ROL_OPERADOR_PICK_PACK_ID,\s*\n\s*nombre:\s*"OPERADOR_PICK_PACK"/);
  assert.match(seed, /nombre_usuario:\s*"admin\.ecommerce\.seed"/);
  assert.match(seed, /nombre_usuario:\s*"operador\.pickpack\.seed"/);
  assert.match(
    seed,
    /\[USUARIO_ROL_ADMIN_ECOMMERCE_ID, usuarioAdminEcommerce\.id, rolAdministradorEcommerce\.id\]/,
  );
  assert.match(
    seed,
    /\[USUARIO_ROL_OPERADOR_PICK_PACK_ID, usuarioOperadorPickPack\.id, rolOperadorPickPack\.id\]/,
  );
});

test("ADMINISTRADOR_ECOMMERCE agrupa exactamente los 8 permisos de la matriz, sin preparar_pedido ni validar_retiro_qr", () => {
  const permisos = permisosDelRol("rolAdministradorEcommerce");
  assert.deepEqual([...permisos].sort(), [...PERMISOS_ADMINISTRADOR_ECOMMERCE].sort());
  assert.ok(!permisos.includes("PERMISO_ECOMMERCE_PREPARAR_PEDIDO_ID"));
  assert.ok(!permisos.includes("PERMISO_ECOMMERCE_VALIDAR_RETIRO_QR_ID"));
});

test("OPERADOR_PICK_PACK agrupa exactamente 3 permisos, sin ninguno de gestión, historial, métricas ni log de pagos", () => {
  const permisos = permisosDelRol("rolOperadorPickPack");
  assert.deepEqual([...permisos].sort(), [...PERMISOS_OPERADOR_PICK_PACK].sort());
  for (const excluido of [
    "PERMISO_ECOMMERCE_GESTIONAR_CATALOGO_ID",
    "PERMISO_ECOMMERCE_GESTIONAR_CUPONES_ID",
    "PERMISO_ECOMMERCE_CANCELAR_PEDIDO_PAGADO_ID",
    "PERMISO_ECOMMERCE_LEER_HISTORIAL_ORDENES_ID",
    "PERMISO_ECOMMERCE_EXPORTAR_METRICAS_ID",
    "PERMISO_ECOMMERCE_SOLICITAR_ACCESO_LOG_PAGOS_ID",
  ]) {
    assert.ok(!permisos.includes(excluido), `OPERADOR_PICK_PACK NO debería incluir ${excluido}`);
  }
});

test("los 16 UUID de HU-E10 son distintos entre sí y no los reutiliza ninguna otra constante de seed.ts", () => {
  const uuidsE10 = [...Object.values(PERMISOS_ECOMMERCE).map(([, uuid]) => uuid), ...Object.values(RBAC_ECOMMERCE)];
  assert.equal(uuidsE10.length, 16);
  assert.equal(new Set(uuidsE10).size, 16, "hay UUID repetidos dentro del bloque HU-E10");

  const constantesE10 = new Set([...Object.keys(PERMISOS_ECOMMERCE), ...Object.keys(RBAC_ECOMMERCE)]);
  const declaraciones = [...seed.matchAll(/const ([A-Z0-9_]+_ID) =\s*"([0-9a-f-]{36})"/g)];
  assert.ok(declaraciones.length > 16, "el regex de declaraciones no encontró las constantes de seed.ts");

  for (const [, nombre, uuid] of declaraciones) {
    if (constantesE10.has(nombre!)) continue;
    assert.ok(!uuidsE10.includes(uuid!), `${nombre} reutiliza el UUID ${uuid} de HU-E10`);
  }
});

// Excluye `*.test.ts`: los tests de integración sí nombran los roles para
// verificar el payload de login, no para autorizar.
test("ningún archivo de aplicación en src/ referencia los nombres de rol de HU-E10 (autorización siempre por permiso)", () => {
  const raizSrc = fileURLToPath(new URL("../../../", import.meta.url));
  const hallazgos: string[] = [];

  const recorrer = (dir: string) => {
    for (const entrada of readdirSync(dir)) {
      const ruta = join(dir, entrada);
      if (statSync(ruta).isDirectory()) {
        recorrer(ruta);
      } else if (/\.(ts|tsx)$/.test(entrada) && !/\.test\.tsx?$/.test(entrada)) {
        if (/ADMINISTRADOR_ECOMMERCE|OPERADOR_PICK_PACK/.test(readFileSync(ruta, "utf8"))) hallazgos.push(ruta);
      }
    }
  };
  recorrer(raizSrc);

  assert.deepEqual(hallazgos, [], `nombres de rol de HU-E10 referenciados en: ${hallazgos.join(", ")}`);
});
