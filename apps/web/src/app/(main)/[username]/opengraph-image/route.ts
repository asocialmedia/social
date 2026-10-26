import Image from "@/app/(main)/users/[username]/opengraph-image";

export function GET(
  _request: Request,
  context: { params: Promise<{ username: string }> }
) {
  return Image(context);
}
