# exa account factory deployment block lookup

deployment means creation of the exact factory address configured for each chain,
not the first account it creates or the latest deployment-script run. no production code was changed.

## recommendation

recover existing deployments from constructor logs or explorer creation indexes, verify original
receipts, then persist metadata by chain and factory address. the [wagmi configuration](wagmi.config.ts)
can consume verified blocks without adding network calls to code generation. retain original receipts
for future deployments; local block numbers vary per run.

the [deployment script](../contracts/script/ExaAccountFactory.s.sol) uses `CREATE3_FACTORY.deploy` and
derives its salt from the [plugin name and version](../contracts/src/ExaPlugin.sol). the outer transaction
calls an existing contract, so its receipt's `contractAddress` is `null`; match the factory's constructor
log by emitter address. see the [standard receipt schema](https://ethereum.org/developers/docs/apis/json-rpc/#eth_gettransactionreceipt).

the [pinned parent factory](https://github.com/exactly/webauthn-owner-plugin/blob/9c0c38b/src/WebauthnModularAccountFactory.sol)
calls `Ownable(owner)`, whose [ownership constructor](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.0.2/contracts/access/Ownable.sol)
emits `OwnershipTransferred` when its constructor initializes the owner.

## options

| method | assessment |
| --- | --- |
| constructor log | query `OwnershipTransferred` at the factory address with `previousOwner` equal to zero through [standard log filtering](https://ethereum.org/developers/docs/apis/json-rpc/#eth_getlogs). returns the exact block and transaction hash. full-history lookup worked on optimism; optimism sepolia rejected ranges above 10,000 blocks. fixed windows avoid binary search but can require many requests. |
| blockscout creation index <!-- cspell:ignore blockscout --> | [contract creation lookup](https://docs.blockscout.com/devs/apis/rpc/contract) returns the creation transaction hash; fetch its standard receipt for the block. public address endpoints also expose creation metadata. keyless address lookup worked for the configured optimism, optimism sepolia and base sepolia factories. requires explorer coverage and completed indexing. |
| etherscan creation index <!-- cspell:ignore getcontractcreation --> | [`getcontractcreation`](https://docs.etherscan.io/api-reference/endpoint/getcontractcreation) returns both `txHash` and `blockNumber` directly. accepts chain id and up to five addresses. requires an api key and applicable [chain/plan coverage](https://docs.etherscan.io/supported-chains). |
| otterscan creation lookup | [`ots_getContractCreator`](https://docs.otterscan.io/api-docs/ots-api#ots_getcontractcreator) returns the creation transaction hash and immediate creator, including deployer contracts. fetch the receipt for the block. exact lookup, but requires an rpc provider exposing this nonstandard namespace. |
| deployment records | retain the original successful deployment receipt and its factory log. best long-term provenance. factory broadcasts are currently [ignored](../contracts/.gitignore), with no tracked factory deployment records or historical factory broadcasts found. `run-latest.json` can describe a later script run rather than original creation. |

provider limits affect constructor lookups: [alchemy](https://www.alchemy.com/docs/chains/ethereum/ethereum-api-endpoints/eth-get-logs)
documents 10 blocks per free-tier query and unlimited paid optimism/base mainnet ranges.

exclude alchemy's `findContractDeployer`: its [official sdk implementation](https://github.com/alchemyplatform/alchemy-sdk-js/blob/master/src/api/core-namespace.ts)
explicitly calls `binarySearchFirstBlock`. it also identifies the creator through the outer receipt's
`contractAddress`, which does not identify this internally created factory.

## verified deployments

all four public-chain blocks below were confirmed with successful standard receipts containing the
factory's `OwnershipTransferred` constructor event from zero. each outer receipt had `contractAddress: null`.

| chain | factory address | deployment block | transaction |
| --- | --- | ---: | --- |
| optimism (`10`) | `0x961EbA47650e2198A959Ef5f337E542df5E4F61b` | `134297814` | [receipt](https://optimistic.etherscan.io/tx/0xac7c552b7841fe629119c8a544a0f892cdd7210bea4ab8fc39b9a7d5c453666b) |
| optimism sepolia (`11155420`) | `0x98d3E8B291d9E89C25D8371b7e8fFa8BC32E0aEC` | `26170889` | [receipt](https://sepolia-optimism.etherscan.io/tx/0x3f1f573c2a7d7cb5caad8a8a1a469033cca5cf3769418e7af885fbdc0510f849) |
| base (`8453`) | `0xAd92a288CE0cc869129cDA518Af2baaf69fFa026` | `38172919` | [receipt](https://basescan.org/tx/0xb4cd97f0b05e4e7bf1005809dd47728f5f566736fb4904beb92e5d360e02bea3) |
| base sepolia (`84532`) | `0xD72aDc8D0eb528aA1D355A47D65fa2e6A21a5d36` | `36880087` | [receipt](https://sepolia.basescan.org/tx/0x9b326c958acc6e0deb9b8e85a6efa90b142aae4d4df8e6de217fb7a58e1fbd31) |

the optimism addresses are pinned in the wagmi configuration. base and base sepolia addresses were
independently checked against both the script's deterministic address formula and the live deployment
factory's `getDeployed` result. anvil's current derived address is
`0xEb2454D494082f2294Fc5d4Cd67096f13E64306f`; obtain its block from that run's generated receipt.

the [substreams manifest](../substreams/substreams.yaml) agrees with the base and optimism sepolia blocks.
its optimism `124728176` entry predates the current factory, and its base sepolia `29999489` entry belongs
to the older `0x343EfD4E2073afc4CBe304b5dD50F8d6480e2dD2` factory. neither is the deployment block of
the corresponding current configured address.
