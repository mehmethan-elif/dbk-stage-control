import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useEffect } from "react";
import type { DeviceKind } from "@dbk/protocol";
import { isNativeApp } from "./native/platform";
import { ClientApp } from "./ui/client/ClientApp";
import { MasterApp } from "./ui/master/MasterApp";
import { RemoteApp } from "./ui/remote/RemoteApp";
import { useMasterStore } from "./store/master-store";

function kindFromPath(pathname: string, publicClient: boolean): DeviceKind {
  if (pathname.startsWith("/remote")) return "remote";
  if (publicClient || pathname.startsWith("/client")) return "client";
  return "master";
}

export function App() {
  const load = useMasterStore((s) => s.load);
  const location = useLocation();
  const publicClient = import.meta.env.VITE_PUBLIC_CLIENT === "1";
  const pathKind = kindFromPath(location.pathname, publicClient);
  // The installed app is the desk and nothing else: it is the copy that carries the stems. Band
  // members run the published page off their home screen, so there is nothing to choose between.
  const kind = isNativeApp() ? "master" : pathKind;

  useEffect(() => {
    void load(kind);
  }, [load, kind]);

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
