# HU-E4 — Cupones de descuento (Módulo E)

Contrato: `docs/specs/spec_modulo_E.md` §2.4.a–§2.4.e y §3.8 (Revisión 3). Fuente funcional: Documento de Alcance Funcional y Técnico, Módulo E §3.4. Este cierre consolida las decisiones y la evidencia verificadas contra código. Los artefactos SDD, informes y capturas son locales, ignorados por Git; el contrato y los resultados relevantes se incorporan aquí.

**Módulo:** E — Canal de Venta Online · **Responsable:** Tomás · **Sprint / estimación:** Sprint 4 · 3 SP.
**Estado al 03/10/2026:** implementada, re-verify técnico aprobado y B01 cerrado por revisor independiente. **Apto para commit en alcance HU-E4.** Commits, PR e integración pendientes de ejecución manual; este documento no acredita actualidad del remoto.

## 1. Historia de usuario y qué hace

**Como** Administrador E-commerce, **necesito** gestionar cupones con código, porcentaje o monto fijo, vigencia y límites globales y por cliente, **para** ejecutar campañas sin aplicar beneficios fuera de sus condiciones.

| Capacidad | Superficie | Resultado |
|---|---|---|
| Alta, búsqueda, edición y baja | `/ecommerce/cupones`, API interna | Código único e inmutable; baja lógica; restricciones de edición según historial |
| Admisión en checkout | `aplicarCuponTx` desde E2 | Precio congelado; un cupón; capacidad de confirmados más pendientes vigentes; descuento menor al subtotal |
| Consumo / liberación | Pago E2 y mantenimiento | Consumo al confirmar; liberación por rechazo o TTL; sin cambiar locks de pago |
| Baja automática | Mantenimiento E4 | Maestro vencido o agotado por confirmados, con historial conservado |
| Lectura de descuentos | Pendiente y resultado de E2 | Subtotal, código, descuento y neto persistidos; vista anterior cuando no hay cupón |
| Trazabilidad | Seis eventos, listeners de auditoría existentes | Emisión posterior al COMMIT y cadena SHA-256 conservada |

## 2. Criterios de aceptación (9) — estado y evidencia

Evidencia técnica: re-verify independiente del 03/10/2026 (`verify.md` local §12), suites E4 servicio/HTTP, unitarios y regresiones E1/E2/E8. Evidencia interactiva adicional: Chrome independiente, §10 de este cierre. No se atribuye a Chrome la ejecución de la matriz técnica.

| CA | Criterio | Estado y evidencia |
|---|---|---|
| CA01 | Código, tipo, valor, ventana y límites | Aprobado: schemas estrictos, unicidad incluyendo bajas; alta y edición observadas en Chrome |
| CA02 | Validación server-side de estado, vigencia y capacidad, con motivo | Aprobado: servicio/HTTP y dos regresiones deterministas F01 |
| CA03 | Un único cupón por pedido, sin acumulación | Aprobado: input único de checkout, relación única y suite E4 |
| CA04 | Precios HU-B9 congelados y total no negativo | Aprobado: K5 rechaza descuento bruto ≥ subtotal; Chrome verifica 10000−1000=9000 y 10000−2500=7500 |
| CA05 | Consumo al pagar; rechazo/vencimiento no consume | Aprobado: E2/E4, TTL de pendientes y webhooks simulados reales en Chrome |
| CA06 | Límite del cliente vinculado a cuenta web | Aprobado: conteo por `cliente_id`; regresión F01 por cliente; identidad de tienda aislada |
| CA07 | Baja de vencidos/agotados conservando historial | Aprobado: mantenimiento, idempotencia y nueva confirmada con TTL vencido preservada; motivos observados en Chrome |
| CA08 | Campos completos de baja lógica | Aprobado: servicio/HTTP verifican `is_active`, `deleted_at`, `deleted_by`, `deletion_reason` |
| CA09 | Registro de aplicación para Módulo D | Aprobado: aplicación/payloads de seis eventos y verificación de integridad del ledger |

## 3. Decisiones de producto y técnicas

### 3.1. K1–K8 (auditoría aprobada por Tomás el 02/10/2026)

