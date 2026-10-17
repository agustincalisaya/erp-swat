BEGIN;

-- Una solicitud pendiente se resuelve explícitamente; ocultarla dejaría
-- participantes reservados sin expediente operable.
ALTER TABLE solicitudes_fusion_cliente ADD CONSTRAINT c5_expediente_activo
  CHECK (is_active = true AND deleted_at IS NULL AND deleted_by IS NULL AND deletion_reason IS NULL);

CREATE FUNCTION c5_proteger_redireccion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.fusionado_en_id IS NOT NULL AND
    ROW(NEW.fusionado_en_id, NEW.is_active, NEW.deleted_at, NEW.deleted_by, NEW.deletion_reason)
      IS DISTINCT FROM
    ROW(OLD.fusionado_en_id, OLD.is_active, OLD.deleted_at, OLD.deleted_by, OLD.deletion_reason) THEN
    RAISE EXCEPTION 'C5: redireccion y baja por fusion inmutables' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER c5_redireccion_inmutable BEFORE UPDATE ON clientes
  FOR EACH ROW EXECUTE FUNCTION c5_proteger_redireccion();

CREATE FUNCTION c5_proteger_direccion_historica() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM clientes WHERE id = OLD.cliente_id AND fusionado_en_id IS NOT NULL)
    AND (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
    RAISE EXCEPTION 'C5: direccion historica del secundario inmutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER c5_direccion_historica BEFORE UPDATE ON direcciones_cliente
  FOR EACH ROW EXECUTE FUNCTION c5_proteger_direccion_historica();

COMMIT;
