-- CreateEnum
CREATE TYPE "IndicadorAlertaDesvio" AS ENUM ('STOCK_BAJO_PUNTO_PEDIDO', 'EGRESOS_SOBRE_INGRESOS');

-- CreateEnum
CREATE TYPE "SeveridadAlertaDesvio" AS ENUM ('CRITICA', 'ADVERTENCIA', 'INFORMATIVA');

-- CreateEnum
CREATE TYPE "EstadoAlertaDesvio" AS ENUM ('ACTIVA', 'RESUELTA');

-- CreateTable
CREATE TABLE "alertas_desvio" (
    "id" TEXT NOT NULL,
    "indicador" "IndicadorAlertaDesvio" NOT NULL,
    "referencia" TEXT NOT NULL,
    "clave_activa" TEXT,
    "severidad" "SeveridadAlertaDesvio" NOT NULL,
    "estado" "EstadoAlertaDesvio" NOT NULL DEFAULT 'ACTIVA',
    "variante_sku_id" TEXT,
    "deposito_id" TEXT,
    "cantidad_actual" INTEGER,
    "punto_pedido" INTEGER,
    "porcentaje_egresos" DECIMAL(9,2),
    "umbral_aplicado" DECIMAL(9,2),
    "resuelta_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alertas_desvio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "alertas_desvio_clave_activa_key" ON "alertas_desvio"("clave_activa");

-- CreateIndex
CREATE INDEX "alertas_desvio_estado_severidad_created_at_idx" ON "alertas_desvio"("estado", "severidad", "created_at");

-- CreateIndex
CREATE INDEX "alertas_desvio_estado_indicador_idx" ON "alertas_desvio"("estado", "indicador");

-- CreateIndex
CREATE INDEX "alertas_desvio_variante_sku_id_deposito_id_idx" ON "alertas_desvio"("variante_sku_id", "deposito_id");

-- AddForeignKey
ALTER TABLE "alertas_desvio" ADD CONSTRAINT "alertas_desvio_variante_sku_id_fkey" FOREIGN KEY ("variante_sku_id") REFERENCES "variantes_sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alertas_desvio" ADD CONSTRAINT "alertas_desvio_deposito_id_fkey" FOREIGN KEY ("deposito_id") REFERENCES "depositos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