| Decisión | Contrato vigente |
|---|---|
| K1 | Capacidad = C + P. C: todas las confirmadas, incluso históricas dadas de baja. P: no confirmada, activa, sin baja, `reserva_hasta > ahora`. Mismo criterio global y por cliente |
| K2 | Admisión adquiere lock del cupón después del stock. Pago/rechazo conservan sus locks y flujo; no adquieren ese lock ni revalidan la reserva de capacidad |
| K3 | Mantenimiento E4 comparte los entrypoints de A; A primero, tareas independientes. No existe job TTL separado de E2 |
| K4 | Código inmutable. Sin aplicaciones, edición de beneficio/ventana/límites; con cualquier historial, solo ampliar límites. No reactivar bajas |
| K5 | Porcentaje < 100; descuento bruto ≥ subtotal se rechaza antes del recorte defensivo. No se admiten pedidos gratis |
| K6 | Edición y baja con lock y relectura; sin token CAS. No-op no genera evento |
| K7 | Seis eventos de cupón, posteriores al COMMIT, con handlers explícitos y auditoría existente |
| K8 | Sin pantalla ni endpoint de historial de aplicaciones. Datos persistidos y auditoría disponibles para D |

### 3.2. Gate 3 y resoluciones de Fase 0

`new Date()` se toma **después** del lock (A2), sustituyendo la referencia anterior a reloj de BD. Pago se modifica solo para trasladar/emitar los datos de cupón después del COMMIT (A3). Seed no reactiva cupones dados de baja (A4). Se conserva el motivo de rechazo E2: **"Pago rechazado por Mercado Pago"** (A5). Sidebar ubica **Cupones en Clientes**, junto a Cuentas web, sujeto a permiso (A7). `respuesta-tienda.ts` incorpora `CUPON_NO_VIGENTE` y `CUPON_NO_APLICABLE` (S3). S10 valida el descuento bruto antes del recorte.

Alcance E §3.4 respalda beneficio, ventanas, límites, baja histórica, precio congelado y consumo al pagar. K5 precisa la condición del total. No se introdujo una decisión funcional nueva. La tensión técnica previa sobre vistas/índices transversales se mantiene documentada: la migración E4 aprobada no agrega CHECKs ni índices parciales manuales.

## 4. Modelo de datos, migración y seed

Migración aditiva: `20261003120000_hu_e4_cupones_descuento`. Sin modelos nuevos ni cambios de A/C.

| Entidad | Cambio |
|---|---|
| `CuponDescuento` / `cupones_descuento` | `updated_at`, `TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`, `@updatedAt` en Prisma |
| `CuponAplicacion` / `aplicaciones_cupon` | `updated_at` y `reserva_hasta`, `TIMESTAMP(3)` nullable |
| Filas anteriores | `updated_at = created_at`; pendientes activas sin baja reciben el menor vencimiento de reservas de los items activos del pedido; confirmadas e históricas quedan con TTL nulo |

No CHECKs ni índices parciales manuales; las invariantes se garantizan en servicio. `tipo_beneficio` persiste como String y se valida como `PORCENTAJE | MONTO_FIJO`. `valor` y descuento siguen siendo Decimal; la API administrativa recibe y devuelve texto decimal.

Seed conserva `SWAT10`, `INVIERNO5000` y `LANZAMIENTO15`; sus `upsert.update` no tocan campos de baja. Actualiza el TTL de la aplicación pendiente del fixture según la reserva del pedido, sin reactivar. Mantenimiento puede dar de baja fixtures vencidos o agotados: para demo se crean cupones nuevos.

El re-verify ejecutó `prisma migrate diff` contra shadow descartable: **No difference detected**, exit 0. La migración ya estaba aplicada en test; este cierre no aplicó migraciones ni reseteó bases. Antes de integrar: generar cliente Prisma, aplicar migraciones por el procedimiento del entorno y ejecutar seed cuando corresponda.

**Entorno de pagos simulado:** seed y servidor de test deben compartir `ENCRYPTION_KEY_PROVEEDORES`; además se usan los secretos de sesiones/carrito, `MP_MODO=simulado` y `APP_PUBLIC_URL` del servidor propio. Si se pierde una clave efímera, generar otra en proceso y resembrar **únicamente la base aislada de test** con el seed existente. No publicar claves ni sustituir por desarrollo/producción. La clave usada en B01 terminó con el proceso; el próximo ensayo debe volver a preparar ese conector de test.

