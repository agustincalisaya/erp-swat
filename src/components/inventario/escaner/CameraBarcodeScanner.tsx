"use client";

/**
 * @component CameraBarcodeScanner
 * @description Visor de cámara adaptable (HU-2, sección 8) con marco de
 * escaneo en paleta azul táctico. Delega la lectura de códigos en
 * `useBarcodeScanner` (Barcode Detection API nativa + fallback ZXing).
 */
import { AlertTriangle, Camera } from "lucide-react";
import { useBarcodeScanner } from "@/hooks/useBarcodeScanner";
import { cn } from "@/lib/utils";

interface CameraBarcodeScannerProps {
  onDetect: (codigo: string) => void;
  /** Permite pausar la cámara (ej. mientras se confirma un ingreso) sin desmontar el componente. */
  activo?: boolean;
  className?: string;
}

export function CameraBarcodeScanner({
  onDetect,
  activo = true,
  className,
}: CameraBarcodeScannerProps) {
  const { videoRef, isScanning, motor, error, dispositivos, dispositivoId, seleccionarDispositivo } =
    useBarcodeScanner({ onDetect, activo });

  return (
    <div
      className={cn(
        "relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-slate-900 sm:aspect-video",
        className,
      )}
    >
      <video
        ref={videoRef}
        className="w-full h-full object-cover"
        autoPlay
        playsInline
        muted
        aria-label="Vista de cámara para escaneo de códigos"
      />

      {/* Selector de cámara — solo visible cuando hay más de un dispositivo (webcam interna/externa). */}
      {dispositivos.length > 1 && (
        <div className="absolute top-3 right-3 z-10">
          <select
            value={dispositivoId ?? ""}
            onChange={(e) => seleccionarDispositivo(e.target.value)}
            className="rounded-md border border-white/20 bg-slate-900/85 px-2 py-1 text-xs font-medium text-white shadow-sm outline-none focus:ring-2 focus:ring-blue-400"
            aria-label="Seleccionar cámara"
          >
            {!dispositivoId && <option value="">Cámara automática</option>}
            {dispositivos.map((dispositivo, indice) => (
              <option key={dispositivo.deviceId || indice} value={dispositivo.deviceId}>
                {dispositivo.label || `Cámara ${indice + 1}`}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Marco de escaneo — paleta azul táctico */}
      {!error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8 sm:p-12">
          <div className="relative aspect-square w-full max-w-xs rounded-xl border-2 border-blue-400/80 shadow-[0_0_0_9999px_rgba(15,23,42,0.45)]">
            <span className="absolute -top-0.5 -left-0.5 size-6 rounded-tl-xl border-t-4 border-l-4 border-blue-400" />
            <span className="absolute -top-0.5 -right-0.5 size-6 rounded-tr-xl border-t-4 border-r-4 border-blue-400" />
            <span className="absolute -bottom-0.5 -left-0.5 size-6 rounded-bl-xl border-b-4 border-l-4 border-blue-400" />
            <span className="absolute -bottom-0.5 -right-0.5 size-6 rounded-br-xl border-b-4 border-r-4 border-blue-400" />
            {isScanning && (
              <div className="absolute inset-x-6 top-1/2 h-0.5 -translate-y-1/2 animate-pulse bg-blue-400 shadow-[0_0_8px_2px_rgba(96,165,250,0.8)]" />
            )}
          </div>
        </div>
      )}

      {/* Indicador de motor activo */}
      {isScanning && !error && (
        <div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-blue-600/90 px-2.5 py-1 text-xs font-semibold text-white shadow">
          <span className="size-1.5 animate-pulse rounded-full bg-white" aria-hidden="true" />
          {motor === "nativo" ? "Escaneo nativo" : "Escaneo activo"}
        </div>
      )}

      {/* Cámara inicializando */}
      {!isScanning && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-300">
          <Camera className="size-8 animate-pulse" aria-hidden="true" />
          <p className="text-sm">Iniciando cámara…</p>
        </div>
      )}

      {/* Error — permiso denegado o cámara no disponible */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-900/95 px-6 text-center text-slate-200">
          <AlertTriangle className="size-8 text-amber-400" aria-hidden="true" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}
    </div>
  );
}
