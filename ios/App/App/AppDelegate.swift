import UIKit
import AVFoundation
import Capacitor
import Network

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        activatePlaybackSession()
        PracticeShareServer.shared.start()
        return true
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        activatePlaybackSession()
    }

    private func activatePlaybackSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .default, options: [])
            try session.setActive(true)
        } catch {
            NSLog("DBK audio session failed: \(error.localizedDescription)")
        }
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        activatePlaybackSession()
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

final class PracticeShareServer {
    static let shared = PracticeShareServer()
    private var listener: NWListener?

    func start(port: UInt16 = 8788) {
        guard listener == nil else { return }
        do {
            let params = NWParameters.tcp
            listener = try NWListener(using: params, on: NWEndpoint.Port(rawValue: port) ?? 8788)
        } catch {
            NSLog("DBK practice share listen failed: \(error.localizedDescription)")
            return
        }
        listener?.newConnectionHandler = { connection in
            connection.start(queue: .global(qos: .userInitiated))
            self.receive(on: connection, buffer: Data())
        }
        listener?.start(queue: .global(qos: .utility))
        NSLog("DBK practice share http://0.0.0.0:\(port)")
    }

    private func receive(on connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { data, _, isComplete, error in
            var next = buffer
            if let data { next.append(data) }
            if let range = next.range(of: Data("\r\n\r\n".utf8)) {
                let header = String(data: next.subdata(in: next.startIndex..<range.lowerBound), encoding: .utf8) ?? ""
                let path = Self.requestPath(from: header)
                let response = self.response(for: path)
                connection.send(content: response, completion: .contentProcessed { _ in
                    connection.cancel()
                })
                return
            }
            if isComplete || error != nil {
                connection.cancel()
                return
            }
            self.receive(on: connection, buffer: next)
        }
    }

    private static func requestPath(from header: String) -> String {
        let first = header.split(separator: "\r\n", maxSplits: 1).first.map(String.init) ?? ""
        let parts = first.split(separator: " ")
        guard parts.count >= 2 else { return "/" }
        let raw = String(parts[1])
        return raw.split(separator: "?", maxSplits: 1).first.map(String.init) ?? "/"
    }

    private func response(for path: String) -> Data {
        if path == "/practice/index.json" {
            return Self.http(200, "application/json; charset=utf-8", Self.practiceIndex())
        }
        if path.hasPrefix("/practice/songs/") {
            let rest = String(path.dropFirst("/practice/songs/".count))
            if let file = Self.practiceFile(rest) {
                return Self.http(200, Self.mime(file.pathExtension), (try? Data(contentsOf: file)) ?? Data())
            }
            return Self.http(404, "text/plain", Data("Not found".utf8))
        }
        if let file = Self.webFile(path) {
            return Self.http(200, Self.mime(file.pathExtension), (try? Data(contentsOf: file)) ?? Data())
        }
        if let index = Self.webFile("/index.html") {
            return Self.http(200, "text/html; charset=utf-8", (try? Data(contentsOf: index)) ?? Data())
        }
        return Self.http(404, "text/plain", Data("Not found".utf8))
    }

    private static func http(_ status: Int, _ type: String, _ body: Data) -> Data {
        let phrase = status == 200 ? "OK" : "Not Found"
        var header = "HTTP/1.1 \(status) \(phrase)\r\n"
        header += "Content-Type: \(type)\r\n"
        header += "Content-Length: \(body.count)\r\n"
        header += "Access-Control-Allow-Origin: *\r\n"
        header += "Connection: close\r\n\r\n"
        var data = Data(header.utf8)
        data.append(body)
        return data
    }

    private static func isPracticeFile(_ name: String) -> Bool {
        let base = name.lowercased()
        if ["song.json", "settings.json", "lyrics.json", "lyrics.txt", "master.mp3", "master.flac"].contains(base) {
            return true
        }
        return base.hasSuffix(".pdf") || base.hasSuffix(".musicxml")
    }

    private static func documentsSongs() -> URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("library/songs", isDirectory: true)
    }

    private static func practiceIndex() -> Data {
        let root = documentsSongs()
        var songs: [[String: Any]] = []
        let folders = (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isDirectoryKey])) ?? []
        for folder in folders where (try? folder.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true {
            let name = folder.lastPathComponent
            if name.hasPrefix(".") { continue }
            let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.fileSizeKey])) ?? []
            var listed: [[String: Any]] = []
            for file in files where isPracticeFile(file.lastPathComponent) {
                let size = (try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
                listed.append(["path": file.lastPathComponent, "size": size])
            }
            var id = name
            let songJson = folder.appendingPathComponent("song.json")
            if let data = try? Data(contentsOf: songJson),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let rawId = json["id"] as? String,
               !rawId.isEmpty {
                id = rawId
            }
            songs.append(["id": id, "folder": name, "files": listed])
        }
        return (try? JSONSerialization.data(withJSONObject: ["songs": songs])) ?? Data("{}".utf8)
    }

    private static func practiceFile(_ rest: String) -> URL? {
        let decoded = rest.removingPercentEncoding ?? rest
        let parts = decoded.split(separator: "/").map(String.init)
        guard parts.count >= 2 else { return nil }
        let folder = parts[0]
        let name = parts[parts.count - 1]
        guard isPracticeFile(name), !folder.contains(".."), !name.contains("..") else { return nil }
        let url = documentsSongs().appendingPathComponent(folder, isDirectory: true).appendingPathComponent(name)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    private static func webFile(_ path: String) -> URL? {
        guard let root = Bundle.main.resourceURL?.appendingPathComponent("public", isDirectory: true) else {
            return nil
        }
        let clean = path == "/client" || path == "/client/" ? "/index.html" : path
        let relative = clean.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let url = relative.isEmpty ? root.appendingPathComponent("index.html") : root.appendingPathComponent(relative)
        let resolved = url.standardizedFileURL
        guard resolved.path.hasPrefix(root.standardizedFileURL.path) else { return nil }
        return FileManager.default.fileExists(atPath: resolved.path) ? resolved : nil
    }

    private static func mime(_ ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json", "webmanifest": return "application/json; charset=utf-8"
        case "pdf": return "application/pdf"
        case "mp3": return "audio/mpeg"
        case "flac": return "audio/flac"
        default: return "application/octet-stream"
        }
    }
}