## 5. Contrato de endpoints y permiso

Solo sesión interna con `withPermission("ecommerce:gestionar_cupones")`, constante `PERMISO_GESTIONAR_CUPONES` en `src/lib/auth/permisos-ecommerce.ts`. Asignado únicamente al Administrador E-commerce. Actor tomado de la sesión, nunca del body. La implementación usa Route Handlers; no creó Server Actions para estos formularios.

| Método | Ruta | Éxito |
|---|---|---|
| GET | `/api/ecommerce/cupones?estado=ACTIVOS\|INACTIVOS\|TODOS&q=` | 200 `{ data: { items }, error: null }`, default ACTIVOS, código normalizado, orden `created_at` descendente |
| POST | `/api/ecommerce/cupones` | 201 `{ data: { cupon }, error: null }` |
| GET | `/api/ecommerce/cupones/[id]` | 200 `{ data: { cupon }, error: null }`, incluye bajas |
| PATCH | `/api/ecommerce/cupones/[id]` | 200 `{ data: { cupon }, error: null }` |
| PATCH | `/api/ecommerce/cupones/[id]/baja` | 200 `{ data: { cupon }, error: null }`, repetición idempotente |

Errores: 400 `VALIDATION_ERROR`; 401/403 por sesión/permiso; 404 `CUPON_NO_ENCONTRADO`; 409 `CUPON_CODIGO_EXISTENTE`, `CUPON_INACTIVO`, `CUPON_EDICION_RESTRINGIDA`; 500 `INTERNAL_ERROR` para inesperados. Checkout conserva su ruta, input y respuesta E2; rechaza con 422 y códigos `CUPON_NO_ENCONTRADO`, `CUPON_INACTIVO`, `CUPON_NO_VIGENTE`, `CUPON_VENCIDO`, `CUPON_LIMITE_ALCANZADO`, `CUPON_NO_APLICABLE`.

DTO: `id`, `codigo`, `tipo_beneficio`, `valor` (texto decimal a dos decimales), `vigente_desde`, `vigente_hasta`, `limite_uso_global`, `limite_uso_por_cliente`, `is_active`, `deleted_at`, `deletion_reason`, `estado`, `usos_confirmados`, `reservas_vigentes`, `capacidad_disponible`, `tiene_aplicaciones`, `created_at`, `updated_at`. Fechas ISO; global/disponible nulos significan ilimitado. Disponible finito = `max(0, límite−C−P)`.

Schemas estrictos en `cupon.schema.ts`: código trim/mayúsculas, 3–50 caracteres `[A-Z0-9_-]`; valor positivo como string con hasta dos decimales; fechas ISO con zona y fin posterior al inicio; límites enteros positivos (global nullable, default null; cliente default 1). Edición no acepta código y exige un campo; valida campos cruzados contra el persistido. Baja exige motivo trim de 3–500 caracteres. `respuesta-cupones.ts` concentra envelope/errores/lectura JSON.

## 6. Reglas de servicio y mantenimiento

`leerOcupacion` hace **un `$queryRaw` con cuatro `COUNT(*) FILTER`** para C/P global y por cliente, más total histórico. Lo usan admisión, `construirDtos` y la decisión de baja automática dentro del lock. La preselección de agotados por `groupBy` no decide la baja definitiva.

`reserva_hasta` es timestamp **sin zona**. El SELECT compara contra `ahora.toISOString()::timestamptz AT TIME ZONE 'UTC'`, produciendo el UTC sin zona compatible con el almacenamiento. No depende de `TimeZone` de la conexión. El diagnóstico del re-verify probó TTL a −1/+1 minuto en UTC, Buenos Aires y Tokio.

Orden: reservar stock, lock de cupón, reloj, ocupación/validaciones y creación de aplicación pendiente con TTL mínimo del pedido. Decimal con redondeo half-up a dos decimales; descuento aplicado sobre subtotal congelado. Pago convierte P en C; conserva la salvaguarda histórica `CUPON_LIMITE_EXCEDIDO` sin convertirla en un nuevo rechazo de pago. Rechazo da de baja la pendiente con el motivo anterior.

