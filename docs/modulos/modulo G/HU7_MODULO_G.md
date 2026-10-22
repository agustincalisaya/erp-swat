# Documentación técnica de cierre — HU-G7 (Posición diaria consolidada)

## ERP SWAT Indumentarias — Módulo G (Gestión de Caja y Tesorería)

**Documento escrito desde el código real** el 2026-10-19, releyendo la rama
`HU-G7` y el merge de `origin/develop` en `78b0a9c`. Cada afirmación está
anclada a `archivo:línea`; los casos sin prueba se marcan como limitación (§9).

> **Estado (2026-10-19).** HU-G7 está implementada en la rama **`HU-G7`**, con
> `origin/develop` mergeado en `78b0a9c` (allí llegaron HU-G12/G13, Tactical
> Premium y el entorno de Mercado Pago; sin conflicto con esta HU). **Todavía no
> hay PR**: el paso pendiente es **crear el PR contra `develop`**; no se cita
> número porque no existe.
>
> **Evidencia:** `npm test` **1229/1229**, lint **0 errores** (6 warnings
> preexistentes), build **OK**, `test:integration:g7` **5/5**, **37 migraciones**
> aplicadas, seed idempotente, índice `(cuenta_id, fecha, created_at)` y FK
> `ON DELETE RESTRICT` confirmados contra `swat_erp_db`.

---

## 1. Historia de Usuario y Criterios de Aceptación

**Como** Gerente, **necesito** ver la posición diaria consolidada —saldos de
cuentas propias, caja virtual de Mercado Pago, egresos e ingresos proyectados—
**para** decidir con una foto completa de la liquidez sin confundir el corte del
día con las proyecciones a estado actual. **Como** Tesorero Central, además,
**necesito** registrar el saldo diario como asiento append-only **para**
corregir un valor sin perder el historial.

| # | Criterio (spec G §9.8) | Estado | Evidencia |
|---|---|---|---|
| G7-1 | Día de Argentina: cada `CuentaPropia` activa + caja virtual `MERCADO_PAGO_CANAL_WEB` + total líquido; sin cuentas inactivas. | ✅ | `posicion-diaria.service.ts:192-193`, `:247-258`, `:287-292`; `ingreso-tesoreria.service.ts:46` |
| G7-2 | Caja hasta las 00:00 argentinas del día siguiente; saldos fecha-solo. El día rige lo líquido; proyecciones a estado actual; UI y DTO distinguen ambos cortes. | ✅ | `calculo.ts:29-41`; `service.ts:199-219`, `:285`; `PosicionDiariaPanel.tsx:117-150` |
| G7-3 | Último saldo con `fecha <= día`, orden `fecha, created_at, id` desc; sin asiento → «sin saldo registrado» y exclusión del total. | ✅ | `calculo.ts:69-98`; `service.ts:243-258`; panel `:83-93` |
| G7-4 | Tesorero con `:registrar_saldo_diario` registra cuenta, fecha, `Decimal(12,2)`, actor y `created_at`; append-only, corrección = otro asiento; auditoría SHA-256. | ✅ con salvedad (§9.6) | `schema.prisma:2990-3003`; `service.ts:330-371`; `audit-log.listener.ts:2196-2227` |
| G7-5 | Caja = Σ ingresos por `fecha` − Σ contra-asientos por `created_at`; sin `VentaMedioPago` ni retiros presumidos; la pantalla lo indica. | ✅ | `calculo.ts:121-134`; `service.ts:210-219`, `:287-291`, `:68-71`; panel `:103` |
| G7-6 | Ningún turno POS abierto aporta saldo esperado; se conserva el arqueo ciego B2. | ✅ por ausencia + test estructural | `service.ts:195-241` no lee `TurnoCaja`; `posicion-diaria.service.test.ts:410-417` |
| G7-7 | Egresos `DEFINITIVA`/`PROVISORIO` separados, agrupados por vencimiento y «sin fecha», sin mezclar `PAGADA/CANCELADA`; total solo `DEFINITIVA`. | ✅ (agrupación degenerada, §9.3) | `service.ts:220-228`, `:260-272`, `:293-298`; `calculo.ts:162-211` |
| G7-8 | Ingresos: `saldo_actual` por cuenta corriente + hitos del plan aparte, informativos, sin sumar; nota de cobranzas externas. | ✅ | `service.ts:274-281`, `:299-313`; `calculo.ts:260-288`; panel `:155-190` |
| G7-9 | Sin proyección de ingresos futuros del canal web. | ✅ por ausencia | `service.ts:195-241` solo lee caja realizada y CC |
| G7-10 | Lectura con `:leer_reportes` para 5 perfiles; registro con permiso separado; cuentas por nombre/ID, sin CBU/alias. | ✅ | `route.ts:33`, `:57`; `page.tsx:62-66`; `actions.ts:65`; `service.ts:247-258`; test `service.test.ts:391-408` |

