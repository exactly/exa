# hypernative

Monitoring agents for Exa, built with the [invariantive sdk](https://hypernative.io).

## install

first, fetch an auth token using your hypernative credentials:

```bash
AUTH_TOKEN=$(curl -s -X POST https://mhewlfia5oggkm2saovfebpgsa0ryvgz.lambda-url.us-east-1.on.aws/ \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"your-password"}' | jq -r '.authorizationToken')
```

then install dependencies:

```bash
UV_INDEX_INVARIANTIVE_USERNAME=aws UV_INDEX_INVARIANTIVE_PASSWORD=$AUTH_TOKEN uv sync
```

## Setup credentials

Create an API key called "sdk_api_key" in the Hypernative platform and download the JSON file:

```json
{"x-client-id": "", "x-client-secret": ""}
```

Then

```bash
mkdir ~/.hypernative
cat sdk_api_key.json > ~/.hypernative/credentials
```

You should now have a file named credentials in the path ~/.hypernative which contains your API key details.

## exa supply monitor

```bash
uv run python exa-supply-monitor/test.py
uv run python exa-supply-monitor/deploy.py
```

## exaUSDC utilization monitor

Alerts when exaUSDC global utilization on base — `(totalFloatingBorrowAssets + floatingBackupBorrowed) / previewFloatingAssetsAverage`, the exact ratio the interest rate model uses — crosses above 90%. Runs every minute on a `BlockTrigger`; the default STATE alert mode fires one (START) alert per below→above crossing and one (END) alert once utilization has stayed below the threshold for an hour, so a sustained high-utilization period produces a single alert.

```bash
uv run python usdc-utilization-monitor/test.py
uv run python usdc-utilization-monitor/deploy.py
```

## exacbXRP supply cap monitor

Alerts when exacbXRP supply on base — `totalSupply() / maxSupply()`, the share cap `afterDeposit` enforces with `MaxSupplyExceeded` — crosses above 80% of the cap. Both values are read on-chain, so the alert keeps tracking the cap if `setMaxSupply` changes it. Runs every minute on a `BlockTrigger`; the default STATE alert mode fires one (START) alert per below→above crossing and one (END) alert once supply has stayed below the threshold for an hour, so a sustained period above 80% produces a single alert.

```bash
uv run python cbxrp-supply-cap-monitor/test.py
uv run python cbxrp-supply-cap-monitor/deploy.py
```
