import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const dist = resolve(root, "dist");
const env = {};
const buildId = Date.now().toString(36);

async function loadEnvFile(fileName) {
  try {
    const content = await readFile(resolve(root, fileName), "utf8");
    content.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const separator = trimmed.indexOf("=");
      if (separator === -1) return;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim();
      env[key] = value;
    });
  } catch {
    // Optional env file.
  }
}

await loadEnvFile(".env");
await loadEnvFile(".env.local");

function envValue(key) {
  return process.env[key] || env[key] || "";
}

await rm(dist, { recursive: true, force: true });
await mkdir(resolve(dist, "assets"), { recursive: true });

await build({
  entryPoints: [resolve(root, "src/main.jsx")],
  bundle: true,
  format: "iife",
  target: ["safari15", "chrome100"],
  outfile: resolve(dist, "assets/app.js"),
  minify: true,
  sourcemap: false,
  loader: {
    ".js": "jsx",
    ".jsx": "jsx",
  },
  define: {
    "import.meta.env.NEXT_PUBLIC_SUPABASE_URL": JSON.stringify(envValue("NEXT_PUBLIC_SUPABASE_URL")),
    "import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(envValue("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")),
    "import.meta.env.NEXT_PUBLIC_ADMIN_EMAIL": JSON.stringify(envValue("NEXT_PUBLIC_ADMIN_EMAIL")),
    "import.meta.env.NEXT_PUBLIC_SITE_URL": JSON.stringify(envValue("NEXT_PUBLIC_SITE_URL")),
    "import.meta.env.NEXT_PUBLIC_APP_URL": JSON.stringify(envValue("NEXT_PUBLIC_APP_URL")),
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(envValue("VITE_SUPABASE_URL")),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(envValue("VITE_SUPABASE_PUBLISHABLE_KEY")),
    "import.meta.env.VITE_ADMIN_EMAIL": JSON.stringify(envValue("VITE_ADMIN_EMAIL")),
    "import.meta.env.VITE_SITE_URL": JSON.stringify(envValue("VITE_SITE_URL")),
    "import.meta.env.VITE_APP_URL": JSON.stringify(envValue("VITE_APP_URL")),
  },
  jsx: "automatic",
});

await cp(resolve(root, "public"), dist, { recursive: true });

await writeFile(
  resolve(dist, "index.html"),
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#000000" />
    <meta name="color-scheme" content="dark" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="HourLog" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="format-detection" content="telephone=no" />
    <title>HourLog</title>
    <link rel="manifest" href="manifest.webmanifest" />
    <link rel="apple-touch-icon" href="apple-touch-icon.png" />
    <link rel="icon" href="icon.svg" />
    <link rel="stylesheet" href="assets/app.css?v=${buildId}" />
    <script defer src="assets/app.js?v=${buildId}"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`,
  "utf8"
);
