import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { CuentasWebCliente } from "@/components/ecommerce/CuentasWebCliente";
import { PERMISO_VALIDAR_IDENTIDAD_CLIENTE_WEB } from "@/lib/auth/permisos-ecommerce";
export default async function CuentasWebPage() { const session = await getServerSession(); if (!session) redirect("/login"); if (!(await usuarioTienePermiso(session.userId, PERMISO_VALIDAR_IDENTIDAD_CLIENTE_WEB))) redirect("/no-autorizado"); return <main className="p-6"><div className="mx-auto max-w-3xl space-y-5"><h1 className="text-2xl font-semibold">Cuentas web</h1><CuentasWebCliente /></div></main>; }
