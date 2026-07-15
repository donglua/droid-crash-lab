import { describe, expectTypeOf, it } from "vitest";

import type {
  ApkInfo,
  DeviceInfo,
  InstallApkResponse,
  RunConfig as ContractRunConfig,
  RunEvent,
  RunSummary,
} from "./contracts.js";
import type {
  ApkToken,
  DeviceSerial,
  EventId,
  InstallApkRequest,
  RunConfig as SchemaRunConfig,
  RunId,
  RunIdParams,
} from "./schemas.js";

describe("shared identifier brands", () => {
  it("does not allow a device serial where an APK token is required", () => {
    expectTypeOf<DeviceSerial>().not.toMatchTypeOf<ApkToken>();
  });

  it("does not allow an APK token where a device serial is required", () => {
    expectTypeOf<ApkToken>().not.toMatchTypeOf<DeviceSerial>();
  });

  it("does not allow an APK token where a run ID is required", () => {
    expectTypeOf<ApkToken>().not.toMatchTypeOf<RunId>();
  });

  it("does not allow a run ID where an APK token is required", () => {
    expectTypeOf<RunId>().not.toMatchTypeOf<ApkToken>();
  });

  it("does not treat event IDs as string identifiers", () => {
    expectTypeOf<EventId>().not.toMatchTypeOf<RunId>();
  });
});

describe("shared identifier fields", () => {
  it("uses DeviceSerial for device information", () => {
    expectTypeOf<DeviceInfo["serial"]>().toEqualTypeOf<DeviceSerial>();
  });

  it("uses ApkToken for APK information", () => {
    expectTypeOf<ApkInfo["token"]>().toEqualTypeOf<ApkToken>();
  });

  it("uses RunId for run summaries", () => {
    expectTypeOf<RunSummary["id"]>().toEqualTypeOf<RunId>();
  });

  it("uses EventId for run events", () => {
    expectTypeOf<RunEvent["id"]>().toEqualTypeOf<EventId>();
  });

  it("uses branded values in install requests", () => {
    expectTypeOf<InstallApkRequest>().toMatchTypeOf<{
      readonly apkToken: ApkToken;
      readonly deviceSerial: DeviceSerial;
    }>();
  });

  it("uses RunId in route parameters", () => {
    expectTypeOf<RunIdParams["id"]>().toEqualTypeOf<RunId>();
  });

  it("uses branded values in install responses", () => {
    expectTypeOf<InstallApkResponse>().toMatchTypeOf<{
      readonly apkToken: ApkToken;
      readonly deviceSerial: DeviceSerial;
    }>();
  });

  it("derives the contract RunConfig from the schema output", () => {
    expectTypeOf<ContractRunConfig>().toEqualTypeOf<SchemaRunConfig>();
  });
});
