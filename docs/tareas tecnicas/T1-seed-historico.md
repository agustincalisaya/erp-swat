# T1 — Seed histórico para el Sprint 5

**Estimación:** sin SP. **Tipo:** tarea técnica transversal. **Dependencias:** HU-G12 y HU-G13 para las categorías y gastos; modelos y servicios existentes de B, E, G y H. **Consumidores:** HU-G3, G4, G14, G15 y G16; D6 reutiliza los históricos solo para verificar el cálculo de G14. **Fuente:** Product Backlog Sprint 5, T1 y criterios de esas HU.

## Objetivo y límite

Preparar en una base de demostración un historial coherente de 3 a 6 meses anteriores a octubre de 2026: fechas absolutas entre abril y julio de 2026, repartidas en varios meses y reproducibles. El seed aporta datos para filtros, reportes, gráficos, Libro de IVA y PDF. También permite comprobar el cálculo histórico de G14 consumido por D6, pero no dispara alertas operativas de un mes ya terminado: D6 debe probar su creación, cambio de nivel y resolución con fixtures propios del mes bajo evaluación y reloj controlado, conforme a `spec_modulo_D.md` §8.2. No implementa reglas de cálculo de las HU ni crea las cuentas propias o los saldos diarios, que corresponden a G5 y G7.

## Datos mínimos verificables

| ID | Condición de cierre |
|---|---|
| T1-1 | Sembrar ventas de mostrador facturadas en al menos dos meses y con más de un medio de pago. Incluir una venta en cuenta corriente identificable, que G14 muestre fuera del total de ingresos. |
| T1-2 | Sembrar cobros web confirmados con su `IngresoTesoreria`, algunos pendientes de conciliación y otros conciliados. Incluir un reintegro web con su contra-asiento en un mes identificable, de modo que G14 reste el reintegro en el mes del contra-asiento. |
| T1-3 | Sembrar cuentas por pagar `PAGADA` con `fecha_pago` en al menos dos meses, de al menos dos proveedores distintos. Cada proveedor/comprobante fiscal de compra usado en G4/G15 debe tener su vínculo válido con la orden de compra y la cuenta por pagar. Incluir al menos un pago asociado a más de un comprobante para verificar que G15 no multiplica el importe y sí cuenta comprobantes distintos. |
| T1-4 | Sembrar gastos operativos activos en varios meses y categorías, más al menos un gasto dado de baja. Este último permanece en el histórico, pero no integra totales de G13/G14. |
| T1-5 | Sembrar comprobantes fiscales de mostrador y web con CAE simulado, QR local válido y relación de Nota de Crédito con original cuando corresponda. La visualización y descarga PDF de G3 deben poder abrirse con estos datos. |
| T1-6 | Mantener numeración continua de las ventas creadas por el seed, sin saltos ni colisiones con los datos que ya existan. No renumerar ventas existentes. |
| T1-7 | Usar identificadores estables y `upsert` o equivalentes idempotentes. Dos ejecuciones consecutivas producen la misma cantidad, importes, relaciones y fechas de registros históricos; no duplican cobros, comprobantes, notas, gastos ni pagos. |
| T1-8 | El seed no escribe `AuditLog` ni emite eventos operativos hacia D.3. El volumen y último hash del log permanecen iguales antes y después de una ejecución de T1. |

## Fixtures sembrados

El bloque `seedHistoricoT1` en `prisma/seed.ts` usa `idHistoricoT1(clave)`: UUID determinístico derivado de SHA-256 de `swat:sprint5:t1:<clave>`. Las ventas reciben el siguiente número libre después del mayor `V-2026-NNNNNN` existente; en reejecuciones conservan su número. Los IDs siguientes permiten consultar los casos sin depender de esa numeración.

