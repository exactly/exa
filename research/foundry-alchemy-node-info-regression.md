# foundry alchemy node-info regression

researched on 2026-08-27 against the foundry github repository.

## answer

no exact issue, pull request, or discussion currently reports alchemy returning
`-32600 Unsupported method: anvil_nodeInfo` and foundry failing with
`failed to determine network family from endpoint`. searches across open and closed github items return no exact
match for either the [alchemy response](https://github.com/foundry-rs/foundry/issues?q=%22Unsupported+method%3A+anvil_nodeInfo%22)
or the [foundry error](https://github.com/foundry-rs/foundry/issues?q=%22failed+to+determine+network+family+from+endpoint%22).
the v1.8.0 release was published on 2026-08-27, so the compatibility failure appears not to have been reported yet.
[foundry v1.8.0 release](https://github.com/foundry-rs/foundry/releases/tag/v1.8.0)

the exact upstream match is merged [pull request #16295](https://github.com/foundry-rs/foundry/pull/16295), not a
user-filed bug. it deliberately changed the first `anvil_nodeInfo` probe from ignoring every error to ignoring only an
exact method-not-found response. every other response is preserved as a vendor rpc error and wrapped with
`failed to determine network family from endpoint`. the
[merged change](https://github.com/foundry-rs/foundry/commit/de59e4d#diff-714033350544091e18b418847f31360770b482a45c0a55230e385f481962a98d)
contains the fatal branch, and its test fixture defines method-not-found as json-rpc code `-32601`.
[test fixture](https://github.com/foundry-rs/foundry/commit/de59e4d#diff-b7f85b25d37a8bf39036a62f98a80e2a23cde6e7cad02256a8eafab75585db90)

the released implementation makes that contract explicit: `is_rpc_method_not_found` accepts only `-32601`, while the
node-info probe propagates every other error. alchemy's `-32600` response therefore takes the fatal branch by design,
even though its message says that the method is unsupported.
[v1.8.0 method-not-found check](https://github.com/foundry-rs/foundry/blob/v1.8.0/crates/common/src/provider/mod.rs#L544-L559)
[v1.8.0 node-info probe](https://github.com/foundry-rs/foundry/blob/v1.8.0/crates/evm/core/src/opts.rs#L171-L194)

## related reports

- [issue #16180](https://github.com/foundry-rs/foundry/issues/16180) reports a v1.8.0-nightly regression in which base
  and optimism forks using an alchemy endpoint fail while v1.7.1 works. it is a different failure:
  `network family optimism is not enabled in this build`. missing release features caused it, and
  [pull request #16186](https://github.com/foundry-rs/foundry/pull/16186) fixed it.
- [pull request #16151](https://github.com/foundry-rs/foundry/pull/16151) is adjacent implementation history. it carried
  endpoint identity through fork resolution and made later node-info failures strict after an endpoint had already
  identified itself as anvil. pull request #16295 extended strict handling to the initial probe.
- [issue #3301](https://github.com/foundry-rs/foundry/issues/3301) is an older, unrelated example of alchemy returning
  `-32600 Unsupported method` for `eth_sendTransaction`. it shows that this response convention predates the current
  fork regression, but it is not a report of the `anvil_nodeInfo` failure.

## conclusion

the failure has not been reported upstream. pull request #16295 conclusively explains it, but foundry currently records
the behavior as intentional preservation of vendor rpc errors rather than a known alchemy compatibility bug. a new
issue should link that pull request and show that alchemy uses `-32600` for an unsupported anvil-specific method, so the
new exact-code check turns an optional capability probe into a fork-startup failure.
