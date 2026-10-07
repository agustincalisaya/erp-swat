"use client";

import { useRef, useState, type FormEvent } from "react";
import { AlertTriangle, Camera, CheckCircle2, Keyboard, Loader2, PackageCheck } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CameraBarcodeScanner } from "@/components/inventario/escaner/CameraBarcodeScanner";
import { mensajeErrorRetiro, validarRetiroApi } from "./pick-pack-client";

export function RetiroPedidoPanel() {
  const [qrToken, setQrToken] = useState("");
  const [dni, setDni] = useState("");
  const [escaneando, setEscaneando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [numeroEntregado, setNumeroEntregado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const envioEnCurso = useRef(false);

  const puedeEnviar = qrToken.trim().length > 0 && qrToken.trim().length <= 128 && /^\d{7,8}$/.test(dni.trim());

  function capturarQr(contenido: string) {
    if (envioEnCurso.current) return;
    // El scanner ya entrega el contenido decodificado completo del QR.
    setQrToken(contenido);
    setEscaneando(false);
    setError(null);
    setNumeroEntregado(null);
  }

  async function entregar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (envioEnCurso.current || !puedeEnviar) return;
    envioEnCurso.current = true;
    setEnviando(true);
    setEscaneando(false);
    setError(null);
    setNumeroEntregado(null);
    try {
      const respuesta = await validarRetiroApi(qrToken.trim(), dni.trim());
      if (respuesta.ok && respuesta.data?.estado === "ENTREGADO") {
        setNumeroEntregado(respuesta.data.numero);
        setQrToken("");
        setDni("");
      } else {
        setError(mensajeErrorRetiro(respuesta.status));
      }
    } catch {
      setError(mensajeErrorRetiro(0));
    } finally {
      envioEnCurso.current = false;
      setEnviando(false);
    }
  }

  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardHeader>
        <CardTitle>Retiro Click &amp; Collect</CardTitle>
        <CardDescription>
          Escaneá el QR del cliente o ingresalo manualmente. Confirmá su DNI antes de entregar el pedido.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-3">
          <Button type="button" variant="outline" className="w-full sm:w-auto"
            disabled={enviando} aria-expanded={escaneando}
            onClick={() => setEscaneando((actual) => !actual)}>
            <Camera className="size-4" aria-hidden="true" />
            {escaneando ? "Cerrar cámara" : "Escanear QR"}
          </Button>
          {escaneando && (
            <div className="space-y-2">
              <CameraBarcodeScanner onDetect={capturarQr} activo={!enviando} />
              <p className="text-xs text-muted-foreground">Apuntá la cámara al QR de retiro.</p>
            </div>
          )}
        </div>

        <form onSubmit={(evento) => void entregar(evento)} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="retiro-qr" className="text-sm font-medium">QR de retiro</label>
            <div className="relative">
              <Keyboard className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input id="retiro-qr" type="password" autoComplete="off" maxLength={128}
                value={qrToken} onChange={(evento) => { setQrToken(evento.target.value); setError(null); setNumeroEntregado(null); }}
                placeholder="Ingresar código manualmente" disabled={enviando}
                className="pl-9 font-mono" />
            </div>
            <p className="text-xs text-muted-foreground">
              {qrToken ? "QR capturado. Ingresá el DNI para continuar." : "El contenido del QR no se muestra en pantalla."}
            </p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="retiro-dni" className="text-sm font-medium">DNI presentado</label>
            <Input id="retiro-dni" type="password" inputMode="numeric" autoComplete="off" maxLength={8}
              value={dni} onChange={(evento) => { setDni(evento.target.value); setError(null); setNumeroEntregado(null); }}
              placeholder="7 u 8 dígitos" disabled={enviando} />
          </div>
          <Button type="submit" size="lg" className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
            disabled={!puedeEnviar || enviando}>
            {enviando ? <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              : <PackageCheck className="size-4" aria-hidden="true" />}
            {enviando ? "Validando retiro…" : "Validar y entregar"}
          </Button>
        </form>

        {error && (
          <Alert variant="destructive" role="alert">
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {numeroEntregado && (
          <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900" role="status">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            <AlertDescription>
              Pedido <strong>{numeroEntregado}</strong> entregado correctamente.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
