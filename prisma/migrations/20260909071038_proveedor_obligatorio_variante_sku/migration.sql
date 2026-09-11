/*
  Warnings:

  - Made the column `proveedor_id` on table `variantes_sku` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "variantes_sku" ALTER COLUMN "proveedor_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "variantes_sku_proveedor_id_idx" ON "variantes_sku"("proveedor_id");

-- AddForeignKey
ALTER TABLE "variantes_sku" ADD CONSTRAINT "variantes_sku_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
