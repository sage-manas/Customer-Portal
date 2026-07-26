import type { Preview } from "@storybook/react";

import "../src/globals.css";

const preview: Preview = {
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    backgrounds: {
      default: "portal",
      values: [
        { name: "portal", value: "#f5f6fb" },
        { name: "dark", value: "#0f172a" },
      ],
    },
  },
};

export default preview;
