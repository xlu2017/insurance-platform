#!/usr/bin/env node
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const root = path.resolve(__dirname, "..");
const envFile = path.join(root, "apps", "mobile", ".env.local");
const apkDir = path.join(
  root,
  "apps",
  "mobile",
  "android",
  "app",
  "build",
  "outputs",
  "apk",
  "release",
);
const port = Number(process.argv[2] || process.env.APK_PORT || 18082);

async function parseEnv() {
  const entries = {};
  try {
    const text = await fs.readFile(envFile, "utf8");
    for (const line of text.split("\n")) {
      const [key, ...rest] = line.split("=");
      if (!key || rest.length === 0) continue;
      entries[key.trim()] = rest.join("=").trim();
    }
  } catch {
    // ignore
  }
  return entries;
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.url === "/config" && req.method === "GET") {
    const env = await parseEnv();
    const config = {
      supabaseUrl: env.EXPO_PUBLIC_SUPABASE_URL || "",
      supabaseAnonKey: env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "",
      demoEmail: env.EXPO_PUBLIC_DEMO_EMAIL,
      demoPassword: env.EXPO_PUBLIC_DEMO_PASSWORD,
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(config));
    return;
  }

  // Serve static files from the APK directory.
  let filePath = path.join(apkDir, decodeURIComponent(req.url || "/"));
  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, "app-release.apk");
    }
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    const contentType =
      ext === ".apk"
        ? "application/vnd.android.package-archive"
        : "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  console.log(`Config endpoint: http://localhost:${port}/config`);
  console.log(`APK endpoint: http://localhost:${port}/app-release.apk`);
});
