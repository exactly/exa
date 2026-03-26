declare module "xcode" {
  export type PBXFile = Record<string, unknown>;
  export type PBXGroup = Record<string, unknown>;
  export type PBXNativeTarget = Record<string, unknown> & {
    buildConfigurationList: string;
    dependencies?: { value: string }[];
    name: string;
    productType: string;
  };
  export type PBXProject = Record<string, unknown>;
  export type UUID = string;
  export type XCBuildConfiguration = Record<string, unknown>;
  export type XCConfigurationList = Record<string, unknown>;
  export type XcodeProject = Record<string, unknown>;

  const xcode: {
    project(filepath: string): XcodeProject;
  };

  export default xcode;
}
