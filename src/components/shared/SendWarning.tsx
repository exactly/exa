import { useTranslation } from "react-i18next";

export default function SendWarning({ asset, network }: { asset?: string; network: string }) {
  const { t } = useTranslation();
  return asset
    ? t("Only send {{crypto}} on {{network}}. Sending other assets or using other networks may cause permanent loss.", {
        crypto: asset,
        network,
      })
    : t("Only send assets on {{chain}}. Sending funds from other networks may cause permanent loss.", {
        chain: network,
      });
}
