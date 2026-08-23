interface JsonLdProps {
  data: Record<string, unknown> | Record<string, unknown>[];
}

// JSON.stringify leaves "<" literal, so an attacker-controlled string (display
// name, bio, tag, URL segment) containing "</script>" would close this element
// during HTML parsing and execute a following script. Escaping the dangerous
// characters as unicode escapes keeps the payload valid JSON while making a
// script-context breakout impossible.
function serializeJsonLd(value: unknown): string {
  return (
    JSON.stringify(value)
      .replaceAll("<", "\\u003c")
      .replaceAll(">", "\\u003e")
      .replaceAll("&", "\\u0026")
      // The literal line separators are valid JSON but terminate a JavaScript
      // string literal in script context, so escape them as well.
      .replaceAll("\u2028", "\\u2028")
      .replaceAll("\u2029", "\\u2029")
  );
}

// Renders schema.org JSON-LD structured data. Server component: the script is
// emitted into the initial HTML for crawlers to parse.
export default function JsonLd({ data }: JsonLdProps) {
  const payload = Array.isArray(data) ? data : [data];
  return (
    <>
      {payload.map((item, index) => (
        <script
          // oxlint-disable-next-line react/no-danger -- structured data must be emitted as raw script JSON
          // eslint-disable-next-line no-danger -- structured data must be emitted as raw script JSON; serializeJsonLd escapes every sequence that could terminate the script context
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(item) }}
          key={index}
          type="application/ld+json"
        />
      ))}
    </>
  );
}
