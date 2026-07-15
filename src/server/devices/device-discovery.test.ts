import { describe, expect, it } from "vitest";

import { parseAdbDevices } from "./device-discovery.js";

const THREE_DEVICE_FIXTURE = `List of devices attached
emulator-5554 device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:1
R58M123456F offline product:dreamlte model:SM_G950F transport_id:2
ZX1G22 unauthorized usb:1-1 transport_id:3
`;

describe("parseAdbDevices", () => {
  it("parses device states and long-list metadata", () => {
    // Given
    const output = THREE_DEVICE_FIXTURE;

    // When
    const devices = parseAdbDevices(output);

    // Then
    expect(devices).toEqual([
      {
        serial: "emulator-5554",
        state: "device",
        product: "sdk_gphone64_arm64",
        model: "sdk_gphone64_arm64",
        transportId: "1",
      },
      {
        serial: "R58M123456F",
        state: "offline",
        product: "dreamlte",
        model: "SM_G950F",
        transportId: "2",
      },
      {
        serial: "ZX1G22",
        state: "unauthorized",
        transportId: "3",
      },
    ]);
  });
});
