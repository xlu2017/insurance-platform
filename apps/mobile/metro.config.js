const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

const rootDir = path.resolve(__dirname, "../..");
const escapedRoot = rootDir.replace(/[.*+?^${}()|[\]\\]/g, "\\\\$&");

// Block generated/irrelevant workspace directories without matching node_modules/dist paths.
const blockedWorkspaceDirs =
  "(dist|apps/[^/]+/dist|packages/[^/]+/dist|apps/[^/]+/\\.expo|packages/[^/]+/\\.expo|apps/[^/]+/\\.next|apps/[^/]+/web-build|web-build|coverage|supabase/\\.temp|node_modules/\\.cache)";
config.resolver.blockList = [new RegExp(`^${escapedRoot}/${blockedWorkspaceDirs}/.*`)];

module.exports = config;
