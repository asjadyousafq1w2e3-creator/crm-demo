import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

export default [
  { ignores: [".next/**", "node_modules/**", "prisma/generated/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // The campaign and mail layers deliberately use `any` in a few provider-boundary spots
      // where the Google client types are looser than ours; everything else stays typed.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
];
