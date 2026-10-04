"use client";

/**
 * HU-E11 — Formularios de contenido comercial y fotos del backoffice
 * (spec E §2.11; task_relos.md D4–D8, D13, §5). Llaman a los Route Handlers
 * de `/api/ecommerce/catalogo/**` (sin Server Actions, D13); el padre hace
 * `router.refresh()` al terminar. Mensajes de error en español.
 */
import Image from "next/image";
import { useState, type SubmitEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface FotoAdmin {
  foto_id: string;
  url: string;
  es_principal: boolean;
  orden: number;
}

export interface ProductoSinContenidoOpcion {
  producto_maestro_id: string;
  nombre: string;
  categoria: string;
}

/** Límites de fotos leídos de `ConfiguracionSistema` (D3); `null` si la configuración es inválida. */
export interface LimitesFotos {
  maximo: number;
  tamano_max_mb: number;
  formatos: string[];
}

interface RespuestaApi {
  data: unknown;
  error: { code?: string; message?: string; fieldErrors?: Record<string, string[] | undefined> } | null;
}

const MENSAJE_GENERICO = "No se pudo completar la operación. Intentá nuevamente.";
const CLASE_CAMPO =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

async function llamarApi(url: string, init: RequestInit): Promise<{ ok: boolean; json: RespuestaApi }> {
  try {
    const respuesta = await fetch(url, init);
    const json = (await respuesta.json().catch(() => ({ data: null, error: null }))) as RespuestaApi;
    return { ok: respuesta.ok, json };
  } catch {
    return { ok: false, json: { data: null, error: { message: "No se pudo conectar con el servidor." } } };
  }
}

const enviarJson = (url: string, method: "POST" | "PATCH", cuerpo: Record<string, unknown>) =>
  llamarApi(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });

const primerError = (json: RespuestaApi, campos: string[]) =>
  campos.map((c) => json.error?.fieldErrors?.[c]?.[0]).find(Boolean) ?? json.error?.message ?? MENSAJE_GENERICO;

function AvisoError({ texto }: { texto: string | null }) {
  if (!texto) return null;
  return (
    <Alert variant="destructive">
      <AlertDescription>{texto}</AlertDescription>
    </Alert>
  );
}

