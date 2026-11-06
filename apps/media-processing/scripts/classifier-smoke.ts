import { evaluateSwiftformer } from "../src/analyze/classification/swiftformer";

const [imagePath] = process.argv.slice(2);
if (!imagePath) {
  throw new Error("Usage: bun scripts/classifier-smoke.ts image.jpg");
}
const result = await evaluateSwiftformer(imagePath);
console.info(JSON.stringify(result));
