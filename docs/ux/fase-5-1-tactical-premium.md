# Fase 5.1 — base visual y movimiento de la tienda

## Estado de partida

- La tienda pública usa Next.js App Router, Tailwind 4, CSS Modules, componentes shadcn/ui, Lucide y `next-themes`.
- La identidad Tactical Premium ya tiene tokens semánticos para temas claro y oscuro en `src/app/globals.css`. La home utiliza además colores editoriales propios en `experiencia.module.css`.
- Home, catálogo y detalle tienen cambios locales anteriores a esta fase. Carrito y checkout conservan el flujo funcional existente.
- UI UX Pro Max está instalada para Codex en `.agents/skills/ui-ux-pro-max/`. Sus recomendaciones se contrastan con la identidad existente: no se importan automáticamente paletas, fuentes ni plantillas.
- Motion for React está disponible mediante `motion/react`; `TiendaMotionProvider` aplica `reducedMotion="user"` al contenido de la tienda. Todavía no se reemplazaron las animaciones CSS de la home.

## Dirección de diseño

**Color.** Mantener los tokens actuales: oliva `#46583D` como primario claro, oliva pálido `#A3B58C` como primario oscuro, fondos `#F4F5F3` y `#141714`, textos `#202521` y `#E9EDE5`. Usar variables semánticas para las nuevas superficies. Revisar los colores fijos de la home en ambos temas antes de reutilizarlos.

**Tipografía.** Conservar la escala y las fuentes existentes en esta fase. Ajustar jerarquía, longitud de línea y tamaño móvil por pantalla; cualquier cambio de familia tipográfica se evalúa como una decisión visual separada.

**Composición.** Fotografías del producto y contenido real como punto focal. Espaciado amplio para escenas editoriales; controles, filtros, precio y disponibilidad compactos y fáciles de encontrar. Una acción principal clara por pantalla.

**Movimiento.** Reservar Motion para cambios causados por una acción o para una transición editorial concreta. Mantener CSS para hover y estados simples. Evitar animar `width`, `height`, `top` y `left`; preferir opacidad y transformaciones. No ocultar información hasta que termine una animación. Respetar `prefers-reduced-motion` también en las animaciones CSS existentes.

## Orden del rediseño progresivo

| Pantalla | Primer trabajo visual | Límite funcional |
| --- | --- | --- |
| Home | Afinar portada, jerarquía editorial y escenas; revisar animación existente y tema oscuro | Conservar enlaces y productos destacados recibidos del servidor |
| Catálogo | Mejorar filtros, tarjetas, estados vacíos y navegación móvil | Conservar query, filtros, orden y paginación actuales |
| Detalle | Ordenar galería, variantes, precio, stock y llamada a la acción | Conservar el selector y las reglas de comprabilidad |
| Carrito | Clarificar artículos, cantidades, subtotales, errores y continuidad | Conservar operaciones y validaciones del carrito |
| Checkout | Reducir distracciones, explicar pasos y estados de pago/retiro | Conservar reservas, pagos y estados del pedido |

## Criterios para cada pantalla

1. Revisar a 375, 768, 1024 y 1440 px, en tema claro y oscuro.
2. Comprobar foco visible, uso con teclado, contraste, textos alternativos y controles táctiles.
3. Comprobar la preferencia de movimiento reducido; el contenido y las acciones deben seguir disponibles sin animación.
4. Mantener componentes cliente cerca de la interacción; datos y reglas de negocio permanecen en el servidor.
5. Comparar antes y después de la pantalla y revisar que no cambien rutas, payloads ni resultados de negocio.

Esta fase instala herramientas y define el recorrido. El rediseño visual de cada pantalla se implementará por incrementos revisables.
