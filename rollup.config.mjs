import typescript from "@rollup/plugin-typescript";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import { visualizer } from "rollup-plugin-visualizer";

/**
 * When ANALYZE_BUNDLE=true, generates bundle-stats.html and bundle-stats.json
 * in the dist/ directory for visualizing module sizes and tree-shaking effectiveness.
 *
 * Usage: ANALYZE_BUNDLE=true npm run build
 */
const isAnalyze = process.env.ANALYZE_BUNDLE === "true";

const external = [
  "react",
  "react-dom",
  "@adaptic/backend",
  "date-fns",
  "date-fns-tz",
  "date-holidays",
  "ms",
  "node-fetch",
];

// Shared TypeScript configuration.
//
// Test sources are excluded from the bundled programs. They are not published,
// so they contribute nothing to `dist/types`, and a test that imports build
// tooling from outside `src/` would otherwise drag that tooling into the
// declaration emit — where its output path falls outside rootDir and the build
// fails. Typechecking still covers tests: `tsc --noEmit` reads tsconfig
// directly and is unaffected by this.
const mainTsConfig = {
  tsconfig: "./tsconfig.json",
  exclude: ["src/__tests__/**", "**/*.test.ts"],
};

// Test-specific TypeScript configuration
const testTsConfig = {
  ...mainTsConfig,
  compilerOptions: {
    declaration: false,
    declarationDir: undefined,
    declarationMap: false,
  },
};

/**
 * Creates bundle analysis plugins when ANALYZE_BUNDLE=true.
 * Generates an interactive HTML treemap and a JSON report.
 */
function getBundleAnalysisPlugins() {
  if (!isAnalyze) return [];
  return [
    visualizer({
      filename: "dist/bundle-stats.html",
      open: false,
      gzipSize: true,
      brotliSize: true,
      template: "treemap",
    }),
    visualizer({
      filename: "dist/bundle-stats.json",
      open: false,
      gzipSize: true,
      brotliSize: true,
      template: "raw-data",
    }),
  ];
}

export default [
  // Main library build
  {
    input: "src/index.ts",
    output: [
      {
        dir: "dist",
        format: "esm",
        entryFileNames: "[name].mjs",
        sourcemap: true,
      },
      {
        dir: "dist",
        format: "cjs",
        entryFileNames: "[name].cjs",
        sourcemap: true,
      },
    ],
    external,
    plugins: [
      typescript(mainTsConfig),
      resolve({
        extensions: [".ts", ".js", ".json"],
      }),
      commonjs({
        ignoreDynamicRequires: true,
        ignore: ["google-auth-library"],
      }),
      json(),
      ...getBundleAnalysisPlugins(),
    ],
  },
  // Test build
  {
    input: "src/test.ts",
    output: {
      dir: "dist",
      format: "esm",
      entryFileNames: "test.js",
      sourcemap: true,
    },
    external,
    plugins: [
      typescript(testTsConfig),
      resolve({
        extensions: [".ts", ".js", ".json"],
      }),
      commonjs({
        ignoreDynamicRequires: true,
        ignore: ["google-auth-library"],
      }),
      json(),
    ],
  },
];
