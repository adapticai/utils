# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build/Test Commands
- Build: `npm run build`
- Clean: `npm run clean`
- Test: `npm run test`
- Single test: First build with `npm run build`, then run with `node dist/path/to/your/test.js`

## Code Style Guidelines
- **Formatting**: 2-space indentation, K&R style braces (on same line)
- **Types**: Strong TypeScript typing with interfaces for data structures, explicit function param/return types
- **Imports**: Group by source (external deps first, then internal), use named imports where possible
- **Naming**: 
  - Functions/variables: camelCase
  - Constants: UPPER_SNAKE_CASE
  - Types/interfaces: PascalCase
- **Error Handling**: Use try/catch with specific error messages that include context (function name)
- **Functions**: Prefer destructured objects for complex parameter lists
- **Documentation**: JSDoc comments for public functions/interfaces

Always maintain the existing code style when making changes. Follow TypeScript's strict mode guidelines.