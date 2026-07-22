import type { Job as Poke } from "../poke/job";

export const name = "allow";
export const attempts = 10;

export type Job = Omit<Poke, "origin">;
