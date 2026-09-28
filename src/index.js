import "./utils/polyfill";
import "./utils/debug";

import "expo-router/entry";

import "@tamagui/native/setup-burnt";

import chain from "@exactly/common/generated/chain";

if (chain.id === 10) chain.name = `Optimism (${chain.name})`;