| Mes | Caso | ID principal | Importe |
|---|---|---|---:|
| Mayo | Mostrador, efectivo + tarjeta | `3ba1f7f1-452e-4223-80fa-ce7c1fe223fd` | $45.000 |
| Junio | Mostrador, cuenta corriente | `bf02699f-06f6-4661-8897-0e25c7e2019d` | $60.000 |
| Junio | Web conciliado; ingreso `593efd31-8c1f-4472-85a6-ac40da038acf` | `4de0433b-c216-40b7-8e2e-8e3d0a607943` | $36.000 |
| Julio | Mostrador, transferencia | `8fd0115e-e99a-4361-89b7-33396a86ed89` | $52.000 |
| Julio | Web pendiente de conciliación; ingreso `692827a2-b507-4efa-8914-e3be8a475882` | `7f0d8540-c965-414e-83e4-83cd25a8e583` | $28.000 |
| Julio | Reintegro de esa venta; NC `94a1550c-4251-42ad-8760-1d0c6197b768` y contra-asiento `9d25aa54-c9d5-412d-8d56-b1783e188c6a` | `dfaf5dd8-c581-406f-889b-f14214b4704f` | $28.000 |
| Mayo | OC `8999e89c-0810-4f95-8955-815c8031ee01`, dos facturas del mismo proveedor | CxP `75b65b2d-4729-45f8-8cec-cfb3e4d052ff` | $50.000 pagados |
| Julio | OC `e817c97e-1cd9-40c2-8e85-81a3c65bd0b5`, segundo proveedor | CxP `cdd74459-d69a-4e87-84d0-c32bc8a1c950` | $40.000 pagados |
| Mayo, junio, julio | Alquiler, Servicios, Sueldos activos | `3e3e239d-dc3d-43b2-8aeb-a86513961745`, `52fb9fb4-7444-4223-86cf-a042118c0b71`, `f4bf21a3-d7a6-4efd-8ab0-40e6cb693732` | $18.000, $7.500, $32.000 |
| Julio | Otros, dado de baja | `0692903f-3405-49c4-8fb7-746cec6ccd6b` | $1.500 excluidos |

Las facturas de compra usan números fiscales válidos para G4 (`0001-00001001`, `0001-00001002` y `0001-00002001`). Los comprobantes nuevos generan un QR PNG local con el payload de HU-B7; el Cluster 4 continúa corrigiendo los QR inválidos de los fixtures anteriores.

## Integridad y seguridad

- Fechas absolutas dentro del intervalo histórico acordado; evitar `hoy - N días` para que la demostración no cambie con el tiempo.
- Importes y medios de pago coherentes entre venta, comprobante, cobro y contra-asiento. No crear ingresos web duplicados desde ventas de mostrador.
- Respetar claves foráneas, bajas lógicas y la regla de no borrar físicamente. Usar solo datos ficticios; no incorporar credenciales ni datos personales reales.
- Registrar en la documentación del seed los identificadores de los fixtures y el mes de cada caso. No registrar secretos en la salida de ejecución.

## Verificación y evidencia

1. Ejecutar el seed dos veces sobre una base aislada. Comparar conteos y sumas de cada entidad de T1 y constatar que no crecieron en la segunda ejecución.
2. Consultar dos meses con G14: comprobar ingresos de mostrador y web, reintegro, cuenta corriente informativa, pagos, gastos activos y exclusión del gasto dado de baja. Un mes sin movimientos debe conservar ceros.
3. Abrir y descargar en G3 un comprobante de cada canal y una Nota de Crédito; verificar QR legible y vínculo bidireccional. Exportar G4 y comprobar que los documentos sembrados aparecen una sola vez.
4. Consultar G15 con dos proveedores y el pago de varios comprobantes: total de pagos sin multiplicación y conteo de comprobantes distintos. Comprobar que G16 muestra meses con y sin actividad.
5. Comparar cantidad y hash final de `AuditLog` antes/después. Guardar en la evidencia del PR las consultas y resultados, sin datos sensibles.

