export function resolverClienteCreadoEnRegistro(
  creado: { esNuevo: boolean; cliente: { id: string } },
  estadoExistente?: { is_active: boolean; deleted_at: Date | null },
) {
  if (!creado.esNuevo && (!estadoExistente?.is_active || estadoExistente.deleted_at)) {
    return { disponible: false as const };
  }
  return { disponible: true as const, clienteId: creado.cliente.id, pendiente: !creado.esNuevo };
}
