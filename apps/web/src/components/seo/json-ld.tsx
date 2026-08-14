interface JsonLdProps {
  data: Record<string, unknown> | Record<string, unknown>[];
}

/**
 * Renders schema.org JSON-LD structured data. Server component: the script is
 * emitted into the initial HTML for crawlers to parse.
 */
export default function JsonLd({ data }: JsonLdProps) {
  const payload = Array.isArray(data) ? data : [data];
  return (
    <>
      {payload.map((item, index) => (
        <script
          // oxlint-disable-next-line react/no-danger -- structured data must be emitted as raw script JSON
          // eslint-disable-next-line no-danger -- structured data must be emitted as raw script JSON; the payload is server-generated and JSON.stringify-safe
          dangerouslySetInnerHTML={{ __html: JSON.stringify(item) }}
          key={index}
          type="application/ld+json"
        />
      ))}
    </>
  );
}
