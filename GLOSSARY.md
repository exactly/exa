# exa

the exa app, its server, and the onchain accounts and protocol they operate on.

## accounts

**exa account**:
a modular smart account created by an exa factory.
_avoid_: wallet, smart wallet

**owner plugin**:
the plugin that holds an exa account's owners, always the first plugin installed when the account is created.
_avoid_: webauthn plugin

**exa plugin**:
the exa-specific plugin installed on every exa account after its owner plugin.

## factories

**legacy factory**:
an exa factory deployed before versioned deployments existed, identified only by its address.
_avoid_: proxy factory

**versioned factory**:
an exa factory whose address is derived from the exa plugin version it deploys.
_avoid_: create3 factory

## deployment

**chain**:
the blockchain network an exa account and its contracts live on, such as optimism, base, or anvil.
_avoid_: network, environment

**anvil**:
the disposable local chain that tests run against.
_avoid_: local chain, testnet

**stack**:
a running deployment of the app and server, such as local or sandbox, independent of the chain it points to.
_avoid_: environment, chain
