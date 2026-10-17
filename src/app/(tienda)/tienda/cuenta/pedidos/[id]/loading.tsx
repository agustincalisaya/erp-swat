import { DetallePedidoWeb } from "@/components/ecommerce/DetallePedidoWeb";

export default function DetallePedidoLoading() {
  return <DetallePedidoWeb pedido={null} estado="cargando" />;
}
