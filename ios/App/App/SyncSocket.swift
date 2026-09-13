import Foundation
import Network
import Capacitor

final class LocalNetworkGate: NSObject, NetServiceDelegate, NetServiceBrowserDelegate {
    static let shared = LocalNetworkGate()
    private var service: NetService?
    private var browser: NetServiceBrowser?

    func wake() {
        if browser != nil { return }
        let next = NetServiceBrowser()
        next.delegate = self
        next.searchForServices(ofType: "_dbk-stage._tcp.", inDomain: "local.")
        browser = next
    }

    func advertise(port: Int32) {
        wake()
        service?.stop()
        let next = NetService(domain: "local.", type: "_dbk-stage._tcp.", name: "DBK Stage", port: port)
        next.delegate = self
        next.publish()
        service = next
    }

    func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {}
    func netServiceBrowser(_ browser: NetServiceBrowser, didNotSearch errorDict: [String: NSNumber]) {}
    func netService(_ sender: NetService, didNotPublish errorDict: [String: NSNumber]) {}
}

/// Capacitor only registers plugins named in `packageClassList`, and `cap sync` rebuilds
/// that list from npm packages. `SyncSocketPlugin` lives in this app target, so the bridge
/// never sees it unless it is handed over here — every JS call would otherwise fall through
/// to the no-op web implementation without raising an error.
class StageBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(SyncSocketPlugin())
    }
}

@objc(SyncSocketPlugin)
public class SyncSocketPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SyncSocketPlugin"
    public let jsName = "SyncSocket"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "send", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "wakeLocalNetwork", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "advertise", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startHost", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hostSend", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "drainHost", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "lanAddress", returnType: CAPPluginReturnPromise)
    ]

    private var client: NativeSyncClient?

    public override func load() {
        StageSyncHub.shared.listen()
    }

    @objc func wakeLocalNetwork(_ call: CAPPluginCall) {
        LocalNetworkGate.shared.wake()
        call.resolve()
    }

    @objc func advertise(_ call: CAPPluginCall) {
        LocalNetworkGate.shared.advertise(port: Int32(call.getInt("port") ?? 8787))
        call.resolve()
    }

    @objc func startHost(_ call: CAPPluginCall) {
        StageSyncHub.shared.listen(port: UInt16(call.getInt("port") ?? 8787))
        call.resolve(["address": StageSyncHub.lanIPv4() ?? ""])
    }

    @objc func drainHost(_ call: CAPPluginCall) {
        call.resolve([
            "events": StageSyncHub.shared.takeEvents(),
            "peers": StageSyncHub.shared.knownPeers()
        ])
    }

    @objc func hostSend(_ call: CAPPluginCall) {
        if let uuid = call.getString("uuid"), let message = call.getString("message") {
            StageSyncHub.shared.send(uuid: uuid, message: message)
        }
        call.resolve()
    }

    @objc func lanAddress(_ call: CAPPluginCall) {
        call.resolve(["address": StageSyncHub.lanIPv4() ?? ""])
    }

    @objc func connect(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = URL(string: raw) else {
            call.reject("Bad master address")
            return
        }
        client?.close()
        let next = NativeSyncClient()
        client = next
        next.connect(url: url) { [weak self] error in
            if let error {
                call.reject(error)
                return
            }
            self?.notifyListeners("open", data: [:])
            call.resolve()
        } onMessage: { [weak self] text in
            self?.notifyListeners("message", data: ["data": text])
        } onClose: { [weak self] in
            self?.notifyListeners("close", data: [:])
        }
    }

    @objc func send(_ call: CAPPluginCall) {
        if let message = call.getString("message") {
            client?.send(text: message)
        }
        call.resolve()
    }

    @objc func close(_ call: CAPPluginCall) {
        client?.close()
        client = nil
        call.resolve()
    }
}

final class NativeSyncClient {
    private var connection: NWConnection?
    private var buffer = Data()
    private var upgraded = false
    private var closed = false
    private var onMessage: ((String) -> Void)?
    private var onClose: (() -> Void)?

