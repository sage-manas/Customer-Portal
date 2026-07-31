import nextPlugin from "@next/eslint-plugin-next";
import base from "@cc/config/eslint/base";

export default [
  ...base,
  {
    plugins: { "@next/next": nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
  },
  { ignores: [".next/**", "next-env.d.ts"] },
];
