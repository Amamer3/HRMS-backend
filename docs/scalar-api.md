# Scalar API Docs Integration

This project now includes a dedicated reference for integrating with [Scalar](https://scalar.com), a modern API documentation, OpenAPI, and SDK platform.

## What this is for

- Documenting how this backend can be represented in Scalar.
- Linking to Scalar’s docs platform and registry.
- Capturing next steps for publishing this API with Scalar.

## Scalar overview

Scalar is an API-first documentation platform built around OpenAPI, Markdown/MDX, and API registry workflows.

Key Scalar features:

- OpenAPI document hosting and versioning
- API docs generation from OpenAPI and Markdown
- SDK generation for TypeScript, Python, Go, Java, PHP, Ruby
- Git sync and CI-friendly workflow

## Recommended integration approach

1. Add a machine-readable OpenAPI spec for this service.
   - Scalar works best with OpenAPI. If this project later adds `openapi.yaml` or `openapi.json`, Scalar can import it directly.
2. Publish the API definition to Scalar Registry.
   - Use Scalar’s registry to store, version, and manage the API contract.
3. Generate docs in Scalar.
   - Scalar Docs can render the API reference automatically from the OpenAPI document.
4. Optionally generate SDKs.
   - Scalar can create type-safe clients for supported languages.

## Current project notes

- Existing API reference is documented in `API_ROUTES.md`.
- This backend does not yet include an OpenAPI spec file.
- `docs/scalar-api.md` is a place to capture Scalar-specific integration notes and links.

## Useful links

- Scalar home: https://scalar.com
- Scalar Docs getting started: https://scalar.com/products/docs/getting-started
- Scalar Registry getting started: https://scalar.com/products/registry/getting-started
- Scalar SDKs: https://scalar.com/products/sdks/getting-started

## Next steps

- Add an OpenAPI spec for `/api/v1`.
- Add a `docs/` or `openapi/` source file to this repo.
- Connect the repo or spec to Scalar for docs generation.
