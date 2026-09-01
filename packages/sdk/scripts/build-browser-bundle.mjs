import { build } from "esbuild";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scripts = resolve(fileURLToPath(new URL(".", import.meta.url)));
const sdk = resolve(scripts, "..");
const repo = resolve(sdk, "../..");
const outfile = resolve(repo, "packages/web/assets/js/facet-sdk.js");

await build({
  entryPoints: [resolve(sdk, "src/index.ts")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile,
  sourcemap: false,
  minify: true,
  legalComments: "none",
  treeShaking: true,
});

console.log("built browser SDK bundle: " + outfile);
