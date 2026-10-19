-- CreateTable
CREATE TABLE "saldos_diarios_cuenta" (
    "id" TEXT NOT NULL,
    "cuenta_id" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "saldo" DECIMAL(12,2) NOT NULL,
    "registrado_por_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saldos_diarios_cuenta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saldos_diarios_cuenta_cuenta_id_fecha_created_at_idx" ON "saldos_diarios_cuenta"("cuenta_id", "fecha", "created_at");

-- AddForeignKey
ALTER TABLE "saldos_diarios_cuenta" ADD CONSTRAINT "saldos_diarios_cuenta_cuenta_id_fkey" FOREIGN KEY ("cuenta_id") REFERENCES "cuentas_propias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
