-- HU-C5 etapa 1: aditiva. No backfill, no seed, no cambios comerciales/C4.
BEGIN;

-- CreateEnum
CREATE TYPE "EstadoSolicitudFusionCliente" AS ENUM ('PENDIENTE', 'APROBADA', 'RECHAZADA');

-- CreateEnum
CREATE TYPE "TipoEventoFusionCliente" AS ENUM ('SOLICITADA', 'APROBADA', 'RECHAZADA');

-- AlterTable
ALTER TABLE "direcciones_cliente" ADD COLUMN     "direccion_origen_id" TEXT,
ADD COLUMN     "fusion_solicitud_id" TEXT;

-- CreateTable
CREATE TABLE "solicitudes_fusion_cliente" (
    "id" TEXT NOT NULL,
    "cliente_a_id" TEXT NOT NULL,
    "cliente_b_id" TEXT NOT NULL,
    "principal_propuesto_id" TEXT,
    "solicitado_por_id" TEXT NOT NULL,
    "motivo_solicitud" TEXT NOT NULL,
    "estado" "EstadoSolicitudFusionCliente" NOT NULL DEFAULT 'PENDIENTE',
    "cliente_principal_id" TEXT,
    "cliente_secundario_id" TEXT,
    "resuelto_por_id" TEXT,
    "resuelto_at" TIMESTAMP(3),
    "motivo_resolucion" TEXT,
    "identidad_verificada" BOOLEAN NOT NULL DEFAULT false,
    "metodo_verificacion" TEXT,
    "referencia_verificacion" TEXT,
    "revision_comparada" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "solicitudes_fusion_cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos_fusion_cliente" (
    "id" TEXT NOT NULL,
    "solicitud_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "tipo" "TipoEventoFusionCliente" NOT NULL,
    "orden" INTEGER NOT NULL,
    "clave_idempotencia" TEXT NOT NULL,
    "comando_hash" TEXT NOT NULL,
    "detalle_cifrado" TEXT,
    "detalle_iv" TEXT,
    "version_clave" TEXT,
    "version_formato" INTEGER NOT NULL DEFAULT 1,
    "auditoria_registrada_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eventos_fusion_cliente_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "solicitudes_fusion_cliente_estado_created_at_idx" ON "solicitudes_fusion_cliente"("estado", "created_at");

-- CreateIndex
CREATE INDEX "solicitudes_fusion_cliente_solicitado_por_id_created_at_idx" ON "solicitudes_fusion_cliente"("solicitado_por_id", "created_at");

-- CreateIndex
CREATE INDEX "solicitudes_fusion_cliente_cliente_a_id_estado_idx" ON "solicitudes_fusion_cliente"("cliente_a_id", "estado");

-- CreateIndex
CREATE INDEX "solicitudes_fusion_cliente_cliente_b_id_estado_idx" ON "solicitudes_fusion_cliente"("cliente_b_id", "estado");

-- CreateIndex
CREATE INDEX "solicitudes_fusion_cliente_cliente_principal_id_idx" ON "solicitudes_fusion_cliente"("cliente_principal_id");

-- CreateIndex
CREATE INDEX "solicitudes_fusion_cliente_cliente_secundario_id_idx" ON "solicitudes_fusion_cliente"("cliente_secundario_id");

-- CreateIndex
CREATE UNIQUE INDEX "eventos_fusion_cliente_clave_idempotencia_key" ON "eventos_fusion_cliente"("clave_idempotencia");

-- CreateIndex
CREATE INDEX "eventos_fusion_cliente_auditoria_registrada_at_created_at_idx" ON "eventos_fusion_cliente"("auditoria_registrada_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "eventos_fusion_cliente_solicitud_id_orden_key" ON "eventos_fusion_cliente"("solicitud_id", "orden");

-- CreateIndex
CREATE INDEX "clientes_fusionado_en_id_idx" ON "clientes"("fusionado_en_id");

-- CreateIndex
CREATE INDEX "direcciones_cliente_direccion_origen_id_idx" ON "direcciones_cliente"("direccion_origen_id");

-- CreateIndex
CREATE UNIQUE INDEX "direcciones_cliente_fusion_origen_key" ON "direcciones_cliente"("fusion_solicitud_id", "direccion_origen_id");

-- AddForeignKey
ALTER TABLE "direcciones_cliente" ADD CONSTRAINT "direcciones_cliente_direccion_origen_id_fkey" FOREIGN KEY ("direccion_origen_id") REFERENCES "direcciones_cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direcciones_cliente" ADD CONSTRAINT "direcciones_cliente_fusion_solicitud_id_fkey" FOREIGN KEY ("fusion_solicitud_id") REFERENCES "solicitudes_fusion_cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_fusion_cliente" ADD CONSTRAINT "solicitudes_fusion_cliente_cliente_a_id_fkey" FOREIGN KEY ("cliente_a_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_fusion_cliente" ADD CONSTRAINT "solicitudes_fusion_cliente_cliente_b_id_fkey" FOREIGN KEY ("cliente_b_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_fusion_cliente" ADD CONSTRAINT "solicitudes_fusion_cliente_principal_propuesto_id_fkey" FOREIGN KEY ("principal_propuesto_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_fusion_cliente" ADD CONSTRAINT "solicitudes_fusion_cliente_cliente_principal_id_fkey" FOREIGN KEY ("cliente_principal_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_fusion_cliente" ADD CONSTRAINT "solicitudes_fusion_cliente_cliente_secundario_id_fkey" FOREIGN KEY ("cliente_secundario_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_fusion_cliente" ADD CONSTRAINT "solicitudes_fusion_cliente_solicitado_por_id_fkey" FOREIGN KEY ("solicitado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_fusion_cliente" ADD CONSTRAINT "solicitudes_fusion_cliente_resuelto_por_id_fkey" FOREIGN KEY ("resuelto_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos_fusion_cliente" ADD CONSTRAINT "eventos_fusion_cliente_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitudes_fusion_cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos_fusion_cliente" ADD CONSTRAINT "eventos_fusion_cliente_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Restricciones que Prisma 6 no representa en el schema.
ALTER TABLE solicitudes_fusion_cliente
  ADD CONSTRAINT c5_participantes_check CHECK (
    cliente_a_id <> cliente_b_id
    AND (principal_propuesto_id IS NULL OR principal_propuesto_id IN (cliente_a_id, cliente_b_id))
    AND length(btrim(motivo_solicitud)) > 0
  ),
  ADD CONSTRAINT c5_resolucion_check CHECK (
    (estado = 'PENDIENTE' AND resuelto_por_id IS NULL AND resuelto_at IS NULL
      AND motivo_resolucion IS NULL AND cliente_principal_id IS NULL AND cliente_secundario_id IS NULL
      AND identidad_verificada = false AND metodo_verificacion IS NULL
      AND referencia_verificacion IS NULL AND revision_comparada IS NULL)
    OR
    (estado = 'RECHAZADA' AND resuelto_por_id IS NOT NULL AND resuelto_at IS NOT NULL
      AND motivo_resolucion IS NOT NULL AND length(btrim(motivo_resolucion)) > 0
      AND cliente_principal_id IS NULL AND cliente_secundario_id IS NULL
      AND identidad_verificada = false AND metodo_verificacion IS NULL
      AND referencia_verificacion IS NULL AND revision_comparada IS NULL)
    OR
    (estado = 'APROBADA' AND resuelto_por_id IS NOT NULL AND resuelto_at IS NOT NULL
      AND motivo_resolucion IS NOT NULL AND length(btrim(motivo_resolucion)) > 0
      AND cliente_principal_id IS NOT NULL AND cliente_secundario_id IS NOT NULL
      AND cliente_principal_id <> cliente_secundario_id
      AND cliente_principal_id IN (cliente_a_id, cliente_b_id)
      AND cliente_secundario_id IN (cliente_a_id, cliente_b_id)
      AND identidad_verificada = true
      AND metodo_verificacion IS NOT NULL AND length(btrim(metodo_verificacion)) > 0
      AND referencia_verificacion IS NOT NULL AND length(btrim(referencia_verificacion)) > 0
      AND revision_comparada IS NOT NULL AND revision_comparada ~ '^[a-f0-9]{64}$')
  );

ALTER TABLE eventos_fusion_cliente
  ADD CONSTRAINT c5_evento_orden_check CHECK (
    (tipo = 'SOLICITADA' AND orden = 1) OR (tipo IN ('APROBADA', 'RECHAZADA') AND orden = 2)
  ),
  ADD CONSTRAINT c5_evento_hash_check CHECK (comando_hash ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT c5_evento_evidencia_check CHECK (
    (tipo = 'APROBADA' AND detalle_cifrado IS NOT NULL
      AND detalle_cifrado ~ '^([a-f0-9]{2}){17,}$'
      AND detalle_iv IS NOT NULL AND detalle_iv ~ '^[a-f0-9]{24}$'
      AND version_clave IS NOT NULL AND length(version_clave) > 0 AND version_formato = 1)
    OR
    (tipo <> 'APROBADA' AND detalle_cifrado IS NULL AND detalle_iv IS NULL AND version_clave IS NULL)
  );

ALTER TABLE direcciones_cliente ADD CONSTRAINT c5_direccion_origen_check CHECK (
  (direccion_origen_id IS NULL AND fusion_solicitud_id IS NULL)
  OR (direccion_origen_id IS NOT NULL AND fusion_solicitud_id IS NOT NULL AND direccion_origen_id <> id)
);

CREATE FUNCTION c5_proteger_solicitud() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'C5: no se permite borrar expedientes' USING ERRCODE = '23514';
  END IF;
  IF OLD.estado <> 'PENDIENTE' OR
     ROW(NEW.id, NEW.cliente_a_id, NEW.cliente_b_id, NEW.principal_propuesto_id,
         NEW.solicitado_por_id, NEW.motivo_solicitud, NEW.created_at)
       IS DISTINCT FROM
     ROW(OLD.id, OLD.cliente_a_id, OLD.cliente_b_id, OLD.principal_propuesto_id,
         OLD.solicitado_por_id, OLD.motivo_solicitud, OLD.created_at) THEN
    RAISE EXCEPTION 'C5: expediente o resolución inmutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER c5_solicitud_inmutable BEFORE UPDATE OR DELETE ON solicitudes_fusion_cliente
  FOR EACH ROW EXECUTE FUNCTION c5_proteger_solicitud();

CREATE FUNCTION c5_proteger_evento() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'C5: no se permite borrar hechos' USING ERRCODE = '23514';
  END IF;
  IF (to_jsonb(NEW) - 'updated_at' - 'auditoria_registrada_at') IS DISTINCT FROM
     (to_jsonb(OLD) - 'updated_at' - 'auditoria_registrada_at') OR
     (OLD.auditoria_registrada_at IS NOT NULL AND NEW.auditoria_registrada_at IS DISTINCT FROM OLD.auditoria_registrada_at) THEN
    RAISE EXCEPTION 'C5: evento inmutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER c5_evento_inmutable BEFORE UPDATE OR DELETE ON eventos_fusion_cliente
  FOR EACH ROW EXECUTE FUNCTION c5_proteger_evento();

-- Comprobar al COMMIT: permite insertar copias y eventos dentro de la aprobación,
-- pero no confirmar una resolución sin su hecho durable ni sin la redirección.
CREATE FUNCTION c5_validar_expediente() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  solicitud_identificador text;
  s solicitudes_fusion_cliente%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'solicitudes_fusion_cliente' THEN
    solicitud_identificador := NEW.id;
  ELSIF TG_TABLE_NAME = 'eventos_fusion_cliente' THEN
    solicitud_identificador := NEW.solicitud_id;
  ELSE
    solicitud_identificador := NEW.fusion_solicitud_id;
  END IF;
  IF solicitud_identificador IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO STRICT s FROM solicitudes_fusion_cliente WHERE id = solicitud_identificador;
  IF NOT EXISTS (SELECT 1 FROM eventos_fusion_cliente WHERE solicitud_id = s.id
                 AND orden = 1 AND tipo = 'SOLICITADA' AND usuario_id = s.solicitado_por_id) THEN
    RAISE EXCEPTION 'C5: falta evento de solicitud' USING ERRCODE = '23514';
  END IF;
  IF s.estado = 'PENDIENTE' THEN
    IF EXISTS (SELECT 1 FROM eventos_fusion_cliente WHERE solicitud_id = s.id AND orden = 2)
       OR EXISTS (SELECT 1 FROM direcciones_cliente WHERE fusion_solicitud_id = s.id) THEN
      RAISE EXCEPTION 'C5: pendiente con efectos de resolución' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM eventos_fusion_cliente WHERE solicitud_id = s.id AND orden = 2
                   AND tipo::text = s.estado::text AND usuario_id = s.resuelto_por_id) THEN
      RAISE EXCEPTION 'C5: falta evento de resolución' USING ERRCODE = '23514';
    END IF;
    IF s.estado = 'APROBADA' AND NOT EXISTS (SELECT 1 FROM clientes
      WHERE id = s.cliente_secundario_id AND fusionado_en_id = s.cliente_principal_id
      AND is_active = false AND deleted_at IS NOT NULL AND deletion_reason = 'duplicado') THEN
      RAISE EXCEPTION 'C5: aprobación sin redirección' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM direcciones_cliente copia
    JOIN direcciones_cliente origen ON origen.id = copia.direccion_origen_id
    WHERE copia.fusion_solicitud_id = s.id AND
      (s.estado <> 'APROBADA' OR copia.cliente_id <> s.cliente_principal_id OR origen.cliente_id <> s.cliente_secundario_id)) THEN
    RAISE EXCEPTION 'C5: procedencia de dirección incompatible' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER c5_solicitud_consistente AFTER INSERT OR UPDATE ON solicitudes_fusion_cliente
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION c5_validar_expediente();
CREATE CONSTRAINT TRIGGER c5_evento_consistente AFTER INSERT OR UPDATE ON eventos_fusion_cliente
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION c5_validar_expediente();
CREATE CONSTRAINT TRIGGER c5_copia_consistente AFTER INSERT OR UPDATE ON direcciones_cliente
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION c5_validar_expediente();

CREATE FUNCTION c5_proteger_origen_direccion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.direccion_origen_id, NEW.fusion_solicitud_id) IS DISTINCT FROM
     ROW(OLD.direccion_origen_id, OLD.fusion_solicitud_id) OR
     (OLD.fusion_solicitud_id IS NOT NULL AND NEW.cliente_id <> OLD.cliente_id) THEN
    RAISE EXCEPTION 'C5: procedencia inmutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER c5_direccion_procedencia BEFORE UPDATE ON direcciones_cliente
  FOR EACH ROW EXECUTE FUNCTION c5_proteger_origen_direccion();

COMMIT;
