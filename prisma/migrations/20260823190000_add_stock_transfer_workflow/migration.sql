CREATE TYPE "EstadoTransferencia" AS ENUM ('EN_TRANSITO', 'RECIBIDA');

CREATE TABLE "transferencias_stock" (
  "id" TEXT NOT NULL,
  "numero_remito" TEXT NOT NULL,
  "variante_sku_id" TEXT NOT NULL,
  "deposito_origen_id" TEXT NOT NULL,
  "deposito_destino_id" TEXT NOT NULL,
  "cantidad" INTEGER NOT NULL,
  "estado" "EstadoTransferencia" NOT NULL DEFAULT 'EN_TRANSITO',
  "despachada_por_id" TEXT NOT NULL,
  "despachada_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recibida_por_id" TEXT,
  "recibida_at" TIMESTAMP(3),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "deleted_at" TIMESTAMP(3),
  "deleted_by" TEXT,
  "deletion_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "transferencias_stock_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "transferencias_stock_cantidad_check" CHECK ("cantidad" > 0),
  CONSTRAINT "transferencias_stock_depositos_check" CHECK ("deposito_origen_id" <> "deposito_destino_id")
);
CREATE UNIQUE INDEX "transferencias_stock_numero_remito_key" ON "transferencias_stock"("numero_remito");
CREATE INDEX "transferencias_stock_variante_sku_id_estado_is_active_idx" ON "transferencias_stock"("variante_sku_id", "estado", "is_active");
CREATE INDEX "transferencias_stock_deposito_destino_id_estado_is_active_idx" ON "transferencias_stock"("deposito_destino_id", "estado", "is_active");
ALTER TABLE "transferencias_stock" ADD CONSTRAINT "transferencias_stock_variante_sku_id_fkey" FOREIGN KEY ("variante_sku_id") REFERENCES "variantes_sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transferencias_stock" ADD CONSTRAINT "transferencias_stock_deposito_origen_id_fkey" FOREIGN KEY ("deposito_origen_id") REFERENCES "depositos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transferencias_stock" ADD CONSTRAINT "transferencias_stock_deposito_destino_id_fkey" FOREIGN KEY ("deposito_destino_id") REFERENCES "depositos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transferencias_stock" ADD CONSTRAINT "transferencias_stock_despachada_por_id_fkey" FOREIGN KEY ("despachada_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transferencias_stock" ADD CONSTRAINT "transferencias_stock_recibida_por_id_fkey" FOREIGN KEY ("recibida_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
