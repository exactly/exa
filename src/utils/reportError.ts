import { captureException } from "@sentry/react-native";

export default function reportError(error: unknown, hint?: Parameters<typeof captureException>[1]) {
  console.error(error); // eslint-disable-line no-console
  try {
    return captureException(error, hint);
  } catch (sentryError) {
    console.error(sentryError); // eslint-disable-line no-console
  }
}
