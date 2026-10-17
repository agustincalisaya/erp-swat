"use client";

import { useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ImageOff } from "lucide-react";
import styles from "@/app/(tienda)/tienda/catalogo/[producto_web_id]/detalle.module.css";

export function GaleriaProducto({ titulo, fotos }: { titulo: string; fotos: string[] }) {
  const [seleccionada, setSeleccionada] = useState(0);
  const reducirMovimiento = useReducedMotion();
  const foto = fotos[seleccionada];

  return (
    <section className={styles.gallery} aria-label={`Fotografías de ${titulo}`}>
      <div className={styles.mainPhoto}>
        {foto ? (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={foto} className={styles.photoFrame}
              initial={reducirMovimiento ? false : { opacity: 0 }}
              animate={{ opacity: 1 }} exit={reducirMovimiento ? undefined : { opacity: 0 }}
              transition={{ duration: reducirMovimiento ? 0 : 0.2 }}>
              <Image src={foto} alt={`${titulo}, fotografía ${seleccionada + 1} de ${fotos.length}`}
                fill priority={seleccionada === 0} sizes="(max-width: 860px) 100vw, 55vw"
                unoptimized={!foto.startsWith("/")} />
            </motion.div>
          </AnimatePresence>
        ) : (
          <div className={styles.photoEmpty}><ImageOff aria-hidden size={34} /><span>Fotografía no disponible</span></div>
        )}
      </div>
      {fotos.length > 1 && (
        <div className={styles.thumbnails} role="group" aria-label="Seleccionar fotografía">
          {fotos.map((url, indice) => (
            <button type="button" key={`${url}-${indice}`} className={styles.thumbnail}
              aria-label={`Ver fotografía ${indice + 1} de ${fotos.length}`}
              aria-pressed={indice === seleccionada} onClick={() => setSeleccionada(indice)}>
              <Image src={url} alt="" fill sizes="96px" unoptimized={!url.startsWith("/")} />
            </button>
          ))}
        </div>
      )}
      {fotos.length > 0 && <p className={styles.galleryCount}>Fotografía {seleccionada + 1} / {fotos.length}</p>}
    </section>
  );
}
