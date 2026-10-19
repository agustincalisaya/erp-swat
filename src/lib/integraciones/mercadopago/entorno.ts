/** Entorno de Mercado Pago elegido para este despliegue. */
export function seleccionarEntornoMercadoPago(
  configurado: string | undefined,
  nodeEnv: string | undefined,
): "SANDBOX" | "PRODUCCION" {
  if (configurado === undefined || configurado === "") {
    return nodeEnv === "production" ? "PRODUCCION" : "SANDBOX";
  }
  if (configurado === "SANDBOX" || configurado === "PRODUCCION") return configurado;
  throw new Error("MP_ENTORNO debe ser SANDBOX o PRODUCCION");
}
