import { isBandNameConnected, VOCAL_BAND_NAME } from "@dbk/core";
import type { DeviceKind } from "@dbk/protocol";

export function stageConnectOn(state: {
  deviceKind: DeviceKind;
  clientSession: "practice" | "stage";
  syncConnected: boolean;
  syncPeers: readonly { deviceKind?: string; deviceName?: string }[];
}): boolean {
  if (state.deviceKind === "remote") return state.clientSession === "stage" && state.syncConnected;
  if (state.deviceKind === "client") return state.clientSession === "stage";
  return state.syncConnected && isBandNameConnected(VOCAL_BAND_NAME, state.syncPeers);
}