---

## 2. Visión general

Tres piezas: `posicion-diaria.calculo.ts` (funciones puras, sin I/O ni
`server-only`), `posicion-diaria.service.ts` (`server-only`, lee Prisma y arma
el DTO) y rutas/página (sesión, permiso, Zod y delegación).

```
LECTURA — /tesoreria/posicion-diaria?dia=AAAA-MM-DD   (page.tsx:43)
  sesión (:57) → Promise.all(:leer_reportes, :registrar_saldo_diario) (:62-65)
  sin :leer → /no-autorizado (:66); ?dia inválido/ausente → diaNegocioIso() (:70-72)
  obtenerPosicionDiaria(diaIso)                        (service.ts:182)
    corte = inicioDiaUtc(diaIso); hasta = rangoDiasNegocio(dia,dia).hasta
    Promise.all: saldos fecha<=corte (:199-209) · ingresos fecha<hasta (:211-214)
      contra-asientos created_at<hasta (:216-219) · CxP DEFINITIVA/PROVISORIO (:221-228)
      CC activas + operaciones con plan_de_pagos (:229-240)
    elegirSaldoVigente → calcularCajaVirtual → totalLiquido (calculo.ts:69, :121, :304)
    DTO con strings .toFixed(2) y cortes explícitos    (:283-314)
  PosicionDiariaPanel + SelectorDia                    (page.tsx:92-95)

REGISTRO — FormularioRegistrarSaldo (solo si puedeRegistrar, page.tsx:97-110)
  registrarSaldoDiarioAction (actions.ts:50) → safeParse (:56) → gate (:65)
  registrarSaldoDiario (service.ts:330):
    $transaction: findFirst cuenta activa (:335-345) → create (:347-355)
      fecha = inicioDiaUtc(input.fecha); saldo = new Prisma.Decimal(...)
    post-COMMIT emit("tesoreria:saldo_diario_registrado") (:358-364)
  listener → registrarAuditLog(CREATE) → router.refresh() (form :93)
```

La ruta `POST /api/tesoreria/posicion-diaria` (`route.ts:57-92`) llama a la
**misma** función de servicio que la action. El formulario ofrece solo cuentas
propias (`posicion.cuentas`): la caja virtual se calcula, no se registra.

---

## 3. Modelo y migración

`SaldoDiarioCuenta` (`schema.prisma:2990-3003`): `id` uuid, `cuenta_id` FK a
`cuentas_propias`, `fecha DateTime` (fecha-solo a medianoche UTC), `saldo
Decimal(12,2)` (admite 0 y negativos), `registrado_por_id String` (actor, **sin
FK** a `Usuario`, D2), `created_at`, `onDelete: Restrict` (`:2999`) e índice
`(cuenta_id, fecha, created_at)` (`:3001`). Sin `updated_at`, `is_active` ni
baja: es **append-only**. No hay `@@unique([cuenta_id, fecha])` porque impediría
corregir el mismo día (JSDoc `:2981-2989`). Relación inversa:
`CuentaPropia.saldos` (`:2970-2971`).

Migración `20261016201122_hu_g7_saldos_diarios` (17 líneas, aditiva):
`CREATE TABLE` (`:2-11`), índice (`:14`) y FK `ON DELETE RESTRICT ON UPDATE
CASCADE` (`:17`). Sin `DROP`, `CHECK` ni backfill. Verificado en la base: índice
presente, `pg_constraint.confdeltype = 'r'` y **37 migraciones** aplicadas.

