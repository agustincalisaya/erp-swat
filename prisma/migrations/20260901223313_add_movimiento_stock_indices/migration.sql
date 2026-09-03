-- CreateIndex
CREATE INDEX "movimientos_stock_variante_sku_id_idx" ON "movimientos_stock"("variante_sku_id");

-- CreateIndex
CREATE INDEX "movimientos_stock_deposito_origen_id_idx" ON "movimientos_stock"("deposito_origen_id");

-- CreateIndex
CREATE INDEX "movimientos_stock_deposito_destino_id_idx" ON "movimientos_stock"("deposito_destino_id");

-- CreateIndex
CREATE INDEX "movimientos_stock_tipo_movimiento_idx" ON "movimientos_stock"("tipo_movimiento");

-- CreateIndex
CREATE INDEX "movimientos_stock_created_at_idx" ON "movimientos_stock"("created_at");
