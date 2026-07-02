declare module "xcode" {
  type PBXEntry = Record<string, unknown> & {
    isa?: unknown;
    name?: unknown;
    path?: unknown;
    target?: unknown;
    targetProxy?: unknown;
  };

  export type XcodeProject = {
    addBuildPhase(
      files: string[],
      type: string,
      name: string,
      target?: string,
      options?: { outputPaths?: string[]; shellPath?: string; shellScript?: string },
    ): unknown;
    addPbxGroup(files: string[], name: string, path: string): { uuid: string };
    addTarget(name: string, type: string, subfolder: string, bundleId: string): { uuid: string };
    addTargetAttribute(name: string, value: string, target?: { uuid: string }): void;
    addToPbxGroup(uuid: string, key: string): void;
    hash: {
      project: {
        objects: {
          [key: string]: Record<string, PBXEntry | string | undefined> | undefined;
          PBXContainerItemProxy?: Record<string, PBXEntry | string | undefined>;
          PBXGroup?: Record<string, PBXEntry | undefined>;
          PBXNativeTarget?: Record<string, PBXEntry | string | undefined>;
          PBXTargetDependency?: Record<string, PBXEntry | string | undefined>;
        };
        rootObject?: string;
        rootObject_comment?: string;
      };
    };
    pbxTargetByName(name: string): unknown;
    pbxXCBuildConfigurationSection(): Record<string, { buildSettings?: Record<string, string> }>;
  };

  const xcode: {
    project(filepath: string): XcodeProject;
  };

  export default xcode;
}
