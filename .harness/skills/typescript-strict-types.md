---
name: typescript-strict-types
trigger: Writing or reviewing TypeScript code, especially function signatures, tool inputs, and API responses
---

- Never use `any`. If a type is genuinely unknown, use `unknown` and narrow it with a type guard before using it.
- Validate anything crossing a trust boundary - tool input, API responses, file contents, environment variables - with a Zod schema before trusting its shape. Don't just cast.
- Prefer `interface` for object shapes that might be extended or implemented; use `type` for unions, intersections, and utility types.
- Keep a module's exported surface small. Unexported helpers don't need the same documentation rigor as the public API.
- When a function's return type is a discriminated union, switch on the discriminant exhaustively - let the compiler catch a missing case instead of a runtime `default` branch.
