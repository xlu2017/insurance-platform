import config from "@autopilot/config/eslint";

export default [
  ...config,
  {
    ignores: ["next-env.d.ts", ".next/**"],
  },
];
