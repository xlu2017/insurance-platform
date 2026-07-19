const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.resolver.blockList = [
  /\.next\/.*/,
  /node_modules\/\.cache\/.*/,
  /coverage\/.*/,
  /dist\/.*/,
  /web-build\/.*/,
  /\.expo\/.*/,
  /supabase\/.temp\/.*/,
];

module.exports = config;
