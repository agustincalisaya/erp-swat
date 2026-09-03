# HU-A8 — Edición de atributos operativos de Producto Maestro y Variante
## Documento de traspaso — todo lo trabajado en esta HU

**Estado general:** Completa y verificada end-to-end (backend por curl/Postman, frontend con browser automation real). Dos bugs reales encontrados durante la prueba final, ambos corregidos y re-verificados. Queda pendiente de decisión un ajuste de UX menor y una definición sobre un archivo modificado fuera de alcance (ver Parte 6).

**Metodología:** Specification-Driven Development (SDD) con Claude Code, sobre `task_HU-A8.md` (backend) más una extensión de frontend acordada en el camino (no estaba en el documento de tarea original, se armó prompt a prompt).

**Rama:** `feature/HU-A8-edicion-atributos-operativos`, sobre `HU-A1` ya mergeada.

---

## Parte 1 — Qué se implementó

### 1.1. Alcance funcional

Edición de atributos comerciales/logísticos de un `ProductoMaestro` y de atributos operativos de una `VarianteSKU`, **sin tocar nunca** las 4 dimensiones que componen el `sku` (talle, color, género, modelo) ni el `sku` mismo — eso sigue siendo inmutable por diseño (dar de baja y crear de nuevo, ya implementado en HU-A1/HU-A6).

**Campos editables de `ProductoMaestro`:** `nombre`, `descripcion`, `categoria`, `rubro`, `unidad_medida`, `proveedor_preferente`, `costo_estandar_referencia`. Explícitamente fuera: `codigo_producto` (es el segmento `[PRODUCTO]` del SKU ya impreso en las etiquetas).

**Campos editables de `VarianteSKU`:** `ean_qr`, `proveedor_id`. Explícitamente fuera: `talle`, `color`, `genero`, `modelo`, `sku`.

### 1.2. Decisiones de diseño tomadas (confirmadas por el dueño de la HU, no reabrir)

- **"Ubicación física en depósito"** (pedida por el Backlog): excluida del alcance — no existe ningún campo así en `schema.prisma` (ni en `VarianteSKU` ni en `StockDeposito`), y la spec tampoco la incluía. Queda como pregunta abierta al PO a futuro, no bloqueante.
- **Ruta de edición de Producto Maestro:** subruta nueva `PATCH /api/inventario/productos/[id]/editar` (no se tocó `PATCH /api/inventario/productos/[id]`, que ya hace baja lógica desde HU-A1). Asimetría a propósito respecto de Variante (ahí la baja está en la subruta y la edición en la raíz) — es la única forma de no romper un endpoint ya mergeado.
- **No retroactividad de costeo:** no se construyó ningún mecanismo de congelamiento de costo por movimiento (no existe tal tabla ni campo en `MovimientoStockItem` hoy). Queda un TODO documentado en el docstring de `editarProductoMaestro()` para cuando se construya un reporte de valorización histórica real — ese reporte va a necesitar leer el costo vigente al momento del movimiento, no el `costo_estandar_referencia` actual.
- **Naming de eventos:** se siguió el prefijo real ya usado por entidad (`producto_maestro:actualizado`, `inventario:variante_actualizada`), no el nombre literal que proponía la spec.
- **Permisos:** mismo patrón real del resto del código (rol por nombre, no `withPermission` por código) — dos funciones nuevas, `usuarioPuedeEditarProductoMaestro()` y `usuarioPuedeEditarVariante()`, ambas con la lista `["ADMINISTRADOR", "ENCARGADO_DEPOSITO"]`.
- **`proveedor_id` en Variante:** SÍ se valida contra `Proveedor.is_active` antes de guardar (la spec no lo exigía, pero no lo impedía; se decidió validarlo para no dejar cargar un id que apunta a nada).

### 1.3. Backend

| Pieza | Archivo | Detalle |
|---|---|---|
| Schemas Zod | `lib/schemas/inventario.schema.ts` | `EditarProductoMaestroSchema`, `EditarVarianteOperativaSchema` — ambos `.strict()`, rechazan cualquier campo no reconocido (incluidas las dimensiones del SKU) |
| Servicios | `lib/services/inventario/producto.service.ts` | `editarProductoMaestro()`, `usuarioPuedeEditarProductoMaestro()`, `obtenerProductoMaestroParaEdicion()` |
| Servicios | `lib/services/inventario/variante.service.ts` | `editarVarianteOperativa()`, `usuarioPuedeEditarVariante()`, `obtenerVarianteParaEdicion()`, `buscarVariantesActivas()` |
| Eventos | `lib/events/event-types.ts` | `ProductoMaestroActualizadoPayload`, `VarianteActualizadaPayload` + entradas en `DomainEventMap` |
| Auditoría | `lib/events/listeners/audit-log.listener.ts` | 2 handlers nuevos, conectados desde el vamos (a diferencia de HU-A1, donde los eventos quedaron sin consumidor — ver Parte 6) |
| Route Handlers | `app/api/inventario/productos/[id]/editar/route.ts` | PATCH, nuevo |
| Route Handlers | `app/api/inventario/variantes/[id]/route.ts` | PATCH, nuevo |
| Server Actions | `app/(dashboard)/inventario/productos/actions.ts` | `editarProductoMaestro()`, `obtenerProductoMaestroParaEdicion()` — shape `{data, error}` (mismo criterio que sus vecinas del archivo) |
| Server Actions | `app/(dashboard)/inventario/variantes/actions.ts` | `editarVarianteOperativaAction()`, `obtenerVarianteParaEdicionAction()`, `buscarVariantesActivasAction()` — shape `ActionResult<T>` `{success, data?, error?}` (mismo criterio que sus vecinas de ese archivo) |

