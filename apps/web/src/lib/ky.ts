import ky from "ky";

import { parseApiJson } from "./posts/parse-api-json";

const kyInstance = ky.create({
  hooks: {
    afterResponse: [
      ({ request, response }) => {
        if (
          typeof window !== "undefined" &&
          response.ok &&
          request.method !== "GET" &&
          /\/api\/(?:posts\/|protocols\/bluesky\/interactions)/u.test(
            request.url
          )
        ) {
          window.setTimeout(
            () => window.dispatchEvent(new Event("network:learned")),
            700
          );
        }
      },
    ],
  },
  parseJson: parseApiJson,
});

export default kyInstance;
