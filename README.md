# exa monorepo

## @exactly/mobile

### development

#### requirements

- [node.js](https://github.com/asdf-vm/asdf-nodejs) v24
- [pnpm](https://pnpm.io/installation) v10
- [foundry](https://getfoundry.sh)
- [slither](https://github.com/crytic/slither) (`pip install -r contracts/requirements.txt`)
- [maestro](https://maestro.mobile.dev) (`brew tap mobile-dev-inc/tap && brew install mobile-dev-inc/tap/maestro`)
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
# native, with sandbox.exactly.app on 127.0.0.1 and ::1 in /etc/hosts (ios) and an emulator without google play (android)
APP_DOMAIN=sandbox.exactly.app pnpm nx e2e:ios mobile # or e2e:android
pnpm e2e:iphone:trust && maestro test .maestro/flows/local.yaml # or e2e:android:trust, once the server is up


# web
pnpm nx e2e:web mobile
maestro test .maestro/flows/web/local.yaml
```

## @exactly/server

[exa server](server)

## @exactly/plugin

[exa plugin and other contracts](contracts)
