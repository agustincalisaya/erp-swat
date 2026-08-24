# HU-A7 — Auditoría Forense de Inventario (Módulo A)

> Documentación técnica de implementación · ERP SWAT Indumentarias

---

## Resumen Arquitectónico

La HU-A7 implementa la consola de auditoría forense del Módulo A (Inventario) siguiendo
el patrón híbrido RSC + Server Actions del App Router de Next.js. La página es de
**solo lectura** (append-only); no expone ninguna mutación de datos.

### Archivos generados

| Archivo | Tipo | Responsabilidad |
|---|---|---|
| `src/lib/crypto/aes.ts` | Módulo | Cifrado/descifrado AES-256-GCM |
| `src/lib/schemas/inventario-auditoria.schema.ts` | Zod | Validación de filtros y payload reveal |
| `src/lib/services/inventario/auditoria.service.ts` | Service | Lógica de negocio: listado, verificación SHA-256, reveal |
| `src/app/(dashboard)/inventario/auditoria/actions.ts` | Server Actions | Verificar cadena · Revelar dato sensible |
| `src/components/inventario/auditoria/TablaForenseInventario.tsx` | Client Component | Tabla con búsqueda URL-driven y botón de verificación |
| `src/components/inventario/auditoria/DatoCifradoViewer.tsx` | Client Component | Botón reveal con audit trail automático |
| `src/app/(dashboard)/inventario/auditoria/page.tsx` | RSC (page) | Resolución de sesión, RBAC, carga inicial de datos |

### Diagrama de capas

```
Browser
  │
  ├─ TablaForenseInventario (Client Component)
  │    ├─ useRouter → ?q=term → page reload (búsqueda server-side)
  │    └─ verificarIntegridadAction() → Server Action
  │
  ├─ DatoCifradoViewer (Client Component)
  │    └─ revelarDatoSensibleAction() → Server Action
  │
  └─ page.tsx (RSC)
       ├─ getServerSession() → check revocación
       ├─ usuarioTienePermiso("auditoria:leer_forense")
       └─ obtenerLogsInventario(filtros, sesion, q) → Prisma
```

---

## Flujo de Seguridad

### CA 1 — RBAC y Append-Only

El acceso al módulo está **triple-gate**:

1. **Middleware (`proxy.ts`):** valida firma JWT y expiración criptográfica.
2. **RSC `page.tsx`:** llama a `getServerSession()` (verifica revocación en BD) y
   `usuarioTienePermiso("auditoria:leer_forense")`. Si falla, renderiza un `<Alert>`
   de acceso denegado sin redirect a ruta externa.
3. **Service `obtenerLogsInventario`:** verifica el permiso nuevamente como barrera
   final antes de ejecutar cualquier query Prisma.

La interfaz no expone ningún botón de UPDATE o DELETE. El único Server Action mutante
es `revelarDatoSensibleAction`, que **inserta** un nuevo `LECTURA_SENSIBLE` en el
ledger (operación append-only compatible).

### CA 2 — Filtrado Server-Side

```
Usuario escribe en <Input> → debounce 350ms
  → router.push(?q=term&page=reset)
  → RSC re-renderiza
  → obtenerLogsInventario recibe q
  → Prisma: WHERE (accion ILIKE %q% OR tabla_afectada ILIKE %q% OR registro_id ILIKE %q%)
  → resultados reales desde BD, no filtro en memoria
```

El parámetro `q` es truncado a 100 caracteres en el RSC antes de pasar al servicio,
previniendo abusos sobre el `ILIKE` de PostgreSQL.

### CA 3 — Verificación SHA-256 (Trazabilidad Forense)

El algoritmo en `verificarCadenaHashesInventario` reconstruye la cadena en memoria
sin confiar en los valores almacenados en BD:

```
seed ← registros[0].hash_anterior   // punto de anclaje a la cadena global

PARA CADA registro (ASC por created_at):
  1. ASSERT registro.hash_anterior === hashAnteriorEsperado
     → si falla: el puntero fue manipulado en BD
  2. hashRecalculado ← SHA-256(canonical_json(payload) + hashAnteriorEsperado)
     ASSERT registro.hash_actual === hashRecalculado
     → si falla: el payload del registro fue alterado
  3. hashAnteriorEsperado ← registro.hash_actual   // acumular
```

