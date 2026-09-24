import assert from "node:assert/strict";
import test from "node:test";
import { nombresSimilares } from "./duplicados.ts";

test("C5 duplicados: tildes, orden, espacios y una errata; evita nombres diferentes", () => {
  assert.equal(nombresSimilares("María Gómez", "  GOMEZ maria "), true);
  assert.equal(nombresSimilares("Maria Gomez", "Maria Gomes"), true);
  assert.equal(nombresSimilares("Maria Gomez", "Mario Lopez"), false);
  assert.equal(nombresSimilares("Ana", "Eva"), false);
});
