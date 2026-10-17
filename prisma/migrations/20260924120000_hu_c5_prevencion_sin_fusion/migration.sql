-- Propuesta para revisión. Conserva la historia de migraciones y la relación
-- clientes.fusionado_en_id usada por HU-C7, incluido su índice.
-- DROP usa RESTRICT: cualquier dependencia ajena hace fallar la transacción.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM solicitudes_fusion_cliente LIMIT 1)
    OR EXISTS (SELECT 1 FROM eventos_fusion_cliente LIMIT 1)
    OR EXISTS (SELECT 1 FROM direcciones_cliente
               WHERE direccion_origen_id IS NOT NULL OR fusion_solicitud_id IS NOT NULL LIMIT 1)
    OR EXISTS (SELECT 1 FROM audit_logs
               WHERE tabla_afectada IN ('solicitudes_fusion_cliente', 'eventos_fusion_cliente') LIMIT 1) THEN
    RAISE EXCEPTION 'C5: hay registros históricos; se cancela la corrección sin borrar datos';
  END IF;

  -- Vistas/materialized views ajenas que dependen de las tablas a retirar.
  IF EXISTS (
    SELECT 1 FROM pg_depend d
    JOIN pg_rewrite r ON r.oid = d.objid
    JOIN pg_class v ON v.oid = r.ev_class
    WHERE d.refobjid IN ('solicitudes_fusion_cliente'::regclass,
                         'eventos_fusion_cliente'::regclass)
      AND v.relname NOT IN ('solicitudes_fusion_cliente', 'eventos_fusion_cliente')
  ) THEN
    RAISE EXCEPTION 'C5: una vista externa depende de las tablas de fusión';
  END IF;
END $$;

DROP TRIGGER c5_redireccion_inmutable ON clientes;
DROP TRIGGER c5_direccion_historica ON direcciones_cliente;
DROP TRIGGER c5_direccion_procedencia ON direcciones_cliente;
DROP TRIGGER c5_copia_consistente ON direcciones_cliente;
DROP TRIGGER c5_solicitud_inmutable ON solicitudes_fusion_cliente;
DROP TRIGGER c5_solicitud_consistente ON solicitudes_fusion_cliente;
DROP TRIGGER c5_evento_inmutable ON eventos_fusion_cliente;
DROP TRIGGER c5_evento_consistente ON eventos_fusion_cliente;

DROP FUNCTION c5_proteger_redireccion() RESTRICT;
DROP FUNCTION c5_proteger_direccion_historica() RESTRICT;
DROP FUNCTION c5_proteger_origen_direccion() RESTRICT;
DROP FUNCTION c5_validar_expediente() RESTRICT;
DROP FUNCTION c5_proteger_solicitud() RESTRICT;
DROP FUNCTION c5_proteger_evento() RESTRICT;

ALTER TABLE direcciones_cliente DROP CONSTRAINT c5_direccion_origen_check RESTRICT;
ALTER TABLE direcciones_cliente DROP CONSTRAINT direcciones_cliente_direccion_origen_id_fkey RESTRICT;
ALTER TABLE direcciones_cliente DROP CONSTRAINT direcciones_cliente_fusion_solicitud_id_fkey RESTRICT;
DROP INDEX direcciones_cliente_fusion_origen_key RESTRICT;
DROP INDEX direcciones_cliente_direccion_origen_id_idx RESTRICT;
ALTER TABLE direcciones_cliente DROP COLUMN direccion_origen_id RESTRICT;
ALTER TABLE direcciones_cliente DROP COLUMN fusion_solicitud_id RESTRICT;

DROP TABLE eventos_fusion_cliente RESTRICT;
DROP TABLE solicitudes_fusion_cliente RESTRICT;
DROP TYPE "TipoEventoFusionCliente" RESTRICT;
DROP TYPE "EstadoSolicitudFusionCliente" RESTRICT;

COMMIT;
