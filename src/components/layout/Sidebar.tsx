/**
 * @component Sidebar
 * @description Navegación principal del dashboard (HU-D9/HU-D10,
 * task_cali_layout_dashboard.md, task_cali_bloqueo_url_auditoria.md).
 * Server Component: resuelve sesión con `getServerSession()` y arma la
 * estructura de secciones visibles, filtrando por permiso donde aplica.
 *
 * Decisión revertida en HU-D10: Usuarios y Roles y Permisos, que
 * originalmente eran visibles para cualquier sesión, ahora se ocultan sin
 * `roles:administrar` — el bloqueo real de acceso por URL vive en cada
 * `page.tsx` (`redirect("/no-autorizado")`), el filtro acá es solo la
 * capa de navegación, no la de seguridad.
 *  - Auditoría Forense (`/auditoria/logs`, Módulo D) NO lleva `permiso`:
 *    sigue visible para cualquier sesión — la página degrada su propio
 *    contenido según `auditoria:leer_forense` (sin cambios,
 *    task_cali_bloqueo_url_auditoria.md §2).
 *  - Auditoría del Inventario (`/inventario/auditoria`, Módulo A) — hasta
 *    la reorganización de navegación post-HU-A7 era una entrada de primer
 *    nivel aparte, bajo "Inventario", con el mismo texto "Auditoría
 *    Forense" que la de Módulo D (confuso). Ahora vive como sub-ítem
 *    anidado bajo la entrada "Auditoría Forense" de arriba (mismo href,
 *    solo cambia dónde cuelga en el árbol) y con texto propio "Auditoría
 *    del Inventario" para distinguirla. SIGUE llevando
 *    `permiso: "auditoria:leer_forense"` sin cambios — a diferencia de la
 *    de Módulo D, esa pantalla bloquea el acceso por completo sin el
 *    permiso (no degrada), así que no tiene sentido dejar el sub-ítem
 *    visible para quien de todos modos se va a encontrar con la pantalla
 *    de "no autorizado".
 *  - Inventario (Productos / Depósitos / Movimientos): Módulo A todavía
 *    no tiene RBAC granular, solo verificación de sesión (`withAuth`) —
 *    sin filtro de permiso, fuera de alcance de HU-D10.
 */
import type { LucideIcon } from "lucide-react";
// 1. Agregamos el ícono "Layers" a la importación
import { ScrollText, ShieldCheck, Users, Package, Warehouse, ScanBarcode, Layers, FileSearch, ShoppingCart, ClipboardList, Store, PackageCheck, Undo2 } from "lucide-react";
import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { SidebarNav, type SidebarNavSection } from "@/components/layout/SidebarNav";

interface ItemConfig {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Código de permiso requerido para mostrar el ítem. */
  permiso?: string;
  /** Sub-ítems anidados debajo de este (ver docstring del componente). */
  children?: ItemConfig[];
}

interface SeccionConfig {
  label: string;
  icon: LucideIcon;
  items: ItemConfig[];
}

const SECCIONES: SeccionConfig[] = [
  {
    label: "Auditoría",
    icon: ShieldCheck,
    items: [
      { label: "Usuarios", href: "/auditoria/usuarios", icon: Users, permiso: "roles:administrar" },
      {
        label: "Roles y Permisos",
        href: "/auditoria/roles",
        icon: ShieldCheck,
        permiso: "roles:administrar",
      },
      {
        label: "Auditoría Forense",
        href: "/auditoria/logs",
        icon: ScrollText,
        // Reorganización de navegación post-HU-A7: la consola de
        // Inventario cuelga acá como sub-ítem en vez de vivir como
        // entrada de primer nivel aparte en "Inventario" (evita el
        // nombre duplicado "Auditoría Forense" en dos lugares del menú).
      },
      {
        label: "Auditoría del Inventario",
        href: "/inventario/auditoria",
        icon: FileSearch,
        permiso: "auditoria:leer_forense",
      },
    ],
  },
  {
    label: "Inventario",
    icon: Package,
    items: [
      { label: "Productos", href: "/inventario/productos", icon: Package },
      // 2. Agregamos "Variantes" justo debajo de Productos
      { label: "Variantes", href: "/inventario/variantes", icon: Layers },
      { label: "Depósitos", href: "/inventario/depositos", icon: Warehouse },
      { label: "Movimientos", href: "/inventario/movimientos", icon: ScanBarcode },
      // HU-A9 — Reclasificación de unidades devueltas. Gate por permiso
      // granular `inventario:reclasificar` (ADMINISTRADOR + ENCARGADO_DEPOSITO);
      // la página también bloquea por URL (redirect a /no-autorizado).
      {
        label: "Devoluciones",
        href: "/inventario/devoluciones",
        icon: Undo2,
        permiso: "inventario:reclasificar",
      },
    ],
  },
  {
    label: "Compras",
    icon: ShoppingCart,
    items: [
      // Gate por `ordenes_compra:leer` (Alcance §5) — permiso de lectura
      // separado de `crear`. Lo tienen Comprador, Supervisor de Compras y
      // Auditor. Las acciones de transición (enviar/confirmar/cerrar/cancelar)
      // se gatean por sus permisos granulares en el detalle.
      {
        label: "Proveedores",
        href: "/compras/proveedores",
        icon: Store,
      },
      {
        label: "Órdenes de Compra",
        href: "/compras/ordenes",
        icon: ClipboardList,
        permiso: "ordenes_compra:leer",
      },
      {
        label: "Recepción de Mercadería",
        href: "/compras/recepciones/nueva",
        icon: PackageCheck,
        permiso: "recepciones:registrar",
      },
    ],
  },
];

export async function Sidebar() {
  const session = await getServerSession();

  if (!session) return null;

  const secciones: SidebarNavSection[] = await Promise.all(
    SECCIONES.map(async (seccion) => {
      const SeccionIcon = seccion.icon;
      const items = (
        await Promise.all(
          seccion.items.map(async (item) => {
            if (item.permiso) {
              const visible = await usuarioTienePermiso(session.userId, item.permiso);
              if (!visible) return null;
            }
            const ItemIcon = item.icon;
            const children = item.children
              ? (
                  await Promise.all(
                    item.children.map(async (child) => {
                      if (child.permiso) {
                        const visible = await usuarioTienePermiso(session.userId, child.permiso);
                        if (!visible) return null;
                      }
                      const ChildIcon = child.icon;
                      return {
                        label: child.label,
                        href: child.href,
                        icon: <ChildIcon className="size-3.5 shrink-0" aria-hidden="true" />,
                      };
                    }),
                  )
                ).filter((child): child is NonNullable<typeof child> => child !== null)
              : undefined;
            return {
              label: item.label,
              href: item.href,
              icon: <ItemIcon className="size-4 shrink-0" aria-hidden="true" />,
              ...(children && children.length > 0 ? { children } : {}),
            };
          }),
        )
      ).filter((item): item is NonNullable<typeof item> => item !== null);

      return {
        label: seccion.label,
        icon: <SeccionIcon className="size-3.5" aria-hidden="true" />,
        items,
      };
    }),
  );

  return <SidebarNav sections={secciones} />;
}
