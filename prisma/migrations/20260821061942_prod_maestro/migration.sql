-- DropIndex
DROP INDEX "sesiones_jwt_id_idx";

-- CreateTable
CREATE TABLE "reservas" (
    "id" TEXT NOT NULL,
    "variante_sku_id" TEXT NOT NULL,
    "deposito_id" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "fecha_inicio_reserva" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_fin_reserva" TIMESTAMP(3),
    "motivo" TEXT,
    "registrado_por_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reservas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reservas_is_active_fecha_fin_reserva_fecha_inicio_reserva_idx" ON "reservas"("is_active", "fecha_fin_reserva", "fecha_inicio_reserva");

-- AddForeignKey
ALTER TABLE "reservas" ADD CONSTRAINT "reservas_variante_sku_id_fkey" FOREIGN KEY ("variante_sku_id") REFERENCES "variantes_sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservas" ADD CONSTRAINT "reservas_deposito_id_fkey" FOREIGN KEY ("deposito_id") REFERENCES "depositos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservas" ADD CONSTRAINT "reservas_registrado_por_id_fkey" FOREIGN KEY ("registrado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