**Nota de convención (útil para quien retome esto):** los dos archivos de Server Actions usan shapes de retorno distintos entre sí, cada uno siguiendo su propio precedente — no es un descuido, es la regla que se fijó explícitamente durante esta HU: "cada archivo sigue su propio precedente, no mezclar estilos". Además, cuando el nombre de una Server Action coincide con el de la función de servicio que llama (caso de `productos/actions.ts`, sin sufijo), el import de la función de servicio se alias con sufijo `Service` (ej. `obtenerProductoMaestroParaEdicionService`) para evitar colisión de nombres — patrón ya usado antes en ese mismo archivo (`crearProductoMaestroService`, `editarProductoMaestroService`, etc.).

### 1.4. Frontend (no estaba en el `task_HU-A8.md` original — se definió en el camino)

| Componente | Archivo | Función |
|---|---|---|
| Buscador de variante | `components/inventario/BuscadorVarianteExistente.tsx` | Combobox de búsqueda por texto (SKU/talle/color/género/modelo), calcado de `BuscadorProductoExistente.tsx` |
| Dialog de edición — Producto | `components/inventario/EditarProductoMaestroDialog.tsx` | Botón "Editar" junto a "Nuevo Producto Maestro" → busca → carga detalle → formulario |
| Formulario de edición — Producto | `components/inventario/FormularioEditarProductoMaestro.tsx` | react-hook-form + zodResolver, diff-only submit |
| Dialog de edición — Variante | `components/inventario/EditarVarianteDialog.tsx` | Botón "Editar" junto a "Agregar variante" → busca → carga detalle → formulario |
| Formulario de edición — Variante | `components/inventario/FormularioEditarVariante.tsx` | Mismo patrón, solo 2 campos (`ean_qr`, `proveedor_id`) |

Todos calcados de patrones reales ya existentes en el proyecto (Dialog de `components/ui/dialog.tsx`, react-hook-form + zodResolver de `FormularioProductoMaestro.tsx`, `Alert`/`FormMessage` en vez de un sistema de toast que no se usa en ningún lado del proyecto) — nada de esto introdujo un patrón de UI nuevo.

---

## Parte 2 — Qué NO se hizo (fuera de alcance, a propósito)

- **No hay campo de "ubicación física en depósito"** — decisión explícita, ver 1.2.
- **No hay mecanismo de congelamiento de costo histórico** — decisión explícita, ver 1.2. Queda un TODO en código para cuando exista un reporte de valorización real.
- **No se puede "vaciar" explícitamente un `ean_qr` o `proveedor_id` ya cargado de vuelta a `null`** desde el formulario de edición de Variante. Comportamiento verificado: si se borra el input a blanco y se guarda, el `diff` calculado sí intenta mandar `{ean_qr: undefined}`, pero esa clave se pierde en la serialización de la Server Action (mismo comportamiento que `JSON.stringify` con `undefined`), así que el servidor no recibe la clave y no cambia nada — el valor viejo queda intacto. Es una limitación conocida y aceptada: haría falta `.nullable()` en el schema para soportar un "borrado" explícito, y eso quedó fuera de alcance de esta HU.
- **No se tocó la lógica de generación de SKU/variantes** (`generarVariantesMatriz()`, `generarSku()`) ni la baja lógica existente de HU-A1/HU-A6 — solo consumo.
- **No se construyó ninguna pantalla de listado/CRUD completo** — el alcance es puntual: buscar uno, editarlo.
- **No se validó el submit completo del wizard de alta de HU-A1 durante la regresión** (se verificó que la pantalla renderiza igual, sin errores de consola, pero no se envió el formulario para no ensuciar la base de datos de prueba antes del commit).

---

## Parte 3 — Bugs encontrados y corregidos durante la prueba final

Ambos se encontraron con browser automation real (no con lectura de código ni con un resumen narrado), en la ronda de pruebas pedida antes de comitear.

