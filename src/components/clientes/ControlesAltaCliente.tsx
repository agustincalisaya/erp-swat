import { Loader2, UserPlus } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export interface DniExistenteAlta {
  dni: string;
  id: string | null;
  is_active: boolean | null;
}

export function dniExistenteActual(aviso: DniExistenteAlta | null, dni: string) {
  return aviso?.dni === dni ? aviso : null;
}

export function AvisoDniCliente({ cliente, onIrFicha }: {
  cliente: DniExistenteAlta;
  onIrFicha: (id: string) => void;
}) {
  const clienteId = cliente.id;
  return <Alert role="alert" className="border-amber-200 bg-amber-50">
    <AlertDescription>
      Este DNI ya existe{cliente.is_active === false ? " en un cliente inactivo" : ""}. No se creará otro cliente ni se reactivará el existente.
      {clienteId && <Button type="button" variant="link" onClick={() => onIrFicha(clienteId)}>Ir a la ficha del cliente</Button>}
    </AlertDescription>
  </Alert>;
}

export function BotonAltaCliente({ enviando, bloqueado, continuar }: {
  enviando: boolean;
  bloqueado: boolean;
  continuar: boolean;
}) {
  return <Button type="submit" disabled={enviando || bloqueado}
    className="bg-blue-600 hover:bg-blue-700 text-white gap-2">
    {enviando ? <><Loader2 className="size-4 animate-spin" aria-hidden="true" />Guardando…</>
      : <><UserPlus className="size-4" aria-hidden="true" />
        {continuar ? "Continuar con el alta" : "Revisar y dar de alta"}</>}
  </Button>;
}
