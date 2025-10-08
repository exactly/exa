import { encryptPIN, session } from "./panda";
import queryClient from "./queryClient";
import { api, APIError, auth, stringOrLegacy } from "./server";

export async function getCard() {
  await auth();
  const { id, secret } = await session();
  const response = await api.card.$get({ header: { sessionid: id } });
  if (!response.ok) throw new APIError(response.status, stringOrLegacy(await response.json()));
  const card = await response.json();
  return { ...card, secret };
}

export async function createCard() {
  await auth();
  const response = await api.card.$post();
  if (!response.ok) throw new APIError(response.status, stringOrLegacy(await response.json()));
  return response.json();
}

export async function setCardStatus(status: "ACTIVE" | "FROZEN") {
  await auth();
  const response = await api.card.$patch({ json: { status } });
  if (!response.ok) throw new APIError(response.status, stringOrLegacy(await response.json()));
  return response.json();
}

export async function setCardMode(mode: number) {
  await auth();
  const response = await api.card.$patch({ json: { mode } });
  if (!response.ok) throw new APIError(response.status, stringOrLegacy(await response.json()));
  return response.json();
}

export async function setCardPIN(pin: string) {
  await auth();
  const json = await encryptPIN(pin);
  const response = await api.card.$patch({ json });
  if (!response.ok) throw new APIError(response.status, stringOrLegacy(await response.json()));
}

queryClient.setQueryDefaults(["card", "details"], { queryFn: getCard, retry: 2, staleTime: 0, gcTime: 0 });

export type CardDetails = Awaited<ReturnType<typeof getCard>>;
