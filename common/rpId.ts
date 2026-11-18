import domain from "./domain";

export const domains: Record<string, string> = {
  "base-sepolia.exactly.app": "sandbox.exactly.app",
  "base.exactly.app": "web.exactly.app",
  "business.exactly.app": "web.exactly.app",
};

const rpId = domains[domain] ?? domain;
export default rpId;

export const accepted = [...new Set([rpId, domain])];
