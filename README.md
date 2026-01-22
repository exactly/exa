# exa monorepo

## @exactly/mobile

### development

#### requirements

- [node.js](https://github.com/asdf-vm/asdf-nodejs) v24
- [pnpm](https://pnpm.io/installation) v10
- [foundry](https://getfoundry.sh) v1.3.6 (`foundryup -i v1.3.6`)
- [rust](https://github.com/asdf-community/asdf-rust)
- [slither](https://github.com/crytic/slither) (`pip install -r contracts/requirements.txt`)
- [maestro](https://maestro.mobile.dev) (`brew tap mobile-dev-inc/tap && brew install mobile-dev-inc/tap/maestro`)
- [substreams](https://docs.substreams.dev) (`brew tap streamingfast/homebrew-tap && brew install streamingfast/tap/firehose-ethereum streamingfast/tap/substreams streamingfast/tap/substreams-sink-sql`)
- react-native's [dependencies per platform](https://reactnative.dev/docs/environment-setup?guide=native)

#### install

```bash
pnpm install
```

#### run

```bash
pnpm android # for native android app
pnpm ios # for native ios app
```

#### end-to-end tests

```bash
# native
pnpm nx e2e:ios mobile # or e2e:android
maestro test .maestro/flows/local.yaml


# web
pnpm nx e2e:web mobile
maestro test .maestro/flows/web.yaml
```

## @exactly/server

[exa server](server)

## @exactly/plugin

[exa plugin and other contracts](contracts)