Estado derivado, por prioridad: `DADO_DE_BAJA`, `NO_INICIADO`, `VENCIDO`, `AGOTADO`, `VIGENTE`. La vigencia incluye ambos extremos. Agotamiento del maestro usa **C global**, no C+P; reservas temporalmente llenas rechazan admisión sin desactivar el maestro.

`ejecutarMantenimientoCupones()` libera solo pendientes activas sin baja con TTL vencido, mediante selección y update condicional que comparten `confirmada: false`; motivo `TTL_CHECKOUT_VENCIDO`. Reevalúa cada maestro bajo lock; baja por `VENCIMIENTO` o `LIMITE_GLOBAL_AGOTADO`, prevaleciendo vencimiento. Actor automático: Canal Web. Sin DELETE ni reparación de historia.

Entry points existentes: **POST `/api/cron/check-pruebas-vencidas`** y `npm run job:reservas` / `job:reservas:watch`. `ejecutarMantenimientoProgramado` ejecuta A y luego E4 con capturas de error independientes. El status HTTP conserva la decisión de A; un fallo de cupones se informa en `mantenimiento_cupones`, no impide A. Cron utiliza `CRON_SECRET` por Bearer cuando está configurado; en producción faltante es error. No existe endpoint cron nuevo ni job TTL E2 separado.

## 7. Integración e aislamiento

E2 cambia solo la admisión/TTL de cupón, datos de eventos y lecturas de desglose. `checkout.service.ts`, `cupon.service.ts`, `pago-web.service.ts`, `respuesta-tienda.ts`, Q3 de `hu-e2.integration.test.ts` y las páginas pendiente/resultado forman el impacto informado al dueño E2. Q3 ahora espera rechazo de la segunda admisión mientras la primera reserva ocupa el límite; la descripción histórica de dos admisiones en HU2 queda superada por Rev.3, sin editar HU2.

No cambió lógica/locks de pago ni rechazo, inventario A, clientes C, algoritmo de auditoría o fusión de carritos. Lectores `obtenerPedidoWebPendiente` y `obtenerResultadoPago` conservan la propiedad de cuenta/cliente y leen el descuento persistido, sin consultar precios actuales para recalcularlo. Sidebar y página aplican el permiso servidor; la sesión web no habilita API administrativa.

## 8. Correcciones del Verify y regresiones

| Hallazgo previo | Corrección y evidencia del re-verify |
|---|---|
| F01: pago entre dos lecturas permitía sobreconsumo | Statement único de `leerOcupacion`. Diagnóstico PostgreSQL global/cliente: segunda admisión rechazada y C+P=1. Ambos tests vigentes fallarían al volver a C/P separados; se demostró con helper mutado **solo en memoria**, mismo proxy y pago real de servicio, sin editar archivos |
| F02: objetos raíz inválidos devolvían texto Zod en inglés | `null`, array y no-JSON en POST/PATCH/baja: nueve respuestas 400, mismo envelope, `formErrors: ["El cuerpo debe ser un objeto JSON"]` |
| CA07: faltaba confirmada con TTL vencido | Caso nuevo conserva confirmada activa y campos de baja nulos. Quitar `confirmada: false` del filtro compartido haría fallar sus assertions; sensibilidad por lectura, sin repetir la mutación destructiva |

Referencias verificadas: `cupon.service.ts:170` helper, `:179` SELECT, `:249` admisión, `:455` baja, `:523` DTO. No se presenta el rojo informado por Apply como evidencia propia; el control negativo fue un diagnóstico real con servicio cargado en memoria.

## 9. Auditoría y eventos

Payload base: `{ cupon_id, actor_tipo: "usuario" | "cuenta" | "sistema", actor_id, ocurrido_en }`. Fecha ISO; montos string decimal. `src/lib/events/event-types.ts` y seis handlers explícitos en `audit-log.listener.ts`.

