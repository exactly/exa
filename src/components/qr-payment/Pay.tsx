import React, { useEffect, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import { Redirect, useLocalSearchParams, useRouter } from "expo-router";

import { XStack, YStack } from "tamagui";

import { getEntryPoint } from "@aa-sdk/core";
import { useQuery } from "@tanstack/react-query";
import { waitForCallsStatus } from "@wagmi/core/actions";
import {
  BaseError,
  encodeFunctionData,
  formatUnits,
  hexToBigInt,
  HttpRequestError,
  isHex,
  sliceHex,
  TimeoutError,
} from "viem";
import { useSendCalls } from "wagmi";

import chain, { marketAbi, marketUSDCAddress } from "@exactly/common/generated/chain";
import { WAD } from "@exactly/lib";

import RateSheet, { format, quotesOptions } from "./RateSheet";
import Status from "./Status";
import { ArrowLeft } from "../../generated/icons/ArrowLeft";
import { ArrowRight } from "../../generated/icons/ArrowRight";
import { CircleHelp } from "../../generated/icons/CircleHelp";
import { Clock } from "../../generated/icons/Clock";
import { RefreshCw } from "../../generated/icons/RefreshCw";
import { TriangleAlert } from "../../generated/icons/TriangleAlert";
import { currencies, getSymbol, isValidCurrency } from "../../utils/currencies";
import emv from "../../utils/emv";
import { present } from "../../utils/intercom";
import parseAmount from "../../utils/parseAmount";
import publicClient from "../../utils/publicClient";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import { APIError, getQRPayment, lockQRPayment } from "../../utils/server";
import useAccount from "../../utils/useAccount";
import useAsset from "../../utils/useAsset";
import useSingleMutation from "../../utils/useSingleMutation";
import exa from "../../utils/wagmi/exa";
import AmountInput from "../shared/AmountInput";
import AssetLogo from "../shared/AssetLogo";
import IconButton from "../shared/IconButton";
import SafeView from "../shared/SafeView";
import Skeleton from "../shared/Skeleton";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Pay() {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const router = useRouter();
  const { qr } = useLocalSearchParams();
  const code = typeof qr === "string" ? qr : "";
  const scanned = useMemo(() => emv(code), [code]);
  const [amount, setAmount] = useState("");
  const [submitted, setSubmitted] = useState<string>();
  const [rates, setRates] = useState(false);
  const [now, setNow] = useState(Date.now);

  const { address: account } = useAccount({ config: exa });
  const { available, markets, queryKey: marketsQueryKey } = useAsset(marketUSDCAddress);
  const { data: quotes } = useQuery(quotesOptions);
  const {
    data: lock,
    error: lockError,
    isFetching: locking,
    refetch: refresh,
  } = useQuery({
    queryKey: ["ramp", "qr", "lock", code, submitted],
    queryFn: () => lockQRPayment(code, submitted),
    enabled: !!scanned?.currency,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });

  const locked = lock?.code && !locking ? lock : undefined;
  const open = submitted !== undefined || (!!lock && !lock.code);
  const fixed = !!locked && submitted === undefined;
  const valid = !!locked && (fixed || submitted === amount);
  const recipient = lock?.recipient ?? scanned?.merchant ?? "";
  const currency = lock?.asset ?? scanned?.currency;
  const symbol = currency ? getSymbol(currency) : "$";
  const rate = valid ? locked.price : currency === "ARS" || currency === "BRL" ? quotes?.[currency] : undefined;
  const price = rate && Number(rate) > 0 ? rate : undefined;
  const assets = valid ? (parseAmount(locked.amount, 8) + 99n) / 100n : undefined;
  const estimate = price && amount ? (parseAmount(amount) * WAD) / parseAmount(price, 18) : undefined;
  const usdc = assets ?? estimate;
  const local = fixed ? locked.assetAmount : amount;
  const expireAt = valid ? Date.parse(locked.expireAt) : undefined;
  const remaining = expireAt === undefined ? undefined : Math.max(0, expireAt - 30_000 - now);
  const expired = remaining === 0;
  const insufficient = !!markets && usdc !== undefined && usdc > available;

  useEffect(() => {
    if (expireAt === undefined) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expireAt]);

  const { mutateAsync: mutateSendCalls } = useSendCalls();
  const payment = useSingleMutation({
    mutationFn: async () => {
      if (!valid || !assets || !account) throw new Error("payment not ready");
      const { address, abi } = getEntryPoint(chain);
      const key = hexToBigInt(locked.nonceKey);
      const sender = account;
      async function sent() {
        const nonce = await publicClient.readContract({ address, abi, functionName: "getNonce", args: [sender, key] });
        return nonce !== key << 64n;
      }
      if (await sent()) throw new UnconfirmedError("qr payment already sent");
      const { id, capabilities } = await mutateSendCalls({
        chainId: chain.id,
        calls: [
          {
            to: marketUSDCAddress,
            data: encodeFunctionData({
              abi: marketAbi,
              functionName: "withdraw",
              args: [assets, locked.receiver, account],
            }),
          },
        ],
        capabilities: { nonceKey: locked.nonceKey, deadline: Date.parse(locked.expireAt) - 30_000 },
      }).catch(async (error: unknown) => {
        const lost =
          error instanceof BaseError &&
          !!error.walk((cause) => cause instanceof HttpRequestError || cause instanceof TimeoutError);
        if (lost || (await sent().catch(() => true)))
          throw new UnconfirmedError("qr payment unconfirmed", { cause: error });
        throw error;
      });
      if (!isHex(id)) throw new Error("bad calls id");
      const { status } = await waitForCallsStatus(exa, { id }).catch((error: unknown) => {
        reportError(error);
        return { status: "pending" };
      });
      if (status === "failure") throw new Error("qr payment failed");
      const validUntil = typeof capabilities?.validUntil === "number" ? capabilities.validUntil * 1000 : undefined;
      return { hash: sliceHex(id, 0, 32), validUntil: validUntil ?? Date.now() + 31 * 60_000 };
    },
    onSuccess() {
      queryClient.invalidateQueries({ queryKey: ["activity"] }).catch(reportError);
      queryClient.invalidateQueries({ queryKey: marketsQueryKey }).catch(reportError);
    },
    onError(error) {
      if (reportError(error).authKnown) payment.reset();
    },
  });

  const hash = payment.data?.hash;
  const { data: synthetic } = useQuery({
    queryKey: ["ramp", "qr", "payment", hash],
    queryFn: () => (hash ? getQRPayment(hash) : null),
    enabled: !!hash,
    refetchInterval: ({ state }) =>
      (state.data && terminal.has(state.data.status)) || (payment.data && Date.now() > payment.data.validUntil + 60_000)
        ? false
        : 2000,
  });

  const reverted = payment.isError && !(payment.error instanceof UnconfirmedError);
  const dropped = synthetic?.status === "NOT_FOUND" && !!payment.data && now > payment.data.validUntil + 60_000;
  const failed = reverted || dropped || synthetic?.status === "FAILED";
  const stuck = synthetic?.status === "CANCELLED" || synthetic?.status === "EXPIRED";
  const unconfirmed =
    payment.error instanceof UnconfirmedError ||
    (!!payment.data &&
      synthetic?.status !== "COMPLETED" &&
      synthetic?.status !== "NOT_FOUND" &&
      now - payment.submittedAt > 300_000);

  if (!scanned?.currency) return <Redirect href="/qr-payment" />;

  function close() {
    router.dismissTo("/(main)/(home)");
  }

  function scanAgain() {
    router.dismissTo("/qr-payment");
  }

  function showRates() {
    setRates(true);
  }

  function pay() {
    if (expireAt !== undefined && expireAt - 30_000 <= Date.now()) {
      setNow(Date.now());
      return;
    }
    payment.mutate();
  }

  function submit() {
    if (submitted === amount) refresh().catch(reportError);
    else setSubmitted(amount);
  }

  const display = {
    amount: local
      ? `${symbol}${Number(local).toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : undefined,
    usdc:
      usdc === undefined
        ? undefined
        : `${Number(formatUnits(usdc, 6)).toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`,
  };

  if (lockError) {
    const unverified =
      lockError instanceof APIError && (lockError.text === "no persona account" || lockError.text === "no document");
    return (
      <Status
        variant="error"
        title={t("We couldn't process this QR code")}
        description={
          unverified
            ? t("QR payments are available for verified accounts with an Argentine ID.")
            : t("Try scanning it again. If the problem persists, contact support.")
        }
        onClose={close}
      >
        <Button primary width="100%" onPress={scanAgain}>
          <Button.Text>{t("Scan again")}</Button.Text>
          <Button.Icon>
            <RefreshCw />
          </Button.Icon>
        </Button>
        <Text emphasized footnote color="uiBrandSecondary" cursor="pointer" onPress={close}>
          {t("Close")}
        </Text>
      </Status>
    );
  }

  if (failed || stuck || unconfirmed) {
    return (
      <Status
        variant="error"
        title={
          <Trans
            i18nKey={
              failed || stuck
                ? "Payment to <em>{{recipient}}</em> failed"
                : "We couldn't confirm the payment to <em>{{recipient}}</em>"
            }
            values={{ recipient }}
            components={{ em: <Text headline primary emphasized /> }}
          />
        }
        amount={display.amount}
        usdc={display.usdc}
        description={
          failed
            ? t("No funds were moved. Try scanning the QR code again.")
            : stuck
              ? t("The merchant didn't receive the payment. Contact support to get your USDC back.")
              : t("Contact support so we can check what happened.")
        }
        onClose={close}
      >
        {failed ? (
          <Button primary width="100%" onPress={scanAgain}>
            <Button.Text>{t("Scan again")}</Button.Text>
            <Button.Icon>
              <RefreshCw />
            </Button.Icon>
          </Button>
        ) : (
          <Button
            primary
            width="100%"
            onPress={() => {
              present().catch(reportError);
            }}
          >
            <Button.Text>{t("Contact support")}</Button.Text>
            <Button.Icon>
              <ArrowRight />
            </Button.Icon>
          </Button>
        )}
        <Text emphasized footnote color="uiBrandSecondary" cursor="pointer" onPress={close}>
          {t("Close")}
        </Text>
      </Status>
    );
  }

  if (payment.isPending || payment.isSuccess) {
    const paid = synthetic?.status === "COMPLETED";
    return (
      <Status
        variant={paid ? "success" : "pending"}
        title={
          <Trans
            i18nKey={paid ? "Paid to <em>{{recipient}}</em>" : "Paying <em>{{recipient}}</em>"}
            values={{ recipient }}
            components={{ em: <Text headline primary emphasized /> }}
          />
        }
        amount={display.amount}
        usdc={display.usdc}
        description={paid ? undefined : t("This can take a few seconds. You can close this screen.")}
        onClose={close}
      >
        {paid && (
          <Button primary width="100%" onPress={close}>
            <Button.Text>{t("Done")}</Button.Text>
            <Button.Icon>
              <ArrowRight />
            </Button.Icon>
          </Button>
        )}
      </Status>
    );
  }

  const ready = valid && !expired && !insufficient && !!account;
  const entered = parseAmount(amount) > 0n;
  const rejected = submitted !== undefined && submitted === amount && !!lock && !lock.code && !locking;

  return (
    <SafeView fullScreen backgroundColor="backgroundSoft">
      <View gap="s5" fullScreen padded>
        <XStack justifyContent="space-between" alignItems="center">
          <IconButton
            icon={ArrowLeft}
            aria-label={t("Back")}
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace("/qr-payment");
            }}
          />
          <IconButton icon={CircleHelp} aria-label={t("QR payments exchange rate")} onPress={showRates} />
        </XStack>

        <YStack flex={1} gap="s7" paddingTop="s7" alignItems="center">
          {recipient ? (
            <Text emphasized subHeadline primary textAlign="center">
              {t("Pay {{recipient}}", { recipient })}
            </Text>
          ) : (
            <Skeleton width={120} height={16} />
          )}
          <YStack gap="s5" alignItems="center" alignSelf="stretch">
            {open ? (
              <XStack alignItems="baseline" justifyContent="center" gap="s2" width="80%">
                <Text title color={insufficient ? "interactiveBaseErrorDefault" : "uiNeutralPlaceholder"}>
                  {symbol}
                </Text>
                <AmountInput
                  aria-label={t("Amount")}
                  placeholder="0.00"
                  value={amount}
                  decimals={2}
                  onChangeText={setAmount}
                  fontSize={34}
                  fontWeight="400"
                  letterSpacing={-0.2}
                  borderWidth={0}
                  backgroundColor="transparent"
                  textAlign="center"
                  color={insufficient ? "interactiveBaseErrorDefault" : "uiNeutralPrimary"}
                  flex={1}
                />
              </XStack>
            ) : display.amount ? (
              <Text largeTitle color="uiNeutralPrimary">
                {display.amount}
              </Text>
            ) : (
              <Skeleton width={200} height={47} />
            )}
            <XStack gap="s2" alignItems="center">
              <AssetLogo symbol="USDC" width={24} height={24} />
              <Text subHeadline color={insufficient ? "uiErrorSecondary" : "uiNeutralSecondary"}>
                {`${valid ? "" : "≈ "}${display.usdc ?? `${(0).toFixed(2)} USDC`}`}
              </Text>
            </XStack>
          </YStack>
        </YStack>

        <YStack gap="s3">
          {insufficient && (
            <XStack gap="s2" alignItems="center">
              <TriangleAlert size={16} color="uiErrorSecondary" />
              <Text caption secondary flex={1}>
                {t("You don't have enough USDC for this payment.")}
              </Text>
            </XStack>
          )}
          {rejected && !insufficient && (
            <XStack gap="s2" alignItems="center">
              <TriangleAlert size={16} color="uiErrorSecondary" />
              <Text caption secondary flex={1}>
                {t("This amount can't be paid. Try a different one.")}
              </Text>
            </XStack>
          )}
          {remaining !== undefined && !insufficient && (
            <XStack gap="s2" alignItems="center">
              <Clock size={16} color={expired ? "uiErrorSecondary" : "uiNeutralSecondary"} />
              <Text caption secondary flex={1}>
                {expired
                  ? t("The price expired. Update it to continue.")
                  : t("Price valid for {{time}}", {
                      time: `${Math.floor(remaining / 60_000)}:${String(Math.floor(remaining / 1000) % 60).padStart(2, "0")}`,
                    })}
              </Text>
            </XStack>
          )}
          <XStack justifyContent="space-between" alignItems="center" gap="s3" cursor="pointer" onPress={showRates}>
            <XStack gap="s2" alignItems="center">
              {currency && isValidCurrency(currency) && <Text caption>{currencies[currency].emoji}</Text>}
              <Text caption secondary>
                {t("Exchange rate")}
              </Text>
            </XStack>
            <Text caption secondary>
              {price && currency ? format(price, currency, language) : "—"}
            </Text>
          </XStack>
        </YStack>

        {valid && expired ? (
          <Button
            primary
            loading={locking}
            disabled={locking}
            onPress={() => {
              refresh().catch(reportError);
            }}
          >
            <Button.Text>{t("Update price")}</Button.Text>
            <Button.Icon>
              <RefreshCw />
            </Button.Icon>
          </Button>
        ) : valid ? (
          <Button primary disabled={!ready} onPress={pay}>
            <Button.Text>{t("Pay")}</Button.Text>
            <Button.Icon>
              <ArrowRight />
            </Button.Icon>
          </Button>
        ) : (
          <Button primary loading={locking} disabled={locking || !open || !entered || insufficient} onPress={submit}>
            <Button.Text>{open ? (entered ? t("Continue") : t("Enter amount")) : t("Pay")}</Button.Text>
            <Button.Icon>
              <ArrowRight />
            </Button.Icon>
          </Button>
        )}
      </View>
      <RateSheet
        open={rates}
        onClose={() => {
          setRates(false);
        }}
      />
    </SafeView>
  );
}

const terminal = new Set(["COMPLETED", "CANCELLED", "EXPIRED", "FAILED"]);

class UnconfirmedError extends Error {}
