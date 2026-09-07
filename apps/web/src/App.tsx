import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import type { DeviceKind } from "@dbk/protocol";
import { isNativeApp } from "./native/platform";
import { ClientApp } from "./ui/client/ClientApp";
import { MasterApp } from "./ui/master/MasterApp";
import { RoleGate } from "./ui/native/RoleGate";
import { useMasterStore } from "./store/master-store";

export function App() {
  const load = useMasterStore((s) => s.load);
  const location = useLocation();
  const navigate = useNavigate();
  const native = isNativeApp();
  const publicClient = import.meta.env.VITE_PUBLIC_CLIENT === "1";
  const pathKind: DeviceKind =
    publicClient || location.pathname.startsWith("/client") ? "client" : "master";
  const [nativeKind, setNativeKind] = useState<DeviceKind | null>(native ? null : pathKind);
  const [syncHost, setSyncHost] = useState<string | undefined>();
  const kind = native ? nativeKind : pathKind;

  useEffect(() => {
    if (!kind) return;
    void load(kind, { syncHost });
  }, [load, kind, syncHost]);

  if (native && !kind) {
    return (
      <RoleGate
        onChoose={(nextKind, host) => {
          setSyncHost(host);
          setNativeKind(nextKind);
          navigate(nextKind === "client" ? "/client" : "/master", { replace: true });
        }}
      />
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Navigate to={publicClient || kind === "client" ? "/client" : "/master"} replace />} />
      {publicClient ? null : <Route path="/master" element={<MasterApp />} />}
      <Route path="/client" element={<ClientApp />} />
      <Route path="*" element={<Navigate to={publicClient ? "/client" : "/master"} replace />} />
    </Routes>
  );
}
