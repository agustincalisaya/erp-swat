import { MisPedidosListado } from "@/components/ecommerce/MisPedidosListado";

export default function MisPedidosLoading() {
  return <MisPedidosListado pedidos={[]} estado="cargando" />;
}
