-- CreateEnum
CREATE TYPE "MedioPago" AS ENUM ('TRANSFERENCIA', 'CHEQUE', 'EFECTIVO');

-- AlterTable
ALTER TABLE "cuentas_por_pagar" ADD COLUMN     "cuenta_origen_id" TEXT,
ADD COLUMN     "medio_pago" "MedioPago",
ADD COLUMN     "observaciones" TEXT;

-- CreateTable
CREATE TABLE "cuentas_por_pagar_comprobantes" (
    "id" TEXT NOT NULL,
    "cuenta_por_pagar_id" TEXT NOT NULL,
    "comprobante_proveedor_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cuentas_por_pagar_comprobantes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cuentas_por_pagar_comprobantes_comprobante_proveedor_id_idx" ON "cuentas_por_pagar_comprobantes"("comprobante_proveedor_id");

-- CreateIndex
CREATE UNIQUE INDEX "cuentas_por_pagar_comprobantes_cuenta_por_pagar_id_comproba_key" ON "cuentas_por_pagar_comprobantes"("cuenta_por_pagar_id", "comprobante_proveedor_id");

-- AddForeignKey
ALTER TABLE "cuentas_por_pagar_comprobantes" ADD CONSTRAINT "cuentas_por_pagar_comprobantes_cuenta_por_pagar_id_fkey" FOREIGN KEY ("cuenta_por_pagar_id") REFERENCES "cuentas_por_pagar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cuentas_por_pagar_comprobantes" ADD CONSTRAINT "cuentas_por_pagar_comprobantes_comprobante_proveedor_id_fkey" FOREIGN KEY ("comprobante_proveedor_id") REFERENCES "comprobantes_proveedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
