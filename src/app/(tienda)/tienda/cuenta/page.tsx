import { redirect } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AccionesCuentaTienda } from "@/components/tienda/AccionesCuentaTienda";
import { getSesionClienteWeb } from "@/lib/auth/sesion-cliente-web";

export default async function CuentaTiendaPage() {
  const sesion = await getSesionClienteWeb();
  if (!sesion) redirect("/tienda/ingresar");
  return <div className="mx-auto max-w-lg space-y-6"><h1 className="text-2xl font-semibold">Mi cuenta</h1>
    {sesion.vinculacionPendiente && <Alert><AlertDescription>Tu cuenta está pendiente de validación de identidad en sucursal</AlertDescription></Alert>}
    <p className="text-sm text-slate-600">{sesion.email}</p>
    <AccionesCuentaTienda permitirBaja={!sesion.vinculacionPendiente} />
  </div>;
}
