import React from "react";

import ARS from "../../assets/images/ars.svg";
import Background from "../../assets/images/background.svg";
import Base from "../../assets/images/base.svg";
import BRL from "../../assets/images/brl.svg";
import EUR from "../../assets/images/euro.svg";
import MXN from "../../assets/images/mxn.svg";
import GBP from "../../assets/images/pounds.svg";
import Solana from "../../assets/images/solana.svg";
import Stellar from "../../assets/images/stellar.svg";
import Tron from "../../assets/images/tron.svg";
import USD from "../../assets/images/usd.svg";
import USDC from "../../assets/images/usdc.svg";
import USDT from "../../assets/images/usdt.svg";
import View from "../shared/View";

type SvgComponent = React.FC<{ height: string; viewBox?: string; width: string }>;
type Layer = { Svg: SvgComponent; viewBox?: string };

const fiat: Record<string, SvgComponent> = { ARS, BRL, EUR, GBP, MXN, USD };
const networks: Record<string, SvgComponent> = { BASE: Base, SOLANA: Solana, STELLAR: Stellar, TRON: Tron };
const crypto: Record<string, SvgComponent> = { USDC, USDT };

const nativeViewBox = "0 0 390 390";
const frontViewBox = "-40 -36 390 390";
const smallViewBox = "28 23 454 454";
const bigViewBox = "-58 -50 335 335";

export default function AssetHero({
  currency,
  direction,
  network,
}: {
  currency?: string;
  direction: "offramp" | "onramp";
  network?: string;
}) {
  const isCrypto = !!network;
  const offramp = direction === "offramp";
  return (
    <View width="100%" aspectRatio={1}>
      {(
        [
          { Svg: Background },
          currency
            ? isCrypto
              ? crypto[currency] && { Svg: crypto[currency] }
              : fiat[currency] && {
                  Svg: offramp ? USDC : fiat[currency],
                  viewBox: offramp ? smallViewBox : nativeViewBox,
                }
            : undefined,
          isCrypto && network
            ? networks[network] && { Svg: networks[network], viewBox: nativeViewBox }
            : currency && fiat[currency]
              ? { Svg: offramp ? fiat[currency] : USDC, viewBox: offramp ? bigViewBox : frontViewBox }
              : undefined,
        ] as (Layer | undefined)[]
      )
        .filter((v): v is Layer => !!v)
        .map(({ Svg, viewBox }, index) => (
          // eslint-disable-next-line @eslint-react/no-array-index-key -- stateless svg layers, never reordered
          <View key={index} position="absolute" width="100%" height="100%">
            <Svg width="100%" height="100%" {...(viewBox && { viewBox })} />
          </View>
        ))}
    </View>
  );
}
