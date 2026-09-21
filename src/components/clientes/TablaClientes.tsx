/**
 * @component TablaClientes
 * @description Listado de clientes (`/clientes`) — la pantalla que faltaba
 * para llegar a la ficha de un cliente (`/clientes/[id]`), donde viven las
 * direcciones (HU-C3) y el canal de contacto (HU-C9). Server Component
 * (Server Component puro): el padre ya resolvió sesión, permiso y datos con
 * `listarClientes()`; acá solo se renderiza.
 *
 * Navegación: cada fila expone la ficha con DOS links accesibles — el DNI en
 * la primera celda y una acción explícita "Ver ficha" al final. Se evita el
 * patrón `onClick` + `useRouter` porque el SM pidió explícitamente un
 * `<Link>` (navegación semántica, accesible por teclado, operable con
 * "abrir en pestaña nueva", sin JavaScript de cliente).
 *
 * Sin columna de acciones condicionadas por estado: todas las filas ofrecen
 * la misma acción (ver ficha), así que no hay menú "⋮" ni permisos por fila
 * que evaluar acá.
 */

import Link from "next/link";
import { Users } from "lucide-react";
import type { CanalContacto, SegmentoComercial } from "@prisma/client";

import type { ClienteListado } from "@/lib/services/clientes/cliente.service";

/** Etiquetas de presentación del enum `CanalContacto` (nunca implican default). */
const CANAL_PREFERIDO_LABEL: Record<CanalContacto, string> = {
  WHATSAPP: "WhatsApp",
  EMAIL: "Email",
  AMBOS: "Ambos",
};

/** Etiquetas de presentación del enum `SegmentoComercial`. */
const SEGMENTO_LABEL: Record<SegmentoComercial, string> = {
  MINORISTA: "Minorista",
  MAYORISTA: "Mayorista",
  CLIENTE_FRECUENTE: "Cliente frecuente",
};

const TH_CLASS =
  "text-left px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground";

interface TablaClientesProps {
  clientes: ClienteListado[];
}

export function TablaClientes({ clientes }: TablaClientesProps) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{clientes.length} cliente(s)</p>

      <div className="rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className={TH_CLASS}>DNI</th>
                <th className={TH_CLASS}>Nombre</th>
                <th className={TH_CLASS}>Teléfono</th>
                <th className={TH_CLASS}>Email</th>
                <th className={TH_CLASS}>Canal preferido</th>
                <th className={TH_CLASS}>Segmento</th>
                <th className={`${TH_CLASS} text-right`}>Ficha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {clientes.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-muted-foreground text-sm">
                    <div className="flex flex-col items-center gap-2">
                      <Users className="size-8 text-muted-foreground/50" aria-hidden="true" />
                      Todavía no hay clientes cargados.
                    </div>
                  </td>
                </tr>
              ) : (
                clientes.map((cliente) => (
                  <tr key={cliente.id} className="hover:bg-muted/40 transition-colors">
                    <td className="px-4 py-3">
                      <Link
                        href={`/clientes/${cliente.id}`}
                        className="font-mono text-blue-600 hover:underline"
                      >
                        {cliente.dni}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-medium">{cliente.nombre}</td>
                    <td className="px-4 py-3">{cliente.telefono || "—"}</td>
                    <td className="px-4 py-3">{cliente.email || "—"}</td>
                    <td className="px-4 py-3">
                      {cliente.canal_preferido ? (
                        CANAL_PREFERIDO_LABEL[cliente.canal_preferido]
                      ) : (
                        <span className="text-muted-foreground">Sin definir</span>
                      )}
                    </td>
                    <td className="px-4 py-3">{SEGMENTO_LABEL[cliente.segmento]}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/clientes/${cliente.id}`}
                        className="font-medium text-blue-600 hover:underline whitespace-nowrap"
                      >
                        Ver ficha
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
