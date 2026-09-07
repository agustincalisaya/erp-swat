-- Fix de idempotencia/trazabilidad HU-H5: vincula cada EvaluacionProveedor
-- a la Recepcion que la origino, para poder detectar invocaciones
-- duplicadas de registrarEvaluacionDesdeRecepcion() por recepcion_id.

-- AlterTable: se agrega nullable primero para poder backfillear datos
-- preexistentes antes de exigir NOT NULL.
ALTER TABLE "evaluaciones_proveedor" ADD COLUMN "recepcion_id" TEXT;

-- Backfill: al momento de esta migracion existe una unica fila en
-- evaluaciones_proveedor (la del seed de Sprint 2, id
-- 1a2b3c4d-aaaa-4a1a-8a1a-000000000001), creada como placeholder manual
-- antes de que este campo existiera, y una unica fila en recepciones (id
-- 1a2b3c4d-8888-4a1a-8a1a-000000000001) para el mismo proveedor. Se
-- vinculan explicitamente para no perder la fila existente. Verificado
-- contra la base real antes de escribir esta migracion (ambas tablas
-- tenian exactamente 1 fila cada una).
UPDATE "evaluaciones_proveedor"
SET "recepcion_id" = '1a2b3c4d-8888-4a1a-8a1a-000000000001'
WHERE "id" = '1a2b3c4d-aaaa-4a1a-8a1a-000000000001'
  AND "recepcion_id" IS NULL;

-- AlterTable: ahora que no quedan NULLs, se exige NOT NULL.
ALTER TABLE "evaluaciones_proveedor" ALTER COLUMN "recepcion_id" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "evaluaciones_proveedor_recepcion_id_key" ON "evaluaciones_proveedor"("recepcion_id");

-- AddForeignKey
ALTER TABLE "evaluaciones_proveedor" ADD CONSTRAINT "evaluaciones_proveedor_recepcion_id_fkey" FOREIGN KEY ("recepcion_id") REFERENCES "recepciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
