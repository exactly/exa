# contracts (`contracts`)

solidity with foundry: modular accounts (`modular-account`) owned by passkeys (`webauthn-sol`).

- **custom errors**, never `require` strings: `if (caller != owner) revert NotOwner();`. parameterless unless the context helps debugging (`error Unauthorized(address caller)`).
- **checks-effects-interactions**, always. `nonReentrant` only where the pattern alone isn't enough: external calls in loops, complex control flow.
- **access**: explicit visibility on every function and state variable, the strictest that works (`private`, `internal`, `external`, `public`). modifiers like `onlyOwner` or function-level checks.
- **named mappings**: `mapping(address user => uint256 balance)`.
- **natspec**: only `@title`, `@author` and `@inheritdoc`. code documents itself.
- **constants**: `constant` for true constants, `immutable` for values set at deployment, like addresses.
- **gas**: few storage writes, the smallest safe integer sizes, packed structs, `solady` over openzeppelin, `view` and `pure` wherever they apply.
- **no `console.log`** in contract code.

## tests

- `*.t.sol`, named after the contract (`ExaPlugin.t.sol`). test functions are `test_function_outcome[_whenCondition]()`, like `test_collect_reverts_whenProposalsLeaveNoLiquidity()`, and `testFork_` for fork tests.
- fuzz numeric and address inputs. `vm.prank` to change the caller.
- run `pnpm nx snapshot contracts` after changes and commit `.gas-snapshot`, or `test:gas` fails.

## tools

- `forge fmt` (import order included), solhint and slither run on all code, with zero warnings: `pnpm nx run-many -t test:slither test:solhint`.
- configs: `foundry.toml`, `.solhint.json` (nested ones in subdirectories like `test/`), `slither.config.json`.
- `pnpm nx build contracts`, `pnpm nx test contracts`, `pnpm nx test:fmt contracts`.
