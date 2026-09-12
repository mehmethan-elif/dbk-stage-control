import Foundation
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

@objc(SyncSocketPlugin)
public class SyncSocketPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SyncSocketPlugin"
    public let jsName = "SyncSocket"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "send", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "wakeLocalNetwork", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "advertise", returnType: CAPPluginReturnPromise)
    ]

    private var task: URLSessionWebSocketTask?
    private var session: URLSession?
    private var generation = 0

    @objc func wakeLocalNetwork(_ call: CAPPluginCall) {
        LocalNetworkGate.shared.wake()
        call.resolve()
    }

    @objc func advertise(_ call: CAPPluginCall) {
        LocalNetworkGate.shared.advertise(port: Int32(call.getInt("port") ?? 8787))
        call.resolve()
    }

    @objc func connect(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = URL(string: raw) else {
            call.reject("Bad master address")
            return
        }
        closeTask()
        generation += 1
        let current = generation
        let session = URLSession(configuration: .default)
        self.session = session
        let task = session.webSocketTask(with: url)
        self.task = task
        task.resume()
        pingUntilOpen(task, generation: current, attempt: 0) { [weak self] error in
            guard let self, current == self.generation else { return }
            if let error {
                call.reject(error.localizedDescription)
                return
            }
            self.notifyListeners("open", data: [:])
            self.receive(generation: current)
            call.resolve()
        }
    }

    @objc func send(_ call: CAPPluginCall) {
        guard let message = call.getString("message"), let task else {
            call.resolve()
            return
        }
        task.send(.string(message)) { _ in }
        call.resolve()
    }

    @objc func close(_ call: CAPPluginCall) {
        closeTask()
        call.resolve()
    }

    private func pingUntilOpen(
        _ task: URLSessionWebSocketTask,
        generation: Int,
        attempt: Int,
        done: @escaping (Error?) -> Void
    ) {
        task.sendPing { [weak self] error in
            guard let self, generation == self.generation else { return }
            if error == nil {
                done(nil)
                return
            }
            if attempt >= 12 {
                done(error)
                return
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                guard generation == self.generation else { return }
                self.pingUntilOpen(task, generation: generation, attempt: attempt + 1, done: done)
            }
        }
    }

    private func receive(generation: Int) {
        guard let task, generation == self.generation else { return }
        task.receive { [weak self] result in
            guard let self, generation == self.generation else { return }
            switch result {
            case .success(.string(let text)):
                self.notifyListeners("message", data: ["data": text])
                self.receive(generation: generation)
            case .success(.data(let data)):
                if let text = String(data: data, encoding: .utf8) {
                    self.notifyListeners("message", data: ["data": text])
                }
                self.receive(generation: generation)
            case .failure:
                self.notifyListeners("close", data: [:])
                self.closeTask()
            @unknown default:
                self.receive(generation: generation)
            }
        }
    }

    private func closeTask() {
        generation += 1
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        session?.invalidateAndCancel()
        session = nil
    }
}