    func connect(
        url: URL,
        done: @escaping (String?) -> Void,
        onMessage: @escaping (String) -> Void,
        onClose: @escaping () -> Void
    ) {
        self.onMessage = onMessage
        self.onClose = onClose
        var settled = false
        let finishConnect: (String?) -> Void = { error in
            guard !settled else { return }
            settled = true
            DispatchQueue.main.async { done(error) }
        }
        let host = url.host ?? ""
        let port = NWEndpoint.Port(rawValue: UInt16(url.port ?? 8787)) ?? 8787
        let path = url.path.isEmpty ? "/" : url.path
        let connection = NWConnection(host: NWEndpoint.Host(host), port: port, using: .tcp)
        self.connection = connection
        connection.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready:
                self?.sendHandshake(host: host, port: port.rawValue, path: path)
            case .failed(let error):
                finishConnect(error.localizedDescription)
            case .cancelled:
                if self?.upgraded == true { self?.finish() }
            default:
                break
            }
        }
        connection.start(queue: .global(qos: .userInitiated))
        receive(done: finishConnect)
        DispatchQueue.global().asyncAfter(deadline: .now() + 2) { [weak self] in
            guard let self, !self.upgraded, !self.closed else { return }
            finishConnect("Connection timed out")
            self.close()
        }
    }

    func send(text: String) {
        guard upgraded, let data = text.data(using: .utf8) else { return }
        connection?.send(content: Self.maskedFrame(opcode: 0x01, payload: [UInt8](data)), completion: .contentProcessed { _ in })
    }

    func close() {
        closed = true
        connection?.cancel()
        connection = nil
    }

    private func sendHandshake(host: String, port: UInt16, path: String) {
        var bytes = [UInt8](repeating: 0, count: 16)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        let key = Data(bytes).base64EncodedString()
        var request = "GET \(path) HTTP/1.1\r\n"
        request += "Host: \(host):\(port)\r\n"
        request += "Upgrade: websocket\r\n"
        request += "Connection: Upgrade\r\n"
        request += "Sec-WebSocket-Key: \(key)\r\n"
        request += "Sec-WebSocket-Version: 13\r\n\r\n"
        connection?.send(content: Data(request.utf8), completion: .contentProcessed { _ in })
    }

    private func receive(done: @escaping (String?) -> Void) {
        connection?.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
            guard let self, !self.closed else { return }
            if let error {
                if !self.upgraded { done(error.localizedDescription) } else { self.finish() }
                return
            }
            if let data { self.buffer.append(data) }
            if !self.upgraded {
                if let range = self.buffer.range(of: Data("\r\n\r\n".utf8)) {
                    let header = String(data: self.buffer.subdata(in: self.buffer.startIndex..<range.lowerBound), encoding: .utf8) ?? ""
                    self.buffer.removeSubrange(self.buffer.startIndex..<range.upperBound)
                    if header.contains("101") {
                        self.upgraded = true
                        DispatchQueue.main.async { done(nil) }
                    } else {
                        DispatchQueue.main.async { done("Master refused the connection") }
                        self.close()
                        return
                    }
                } else if isComplete {
                    DispatchQueue.main.async { done("No master at that address") }
                    return
                }
            }
            if self.upgraded { self.drainFrames() }
            if isComplete {
                if self.upgraded { self.finish() }
                return
            }
            self.receive(done: done)
        }
    }

    private func drainFrames() {
        while buffer.count >= 2 {
            let bytes = [UInt8](buffer)
            let opcode = bytes[0] & 0x0F
            let masked = (bytes[1] & 0x80) != 0
            var length = UInt64(bytes[1] & 0x7F)
            var offset = 2
            if length == 126 {
                guard buffer.count >= 4 else { return }
                length = UInt64(bytes[2]) << 8 | UInt64(bytes[3])
                offset = 4
            } else if length == 127 {
                return
            }
            if masked { offset += 4 }
            guard buffer.count >= offset + Int(length) else { return }
            var payload = Array(bytes[offset..<offset + Int(length)])
            if masked {
                let mask = Array(bytes[(offset - 4)..<offset])
                for i in payload.indices { payload[i] ^= mask[i % 4] }
            }
            buffer.removeFirst(offset + Int(length))
            if opcode == 0x01, let text = String(bytes: payload, encoding: .utf8) {
                DispatchQueue.main.async { self.onMessage?(text) }
            } else if opcode == 0x08 {
                finish()
                return
            }
        }
    }

    private func finish() {
        guard !closed else { return }
        closed = true
        connection?.cancel()
        DispatchQueue.main.async { self.onClose?() }
    }

    private static func maskedFrame(opcode: UInt8, payload: [UInt8]) -> Data {
        var frame = [UInt8]()
        frame.append(0x80 | opcode)
        var mask = [UInt8](repeating: 0, count: 4)
        _ = SecRandomCopyBytes(kSecRandomDefault, 4, &mask)
        if payload.count < 126 {
            frame.append(0x80 | UInt8(payload.count))
        } else {
            frame.append(0x80 | 126)
            frame.append(UInt8((payload.count >> 8) & 0xFF))
            frame.append(UInt8(payload.count & 0xFF))
        }
        frame.append(contentsOf: mask)
        for i in payload.indices { frame.append(payload[i] ^ mask[i % 4]) }
        return Data(frame)
    }
}
