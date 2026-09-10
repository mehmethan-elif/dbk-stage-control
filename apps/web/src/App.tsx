import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import type { DeviceKind } from "@dbk/protocol";
import { isNativeApp } from "./native/platform";
import { ClientApp } from "./ui/client/ClientApp";
import { MasterApp } from "./ui/master/MasterApp";
import { RemoteApp } from "./ui/remote/RemoteApp";
import { RoleGate } from "./ui/native/RoleGate";
import { useMasterStore } from "./store/master-store";

function kindFromPath(pathname: string, publicClient: boolean): DeviceKind {
  if (pathname.startsWith("/remote")) return "remote";
  if (publicClient || pathname.startsWith("/client")) return "client";
  return "master";
}

export function App() {
  const load = useMasterStore((s) => s.load);
  const location = useLocation();
  const navigate = useNavigate();
  const native = isNativeApp();
  const publicClient = import.meta.env.VITE_PUBLIC_CLIENT === "1";
  const pathKind = kindFromPath(location.pathname, publicClient);
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
      <Route
        path="/"
        element={
          <Navigate
            to={publicClient || kind === "client" ? "/client" : kind === "remote" ? "/remote" : "/master"}
            replace
          />
        }
      />
      {publicClient ? null : <Route path="/master" element={<MasterApp />} />}
      <Route path="/client" element={<ClientApp />} />
      <Route path="/remote" element={<RemoteApp />} />
      <Route
        path="*"
        element={<Navigate to={publicClient ? "/client" : kind === "remote" ? "/remote" : "/master"} replace />}
      />
    </Routes>
  );
}
