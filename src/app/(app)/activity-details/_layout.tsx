import type { ParamListBase } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Stack } from "expo-router";
import React from "react";

import useBackgroundColor from "../../../utils/useBackgroundColor";

export default function ActivityDetailsLayout() {
  useBackgroundColor();
  return <Stack screenOptions={{ headerShown: false }} />;
}

export type ActivityDetailsNavigationProperties = NativeStackNavigationProp<ActivityDetailsParameterList>;
export interface ActivityDetailsParameterList extends ParamListBase {
  index: undefined;
}