**Bug 1 — Bloqueante:** `FormularioEditarVariante.tsx` precargaba `ean_qr`/`proveedor_id` como `""` cuando el valor real en la base era `null` (que es el estado por defecto de casi todas las variantes del seed). Como `EditarVarianteOperativaSchema` exige formato válido (regex de 13 dígitos / UUID) *si el campo está presente*, y `""` cuenta como "presente" para Zod, la validación del cliente rechazaba **cualquier** guardado que no tocara esos dos campos — bloqueaba editar una variante para cambiar solo `proveedor_id`, por ejemplo. Corregido: precarga con `?? undefined` en vez de `?? ""`, más un `onChange` explícito en ambos campos que vuelve a convertir un borrado manual a `undefined`. Verificado: guardar tocando un solo campo funciona, el happy path (escribir un EAN nuevo desde cero) no tuvo regresión.

**Bug 2 — No bloqueante (gap de consistencia):** el botón "Editar" se mostraba en ambas pantallas para cualquier usuario logueado, sin importar su rol — a diferencia del resto del código, que sí oculta controles según permiso (`ModalJustificacionBaja` con `puedeBajar` en `variantes/page.tsx`, el botón "Editar" de `TablaProveedores.tsx`). El backend ya bloqueaba correctamente el guardado (403 `FORBIDDEN`), así que no era una falla de seguridad, pero un usuario sin permiso podía abrir el diálogo, buscar, ver el formulario precargado con datos reales, y recién al tocar "Guardar" enterarse de que no puede. Corregido: mismo mecanismo que `puedeBajar` — `usuarioPuedeEditarProductoMaestro()`/`usuarioPuedeEditarVariante()` evaluados en los Server Components (`productos/page.tsx`, `variantes/page.tsx`) y pasados como prop hasta los botones. Verificado con AUDITOR (botón ausente) y ENCARGADO_DEPOSITO (botón presente, sin regresión).

---

## Parte 4 — Resumen de pruebas

| Frente | Resultado |
|---|---|
| Backend — Producto Maestro (PATCH .../editar) | ✅ Happy path, payload vacío (no-op), campo inmutable rechazado por `.strict()`, costo negativo, nombre duplicado (409), nombre igual al propio (200, no falso positivo), id inexistente (404), rol sin permiso (403), sin sesión (401) |
| Backend — Variante (PATCH .../[id]) | ✅ Happy path, payload vacío, campos inmutables rechazados, EAN inválido (400), proveedor inexistente (404), EAN duplicado (409), id inexistente (404), rol sin permiso (403) |
| Frontend — Producto Maestro | ✅ 9/9 pasos (buscador, debounce, precarga, guardado exitoso con refresh, validación inline, error de duplicado como alert general, "Elegir otro", reapertura limpia) |
| Frontend — Variante | ✅ Los mismos 9 pasos adaptados + 2 casos de campos null (bug 1, ver Parte 3) + validación de formato inválido bloqueada en cliente (0 requests de red) |
| Rol sin permiso (frontend) | ✅ Antes del fix del bug 2: backend bloqueaba pero el botón se mostraba igual. Después del fix: el botón directamente no aparece |
| Regresión — Wizard de alta HU-A1 | ✅ Renderiza igual, sin errores de consola (submit completo no ejecutado para no ensuciar la base) |

Todos los datos de prueba quedaron restaurados a los valores originales del seed al finalizar cada ronda.

---

## Parte 5 — Archivos modificados y creados (estado final antes del commit)

**Modificados (12):**

| Archivo | Cambio |
|---|---|
| `CLAUDE.md` | Modificado por tooling (`next dev`, agent rules) — **no es un cambio intencional de esta HU**, ver Parte 6 |
| `src/components/inventario/BuscadorProductoExistente.tsx` | + prop opcional `label` (default `"¿El producto ya existe?"`, preserva el comportamiento del flujo original de `/inventario/productos/variantes/nueva`) — agregada para que `EditarProductoMaestroDialog.tsx` pueda mostrar un texto propio sin duplicar el componente |
| `src/app/(dashboard)/inventario/productos/actions.ts` | + `editarProductoMaestro()`, `obtenerProductoMaestroParaEdicion()` |
| `src/app/(dashboard)/inventario/productos/page.tsx` | + chequeo `puedeEditar` (con guard de `redirect` previo) y prop a `ListadoProductos` |
| `src/app/(dashboard)/inventario/variantes/actions.ts` | + `editarVarianteOperativaAction()`, `obtenerVarianteParaEdicionAction()`, `buscarVariantesActivasAction()` |
| `src/app/(dashboard)/inventario/variantes/page.tsx` | + chequeo `puedeEditar`, botón `EditarVarianteDialog` junto a "Agregar variante" |
| `src/components/inventario/ListadoProductos.tsx` | + botón `EditarProductoMaestroDialog` junto a "Nuevo Producto Maestro", + prop `puedeEditar` |
| `src/lib/events/event-types.ts` | + `ProductoMaestroActualizadoPayload`, `VarianteActualizadaPayload`, entradas en `DomainEventMap` |
| `src/lib/events/listeners/audit-log.listener.ts` | + 2 handlers (`producto_maestro:actualizado`, `inventario:variante_actualizada`) |
| `src/lib/schemas/inventario.schema.ts` | + `EditarProductoMaestroSchema`, `EditarVarianteOperativaSchema` |
| `src/lib/services/inventario/producto.service.ts` | + `editarProductoMaestro()`, `usuarioPuedeEditarProductoMaestro()`, `obtenerProductoMaestroParaEdicion()` |
| `src/lib/services/inventario/variante.service.ts` | + `editarVarianteOperativa()`, `usuarioPuedeEditarVariante()`, `obtenerVarianteParaEdicion()`, `buscarVariantesActivas()`, helper `esErrorPrismaP2002()` |

