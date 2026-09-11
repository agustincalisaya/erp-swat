import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ message: "En construcción" }, { status: 501 });
}