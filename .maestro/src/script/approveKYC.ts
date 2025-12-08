import { persona } from "../server";

declare const credentialId: string | undefined;

if (!credentialId) throw new Error("missing credential");

persona(credentialId);
