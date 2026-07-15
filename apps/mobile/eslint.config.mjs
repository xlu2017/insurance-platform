import config from "@autopilot/config/eslint";

export default [
  ...config,
  {
    ignores: [".expo/**", "expo-env.d.ts"],
  },
];
