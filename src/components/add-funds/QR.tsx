import React from "react";
import QRCode, { useQRCodeData } from "react-native-qrcode-styled";

import { View } from "tamagui";

export default function QR({ children, data, size }: { children?: React.ReactNode; data: string; size: number }) {
  const padding = (4 * size) / (useQRCodeData(data, options).qrCodeSize + 8);
  return (
    <View alignSelf="center" borderRadius="r4" backgroundColor="baseGray0">
      <QRCode
        {...options}
        data={data}
        size={size - 2 * padding}
        padding={padding}
        pieceBorderRadius={2}
        innerEyesOptions={{ borderRadius: 2 }}
        isPiecesGlued
        outerEyesOptions={{ borderRadius: 2 }}
      />
      {children ? (
        <View position="absolute" top="s0" right="s0" bottom="s0" left="s0" alignItems="center" justifyContent="center">
          <View backgroundColor="baseGray0" borderRadius="r_0" padding="s2">
            {children}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const options = { errorCorrectionLevel: "M" } as const;
