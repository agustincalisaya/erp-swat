/**
 * HU-B10 — carga aislada del renderer del comprobante y extracción de texto.
 *
 * `comprobante-web-pdf.ts` importa `server-only`, que revienta bajo
 * `node --experimental-strip-types`. Se transpila en memoria (patrón de
 * reporte-mensual.service.test.ts) y se resuelve su única dependencia
 * relativa, `./pdf-marca`, con el mismo mecanismo. Target moderno a
 * propósito: con ES5 la subclase de `Error` (`QrFiscalInvalidoError`) pierde
 * su prototipo y el `instanceof` de las rutas fallaría solo en los tests.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInThisContext } from "node:vm";
import { inflateSync } from "node:zlib";
import { PDFArray, PDFDocument, PDFRawStream } from "pdf-lib";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";

const requireReal = createRequire(import.meta.url);

/** Transpila y ejecuta `archivo` resolviendo solo las dependencias dadas (más los paquetes reales). */
export function cargarAislado<T>(archivo: URL, dependencias: Record<string, unknown>): T {
  const fuente = readFileSync(archivo, "utf8");
  const compilerOptions = { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 };
  const codigo = transpileModule(fuente, { compilerOptions }).outputText;
  const modulo: { exports: Record<string, unknown> } = { exports: {} };
  const ejecutar = runInThisContext(`(function(require, module, exports) {\n${codigo}\n})`, { filename: archivo.pathname });
  ejecutar(
    (nombre: string) => {
      if (Object.hasOwn(dependencias, nombre)) return dependencias[nombre];
      if (nombre.startsWith(".") || nombre.startsWith("@/")) throw new Error(`Dependencia inesperada: ${nombre}`);
      return requireReal(nombre);
    },
    modulo,
    modulo.exports,
  );
  return modulo.exports as T;
}

/** `pdf-marca.ts` sin dependencias del proyecto. */
export function cargarPdfMarca<T = Record<string, unknown>>(): T {
  return cargarAislado<T>(new URL("./pdf-marca.ts", import.meta.url), {});
}

/** `comprobante-web-pdf.ts` con `server-only` aislado y `./pdf-marca` real. */
export function cargarComprobantePdf<T = Record<string, unknown>>(): T {
  return cargarAislado<T>(new URL("./comprobante-web-pdf.ts", import.meta.url), {
    "server-only": {},
    "./pdf-marca": cargarPdfMarca(),
  });
}

export interface PdfExtraido {
  documento: PDFDocument;
  /** Texto de cada página, una línea por operador `Tj`. */
  paginas: string[];
  /** Todo el texto del documento, en orden. */
  texto: string;
  /** Operadores de contenido de cada página (descomprimidos). */
  operadores: string[];
}

/** Carga el PDF con `PDFDocument.load` y extrae el texto de cada página. */
export async function extraerPdf(bytes: Uint8Array): Promise<PdfExtraido> {
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString(), "%PDF-");
  const documento = await PDFDocument.load(bytes);
  const operadores = documento.getPages().map((pagina) => {
    const contents = pagina.node.Contents();
    assert.ok(contents);
    const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
    return refs
      .map((ref) => {
        const stream = documento.context.lookup(ref);
        assert.ok(stream instanceof PDFRawStream);
        return inflateSync(stream.getContents()).toString("latin1");
      })
      .join("\n");
  });
  // WinAnsi: 0x97 es la raya «—»; el resto del rango coincide con latin1.
  const paginas = operadores.map((ops) =>
    [...ops.matchAll(/<([0-9A-F]+)> Tj/g)]
      .map((m) => Buffer.from(m[1]!, "hex").toString("latin1").replace(/\x97/g, "—").replace(/\x95/g, "•"))
      .join("\n"),
  );
  return { documento, paginas, texto: paginas.join("\n"), operadores };
}
