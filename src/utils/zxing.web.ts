import wasm from "zxing-wasm/reader/zxing_reader.wasm";

const native = "BarcodeDetector" in globalThis;

export default async function zxing() {
  if (native) return null;
  const { prepareZXingModule, ZXING_WASM_SHA256 } = await import("barcode-detector");
  const response = await fetch(wasm, {
    integrity: `sha256-${Buffer.from(ZXING_WASM_SHA256, "hex").toString("base64")}`,
  });
  await prepareZXingModule({ overrides: { wasmBinary: await response.arrayBuffer() }, fireImmediately: true });
  return null;
}
