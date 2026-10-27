import { eq } from "drizzle-orm";
import { numeric, pgSchema, text } from "drizzle-orm/pg-core";
import assert from "node:assert";
import { padHex, zeroHash } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { describe, expect, it } from "vitest";

import deriveAddress from "@exactly/common/deriveAddress";
import { exaAccountFactoryAbi, exaAccountFactoryAddress, exaPluginAddress } from "@exactly/common/generated/chain";

import anvilClient from "./anvilClient";
import database from "../database";

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
      database.select().from(accounts).where(eq(accounts.address, account.toLowerCase())),
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
      database.select().from(plugins).where(eq(plugins.account, account.toLowerCase())),
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

const indexer = pgSchema("indexer");

const accounts = indexer
  .view("accounts", {
    address: text("address").notNull(),
    factory: text("factory").notNull(),
    owner: text("owner"),
    block: numeric("block", { mode: "bigint" }).notNull(),
    timestamp: numeric("timestamp", { mode: "bigint" }).notNull(),
  })
  .existing();

const plugins = indexer
  .view("plugins", {
    account: text("account").notNull(),
    address: text("address").notNull(),
    block: numeric("block", { mode: "bigint" }).notNull(),
    timestamp: numeric("timestamp", { mode: "bigint" }).notNull(),
  })
  .existing();
