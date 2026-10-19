# HU-G13 — decisiones de implementación aprobadas

Estas decisiones cierran aspectos que `spec_modulo_G.md` §9.3 no fija. No se atribuyen a la spec.

## Rutas y acciones

- Pantalla: `/tesoreria/gastos-operativos`.
- `GET /api/tesoreria/gastos-operativos`: `mes=AAAA-MM` (por defecto, mes actual en Argentina), `categoria_gasto_id` opcional, `page=1` y `page_size=20` (máximo 100). Orden: fecha descendente, ID descendente. Devuelve `{mes,items,total,total_registros,page,page_size}`; `total` corresponde al conjunto filtrado completo, no solo a la página.
- `POST /api/tesoreria/gastos-operativos`: `{categoria_gasto_id,fecha:"AAAA-MM-DD",monto:"1250.00",descripcion}`. El actor proviene de la sesión.
- `PATCH /api/tesoreria/gastos-operativos/[id]`: subconjunto no vacío de los cuatro campos anteriores; una descripción vacía es inválida. Si no hay cambios efectivos, devuelve 200 con la fila vigente sin UPDATE ni evento.
- `PATCH /api/tesoreria/gastos-operativos/[id]/baja`: `{deletion_reason}` de al menos cinco caracteres tras recortar espacios.
- Server Actions: `crearGastoOperativoAction`, `editarGastoOperativoAction`, `darDeBajaGastoOperativoAction`.

El DTO de cada gasto tiene `id`, `categoria_gasto_id`, `categoria_nombre` histórico, `fecha`, `monto` como string con dos decimales, `descripcion` e `is_active`. Las respuestas usan `{data,error}`. Errores: 400 `VALIDATION_ERROR`; 404 `GASTO_OPERATIVO_NO_ENCONTRADO` o `CATEGORIA_GASTO_NO_ENCONTRADA`; 409 `CATEGORIA_GASTO_INACTIVA` o `GASTO_OPERATIVO_DADO_DE_BAJA`; 401 `UNAUTHORIZED`; 403 `FORBIDDEN`.

Las escrituras usan transacciones serializables con reintento de conflictos `P2034`. La edición y la baja usan `updateMany` condicionado por `is_active` y `updated_at`; la actividad de una categoría nueva se verifica dentro de la misma transacción. El selector visual puede quedar desactualizado entre carga y guardado; el servicio vuelve a validar. Los eventos se emiten tras COMMIT. El bus y el ledger son asincrónicos y no atómicos con el gasto; un fallo de auditoría se registra en el servidor, sin garantía de reintento automático del bus actual.
