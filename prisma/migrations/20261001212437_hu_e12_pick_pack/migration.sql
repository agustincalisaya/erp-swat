-- HU-E12: fecha real de confirmación de pago y persistencia de unidades escaneadas en Pick&Pack.
-- No se realiza backfill de fecha_pago_confirmado ni de ningún dato histórico.

-- AlterTable
ALTER TABLE "pedidos_venta_ecommerce" ADD COLUMN "fecha_pago_confirmado" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "pedido_preparacion_escaneos" (
    "id" TEXT NOT NULL,
    "pedido_venta_item_id" TEXT NOT NULL,
    "operador_id" TEXT NOT NULL,
    "scan_id" TEXT NOT NULL,
    "codigo_escaneado" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pedido_preparacion_escaneos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pedido_preparacion_escaneos_scan_id_key" ON "pedido_preparacion_escaneos"("scan_id");

-- CreateIndex
CREATE INDEX "pedido_preparacion_escaneos_pedido_venta_item_id_is_active__idx" ON "pedido_preparacion_escaneos"("pedido_venta_item_id", "is_active", "deleted_at");

-- AddForeignKey
ALTER TABLE "pedido_preparacion_escaneos" ADD CONSTRAINT "pedido_preparacion_escaneos_pedido_venta_item_id_fkey" FOREIGN KEY ("pedido_venta_item_id") REFERENCES "pedido_venta_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_preparacion_escaneos" ADD CONSTRAINT "pedido_preparacion_escaneos_operador_id_fkey" FOREIGN KEY ("operador_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
