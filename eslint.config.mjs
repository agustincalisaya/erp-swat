import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  // HU-E2 (spec_modulo_F.md §3.1, RULES.md §4): la API de Mercado Pago solo se
  // toca desde el Adapter. Fuera de `lib/integraciones/mercadopago/**`, nadie
  // importa el SDK `mercadopago` ni el simulador; el Adapter y el Conector solo
  // los usan los servicios de e-commerce, el webhook y el script de prueba.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/integraciones/mercadopago/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "mercadopago", message: "Usá el Adapter de lib/integraciones/mercadopago (spec F §3.1)." }],
          patterns: [
            {
              group: ["**/integraciones/mercadopago/simulador"],
              message: "El simulador de Mercado Pago es interno del Adapter.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/lib/integraciones/mercadopago/**",
      "src/lib/services/ecommerce/**",
      "src/app/api/webhooks/mercadopago/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "mercadopago", message: "Usá el Adapter de lib/integraciones/mercadopago (spec F §3.1)." }],
          patterns: [
            {
              group: ["**/integraciones/mercadopago/*", "!**/integraciones/mercadopago/tipos"],
              message: "Solo e-commerce y el webhook consumen el Conector de Mercado Pago (HU-E2).",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
