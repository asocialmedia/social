import ky from "ky";

import { parseApiJson } from "./posts/parse-api-json";

const kyInstance = ky.create({ parseJson: parseApiJson });

export default kyInstance;