La canonicalización JSON (orden de claves alfabético) en `hash-chain.ts` garantiza
determinismo frente al reordenamiento de claves que PostgreSQL JSONB realiza en
columnas `valor_anterior`/`valor_nuevo`.

### CA 4 — Cumplimiento Ley 25.326 (Descifrado + Autolog Indisoluble)

```
revelarDatoSensibleAction(payload)
  1. Verifica sesión y permiso auditoria:leer_forense
  2. Valida payload con RevelarDatoSensibleSchema (Zod)
  3. Extrae IP del header x-forwarded-for
  4. registrarAccesoDatoSensible(legajoPruebaId, campo, userId, ip)
       a. prisma.legajoPrueba.findUnique(...)   → en memoria
       b. decrypt(campoCifrado)                 → AES-256-GCM en memoria
       c. registrarAuditLog(LECTURA_SENSIBLE)   → INSERT en AuditLog
       d. return { campo, valor_descifrado }    ← SOLO si c) no lanzó
  5. { success: true, data: { valor_descifrado } }  → cliente
```

El valor descifrado **nunca persiste**: vive en memoria durante la duración de la
Server Action y se retorna en el payload de respuesta. Si `registrarAuditLog` lanza,
el catch de la action retorna `{ success: false }` y el cliente nunca recibe el dato.

#### Módulo AES-256-GCM (`src/lib/crypto/aes.ts`)

- **Algoritmo:** AES-256-GCM (AEAD — autenticación integrada sin HMAC adicional)
- **IV:** 12 bytes aleatorios (CSPRNG) generados por operación — imposibilita ataques de repetición
- **AuthTag:** 16 bytes — GCM verifica integridad en `decipher.final()`, lanza si el ciphertext fue modificado
- **Formato wire:** `Base64( IV[12] ‖ AuthTag[16] ‖ Ciphertext )`
- **Clave:** leída de `ENCRYPTION_KEY_LEGAJOS` en runtime (no en module-load), validando longitud y formato hex

```bash
# Generar clave de producción
openssl rand -hex 32
```

---

## Guía de Pruebas

### Prerequisitos

```bash
# Variable de entorno requerida (en .env)
ENCRYPTION_KEY_LEGAJOS=<output de openssl rand -hex 32>

# Seed de permisos
npx prisma db seed

# Servidor de desarrollo
npm run dev
```

### Test Manual 1 — Control de Acceso

1. Iniciar sesión con un usuario **sin** el rol `AUDITOR`.
2. Navegar a `/inventario/auditoria`.
3. **Resultado esperado:** renderiza `<Alert>` "No tenés el permiso necesario..." sin exponer datos.
4. Iniciar sesión con un usuario con rol `AUDITOR` y repetir.
5. **Resultado esperado:** tabla de eventos visible.

### Test Manual 2 — Búsqueda Server-Side

1. Acceder a `/inventario/auditoria` con rol `AUDITOR`.
2. Escribir `CREATE` en el campo de búsqueda y esperar 350ms.
3. **Resultado esperado:** la URL cambia a `?q=CREATE`, la tabla se recarga mostrando solo eventos de tipo `CREATE`. El filtro opera sobre el total del ledger, no sobre los 25 registros de la página actual.

### Test Manual 3 — Verificación SHA-256

1. Hacer clic en **"Verificar integridad SHA-256"**.
2. **Resultado esperado (cadena íntegra):** `Alert` verde — "Cadena íntegra. Se verificaron N evento(s)".
3. Modificar manualmente un campo (`accion`) de un `AuditLog` vía Prisma Studio.
4. Repetir la verificación.
5. **Resultado esperado (cadena comprometida):** `Alert` rojo — "¡Cadena comprometida! Ruptura detectada después de N evento(s). Primer registro divergente: `<uuid>`".

### Test Manual 4 — Reveal de Dato Sensible (Ley 25.326)

