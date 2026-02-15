---
always_on: false
alwaysApply: false
applyTo: "contracts/**/*"
globs: "contracts/**/*"
paths: ["contracts/**/*"]
trigger: glob
---

# contracts (`contracts`)

- **stack**: solidity, foundry.
- **custom errors**: use `error MyError();` instead of require strings. prefer parameterless errors for gas savings, but add context parameters (`error Unauthorized(address caller)`) when genuinely useful for debugging.
- **security**: checks-effects-interactions pattern mandatory. use `nonReentrant` selectively for high-risk functions (external calls in loops, complex control flow).
- **formatting**: named mappings required `mapping(address user => uint256 balance)`.
- **testing**: fuzzing required for inputs. gas snapshots mandatory. test function naming: `test_[function]_[scenario]()`.
- **natspec**: minimal - `@title`, `@author`, `@inheritdoc`. code should be self-documenting.

## key files

- **`foundry.toml`**: configuration file for the foundry toolchain.
- **`.solhint.json`**: configuration file for the `solhint` linter. nested configs exist for specific directories (e.g., `test/.solhint.json`).
- **`slither.config.json`**: configuration file for the `slither` static analyzer.

## formatting & linting

contracts are automatically formatted by `forge fmt` and linted by `solhint`. these tools run on every commit and must pass.

- **import order**: imports must be sorted alphabetically and grouped by type (openzeppelin, solady, internal, etc.). enforced by the formatter.
- **explicit visibility**: all functions and state variables must have an explicit visibility (`public`, `private`, `internal`, `external`).
- **custom errors**: `require()` statements with string messages are forbidden. use custom errors.
- **no console logs**: `console.log` is forbidden in contract code.
- **static analysis**: solhint and slither are run on all code.

## security & best practices

- **checks-effects-interactions pattern**: non-negotiable. all functions must first perform checks, then update state (effects), then interact with external contracts.
- **reentrancy guard**: rely on checks-effects-interactions as primary defense. use `nonReentrant` only for functions with external calls in loops or complex control flow where the pattern alone is insufficient.
- **access control**: use modifiers like `onlyOwner` or function-level checks. default to strictest possible access level (`private` -> `internal` -> `external` -> `public`).
- **named parameters in mappings**: use named parameters for clarity.
  - ✅ `mapping(address user => uint256 balance)`
  - ❌ `mapping(address => uint256)`
- **zero warnings policy**: `pnpm nx run-many -t test:slither test:solhint` must pass with zero warnings.

## solidity conventions

- **import order**: openzeppelin or other external libraries first, then project-internal contracts.
- **natspec comments**: minimal natspec. use `@title`, `@author`, `@inheritdoc` where appropriate. code should be self-documenting.
- **error handling**: use custom errors.
  - ✅ `if (caller != owner) revert NotOwner();`
  - ❌ `require(caller == owner, "not owner");`
- **constants**: use `constant` for true constants. use `immutable` for configurable values (like contract addresses) set at deployment.

## foundry & testing

- **test file naming**: test files must end with `.t.sol` and mirror the contract name (e.g., `ExaPlugin.sol` -> `ExaPlugin.t.sol`).
- **test function naming**: test functions must start with `test`. use descriptive names (e.g., `test_revert_when_caller_is_not_owner()`).
- **fuzz testing**: use fuzz testing extensively for functions with numerical or address inputs. same `test_` prefix as regular tests.
- **gas snapshots**: always run `pnpm nx snapshot contracts` after changes and commit the resulting `.gas-snapshot` file. failing to do so breaks `test:gas`.
- **`vm.prank`**: use `vm.prank` to simulate calls from different addresses. avoid changing `msg.sender` through other means.

## gas optimization

- **storage is expensive**: minimize writes to storage. read data into memory or `calldata` whenever possible.
- **efficient data types**: use the smallest safe integer size (e.g., `uint32` for timestamps). be aware of struct packing.
- **`solady` library**: prefer `solady` over `openzeppelin` where possible, as it is highly optimized for gas.
- **view vs. pure**: correctly label functions as `view` or `pure` when they do not modify state.

## development workflow

- **core concepts**: account abstraction (`modular-account`) and passkeys (`webauthn-sol`).
- **build contracts**: `pnpm nx build contracts`
- **run tests**: `pnpm nx test contracts`
- **check formatting**: `pnpm nx test:fmt contracts`
