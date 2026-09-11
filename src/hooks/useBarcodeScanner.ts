"use client";

/**
 * @module useBarcodeScanner
 * @description Hook de escaneo de códigos de barras/QR para la PWA de
 * depósito (HU-2, sección 8 del task).
 *
 * Estrategia:
 *  1. Detección nativa vía `window.BarcodeDetector` (alta tasa de FPS en
 *     Chrome/Android PWA) — se usa siempre que el navegador la soporte.
 *  2. Fallback automático a `@zxing/browser` (`BrowserMultiFormatReader`)
 *     para navegadores sin la API nativa (ej. Safari iOS).
 *
 * Al decodificar exitosamente, emite señal sonora (Web Audio API) y háptica
 * (`navigator.vibrate`) ANTES de invocar `onDetect`, y descarta detecciones
 * duplicadas del mismo código dentro de la ventana de `debounceMs`.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";

// ──────────────────────────────────────────────────────────────────────────────
// Tipado mínimo de la Barcode Detection API (aún experimental — no forma
// parte de los tipos DOM estándar de TypeScript).
// ──────────────────────────────────────────────────────────────────────────────

interface BarcodeDetectorResult {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<BarcodeDetectorResult[]>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats: string[] }): BarcodeDetectorLike;
}

type MotorEscaner = "nativo" | "zxing";

export interface UseBarcodeScannerOptions {
  /** Invocada con el código crudo decodificado (ya post beep/vibración). */
  onDetect: (codigo: string) => void;
  /** Ventana mínima (ms) entre dos detecciones aceptadas del mismo código. */
  debounceMs?: number;
  /** Permite pausar/reanudar el escaneo sin desmontar el componente. */
  activo?: boolean;
}

export interface UseBarcodeScannerResult {
  videoRef: RefObject<HTMLVideoElement | null>;
  isScanning: boolean;
  motor: MotorEscaner | null;
  error: string | null;
  /** Cámaras de video disponibles en el dispositivo (webcam interna, externa, trasera, etc.). */
  dispositivos: MediaDeviceInfo[];
  /** `deviceId` de la cámara actualmente seleccionada (`null` = automática/trasera por defecto). */
  dispositivoId: string | null;
  /** Cambia la cámara activa; reinicia el flujo de video con el nuevo dispositivo. */
  seleccionarDispositivo: (deviceId: string) => void;
  /** Refresca la lista de cámaras bajo demanda (ej. al abrir el selector). */
  actualizarDispositivos: () => Promise<void>;
}

const FORMATOS_NATIVOS = ["ean_13", "code_128", "qr_code"];

/** Equivalente de `FORMATOS_NATIVOS` para el motor de fallback `@zxing/library`. */
const FORMATOS_ZXING = [BarcodeFormat.EAN_13, BarcodeFormat.CODE_128, BarcodeFormat.QR_CODE];

/**
 * `MultiFormatReader` (usado por el fallback ZXing) llama `console.warn` en
 * CADA intento de decodificación fallido — varias veces por frame, muchos
 * frames por segundo — sin exponer forma de configurar/silenciar ese logger
 * (hardcodeado en la librería). Sin este filtro, tener el escaneo ZXing
 * activo unos minutos deja miles de warnings en la consola, tapando errores
 * reales. Se instala solo mientras el motor ZXing está efectivamente
 * escaneando y se restaura al pausar/desmontar (ver `iniciarZxing` y el
 * cleanup del efecto principal).
 */
const RUIDO_ZXING = /^MultiFormatReader: non-ReaderException/;

function silenciarRuidoZxing(): () => void {
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === "string" && RUIDO_ZXING.test(args[0])) return;
    originalWarn(...args);
  };
  return () => {
    console.warn = originalWarn;
  };
}

/** Beep corto (Web Audio API) al decodificar un código exitosamente. */
function reproducirBeep() {
  try {
    const AudioContextCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;

    const ctx = new AudioContextCtor();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 1200;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.12);
    oscillator.onended = () => ctx.close();
  } catch {
    // Web Audio no disponible — falla silenciosa, no bloquea el escaneo.
  }
}

function vibrar() {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate([100]);
  }
}

