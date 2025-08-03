import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';

const external = [
  'react',
  'react-dom',
  '@adaptic/backend-legacy',
  'date-fns',
  'date-fns-tz',
  'date-holidays',
  'ms',
  'node-fetch',
];

// Shared TypeScript configuration
const mainTsConfig = {
  tsconfig: './tsconfig.json'
};

// Test-specific TypeScript configuration
const testTsConfig = {
  ...mainTsConfig,
  compilerOptions: {
    declaration: false,
    declarationDir: undefined,
    declarationMap: false
  }
};

export default [
  // Main library build
  {
    input: 'src/index.ts',
    output: [
      {
        dir: 'dist',
        format: 'esm',
        entryFileNames: '[name].mjs',
        sourcemap: true
      },
      {
        dir: 'dist',
        format: 'cjs',
        entryFileNames: '[name].cjs',
        sourcemap: true
      }
    ],
    external,
    plugins: [
      typescript(mainTsConfig),
      resolve({
        extensions: ['.ts', '.js', '.json']
      }),
      commonjs({
        ignoreDynamicRequires: true,
        ignore: ['google-auth-library']
      }),
      json()
    ]
  },
  // Test build
  {
    input: 'src/test.ts',
    output: {
      dir: 'dist',
      format: 'esm',
      entryFileNames: 'test.js',
      sourcemap: true
    },
    external,
    plugins: [
      typescript(testTsConfig),
      resolve({
        extensions: ['.ts', '.js', '.json']
      }),
      commonjs({
        ignoreDynamicRequires: true,
        ignore: ['google-auth-library']
      }),
      json()
    ]
  }
];
