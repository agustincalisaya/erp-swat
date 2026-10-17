"use client";

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import styles from "@/app/(tienda)/tienda/catalogo/catalogo.module.css";

export function TarjetaCatalogoMotion({ children }: { children: ReactNode }) {
  const reducirMovimiento = useReducedMotion();
  return (
    <motion.li className={styles.productItem} initial={false}
      whileHover={reducirMovimiento ? undefined : { y: -3 }}
      transition={{ duration: 0.22, ease: "easeOut" }}>
      {children}
    </motion.li>
  );
}
