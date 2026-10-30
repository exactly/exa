import { eq } from "drizzle-orm";
import assert from "node:assert";
import { padHex, zeroHash, type Hex } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { describe, expect, it } from "vitest";

import deriveAddress from "@exactly/common/deriveAddress";
import { exaAccountFactoryAbi, exaAccountFactoryAddress, exaPluginAddress } from "@exactly/common/generated/chain";

import anvilClient from "./anvilClient";
import database from "../database";
import { accounts, plugins } from "../database/indexer";

const account = deriveAddress(exaAccountFactoryAddress, {
  x: padHex(privateKeyToAddress(padHex("0xb0b"))),
  y: zeroHash,
});

describe("indexer", () => {
  it("indexes accounts and their exa plugins", async () => {
    const [initialized] = await anvilClient.getContractEvents({
      address: exaAccountFactoryAddress,
      abi: exaAccountFactoryAbi,
      eventName: "ExaAccountInitialized",
      args: { account },
      fromBlock: 0n,
      strict: true,
    });
    assert.ok(initialized, "expected an ExaAccountInitialized event");
    const [{ timestamp }, owner] = await Promise.all([
      anvilClient.getBlock({ blockNumber: initialized.blockNumber }),
      anvilClient.readContract({
        address: exaAccountFactoryAddress,
        abi: exaAccountFactoryAbi,
        functionName: "WEBAUTHN_OWNER_PLUGIN",
      }),
    ]);

    await expect(
      database
        .select()
        .from(accounts)
        .where(eq(accounts.address, account.toLowerCase() as Hex)),
    ).resolves.toStrictEqual([
      {
        address: account.toLowerCase(),
        factory: exaAccountFactoryAddress.toLowerCase(),
        owner: owner.toLowerCase(),
        block: initialized.blockNumber,
        timestamp,
      },
    ]);
    await expect(
      database
        .select()
        .from(plugins)
        .where(eq(plugins.account, account.toLowerCase() as Hex)),
    ).resolves.toStrictEqual([
      {
        account: account.toLowerCase(),
        address: exaPluginAddress.toLowerCase(),
        block: initialized.blockNumber,
        timestamp,
      },
    ]);
  });
});
