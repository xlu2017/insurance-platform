/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@autopilot/schemas",
    "@autopilot/insurance-engine",
    "@autopilot/database",
    "@autopilot/design-tokens",
  ],
};

export default nextConfig;
