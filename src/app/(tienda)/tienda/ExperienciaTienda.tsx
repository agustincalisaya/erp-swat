"use client";

import Image from "next/image";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, ArrowUpRight, MapPin, SlidersHorizontal, ShoppingBag } from "lucide-react";
import styles from "./experiencia.module.css";

export type ProductoDestacado = {
  id: string;
  titulo: string;
  categoria: string;
  foto: string | null;
  precio: string | null;
  comprable: boolean;
};
export type CategoriaDestacada = { nombre: string; foto: string | null };

const entrada = { opacity: 0, y: 18 };
const visible = { opacity: 1, y: 0 };

export function ExperienciaTienda({
  destacados, categorias, errorCatalogo,
}: {
  destacados: ProductoDestacado[];
  categorias: CategoriaDestacada[];
  errorCatalogo: boolean;
}) {
  const reducirMovimiento = useReducedMotion();

  return (
    <div className={styles.experiencia} data-tienda-wide>
      <section className={styles.hero} aria-labelledby="home-title">
        <Image className={styles.heroImage} src="/tienda-assets/hero-valle.webp" alt="Paisaje de montaña al atardecer con una persona vestida en tonos oliva" fill priority sizes="100vw" />
        <div className={styles.heroShade} aria-hidden="true" />
        <motion.div className={styles.heroContent} initial={entrada} animate={visible} transition={{ duration: reducirMovimiento ? 0 : 0.65, ease: "easeOut" }}>
          <p className={styles.eyebrow}>SWAT / INDUMENTARIAS</p>
          <h1 id="home-title">PREPARADO<br />PARA CADA<br /><em>DESAFÍO.</em></h1>
          <p className={styles.heroLead}>Indumentaria, calzado y accesorios para elegir tu próximo equipo con confianza.</p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryCta} href="/tienda/catalogo">Explorar catálogo <ArrowRight size={18} aria-hidden="true" /></Link>
            <Link className={styles.secondaryCta} href="/tienda#categorias">Ver categorías <ArrowUpRight size={17} aria-hidden="true" /></Link>
          </div>
        </motion.div>
        <span className={styles.heroSideNote} aria-hidden="true">SWAT INDUMENTARIAS · SALTA</span>
      </section>

      <section id="categorias" className={styles.section} aria-labelledby="categorias-title">
        <div className={styles.sectionHead}>
          <div><p className={styles.kicker}>01 / EXPLORÁ</p><h2 id="categorias-title">Encontrá tu camino.</h2></div>
          <p>Recorré las categorías disponibles en nuestro catálogo.</p>
        </div>
        {errorCatalogo ? (
          <p className={styles.state}>No pudimos cargar las categorías en este momento. <Link href="/tienda/catalogo">Ir al catálogo</Link></p>
        ) : categorias.length ? (
          <div className={styles.categories}>
            {categorias.map((categoria, indice) => (
              <motion.div className={styles.categoryCard} key={categoria.nombre}
                initial={entrada} whileInView={reducirMovimiento ? undefined : visible} viewport={{ once: true, amount: 0.15 }}
                transition={{ duration: reducirMovimiento ? 0 : 0.5, delay: reducirMovimiento ? 0 : Math.min(indice, 3) * 0.07 }}
                whileHover={reducirMovimiento ? undefined : { y: -4 }}>
                <Link href={`/tienda/catalogo?categoria=${encodeURIComponent(categoria.nombre)}`} aria-label={`Explorar ${categoria.nombre}`}>
                  {categoria.foto ? <Image src={categoria.foto} alt="" fill sizes="(max-width: 700px) 80vw, 35vw" unoptimized={!categoria.foto.startsWith("/")} /> : <span className={styles.categoryFallback} aria-hidden="true">SWAT</span>}
                  <span className={styles.categoryShade} aria-hidden="true" />
                  <span className={styles.categoryNumber}>0{indice + 1} / CATEGORÍA</span>
                  <span className={styles.categoryTitle}>{categoria.nombre} <ArrowUpRight size={22} aria-hidden="true" /></span>
                </Link>
              </motion.div>
            ))}
          </div>
        ) : <p className={styles.state}>Aún no hay categorías publicadas. <Link href="/tienda/catalogo">Ver catálogo</Link></p>}
      </section>

      <section className={`${styles.section} ${styles.productsSection}`} aria-labelledby="productos-title">
        <div className={styles.sectionHead}>
          <div><p className={styles.kicker}>02 / SELECCIÓN DE LA TIENDA</p><h2 id="productos-title">Listos para elegir.</h2></div>
          <Link className={styles.textLink} href="/tienda/catalogo">Ver todo el catálogo <ArrowUpRight size={18} aria-hidden="true" /></Link>
        </div>
        {errorCatalogo ? (
          <p className={styles.state}>No pudimos cargar los productos en este momento. <Link href="/tienda/catalogo">Reintentar en el catálogo</Link></p>
        ) : destacados.length ? (
          <div className={styles.products}>
            {destacados.map((producto, indice) => (
              <motion.div key={producto.id} className={styles.productCard}
                initial={entrada} whileInView={reducirMovimiento ? undefined : visible} viewport={{ once: true, amount: 0.15 }}
                transition={{ duration: reducirMovimiento ? 0 : 0.5, delay: reducirMovimiento ? 0 : indice * 0.08 }}
                whileHover={reducirMovimiento ? undefined : { y: -4 }}>
                <Link href={`/tienda/catalogo/${producto.id}`} aria-label={`Ver ${producto.titulo}`}>
                  <div className={styles.productImage}>
                    {producto.foto ? <Image src={producto.foto} alt={producto.titulo} fill sizes="(max-width: 700px) 88vw, 30vw" unoptimized={!producto.foto.startsWith("/")} /> : <span className={styles.productFallback}>Imagen no disponible</span>}
                    <span className={styles.productArrow}><ArrowUpRight size={18} aria-hidden="true" /></span>
                  </div>
                  <div className={styles.productMeta}><span>{producto.categoria}</span><span>{producto.comprable ? "Disponible" : "No disponible"}</span></div>
                  <h3>{producto.titulo}</h3>
                  {producto.precio && <p className={styles.price}>Desde {producto.precio}</p>}
                </Link>
              </motion.div>
            ))}
          </div>
        ) : <p className={styles.state}>Todavía no hay productos publicados para destacar. <Link href="/tienda/catalogo">Explorar catálogo</Link></p>}
      </section>

      <section className={styles.editorial} aria-labelledby="editorial-title">
        <Image src="/tienda-assets/equipo-amanecer.webp" alt="Equipo junto a un paisaje de montaña al amanecer" fill sizes="100vw" />
        <div className={styles.editorialShade} aria-hidden="true" />
        <motion.div className={styles.editorialContent} initial={entrada} whileInView={reducirMovimiento ? undefined : visible} viewport={{ once: true, amount: 0.3 }} transition={{ duration: reducirMovimiento ? 0 : 0.6 }}>
          <p className={styles.eyebrow}>SWAT / CADA DÍA CUENTA</p>
          <h2 id="editorial-title">Lo que sigue<br />empieza acá.</h2>
          <p>Una selección para acompañar tus planes, tus recorridos y tu manera de moverte.</p>
          <Link className={styles.primaryCta} href="/tienda/catalogo">Descubrir la colección <ArrowRight size={18} aria-hidden="true" /></Link>
        </motion.div>
      </section>

      <section className={styles.benefits} aria-label="Comprar en SWAT">
        <div><SlidersHorizontal aria-hidden="true" /><h2>Elegí tu variante</h2><p>Consultá talles, colores y opciones disponibles en cada producto.</p></div>
        <div><ShoppingBag aria-hidden="true" /><h2>Disponibilidad visible</h2><p>Revisá el estado de cada producto antes de agregarlo al carrito.</p></div>
        <div><MapPin aria-hidden="true" /><h2>Retiro en Salta</h2><p>Seleccioná retiro en Sucursal Salta al finalizar tu compra.</p></div>
      </section>
    </div>
  );
}
