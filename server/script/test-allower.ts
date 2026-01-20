import { gcpHsmToAccount } from "@valora/viem-account-hsm-gcp";
import { createPublicClient, formatEther, http, recoverMessageAddress } from "viem";

const EXPECTED_ADDRESS = "0x6C42436A26131e53d91a3be9DFB469C27c4677B1";
const FIREWALL_ADDRESS = "0x01C18E88A4a9ADa7Cce0A10DF56d4a96aB780fc2";
const RPC_URL = "https://base-sepolia.drpc.org";
const CHAIN_ID = 84_532n;

const firewallAbi = [
  {
    name: "ALLOWER_ROLE",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  {
    name: "hasRole",
    type: "function",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }, { type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    name: "allow",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ type: "address" }, { type: "bool" }],
    outputs: [],
  },
] as const;

function log(prefix: string, message: string) {
  console.log(`      ${message}`);
  console.log();
}

function success(message: string) {
  console.log(`      ✓ ${message}`);
  console.log();
}

function error(message: string) {
  console.log(`      ✗ ${message}`);
  console.log();
}

async function main() {
  console.log("checking kms allower configuration for base-sepolia...");
  console.log();

  const projectId = process.env.GCP_PROJECT_ID;
  const keyRing = process.env.GCP_KMS_KEY_RING;
  const keyVersion = process.env.GCP_KMS_KEY_VERSION;

  if (!projectId) {
    error("missing GCP_PROJECT_ID");
    process.exit(1);
  }

  if (!keyRing) {
    error("missing GCP_KMS_KEY_RING");
    process.exit(1);
  }

  if (!keyVersion) {
    error("missing GCP_KMS_KEY_VERSION");
    process.exit(1);
  }

  log("[1/6]", "deriving address from gcp kms...");
  log("       ", `key ring: ${keyRing}`);
  log("       ", `key name: allower`);
  log("       ", `version:  ${keyVersion}`);

  const account = await gcpHsmToAccount({
    hsmKeyVersion: `projects/${projectId}/locations/us-west2/keyRings/${keyRing}/cryptoKeys/allower/cryptoKeyVersions/${keyVersion}`,
  });

  log("       ", `derived address: ${account.address}`);

  if (account.address.toLowerCase() !== EXPECTED_ADDRESS.toLowerCase()) {
    log("[2/6]", "verifying expected address...");
    log("       ", `expected: ${EXPECTED_ADDRESS}`);
    error(`address mismatch: got ${account.address}, expected ${EXPECTED_ADDRESS}`);
    process.exit(1);
  }

  success(`derived address: ${account.address}`);

  log("[2/6]", "verifying expected address...");
  log("       ", `expected: ${EXPECTED_ADDRESS}`);
  success("address matches");

  const client = createPublicClient({
    transport: http(RPC_URL),
  });

  log("[3/6]", "checking allower_role on firewall contract...");
  log("       ", `firewall: ${FIREWALL_ADDRESS}`);

  let allowerRole: `0x${string}` | undefined;
  try {
    allowerRole = await client.readContract({
      address: FIREWALL_ADDRESS,
      abi: firewallAbi,
      functionName: "ALLOWER_ROLE",
    });
  } catch (error_) {
    error(`failed to read ALLOWER_ROLE: ${error_ instanceof Error ? error_.message : String(error_)}`);
    process.exit(1);
  }

  let hasRole: boolean | undefined;
  try {
    hasRole = await client.readContract({
      address: FIREWALL_ADDRESS,
      abi: firewallAbi,
      functionName: "hasRole",
      args: [allowerRole, EXPECTED_ADDRESS],
    });
  } catch (error_) {
    error(`failed to check hasRole: ${error_ instanceof Error ? error_.message : String(error_)}`);
    process.exit(1);
  }

  if (!hasRole) {
    error(`does not have ALLOWER_ROLE`);
    process.exit(1);
  }

  success(`has ALLOWER_ROLE: true`);

  log("[4/6]", "checking eth balance...");
  const balance = await client.getBalance({ address: EXPECTED_ADDRESS });
  log("       ", `balance: ${formatEther(balance)} ETH`);

  const MIN_BALANCE = 1_000_000_000_000_000n;
  if (balance < MIN_BALANCE) {
    error(`balance too low: ${formatEther(balance)} ETH (min: 0.001 ETH)`);
    process.exit(1);
  }

  success(`balance sufficient: ${formatEther(balance)} ETH`);

  log("[5/6]", "testing kms signing...");
  const testMessage = "exa-allower-verification";
  const signature = await account.signMessage({ message: testMessage });
  const recovered = await recoverMessageAddress({ message: testMessage, signature });
  log("       ", `message: ${testMessage}`);
  log("       ", `signature: ${signature.slice(0, 10)}...${signature.slice(-10)}`);
  log("       ", `recovered address: ${recovered}`);

  if (recovered.toLowerCase() !== EXPECTED_ADDRESS.toLowerCase()) {
    error("signature verification failed");
    process.exit(1);
  }

  success("signature verified");

  log("[6/6]", "simulating allow() call...");
  log("       ", `test address: ${EXPECTED_ADDRESS}`);

  try {
    await client.simulateContract({
      address: FIREWALL_ADDRESS,
      abi: firewallAbi,
      functionName: "allow",
      args: [EXPECTED_ADDRESS, true],
      account: account.address,
    });
  } catch (error_) {
    error(`allow() simulation failed: ${error_ instanceof Error ? error_.message : String(error_)}`);
    process.exit(1);
  }

  success("allow() simulation successful");

  console.log("all checks passed");
}

main().catch((error_) => {
  console.error();
  console.error("unexpected error:", error_);
  process.exit(1);
});