**Cierre:** T1 termina cuando los fixtures existen, son repetibles y G3/G4/G14/G15/G16 pueden verificar sus casos históricos. La prueba de alertas operativas pertenece a D6; no se declara cubierta por T1. Los fallos de cálculo de una HU se corrigen en esa HU, sin alterar el seed para ocultarlos.

## Verificación inicial, anterior a la ampliación (22/10/2026)

Se creó un esquema PostgreSQL aislado con el esquema Prisma, se ejecutó el seed base con `--without-t1` y después T1 dos veces con `--t1-only`. Antes y después de cada ejecución de T1 se compararon cantidad y último hash de `AuditLog`: no cambiaron. La segunda ejecución conservó los 5 pedidos y su numeración consecutiva, 6 comprobantes fiscales, 2 ingresos web, 1 reintegro y contra-asiento, 2 cuentas por pagar con 3 imputaciones a comprobantes, 4 gastos y sus importes, fechas y relaciones.

Se consultaron los servicios reales de G14 para mayo, junio y julio, con cuenta corriente informativa y reintegro; abril mostró ceros. G4 devolvió sin incidencias los comprobantes de venta y compra de esos meses. G15 mostró un solo pago de $50.000 en mayo pese a las dos facturas imputadas, y uno de $40.000 en julio. El generador de G3 produjo PDF para una factura de mostrador, una web y la Nota de Crédito, con sus QR PNG aceptados. Estas comprobaciones fueron de servicio sobre la base aislada; no sustituyen una revisión visual de las pantallas ni la exportación manual de G16.


## Ampliación de abril a julio (22/10/2026)

Se conservan los cinco pedidos, el reintegro, las dos compras y los cuatro gastos originales. Se agregan 43 pedidos, 10 compras y 44 gastos. El [inventario completo de identificadores](T1-inventario.csv) registra mes, entidad, clave y UUID, incluidos ítems, medios de pago, comprobantes e imputaciones.

| Mes | Mostrador facturado | Web cobrado | CxP pagadas | Gastos activos | Gastos de baja |
|---|---:|---:|---:|---:|---:|
| Abril | 8 | 4 | 3 | 10 | 1 |
| Mayo | 8 | 4 | 3 | 11 | 1 |
| Junio | 8 (1 en cuenta corriente) | 4 | 3 | 11 | 1 |
| Julio | 8 | 4 | 3 | 11 | 2 |

El total ampliado de T1 es 48 ventas, 49 comprobantes fiscales (incluida NC), 16 ingresos web, 12 pagos con 13 comprobantes de proveedor y 48 gastos (43 activos y 5 de baja). Los gastos cubren Sueldos, Alquiler, Servicios, Impuestos y Otros. Junio incluye mantenimiento y costos operativos extraordinarios: el incremento de egresos explica el resultado negativo. Julio conserva el reintegro de $28.000 y pagos a dos proveedores. La venta original de junio por $60.000 continúa en cuenta corriente, con su operación aprobada y medio de pago informativo, excluida de ingresos cobrados.

Las claves nuevas son `venta:<mostrador|web>-<mes>-extra-<i>`, `orden:<mes>-extra-<i>`, `cuenta:<mes>-extra-<i>` y `gasto:<mes>-extra-<i>`; las bajas usan `gasto:<mes>-anulado`. El mes es 4–7. Cada venta mantiene sus claves derivadas `item:`, `medio:<clave>:<índice>` y `comprobante:`; cada web tiene `ingreso:` y `ecommerce:`. No se renumeran ventas existentes: se agregan desde el máximo real bajo la cerradura de T1. Los únicos textos antiguos actualizados son descripciones de gastos con UUID determinístico exacto de T1; no se buscan filas por coincidencia de texto.

### Conciliación esperada y observada (pesos)

Los importes surgen del servicio real G14. Ingresos netos = mostrador + web − reintegros; resultado = ingresos netos − pagos − gastos activos.

