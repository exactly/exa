declare module "*.svg" {
  import type { FC } from "react";
  import type { SvgProps } from "react-native-svg";
  const content: FC<SvgProps>;
  export default content;
}

declare module "react-native-svg-transformer/expo" {
  export function transform(input: { filename: string; src: string }): unknown;
}

declare module "react-native-svg-transformer" {
  type Transformer = { transform: (input: { filename: string; src: string }) => unknown };
  export function getExpoTransformer(): Transformer | undefined;
  export function getReactNativeTransformer(): Transformer;
}

declare module "*.webp" {
  const value: number;
  export default value;
}