Seed: `seed.ts:5490-5507` crea `tesoreria:registrar_saldo_diario` (`…055`) y lo
asigna solo a `TESORERO_CENTRAL`; `:5516-5535` define tres saldos de ejemplo y
`:5537-5554` usa `findUnique` + `create` con `id` fijo, así que re-correr el seed
no duplica ni reescribe asientos.

---

## 4. Permisos

| Permiso | UUID | Roles | Acción |
|---|---|---|---|
| `tesoreria:leer_reportes` | `…047` | CAJERO_POS, TESORERO_CENTRAL, AUDITOR, ADMINISTRADOR, GERENTE | GET y acceso a la página |
| `tesoreria:registrar_saldo_diario` | `…055` | TESORERO_CENTRAL | POST append-only |

`:leer_reportes` viene del PR 0 (`seed.ts:5086-5091`); el service lo reexporta
desde `reporte-mensual.service.ts:9` (`service.ts:58`). `:055` se crea en
`seed.ts:5490-5507`. Gates: `route.ts:33-34` (GET), `:57-58` (POST), página
`page.tsx:62-66`, action `actions.ts:65-67`. El formulario solo se ofrece si
`puedeRegistrar` (`page.tsx:97`), pero el servidor revalida. Cajero POS lee y no
registra; la integración verifica ambos lados
(`posicion-diaria.integration.test.ts:96-112`).

---

## 5. Evento y auditoría

Payload `SaldoDiarioRegistradoPayload { cuenta_propia_id, fecha, saldo,
usuario_id, timestamp }` (`event-types.ts:1614-1620`), registrado en
`DomainEventMap` (`:1900`) y en `TIPOS_EVENTO_DOMINIO` (`:2040`). Se emite
**post-COMMIT** (`service.ts:358-364`); el handler
`audit-log.listener.ts:2203-2227` escribe `CREATE` sobre
`saldos_diarios_cuenta`, con `registro_id = cuenta_propia_id` (`:2214`, el
payload no trae el id del asiento) y `valor_nuevo = { fecha, saldo }` (`:2217`),
sin CBU, alias ni nombre. Usa `Symbol.for("swat.audit-log.saldo-diario")` para no
duplicarse en recargas (`:2203-2207`). La integración comprueba el asiento, el
actor y las claves exactas `["fecha","saldo"]` (`:117-149`). La cadena SHA-256
la construye `registrarAuditLog`; el service no escribe `AuditLog` directo.

---

## 6. Semántica del cálculo

- **Dos convenciones de fecha.** `SaldoDiarioCuenta.fecha` es fecha-solo UTC:
  corte `inicioDiaUtc(diaIso)` (`calculo.ts:29-31`) y comparación `fecha <=
  corte` (`service.ts:200`). `IngresoTesoreria.fecha` y
  `ContraAsientoIngreso.created_at` son instantes reales: corte
  `rangoDiasNegocio(dia,dia).hasta` = 00:00 AR del día siguiente
  (`calculo.ts:39-41`), comparación `fecha/created_at < hasta`
  (`service.ts:212`, `:217`). Saldos es inclusivo; caja es semiabierto.
  `rangoDiasNegocio` (`fecha-negocio.ts:328`) usa el día de negocio argentino.
- **Saldo vigente.** `elegirSaldoVigente` ordena `fecha desc`, `created_at desc`,
  `id desc` (`calculo.ts:69-98`). Sin filas hasta el corte, la cuenta no aparece
  en el `Map`: DTO con `saldo: null`, `sin_saldo_registrado: true`,
  `fecha_saldo: null` (`service.ts:247-258`) y exclusión del total
  (`calculo.ts:304-309`). Nunca se presume cero. La UI muestra la fecha del
  asiento (`panel.tsx:83`).
