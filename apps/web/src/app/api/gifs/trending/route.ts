import { trendingKlipyGifs } from "@/lib/klipy";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  return trendingKlipyGifs(page);
}
