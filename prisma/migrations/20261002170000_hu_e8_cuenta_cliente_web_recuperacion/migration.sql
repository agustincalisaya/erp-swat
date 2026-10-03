ALTER TABLE "cuentas_cliente_web"
ADD COLUMN "recuperacion_codigo_digest" TEXT,
ADD COLUMN "recuperacion_expira_en" TIMESTAMP(3),
ADD COLUMN "recuperacion_emitida_por_id" TEXT;

CREATE UNIQUE INDEX "cuentas_cliente_web_recuperacion_codigo_digest_key"
ON "cuentas_cliente_web"("recuperacion_codigo_digest");

ALTER TABLE "cuentas_cliente_web"
ADD CONSTRAINT "cuentas_cliente_web_recuperacion_emitida_por_id_fkey"
FOREIGN KEY ("recuperacion_emitida_por_id") REFERENCES "usuarios"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
