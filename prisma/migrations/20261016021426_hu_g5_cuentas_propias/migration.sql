-- CreateEnum
CREATE TYPE "TipoCuentaPropia" AS ENUM ('BANCARIA', 'CAJA');

-- AlterTable
ALTER TABLE "cuentas_por_pagar" ADD COLUMN     "cuenta_origen_etiqueta" TEXT;

-- CreateTable
CREATE TABLE "cuentas_propias" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" "TipoCuentaPropia" NOT NULL,
    "banco" TEXT,
    "cbu_cifrado" TEXT,
    "cbu_iv" TEXT,
    "alias_cifrado" TEXT,
    "alias_iv" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cuentas_propias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cuentas_propias_tipo_is_active_idx" ON "cuentas_propias"("tipo", "is_active");

-- Backfill (HU-G5, ADR-3): etiqueta CONGELADA de los pagos históricos de
-- HU-G10, resuelta desde los 3 `id` del catálogo retirado. Cada UPDATE va
-- guardado con `IS NULL` para ser re-ejecutable sin pisar valores ya fijados.
-- Solo escribe texto: sin índices parciales ni restricciones manuales; nada
-- destructivo.
UPDATE "cuentas_por_pagar" SET "cuenta_origen_etiqueta" = 'Banco Nación — Cuenta Corriente Principal'
  WHERE "cuenta_origen_id" = 'banco-nacion-cc-principal' AND "cuenta_origen_etiqueta" IS NULL;
UPDATE "cuentas_por_pagar" SET "cuenta_origen_etiqueta" = 'Banco Galicia — Cuenta Corriente Operativa'
  WHERE "cuenta_origen_id" = 'banco-galicia-cc-operativa' AND "cuenta_origen_etiqueta" IS NULL;
UPDATE "cuentas_por_pagar" SET "cuenta_origen_etiqueta" = 'Caja Chica — Central'
  WHERE "cuenta_origen_id" = 'caja-chica-central' AND "cuenta_origen_etiqueta" IS NULL;