| Evento | Campos adicionales |
|---|---|
| `ecommerce:cupon_creado` | `codigo`, `tipo_beneficio`, `valor`, `vigente_desde`, `vigente_hasta`, `limite_uso_global`, `limite_uso_por_cliente` |
| `ecommerce:cupon_editado` | `antes`, `despues`, solo campos cambiados |
| `ecommerce:cupon_baja` | `motivo` |
| `ecommerce:cupon_aplicado` | `aplicacion_id`, `pedido_venta_id`, `cliente_id`, `monto_descontado`, `reserva_hasta` |
| `ecommerce:cupon_consumido` | `aplicacion_id`, `pedido_venta_id` |
| `ecommerce:cupon_aplicacion_liberada` | `aplicacion_id`, `pedido_venta_id`, `motivo` |

Alta/edición/baja manual: usuario interno; aplicado: cuenta web; consumo/liberación/baja automática: sistema Canal Web. Aplicado/consumido usan la aplicación como `registro_id`; `cupon_id` sigue en payload. No es defecto ni obliga a cambiar auditoría. Sin DNI/contacto/secretos en los payloads E4.

`verificarCadenaIntegridad()` recorrió todo el ledger: re-verify final 4.444 registros íntegros; B01 final **4.590 íntegros**. Siguen exactamente **53 aplicaciones confirmadas de fixtures anteriores**, inactivas con `TTL_CHECKOUT_VENCIDO`, por la mutación conocida del implementador. No constituyen defecto actual y no se repararon ni borraron.

## 10. Demostración independiente en Chrome (B01)

03/10/2026: Chrome **154.0.8037.93** local real, CDP 1.3, headless, página hidratada, perfil temporal propio y contextos off-the-record independientes para Admin/Auditor/anónimo y tres clientes sintéticos. `next dev` propio en localhost:3103, comprobado sobre `swat_erp_test_e4_f0`; seed/fixtures existentes y webhooks firmados del simulador. Sin dinero real ni UPDATE fabricado de pago. Se observaron las capturas reales, además de DOM/red/consola; no se agregó una suite DOM.

Escritorio: `innerWidth/innerHeight = 1440×1000`; viewport móvil estrecho: **390×844**, DPR 1, sin emulación táctil en las capturas finales. Un intento inicial con emulación mobile produjo 398×862 por autoescala y no se usó como evidencia de clicks exitosos. Inputs/submit se operaron mediante mouse/teclado CDP; fechas mediante valor nativo del input y eventos input/change. Sin invocar directamente handlers React ni simular respuestas de aplicación.

| Caso | Observado y evidencia local |
|---|---|
| C1 | Maestro vencido y agotado dados de baja por mantenimiento real muestran **Vencimiento** y **Límite de uso agotado**. Baja manual conserva **Cierre de campaña B01**. Capturas 14, 17, 18 y 20 |
| C2 | Desde Inactivos + búsqueda sin coincidencia, alta por click limpia búsqueda, pasa a Todos, muestra **Cupón creado** y nueva fila. Edición por Enter muestra **Cupón actualizado**; controles deshabilitados durante request, segundo click bloqueado. No-op cierra sin éxito; duplicado 409 y porcentaje 100/400 visibles. Alta/edición móvil real adicional; capturas 02–06, 15–16 |
| C3 | Pendiente y confirmado muestran 10000/1000/9000 para porcentaje, 10000/2500/7500 para fijo móvil; sin cupón conserva vista anterior por 10000 sin bloque adicional. Tres webhooks simulados reales retornan 200 CONFIRMADO. Capturas 07–12 |
| C4 | Motivo vacío bloquea el submit, sin request ni mensaje de API en la UI. Petición HTTP complementaria desde contexto Admin devuelve 400 con **El motivo es obligatorio**. No se afirma que el click bloqueado mostró ese texto. Contraste con schema/HTTP previos; errores realmente enviados por formulario permanecen visibles (05–06). Captura 13 |
| C5 | Read-only muestra fecha **5:37 p. m. Motivo:**, sin doble punto, también en móvil. Capturas 14, 17, 18, 20 |

Límite visual C1: `TTL_CHECKOUT_VENCIDO → Reserva vencida` corresponde a **aplicaciones**, sin pantalla contractual que lo exponga (K8). Se conserva cobertura unitaria previa; no se fabricó un motivo en un maestro ni un historial UI. B01 queda cerrado con ese límite explícito.

