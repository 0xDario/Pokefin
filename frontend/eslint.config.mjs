// Flat config for ESLint 9 + Next 16.
// `eslint-config-next` v16 ships flat-config arrays directly; no
// FlatCompat needed (FlatCompat hits a circular-JSON crash on this
// combo).
import nextConfig from "eslint-config-next";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "out/**",
      "public/**",
      "next-env.d.ts",
      // Config files written as CommonJS for the tooling that loads
      // them (jest, postcss, etc.). Not part of the app source.
      "jest.config.js",
      "jest.setup.ts",
      "postcss.config.mjs",
      "next.config.ts",
      "sentry.*.config.ts",
    ],
  },
  ...nextConfig,
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
