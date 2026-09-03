/*
  Warnings:

  - You are about to drop the column `cantidad` on the `movimientos_stock` table. All the data in the column will be lost.
  - You are about to drop the column `estado_destino` on the `movimientos_stock` table. All the data in the column will be lost.
  - You are about to drop the column `estado_origen` on the `movimientos_stock` table. All the data in the column will be lost.
  - You are about to drop the column `variante_sku_id` on the `movimientos_stock` table. All the data in the column will be lost.
  - You are about to drop the column `cantidad` on the `transferencias_stock` table. All the data in the column will be lost.
  - You are about to drop the column `variante_sku_id` on the `transferencias_stock` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "EstadoItemTransferencia" AS ENUM ('PENDIENTE', 'RECIBIDO_PARCIAL', 'RECIBIDO_TOTAL');

-- AlterEnum
ALTER TYPE "EstadoTransferencia" ADD VALUE 'PARCIAL';

-- DropForeignKey
ALTER TABLE "movimientos_stock" DROP CONSTRAINT "movimientos_stock_variante_sku_id_fkey";

-- DropForeignKey
ALTER TABLE "transferencias_stock" DROP CONSTRAINT "transferencias_stock_variante_sku_id_fkey";

-- DropIndex
DROP INDEX "movimientos_stock_variante_sku_id_idx";

-- DropIndex
DROP INDEX "transferencias_stock_variante_sku_id_estado_is_active_idx";

-- AlterTable
ALTER TABLE "movimientos_stock" DROP COLUMN "cantidad",
DROP COLUMN "estado_destino",
DROP COLUMN "estado_origen",
DROP COLUMN "variante_sku_id";

-- AlterTable
ALTER TABLE "transferencias_stock" DROP COLUMN "cantidad",
DROP COLUMN "variante_sku_id";

-- CreateTable
CREATE TABLE "movimiento_stock_items" (
    "id" TEXT NOT NULL,
    "movimiento_id" TEXT NOT NULL,
    "variante_sku_id" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "estado_origen" TEXT,
    "estado_destino" TEXT,
    "numero_serie" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "movimiento_stock_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transferencia_stock_items" (
    "id" TEXT NOT NULL,
    "transferencia_id" TEXT NOT NULL,
    "variante_sku_id" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "cantidad_recibida" INTEGER NOT NULL DEFAULT 0,
    "estado_item" "EstadoItemTransferencia" NOT NULL DEFAULT 'PENDIENTE',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transferencia_stock_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "movimiento_stock_items_movimiento_id_idx" ON "movimiento_stock_items"("movimiento_id");

-- CreateIndex
CREATE INDEX "movimiento_stock_items_variante_sku_id_idx" ON "movimiento_stock_items"("variante_sku_id");

-- CreateIndex
CREATE INDEX "transferencia_stock_items_transferencia_id_idx" ON "transferencia_stock_items"("transferencia_id");

-- CreateIndex
CREATE INDEX "transferencia_stock_items_variante_sku_id_idx" ON "transferencia_stock_items"("variante_sku_id");

-- CreateIndex
CREATE INDEX "transferencias_stock_estado_is_active_idx" ON "transferencias_stock"("estado", "is_active");

-- AddForeignKey
ALTER TABLE "movimiento_stock_items" ADD CONSTRAINT "movimiento_stock_items_movimiento_id_fkey" FOREIGN KEY ("movimiento_id") REFERENCES "movimientos_stock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_stock_items" ADD CONSTRAINT "movimiento_stock_items_variante_sku_id_fkey" FOREIGN KEY ("variante_sku_id") REFERENCES "variantes_sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transferencia_stock_items" ADD CONSTRAINT "transferencia_stock_items_transferencia_id_fkey" FOREIGN KEY ("transferencia_id") REFERENCES "transferencias_stock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transferencia_stock_items" ADD CONSTRAINT "transferencia_stock_items_variante_sku_id_fkey" FOREIGN KEY ("variante_sku_id") REFERENCES "variantes_sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