- **Caja virtual.** `calcularCajaVirtual` = Σ ingresos − Σ contra-asientos;
  arranca en `Decimal(0)` y puede dar **negativo** sin clamp (`calculo.ts:121-134`;
  test `calculo.test.ts:115-119`). La consulta de ingresos **no tiene cota
  inferior** (`service.ts:210-214`): es acumulado histórico hasta el fin del día.
  No suma `VentaMedioPago` web ni modela retiros; la nota viaja en el DTO
  (`:68-71`, `:290`) y se muestra en el panel (`:103`).
- **Turnos POS.** El service no consulta `TurnoCaja` (`service.ts:195-241`) y el
  DTO no expone `saldo_esperado`; el test estructural lo verifica ignorando
  comentarios (`service.test.ts:410-417`). Se conserva el arqueo ciego B2.
- **Egresos.** Solo CxP activas `DEFINITIVA/PROVISORIO` (`service.ts:221-228`);
  `PAGADA/CANCELADA` quedan fuera. Los bloques **no se suman**
  (`calculo.ts:202-211`); dentro de cada uno se agrupa por `fecha_vencimiento` y
  el grupo `null` va al final (`:162-194`). `total_definitivas` suma solo
  `DEFINITIVA` (`:209`) y el DTO lo rotula (`service.ts:293-298`).
- **Ingresos.** CC activas con `saldo_actual` (`service.ts:229-240`, `:300-304`).
  Hitos de `plan_de_pagos` validados por `esHitoPlan` (`calculo.ts:241-250`); sin
  `fecha_estimada` se excluyen y un plan malformado se ignora (`:260-288`).
  Importe = `monto × porcentaje / 100` con escala 2 (`:272-275`). No se suman al
  total ni al saldo corriente. La nota de cobranzas externas viaja en el DTO
  (`:312`) y se muestra en el panel (`:181`).
- **Cortes y dinero.** `corte = { liquido: diaIso, proyecciones: "ESTADO_ACTUAL" }`
  (`service.ts:124-132`, `:285`); la página lo explica (`page.tsx:86-89`). Todo
  el dinero usa `Prisma.Decimal`, sin `.toNumber()` (`calculo.ts:13-15`), y se
  serializa con `.toFixed(2)` (`:312-314`). El schema rechaza la 3.ª decimal en
  vez de redondearla (`posicion-diaria.schema.ts:48-62`).
- **Sin datos bancarios.** El DTO no descifra nada: usa
  `listarCuentasPropiasActivas()` (`service.ts:192`;
  `cuenta-propia.service.ts:257-263`). El test busca `cbu`, `alias` y los
  literales sembrados en el JSON (`service.test.ts:391-408`; integración
  `:152-161`).

---

## 7. Archivos

| Archivo | Rol | Anclas |
|---|---|---|
| `prisma/schema.prisma` | Modelo y relación inversa | `:2971`, `:2990-3003` |
| `prisma/migrations/20261016201122_…/migration.sql` | Tabla, índice, FK | `:1-17` |
| `.../posicion-diaria.calculo.ts` | Cortes, saldo, caja, egresos, hitos, totales | `:29`, `:39`, `:69`, `:121`, `:202`, `:260`, `:304`, `:312` |
| `.../posicion-diaria.service.ts` | Lectura consolidada y registro | `:55-58`, `:182`, `:330`, `:358` |
| `.../posicion-diaria.schema.ts` | Día y saldo | `:32-42`, `:55-62` |
| `.../posicion-diaria/route.ts` · `page.tsx` · `actions.ts` | API, RSC y action | `:33`, `:57` · `:43`, `:55-74` · `:50-76` |
| `.../SelectorDia.tsx` · `PosicionDiariaPanel.tsx` · `FormularioRegistrarSaldo.tsx` | UI | `:24-30` · `:51` · `:43` |
| `Sidebar.tsx` | «Posición diaria» antes de «Cuentas propias» | `:323-328` |
| `event-types.ts` · `audit-log.listener.ts` | Payload y handler | `:1614-1620`, `:1900`, `:2040` · `:2196-2227` |
| `prisma/seed.ts` | Permiso `…055` y saldos | `:5490-5507`, `:5516-5554` |
| `ingreso-tesoreria.service.ts` · `fecha-negocio.ts` | Caja virtual · helpers de fecha | `:46` · `:67`, `:81`, `:86`, `:328` |

---

