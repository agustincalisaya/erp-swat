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
 *  - Auditoría Forense NO lleva `permiso`: sigue visible para cualquier
 *    sesión — la página degrada su propio contenido según
 *    `auditoria:leer_forense` (sin cambios, task_cali_bloqueo_url_auditoria.md §2).
 *  - Inventario (Productos / Depósitos / Movimientos): Módulo A todavía
 *    no tiene RBAC granular, solo verificación de sesión (`withAuth`) —
 *    sin filtro de permiso, fuera de alcance de HU-D10.
 */
import type { LucideIcon } from "lucide-react";
// 1. Agregamos el ícono "Layers" a la importación
import { ScrollText, ShieldCheck, Users, Package, Warehouse, ScanBarcode, Layers } from "lucide-react";
import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { SidebarNav, type SidebarNavSection } from "@/components/layout/SidebarNav";

interface ItemConfig {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Código de permiso requerido para mostrar el ítem. Ninguno lo usa hoy. */
  permiso?: string;
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
      { label: "Auditoría Forense", href: "/auditoria/logs", icon: ScrollText },
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
            return {
              label: item.label,
              href: item.href,
              icon: <ItemIcon className="size-4 shrink-0" aria-hidden="true" />,
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