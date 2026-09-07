-- CreateEnum
CREATE TYPE "EstadoReclasificacionSolicitud" AS ENUM ('PENDIENTE_APROBACION', 'APROBADA', 'RECHAZADA');

-- AlterTable
ALTER TABLE "movimiento_stock_items" ADD COLUMN     "motivo" TEXT,
ADD COLUMN     "rma_id" TEXT;

-- CreateTable
CREATE TABLE "reclasificacion_solicitudes" (
    "id" TEXT NOT NULL,
    "variante_sku_id" TEXT NOT NULL,
    "deposito_id" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "motivo" TEXT,
    "rma_id" TEXT,
    "estado" "EstadoReclasificacionSolicitud" NOT NULL DEFAULT 'PENDIENTE_APROBACION',
    "solicitada_por_id" TEXT NOT NULL,
    "aprobada_por_id" TEXT,
    "aprobada_at" TIMESTAMP(3),
    "rechazada_motivo" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reclasificacion_solicitudes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reclasificacion_solicitudes_estado_is_active_idx" ON "reclasificacion_solicitudes"("estado", "is_active");

-- CreateIndex
CREATE INDEX "reclasificacion_solicitudes_variante_sku_id_idx" ON "reclasificacion_solicitudes"("variante_sku_id");

-- CreateIndex
CREATE INDEX "reclasificacion_solicitudes_deposito_id_idx" ON "reclasificacion_solicitudes"("deposito_id");

-- AddForeignKey
ALTER TABLE "reclasificacion_solicitudes" ADD CONSTRAINT "reclasificacion_solicitudes_variante_sku_id_fkey" FOREIGN KEY ("variante_sku_id") REFERENCES "variantes_sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reclasificacion_solicitudes" ADD CONSTRAINT "reclasificacion_solicitudes_deposito_id_fkey" FOREIGN KEY ("deposito_id") REFERENCES "depositos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reclasificacion_solicitudes" ADD CONSTRAINT "reclasificacion_solicitudes_solicitada_por_id_fkey" FOREIGN KEY ("solicitada_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reclasificacion_solicitudes" ADD CONSTRAINT "reclasificacion_solicitudes_aprobada_por_id_fkey" FOREIGN KEY ("aprobada_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
