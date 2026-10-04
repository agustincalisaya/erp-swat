"use client";

/**
 * HU-E5 — Backoffice de visibilidad web (spec E §2.5; task_relos.md D1, D15).
 * Mobile-first: una tarjeta por contenido. Por fila: ocultar/mostrar en la
 * tienda (motivo opcional) y dar de baja (motivo obligatorio + confirmación
 * explícita). Llama a los Route Handlers y refresca la lista del servidor.
 * `producto_activo` es solo informativo: no condiciona ninguna acción (D22).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type SubmitEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

interface Fila {
  producto_web_id: string;
  titulo_comercial: string;
  producto_maestro_id: string;
  producto_nombre: string;
  producto_activo: boolean;
  visibilidad_web: boolean;
  fotos_activas: number;
}

interface Pagina {
  items: Fila[];
  total: number;
  page: number;
  page_size: number;
}

interface RespuestaApi {
  data: unknown;
  error: { code?: string; message?: string; fieldErrors?: Record<string, string[] | undefined> } | null;
}

const MENSAJE_GENERICO = "No se pudo completar la operación. Intentá nuevamente.";
const CLASE_TEXTAREA =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

async function patchApi(url: string, cuerpo: Record<string, unknown>): Promise<{ ok: boolean; json: RespuestaApi }> {
  try {
    const respuesta = await fetch(url, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
    const json = (await respuesta.json().catch(() => ({ data: null, error: null }))) as RespuestaApi;
    return { ok: respuesta.ok, json };
  } catch {
    return { ok: false, json: { data: null, error: { message: "No se pudo conectar con el servidor." } } };
  }
}

const mensajeDe = (json: RespuestaApi, campo: string) =>
  json.error?.fieldErrors?.[campo]?.[0] ?? json.error?.message ?? MENSAJE_GENERICO;

// ──────────────────────────────────────────────────────────────────────────────
// Ocultar / mostrar
// ──────────────────────────────────────────────────────────────────────────────

function FormularioVisibilidad({ fila, onHecho, onCancelar }: { fila: Fila; onHecho: (aviso: string) => void; onCancelar: () => void }) {
  const nueva = !fila.visibilidad_web;
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enviar = async (evento: SubmitEvent<HTMLFormElement>) => {
    evento.preventDefault();
    setEnviando(true);
    setError(null);
    const { ok, json } = await patchApi(`/api/ecommerce/catalogo/${fila.producto_web_id}/visibilidad`, {
      visibilidad_web: nueva,
      ...(motivo.trim() ? { motivo: motivo.trim() } : {}),
    });
    setEnviando(false);
    if (!ok) {
      setError(mensajeDe(json, "motivo"));
      return;
    }
    onHecho(nueva ? `"${fila.titulo_comercial}" ahora se muestra en la tienda.` : `"${fila.titulo_comercial}" se ocultó de la tienda.`);
  };

  return (
    <form onSubmit={enviar} className="space-y-4">
      {!nueva && (
        <Alert>
          <AlertDescription>
            Los clientes que lo tengan en el carrito no podrán comprarlo y recibirán un aviso. Podés volver a mostrarlo cuando quieras.
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="catalogo-motivo-visibilidad">Motivo (opcional)</Label>
        <textarea
          id="catalogo-motivo-visibilidad"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          rows={2}
          maxLength={500}
          disabled={enviando}
          placeholder={nueva ? "Ej: Vuelve la temporada." : "Ej: Fin de temporada."}
          className={CLASE_TEXTAREA}
        />
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancelar} disabled={enviando}>
          Volver
        </Button>
        <Button type="submit" disabled={enviando}>
          {enviando ? "Guardando…" : nueva ? "Mostrar en tienda" : "Ocultar en tienda"}
        </Button>
      </div>
    </form>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Baja lógica
// ──────────────────────────────────────────────────────────────────────────────

function FormularioBaja({ fila, onHecho, onCancelar }: { fila: Fila; onHecho: (aviso: string) => void; onCancelar: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [confirmado, setConfirmado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const puedeEnviar = motivo.trim().length > 0 && confirmado && !enviando;

  const enviar = async (evento: SubmitEvent<HTMLFormElement>) => {
    evento.preventDefault();
    if (!puedeEnviar) return;
    setEnviando(true);
    setError(null);
    const { ok, json } = await patchApi(`/api/ecommerce/catalogo/${fila.producto_web_id}/baja`, {
      deletion_reason: motivo.trim(),
    });
    setEnviando(false);
    if (!ok) {
      setError(mensajeDe(json, "deletion_reason"));
      return;
    }
    onHecho(`"${fila.titulo_comercial}" se dio de baja del catálogo web.`);
  };

  return (
    <form onSubmit={enviar} className="space-y-4">
      <Alert variant="destructive">
        <AlertDescription>
          La baja saca el contenido de la tienda y del listado, y no se puede deshacer desde esta pantalla. El artículo sigue
          existiendo en el inventario.
        </AlertDescription>
      </Alert>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="catalogo-motivo-baja">Motivo de la baja (obligatorio)</Label>
        <textarea
          id="catalogo-motivo-baja"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          rows={3}
          maxLength={500}
          required
          disabled={enviando}
          placeholder="Ej: Discontinuado en el canal web."
          className={CLASE_TEXTAREA}
        />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={confirmado}
          onChange={(e) => setConfirmado(e.target.checked)}
          disabled={enviando}
        />
        <span>Confirmo que quiero dar de baja &quot;{fila.titulo_comercial}&quot; del catálogo web.</span>
      </label>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancelar} disabled={enviando}>
          Volver
        </Button>
        <Button type="submit" variant="destructive" disabled={!puedeEnviar}>
          {enviando ? "Dando de baja…" : "Confirmar baja"}
        </Button>
      </div>
    </form>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Listado
// ──────────────────────────────────────────────────────────────────────────────

type Modal = { tipo: "visibilidad"; fila: Fila } | { tipo: "baja"; fila: Fila } | null;

export function CatalogoWebAdmin({ pagina }: { pagina: Pagina }) {
  const router = useRouter();
  const [modal, setModal] = useState<Modal>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const totalPaginas = Math.max(1, Math.ceil(pagina.total / pagina.page_size));

  const hecho = (texto: string) => {
    setModal(null);
    setAviso(texto);
    router.refresh();
  };

  const tituloModal =
    modal?.tipo === "visibilidad"
      ? `${modal.fila.visibilidad_web ? "Ocultar" : "Mostrar"} "${modal.fila.titulo_comercial}"`
      : modal?.tipo === "baja"
        ? `Dar de baja "${modal.fila.titulo_comercial}"`
        : "";

  return (
    <div className="space-y-4">
      {aviso && (
        <Alert role="status">
          <AlertDescription>{aviso}</AlertDescription>
        </Alert>
      )}

      {pagina.items.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">No hay contenidos web para mostrar.</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {pagina.items.map((fila) => (
            <li key={fila.producto_web_id} className="space-y-3 rounded-lg border p-4" data-producto-web-id={fila.producto_web_id}>
              <div className="space-y-1">
                <p className="font-medium">{fila.titulo_comercial}</p>
                <p className="text-sm text-muted-foreground">Producto: {fila.producto_nombre}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant={fila.visibilidad_web ? "default" : "secondary"}>
                  {fila.visibilidad_web ? "Visible en la tienda" : "Oculto en la tienda"}
                </Badge>
                <Badge variant="outline">
                  {fila.fotos_activas} {fila.fotos_activas === 1 ? "foto" : "fotos"}
                </Badge>
                {!fila.producto_activo && <Badge variant="outline">Producto inactivo en inventario</Badge>}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  className="sm:flex-1"
                  onClick={() => {
                    setAviso(null);
                    setModal({ tipo: "visibilidad", fila });
                  }}
                >
                  {fila.visibilidad_web ? "Ocultar en tienda" : "Mostrar en tienda"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive sm:flex-1"
                  onClick={() => {
                    setAviso(null);
                    setModal({ tipo: "baja", fila });
                  }}
                >
                  Dar de baja
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {totalPaginas > 1 && (
        <nav className="flex items-center justify-between gap-2 text-sm" aria-label="Paginación">
          {pagina.page > 1 ? (
            <Link className="underline" href={`/ecommerce/catalogo?page=${pagina.page - 1}`}>
              Anterior
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground">
            Página {pagina.page} de {totalPaginas}
          </span>
          {pagina.page < totalPaginas ? (
            <Link className="underline" href={`/ecommerce/catalogo?page=${pagina.page + 1}`}>
              Siguiente
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}

      <Dialog open={modal !== null} onOpenChange={(abierto) => !abierto && setModal(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{tituloModal}</DialogTitle>
            {modal && <DialogDescription>Producto: {modal.fila.producto_nombre}</DialogDescription>}
          </DialogHeader>
          {modal?.tipo === "visibilidad" ? (
            <FormularioVisibilidad key={modal.fila.producto_web_id} fila={modal.fila} onHecho={hecho} onCancelar={() => setModal(null)} />
          ) : modal?.tipo === "baja" ? (
            <FormularioBaja key={modal.fila.producto_web_id} fila={modal.fila} onHecho={hecho} onCancelar={() => setModal(null)} />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
