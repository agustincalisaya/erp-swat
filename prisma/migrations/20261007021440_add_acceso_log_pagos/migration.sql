-- CreateTable
CREATE TABLE "accesos_log_pagos" (
    "id" TEXT NOT NULL,
    "solicitante_id" TEXT NOT NULL,
    "aprobador_id" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "motivo_solicitud" TEXT,
    "motivo_rechazo" TEXT,
    "solicitada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aprobada_en" TIMESTAMP(3),
    "expira_en" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accesos_log_pagos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accesos_log_pagos_solicitante_id_idx" ON "accesos_log_pagos"("solicitante_id");

-- AddForeignKey
ALTER TABLE "accesos_log_pagos" ADD CONSTRAINT "accesos_log_pagos_solicitante_id_fkey" FOREIGN KEY ("solicitante_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accesos_log_pagos" ADD CONSTRAINT "accesos_log_pagos_aprobador_id_fkey" FOREIGN KEY ("aprobador_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
