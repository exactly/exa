import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

import { createURL, getInitialURL, getLinkingURL } from "expo-linking";

import { object, parse, string } from "valibot";

import reportError from "../utils/reportError";

const KEY = "update.route";
const Marker = object({ path: string(), route: string() });

export function redirectSystemPath({ path, initial }: { initial: boolean; path: string }) {
  if (!initial) return path;
  return AsyncStorage.getItem(KEY)
    .then(async (saved) => {
      if (saved === null) return path;
      await AsyncStorage.removeItem(KEY);
      const marker = parse(Marker, JSON.parse(saved));
      return marker.path === path ? marker.route : path;
    })
    .catch((error: unknown) => {
      reportError(error);
      return path;
    });
}

export async function remember(route: string) {
  const path = (Platform.OS === "ios" ? getLinkingURL() : await getInitialURL()) ?? createURL("/");
  await AsyncStorage.setItem(KEY, JSON.stringify({ path, route }));
}

export function forget() {
  return AsyncStorage.removeItem(KEY);
}
