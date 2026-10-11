// Bun and Turbopack both read a `.sql` import with the `type: "text"` attribute
// as its raw contents. This declaration is what teaches TypeScript the shape.
declare module "*.sql" {
  const contents: string;
  export default contents;
}