export function useBarcodeScanner({
  onDetect,
  debounceMs = 1500,
  activo = true,
}: UseBarcodeScannerOptions): UseBarcodeScannerResult {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [motor, setMotor] = useState<MotorEscaner | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dispositivos, setDispositivos] = useState<MediaDeviceInfo[]>([]);
  const [dispositivoId, setDispositivoId] = useState<string | null>(null);

  const seleccionarDispositivo = useCallback((deviceId: string) => {
    setDispositivoId(deviceId);
  }, []);

  /** Refresca la lista de cámaras — las etiquetas solo están disponibles luego de otorgado el permiso. */
  const actualizarDispositivos = useCallback(async () => {
    try {
      const todos = await navigator.mediaDevices.enumerateDevices();
      setDispositivos(todos.filter((d) => d.kind === "videoinput"));
    } catch {
      // enumerateDevices no disponible — el selector de cámara simplemente no se muestra.
    }
  }, []);

  // Ref para evitar recrear el efecto de inicialización de cámara en cada
  // render cuando el consumidor pasa un callback inline.
  const onDetectRef = useRef(onDetect);
  useEffect(() => {
    onDetectRef.current = onDetect;
  }, [onDetect]);

  const ultimoCodigoRef = useRef<{ codigo: string; timestamp: number } | null>(null);

  const manejarDeteccion = useCallback(
    (codigoCrudo: string) => {
      const ahora = Date.now();
      const ultimo = ultimoCodigoRef.current;
      if (ultimo && ultimo.codigo === codigoCrudo && ahora - ultimo.timestamp < debounceMs) {
        return; // Descarta duplicados del mismo código dentro de la ventana de debounce.
      }
      ultimoCodigoRef.current = { codigo: codigoCrudo, timestamp: ahora };

      reproducirBeep();
      vibrar();
      onDetectRef.current(codigoCrudo);
    },
    [debounceMs],
  );

  useEffect(() => {
    if (!activo) return;

    let detenido = false;
    let streamActivo: MediaStream | null = null;
    let controlesZxing: IScannerControls | null = null;
    let rafId: number | null = null;
    let restaurarConsola: (() => void) | null = null;

    async function iniciarNativo(BarcodeDetectorCtor: BarcodeDetectorConstructor, stream: MediaStream) {
      const video = videoRef.current;
      if (!video) return;

      const detector = new BarcodeDetectorCtor({ formats: FORMATOS_NATIVOS });

      // Se refuerzan como propiedades imperativas (no solo atributos JSX): algunos
      // navegadores no sincronizan `muted`/`playsInline` a tiempo para que
      // `play()` pase la política de autoplay, dejando el <video> en negro.
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;
      video.srcObject = stream;
      await video.play();

      if (detenido) return;
      setMotor("nativo");
      setIsScanning(true);
      void actualizarDispositivos();

      const loop = async () => {
        if (detenido || !videoRef.current) return;
        try {
          const resultados = await detector.detect(videoRef.current);
          if (resultados[0]?.rawValue) {
            manejarDeteccion(resultados[0].rawValue);
          }
        } catch {
          // Frame no decodificable — se reintenta en el próximo tick.
        }
        rafId = requestAnimationFrame(loop);
      };
      rafId = requestAnimationFrame(loop);
    }

    async function iniciarZxing() {
      const video = videoRef.current;
      if (!video) return;

      const hints = new Map<DecodeHintType, unknown>();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, FORMATOS_ZXING);

      restaurarConsola = silenciarRuidoZxing();
      const reader = new BrowserMultiFormatReader(hints);
      controlesZxing = await reader.decodeFromVideoDevice(
        dispositivoId ?? undefined,
        video,
        (resultado) => {
          if (resultado) {
            manejarDeteccion(resultado.getText());
          }
        },
      );

      if (detenido) {
        controlesZxing.stop();
        return;
      }
      setMotor("zxing");
      setIsScanning(true);
      void actualizarDispositivos();
    }

    async function iniciar() {
      setError(null);
      try {
        const BarcodeDetectorCtor = (
          window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }
        ).BarcodeDetector;

        if (BarcodeDetectorCtor) {
          const constraints: MediaTrackConstraints = dispositivoId
            ? { deviceId: { exact: dispositivoId } }
            : { facingMode: "environment" };
          const stream = await navigator.mediaDevices.getUserMedia({
            video: constraints,
            audio: false,
          });
          streamActivo = stream;

          if (detenido) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }
          await iniciarNativo(BarcodeDetectorCtor, stream);
        } else {
          await iniciarZxing();
        }
      } catch (err) {
        console.error("[useBarcodeScanner] Error al iniciar el escáner:", err);
        setError(
          err instanceof DOMException && err.name === "NotAllowedError"
            ? "Permiso de cámara denegado. Habilitalo en la configuración del navegador."
            : "No se pudo iniciar la cámara del dispositivo.",
        );
        setIsScanning(false);
      }
    }

    iniciar();

    return () => {
      detenido = true;
      setIsScanning(false);
      if (rafId !== null) cancelAnimationFrame(rafId);
      streamActivo?.getTracks().forEach((track) => track.stop());
      controlesZxing?.stop();
      restaurarConsola?.();
    };
  }, [activo, dispositivoId, manejarDeteccion, actualizarDispositivos]);

  return {
    videoRef,
    isScanning,
    motor,
    error,
    dispositivos,
    dispositivoId,
    seleccionarDispositivo,
    actualizarDispositivos,
  };
}
