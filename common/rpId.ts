import domain from "./domain";

export const domains: Record<string, string> = { "base-sepolia.exactly.app": "sandbox.exactly.app" };

const rpId = domains[domain] ?? domain;
export default rpId;

export const accepted = [...new Set([rpId, domain])];
