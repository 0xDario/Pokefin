// TypeScript 6 requires explicit type declarations for side-effect imports of
// non-code assets. Next.js handles CSS at build time; this declaration just
// satisfies the type checker for `import "./globals.css"` and similar.
declare module "*.css";
