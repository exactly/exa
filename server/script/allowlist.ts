import { writeFileSync } from "node:fs";
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";

process.loadEnvFile();

const FIREWALL_ADDRESS = "0x01C18E88A4a9ADa7Cce0A10DF56d4a96aB780fc2" as const;

if (!process.env.ALCHEMY_API_KEY) throw new Error("missing alchemy api key");

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(`https://base-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`),
});

const firewallAbi = [
  {
    type: "event",
    name: "AllowlistSet",
    inputs: [
      { name: "account", type: "address", indexed: true },
      { name: "allower", type: "address", indexed: true },
      { name: "allowed", type: "bool", indexed: false },
    ],
  },
] as const;

async function getAllowedAccounts() {
  const events = await publicClient.getContractEvents({
    abi: firewallAbi,
    eventName: "AllowlistSet",
    address: FIREWALL_ADDRESS,
    fromBlock: 0n,
    toBlock: "latest",
    strict: true,
  });

  const accounts = new Set(events.map((event) => event.args.account));
  return [...accounts];
}

getAllowedAccounts()
  .then((accounts) => {
    writeFileSync("allowlist.json", JSON.stringify(accounts, undefined, 2));
  })
  // eslint-disable-next-line no-console -- cli
  .catch(console.error);
