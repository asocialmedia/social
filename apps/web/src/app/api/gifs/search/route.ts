import { searchKlipyGifs } from "@/lib/klipy";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (!q) {
    return Response.json({ gifs: [] });
  }
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  return searchKlipyGifs(q, page);
}
