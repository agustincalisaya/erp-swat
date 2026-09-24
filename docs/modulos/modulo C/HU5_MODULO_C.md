# HU-C5 — Prevención de duplicados de clientes

## Alcance

La consulta preventiva del alta advierte sobre un DNI ya registrado, tanto activo como inactivo. Un usuario con `clientes:leer` puede abrir su ficha. El alta no crea otro cliente con el mismo DNI ni reactiva el existente: HU-C1 conserva la búsqueda transaccional, la restricción `@unique` y la recuperación ante una carrera de creación.

Con un DNI nuevo, se comparan nombre, teléfono y email con el padrón. El formulario muestra las coincidencias posibles **antes de confirmar** y permite continuar expresamente. No se bloquea un DNI distinto por una coincidencia aproximada. La consulta no escribe datos y no modifica clientes, consentimientos, ventas ni historiales.

## Permisos y flujo

La acción preventiva requiere `clientes:crear`. La identidad y los enlaces de fichas se entregan únicamente a quien tiene `clientes:leer`. El formulario consulta el DNI al ingresarlo y vuelve a consultar los datos antes de confirmar. Si encuentra candidatos aproximados, solicita una segunda confirmación. La creación final sigue usando la acción y validaciones de HU-C1.

## Compatibilidad de esquema

Las migraciones históricas `20260922123000_hu_c5_nucleo_interno` y `20260922180000_hu_c5_inmutabilidad` se conservan porque fueron aplicadas. `20260924120000_hu_c5_prevencion_sin_fusion` sigue **pendiente de revisión para cualquier base habitual o compartida**; se validó únicamente en una base descartable. Se detiene si encuentra expedientes, eventos, procedencia de direcciones o registros de auditoría de la antigua fusión; usa `RESTRICT` para impedir el retiro ante dependencias externas. Preserva `clientes.fusionado_en_id`, su relación e índice utilizados por HU-C7.

La solicitud, aprobación, bandeja, API y cifrado de fusiones están fuera del alcance de HU-C5.
El permiso histórico `clientes:fusionar` y sus asignaciones preexistentes se conservan en el seed por compatibilidad con `5851a38`. Ninguna ruta, pantalla o servicio de fusión lo consume; no se modifican permisos existentes en la base habitual.
