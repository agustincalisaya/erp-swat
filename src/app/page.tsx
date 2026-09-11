/**
 * @page RootDispatch
 * @route /
 * @description Punto de despacho de la raíz (task_cali_pagina_home.md §1.2)
 * — no renderiza contenido propio, solo resuelve sesión y redirige:
 * con sesión válida → `/home`, sin sesión → `/login`.
 */
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";

export default async function RootDispatch() {
  const session = await getServerSession();

  if (session) redirect("/home");
  redirect("/login");
}