| Mes | Mostrador cobrado | Web bruto | Reintegros | Ingresos netos | Proveedores | Gastos activos | Resultado | CC informativa |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 4 | 326109.00 | 144452.50 | 0.00 | 470561.50 | 147723.00 | 141357.50 | 181481.00 | 0.00 |
| 5 | 334107.00 | 151252.50 | 0.00 | 485359.50 | 150561.50 | 160570.00 | 174228.00 | 0.00 |
| 6 | 301007.00 | 151051.50 | 0.00 | 452058.50 | 167523.00 | 550882.50 | -266347.00 | 60000.00 |
| 7 | 364907.00 | 148151.50 | 28000.00 | 485058.50 | 153761.50 | 176995.00 | 154302.00 | 0.00 |

### Evidencia de la ampliación

`node --conditions=react-server --import tsx scripts/verificar-t1.ts` crea un esquema aislado nuevo en el PostgreSQL local `swat_erp_db`, aplica el esquema Prisma, siembra referencias con `--without-t1` y ejecuta T1 dos veces. El verificador restringe el destino a localhost/127.0.0.1 y esa base. Los esquemas aislados quedan conservados; no ejecuta borrados. `--local` aplica solamente T1 dos veces en `public`, sin reiniciar la app ni volver a ejecutar G5/G7.

Se compararon cantidad y SHA-256 del estado funcional completo de 16 entidades, incluyendo números, fechas, importes y relaciones. Se incluye `updated_at`: la migración de descripciones actualiza solo textos distintos, sin reescribir filas idénticas. Las dos ejecuciones conservaron el estado. Se comprobó la suma exacta en centavos de medios de pago por venta, comprobantes fiscales presentes, numeración sin colisiones y consecutiva en el esquema aislado, vínculos de cada CxP con facturas de la misma OC y relación reintegro → NC → original / contra-asiento → ingreso. G15 coincide con los pagos de G14 y conserva la imputación múltiple de mayo sin multiplicar $50.000. G4 consultó ventas y compras de los cuatro meses sin incidencias. El generador real G3 produjo PDF de mostrador, web y NC, aceptando los QR PNG persistidos.

- Esquema aislado `t1_demo_1792652170785`: AuditLog mantuvo 1 filas, hash final `c24eab9f3459fe0b0cc71171f5d844b1aecba9e96c9c368a347ef71f5b2384d2` y SHA-256 completo `346b075e4cb333acb4ff7f093033e6b421d8a124ae0679943466ca2346ee0c16` antes y después de T1.
- Base local public: AuditLog mantuvo 14 filas, hash final `d39f1a6d8ffb57889cd8ded1d80ed83dbef5961b4007497c5c740ecbfab6a43b` y SHA-256 completo `683fac1f9d5b8529e4461528b3d768ff9b5b8e04dce80bc0043d4dbd49d54ef2` antes y después de las dos ejecuciones finales de T1.

La base local se identificó por `DATABASE_URL` (localhost:5432/swat_erp_db, esquema public), configuración de Docker Compose y proceso Next.js en modo development con directorio de trabajo de este proyecto, que carga su `.env`. `localhost:3000` respondió HTTP 307 a `/login`. Los totales locales coinciden con la tabla. El servicio real de listado devuelve 11 gastos activos de julio por $176.995,00; la serie del gráfico contiene febrero–julio con actividad en abril–julio y ceros en febrero/marzo.

Evidencia temporal: `/tmp/public-evidencia/resultado.json` y los tres PDF de la misma carpeta; cada ejecución aislada escribe `/tmp/<esquema>-evidencia/`. `npm run typecheck` pasó. ESLint sobre los dos archivos TypeScript de la tarea no tuvo errores; quedaron dos advertencias previas de constantes RBAC no utilizadas en seed.ts.

Limitación: no hay navegadores ni aplicaciones disponibles en el inventario de Computer Use. Se validaron los servicios que alimentan el listado y el gráfico y la disponibilidad HTTP, pero no se pudo inspeccionar visualmente las pantallas ni realizar una descarga manual desde ellas.
