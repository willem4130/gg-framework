import type { LanguageId } from "../language-detector.js";

/**
 * Per-language style packs injected into the system prompt when the detector
 * sees the language is active in the project.
 *
 * Design principles (apply to every pack):
 *   1. Apply the strictest reasonable subset of *idiomatic* style — nothing
 *      exotic the model has to think about. The agent already knows these
 *      patterns; the pack just narrows the choice space.
 *   2. Optimize for low ambiguity, not for human readability. Bullet form.
 *   3. Errors as values, schema at boundaries, mechanical formatting,
 *      one canonical way to do common tasks.
 *   4. ~30-50 lines per pack. Anything longer is bloat in the system prompt.
 *   5. Avoid triple backticks (template literal conflict). Use single
 *      backticks for inline tokens, escape with \\\` when needed.
 */
export const PACKS: Readonly<Record<LanguageId, string>> = {
  typescript: `### TypeScript

- **Tooling.** \`tsc --strict\` always. Enable \`noUncheckedIndexedAccess\`, \`exactOptionalPropertyTypes\`, \`noImplicitOverride\`. Prettier + \`@typescript-eslint/strict-type-checked\`.
- **Types.** Explicit return types on every exported function and async function. Inference is fine inside function bodies. Never use \`any\`. Never use \`as\` casts except \`as const\`. Never use the non-null \`!\` operator. Ban the \`Function\` type and \`Object\` type.
- **Data.** Validate every external boundary (HTTP, env, file, IPC) with Zod or Valibot. Never trust untyped JSON. Discriminated unions over class hierarchies. \`Readonly<T>\` for immutable shapes.
- **Errors.** Use \`Result<T, E>\` (e.g. \`neverthrow\`) for expected failures — network errors, validation failures, missing records. Reserve \`throw\` for truly unrecoverable bugs (impossible states, assertion failures). Never throw for control flow.
- **Modules.** Named exports only — no \`export default\`. One concept per file. No barrel files (\`index.ts\` re-exports). Feature folders (\`users/\`), not layer folders (\`controllers/services/repos/\`).
- **Async.** \`async/await\` only — no \`.then\` chains. Always await or explicitly return promises. No floating promises.
- **Avoid.** \`enum\` (use \`as const\` objects + \`typeof\` unions). Class inheritance beyond one level. \`namespace\`. Decorators outside framework-required slots. Conditional/mapped types in app code (keep in \`types.ts\` if unavoidable).`,

  javascript: `### JavaScript

- **Tooling.** ESM only (\`"type": "module"\`). Prettier + ESLint with \`eslint:recommended\` and \`eslint-plugin-import\`. If types matter at all, use TypeScript instead of JSDoc.
- **Types.** If you must stay on JS, annotate exported functions with JSDoc \`@param\`/\`@returns\` so the LSP can infer. Otherwise treat the project as untyped and validate aggressively at boundaries.
- **Data.** Validate every external boundary with Zod. Use plain objects + factory functions, not classes, for data shapes. \`Object.freeze\` for constants.
- **Errors.** Return \`{ ok: true, value } | { ok: false, error }\` discriminated objects for expected failures. \`throw\` only for unrecoverable bugs. Always handle promise rejections.
- **Modules.** Named exports only. One concept per file. Use feature folders. No CommonJS \`require\` in new code.
- **Async.** \`async/await\` exclusively. \`Promise.all\` for parallel work; never sequential awaits in a loop unless ordering is required.
- **Avoid.** \`var\`. Implicit globals. \`==\` (use \`===\`). Prototype mutation. \`with\`. \`eval\`. \`arguments\` (use rest params).`,

  python: `### Python

- **Tooling.** Python 3.12+. Ruff (lint + format) and Pyright in strict mode. \`pyproject.toml\` is the single config file — no \`setup.py\`, \`setup.cfg\`, or \`requirements.txt\` in new projects. Use \`uv\` for env/dep management.
- **Types.** Annotate every parameter, return, and class field. Use built-in generics: \`list[str]\`, \`dict[str, int]\`, \`X | None\` (not \`Optional\`). Never bare \`Any\`. \`TypedDict\` for dict shapes only at API boundaries; prefer dataclasses or Pydantic models for everything else.
- **Data.** Internal value objects: \`@dataclass(slots=True, frozen=True)\`. External boundaries (HTTP, files, env, IPC): Pydantic v2 \`BaseModel\` with \`model_config = ConfigDict(strict=True, frozen=True)\`. Pydantic guards the boundary; type checker guards the interior.
- **Errors.** Raise specific custom exceptions for unrecoverable bugs. For expected failures, return \`tuple[T, None] | tuple[None, ErrorType]\` or a small \`Result\` dataclass. Never use bare \`except:\` — always catch a specific class.
- **Structure.** One concept per module. \`src/\` layout. No top-level mutable state. \`__init__.py\` re-exports only public API. Feature folders.
- **Idioms.** \`match\` statements over \`isinstance\` chains. Discriminated unions via \`Literal\` tag fields. Comprehensions over \`map\`/\`filter\`. \`pathlib.Path\`, never raw string paths.
- **Avoid.** Decorators that mutate (use \`@dataclass\`, \`@property\`, \`@staticmethod\`, framework-required only). \`*args\`/\`**kwargs\` except at adapter edges. Mutable default arguments. \`from x import *\`. Circular imports — refactor into a smaller module.`,

  go: `### Go

- **Tooling.** \`gofmt\` non-negotiable. \`go vet\` + \`staticcheck\` in CI. \`golangci-lint\` with a conservative preset. Latest stable Go.
- **Errors.** \`if err != nil { return fmt.Errorf("doing X: %w", err) }\` — wrap with context at every layer. Define sentinel errors as \`var ErrXxx = errors.New("xxx")\` at package level. Use \`errors.Is\`/\`errors.As\` for matching. Never \`panic\` outside \`init\` or truly impossible states.
- **Types.** Small interfaces defined at the consumer, not the producer (\`io.Reader\`-style, 1-3 methods). Accept interfaces, return structs. No empty interface \`any\` except at adapter boundaries.
- **Concurrency.** \`context.Context\` is the first parameter on every I/O or long-running function — always propagate, never \`context.Background()\` deep in a call chain. Goroutines launched only with clear lifecycle ownership (\`errgroup\`, \`sync.WaitGroup\`, or paired \`done\` channel).
- **Structure.** Flat package layout by feature (\`user/\`, \`order/\`), not by layer. \`cmd/<binary>/main.go\` for executables. \`internal/\` for packages not meant to be imported externally. No \`utils\` or \`common\` packages.
- **Generics.** Use only when they remove real duplication. Concrete types are the default.
- **Avoid.** \`init()\` functions with side effects. Global mutable state. Returning bare \`error\` without wrapping context. Naked returns in functions longer than 5 lines. \`interface{}\` in new code.`,

  rust: `### Rust

- **Tooling.** \`rustfmt\` + \`clippy\` with at minimum \`-W clippy::pedantic\`. Stable channel unless you have a specific reason. \`cargo test\` + \`cargo doc\` in CI.
- **Errors.** Libraries: define typed error enums with \`thiserror\` so callers can match specific variants. Binaries / application code: use \`anyhow::Result\` + \`.context("doing X")\`. Use the \`?\` operator everywhere; reserve \`match\` for cases that need transformation. Never \`unwrap()\` outside tests, examples, or proven-impossible states (add \`// SAFETY:\` comment when truly unavoidable).
- **Types.** Prefer concrete types and \`impl Trait\` returns over \`dyn Trait\` + generics towers. Newtype wrappers (\`struct UserId(Uuid)\`) over raw primitives for domain types. Lifetimes named meaningfully (\`'src\`, \`'arena\`), not \`'a\`, \`'b\`.
- **Modules.** One concept per file. \`mod.rs\` only re-exports. Feature folders. \`pub(crate)\` by default; \`pub\` only for genuine library API.
- **Async.** \`tokio\` is the default runtime. \`async fn\` in traits via \`async-trait\` only when stable async-fn-in-trait won't work. Avoid mixing runtimes.
- **Unsafe.** Forbidden in app code without an explicit \`// SAFETY:\` comment explaining the invariant. Encapsulate in a safe wrapper module.
- **Avoid.** Macro-heavy crates in app logic. Custom \`macro_rules!\` unless it removes >5 real call sites. Trait towers. \`Box<dyn Error>\` (use \`anyhow::Error\`). String-typed APIs where an enum would do.`,

  java: `### Java

- **Tooling.** Java 21+ (LTS). \`google-java-format\` or \`spotless\`. Error Prone + Checker Framework or NullAway in CI. Maven or Gradle Kotlin DSL — pick one per repo and stick.
- **Types.** Use \`record\` for all immutable data carriers. \`sealed interface\` + permits for sum types; pattern-match in \`switch\`. \`Optional<T>\` for return types only — never as a field or parameter.
- **Errors.** Custom unchecked exceptions extending \`RuntimeException\` for business errors. Wrap checked exceptions at adapter boundaries — don't propagate \`IOException\` through service layers. Use sealed \`Result<T, E>\` types for cases where the caller must handle both branches.
- **Nullability.** \`@Nullable\`/\`@NonNull\` (JSpecify) on every API boundary. Treat unannotated as non-null. NullAway in CI.
- **Structure.** Package by feature. Constructor injection only — no field injection, no setter injection. No static mutable state. \`final\` by default on classes and fields.
- **Avoid.** Reflection in business code (frameworks may need it). Lombok in new code (records cover 95% of cases). AOP / proxy magic. Checked exceptions on new APIs. Inheritance beyond one level.`,

  kotlin: `### Kotlin

- **Tooling.** Kotlin 2.0+. \`ktlint\` + \`detekt\`. Strict explicit API mode in libraries.
- **Types.** \`data class\` for value objects. \`sealed class\` / \`sealed interface\` for sum types — exhaustive \`when\` over \`if\`. Inline \`value class\` for domain primitives. Avoid \`Any\` and platform types.
- **Nullability.** Use the type system — never \`!!\`. Prefer \`?.let\`, \`requireNotNull\`, or explicit \`if\` checks. Treat all Java interop returns as nullable.
- **Errors.** \`Result<T>\` or a custom sealed \`Either\`-like type for expected failures. Reserve exceptions for bugs. \`runCatching\` only at adapter edges.
- **Coroutines.** Structured concurrency via \`coroutineScope\` / \`supervisorScope\`. Never \`GlobalScope\`. \`Dispatchers.IO\` for blocking work, \`Default\` for CPU. Always pass a \`CoroutineContext\` or scope into suspend functions that launch children.
- **Structure.** Package by feature. One top-level public declaration per file (extension functions excepted). Use \`internal\` visibility liberally.
- **Avoid.** Companion-object factories when a top-level function works. Nested classes for grouping (use packages). Reflection. Overusing operator overloading.`,

  csharp: `### C#

- **Tooling.** C# 12+ on .NET 8+. \`<Nullable>enable</Nullable>\` and \`<TreatWarningsAsErrors>true</TreatWarningsAsErrors>\` project-wide. \`dotnet format\`. Roslyn analyzers + StyleCop.
- **Types.** \`record\` (positional or with-init) for DTOs and value objects. \`required\` properties over multi-arg constructors. File-scoped namespaces. One public type per file.
- **Nullability.** NRTs on, no \`!\` operator except for proven-non-null cases with a comment. \`is null\` / \`is not null\` over \`==\`.
- **Errors.** Custom exceptions for unrecoverable. \`Result<T, E>\` (e.g. via \`OneOf\`, \`ErrorOr\`, or a small custom type) for expected failures across service boundaries. Never use exceptions for control flow.
- **Async.** \`async Task<Result<T>>\` everywhere. No \`async void\` except event handlers. Always pass \`CancellationToken\` through I/O calls. Avoid \`.Result\`, \`.Wait()\`, and \`.GetAwaiter().GetResult()\` — they deadlock.
- **LINQ.** Keep chains shallow (≤ 3 operators). Pull complex queries into named methods or local functions.
- **Avoid.** Reflection in hot paths. Static mutable state. Source generators in app code (libraries only). Multi-level inheritance. Manual \`IDisposable\` when \`using\` works.`,

  cpp: `### C++

- **Tooling.** C++20 minimum, C++23 when toolchain allows. \`clang-format\` + \`clang-tidy\` with \`cppcoreguidelines-*\` and \`modernize-*\` checks. AddressSanitizer + UBSan in test builds. CMake with presets.
- **Resources.** RAII universal. \`std::unique_ptr\` by default, \`std::shared_ptr\` only when ownership is genuinely shared. Never raw owning pointers. Never \`new\`/\`delete\` in app code.
- **Types.** \`std::string_view\` and \`std::span\` for non-owning views. \`std::optional<T>\` for nullable returns. \`auto\` for obvious types, explicit for API surfaces.
- **Errors.** \`std::expected<T, E>\` (C++23) — or \`tl::expected\` if stuck on older toolchain — for expected failures. \`throw\` only for genuinely exceptional cases (allocation failure, programmer errors). Exception specifications via \`noexcept\` on functions that must not throw.
- **Generics.** Concepts (C++20), never SFINAE. \`std::ranges\` over raw iterator pairs.
- **Headers/modules.** C++20 modules when supported; otherwise include guards via \`#pragma once\`. No transitive includes — each file includes what it uses.
- **Avoid.** C-style casts (use \`static_cast\` / \`reinterpret_cast\`). Raw arrays in new code (use \`std::array\` or \`std::vector\`). Macros for anything other than include guards or platform conditionals. Template metaprogramming beyond \`if constexpr\` + concepts. Multiple inheritance of non-interface classes.`,

  c: `### C

- **Tooling.** C11 or C17. \`clang-format\` + \`clang-tidy\`. \`-Wall -Wextra -Wpedantic -Werror\` always. AddressSanitizer + UBSan in test builds. Run a fuzzer on parsers.
- **Memory.** Pair every \`malloc\` with a clear owner and a single \`free\` site. Prefer arena/region allocators for groups of related allocations. Zero-initialize structs. Never trust \`strlen\` on untrusted input — track lengths explicitly.
- **Types.** \`stdint.h\` integer types (\`int32_t\`, \`size_t\`, \`uintptr_t\`) — never bare \`int\`/\`long\` for sizes or counts. \`bool\` from \`stdbool.h\`. Use \`enum\` for tagged unions; carry a tag field.
- **Errors.** Return \`int\` status codes or a small enum; pass results back via out-pointers. Always check return values. Define \`Result_T\` structs for richer cases. Never use \`errno\` across thread boundaries without copying.
- **Structure.** One concept per \`.c\` + \`.h\` pair. Header declares public API only; static functions are file-local. No global mutable state (use opaque handles).
- **Strings.** Length-prefixed slices or explicit \`(ptr, len)\` pairs over null-terminated wherever possible. \`snprintf\` with explicit buffer sizes — never \`sprintf\`, \`strcpy\`, \`gets\`.
- **Avoid.** Macros beyond \`#include\` guards, platform conditionals, and named constants. Variable-length arrays. Implicit int. \`goto\` except for unified cleanup paths.`,

  ruby: `### Ruby

- **Tooling.** Ruby 3.3+. \`standardrb\` or \`rubocop\` (strict preset). \`sorbet\` with \`# typed: strict\` on every file in new projects. RSpec for tests.
- **Types.** \`T::Struct\` (Sorbet) for value objects. \`T.nilable\`, \`T::Array[X]\`, etc. on every method signature. RBS files alongside libraries.
- **Errors.** Custom exception classes per domain, inheriting a single base \`AppError\`. \`raise\` for unrecoverable; for expected failures return \`Success(value)\` / \`Failure(err)\` via \`dry-monads\` or a small custom Result type.
- **Structure.** Files match class names. Modules by feature. \`Zeitwerk\` autoloading. Frozen string literals magic comment at the top of every file.
- **Idioms.** \`Data.define\` (Ruby 3.2+) for immutable value objects when not using Sorbet. Keyword arguments over positional past 2 args. Guard clauses over nested \`if\`. \`tap\` for side effects on a chain.
- **Avoid.** \`method_missing\` and \`respond_to_missing?\` in new code. Monkey-patching core classes. \`define_method\` at runtime. \`eval\` family. Heavy DSLs outside the few canonical cases (Rails routes, RSpec, etc. — isolate them).`,

  php: `### PHP

- **Tooling.** PHP 8.3+. PHPStan or Psalm at max level. \`php-cs-fixer\` or \`pint\`. Composer with strict autoload.
- **Types.** \`declare(strict_types=1);\` at the top of every file. Type every parameter, return, and property. \`readonly\` classes and properties everywhere possible. Enums (backed) for closed sets — never string constants.
- **Data.** Constructor property promotion for DTOs: \`public function __construct(public readonly string $name, public readonly int $age) {}\`. Final classes by default.
- **Errors.** Typed custom exceptions per domain. For expected failures, return a small \`Result\` value object or use a discriminated union of result classes. Never catch \`\\\\Throwable\` except at the request boundary.
- **Structure.** PSR-4 autoloading. Package by feature. No global state. Constructor injection only.
- **Avoid.** Untyped parameters or returns. \`@\` error suppression. Globals. Static mutable state. Multiple inheritance via traits as a workaround for poor design. \`extract()\`, \`compact()\`, variable variables.`,

  swift: `### Swift

- **Tooling.** Swift 5.10+ or 6 with strict concurrency. \`swift-format\` or SwiftLint. \`-warnings-as-errors\` in CI.
- **Types.** \`struct\` by default; \`class\` only for identity-bearing references. \`enum\` with associated values for sum types. \`@frozen\` on stable public enums. Generics over protocol existentials when possible.
- **Optionals.** Use the type system — no \`!\` force-unwraps except for genuinely impossible-to-fail cases (with a comment). \`guard let\` / \`if let\` everywhere else.
- **Errors.** \`throws\` + typed \`throws\` (Swift 6) for expected failures across module boundaries. \`Result<Success, Failure>\` when storing/passing async outcomes. Never use \`try!\` outside tests.
- **Concurrency.** \`async\`/\`await\` + structured concurrency (\`TaskGroup\`, \`async let\`). Actors for mutable shared state. \`@MainActor\` on UI-touching code. Avoid \`Task.detached\`.
- **Structure.** One public type per file. Group files by feature. Extensions for protocol conformances, kept in the same file unless cross-cutting.
- **Avoid.** Implicit-unwrapped optionals (\`Type!\`) in new code. \`NSObject\` inheritance unless interop requires it. Singletons as the primary state container. Reflection (\`Mirror\`) in hot paths.`,

  scala: `### Scala

- **Tooling.** Scala 3. \`scalafmt\` + \`scalafix\`. \`-Wunused:all\`, \`-Werror\`, \`-explain\` compiler flags. Run on the latest stable Scala 3.
- **Types.** \`case class\` for records, \`enum\` for sum types — never sealed-trait-and-case-objects boilerplate in Scala 3. Opaque types for domain primitives. Avoid implicit conversions; use \`given\`/\`using\` for type-class instances only.
- **Errors.** \`Either[E, A]\` for expected failures, \`Try\` only at the foreign-exception boundary, exceptions only for unrecoverable bugs. With effect libraries (Cats Effect / ZIO): use the effect type's error channel.
- **Effects.** Pick one effect system per repo (Cats Effect IO or ZIO) and stick with it. Avoid mixing Future + IO. Tagless final only when the abstraction is genuinely load-bearing.
- **Structure.** Package by feature. One top-level definition per file when public. Heavy use of \`extension\` methods over implicit classes.
- **Avoid.** \`null\`. \`var\` in business code. Implicit conversions. Operator-soup DSLs in app logic (libraries only). \`asInstanceOf\` outside adapter boundaries.`,

  elixir: `### Elixir

- **Tooling.** Latest stable Elixir + Erlang/OTP. \`mix format\`. \`credo --strict\` + \`dialyzer\` (with \`@spec\` on every public function).
- **Types.** \`@spec\` and \`@type\` on every public function and module — feed Dialyzer. Use structs (\`defstruct\` + \`@enforce_keys\`) for domain data, never bare maps for typed records.
- **Errors.** \`{:ok, value} | {:error, reason}\` tuples for expected outcomes. \`with\` chains for happy-path composition. Bang functions (\`!\`) raise on failure — use sparingly, only when callers genuinely can't recover. Never \`rescue\` arbitrary exceptions in business code.
- **Processes.** Use OTP behaviors (\`GenServer\`, \`Supervisor\`, \`Task.Supervisor\`) — never raw \`spawn\`/\`spawn_link\` in app code. Let-it-crash with a supervision tree, not defensive try/rescue.
- **Structure.** Context modules (Phoenix-style) group functionality by bounded context. Public API on the context module; implementation modules are internal.
- **Avoid.** Macros in app code (libraries may need them; mark with care). \`Process.put\`/\`get\` for state. Atom-keyed maps from untrusted input (\`String.to_atom\` on user data leaks). Hidden side effects in pipelines.`,

  haskell: `### Haskell

- **Tooling.** GHC 9.6+. \`ormolu\` or \`fourmolu\`. HLint with strict suggestions. Stack or Cabal — pick one per repo. \`-Wall -Wcompat -Werror\` for libraries.
- **Types.** Explicit top-level signatures on every binding, even when inferable. Records with named fields and \`DuplicateRecordFields\` + \`OverloadedRecordDot\` (or use \`generic-lens\`). Newtype wrappers for domain primitives.
- **Errors.** \`Either ErrorType a\` for expected failures. \`Maybe\` only for genuine absence, not for "computation failed". Exceptions only at the IO boundary; convert to \`Either\` immediately.
- **Effects.** Pick one effect strategy per repo: plain \`IO\` for simple apps, \`ReaderT\` over \`IO\` for typical services, or a single effect system (effectful / freer-simple). Don't mix.
- **Structure.** One module per type + its operations. No \`Util\` or \`Misc\` modules. Public API surface in module export lists — never \`module X where\` with no export list.
- **Avoid.** Partial functions (\`head\`, \`!!\`, \`fromJust\`) — use total alternatives. Lens-heavy chains in app logic. \`undefined\` in committed code. Orphan instances.`,

  ocaml: `### OCaml

- **Tooling.** OCaml 5+ via opam. \`dune\` build system. \`ocamlformat\` with the project preset locked. Merlin for editor support.
- **Types.** Annotate every public binding in \`.mli\` interface files. Phantom types or private types for domain invariants. Avoid open polymorphic variants in libraries (use plain variants).
- **Errors.** \`Result.t\` from the stdlib for expected failures. Exceptions only for impossible states or at the I/O boundary. \`( let* )\` syntax for monadic chaining over nested \`match\`.
- **Modules.** Heavy use of modules and module signatures. One main type per module, named \`t\`, with operations as \`Module.op\`. Functors only when they buy real abstraction; otherwise plain modules.
- **Structure.** One \`.ml\` per concept with a matching \`.mli\` exposing only public API. Dune libraries grouped by feature.
- **Avoid.** \`Obj.magic\` outside truly unavoidable interop. Global mutable state. Polymorphic equality (\`=\`) on complex types — use type-specific \`equal\` functions. Pervasives \`Stdlib\` shadowing without a clear reason.`,

  fsharp: `### F#

- **Tooling.** Latest stable F# on .NET 8+. \`fantomas\` formatter. \`<TreatWarningsAsErrors>true</TreatWarningsAsErrors>\`. FSharpLint or analyzers.
- **Types.** Records and discriminated unions for all domain types. Single-case DUs for domain primitives. Avoid classes in new code except for interop. Type providers only when the source schema is stable.
- **Errors.** \`Result<'T, 'TError>\` for expected failures, \`Option\` for absence. \`ResultBuilder\` (\`result { ... }\`) computation expression for sequencing. Exceptions only at the .NET interop boundary.
- **Structure.** Modules over classes. File order matters in F# — put types and core helpers first, composition later. One concept per file. Keep \`open\` statements at the top.
- **Async.** \`Async\` for F#-native flows, \`Task\` at .NET boundaries. Use \`task { }\` computation expression when interop matters.
- **Avoid.** Mutable state outside small, well-contained pockets. Object expressions where a module function would do. \`obj\` and downcasts in business code. \`null\` even for interop — wrap immediately in \`Option\`.`,

  clojure: `### Clojure

- **Tooling.** Latest stable Clojure. \`clj-kondo\` linter (treat warnings as errors). \`cljfmt\` formatter. \`tools.deps\` (\`deps.edn\`) over Leiningen for new projects.
- **Specs/schemas.** Use Malli (preferred) or Spec at every external boundary. Schema-driven generative tests on core data. Keep schemas alongside the namespace they describe.
- **Errors.** Return \`{:ok ...}\` / \`{:error ...}\` maps for expected failures. \`ex-info\` with structured data for genuine exceptions. Never bare \`throw\` of a string. \`try\`/\`catch\` only at process or request boundaries.
- **State.** Atoms for shared local state, refs only when coordination is required, never global vars for mutable state. Components / Integrant / Mount for system lifecycle — pick one per repo.
- **Structure.** Namespace per concept. Keep functions small, composable, pure where possible. Side effects pushed to the edge.
- **Avoid.** Macros in app code unless they remove genuine ceremony. Dynamic vars (\`*var*\`) for hidden parameters. \`def\` inside functions. \`eval\` in production code. Threading-macro chains longer than ~5 steps without a named intermediate.`,

  dart: `### Dart

- **Tooling.** Dart 3+. \`dart format\`. \`very_good_analysis\` or \`flutter_lints\` strict preset. Sound null safety enabled.
- **Types.** Explicit types on every public API. \`final\` everywhere unless mutation is intentional. Records (Dart 3) and patterns for ad-hoc structured data. \`sealed class\` + pattern matching for sum types.
- **Errors.** Custom exceptions for unrecoverable cases. \`Result<T, E>\` sealed class for expected failures. Never throw \`String\` or untyped values.
- **Async.** \`async\`/\`await\`. \`Future\` for one-shot, \`Stream\` for sequences. Always handle errors via \`.catchError\` or try/catch at the boundary.
- **Structure.** One public class per file. Feature folders. \`part\`/\`part of\` only for code generation (\`freezed\`, \`json_serializable\`).
- **Avoid.** \`dynamic\` in new code. Implicit \`new\` (write it out where ambiguous). \`var\` for public API. Mutable static fields. Long widget build methods — extract.`,

  lua: `### Lua

- **Tooling.** Lua 5.4 or LuaJIT — declare which. \`stylua\` for formatting. \`luacheck\` with strict globals. Annotate with LuaCATS / EmmyLua for editor support.
- **Types.** \`---@type\`, \`---@param\`, \`---@return\` annotations on every public function. \`---@class\` for tables used as records.
- **Tables.** Decide if a table is a record, array, or map at the call site and stick to it. Don't mix array and map fields. Sequence tables (\`{ "a", "b" }\`) treated as 1-indexed sequences without holes.
- **Errors.** Return \`value, nil\` on success / \`nil, errString\` on failure for expected outcomes. \`error()\` only for unrecoverable programmer errors. \`pcall\` at module / request boundaries.
- **Modules.** \`local M = {}; … return M\` pattern. No global side effects on require. \`local\` everything unless explicit module export.
- **Avoid.** Implicit globals — set \`luacheck\` to flag them. Metatable cleverness in app logic. \`setfenv\`/\`getfenv\` (gone in 5.2+) or environment hacks. String-key tables when an index would work.`,

  zig: `### Zig

- **Tooling.** Pin a specific Zig version per project (the language is pre-1.0 and shifting). \`zig fmt\`. Run all sanitizers in test builds.
- **Errors.** Use Zig's error union type \`!T\` everywhere appropriate. Define a single error set per module, named \`Error\`. Use \`try\` for propagation, \`catch\` for handling at the boundary. Never \`unreachable\` in production paths.
- **Memory.** Explicit allocator passed in to every function that allocates. Pair every \`alloc\` with a \`defer\` \`free\`. Use arena allocators for grouped lifetimes.
- **Comptime.** Use \`comptime\` for genuine compile-time work (generics, config) — not as a substitute for runtime code.
- **Structure.** One concept per file. Public API at the top. Tests in the same file as the code they test.
- **Avoid.** \`@cImport\` outside a single \`c.zig\` boundary module. Heap allocation in hot paths when a fixed-size buffer works. Mixing different allocators in one ownership chain.`,

  sql: `### SQL

- **Tooling.** \`sqlfluff\` with a strict dialect-specific preset. Migrations are append-only, numbered, and reversible — never edit an applied migration.
- **Style.** Uppercase keywords. One clause per line, trailing commas in select lists, leading commas allowed if the team agrees. Always alias tables; always qualify columns with the alias.
- **Selects.** Never \`SELECT *\` in application code. CTEs over nested subqueries. Window functions over self-joins where they work.
- **Schema.** Explicit \`NOT NULL\` on every column that should have it. Foreign keys with \`ON DELETE\` actions specified. Generated/identity columns for surrogate keys; never auto-incrementing without a \`PRIMARY KEY\`.
- **Migrations.** One change per migration. Idempotent where the engine supports it. Always include a rollback plan in a comment. No data migrations mixed with schema migrations.
- **Avoid.** String interpolation into queries from app code — use parameterized queries. \`SELECT INTO\` for permanent tables. ORM lazy-loading patterns hidden behind \`N+1\` queries. Wide tables with \`JSON\` columns where a relational design fits.`,

  bash: `### Bash / Shell

- **Tooling.** \`#!/usr/bin/env bash\` shebang. \`set -euo pipefail; IFS=$'\\n\\t'\` at the top of every script. \`shellcheck\` clean — no exceptions.
- **Style.** Quote every variable expansion (\`"$var"\`). \`[[ ]]\` not \`[ ]\` for tests. \`$(cmd)\` not backticks. Functions over inline blocks past ~10 lines.
- **Errors.** Check command exit codes explicitly when \`set -e\` semantics aren't sufficient (e.g. pipes — use \`pipefail\`). \`trap\` for cleanup. Never \`|| true\` to silence errors without a comment explaining why.
- **Args.** Use \`getopts\` or a small parser, not positional indexing past 2 args. \`--\` to separate flags from arguments when passing to other commands.
- **Structure.** Top of script: shebang, \`set\` flags, \`readonly\` constants, then function definitions, then \`main\` call. One concern per script.
- **Avoid.** \`eval\`. Word splitting / glob expansion by leaving variables unquoted. Mutating \`IFS\` in the middle of a script. Scripts longer than ~100 lines — switch to Python or Go.`,

  terraform: `### Terraform / HCL

- **Tooling.** Latest stable Terraform or OpenTofu. \`terraform fmt\`. \`tflint\` + \`tfsec\` (or \`checkov\`) in CI. Pinned provider versions in \`required_providers\`. Remote state with locking always.
- **Structure.** Modules by infrastructure concern (\`network/\`, \`compute/\`, \`data/\`). \`main.tf\`, \`variables.tf\`, \`outputs.tf\`, \`versions.tf\` per module. No monolithic root module — environments compose modules.
- **Variables.** Every variable has a \`type\` and a \`description\`. \`sensitive = true\` on secrets. Validate with \`validation\` blocks. No untyped \`any\` variables.
- **State.** One state file per environment + concern. Never commit \`.tfstate\` or \`.tfvars\` with secrets to git. Use \`tfvars\` files per environment, kept out of public repos.
- **Resources.** Explicit \`tags\` blocks on every resource that supports them. Lifecycle \`prevent_destroy = true\` on stateful infrastructure (databases, buckets) unless intentionally ephemeral.
- **Avoid.** \`count\` for set-like collections — use \`for_each\` with a map. Hard-coded provider regions or account IDs (use variables). Implicit dependencies — declare \`depends_on\` when ordering matters. \`local-exec\` provisioners as a primary tool (use them only as a last resort).`,
};
