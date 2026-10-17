"use client";

import type { ReactNode } from "react";
import { MotionConfig } from "motion/react";

/** Configuración de movimiento limitada a la tienda; mantiene las páginas como Server Components. */
export function TiendaMotionProvider({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      {children}
    </MotionConfig>
  );
}
