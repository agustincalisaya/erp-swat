-- HU-C10: habilitar la consulta acotada de auditoria de clientes.
-- El seed crea los roles en instalaciones nuevas; por eso pueden no existir aun.
BEGIN;

DO $$
DECLARE
    v_permiso_id CONSTANT text := '1a2b3c4d-1111-4a1a-8a1a-000000000043';
    v_permiso_codigo CONSTANT text := 'clientes:leer_auditoria';
    permiso_actual permisos%ROWTYPE;
    rol_actual roles%ROWTYPE;
    asignacion_actual rol_permisos%ROWTYPE;
    rol_nombre text;
    rol_id_esperado text;
BEGIN
    SELECT * INTO permiso_actual FROM permisos WHERE id = v_permiso_id;
    IF FOUND AND permiso_actual.codigo <> v_permiso_codigo THEN
        RAISE EXCEPTION 'HU-C10: ID de permiso % ocupado por %', v_permiso_id, permiso_actual.codigo;
    END IF;

    SELECT * INTO permiso_actual FROM permisos WHERE codigo = v_permiso_codigo;
    IF FOUND THEN
        IF permiso_actual.id <> v_permiso_id OR permiso_actual.modulo <> 'MODULO_C'
           OR NOT permiso_actual.is_active OR permiso_actual.deleted_at IS NOT NULL THEN
            RAISE EXCEPTION 'HU-C10: permiso % existente incompatible o inactivo (id %, modulo %, activo %)',
                v_permiso_codigo, permiso_actual.id, permiso_actual.modulo, permiso_actual.is_active;
        END IF;
    ELSE
        INSERT INTO permisos (id, codigo, descripcion, modulo, is_active, created_at, updated_at)
        VALUES (v_permiso_id, v_permiso_codigo,
                'Consultar los asientos de altas, cambios y bajas lógicas de clientes',
                'MODULO_C', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
    END IF;

    -- Una asignacion existente al Vendedor es un conflicto, no se modifica aqui.
    IF EXISTS (
        SELECT 1 FROM rol_permisos rp
        JOIN roles r ON r.id = rp.rol_id
        WHERE r.nombre = 'VENDEDOR' AND rp.permiso_id = v_permiso_id
    ) THEN
        RAISE EXCEPTION 'HU-C10: clientes:leer_auditoria ya esta asignado a VENDEDOR';
    END IF;

    FOR rol_nombre, rol_id_esperado IN
        SELECT * FROM (VALUES
            ('AUDITOR', 'cfe51d79-332c-4217-8906-481f2a94a1cc'),
            ('ADMINISTRADOR_CRM', '1a2b3c4d-2222-4a1a-8a1a-000000000005')
        ) AS autorizados(nombre, id)
    LOOP
        SELECT * INTO rol_actual FROM roles WHERE id = rol_id_esperado;
        IF FOUND AND rol_actual.nombre <> rol_nombre THEN
            RAISE EXCEPTION 'HU-C10: ID de rol % ocupado por %', rol_id_esperado, rol_actual.nombre;
        END IF;

        SELECT * INTO rol_actual FROM roles WHERE nombre = rol_nombre;
        IF NOT FOUND THEN
            CONTINUE; -- La instalacion nueva ejecuta seed despues de migrar.
        END IF;
        IF rol_actual.id <> rol_id_esperado OR NOT rol_actual.is_active
           OR rol_actual.deleted_at IS NOT NULL THEN
            RAISE EXCEPTION 'HU-C10: rol % existente incompatible o inactivo (id %, activo %)',
                rol_nombre, rol_actual.id, rol_actual.is_active;
        END IF;

        SELECT * INTO asignacion_actual FROM rol_permisos
        WHERE rol_id = rol_actual.id AND permiso_id = v_permiso_id;
        IF FOUND THEN
            IF NOT asignacion_actual.is_active OR asignacion_actual.deleted_at IS NOT NULL THEN
                RAISE EXCEPTION 'HU-C10: asignacion inactiva de % a %', v_permiso_codigo, rol_nombre;
            END IF;
        ELSE
            INSERT INTO rol_permisos (id, rol_id, permiso_id, is_active, created_at, updated_at)
            VALUES (gen_random_uuid()::text, rol_actual.id, v_permiso_id,
                    true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
        END IF;
    END LOOP;
END $$;

COMMIT;
