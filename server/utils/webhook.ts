import { resolve4, resolve6 } from "node:dns/promises";

export default async function isValid(raw: string) {
  const { hostname, protocol } = new URL(raw);
  if (protocol !== "https:") throw new Error("url must use https");
  const [v4, v6] = await Promise.all([resolve4(hostname).catch(() => []), resolve6(hostname).catch(() => [])]);
  const addresses = [...v4, ...v6];
  if (addresses.length === 0) throw new Error("url does not resolve");

  if (
    addresses
      .map((ip) => (ip.startsWith("::ffff:") ? ip.slice(7).toLowerCase() : ip.toLowerCase()))
      .some((lowerIp) => isPrivate(lowerIp))
  )
    throw new Error("url resolves to private address");
}

function isPrivate(ip: string) {
  if (ip.includes(":")) return ip === "::1" || /^fe[89ab]/.test(ip) || ip.startsWith("fc") || ip.startsWith("fd");
  const parts = ip.split(".").map(Number);
  return (
    parts[0] === 127 ||
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] !== undefined && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 169 && parts[1] === 254) ||
    ip === "0.0.0.0"
  );
}
