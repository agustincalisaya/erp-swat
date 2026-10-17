-- CreateEnum
CREATE TYPE "EstadoReintegroPedidoWeb" AS ENUM ('PENDIENTE', 'APROBADO', 'RECHAZADO');

-- CreateEnum
CREATE TYPE "TipoActorReintegro" AS ENUM ('CLIENTE_WEB', 'USUARIO', 'SISTEMA');

-- CreateEnum
CREATE TYPE "EstadoIntentoRefund" AS ENUM ('PENDIENTE', 'APROBADO', 'RECHAZADO');

-- CreateEnum
CREATE TYPE "OrigenIntentoRefund" AS ENUM ('INICIAL', 'REINTENTO_MANUAL');

-- AlterEnum
ALTER TYPE "TipoComprobanteVenta" ADD VALUE 'NOTA_CREDITO';

-- AlterTable
ALTER TABLE "comprobantes_fiscales" ADD COLUMN "comprobante_original_id" TEXT;

-- CreateTable
CREATE TABLE "reintegros_pedido_web" (
    "id" TEXT NOT NULL,
    "pedido_venta_id" TEXT NOT NULL,
    "mercadopago_payment_id" TEXT NOT NULL,
    "estado" "EstadoReintegroPedidoWeb" NOT NULL DEFAULT 'PENDIENTE',
    "monto_total" DECIMAL(12,2) NOT NULL,
    "motivo" TEXT NOT NULL,
    "solicitado_por_tipo" "TipoActorReintegro" NOT NULL,
    "solicitado_por_id" TEXT,
    "nota_credito_id" TEXT,
    "contra_asiento_ingreso_id" TEXT,
    "intento_aprobado_id" TEXT,
    "ultimo_error_codigo" TEXT,
    "proximo_reintento_at" TIMESTAMP(3),
    "resuelto_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reintegros_pedido_web_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reintegro_stock_compensaciones" (
    "id" TEXT NOT NULL,
    "reintegro_id" TEXT NOT NULL,
    "pedido_venta_item_id" TEXT NOT NULL,
    "variante_sku_id" TEXT NOT NULL,
    "deposito_id" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "clave_idempotencia" TEXT NOT NULL,
    "movimiento_stock_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "reintegro_stock_compensaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reintegro_refund_intentos" (
    "id" TEXT NOT NULL,
    "reintegro_id" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "origen" "OrigenIntentoRefund" NOT NULL,
    "clave_idempotencia" TEXT NOT NULL,
    "estado" "EstadoIntentoRefund" NOT NULL DEFAULT 'PENDIENTE',
    "refund_id" TEXT,
    "error_codigo" TEXT,
    "motivo_reintento" TEXT,
    "creado_por_id" TEXT,
    "intentos_tecnicos" INTEGER NOT NULL DEFAULT 0,
    "ultimo_intento_at" TIMESTAMP(3),
    "resuelto_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reintegro_refund_intentos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reintegros_pedido_web_pedido_venta_id_key" ON "reintegros_pedido_web"("pedido_venta_id");
CREATE UNIQUE INDEX "reintegros_pedido_web_mercadopago_payment_id_key" ON "reintegros_pedido_web"("mercadopago_payment_id");
CREATE UNIQUE INDEX "reintegros_pedido_web_nota_credito_id_key" ON "reintegros_pedido_web"("nota_credito_id");
CREATE UNIQUE INDEX "reintegros_pedido_web_contra_asiento_ingreso_id_key" ON "reintegros_pedido_web"("contra_asiento_ingreso_id");
CREATE UNIQUE INDEX "reintegros_pedido_web_intento_aprobado_id_key" ON "reintegros_pedido_web"("intento_aprobado_id");
CREATE INDEX "reintegros_pedido_web_estado_proximo_reintento_at_idx" ON "reintegros_pedido_web"("estado", "proximo_reintento_at");

CREATE UNIQUE INDEX "reintegro_stock_compensaciones_clave_idempotencia_key" ON "reintegro_stock_compensaciones"("clave_idempotencia");
CREATE UNIQUE INDEX "reintegro_stock_compensaciones_movimiento_stock_id_key" ON "reintegro_stock_compensaciones"("movimiento_stock_id");
CREATE INDEX "reintegro_stock_compensaciones_reintegro_id_idx" ON "reintegro_stock_compensaciones"("reintegro_id");
CREATE INDEX "reintegro_stock_compensaciones_pedido_venta_item_id_idx" ON "reintegro_stock_compensaciones"("pedido_venta_item_id");
CREATE INDEX "reintegro_stock_compensaciones_variante_sku_id_idx" ON "reintegro_stock_compensaciones"("variante_sku_id");
CREATE INDEX "reintegro_stock_compensaciones_deposito_id_idx" ON "reintegro_stock_compensaciones"("deposito_id");
CREATE UNIQUE INDEX "reintegro_stock_compensaciones_reintegro_id_pedido_venta_it_key" ON "reintegro_stock_compensaciones"("reintegro_id", "pedido_venta_item_id");

CREATE UNIQUE INDEX "reintegro_refund_intentos_clave_idempotencia_key" ON "reintegro_refund_intentos"("clave_idempotencia");
CREATE UNIQUE INDEX "reintegro_refund_intentos_refund_id_key" ON "reintegro_refund_intentos"("refund_id");
CREATE INDEX "reintegro_refund_intentos_reintegro_id_estado_idx" ON "reintegro_refund_intentos"("reintegro_id", "estado");
CREATE INDEX "reintegro_refund_intentos_creado_por_id_idx" ON "reintegro_refund_intentos"("creado_por_id");
CREATE UNIQUE INDEX "reintegro_refund_intentos_reintegro_id_numero_key" ON "reintegro_refund_intentos"("reintegro_id", "numero");

CREATE INDEX "comprobantes_fiscales_comprobante_original_id_idx" ON "comprobantes_fiscales"("comprobante_original_id");

-- AddForeignKey
ALTER TABLE "comprobantes_fiscales" ADD CONSTRAINT "comprobantes_fiscales_comprobante_original_id_fkey" FOREIGN KEY ("comprobante_original_id") REFERENCES "comprobantes_fiscales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "reintegros_pedido_web" ADD CONSTRAINT "reintegros_pedido_web_pedido_venta_id_fkey" FOREIGN KEY ("pedido_venta_id") REFERENCES "pedidos_venta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reintegros_pedido_web" ADD CONSTRAINT "reintegros_pedido_web_mercadopago_payment_id_fkey" FOREIGN KEY ("mercadopago_payment_id") REFERENCES "pedidos_venta_ecommerce"("mercadopago_payment_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reintegros_pedido_web" ADD CONSTRAINT "reintegros_pedido_web_solicitado_por_id_fkey" FOREIGN KEY ("solicitado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reintegros_pedido_web" ADD CONSTRAINT "reintegros_pedido_web_nota_credito_id_fkey" FOREIGN KEY ("nota_credito_id") REFERENCES "comprobantes_fiscales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reintegros_pedido_web" ADD CONSTRAINT "reintegros_pedido_web_contra_asiento_ingreso_id_fkey" FOREIGN KEY ("contra_asiento_ingreso_id") REFERENCES "contra_asientos_ingreso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reintegros_pedido_web" ADD CONSTRAINT "reintegros_pedido_web_intento_aprobado_id_fkey" FOREIGN KEY ("intento_aprobado_id") REFERENCES "reintegro_refund_intentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "reintegro_stock_compensaciones" ADD CONSTRAINT "reintegro_stock_compensaciones_reintegro_id_fkey" FOREIGN KEY ("reintegro_id") REFERENCES "reintegros_pedido_web"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reintegro_stock_compensaciones" ADD CONSTRAINT "reintegro_stock_compensaciones_pedido_venta_item_id_fkey" FOREIGN KEY ("pedido_venta_item_id") REFERENCES "pedido_venta_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reintegro_stock_compensaciones" ADD CONSTRAINT "reintegro_stock_compensaciones_variante_sku_id_fkey" FOREIGN KEY ("variante_sku_id") REFERENCES "variantes_sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reintegro_stock_compensaciones" ADD CONSTRAINT "reintegro_stock_compensaciones_deposito_id_fkey" FOREIGN KEY ("deposito_id") REFERENCES "depositos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reintegro_stock_compensaciones" ADD CONSTRAINT "reintegro_stock_compensaciones_movimiento_stock_id_fkey" FOREIGN KEY ("movimiento_stock_id") REFERENCES "movimientos_stock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "reintegro_refund_intentos" ADD CONSTRAINT "reintegro_refund_intentos_reintegro_id_fkey" FOREIGN KEY ("reintegro_id") REFERENCES "reintegros_pedido_web"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reintegro_refund_intentos" ADD CONSTRAINT "reintegro_refund_intentos_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
