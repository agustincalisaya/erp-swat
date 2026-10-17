import { redirect } from "next/navigation";
import { CuponesCliente } from "@/components/ecommerce/CuponesCliente";
import { PERMISO_GESTIONAR_CUPONES } from "@/lib/auth/permisos-ecommerce";
import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";

/** HU-E4 — Administración de cupones de descuento (spec E §2.4.e). */
export default async function CuponesPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  if (!(await usuarioTienePermiso(session.userId, PERMISO_GESTIONAR_CUPONES))) redirect("/no-autorizado");
  return (
    <main className="p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <h1 className="text-2xl font-semibold">Cupones de descuento</h1>
        <CuponesCliente />
      </div>
    </main>
  );
}
