# HU-A1 — Alta de Producto Maestro y Generación de Variantes (SKU)

**Módulo:** A — Gestión de Inventario y Depósito
**Responsable:** Adriel Ignacio Relos
**Estado:** Completa (backend + frontend), con una mejora post-entrega incorporada en `feature/HU-A1-qr-y-selector-variantes`.

## 1. Objetivo

Dar de alta un `ProductoMaestro` con sus `VarianteSKU` mediante una matriz talle × color × género, para registrar el catálogo completo sin carga manual repetitiva por cada combinación de variante.

**Criterios de aceptación:**

1. El Producto Maestro incluye: nombre, rubro, categoría, unidad de medida, proveedor y costo estándar.
2. La matriz genera automáticamente 30+ variantes por modelo.
3. El SKU se construye determinísticamente: `[PRODUCTO]-[MODELO]-[TALLE]-[COLOR]-[GÉNERO]` (ej. `CAMP-SS3-L-NEG-H`).
4. No se admiten operaciones de stock contra un Producto Maestro sin variante, ni contra uno dado de baja.
5. Baja lógica con motivo obligatorio si hay stock remanente.

## 2. Modelo de datos

```
ProductoMaestro (sin stock propio)
        │ 1 : N
        ▼
VarianteSKU (talle × color × género × modelo — acá vive el stock)
```

**`ProductoMaestro`** (`prisma/schema.prisma`): `id`, `codigo_producto` (2-6 caracteres, segmento `[PRODUCTO]` del SKU, no único a nivel de tabla), `nombre`, `rubro`, `categoria`, `unidad_medida`, `descripcion` (opcional), `proveedor_preferente` (opcional, texto libre), `costo_estandar_referencia` (`Decimal(10,2)`), más los 4 campos estándar de soft delete.

**`VarianteSKU`**: `id`, `producto_maestro_id` (FK, `onDelete: Restrict`), `sku` (`String @unique`), `ean_qr` (`String @unique`, ver Sección 4), `talle`, `color`, `genero`, `modelo`, `proveedor_id` (opcional, stub para Módulo H), más los 4 campos estándar de soft delete.

Talle y color son actualmente texto libre — no existe todavía un catálogo cerrado de colores institucionales con abreviaturas (ej. "Negro Táctico" → `NEG`). Si el usuario tipea el color completo, el SKU sale con el color completo (ej. `CAMP-SS4-M-NEGRO-H` en vez de `...NEG-H`). No es un bug, es un gap de catálogo pendiente.

## 3. Función utilitaria `generarSku()`

`lib/utils/sku.ts` — pura, sin acceso a Prisma, contrato público consumido por el resto del Módulo A:

```typescript
export function generarSku(params: {
  codigoProducto: string;
  modelo: string;
  talle: string;
  codigoColor: string;
  genero: Genero;
}): string
```

Mismos inputs → mismo output, siempre. Formato: `[PRODUCTO]-[MODELO]-[TALLE]-[COLOR]-[GÉNERO]`, todo en mayúsculas.

## 4. Decisión de diseño: `ean_qr`

`VarianteSKU.ean_qr` es `String @unique`, `NOT NULL`. Al generar variantes por matriz no existe todavía un código de barras real de fábrica (la unidad física no existe hasta que se recibe y escanea en depósito, vía HU-A2). Por eso `generarEanQrPlaceholder(sku)` genera un placeholder determinístico: `"PEND-" + sku`.

Esto es intencional, no un descuido — está documentado en el propio código (`lib/utils/sku.ts`) citando `spec_modulo_A.md §2.1`. Ese documento describe un contrato de API distinto (alta atómica de variantes con `ean_qr` real provisto por el cliente, validado como `z.string().length(13)`), que **no es el que se implementó** — el endpoint real es de generación por matriz, con `ean_qr` generado server-side. Ningún validador del código real exige longitud 13, así que no hay ningún bug activo por esto.

**Pendiente de resolver con el equipo/PO:** decidir cuál de los dos contratos (`spec_modulo_A.md` vs. el implementado) es el oficial, antes de que otra HU asuma el que no corresponde.

**TODO de backlog, sin HU asignada todavía:** reemplazar el placeholder por el EAN-13 real cuando la unidad física se escanea por primera vez — candidato natural: el endpoint de ingreso de HU-A2.