## 8. Pruebas y evidencia

- **Unitarios (38):** cálculo 21 (`posicion-diaria.calculo.test.ts`), service 11
  (`posicion-diaria.service.test.ts`), schema 6
  (`posicion-diaria.schema.test.ts`); los tres en `package.json:13`.
- **Integración DB (5/5):** RBAC de 5 roles (`:96-112`), registro + auditoría
  `CREATE` (`:117-149`), lectura sin CBU/alias y con los dos cortes (`:152-161`),
  rechazo de 3.ª decimal/día futuro/cuenta inactiva (`:164-196`).
- **Entorno:** `npm test` 1229/1229, lint 0 errores, build OK, 37 migraciones,
  índice y FK RESTRICT verificados por consulta directa, seed idempotente.

---

## 9. Limitaciones y hallazgos

1. **Gate DB-backed, no HTTP.** La integración importa el service y
   `usuarioTienePermiso` (`:60-76`); no ejecuta `fetch`, así que no cubre
   401/403/400/201 HTTP. A diferencia de G5, no hay gate HTTP separado.
2. **Sin read-back de saldo cero/negativo.** Cálculo y schema cubren negativos y
   cero (`calculo.test.ts:115-119`; `posicion-diaria.schema.test.ts:44-61`), pero
   la integración solo registra `"1234567.89"` (`:131`) y no vuelve a leerlo desde
   la posición para comprobar valor, fecha ni el caso cero/negativo.
3. **`fecha_vencimiento` siempre `null`.** Ningún camino de escritura la setea
   (`cuenta-por-pagar.service.ts:288`, `:307`, `:408`, `:478`, `:638`) y el
   listado solo la selecciona (`:696`, `:729`). La agrupación está probada con
   fixtures (`calculo.test.ts:147-170`), pero hoy todo cae en «sin fecha».
4. **Tamaño sobre el presupuesto.** `d828b78..98151b9`: 20 archivos, 2.642
   inserciones + 2 eliminaciones = **2.644 líneas**, 2,6× el presupuesto de
   1.000; requiere `size:exception` y revisión por slices.
5. **El gate deja filas.** Crea un saldo real (`:130-133`) y una cuenta inactiva
   con `id` fijo (`:180-191`); `t.after` solo desconecta Prisma (`:78-80`). No
   hay limpieza y la baja lógica no permite borrar.
6. **Append-only por código, no por DB.** No hay trigger que impida
   `UPDATE`/`DELETE`; la invariante se sostiene porque el service solo llama
   `create` (`:347-355`) y no hay ruta de edición/baja (test estructural
   `service.test.ts:227-247`). Un acceso directo a Prisma/SQL podría violarla.
7. **El GET no aplica `DiaIsoSchema`.** La página valida `?dia=` y cae al día
   actual si es inválido (`page.tsx:70-72`), pero la ruta toma el valor crudo
   (`route.ts:36`) y no rechaza un **día futuro**; el POST sí
   (`posicion-diaria.schema.ts:42`). Un formato inválido termina en
   `PERIODO_INVALIDO` (400).
8. **`registrado_por_id` sin FK** (`schema.prisma:2995`), por D2. El actor llega
   desde la sesión (`route.ts:77`, `actions.ts:70`), pero la base no lo garantiza.
9. **Notas de alcance.** La caja no modela retiros (`service.ts:69`) y las
   cobranzas externas de CC no se registran (`:70-71`). Ambas notas viajan en el
   DTO y se muestran (`panel.tsx:103`, `:181`); un consumidor nuevo debe
   conservarlas.

---

## 10. Referencias

| Recurso | Dónde |
|---|---|
| Spec | `docs/specs/spec_modulo_G.md` §9.8 y §9.1 |
| HU-G5 · HU-G10 · caja virtual | `HU5_MODULO_G.md` · `HU10_MODULO_G.md` · `ingreso-tesoreria.service.ts` |
| Rama / merge | `HU-G7`, merge de `develop` en `78b0a9c` |
| Entrega | **PR a crear contra `develop`** (sin número asignado) |
| Gate | `test:integration:g7` → 5/5 (re-ejecutado 2026-10-19) |
