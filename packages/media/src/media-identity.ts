// Opaque asset identity survives downloads without copying camera, GPS, or
// private author metadata. It is a lookup hint; the server still compares
// content and checks visibility before attributing a re-upload.
export function mediaIdentityXmp(mediaId: string, aiGenerated = false): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(mediaId)) {
    throw new Error("Invalid media identity");
  }
  const aiDeclaration = aiGenerated
    ? ' xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"'
    : "";
  return `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:asm="https://asocialmedia.cc/ns/media/1.0/" asm:mediaId="${mediaId}" asm:platform="asocialmedia.cc"${aiDeclaration}/></rdf:RDF></x:xmpmeta>`;
}

export function readMediaIdentityXmp(xmp: string | undefined): string | null {
  if (!xmp?.includes('xmlns:asm="https://asocialmedia.cc/ns/media/1.0/"')) {
    return null;
  }
  return (
    /asm:mediaId="(?<mediaId>[A-Za-z0-9_-]{1,128})"/.exec(xmp)?.groups
      ?.mediaId ?? null
  );
}

export function mediaReshareLabel(media: {
  attributionPublic?: boolean;
  generatedAltText?: string | null;
  originalProvenanceId?: string | null;
}): string | null {
  return media.attributionPublic === true &&
    media.originalProvenanceId &&
    media.generatedAltText?.startsWith("originally from @")
    ? media.generatedAltText
    : null;
}