function Botonera({ enviando, puedeEnviar, texto, onCancelar, variante }: {
  enviando: boolean;
  puedeEnviar: boolean;
  texto: string;
  onCancelar: () => void;
  variante?: "destructive";
}) {
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <Button type="button" variant="outline" onClick={onCancelar} disabled={enviando}>
        Volver
      </Button>
      <Button type="submit" variant={variante} disabled={!puedeEnviar || enviando}>
        {enviando ? "Guardando…" : texto}
      </Button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Alta de contenido (D4)
// ──────────────────────────────────────────────────────────────────────────────

export function FormularioCrearContenido({ productos, onHecho, onCancelar }: {
  productos: ProductoSinContenidoOpcion[];
  onHecho: (aviso: string) => void;
  onCancelar: () => void;
}) {
  const [productoId, setProductoId] = useState("");
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const puedeEnviar = productoId !== "" && titulo.trim() !== "" && descripcion.trim() !== "";

  if (productos.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Todos los productos activos ya tienen contenido web.</p>
        <Button type="button" variant="outline" onClick={onCancelar}>
          Volver
        </Button>
      </div>
    );
  }

  const enviar = async (evento: SubmitEvent<HTMLFormElement>) => {
    evento.preventDefault();
    if (!puedeEnviar) return;
    setEnviando(true);
    setError(null);
    const { ok, json } = await enviarJson("/api/ecommerce/catalogo", "POST", {
      producto_maestro_id: productoId,
      titulo_comercial: titulo.trim(),
      descripcion: descripcion.trim(),
    });
    setEnviando(false);
    if (!ok) {
      setError(primerError(json, ["producto_maestro_id", "titulo_comercial", "descripcion"]));
      return;
    }
    onHecho(`Se creó "${titulo.trim()}". Queda oculto en la tienda: subile fotos y mostralo cuando esté listo.`);
  };

  return (
    <form onSubmit={enviar} className="space-y-4">
      <AvisoError texto={error} />
      <div className="space-y-1.5">
        <Label htmlFor="contenido-producto">Producto</Label>
        <select
          id="contenido-producto"
          value={productoId}
          onChange={(e) => setProductoId(e.target.value)}
          disabled={enviando}
          required
          className={CLASE_CAMPO}
        >
          <option value="">Elegí un producto sin contenido web</option>
          {productos.map((p) => (
            <option key={p.producto_maestro_id} value={p.producto_maestro_id}>
              {p.nombre} — {p.categoria}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">Talles, colores, géneros y modelos se toman de las variantes del producto.</p>
      </div>
      <CamposTexto titulo={titulo} setTitulo={setTitulo} descripcion={descripcion} setDescripcion={setDescripcion} enviando={enviando} />
      <Botonera enviando={enviando} puedeEnviar={puedeEnviar} texto="Crear contenido" onCancelar={onCancelar} />
    </form>
  );
}

function CamposTexto({ titulo, setTitulo, descripcion, setDescripcion, enviando }: {
  titulo: string;
  setTitulo: (v: string) => void;
  descripcion: string;
  setDescripcion: (v: string) => void;
  enviando: boolean;
}) {
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="contenido-titulo">Título comercial</Label>
        <Input id="contenido-titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} disabled={enviando} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="contenido-descripcion">Descripción</Label>
        <textarea
          id="contenido-descripcion"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          rows={5}
          disabled={enviando}
          required
          className={CLASE_CAMPO}
        />
      </div>
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Edición (D5)
// ──────────────────────────────────────────────────────────────────────────────

export function FormularioEditarContenido({ productoWebId, tituloActual, descripcionActual, onHecho, onCancelar }: {
  productoWebId: string;
  tituloActual: string;
  descripcionActual: string;
  onHecho: (aviso: string) => void;
  onCancelar: () => void;
}) {
  const [titulo, setTitulo] = useState(tituloActual);
  const [descripcion, setDescripcion] = useState(descripcionActual);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cambios = {
    ...(titulo.trim() !== tituloActual ? { titulo_comercial: titulo.trim() } : {}),
    ...(descripcion.trim() !== descripcionActual ? { descripcion: descripcion.trim() } : {}),
  };
  const puedeEnviar = Object.keys(cambios).length > 0 && titulo.trim() !== "" && descripcion.trim() !== "";

  const enviar = async (evento: SubmitEvent<HTMLFormElement>) => {
    evento.preventDefault();
    if (!puedeEnviar) return;
    setEnviando(true);
    setError(null);
    const { ok, json } = await enviarJson(`/api/ecommerce/catalogo/${productoWebId}`, "PATCH", cambios);
    setEnviando(false);
    if (!ok) {
      setError(primerError(json, ["titulo_comercial", "descripcion"]));
      return;
    }
    onHecho(`Se guardaron los cambios de "${titulo.trim()}".`);
  };

  return (
    <form onSubmit={enviar} className="space-y-4">
      <AvisoError texto={error} />
      <CamposTexto titulo={titulo} setTitulo={setTitulo} descripcion={descripcion} setDescripcion={setDescripcion} enviando={enviando} />
      <Botonera enviando={enviando} puedeEnviar={puedeEnviar} texto="Guardar cambios" onCancelar={onCancelar} />
    </form>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Fotos (D6–D8)
// ──────────────────────────────────────────────────────────────────────────────

const MENSAJE_POR_CODIGO_FOTO: Record<string, (l: LimitesFotos) => string> = {
  FORMATO_IMAGEN_NO_ADMITIDO: (l) => `El archivo no es una imagen admitida. Formatos permitidos: ${l.formatos.join(", ")}.`,
  ARCHIVO_DEMASIADO_GRANDE: (l) => `La imagen supera el tamaño máximo de ${l.tamano_max_mb} MB.`,
  ARCHIVO_VACIO: () => "El archivo está vacío.",
  LIMITE_FOTOS_ALCANZADO: (l) => `Ya hay ${l.maximo} fotos activas, el máximo permitido. Dá de baja una para subir otra.`,
};

export function GestorFotos({ productoWebId, fotos, limites, onCambio }: {
  productoWebId: string;
  fotos: FotoAdmin[];
  limites: LimitesFotos | null;
  onCambio: (aviso: string) => void;
}) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [esPrincipal, setEsPrincipal] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [baja, setBaja] = useState<FotoAdmin | null>(null);
  const restantes = limites ? Math.max(0, limites.maximo - fotos.length) : 0;

  const errorFoto = (json: RespuestaApi) => {
    const codigo = json.error?.code ?? "";
    return limites && MENSAJE_POR_CODIGO_FOTO[codigo] ? MENSAJE_POR_CODIGO_FOTO[codigo](limites) : primerError(json, ["archivo"]);
  };

  const subir = async (evento: SubmitEvent<HTMLFormElement>) => {
    evento.preventDefault();
    if (!archivo) return;
    const formulario = evento.currentTarget;
    setEnviando(true);
    setError(null);
    const form = new FormData();
    form.append("archivo", archivo);
    form.append("es_principal", esPrincipal ? "true" : "false");
    const { ok, json } = await llamarApi(`/api/ecommerce/catalogo/${productoWebId}/fotos`, { method: "POST", body: form });
    setEnviando(false);
    if (!ok) {
      setError(errorFoto(json));
      return;
    }
    setArchivo(null);
    setEsPrincipal(false);
    formulario.reset();
    onCambio("Foto subida.");
  };

  const marcarPrincipal = async (foto: FotoAdmin) => {
    setEnviando(true);
    setError(null);
    const { ok, json } = await enviarJson(`/api/ecommerce/catalogo/${productoWebId}/fotos/${foto.foto_id}`, "PATCH", {
      es_principal: true,
    });
    setEnviando(false);
    if (!ok) {
      setError(errorFoto(json));
      return;
    }
    onCambio("Se cambió la foto principal.");
  };

  if (baja) {
    return (
      <FormularioBajaFoto
        productoWebId={productoWebId}
        foto={baja}
        onHecho={(aviso) => {
          setBaja(null);
          onCambio(aviso);
        }}
        onCancelar={() => setBaja(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <AvisoError texto={error} />
      {fotos.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no tiene fotos. Sin al menos una foto no se publica en la tienda.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {fotos.map((foto) => (
            <li key={foto.foto_id} className="space-y-2 rounded-lg border p-2" data-foto-id={foto.foto_id}>
              <Image
                src={foto.url}
                alt={foto.es_principal ? "Foto principal" : "Foto del producto"}
                width={200}
                height={200}
                unoptimized
                className="aspect-square w-full rounded object-cover"
              />
              {foto.es_principal ? (
                <Badge>Principal</Badge>
              ) : (
                <Button type="button" size="sm" variant="outline" className="w-full" disabled={enviando} onClick={() => marcarPrincipal(foto)}>
                  Marcar como principal
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="w-full text-destructive"
                disabled={enviando}
                onClick={() => {
                  setError(null);
                  setBaja(foto);
                }}
              >
                Dar de baja
              </Button>
            </li>
          ))}
        </ul>
      )}

      {limites ? (
        <form onSubmit={subir} className="space-y-3 rounded-lg border p-3">
          <p className="text-sm text-muted-foreground">
            Formatos: {limites.formatos.join(", ")} · Máximo {limites.tamano_max_mb} MB por foto · Podés subir {restantes} de{" "}
            {limites.maximo} fotos más.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor={`foto-archivo-${productoWebId}`}>Nueva foto</Label>
            <Input
              id={`foto-archivo-${productoWebId}`}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={enviando || restantes === 0}
              onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={esPrincipal} onChange={(e) => setEsPrincipal(e.target.checked)} disabled={enviando} />
            Usarla como foto principal
          </label>
          <Button type="submit" disabled={!archivo || enviando || restantes === 0}>
            {enviando ? "Subiendo…" : "Subir foto"}
          </Button>
        </form>
      ) : (
        <Alert variant="destructive">
          <AlertDescription>La configuración de fotos no es válida: no se pueden subir fotos hasta corregirla.</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function FormularioBajaFoto({ productoWebId, foto, onHecho, onCancelar }: {
  productoWebId: string;
  foto: FotoAdmin;
  onHecho: (aviso: string) => void;
  onCancelar: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [confirmado, setConfirmado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const puedeEnviar = motivo.trim().length > 0 && confirmado;

  const enviar = async (evento: SubmitEvent<HTMLFormElement>) => {
    evento.preventDefault();
    if (!puedeEnviar) return;
    setEnviando(true);
    setError(null);
    const { ok, json } = await enviarJson(`/api/ecommerce/catalogo/${productoWebId}/fotos/${foto.foto_id}`, "PATCH", {
      deletion_reason: motivo.trim(),
    });
    setEnviando(false);
    if (!ok) {
      setError(primerError(json, ["deletion_reason"]));
      return;
    }
    onHecho(foto.es_principal ? "Foto dada de baja. Si quedaban otras, la siguiente pasó a ser la principal." : "Foto dada de baja.");
  };

  return (
    <form onSubmit={enviar} className="space-y-4">
      <Image src={foto.url} alt="Foto a dar de baja" width={160} height={160} unoptimized className="aspect-square w-40 rounded object-cover" />
      <AvisoError texto={error} />
      <div className="space-y-1.5">
        <Label htmlFor="foto-motivo-baja">Motivo de la baja (obligatorio)</Label>
        <textarea
          id="foto-motivo-baja"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          rows={2}
          required
          disabled={enviando}
          placeholder="Ej: Foto desactualizada."
          className={CLASE_CAMPO}
        />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} disabled={enviando} />
        <span>Confirmo que quiero dar de baja esta foto.</span>
      </label>
      <Botonera enviando={enviando} puedeEnviar={puedeEnviar} texto="Confirmar baja" onCancelar={onCancelar} variante="destructive" />
    </form>
  );
}
