# T3 — Rol GERENTE y usuario de prueba

**Estimación:** 1 SP. **Tipo:** tarea técnica transversal de identidad y seed. **Consumidores:** HU-G14, G16, G7, G5 y D6. **Fuente:** `sprint_5_swat_indumentarias_erp.md`, T3, y matrices de permisos de `spec_modulo_G.md` §9.1 y `spec_modulo_D.md` §8.

## Objetivo y límite

Crear de forma idempotente el rol `GERENTE` (Gerencia) con UUID fijo terminado en `...2222-...-000000000006` y el usuario de pruebas `gerente.seed` asignado a ese rol. T3 establece la identidad; los permisos específicos y entradas de menú se agregan en las HU propietarias. No se concede acceso por comparar el nombre del rol en rutas o servicios.

## Criterios verificables

| ID | Condición de cierre |
|---|---|
| T3-1 | El seed crea o actualiza el mismo rol `GERENTE` con el UUID fijo acordado y sin duplicados. Una segunda ejecución conserva ID y asignaciones. |
| T3-2 | El seed crea `gerente.seed` con identidad de prueba estable, estado activo y vínculo al rol; no imprime contraseña ni secretos. |
| T3-3 | En la fundación el rol no recibe permisos funcionales por defecto. Cada HU añade por seed el permiso que le corresponde: G14/G7 `tesoreria:leer_reportes`, G14 `tesoreria:leer_desglose_gastos`, G16 `tesoreria:exportar_reportes`, G5 `tesoreria:leer_cuentas_bancarias` y D6 `alertas:leer`. La asignación posterior conserva las ya existentes. |
| T3-4 | No se conceden al Gerente `tesoreria:leer_comprobantes`, `tesoreria:exportar_libro_iva`, `tesoreria:ver_datos_bancarios`, `tesoreria:registrar_saldo_diario`, `tesoreria:gestionar_cuentas_bancarias` ni permisos de mutación de gastos/categorías, salvo cambio explícito de la matriz aprobado y documentado. |
| T3-5 | Cada HU propietaria incorpora su navegación gerencial y comprueba el permiso en el servidor. El menú no es la barrera de autorización; sin permiso, API/acción deniega el acceso. |

## Verificación de integración

1. Ejecutar el seed dos veces y comprobar una sola fila de rol y usuario, con el UUID previsto.
2. Antes de integrar las HU, comprobar que la mera pertenencia al rol no abre reportes, bancos ni alertas.
3. Tras G14/G7/G16/G5/D6, iniciar sesión como `gerente.seed` y verificar lecturas y exportación permitidas, incluido el desglose de gastos en pantalla, gráficos, CSV y PDF. Comprobar que Cajero POS solo recibe el total agregado y verificar cada denegación de T3-4 mediante API y navegación.
4. Verificar que un usuario con los mismos permisos obtenidos por otro rol tiene el mismo acceso; esto detecta autorizaciones basadas indebidamente en `Rol.nombre`.

**Cierre:** rol y usuario estables, sin privilegios implícitos; las pruebas de acceso específicas se cierran en los PR de las HU consumidoras.