## 5. Endpoints y Server Actions

| Acción | Route Handler | Server Action |
|---|---|---|
| Crear Producto Maestro | `POST /api/inventario/productos` | `crearProductoMaestro()` |
| Generar variantes (matriz) | `POST /api/inventario/productos/[id]/variantes/generar` | `generarVariantesMatriz()` |
| Baja lógica de Producto Maestro | `PATCH /api/inventario/productos/[id]` | — |
| Buscar productos activos | — | `buscarProductosActivos(query)` (ver Sección 7) |

Todas las respuestas siguen el shape `{ data, error }`. Validación de payload con Zod antes de tocar la capa de servicios (`lib/services/inventario/producto.service.ts`).

**Reglas de negocio relevantes** (`producto.service.ts`):
- `generarVariantesMatriz()` valida que el Producto Maestro exista y esté `is_active` antes de generar (rechaza con error de negocio, no solo 404, si está de baja). Límite de 200 combinaciones por invocación. Usa `createMany` con `skipDuplicates` para idempotencia ante reintentos.
- `desactivarProductoMaestro()` exige `deletion_reason` únicamente si hay stock remanente (`StockDeposito.cantidad > 0` en algún depósito activo). Nunca hace `DELETE` físico ni toca `VarianteSKU` individuales (eso es HU-A6).

## 6. Eventos de dominio

| Evento | Disparado por | Payload |
|---|---|---|
| `producto_maestro:creado` | `crearProductoMaestro()` | `producto_maestro_id`, `nombre`, `usuario_id` |
| `variantes:generadas` | `generarVariantesMatriz()` | `producto_maestro_id`, `cantidad_generadas`, `usuario_id` |
| `producto_maestro:desactivado` | Baja lógica | `producto_maestro_id`, `usuario_id`, `deletion_reason` |

**Pendiente:** `audit-log.listener.ts` (Módulo D) todavía no tiene handlers para estos 3 eventos.

## 7. Mejora post-entrega: alta de variante sobre Producto Maestro existente

El wizard original de HU-A1 solo contemplaba productos nuevos. Se detectó en la práctica que no había forma de agregar una variante (ej. un color nuevo) a un producto ya cargado sin repetir el alta completa.

**Implementación (pantalla separada, no un paso condicional del wizard original):**

- `buscarProductosActivos(query)` en `producto.service.ts` — busca `ProductoMaestro` con `is_active: true` por nombre o `codigo_producto`, `take: 10`. No toca `generarVariantesMatriz()` ni `generarSku()`.
- `components/inventario/BuscadorProductoExistente.tsx` — combobox con debounce de 300ms.
- `app/(dashboard)/inventario/productos/variantes/nueva/page.tsx` — pantalla "Nueva Variante": muestra el buscador; al seleccionar un producto, muestra `MatrizVariantes.tsx` reutilizado tal cual para ese `producto_maestro_id`. Un botón "Buscar otro producto" resetea el estado local sin navegar.
- Botón "Agregar variante" en `/inventario/productos`, junto al título, que lleva a la pantalla nueva.
- El wizard original de alta de producto nuevo (`FormularioProductoMaestro.tsx`) queda sin cambios de comportamiento.

**Bug corregido durante la verificación:** el listbox de resultados del buscador quedaba recortado por el `overflow: hidden` del componente `Card` genérico del sistema de diseño (deliberado ahí, no se tocó). Se resolvió renderizando el listbox vía `createPortal` a `document.body`, posicionado con `getBoundingClientRect()` del input, con cierre en scroll/resize y el handler de click-afuera ajustado para incluir el nodo portado.

## 8. Migraciones de Prisma

`prisma/migrations/` no tenía ninguna regla de `.gitignore` real — dos migraciones habían quedado sin trackear por accidente. Se corrigió: de acá en más las migraciones se versionan normalmente en git.

## 9. Cómo probar

Ver `postman_test_plan_HU-A1.md` para el plan de pruebas por API (autenticación, los 5 criterios de aceptación, casos de validación e idempotencia).

Flujo manual de la mejora de la Sección 7: `/inventario/productos` → "Agregar variante" → buscar un producto activo → seleccionar → generar variante → confirmar SKU correcto → "Generar otra tanda" (mismo producto) → "Buscar otro producto" (resetea sin navegar). Un producto dado de baja lógica no debe aparecer en el buscador.