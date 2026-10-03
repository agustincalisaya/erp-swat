/**
 * @page IngresarTienda
 * @route /tienda/ingresar
 * @description HU-E1 (CA6/CA7) — ingreso del Cliente Web. Al ingresar, el
 * carrito armado como visitante se fusiona con el de la cuenta.
 * TODO(HU-E8): sin registro ni recuperación (la recuperación es presencial).
 */
import Link from "next/link";
import { FormularioIngresoTienda } from "@/components/tienda/FormularioIngresoTienda";

export default async function IngresarTiendaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { redirect } = await searchParams;
  // Solo rutas internas de la tienda: evita un open redirect.
  const destino = typeof redirect === "string" && redirect.startsWith("/tienda/") ? redirect : "/tienda/catalogo";

  return (
    <div className="mx-auto max-w-sm space-y-4">
      <h1 className="text-2xl font-semibold">Ingresar</h1>
      <p className="text-sm text-slate-600">Ingresá con tu cuenta de la tienda para completar tu compra.</p>
      <FormularioIngresoTienda destino={destino} />
      <div className="flex justify-between text-sm"><Link href="/tienda/registrarse">Crear cuenta</Link><Link href="/tienda/recuperar">Recuperar acceso</Link></div>
    </div>
  );
}
