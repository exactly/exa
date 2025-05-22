import pem from "@exactly/common/pandaCertificate";
import { Platform } from "react-native";
import type Crypto from "react-native-quick-crypto";

export async function session() {
  if (Platform.OS !== "web") {
    const crypto = require("react-native-quick-crypto") as typeof Crypto; // eslint-disable-line @typescript-eslint/no-require-imports, unicorn/prefer-module
    const secret = crypto.randomUUID().replaceAll("-", "");
    const secretKeyBase64 = Buffer.from(secret, "hex").toString("base64");
    const secretKeyBase64Buffer = Buffer.from(secretKeyBase64, "utf8");
    const secretKeyBase64BufferEncrypted = crypto.publicEncrypt(
      { key: pem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
      secretKeyBase64Buffer,
    );
    return { id: secretKeyBase64BufferEncrypted.toString("base64"), secret };
  }
  const secret = window.crypto.randomUUID().replaceAll("-", "");
  const secretBytes = [];
  for (let index = 0; index < secret.length; index += 2) {
    secretBytes.push(Number.parseInt(secret.slice(index, index + 2), 16));
  }
  const byteArray = new Uint8Array(secretBytes);
  let secretBinary = "";
  for (const byte of byteArray) secretBinary += String.fromCodePoint(byte);
  const secretKeyBase64 = window.btoa(secretBinary);

  const pemHeader = "-----BEGIN PUBLIC KEY-----";
  const pemFooter = "-----END PUBLIC KEY-----";
  const pemContents = pem.slice(pemHeader.length, pem.length - pemFooter.length - 1);
  const binaryDerString = window.atob(pemContents);
  const buf = new ArrayBuffer(binaryDerString.length);
  const bufView = new Uint8Array(buf);
  for (let index = 0, stringLength = binaryDerString.length; index < stringLength; index++) {
    bufView[index] = binaryDerString.codePointAt(index)!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
  }
  const binaryDer = buf;

  const rsaPublicKey = await window.crypto.subtle.importKey(
    "spki",
    binaryDer,
    { name: "RSA-OAEP", hash: "SHA-1" },
    true,
    ["encrypt"],
  );

  const encryptedArrayBuffer = await window.crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    rsaPublicKey,
    new TextEncoder().encode(secretKeyBase64),
  );
  let binary = "";
  const bytes = new Uint8Array(encryptedArrayBuffer);
  const length = bytes.byteLength;
  for (let index = 0; index < length; index++) {
    binary += String.fromCodePoint(bytes[index]!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
  }

  return { id: window.btoa(binary), secret };
}

export async function decrypt(base64Secret: string, base64Iv: string, secretKey: string) {
  if (!base64Secret) throw new Error("base64Secret is required");
  if (!base64Iv) throw new Error("base64Iv is required");
  if (!secretKey || !/^[0-9A-F]+$/i.test(secretKey)) {
    throw new Error("secretKey must be a hex string");
  }

  if (Platform.OS !== "web") {
    const crypto = require("react-native-quick-crypto") as typeof Crypto; // eslint-disable-line @typescript-eslint/no-require-imports, unicorn/prefer-module
    const secret = Buffer.from(base64Secret, "base64");
    const iv = Buffer.from(base64Iv, "base64");
    const decipher = crypto.createDecipheriv("aes-128-gcm", Buffer.from(secretKey, "hex"), iv);
    decipher.setAutoPadding(false);
    decipher.setAuthTag(secret.subarray(-16));
    return Buffer.concat([decipher.update(secret.subarray(0, -16)), decipher.final()]).toString("utf8");
  }

  const secret = Uint8Array.from(window.atob(base64Secret), (c) => c.codePointAt(0)!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
  const iv = Uint8Array.from(window.atob(base64Iv), (c) => c.codePointAt(0)!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
  const secretKeyArrayBuffer = Uint8Array.from(
    secretKey.match(/.{1,2}/g)!.map((byte) => Number.parseInt(byte, 16)), // eslint-disable-line @typescript-eslint/no-non-null-assertion
  );

  const cryptoKey = await window.crypto.subtle.importKey("raw", secretKeyArrayBuffer, { name: "AES-GCM" }, false, [
    "decrypt",
  ]);

  const decrypted = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv }, cryptoKey, secret);
  return new TextDecoder().decode(decrypted);
}

async function encrypt(data: string) {
  const { id: sessionId, secret } = await session();
  const keyBytes = new Uint8Array(Buffer.from(secret, "hex"));

  let iv: Uint8Array;
  let encryptedData: ArrayBuffer;
  if (Platform.OS === "web") {
    iv = window.crypto.getRandomValues(new Uint8Array(16));
    const key = await window.crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt"]);
    encryptedData = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(data));
  } else {
    const crypto = require("react-native-quick-crypto") as typeof Crypto; // eslint-disable-line @typescript-eslint/no-require-imports, unicorn/prefer-module
    iv = crypto.randomBytes(16);
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt"]);
    encryptedData = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(data));
  }
  return {
    sessionId,
    encryptedPin: {
      iv: window.btoa(String.fromCodePoint(...iv)),
      data: window.btoa(String.fromCodePoint(...new Uint8Array(encryptedData))),
    },
  };
}

export async function encryptPIN(pin: string) {
  if (pin.length !== 4) throw new Error(`pin must be 4 digits`);
  const data = `2${pin.length.toString(16)}${pin}${"F".repeat(14 - pin.length)}`;
  return await encrypt(data);
}

export async function decryptPIN(base64Secret: string, base64Iv: string, secretKey: string) {
  const data = await decrypt(base64Secret, base64Iv, secretKey);
  const length = data.slice(1, 2);
  return data.slice(2, 2 + Number.parseInt(length, 10));
}
