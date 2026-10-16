import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { diaNegocioIso } from "@/lib/utils/fecha-negocio";
import { PERMISO_EXPORTAR_LIBRO_IVA } from "@/lib/services/tesoreria/libro-iva.constants";
import { DescargasLibroIva } from "@/components/tesoreria/DescargasLibroIva";

export const dynamic = "force-dynamic";
export const metadata = { title: "Libro de IVA — ERP SWAT" };

export default async function LibroIvaPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  if (!await usuarioTienePermiso(session.userId, PERMISO_EXPORTAR_LIBRO_IVA)) redirect("/no-autorizado");
  return (
    <div className="mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <DescargasLibroIva mesInicial={diaNegocioIso(new Date()).slice(0, 7)} />
    </div>
  );
}
