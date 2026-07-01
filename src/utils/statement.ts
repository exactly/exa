import { Platform } from "react-native";

import { File, Paths } from "expo-file-system";
import { isAvailableAsync, shareAsync } from "expo-sharing";

import { getStatement } from "./server";

export async function downloadStatement(maturity: number, filename: string) {
  const bytes = await getStatement(maturity);
  if (Platform.OS !== "web") return share(bytes, filename);
  const url = pdf(bytes);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function viewStatement(maturity: number, filename: string) {
  const bytes = await getStatement(maturity);
  if (Platform.OS !== "web") return share(bytes, filename);
  window.open(pdf(bytes), "_blank");
}

async function share(bytes: Uint8Array, filename: string) {
  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.write(bytes);
  if (!(await isAvailableAsync())) throw new Error("sharing unavailable");
  await shareAsync(file.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: filename });
}

function pdf(bytes: Uint8Array) {
  return URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/pdf" }));
}