1. Localizar una fila de tabla `legajos_prueba` con acción `CREATE`.
2. Hacer clic en el ícono 👁 (Revelar placa).
3. **Resultado esperado:** el valor descifrado aparece en amber. En Prisma Studio, un nuevo registro `LECTURA_SENSIBLE` es visible en `AuditLog` con el `campo_accedido` correcto. El `valor_nuevo` del log **no contiene** el texto plano.
4. Recargar la página.
5. **Resultado esperado:** el campo vuelve a mostrar `***-oculto-***` (el estado de reveal no persiste en el servidor).

---

## Variables de Entorno

| Variable | Requerida | Descripción |
|---|---|---|
| `ENCRYPTION_KEY_LEGAJOS` | ✅ Sí | Clave AES-256 hex de 64 chars. Generar con `openssl rand -hex 32`. |
| `DATABASE_URL` | ✅ Sí | URL de conexión PostgreSQL. |

---

---
---

# Pull Request — GitHub

```markdown
## feat(inventario): HU-A7 — Auditoría Forense de Inventario con SHA-256

Closes #11

---

### ¿Qué hace este PR?

Implementa la consola de auditoría forense del **Módulo A (Inventario)**,
incluyendo verificación criptográfica de integridad SHA-256, descifrado
AES-256-GCM bajo demanda y cumplimiento de la Ley N.° 25.326.

---

### Criterios de Aceptación cumplidos

- [x] **CA 1 — RBAC y Append-Only:** Acceso restringido a `auditoria:leer_forense`.
  Triple-gate: middleware JWT → RSC → service. Interfaz de solo lectura.

- [x] **CA 2 — Filtrado Server-Side:** Búsqueda vía `searchParams` → Prisma `ILIKE`.
  Debounce 350ms en el Client Component. Límite de 100 chars para prevenir abusos.

- [x] **CA 3 — Trazabilidad SHA-256:** Verificación matemática forense que regenera
  cada hash en memoria usando el acumulador local, sin confiar en los valores
  almacenados. Detecta y expone el `registro_id` del primer punto de ruptura.

- [x] **CA 4 — Ley 25.326:** Módulo `aes.ts` (AES-256-GCM, IV aleatorio, AuthTag).
  Reveal dispara `LECTURA_SENSIBLE` en la misma cadena SHA-256. El dato descifrado
  nunca persiste y nunca sale al cliente si el audit log falla.

---

### Archivos nuevos

| Archivo | Descripción |
|---|---|
| `src/lib/crypto/aes.ts` | Módulo AES-256-GCM (encrypt / decrypt) |
| `src/lib/schemas/inventario-auditoria.schema.ts` | Zod: filtros y payload reveal |
| `src/lib/services/inventario/auditoria.service.ts` | Service: listado · SHA-256 · reveal |
| `src/app/(dashboard)/inventario/auditoria/actions.ts` | Server Actions |
| `src/app/(dashboard)/inventario/auditoria/page.tsx` | RSC: sesión + RBAC + carga inicial |
| `src/components/inventario/auditoria/TablaForenseInventario.tsx` | Client Component: tabla + búsqueda |
| `src/components/inventario/auditoria/DatoCifradoViewer.tsx` | Client Component: reveal con autolog |

---

### Variables de entorno nuevas

```env
# Requerida en producción — generar con: openssl rand -hex 32
ENCRYPTION_KEY_LEGAJOS=<64 chars hex>
```

> ⚠️ Sin esta variable, el servidor lanza un error explícito al intentar
> descifrar cualquier dato de efectivo. No hay fallback silencioso.

---

### Notas de revisión

- La función `verificarCadenaHashesInventario` verifica la **sub-cadena de
  inventario** dentro del ledger global. La verificación cruzada completa
  (todos los módulos) la provee `verificarCadenaIntegridad()` del Módulo D.
- El seed ya incluye el rol `AUDITOR` con los permisos `auditoria:leer_forense`
  y `auditoria:verificar_cadena`. No se requieren migraciones adicionales.
- Rama: `feature/HU-7-auditoria-forense-sha256`
```
