-- CreateEnum
CREATE TYPE "TipoComprobante" AS ENUM ('FACTURA_A', 'FACTURA_B', 'FACTURA_C', 'FACTURA_M');

-- CreateTable
CREATE TABLE "comprobantes_proveedor" (
    "id" TEXT NOT NULL,
    "orden_compra_id" TEXT NOT NULL,
    "proveedor_id" TEXT NOT NULL,
    "tipo" "TipoComprobante" NOT NULL,
    "numero_comprobante" TEXT NOT NULL,
    "fecha_emision" TIMESTAMP(3) NOT NULL,
    "monto_total" DECIMAL(12,2) NOT NULL,
    "archivo_adjunto_url" TEXT,
    "registrado_por_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comprobantes_proveedor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "comprobantes_proveedor_orden_compra_id_idx" ON "comprobantes_proveedor"("orden_compra_id");

-- CreateIndex
CREATE INDEX "comprobantes_proveedor_proveedor_id_is_active_idx" ON "comprobantes_proveedor"("proveedor_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "comprobantes_proveedor_numero_comprobante_tipo_proveedor_id_key" ON "comprobantes_proveedor"("numero_comprobante", "tipo", "proveedor_id");

-- AddForeignKey
ALTER TABLE "comprobantes_proveedor" ADD CONSTRAINT "comprobantes_proveedor_orden_compra_id_fkey" FOREIGN KEY ("orden_compra_id") REFERENCES "ordenes_compra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprobantes_proveedor" ADD CONSTRAINT "comprobantes_proveedor_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprobantes_proveedor" ADD CONSTRAINT "comprobantes_proveedor_registrado_por_id_fkey" FOREIGN KEY ("registrado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
