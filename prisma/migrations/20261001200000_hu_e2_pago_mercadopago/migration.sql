-- HU-E2 — Pago online con Mercado Pago (docs/tasks/HU-E2.md §9.2).
-- NO tocar el índice único parcial `carritos_web_cuenta_activa_key` (HU-E1/D5).

-- WebhookPagoLog pasa a traza append-only (desviación de spec F §2.1.3, task §3.4):
-- se quita la clave única (payment_id, topic).
DROP INDEX "log_webhooks_pago_mercadopago_payment_id_topic_key";

ALTER TABLE "log_webhooks_pago" ADD COLUMN     "request_id" TEXT,
ADD COLUMN     "resultado" TEXT NOT NULL DEFAULT 'RECIBIDO';

CREATE INDEX "log_webhooks_pago_mercadopago_payment_id_idx" ON "log_webhooks_pago"("mercadopago_payment_id");

-- Vínculo único pedido ↔ preferencia ↔ pago (HU-E1 §14.1).
ALTER TABLE "pedidos_venta_ecommerce" ADD COLUMN     "mercadopago_checkout_url" TEXT,
ADD COLUMN     "mercadopago_preference_id" TEXT;

CREATE UNIQUE INDEX "pedidos_venta_ecommerce_mercadopago_payment_id_key" ON "pedidos_venta_ecommerce"("mercadopago_payment_id");

CREATE UNIQUE INDEX "pedidos_venta_ecommerce_mercadopago_preference_id_key" ON "pedidos_venta_ecommerce"("mercadopago_preference_id");
