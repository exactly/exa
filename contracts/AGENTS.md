# contracts (`contracts`)

- **stack**: solidity, foundry.

## key files

- **`foundry.toml`**: configuration file for the foundry toolchain.
- **`.solhint.json`**: configuration file for the `solhint` linter. nested configs exist for specific directories (e.g., `test/.solhint.json`).
- **`slither.config.json`**: configuration file for the `slither` static analyzer.
- **`deploy.json`**: the parameters deploy scripts read per chain, and nothing more. fixtures that only local chains need, like extra allowlist entries, go in the mock scripts under `test/mocks/`.

## formatting & linting

contracts are automatically formatted by `forge fmt` and linted by `solhint`. these tools run on every commit and must pass.

- **import order**: imports are grouped by type, external libraries (openzeppelin, solady, etc.) first and project-internal contracts last, and sorted alphabetically within each group. enforced by the formatter.
- **explicit visibility**: all functions and state variables must have an explicit visibility (`public`, `private`, `internal`, `external`).
- **no console logs**: `console.log` is forbidden in contract code.
- **static analysis**: solhint and slither are run on all code. `pnpm nx run-many -t test:slither test:solhint` must pass with zero warnings.

## security & best practices

- **checks-effects-interactions pattern**: non-negotiable. all functions must first perform checks, then update state (effects), then interact with external contracts.
- **reentrancy guard**: rely on checks-effects-interactions as primary defense. use `nonReentrant` only for functions with external calls in loops or complex control flow where the pattern alone is insufficient.
- **access control**: use modifiers like `onlyOwner` or function-level checks. default to strictest possible access level (`private` -> `internal` -> `external` -> `public`).
- **named parameters in mappings**: required, for clarity.
  - ✅ `mapping(address user => uint256 balance)`
  - ❌ `mapping(address => uint256)`

## solidity conventions

- **natspec comments**: minimal natspec. use `@title`, `@author`, `@inheritdoc` where appropriate. code should be self-documenting.
- **custom errors**: use custom errors, never `require()` with string messages. prefer parameterless errors (`error MyError();`) for gas savings, but add context parameters (`error Unauthorized(address caller)`) when genuinely useful for debugging.
  - ✅ `if (caller != owner) revert NotOwner();`
  - ❌ `require(caller == owner, "not owner");`
- **constants**: use `constant` for true constants. use `immutable` for configurable values (like contract addresses) set at deployment.

## foundry & testing

- **test file naming**: test files must end with `.t.sol` and mirror the contract name (e.g., `ExaPlugin.sol` -> `ExaPlugin.t.sol`).
- **test function naming**: test functions must start with `test` and follow `test_[function]_[scenario]()` (e.g., `test_collect_reverts_whenProposalsLeaveNoLiquidity()`).
- **fuzz testing**: required for inputs. use it extensively for functions with numerical or address inputs. same `test_` prefix as regular tests.
- **gas snapshots**: run `pnpm nx snapshot contracts` after any change, `deploy.json` and `package.json` included (scripts read them), and commit the whole regenerated `.gas-snapshot`, or `test:gas` fails. entries move far from the change, so never edit them by hand, and give new tests their own contract to keep existing entries in place.
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
