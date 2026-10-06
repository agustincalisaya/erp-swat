import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export function AccesoPedidosCuenta({ vinculacionPendiente }: { vinculacionPendiente: boolean }) {
  if (vinculacionPendiente) return null;
  return <Link href="/tienda/cuenta/pedidos" className={buttonVariants({ variant: "outline" })}>Mis pedidos</Link>;
}
