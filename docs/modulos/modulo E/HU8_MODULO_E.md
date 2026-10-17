# HU-E8 — Registro e inicio de sesión del Cliente Web (Módulo E)

Contrato: `docs/specs/spec_modulo_E.md` §2.8 y §2.8.a–§2.8.g (Revisión 2). Este documento resume las decisiones, la evidencia y los hallazgos del desarrollo. Los artefactos de trabajo SDD (task, design, auditoría, relevamientos y verify) son locales y no se versionan; todo lo relevante de ellos está incorporado acá.

**Módulo:** E — Canal de Venta Online · **Responsable:** Tomás · **Sprint / estimación:** Sprint 4 · 8 SP
**Estado:** Implementada y verificada (PR de implementación #205 más PR de deuda, rama `fix/HU-E8-deuda`). Limitación conocida: baja definitiva de la cuenta (sección 13.1).

## 1. Historia de usuario y qué hace

**Como** Cliente Web, **necesito** registrarme e iniciar sesión en la tienda online con una cuenta vinculada a mi registro de cliente, **para** recuperar mi carrito desde cualquier dispositivo, comprar online y seguir mis pedidos.

| Capacidad | Dónde | Resultado |
|---|---|---|
| Registro | `POST /api/tienda/cuenta/registro` · `/tienda/registrarse` | Crea el Cliente en Módulo C (`crearClienteTx`, sin modificar C) y la cuenta. **Sin sesión automática.** Si el DNI ya era Cliente de mostrador, la cuenta queda **pendiente** y el Cliente no se toca. |
| Login con bloqueo | `POST /api/tienda/cuenta/login` · `/tienda/ingresar` | 5 intentos fallidos ⇒ bloqueo de 15 minutos (`423 CUENTA_BLOQUEADA`, sin verificar la contraseña mientras dure). Sesión de 7 días. Una cuenta vinculada fusiona el carrito de visitante (E1); una pendiente **no**. |
| Validación presencial | `/ecommerce/cuentas-web` · `POST /api/ecommerce/cuentas-web/[id]/validar-vinculacion` | El Vendedor busca por DNI y, con el DNI físico del titular, confirma que reconoce el email de la cuenta. Si no lo reconoce, **reasigna el acceso** (email nuevo, contraseña anulada, sesiones revocadas) y emite un código de recuperación en la misma operación. |
| Recuperación presencial | `POST /api/ecommerce/cuentas-web/[id]/habilitar-recuperacion` · `POST /api/tienda/cuenta/redefinir-password` · `/tienda/recuperar` | El Vendedor emite un código de 8 caracteres (un uso, 15 minutos) que entrega en persona. El titular lo canjea con su email y define la contraseña. Sin mensajería externa, sin contraseña temporal. |
| Baja propia | `PATCH /api/tienda/cuenta/baja` · `/tienda/cuenta` | Solo cuenta vinculada, con motivo y confirmación. Baja lógica, sesiones revocadas, Cliente y pedidos intactos. |
| Aislamiento de pendientes | `withSesionClienteWeb`, `contexto-tienda`, páginas de checkout | La cuenta pendiente puede entrar, ver el aviso y cerrar sesión; nada más (sección 7). |

## 2. Criterios de aceptación (11) — estado y evidencia

Evidencia: `hu-e8.integration.test.ts` (servicio contra PostgreSQL, `test:integration:e8`), `hu-e8.http.integration.test.ts` (HTTP, `test:integration:e8-http`), unitarios (`registro-cuenta-web.reglas.test.ts`, `cuenta-cliente-web.schema.test.ts`), SQL de solo lectura y la demostración por la interfaz (sección 10).

| CA | Criterio (Backlog) | Estado | Evidencia |
|---|---|---|---|
| CA01 | El registro pide nombre, DNI, teléfono, email y contraseña, y crea el Cliente en C sin copia propia | Aprobado | Servicio: "CA01/02/05 — registro crea Cliente, consentimiento y hash Argon2id"; HTTP: registro 201; SQL de cuenta y auditoría |
| CA02 | Consentimiento Ley 25.326 registrado con fecha y alcance (HU-C4) | Aprobado | Mismo test de servicio (consentimiento creado por C1 en la misma transacción); schema: `acepta_tratamiento` es el literal `true`; HTTP: registro 400 (inválido) y 201 sin `Set-Cookie` |
| CA03 | Un DNI admite una única cuenta web activa | Aprobado | Servicio: "CA03 — DNI y email no se reutilizan…" (rollback sin Cliente huérfano) y "CA03 concurrencia — dos registros del mismo DNI dejan una cuenta"; HTTP 409 |
| CA04 | DNI de mostrador: cuenta pendiente hasta validación presencial del Vendedor | Aprobado | Servicio: "CA04 — Cliente de mostrador queda pendiente sin mutar…" y "CA04/C01 — vinculación reconocida es idempotente; reasignación revoca acceso…"; HTTP: 401 sin sesión, 403 sin permiso, Vendedor autorizado |
| CA05 | Contraseña con derivación con sal, nunca reversible | Aprobado | `password_hash` empieza con `$argon2id$` (servicio y SQL) |
| CA06 | N intentos fallidos: bloqueo temporal y evento auditado | Aprobado | Servicio: "CA06 — éxito reinicia contador; quinto fallo bloquea; vencido permite login" y "CA06 concurrencia — cinco fallos simultáneos desde cuatro intentos emiten un bloqueo"; HTTP: 423 |
| CA07 | Recuperación presencial vía Vendedor, sin mensajería externa | Aprobado | Servicio: "CA07 — recuperación: reemplazo, intento, vencimiento, consumo único y token_version" y "D2 — código válido sobre cuenta bloqueada responde 423…"; HTTP: pendiente 409, éxito 200 sin `Set-Cookie`, reutilización 422, código incorrecto 422 |
| CA08 | Sesión independiente del RBAC interno | Aprobado | HTTP: "CA08 — cookies JWT internas/web son incompatibles y tv viejo se rechaza" |
| CA09 | Al iniciar sesión, fusión del carrito de visitante | Aprobado | HTTP: "CA09 — pendiente conserva cookie visitante y no fusiona" (se demostró que falla sin las guardas); la fusión de cuentas vinculadas la cubre `test:integration:e1-http` ("CA7") |
| CA10 | Baja lógica completa que revoca sesiones sin afectar Cliente ni historial | Aprobado | Servicio: "CA10 — baja lógica revoca acceso y conserva Cliente/consentimientos/pedidos"; HTTP: "baja vinculada limpia cookie, revoca sesión y login" |
| CA11 | Alta, bloqueo, vinculación y baja generan evento auditado | Aprobado | Servicio: "CA11 — las seis transiciones quedan auditadas sin campos secretos" y "CA11 — la cadena SHA-256 completa permanece íntegra" |

## 3. Decisiones de producto y técnicas

### 3.1. Decisiones de producto (Tomás, en las fases previas del SDD)

| Decisión | Motivo |
|---|---|
| Login restringido para cuentas pendientes | Permite ver el aviso y cerrar sesión sin habilitar compra ni datos de pedidos hasta la validación presencial |
| Registro sin sesión automática | El alta no prueba la propiedad del email; se entra recién con el login |
| 5 intentos, 15 minutos de bloqueo, sesión de 7 días; el contador se reinicia por éxito o por bloqueo vencido; las sesiones ya emitidas se conservan durante el bloqueo | Defensa contra fuerza bruta sin expulsar al titular que ya está dentro |
| Recuperación por redefinición autorizada: un uso, 15 minutos, sin contraseña temporal | El titular define su contraseña; nadie más la conoce |
| Baja propia del titular con motivo y confirmación | Regla N.° 1: baja lógica, auditada |

### 3.2. Decisiones técnicas de la auditoría del diseño (D1–D6, aprobadas por Tomás el 02/10/2026)

| # | Decisión | Motivo |
|---|---|---|
| D1 | Registro con `crearClienteTx` **sin cambios en Módulo C**; autor técnico "Canal Web"; opt-in comercial con una casilla opcional | Cero migraciones sobre C y mismo patrón que HU-E2. `crearClienteTx` exige una decisión comercial: pasar `RECHAZA` sin preguntar registraría un rechazo que el cliente nunca expresó |
| D2 | DNI preexistente: el consentimiento del Cliente **no se toca**; la aceptación del reclamante queda en el evento `cuenta_web_registrada`. La validación presencial tampoco modifica consentimientos | El Cliente de mostrador ya tiene consentimiento vigente (C1 lo exige); evita una tabla de promoción diferida |
| D3 | Recuperación con código de 8 caracteres guardado como digest SHA-256 en `CuentaClienteWeb`; el body exige email + código | Usable en sucursal; un único `updateMany` condicional es atómico, sin tabla nueva ni locks |
| D4 | Reasignación de acceso en la validación cuando el titular no reconoce el email | Cierra el riesgo de apropiación de cuenta: quien conoce un DNI ajeno registra la cuenta con su propio email y, cuando el titular real valida su identidad en sucursal, se habilitaría una cuenta que controla el tercero |
| D5 | Pantalla del Vendedor en `/ecommerce/cuentas-web`, un solo permiso | No toca archivos del POS (Módulo B); E4 abre la misma familia de rutas |
| D6 | Baja definitiva en este sprint (sin re-registro ni reactivación) | `cliente_id` y `email` son únicos incluyendo cuentas dadas de baja; se documenta la limitación en lugar de un mensaje que promete una solución en sucursal que no existe |

### 3.3. Resoluciones previas a la implementación (relevamiento del código, 02/10/2026)

| Punto | Resolución |
|---|---|
| S3 | El servicio lee el Cliente por DNI con `tx` antes de decidir; solo llama a `crearClienteTx` si el DNI no existe. Módulo C sin cambios |
| S4 | "Canal Web" activo se resuelve **antes** de la transacción con `obtenerUsuarioCanalWebId()` (`usuario-canal-web.ts`, de HU-E2) |
| S11 | `audit-log.listener.ts` se modifica: un handler explícito por cada evento nuevo |
| Configuración | `configuracion.service.ts` suma `obtenerMaxIntentosCuentaWeb()` y `obtenerBloqueoMinutosCuentaWeb()` con el patrón de `obtenerTtlCheckoutHoras()` |
| Baja propia | Página nueva `/tienda/cuenta`: aviso de pendiente, cerrar sesión y baja (solo vinculadas) |
| Rama | `feature/HU-E8` desde `origin/develop`; un PR por HU |
| HU-E2 | Se reutiliza `obtenerUsuarioCanalWebId()`; se suma la guarda a `/tienda/checkout/resultado` (consumidor nuevo); eventos, handlers, schema y seed se integran sin pisar lo de E2 |
| Infraestructura | Base descartable `swat_erp_test_e1` y línea de base de E1 en verde (21/21 servicio, 15/15 HTTP) antes de tocar código |

Otras decisiones de la auditoría: reutilizar `crypto.randomInt` y `hashPassword`/`verifyPassword` (sin criptografía nueva); seguir el patrón de auditoría vigente (`domainEventBus.emit` post-COMMIT hacia `audit-log.listener.ts`) sin variantes; claves de configuración con la convención `ECOMMERCE_*` y columna `modulo`; la fusión de carritos sigue siendo de E1.

## 4. Modelo de datos, migración y seed

Sin modelos nuevos. Migración aditiva `20261002170000_hu_e8_cuenta_cliente_web_recuperacion` sobre `cuentas_cliente_web`:

| Campo | Tipo | Uso |
|---|---|---|
| `recuperacion_codigo_digest` | `TEXT`, único | SHA-256 del código (en mayúsculas); **nunca** el código |
| `recuperacion_expira_en` | `TIMESTAMP(3)` | `now() + 15 min` al emitir |
| `recuperacion_emitida_por_id` | `TEXT`, FK a `usuarios` (`ON DELETE RESTRICT`) | Vendedor que emitió el código |

Una nueva emisión reemplaza la anterior (que deja de servir). Relación inversa: `Usuario` (`@relation("RecuperacionCuentaWebEmitidaPor")`).

La migración se escribió a mano: `prisma migrate dev` rechaza el entorno no interactivo. Se validó con `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <base shadow descartable> --exit-code` → "No difference detected", exit 0.

Seed (idempotente, `upsert`; dos corridas seguidas sin errores):

| Qué | Valor |
|---|---|
| `ECOMMERCE_CUENTA_WEB_MAX_INTENTOS` | `5` (módulo `E`) |
| `ECOMMERCE_CUENTA_WEB_BLOQUEO_MINUTOS` | `15` (módulo `E`) |
| Permiso `ventas:validar_identidad_cliente_web` | id `1a2b3c4d-1111-4a1a-8a1a-000000000044` (siguiente libre del namespace `1111`; máximo remoto previo `...043`), módulo `MODULO_E` |
| Asignación | Solo rol `VENDEDOR` (`RolPermiso`) |

Si falta alguna clave `ECOMMERCE_CUENTA_WEB_*` o no es un entero positivo, no hay valor por defecto: el login y la redefinición responden `500 INTERNAL_ERROR` genérico, sin el nombre de la clave (sección 5.3).

## 5. Contrato de endpoints

Los siete `route.ts` de E8 exportan **solo** el método HTTP que figura abajo (verificado con `git grep`). Envelope estándar `{ data, error }`. `logout` es de E1 y no cambia.

### 5.1. Rutas

| Método | Ruta (`src/app/api/…/route.ts`) | Guard | Respuestas |
|---|---|---|---|
| POST | `tienda/cuenta/registro` | pública | 201 `{ cuenta_id, cliente_id, vinculacion_pendiente }` sin `Set-Cookie` · 400 · 409 `CUENTA_WEB_YA_EXISTE` / `REGISTRO_WEB_NO_DISPONIBLE` |
| POST | `tienda/cuenta/login` (E1, modificada) | pública | 200 `{ cuenta_id, email, vinculacion_pendiente, carrito_fusionado }` + cookie `swat_tienda_session` · 400 · 401 `CREDENCIALES_INVALIDAS` · 423 `CUENTA_BLOQUEADA` · 500 `INTERNAL_ERROR` |
| POST | `tienda/cuenta/redefinir-password` | pública con código válido | 200 `{ cuenta_id }` sin sesión · 400 · 422 `CODIGO_RECUPERACION_INVALIDO` · 423 · 500 |
| PATCH | `tienda/cuenta/baja` | `withSesionClienteWeb` (sesión **vinculada**) | 200 `{ cuenta_id }` y borra la cookie · 400 · 401 `SESION_CLIENTE_WEB_REQUERIDA` · 403 `CUENTA_VINCULACION_PENDIENTE` · 404 |
| GET | `ecommerce/cuentas-web?dni=` | `withPermission(PERMISO_VALIDAR_IDENTIDAD_CLIENTE_WEB)` | 200 `{ cuenta }` · 400 · 401 · 403 `FORBIDDEN` · 404 `CUENTA_WEB_NO_ENCONTRADA` |
| POST | `ecommerce/cuentas-web/[id]/validar-vinculacion` | ídem | 200 `{ cuenta_id, vinculacion_pendiente: false, acceso_reasignado, codigo?, expira_en? }` · 400 · 404 · 409 `REGISTRO_WEB_NO_DISPONIBLE` |
| POST | `ecommerce/cuentas-web/[id]/habilitar-recuperacion` | ídem | 201 `{ codigo, expira_en }` · 404 · 409 `CUENTA_VINCULACION_PENDIENTE` |

Ninguna de estas rutas usa la sesión del ERP para el Cliente Web, ni el Cliente Web accede a `api/ecommerce/**` (CA08). El `actorUsuarioId` sale siempre de la sesión interna (`session.userId`), nunca del body; el `cuentaId` de la baja sale siempre de la sesión web.

### 5.2. Servicios y schemas

`src/lib/services/ecommerce/cuenta-cliente-web.service.ts` exporta: `registrarCuentaClienteWeb`, `autenticarCuentaClienteWeb`, `habilitarRecuperacionCuentaWeb`, `validarVinculacionCuentaWeb`, `redefinirPasswordCuentaWeb`, `darDeBajaCuentaWeb`, `buscarCuentaWebPorDni`, la clase `ErrorConfiguracionCuentaWeb` y la constante `MENSAJE_ERROR_INTERNO_CUENTA_WEB`. Los pasos internos (`resolverIntentoLoginCuentaWeb`, `emitirRecuperacionTx`) no se exportan.

`src/lib/services/ecommerce/registro-cuenta-web.reglas.ts` exporta `resolverClienteCreadoEnRegistro()` (regla pura: si `crearClienteTx` devuelve `esNuevo = false`, la cuenta queda pendiente; un Cliente concurrente inactivo se rechaza).

`src/lib/schemas/cuenta-cliente-web.schema.ts`: `RegistroCuentaWebSchema`, `RedefinirPasswordSchema`, `BajaCuentaWebSchema`, `ValidarVinculacionSchema` (unión discriminada por `email_reconocido`), `BuscarCuentaPorDniSchema`.

La constante del permiso, `PERMISO_VALIDAR_IDENTIDAD_CLIENTE_WEB`, vive en `src/lib/auth/permisos-ecommerce.ts` (no en un `route.ts`, ver sección 8.3).

### 5.3. Errores

| Código | HTTP | Mensaje | Caso |
|---|---|---|---|
| `CUENTA_WEB_YA_EXISTE` | 409 | "Ya existe una cuenta web para este DNI" | El Cliente del DNI ya tiene cuenta (también ante la carrera de dos registros del mismo DNI) |
| `REGISTRO_WEB_NO_DISPONIBLE` | 409 | "No es posible completar el registro con los datos indicados." | Cliente inactivo, email ya usado (activa o no) o email ocupado al reasignar. No revela qué dato coincide |
| `CREDENCIALES_INVALIDAS` | 401 | "Email o contraseña incorrectos" | Email inexistente, cuenta inactiva o contraseña incorrecta (solo esta última suma intento) |
| `CUENTA_BLOQUEADA` | 423 | "La cuenta está bloqueada temporalmente por intentos fallidos; la recuperación es presencial en sucursal" | Bloqueo vigente (login y redefinición) |
| `CUENTA_VINCULACION_PENDIENTE` | 403 / 409 | 403: "Tu cuenta está pendiente de validación de identidad en sucursal". 409 (habilitar recuperación): "La cuenta está pendiente de validación de identidad" | 403 al usar recursos con cuenta pendiente; 409 al habilitar recuperación sobre una pendiente |
| `CODIGO_RECUPERACION_INVALIDO` | 422 | "El código no es válido o venció" | Incorrecto, vencido o ya usado (no distingue la causa) |
| `SESION_CLIENTE_WEB_REQUERIDA` | 401 | "Debe iniciar sesión para continuar" (por defecto); "Debe iniciar sesión para completar la compra" en `POST /api/tienda/checkout` | Sin sesión. Opción `mensajeSinSesion` de `withSesionClienteWeb` |
| `CUENTA_WEB_NO_ENCONTRADA` | 404 | "Cuenta web no encontrada" | Rutas internas y baja sobre una cuenta inexistente o inactiva |
| `VALIDATION_ERROR` | 400 | "Los datos enviados no son válidos" (con `fieldErrors`) | Input inválido |
| `INTERNAL_ERROR` | 500 | "Error interno. Intentá más tarde." (configuración) / "Error interno del servidor" | Claves `ECOMMERCE_CUENTA_WEB_*` faltantes o inválidas (login y redefinición); error inesperado |

## 6. Reglas del servicio (resumen)

- **Registro.** Hash Argon2id (`hashPassword`) y usuario "Canal Web" (`obtenerUsuarioCanalWebId()`) **antes** de abrir la transacción. Dentro: Cliente inexistente ⇒ `crearClienteTx` y cuenta no pendiente (`ACEPTA`/`RECHAZA` según la casilla de comunicaciones); activo sin cuenta ⇒ cuenta pendiente sin tocar al Cliente ni sus consentimientos; con cuenta ⇒ `CUENTA_WEB_YA_EXISTE`; inactivo ⇒ `REGISTRO_WEB_NO_DISPONIBLE`. El `P2002` se traduce al 409 correspondiente; nunca se devuelve como éxito una cuenta creada por otro request. Las casillas (obligatoria: tratamiento Ley 25.326; opcional: comunicaciones) vienen sin marcar.
- **Login.** `SELECT … FOR UPDATE` de la cuenta; Argon2 fuera de la transacción para no retener el lock; si `token_version` cambió, no se emite sesión. Bloqueo vencido ⇒ contador a 0. El evento de bloqueo sale **una sola vez por transición** aunque lleguen requests concurrentes. El bloqueo no incrementa `token_version`.
- **Vinculación.** `SELECT … FOR UPDATE`: un doble request produce una sola transición, un evento y un código. Sobre una cuenta ya vinculada responde 200 con su estado, sin cambios ni evento.
- **Reasignación de acceso.** En una transacción: email nuevo (normalizado y único), `password_hash` por el hash de 32 bytes aleatorios descartados, `token_version + 1`, contador y bloqueo limpios, `vinculacion_pendiente = false` y código de recuperación emitido. El titular define su contraseña con ese código.
- **Código de recuperación.** 8 caracteres con `crypto.randomInt` sobre `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (sin `0 O 1 I L`); se persiste solo el SHA-256; se muestra una única vez en la pantalla del Vendedor; nunca va en email/SMS, URL ni logs.
- **Redefinición.** Un único `updateMany` consume el código con **todas** las condiciones en el `where`: email, cuenta activa y vinculada, digest, vencimiento y **bloqueo no vigente**. Dos requests con el mismo código producen un solo éxito, y una cuenta bloqueada no consume el código. Solo si `count !== 1` se lee la cuenta, y esa lectura únicamente decide 423 o 422; un código incorrecto sobre una cuenta activa suma un intento fallido (mismo bloqueo que el login). Éxito: nuevo hash, limpia recuperación, contador a 0, bloqueo a `null`, `token_version + 1`. No inicia sesión.
- **Baja.** Una transacción: `is_active = false`, `deleted_at`, `deleted_by = "cuenta_web:<id>"`, `deletion_reason = motivo`, `token_version + 1` y limpieza de la recuperación. El Cliente, sus consentimientos y sus pedidos no se tocan.
- **Búsqueda del Vendedor.** `buscarCuentaWebPorDni` devuelve también cuentas dadas de baja; la pantalla las muestra como "Dada de baja" con la fecha y sin acciones, y "Bloqueada" solo si `bloqueada_hasta > now`.

## 7. Aislamiento de cuentas pendientes

Una cuenta pendiente puede iniciar sesión, ver el aviso y cerrar sesión. **No puede** usar el carrito persistente, fusionar, hacer checkout, consultar pedidos, comprobantes ni QR, ni darse de baja. Mientras tanto navega catálogo y carrito como visitante.

| Punto | Comportamiento |
|---|---|
| `withSesionClienteWeb()` (`src/lib/auth/sesion-cliente-web.ts`) | Rechaza **por defecto** las pendientes con `403 CUENTA_VINCULACION_PENDIENTE`; la opción `permitirPendiente` existe pero hoy ninguna ruta la usa |
| `resolverContextoTienda()` (`contexto-tienda.ts`) | Una pendiente se resuelve como visitante: usa el carrito de la cookie `swat_carrito`, nunca el de la cuenta |
| Login | `if (tokenVisitante && !sesion.vinculacionPendiente)` para fusionar; la cookie de visitante se conserva |
| `/tienda/checkout/pendiente` y `/tienda/checkout/resultado` | Redirigen a `/tienda/cuenta` si la sesión es pendiente; leen la sesión con `getSesionClienteWebVinculada()` |
| `/tienda/carrito` | Muestra el aviso con enlace a `/tienda/cuenta`; `CarritoCliente` recibe `compraBloqueada` y no ofrece "Iniciar compra" ni "Ingresar para comprar" |
| `/tienda/cuenta` | Aviso de pendiente, cerrar sesión; la baja solo si está vinculada (`permitirBaja`). Sin sesión redirige a `/tienda/ingresar` |

Cualquier consumidor nuevo de la sesión web debe pasar por la misma guarda (`getSesionClienteWebVinculada()` o el valor por defecto de `withSesionClienteWeb`).

## 8. Hallazgos durante el desarrollo

### 8.1. Del Apply

| Hallazgo | Tratamiento |
|---|---|
| **Registro concurrente del mismo DNI.** El test `CA03 concurrencia — dos registros del mismo DNI dejan una cuenta` falló: el segundo registro terminaba en `P2002` sobre `clientes.dni` y se traducía como `REGISTRO_WEB_NO_DISPONIBLE` en lugar de `CUENTA_WEB_YA_EXISTE` | La traducción solo reconocía el target `cliente_id`. Ante `P2002` de `dni` se consulta la cuenta asociada al DNI y se devuelve `CUENTA_WEB_YA_EXISTE` si existe |
| `prisma migrate dev` no puede crear la migración en un entorno no interactivo | Migración escrita a mano y validada con `prisma migrate diff` (sección 4) |

### 8.2. Del Verify independiente y del re-verify

Apto para commit sin hallazgos Críticos ni Altos.

| # | Sev. | Hallazgo | Estado |
|---|---|---|---|
| H1 | Medio | Se ignoraba `creado.esNuevo`: un alta concurrente del mismo DNI por otro canal dejaba una cuenta **vinculada** sobre un Cliente de mostrador | Corregido: `resolverClienteCreadoEnRegistro`. Cubierto por el unitario `H1 — un Cliente aparecido durante crearClienteTx queda pendiente`; la integración no reproduce la carrera (no hay hooks de prueba) |
| H2 | Medio | El test CA09 usaba una cookie de visitante inválida: la rama de fusión nunca se ejecutaba y el test pasaba aunque se quitara la guarda | Corregido: el test arma un carrito real con cookie firmada. Prueba negativa: sin las guardas, CA09 falla |
| H3 | Medio | Validaciones concurrentes: dos eventos `vinculada` y dos códigos (el primero dejaba de servir) | Corregido con `SELECT … FOR UPDATE` |
| H4 | Bajo | Mensajes de `CUENTA_BLOQUEADA` y `SESION_CLIENTE_WEB_REQUERIDA` distintos del contrato | Corregido; test de textos exactos |
| H5 | Bajo | La pantalla del Vendedor mostraba bajas como "Activa", bloqueos vencidos como "Bloqueada", sin errores y con `window.prompt` | Estado corregido en el Verify; `window.prompt` y errores, en la deuda (sección 9) |
| H6 | Bajo | El carrito de una pendiente ofrecía "Iniciar compra" | Corregido (sección 7) |
| H7 | Bajo | El 423 de la redefinición salía de una lectura previa | Corregido en la deuda (sección 9) |
| H8 | Bajo | Comentarios obsoletos del seed | Corregido |
| H9 | Bajo | `registrarFallo` también procesaba el éxito; variable `bloqueada` engañosa | Corregido en la deuda (sección 9) |
| H10 | Bajo | La página del Vendedor importaba la constante del permiso desde un `route.ts` | Corregido: `src/lib/auth/permisos-ecommerce.ts` |
| H11 | Bajo | Variables de las suites HTTP sin documentar | Corregido: nota en `HU1_MODULO_E.md` §9.1 y sección 12 |
| H12 | Medio | Con `ECOMMERCE_CUENTA_WEB_*` faltante o inválida, el login respondía 401 y la redefinición 422, con el nombre de la clave en el mensaje (no lo vio el primer Verify; lo encontró el re-verify) | Corregido: `ErrorConfiguracionCuentaWeb` ⇒ `500 INTERNAL_ERROR` genérico; el nombre de la clave solo en `console.error` del servidor |

### 8.3. Un export inválido en `route.ts` rompía `next build` (lección de proceso)

Una constante (el permiso) exportada desde un archivo `route.ts` rompía `next build`, porque un Route Handler solo puede exportar métodos HTTP y opciones de configuración de segmento. `tsc --noEmit` y ESLint **no** lo detectan: lo frenó el hook pre-commit de revisión de código (Gentleman Guardian Angel) al intentar el commit de la implementación. Se corrigió moviendo `PERMISO_VALIDAR_IDENTIDAD_CLIENTE_WEB` a `src/lib/auth/permisos-ecommerce.ts`. Desde entonces el Verify corre `next build` (último resultado documentado: OK, 68/68 páginas). Verificado hoy: los siete `route.ts` de E8 exportan únicamente su método HTTP.

*(El mensaje literal del error de build no está en los relevamientos disponibles; la descripción sigue lo informado por el equipo.)*

## 9. Deuda resuelta en este mismo PR (primer commit, `fix/HU-E8-deuda`)

| Punto | Qué se hizo |
|---|---|
| D1 — `window.prompt` | `CuentasWebCliente.tsx` ya no usa `window.prompt`. Flujo en pantalla: "El titular reconoce el email" / "No lo reconoce"; el segundo abre un campo de email validado (cliente y `fieldErrors` del API) con "Confirmar reasignación" y "Cancelar". Los errores 400/401/403/404/409/500 y de red se muestran en un `Alert` destructivo con el `message` de la API; botones y campos deshabilitados con un request en curso |
| D2 — 423 atómico | La condición de bloqueo (`bloqueada_hasta` nulo o `<= ahora`) pasó al `where` del `updateMany` de `redefinirPasswordCuentaWeb`; la lectura posterior solo decide 423 o 422. Test: "D2 — código válido sobre cuenta bloqueada responde 423 sin redefinir; con bloqueo vencido redefine" (secuencial: la carrera dura microsegundos y no se puede forzar de forma determinista) |
| D3 / N3 — nombres | `registrarFallo` → `registrarIntentoFallidoCuentaWeb` → `resolverIntentoLoginCuentaWeb`; `bloqueada` → `cuentaAutenticada`; propiedad interna `bloqueada` → `recienBloqueada`. Sin cambios de comportamiento |
| D4 — mensaje de sesión | `withSesionClienteWeb(handler, { mensajeSinSesion })`: por defecto "Debe iniciar sesión para continuar"; `checkout/route.ts` pasa "Debe iniciar sesión para completar la compra". El 401 de la baja toma el texto genérico. Test "§4.3 — mensajes exactos de CUENTA_BLOQUEADA (423) y SESION_CLIENTE_WEB_REQUERIDA (401)" |
| D5 | Estado de los hallazgos del Verify y nota de variables de entorno en `HU1_MODULO_E.md` §9.1 (aditiva, 2 líneas) |
| N1 — refresco por la cuenta buscada | Estado `dniBuscado`, que se guarda en `buscar()`: tras validar, `consultar` refresca con ese DNI y no con el valor actual del campo (evitaba mostrar el código de una cuenta junto a la ficha de otra). Editar el campo DNI (`editarDni`) limpia cuenta, código, error y formulario de reasignación |

### Bugs encontrados durante la deuda y la demostración (corregidos en este PR)

| Bug | Causa y corrección |
|---|---|
| **El código de recuperación no llegaba al titular tras una reasignación.** En la pantalla del Vendedor, `buscar()` borraba el código apenas se emitía (`validar()` fijaba el código y luego llamaba a `buscar()`, que hacía `setCodigo(null)`). La reasignación se persistía, pero el Vendedor nunca veía el código. Severidad Alta | Los tests de API pasaban porque nadie probaba la interfaz. Ahora `consultar()` refresca la cuenta sin tocar el código; solo `buscar()` (búsqueda nueva) lo limpia |
| **"Crear cuenta" y "Redefinir contraseña" no tenían `type="submit"`.** Desde la tienda no se podía registrar ni recuperar el acceso (ningún `POST` llegaba al server). Severidad Alta; llegó a `develop` con HU-E8 | El `Button` de `components/ui/button.tsx` envuelve el de `@base-ui/react`, que se renderiza como `type="button"`. Corregido en `FormularioRegistroTienda.tsx` y `FormularioRecuperacionTienda.tsx`. Los demás formularios de E8 no usan `<form>` (`AccionesCuentaTienda.tsx`, `CuentasWebCliente.tsx`) o ya declaraban `type="submit"` (`FormularioIngresoTienda.tsx`) |

Los dos pasaron todos los tests y dos Verify: los encontró la demostración por la interfaz.

## 10. Verificación funcional de punta a punta (demostración en Chrome, 02/10/2026)

`next dev -p 3101` contra la base descartable, secretos efímeros solo en la shell del server, una sola pestaña de Chrome. Usuarios del seed: Vendedor (con el permiso) y Auditor (sin él). Los 9 bloques pasaron:

| # | Verificado | Resultado |
|---|---|---|
| 1 | Visitante navega el catálogo y agrega al carrito sin login; el botón dice "Ingresar para comprar" | OK |
| 2 | Registro con DNI nuevo: casillas sin marcar, éxito sin sesión (el header sigue en "Ingresar"); el login fusiona el carrito de visitante; `/tienda/cuenta` | OK después de corregir `type="submit"` |
| 3 | Registro con DNI de mostrador queda pendiente sin tocar al Cliente; login con aviso; carrito sin compra; las páginas de checkout redirigen a `/tienda/cuenta` | OK |
| 4 | Cinco logins fallidos bloquean (mensaje del 5.º y de la contraseña correcta posterior: 423); en base `intentos_fallidos = 5` y `bloqueada_hasta` vigente | OK |
| 5 | Vendedor: entrada "Cuentas web" en el Sidebar; reasignación con "No lo reconoce" (el código aparece y se queda visible); email ocupado ⇒ error 409 en pantalla y la cuenta sigue pendiente; editar el DNI limpia ficha y código; usuario sin permiso ⇒ sin entrada, "Acceso Denegado" y API `FORBIDDEN` | OK |
| 6 | El titular redefine con email y código; la contraseña del tercero deja de servir; la nueva entra | OK después de corregir `type="submit"` |
| 7 | "Habilitar recuperación" sobre una cuenta vinculada (estado "Bloqueada"); el código se queda | OK |
| 8 | Baja propia con motivo: `PATCH …/baja` 200, sesión cerrada, login posterior 401; el Vendedor ve "Dada de baja" sin acciones | OK |
| 9 | `audit_logs`: 8 eventos `ecommerce:cuenta_web_*` de la demo (`registrada` ×2, `bloqueada`, `vinculada` con `acceso_reasignado: true`, `recuperacion_habilitada` ×2, `password_redefinida`, `baja`); 0 de 8 con contraseñas, hash, digest o códigos | OK |

## 11. Eventos auditados

Los seis se emiten con `domainEventBus.emit()` **después del COMMIT**; `audit-log.listener.ts` (un handler explícito por evento) es la única vía de escritura al `AuditLog` (`tabla_afectada: cuentas_cliente_web`). Los tipos están en `src/lib/events/event-types.ts`.

Payload base: `{ cuenta_id, cliente_id, actor_tipo: "cuenta" | "usuario", actor_id, ocurrido_en }`.

| Evento | Actor | Payload adicional |
|---|---|---|
| `ecommerce:cuenta_web_registrada` | cuenta | `vinculacion_pendiente`, `acepta_tratamiento`, `acepta_comunicaciones` |
| `ecommerce:cuenta_web_bloqueada` | cuenta | `intentos`, `bloqueada_hasta` |
| `ecommerce:cuenta_web_vinculada` | Vendedor (`usuario`) | `acceso_reasignado` |
| `ecommerce:cuenta_web_recuperacion_habilitada` | Vendedor (`usuario`) | `expira_en` |
| `ecommerce:cuenta_web_password_redefinida` | cuenta | — |
| `ecommerce:cuenta_web_baja` | cuenta | `motivo` |

Nunca se incluyen contraseña, hash, JWT, código ni digest (verificado por test sobre el `AuditLog` y por la demostración). El usuario "Canal Web" figura solo como autor técnico del alta en Módulo C; el actor real queda en el evento. La cadena SHA-256 del `AuditLog` permaneció íntegra (`verificarCadenaIntegridad()` ⇒ `integra: true`).

## 12. Cómo correr las pruebas

Scripts (`package.json`): `test:integration:e8` (servicio contra PostgreSQL) y `test:integration:e8-http` (HTTP). Los unitarios de E8 (`registro-cuenta-web.reglas.test.ts`, `cuenta-cliente-web.schema.test.ts`) corren con `npm test`.

Variables de las suites (solo nombres; nunca valores ni secretos en archivos):

| Variable | Suite | Para qué |
|---|---|---|
| `HU_E8_INTEGRATION_DATABASE_URL` | `e8` y `e8-http` | Base **descartable** donde el test prepara y verifica su estado |
| `HU_E8_INTEGRATION_BASE_URL` | `e8-http` | URL del servidor de test |
| `DATABASE_URL` | servidor de `e8-http` | Debe apuntar a la **misma** base que `HU_E8_INTEGRATION_DATABASE_URL` |
| `JWT_SECRET_CLIENTE_WEB`, `CARRITO_COOKIE_SECRET` | servidor de `e8-http` | 64 hex cada una, distintas de `JWT_SECRET` |
| `MP_MODO=simulado`, `APP_PUBLIC_URL` | servidor de `e8-http` | Obligatorias desde HU-E2 (el checkout crea la preferencia) |

```bash
# Base descartable migrada y sembrada (el seed crea las claves ECOMMERCE_CUENTA_WEB_*)
export TEST_DB="<url de la base descartable>"
DATABASE_URL=$TEST_DB npx prisma migrate deploy && DATABASE_URL=$TEST_DB npx prisma db seed

npm test
HU_E8_INTEGRATION_DATABASE_URL=$TEST_DB npm run test:integration:e8

# HTTP: servidor APARTE sobre la misma base (next dev, NO next start), en otra terminal.
# JWT_SECRET_CLIENTE_WEB y CARRITO_COOKIE_SECRET exportadas solo en esa shell.
DATABASE_URL=$TEST_DB MP_MODO=simulado APP_PUBLIC_URL=http://localhost:3101 npx next dev -p 3101
HU_E8_INTEGRATION_BASE_URL=http://localhost:3101 HU_E8_INTEGRATION_DATABASE_URL=$TEST_DB npm run test:integration:e8-http
```

Los secretos que también usa E1 y la advertencia de que las suites HTTP **modifican** la base a la que apunta el servidor están en `HU1_MODULO_E.md` §9.1 (no se duplican acá). Regresión obligatoria: `test:integration:e1` y `test:integration:e1-http`.

Resultados en `HEAD` de `fix/HU-E8-deuda` (corrida del Verify de la deuda, 02/10/2026; no re-ejecutados al redactar este documento): unitarios 511/511 · `test:integration:e8` 14/14 · `test:integration:e8-http` 13/13 · `test:integration:e1` 21/21 · `test:integration:e1-http` 15/15 · `tsc --noEmit` 0 · `eslint src prisma/seed.ts` 0 errores (3 warnings preexistentes ajenos) · `next build` OK (68/68). Los conteos de e8 y e8-http incluyen el test contenedor que cuenta el runner (13 y 12 casos respectivamente).

Los tests de configuración modifican temporalmente la fila de `configuraciones_sistema` y la restauran en `finally`. Las pruebas no borran filas de `audit_logs` (el guard lo bloquea).

## 13. Limitación conocida, fuera de alcance y deuda

### 13.1. Limitación conocida (D6): baja definitiva

`cliente_id` y `email` son únicos incluyendo cuentas dadas de baja. Una cuenta dada de baja es **definitiva**: ese DNI y ese email no pueden volver a registrarse, y no existe operación de reactivación en sucursal (por eso `REGISTRO_WEB_NO_DISPONIBLE` no promete una solución presencial). Re-registro o reactivación: **deuda de backlog**.

### 13.2. Fuera de alcance

HU-E4 y E9 (más allá de la guarda de pendientes), F3, pagos, perfil y edición de datos del Cliente desde la web, cambio de email por el titular, baja administrativa, mensajería externa, OAuth, cambios a Módulo C y al algoritmo de fusión de E1.

### 13.3. Deuda que sigue abierta

| Punto | Detalle |
|---|---|
| Costo del hash en la redefinición (N4) | `hashPassword` (Argon2id) corre en cada request de `redefinir-password`, también con cuenta inexistente o bloqueada. Aceptado (como contrapartida, el tiempo de respuesta es parejo entre casos); rate limiting fuera de alcance |
| Sin tests automáticos de la interfaz (N5) | El repo solo tiene render estático (`renderToStaticMarkup`), sin DOM ni eventos, y no se agregaron dependencias. Quedan sin test automático la pantalla del Vendedor y los formularios de la tienda. Deuda técnica del proyecto; es la causa de que los dos bugs de la sección 9 pasaran las suites |
| `HU1_MODULO_E.md` §9.1 (N2) | La nota de variables vive en el documento de cierre de E1 (aditiva, 2 líneas), porque la suite HTTP de E1 también necesita esos secretos. Su dueño está avisado y de acuerdo |
| La carrera de H1 no se reproduce en integración | Está cubierta solo por la regla unitaria `resolverClienteCreadoEnRegistro` |
| Comentarios `TODO(HU-E8)` | `login/route.ts` y `logout/route.ts` conservan el encabezado "wrapper provisional" de HU-E1, ya desactualizado |

### 13.4. Observaciones para otros equipos

- **HU-E1 (Chiki):** posible carrera cuando dos carritos de visitante se fusionan a la vez sobre el mismo destino (`fusionarCarritoVisitante`). No se tocó: la fusión es de E1 y E8 solo garantiza que una cuenta pendiente no fusiona y que una vinculada sigue fusionando como antes. Archivos de E1 que E8 sí modificó: `sesion-cliente-web.ts`, `login/route.ts`, `contexto-tienda.ts`, `configuracion.service.ts`, `tienda/checkout/route.ts` (solo en el PR de deuda), las páginas `checkout/pendiente`, `checkout/resultado`, `carrito`, `ingresar`, y `CarritoCliente.tsx` / `FormularioIngresoTienda.tsx`.
- **Módulo C (owner):** informativo; E8 consume `crearClienteTx` con el usuario "Canal Web" y no cambia nada de C. El tratamiento de datos registrado por el alta web queda con alcance `VENTA_ASISTIDA`, cuyo nombre no describe el canal web. Para la spec de C.

## 14. Lecciones de proceso

1. **Correr `next build` en el Verify:** `tsc` no detecta los exports inválidos de un `route.ts` (sección 8.3).
2. **Un test debe demostrar que falla sin el código que protege** (caso CA09/H2): el test original pasaba aunque se quitara la guarda.
3. **Las migraciones escritas a mano se validan con `prisma migrate diff`** contra una base shadow descartable.
4. **Las pantallas se prueban en el navegador o con tests de UI:** los tests de API no detectan bugs de interfaz. Los casos `buscar()` y `type="submit"` pasaron tests y dos Verify; los encontró la demostración.

## 15. Archivos de la implementación

**Nuevos**

- `prisma/migrations/20261002170000_hu_e8_cuenta_cliente_web_recuperacion/migration.sql`
- `src/lib/services/ecommerce/cuenta-cliente-web.service.ts`
- `src/lib/services/ecommerce/registro-cuenta-web.reglas.ts` (+ `.test.ts`)
- `src/lib/schemas/cuenta-cliente-web.schema.ts` (+ `.test.ts`)
- `src/lib/auth/permisos-ecommerce.ts`
- `src/app/api/tienda/cuenta/{registro,redefinir-password,baja}/route.ts`
- `src/app/api/ecommerce/cuentas-web/route.ts`, `…/[id]/validar-vinculacion/route.ts`, `…/[id]/habilitar-recuperacion/route.ts`
- `src/app/(tienda)/tienda/{registrarse,recuperar,cuenta}/page.tsx`
- `src/app/(dashboard)/ecommerce/cuentas-web/page.tsx`
- `src/components/ecommerce/CuentasWebCliente.tsx`
- `src/components/tienda/{FormularioRegistroTienda,FormularioRecuperacionTienda,AccionesCuentaTienda}.tsx`
- `src/lib/services/ecommerce/hu-e8.integration.test.ts`, `hu-e8.http.integration.test.ts`

**Modificados**

- `prisma/schema.prisma`, `prisma/seed.ts`, `package.json` (scripts `test:integration:e8` y `test:integration:e8-http` y los dos unitarios en `npm test`)
- `src/lib/auth/sesion-cliente-web.ts` (sesión con `vinculacionPendiente`, `getSesionClienteWebVinculada()`, opciones `permitirPendiente` y `mensajeSinSesion`)
- `src/app/api/tienda/cuenta/login/route.ts`; `src/app/api/tienda/checkout/route.ts` (solo en el PR de deuda: opción `mensajeSinSesion`)
- `src/lib/services/ecommerce/contexto-tienda.ts`, `src/lib/services/sistema/configuracion.service.ts`
- `src/lib/events/event-types.ts`, `src/lib/events/listeners/audit-log.listener.ts`
- `src/app/(tienda)/tienda/{ingresar,carrito}/page.tsx`, `…/checkout/{pendiente,resultado}/page.tsx`
- `src/components/tienda/{FormularioIngresoTienda,CarritoCliente}.tsx`, `src/components/layout/Sidebar.tsx` (entrada "Cuentas web" con el permiso)
- `docs/modulos/modulo E/HU1_MODULO_E.md` (§9.1, nota aditiva)

**No se tocan:** Módulo C (`services/clientes`), el algoritmo de fusión de `carrito.service.ts`, `services/auditoria`, POS de Módulo B. Ningún `DELETE` ni `deleteMany`; sin dependencias nuevas.
