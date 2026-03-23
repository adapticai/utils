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

## Backend-Legacy CRUD & Field Availability

This package depends on `@adaptic/backend-legacy` for database CRUD operations (`adaptic.<model>.<op>()`). The fields available on returned objects are **curated via GQL inline comments** in `~/adapticai/backend-legacy/prisma/schema.prisma` — that file is the single source of truth.

If a field you expect is missing from CRUD results, check the schema for `GQL.SKIP=true`, `GQL.EXCLUDE`, or `GQL.INCLUDE` directives on that field or its parent relation. To make a previously excluded field available: update the inline comment in `schema.prisma`, run `npm run build` in backend-legacy, publish the package, then update the dependency here.

Similarly, `typeStrings` (string representations of model types for LLM context) are controlled by `TYPESTRING.SKIP=true` and `TYPESTRING.INCLUDE` directives in the same schema file.