**Nuevos (7):**

- `src/app/api/inventario/productos/[id]/editar/route.ts`
- `src/app/api/inventario/variantes/[id]/route.ts`
- `src/components/inventario/BuscadorVarianteExistente.tsx`
- `src/components/inventario/EditarProductoMaestroDialog.tsx`
- `src/components/inventario/EditarVarianteDialog.tsx`
- `src/components/inventario/FormularioEditarProductoMaestro.tsx`
- `src/components/inventario/FormularioEditarVariante.tsx`

`tsc --noEmit` y ESLint sobre todo el proyecto: 0 errores. 4 warnings preexistentes en `prisma/seed.ts` y `ConsolaDepositoProductos.tsx`, confirmados ajenos a esta rama.

---

## Parte 6 — Pendientes y avisos al equipo

- [x] **Fix de UX resuelto:** `BuscadorProductoExistente.tsx` tenía un `<Label>` fijo ("¿El producto ya existe?") pensado para el flujo original de alta de producto (mejora post-HU-A1), que aparecía también dentro de `EditarProductoMaestroDialog.tsx` sin sentido ahí. Se agregó una prop opcional `label` (default `"¿El producto ya existe?"`, preserva el flujo original) y `EditarProductoMaestroDialog.tsx` le pasa `label="Seleccione el Producto Maestro que desea editar"`. **Verificado con browser real en ambos flujos** (no solo por lectura de código): `/inventario/productos/variantes/nueva` sigue mostrando el texto original sin haberse tocado ese archivo (confirmado con `git diff` vacío), y el dialog de edición muestra el texto nuevo. Nota lateral: en el camino se detectó que alguien había editado el string fijo directamente a mano en el componente compartido antes de aplicar el fix correcto — quedó revertido, sin rastro.
- [ ] **Avisar a quien tome HU-A9** (reclasificación de devueltos): esta rama tocó `variante.service.ts`. No es un bloqueante técnico, es cortesía de equipo si arrancan en paralelo (ya estaba anotado en el `task_HU-A8.md` original).
- [ ] **Hallazgo lateral para dejar registrado:** el placeholder `"PEND-" + sku` para `ean_qr` (documentado en `prompts_HU-A1_mejoras.md`, Prompt A) **no existe en el código real actual** — existió en el commit `7792e89` de HU-A1 y fue removido en algún punto posterior. Hoy `ean_qr` queda simplemente en `null` cuando no se escaneó nada al crear la variante (confirmado con grep sobre todo `src/` y con el fragmento real de `generarVariantesMatriz()`). Si alguien retoma la idea del QR imprimible por variante (Prompt A, que en su momento se había implementado y después se descartó por decisión de equipo — ver `HU-A1_TRASPASO_COMPLETO.md` §2.5), va a necesitar partir de esta premisa corregida, no de la que quedó escrita en el documento de mejoras.
- [ ] **Limitación conocida, no bloqueante:** no hay forma de volver a poner en `null` un `ean_qr`/`proveedor_id` ya cargado desde el formulario de edición (ver Parte 2). Si en algún momento se necesita, hay que agregar `.nullable()` a `EditarVarianteOperativaSchema` y ajustar el manejo del diff — no es difícil, pero es un cambio de contrato que hay que decidir a propósito, no colar de paso.
- [ ] **Pregunta abierta heredada de la spec, no bloqueante:** "ubicación física en depósito" (Backlog) sigue sin campo en el modelo de datos — ver 1.2. Queda para el PO a futuro.
- [ ] **A diferencia de HU-A1:** los eventos de dominio de esta HU sí quedaron conectados a `audit-log.listener.ts` desde el vamos — no repetir el gap de HU-A1 (eventos emitidos sin consumidor) en HUs futuras.