Admin navega y opera autorizado. Auditor: Sidebar sin Cupones, URL directa a `/no-autorizado`, cinco operaciones API 403. Anónimo: página a login, cinco operaciones API 401. Guards rechazan antes de mutar; fixtures finales corresponden únicamente a operaciones autorizadas. Red registra solo 409/400/403/401 esperados; sin 5xx ni excepciones/warnings de aplicación registrados.

Fixtures conservados, prefijo técnico `B01274B64`: PCT dado de baja por agotamiento (C=1/P=0), FIJO por motivo manual (C=1/P=0), VENC por vencimiento (0/0), MOB vigente e ilimitado/2 (0/0). Pedidos sintéticos V-2026-000707/708/709 confirmados por simulador. Mantenimiento además procesó pendientes/maestros anteriores elegibles, sin tocar las 53 confirmadas históricas. No se limpió historia.

## 11. Verificaciones técnicas y procedencia

**Resultados del re-verify independiente §12, no repetidos en este cierre sin cambios de producto:**

| Suite / check | Resultado |
|---|---|
| `npm test` | 565 pass |
| E4 servicio / HTTP | 27 / 10 pass |
| E1 servicio / HTTP | 21 / 15 pass |
| E2 servicio | 11 pass; no existe script HTTP E2 |
| E8 servicio / HTTP | 14 / 13 pass |
| Total | **676 pass, 0 fail, 0 skip**, exit 0 |
| TypeScript / ESLint | Sin errores; cuatro warnings conocidos (seed 138/139, ConsolaDepositoProductos 34, ventas.schema 265) |
| Prisma migrate diff | No difference detected, exit 0 |
| `next build` | Next 16.3.4/Turbopack, TypeScript y 72 páginas generadas, exit 0 |

B01 ejecutó interacción, webhooks, lectura de permisos, ledger y preservación. **31/31 SHA-256 coinciden** con el baseline técnico; no apareció nueva incertidumbre que requiera repetir 676 tests. Branch `feature/hu-e4-cupones-descuento`, HEAD/ref local develop `2d8fcfb3f18584c81487e6a26b370a41d55b0a18`, staging vacío. E8 ya forma parte del baseline local.

## 12. Límites y deuda aceptada

No quedan defectos relevantes o gates de evidencia abiertos para HU-E4. Se conserva deuda aprobada: título Create Next App, tabla con scroll horizontal (también en viewport estrecho), locale del input de fechas, accesibilidad/copy de cupón, aviso fijo de compras en curso, página sin detalle de permiso y estado genérico de baja. E2 conserva doble punto en aviso de pendiente y total repetido entre párrafo/desglose. No fueron corregidos por el revisor.

Fuera de alcance: campañas ampliadas, acumulación, validación pública previa a checkout, historial UI/endpoint de aplicaciones, reactivación, devolución de usos por reembolso, neto cero, cambios de proveedor o algoritmo de stock. No se ejecutó stress extremo ni cron HTTP con fallos de A; el aislamiento del helper tiene cobertura técnica. El cierre no acredita deploy, PR publicado ni integración remota.

## 13. Archivos e integración manual

Primer commit: **31 archivos producto/test aprobados**: package.json; schema/seed; migración E4; script de reservas; página y tres Route Handlers de cupones; CuponesCliente/DesgloseCupon/Sidebar; permiso; tipos/listener de eventos; helper y unitario de motivos; schema y unitario de cupones; checkout/cupón/pago/respuesta-tienda; suites E4 servicio/HTTP y Q3 E2; mantenimiento-programado/respuesta-cupones; páginas pendiente/resultado; ruta cron existente.

Segundo commit: **este cierre y `docs/specs/spec_modulo_E.md` Rev.3**, ambos versionables. Inventario explícito de las 31 rutas y mensajes sugeridos disponible en el plan local de commits. Excluir SDD, verify, capturas, PR draft, documentos personales/metodología/Sprint4/backlog, .gitignore, secretos, caches y simulador. No hubo staging ni commits.

Mensajes preparados al equipo y dueño E2: informar migración/Prisma/seed y coordinación de los archivos E2 listados en §7. Quedan como borradores locales; no se enviaron comunicaciones externas. Servidor y Chrome propios detenidos; CIM sin sus procesos. Caches `.next`, `tsconfig.tsbuildinfo`, pagos simulados y perfil temporal cerrado permanecen locales, fuera del commit.
