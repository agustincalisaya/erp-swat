"use client";

/**
 * HU-E4 — Pantalla de administración de cupones (design §6). Listado con
 * filtro y búsqueda, alta y edición en el mismo formulario (con aplicaciones
 * solo se habilitan los límites; el backend igual valida) y baja con motivo.
 * Fechas en hora de Argentina en pantalla; se envían como ISO con zona.
 */
import { useEffect, useState, type SubmitEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { textoMotivoBajaCupon } from "@/lib/ecommerce/motivo-baja-cupon";

type Estado = "DADO_DE_BAJA" | "NO_INICIADO" | "VENCIDO" | "AGOTADO" | "VIGENTE";
type Filtro = "ACTIVOS" | "INACTIVOS" | "TODOS";

interface Cupon {
  id: string;
  codigo: string;
  tipo_beneficio: "PORCENTAJE" | "MONTO_FIJO";
  valor: string;
  vigente_desde: string;
  vigente_hasta: string;
  limite_uso_global: number | null;
  limite_uso_por_cliente: number;
  is_active: boolean;
  deleted_at: string | null;
  deletion_reason: string | null;
  estado: Estado;
  usos_confirmados: number;
  reservas_vigentes: number;
  capacidad_disponible: number | null;
  tiene_aplicaciones: boolean;
}

interface ErrorApi {
  code?: string;
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
}
interface RespuestaApi<T> {
  data: T | null;
  error: ErrorApi | null;
}

const ZONA = "America/Argentina/Buenos_Aires";
/** Argentina no tiene horario de verano: UTC−3 fijo. */
const OFFSET_AR = "-03:00";
const MENSAJE_GENERICO = "No se pudo completar la operación. Intentá nuevamente.";

const ETIQUETA_ESTADO: Record<Estado, string> = {
  VIGENTE: "Vigente",
  NO_INICIADO: "No iniciado",
  VENCIDO: "Vencido",
  AGOTADO: "Agotado",
  DADO_DE_BAJA: "Dado de baja",
};
const VARIANTE_ESTADO: Record<Estado, "default" | "secondary" | "destructive" | "outline"> = {
  VIGENTE: "default",
  NO_INICIADO: "secondary",
  VENCIDO: "outline",
  AGOTADO: "outline",
  DADO_DE_BAJA: "destructive",
};

const fechaAr = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", { timeZone: ZONA, dateStyle: "short", timeStyle: "short" });

/** ISO → valor de `<input type="datetime-local">` en hora de Argentina. */
function aInputLocal(iso: string): string {
  const ar = new Date(new Date(iso).getTime() - 3 * 60 * 60 * 1000);
  return ar.toISOString().slice(0, 16);
}
/** Valor de `<input type="datetime-local">` (hora de Argentina) → ISO con zona. */
const aIsoConZona = (local: string) => `${local}:00${OFFSET_AR}`;

function beneficio(cupon: Cupon): string {
  const valor = Number(cupon.valor).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return cupon.tipo_beneficio === "PORCENTAJE" ? `${valor} %` : `$ ${valor}`;
}

async function llamarApi<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; json: RespuestaApi<T> }> {
  try {
    const respuesta = await fetch(url, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
    const json = (await respuesta.json().catch(() => ({ data: null, error: null }))) as RespuestaApi<T>;
    return { ok: respuesta.ok, json };
  } catch {
    return { ok: false, json: { data: null, error: { message: "No se pudo conectar con el servidor." } } };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Formulario de alta y edición
// ──────────────────────────────────────────────────────────────────────────────

interface ValoresFormulario {
  codigo: string;
  tipo_beneficio: "PORCENTAJE" | "MONTO_FIJO";
  valor: string;
  vigente_desde: string;
  vigente_hasta: string;
  limite_uso_global: string;
  limite_uso_por_cliente: string;
}

const FORMULARIO_VACIO: ValoresFormulario = {
  codigo: "",
  tipo_beneficio: "PORCENTAJE",
  valor: "",
  vigente_desde: "",
  vigente_hasta: "",
  limite_uso_global: "",
  limite_uso_por_cliente: "1",
};

function valoresDe(cupon: Cupon): ValoresFormulario {
  return {
    codigo: cupon.codigo,
    tipo_beneficio: cupon.tipo_beneficio,
    valor: cupon.valor,
    vigente_desde: aInputLocal(cupon.vigente_desde),
    vigente_hasta: aInputLocal(cupon.vigente_hasta),
    limite_uso_global: cupon.limite_uso_global === null ? "" : String(cupon.limite_uso_global),
    limite_uso_por_cliente: String(cupon.limite_uso_por_cliente),
  };
}

/** Body de la API. En edición, solo los campos que cambiaron. */
function cuerpoDe(valores: ValoresFormulario, original: Cupon | null): Record<string, unknown> {
  const completo: Record<string, unknown> = {
    tipo_beneficio: valores.tipo_beneficio,
    valor: valores.valor.trim(),
    vigente_desde: valores.vigente_desde ? aIsoConZona(valores.vigente_desde) : "",
    vigente_hasta: valores.vigente_hasta ? aIsoConZona(valores.vigente_hasta) : "",
    limite_uso_global: valores.limite_uso_global.trim() === "" ? null : Number(valores.limite_uso_global),
    limite_uso_por_cliente: Number(valores.limite_uso_por_cliente),
  };
  if (!original) return { codigo: valores.codigo, ...completo };
  const antes = valoresDe(original);
  return Object.fromEntries(
    (Object.keys(completo) as (keyof ValoresFormulario)[])
      .filter((campo) => valores[campo] !== antes[campo])
      .map((campo) => [campo, completo[campo]]),
  );
}

function FormularioCupon({
  cupon,
  soloLectura,
  onGuardado,
  onCancelar,
}: {
  cupon: Cupon | null;
  soloLectura: boolean;
  onGuardado: () => void;
  onCancelar: () => void;
}) {
  const [valores, setValores] = useState<ValoresFormulario>(cupon ? valoresDe(cupon) : FORMULARIO_VACIO);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errores, setErrores] = useState<Record<string, string[] | undefined>>({});

  const soloLimites = !soloLectura && !!cupon?.tiene_aplicaciones;
  const bloqueado = (campo: keyof ValoresFormulario) =>
    soloLectura ||
    enviando ||
    (campo === "codigo" && !!cupon) ||
    (soloLimites && campo !== "limite_uso_global" && campo !== "limite_uso_por_cliente");
  const cambiar = (campo: keyof ValoresFormulario) => (valor: string) => {
    setValores((previo) => ({ ...previo, [campo]: valor }));
    setErrores((previo) => ({ ...previo, [campo]: undefined }));
  };

  const enviar = async (evento: SubmitEvent<HTMLFormElement>) => {
    evento.preventDefault();
    if (soloLectura) return;
    const cuerpo = cuerpoDe(valores, cupon);
    if (cupon && Object.keys(cuerpo).length === 0) {
      onCancelar();
      return;
    }
    setEnviando(true);
    setError(null);
    const { ok, json } = await llamarApi<{ cupon: Cupon }>(
      cupon ? `/api/ecommerce/cupones/${cupon.id}` : "/api/ecommerce/cupones",
      { method: cupon ? "PATCH" : "POST", body: JSON.stringify(cuerpo) },
    );
    setEnviando(false);
    if (!ok) {
      setError(json.error?.message ?? MENSAJE_GENERICO);
      setErrores(json.error?.fieldErrors ?? {});
      return;
    }
    onGuardado();
  };

  const campo = (
    nombre: keyof ValoresFormulario,
    etiqueta: string,
    props: React.ComponentProps<typeof Input> = {},
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={`cupon-${nombre}`}>{etiqueta}</Label>
      <Input
        id={`cupon-${nombre}`}
        value={valores[nombre]}
        onChange={(e) => cambiar(nombre)(e.target.value)}
        disabled={bloqueado(nombre)}
        aria-invalid={!!errores[nombre]}
        {...props}
      />
      {errores[nombre]?.[0] && <p className="text-sm text-destructive">{errores[nombre]?.[0]}</p>}
    </div>
  );

  return (
    <form onSubmit={enviar} className="space-y-4">
      {soloLimites && (
        <Alert>
          <AlertDescription>
            Este cupón ya se aplicó en pedidos: solo se pueden ampliar sus límites de uso.
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {campo("codigo", "Código", {
          placeholder: "PROMO-OTONO",
          onChange: (e) => cambiar("codigo")(e.target.value.toUpperCase()),
        })}
        <div className="space-y-1.5">
          <Label htmlFor="cupon-tipo_beneficio">Tipo de beneficio</Label>
          <select
            id="cupon-tipo_beneficio"
            value={valores.tipo_beneficio}
            onChange={(e) => cambiar("tipo_beneficio")(e.target.value)}
            disabled={bloqueado("tipo_beneficio")}
            className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm disabled:opacity-50"
          >
            <option value="PORCENTAJE">Porcentaje</option>
            <option value="MONTO_FIJO">Monto fijo</option>
          </select>
        </div>
        {campo("valor", valores.tipo_beneficio === "PORCENTAJE" ? "Porcentaje (%)" : "Monto ($)", {
          inputMode: "decimal",
          placeholder: valores.tipo_beneficio === "PORCENTAJE" ? "10" : "5000",
        })}
        <div />
        {campo("vigente_desde", "Vigente desde (hora de Argentina)", { type: "datetime-local" })}
        {campo("vigente_hasta", "Vigente hasta (hora de Argentina)", { type: "datetime-local" })}
        {campo("limite_uso_global", "Límite de uso global (vacío = ilimitado)", {
          type: "number",
          min: 1,
          step: 1,
        })}
        {campo("limite_uso_por_cliente", "Límite de uso por cliente", { type: "number", min: 1, step: 1 })}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancelar} disabled={enviando}>
          {soloLectura ? "Cerrar" : "Cancelar"}
        </Button>
        {!soloLectura && (
          <Button type="submit" disabled={enviando}>
            {enviando ? "Guardando…" : cupon ? "Guardar cambios" : "Crear cupón"}
          </Button>
        )}
      </div>
    </form>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Baja
// ──────────────────────────────────────────────────────────────────────────────

function FormularioBaja({ cupon, onHecho, onCancelar }: { cupon: Cupon; onHecho: () => void; onCancelar: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enviar = async (evento: SubmitEvent<HTMLFormElement>) => {
    evento.preventDefault();
    setEnviando(true);
    setError(null);
    const { ok, json } = await llamarApi<{ cupon: Cupon }>(`/api/ecommerce/cupones/${cupon.id}/baja`, {
      method: "PATCH",
      body: JSON.stringify({ motivo }),
    });
    setEnviando(false);
    if (!ok) {
      setError(json.error?.fieldErrors?.motivo?.[0] ?? json.error?.message ?? MENSAJE_GENERICO);
      return;
    }
    onHecho();
  };

  return (
    <form onSubmit={enviar} className="space-y-4">
      <Alert>
        <AlertDescription>Las compras ya iniciadas conservan el descuento hasta pagar o vencer.</AlertDescription>
      </Alert>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="cupon-motivo-baja">Motivo de la baja</Label>
        <textarea
          id="cupon-motivo-baja"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          rows={3}
          maxLength={500}
          disabled={enviando}
          placeholder="Ej: Fin de la campaña de otoño."
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancelar} disabled={enviando}>
          Volver
        </Button>
        <Button type="submit" variant="destructive" disabled={enviando || motivo.trim().length < 3}>
          {enviando ? "Dando de baja…" : "Confirmar baja"}
        </Button>
      </div>
    </form>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Listado
// ──────────────────────────────────────────────────────────────────────────────

type Modal =
  | { tipo: "crear" }
  | { tipo: "editar"; cupon: Cupon }
  | { tipo: "ver"; cupon: Cupon }
  | { tipo: "baja"; cupon: Cupon }
  | null;

export function CuponesCliente() {
  const [filtro, setFiltro] = useState<Filtro>("ACTIVOS");
  const [busqueda, setBusqueda] = useState("");
  const [consulta, setConsulta] = useState("");
  const [cupones, setCupones] = useState<Cupon[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [recargas, setRecargas] = useState(0);

  // El estado solo se toca en los callbacks de la promesa, nunca en el cuerpo
  // síncrono del efecto (regla react-hooks/set-state-in-effect); quien
  // dispara la recarga marca `cargando` antes.
  useEffect(() => {
    let cancelado = false;
    const params = new URLSearchParams({ estado: filtro, ...(consulta ? { q: consulta } : {}) });
    void llamarApi<{ items: Cupon[] }>(`/api/ecommerce/cupones?${params}`).then(({ ok, json }) => {
      if (cancelado) return;
      if (ok && json.data) {
        setCupones(json.data.items);
        setError(null);
      } else {
        setError(json.error?.message ?? MENSAJE_GENERICO);
      }
      setCargando(false);
    });
    return () => {
      cancelado = true;
    };
  }, [filtro, consulta, recargas]);

  const cambiarFiltro = (nuevo: Filtro) => {
    if (nuevo === filtro) return;
    setCargando(true);
    setAviso(null);
    setFiltro(nuevo);
  };
  const buscar = (evento: SubmitEvent<HTMLFormElement>) => {
    evento.preventDefault();
    const nueva = busqueda.trim().toUpperCase();
    if (nueva === consulta) return;
    setCargando(true);
    setAviso(null);
    setConsulta(nueva);
  };
  const cerrarYRecargar = () => {
    setModal(null);
    setCargando(true);
    setAviso(null);
    setRecargas((n) => n + 1);
  };
  /** Alta o edición exitosa: avisa y, tras un alta, limpia búsqueda y filtro para que el cupón nuevo se vea. */
  const guardadoExitoso = (creado: boolean) => {
    setModal(null);
    setCargando(true);
    if (creado) {
      setBusqueda("");
      setConsulta("");
      setFiltro("TODOS");
    }
    setAviso(creado ? "Cupón creado" : "Cupón actualizado");
    setRecargas((n) => n + 1);
  };

  const tituloModal =
    modal?.tipo === "crear"
      ? "Nuevo cupón"
      : modal?.tipo === "editar"
        ? `Editar ${modal.cupon.codigo}`
        : modal?.tipo === "ver"
          ? `${modal.cupon.codigo} (dado de baja)`
          : modal?.tipo === "baja"
            ? `Dar de baja ${modal.cupon.codigo}`
            : "";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(["ACTIVOS", "INACTIVOS", "TODOS"] as const).map((opcion) => (
          <Button
            key={opcion}
            type="button"
            variant={filtro === opcion ? "default" : "outline"}
            onClick={() => cambiarFiltro(opcion)}
            disabled={cargando}
          >
            {opcion === "ACTIVOS" ? "Activos" : opcion === "INACTIVOS" ? "Inactivos" : "Todos"}
          </Button>
        ))}
        <form onSubmit={buscar} className="flex gap-2">
          <Input
            aria-label="Buscar por código"
            placeholder="Buscar por código"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="w-48"
          />
          <Button type="submit" variant="outline" disabled={cargando}>
            Buscar
          </Button>
        </form>
        <Button type="button" className="ml-auto" onClick={() => setModal({ tipo: "crear" })}>
          Nuevo cupón
        </Button>
      </div>

      {aviso && (
        <Alert role="status">
          <AlertDescription>{aviso}</AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Beneficio</TableHead>
              <TableHead>Vigencia</TableHead>
              <TableHead>Límites (global / cliente)</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Usos</TableHead>
              <TableHead className="text-right">Reservas</TableHead>
              <TableHead className="text-right">Disponible</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {cargando ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground">
                  Cargando…
                </TableCell>
              </TableRow>
            ) : cupones.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground">
                  No hay cupones para mostrar.
                </TableCell>
              </TableRow>
            ) : (
              cupones.map((cupon) => (
                <TableRow key={cupon.id}>
                  <TableCell className="font-mono">{cupon.codigo}</TableCell>
                  <TableCell>{beneficio(cupon)}</TableCell>
                  <TableCell className="text-xs">
                    {fechaAr(cupon.vigente_desde)} → {fechaAr(cupon.vigente_hasta)}
                  </TableCell>
                  <TableCell>
                    {cupon.limite_uso_global ?? "Ilimitado"} / {cupon.limite_uso_por_cliente}
                  </TableCell>
                  <TableCell>
                    <Badge variant={VARIANTE_ESTADO[cupon.estado]}>{ETIQUETA_ESTADO[cupon.estado]}</Badge>
                  </TableCell>
                  <TableCell className="text-right">{cupon.usos_confirmados}</TableCell>
                  <TableCell className="text-right">{cupon.reservas_vigentes}</TableCell>
                  <TableCell className="text-right">{cupon.capacidad_disponible ?? "—"}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {cupon.is_active ? (
                      <>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setModal({ tipo: "editar", cupon })}>
                          Editar
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => setModal({ tipo: "baja", cupon })}
                        >
                          Dar de baja
                        </Button>
                      </>
                    ) : (
                      <Button type="button" size="sm" variant="ghost" onClick={() => setModal({ tipo: "ver", cupon })}>
                        Ver
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={modal !== null} onOpenChange={(abierto) => !abierto && setModal(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{tituloModal}</DialogTitle>
            {modal?.tipo === "ver" && (
              <DialogDescription>
                {/* `fechaAr` termina en "p. m." / "a. m.": se quita el punto final para no duplicar el separador. */}
                Dado de baja el {modal.cupon.deleted_at ? fechaAr(modal.cupon.deleted_at).replace(/\.$/, "") : "—"}. Motivo:{" "}
                {modal.cupon.deletion_reason ? textoMotivoBajaCupon(modal.cupon.deletion_reason) : "—"}
              </DialogDescription>
            )}
          </DialogHeader>
          {modal?.tipo === "baja" ? (
            <FormularioBaja cupon={modal.cupon} onHecho={cerrarYRecargar} onCancelar={() => setModal(null)} />
          ) : modal ? (
            <FormularioCupon
              key={modal.tipo === "crear" ? "nuevo" : modal.cupon.id}
              cupon={modal.tipo === "crear" ? null : modal.cupon}
              soloLectura={modal.tipo === "ver"}
              onGuardado={() => guardadoExitoso(modal.tipo === "crear")}
              onCancelar={() => setModal(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
