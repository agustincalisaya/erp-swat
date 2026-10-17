-- HU-C4 etapa 1A: modelo aditivo. No se crean aceptaciones ni eventos retroactivos.
CREATE TYPE "OrigenConsentimiento" AS ENUM ('LEGADO_SIN_ACREDITACION_EXPRESA', 'EXPRESO');
CREATE TYPE "TipoEventoConsentimientoCliente" AS ENUM (
  'ACEPTACION_INICIAL',
  'RECHAZO_COMERCIAL',
  'SOLICITUD_REVOCACION',
  'REVOCACION_EJECUTADA',
  'SOLICITUD_RECHAZADA',
  'NUEVA_ACEPTACION'
);

-- El DEFAULT conserva compatible el servicio de alta y el seed actuales:
-- ambos omiten origen y registrado_por_id, por lo que sus filas no acreditan
-- una aceptación expresa. Las filas anteriores reciben la misma clasificación.
ALTER TABLE "consentimientos_cliente"
  ADD COLUMN "origen" "OrigenConsentimiento" NOT NULL DEFAULT 'LEGADO_SIN_ACREDITACION_EXPRESA',
  ADD COLUMN "registrado_por_id" TEXT;

ALTER TABLE "consentimientos_cliente"
  ADD CONSTRAINT "consentimientos_cliente_expreso_check"
  CHECK (
    "origen" <> 'EXPRESO'
    OR ("registrado_por_id" IS NOT NULL AND "alcance" <> 'AMBOS')
  );

ALTER TABLE "consentimientos_cliente"
  ADD CONSTRAINT "consentimientos_cliente_registrado_por_id_fkey"
  FOREIGN KEY ("registrado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "eventos_consentimiento_cliente" (
  "id" TEXT NOT NULL,
  "cliente_id" TEXT NOT NULL,
  "consentimiento_id" TEXT,
  "tipo" "TipoEventoConsentimientoCliente" NOT NULL,
  "alcance" "AlcanceConsentimiento" NOT NULL,
  "finalidad" TEXT NOT NULL,
  "fecha_evento" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "usuario_id" TEXT NOT NULL,
  "motivo" TEXT,
  "solicitud_evento_id" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "deleted_at" TIMESTAMP(3),
  "deleted_by" TEXT,
  "deletion_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "eventos_consentimiento_cliente_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "eventos_consentimiento_cliente_alcance_check" CHECK ("alcance" <> 'AMBOS'),
  CONSTRAINT "eventos_consentimiento_cliente_motivo_check" CHECK (
    "tipo" <> 'SOLICITUD_RECHAZADA'
    OR ("motivo" IS NOT NULL AND length(btrim("motivo")) > 0)
  ),
  CONSTRAINT "eventos_consentimiento_cliente_referencias_check" CHECK (
    ("tipo" IN ('ACEPTACION_INICIAL', 'NUEVA_ACEPTACION')
      AND "consentimiento_id" IS NOT NULL AND "solicitud_evento_id" IS NULL)
    OR ("tipo" = 'RECHAZO_COMERCIAL' AND "alcance" = 'COMUNICACIONES_COMERCIALES'
      AND "consentimiento_id" IS NULL AND "solicitud_evento_id" IS NULL)
    OR ("tipo" = 'SOLICITUD_REVOCACION' AND "alcance" = 'VENTA_ASISTIDA'
      AND "consentimiento_id" IS NOT NULL AND "solicitud_evento_id" IS NULL)
    OR ("tipo" = 'REVOCACION_EJECUTADA' AND "consentimiento_id" IS NOT NULL
      AND (("alcance" = 'VENTA_ASISTIDA' AND "solicitud_evento_id" IS NOT NULL)
        OR ("alcance" = 'COMUNICACIONES_COMERCIALES' AND "solicitud_evento_id" IS NULL)))
    OR ("tipo" = 'SOLICITUD_RECHAZADA' AND "alcance" = 'VENTA_ASISTIDA'
      AND "consentimiento_id" IS NOT NULL AND "solicitud_evento_id" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "eventos_consentimiento_cliente_solicitud_evento_id_key"
  ON "eventos_consentimiento_cliente"("solicitud_evento_id");
CREATE INDEX "eventos_consentimiento_cliente_estado_idx"
  ON "eventos_consentimiento_cliente"("cliente_id", "alcance", "fecha_evento", "id");
CREATE INDEX "eventos_consentimiento_cliente_historial_idx"
  ON "eventos_consentimiento_cliente"("consentimiento_id", "fecha_evento", "id");

ALTER TABLE "eventos_consentimiento_cliente"
  ADD CONSTRAINT "eventos_consentimiento_cliente_cliente_id_fkey"
  FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "eventos_consentimiento_cliente"
  ADD CONSTRAINT "eventos_consentimiento_cliente_consentimiento_id_fkey"
  FOREIGN KEY ("consentimiento_id") REFERENCES "consentimientos_cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "eventos_consentimiento_cliente"
  ADD CONSTRAINT "eventos_consentimiento_cliente_usuario_id_fkey"
  FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "eventos_consentimiento_cliente"
  ADD CONSTRAINT "eventos_consentimiento_cliente_solicitud_evento_id_fkey"
  FOREIGN KEY ("solicitud_evento_id") REFERENCES "eventos_consentimiento_cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
