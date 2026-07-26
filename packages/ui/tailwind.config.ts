import type { Config } from "tailwindcss";

import preset from "@cc/config/tailwind/preset";

const config: Config = {
  presets: [preset as Config],
  content: ["./src/**/*.{ts,tsx}", "./.storybook/**/*.{ts,tsx}"],
};

export default config;
