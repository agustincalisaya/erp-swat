"use client";

/**
 * @component ProgresoBarra
 * @description Barra de progreso de preparación Pick&Pack — el porcentaje
 * siempre proviene del backend (source of truth).
 */
import { cn } from "@/lib/utils";

export function ProgresoBarra({ porcentaje }: { porcentaje: number }) {
  const valor = Math.min(100, Math.max(0, porcentaje));
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-slate-200"
      role="progressbar"
      aria-valuenow={valor}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn(
          "h-full rounded-full transition-all",
          valor >= 100 ? "bg-emerald-500" : "bg-blue-500",
        )}
        style={{ width: `${valor}%` }}
      />
    </div>
  );
}
