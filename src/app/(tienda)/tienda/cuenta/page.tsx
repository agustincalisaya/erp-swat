import Link from "next/link";
import { redirect } from "next/navigation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AccionesCuentaTienda, BotonCerrarSesionCuenta } from "@/components/tienda/AccionesCuentaTienda";
import { getSesionClienteWeb } from "@/lib/auth/sesion-cliente-web";

export default async function CuentaTiendaPage() {
  const sesion = await getSesionClienteWeb();
  if (!sesion) redirect("/tienda/ingresar");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Mi cuenta</h1>
        <p className="text-sm text-muted-foreground">Gestioná tu cuenta y tus compras.</p>
        <p className="text-sm text-muted-foreground">Sesión iniciada como <span className="font-medium text-foreground">{sesion.email}</span></p>
      </header>

      {sesion.vinculacionPendiente && (
        <Alert>
          <AlertTitle>Cuenta pendiente de validación</AlertTitle>
          <AlertDescription>Tu cuenta está pendiente de validación de identidad en sucursal</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2 md:items-start">
        {!sesion.vinculacionPendiente && (
          <Link
            href="/tienda/cuenta/pedidos"
            className="block cursor-pointer rounded-xl outline-none transition-shadow focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Card className="transition-colors hover:border-border hover:bg-muted/40 hover:shadow-sm">
              <CardHeader>
                <CardTitle>Mis pedidos</CardTitle>
                <CardDescription>Consultá tus compras, su estado actual y el retiro.</CardDescription>
              </CardHeader>
              <CardContent>
                <span className="text-sm font-medium text-primary">Ver pedidos →</span>
              </CardContent>
            </Card>
          </Link>
        )}

        <Card className={sesion.vinculacionPendiente ? "md:col-span-2" : undefined}>
          <CardHeader>
            <CardTitle>Mi sesión</CardTitle>
            <CardDescription>Administrá el acceso a tu cuenta de la tienda.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="space-y-1 text-sm">
              <dt className="text-muted-foreground">Email de la cuenta</dt>
              <dd className="font-medium break-all">{sesion.email}</dd>
            </dl>
            <BotonCerrarSesionCuenta />
          </CardContent>
        </Card>
      </div>

      {!sesion.vinculacionPendiente && (
        <Card>
          <CardHeader>
            <CardTitle>Zona de cuenta</CardTitle>
          </CardHeader>
          <CardContent>
            <AccionesCuentaTienda permitirBaja={!sesion.vinculacionPendiente} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
