-- HU-H4: contrato transaccional e idempotente de recepción de mercadería.
-- El backfill histórico conserva las recepciones ya versionadas (incluida la
-- vinculada a HU-H5) y resuelve el depósito por su nombre estable de seed.

ALTER TABLE "recepciones"
ADD COLUMN "deposito_destino_id" TEXT,
ADD COLUMN "clave_idempotencia" UUID,
ADD COLUMN "payload_hash" TEXT;

ALTER TABLE "recepcion_items"
ADD COLUMN "cantidad_aceptada" INTEGER;

ALTER TABLE "movimientos_stock"
ADD COLUMN "recepcion_id" TEXT;

UPDATE "recepciones" AS r
SET
  "deposito_destino_id" = d."id",
  "clave_idempotencia" = r."id"::uuid,
  -- No existía un request canónico para estas filas. Este SHA-256 es una
  -- marca histórica determinística; las nuevas recepciones usan el hash del
  -- payload canónico definido por el servicio HU-H4.
  "payload_hash" = encode(
    sha256(convert_to('hu-h4:recepcion-historica:' || r."id", 'UTF8')),
    'hex'
  )
FROM "depositos" AS d
WHERE d."nombre" = 'Depósito Central';

UPDATE "recepcion_items"
SET "cantidad_aceptada" = "cantidad_recibida";

ALTER TABLE "recepciones"
ALTER COLUMN "deposito_destino_id" SET NOT NULL,
ALTER COLUMN "clave_idempotencia" SET NOT NULL,
ALTER COLUMN "payload_hash" SET NOT NULL;

ALTER TABLE "recepcion_items"
ALTER COLUMN "cantidad_aceptada" SET NOT NULL;

CREATE UNIQUE INDEX "recepciones_clave_idempotencia_key"
ON "recepciones"("clave_idempotencia");

CREATE INDEX "recepciones_deposito_destino_id_idx"
ON "recepciones"("deposito_destino_id");

CREATE UNIQUE INDEX "recepcion_items_recepcion_id_orden_compra_item_id_key"
ON "recepcion_items"("recepcion_id", "orden_compra_item_id");

CREATE UNIQUE INDEX "movimientos_stock_recepcion_id_key"
ON "movimientos_stock"("recepcion_id");

CREATE INDEX "movimientos_stock_recepcion_id_idx"
ON "movimientos_stock"("recepcion_id");

ALTER TABLE "recepcion_items"
ADD CONSTRAINT "recepcion_items_cantidad_recibida_check"
CHECK ("cantidad_recibida" > 0),
ADD CONSTRAINT "recepcion_items_cantidad_aceptada_no_negativa_check"
CHECK ("cantidad_aceptada" >= 0),
ADD CONSTRAINT "recepcion_items_cantidad_aceptada_hasta_recibida_check"
CHECK ("cantidad_aceptada" <= "cantidad_recibida");

ALTER TABLE "recepciones"
ADD CONSTRAINT "recepciones_deposito_destino_id_fkey"
FOREIGN KEY ("deposito_destino_id") REFERENCES "depositos"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "movimientos_stock"
ADD CONSTRAINT "movimientos_stock_recepcion_id_fkey"
FOREIGN KEY ("recepcion_id") REFERENCES "recepciones"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
