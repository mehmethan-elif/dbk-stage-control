import Foundation
import Network
import CommonCrypto
import Darwin

final class StageSyncHub {
    static let shared = StageSyncHub()

    private let queue = DispatchQueue(label: "com.dbk.stagesync", qos: .userInitiated)
    private var listener: NWListener?
    private var sessions: [String: StageSyncSession] = [:]
    private var inbox: [String: [String]] = [:]
    private var onOpen: ((String) -> Void)?
    private var onClose: ((String) -> Void)?
    private var onMessage: ((String, String) -> Void)?

    func listen(port: UInt16 = 8787) {
        queue.async {
            guard self.listener == nil else { return }
            do {
                let listener = try NWListener(using: .tcp, on: NWEndpoint.Port(rawValue: port) ?? 8787)
                self.listener = listener
                listener.newConnectionHandler = { [weak self] connection in
                    connection.start(queue: .global(qos: .userInitiated))
                    self?.accept(connection: connection, request: Data())
                }
                listener.start(queue: self.queue)
                NSLog("DBK stage sync ws://0.0.0.0:\(port)")
            } catch {
                NSLog("DBK stage sync listen failed: \(error.localizedDescription)")
            }
        }
    }

    func bind(
        onOpen: @escaping (String) -> Void,
        onClose: @escaping (String) -> Void,
        onMessage: @escaping (String, String) -> Void
    ) {
        queue.async {
            self.onOpen = onOpen
            self.onClose = onClose
            self.onMessage = onMessage
            for uuid in self.sessions.keys {
                DispatchQueue.main.async { onOpen(uuid) }
            }
            for (uuid, messages) in self.inbox {
                for text in messages {
                    DispatchQueue.main.async { onMessage(uuid, text) }
                }
            }
        }
    }

    func accept(connection: NWConnection, request: Data) {
        queue.async {
            let session = StageSyncSession(uuid: UUID().uuidString, connection: connection)
            session.onOpen = { [weak self] uuid in
                self?.queue.async {
                    let handler = self?.onOpen
                    DispatchQueue.main.async { handler?(uuid) }
                }
            }
            session.onClose = { [weak self] uuid in
                self?.queue.async {
                    self?.sessions.removeValue(forKey: uuid)
                    self?.inbox.removeValue(forKey: uuid)
                    let handler = self?.onClose
                    DispatchQueue.main.async { handler?(uuid) }
                }
            }
            session.onMessage = { [weak self] uuid, text in
                self?.queue.async {
                    NSLog("DBK stage sync message \(text.prefix(80))")
                    var held = self?.inbox[uuid] ?? []
                    held.append(text)
                    if held.count > 8 { held.removeFirst(held.count - 8) }
                    self?.inbox[uuid] = held
                    let handler = self?.onMessage
                    DispatchQueue.main.async { handler?(uuid, text) }
                }
            }
            self.sessions[session.uuid] = session
            if request.isEmpty {
                session.receiveHandshake()
            } else {
                session.handleHandshake(request)
            }
        }
    }

    func send(uuid: String, message: String) {
        queue.async {
            self.sessions[uuid]?.send(text: message)
        }
    }

    func debugStatus() -> (sessions: Int, last: String) {
        queue.sync {
            (sessions.count, inbox.values.flatMap { $0 }.last ?? "")
        }
    }

    static func lanIPv4() -> String? {
        var ifaddr: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifaddr) == 0, let first = ifaddr else { return nil }
        defer { freeifaddrs(first) }
        var found: [(String, String)] = []
        var ptr: UnsafeMutablePointer<ifaddrs>? = first
        while let current = ptr {
            let name = String(cString: current.pointee.ifa_name)
            if let addr = current.pointee.ifa_addr, addr.pointee.sa_family == UInt8(AF_INET) {
                var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                getnameinfo(addr, socklen_t(addr.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST)
                let ip = String(cString: host)
                if !ip.hasPrefix("127.") && !ip.hasPrefix("169.254.") {
                    found.append((name, ip))
                }
            }
            ptr = current.pointee.ifa_next
        }
        return found.first(where: { $0.0 == "en0" })?.1
            ?? found.first(where: { $0.0.hasPrefix("en") })?.1
            ?? found.first?.1
    }
}

final class StageSyncSession {
    let uuid: String
    private let connection: NWConnection
    private var buffer = Data()
    private var upgraded = false
    private var closed = false
    var onOpen: ((String) -> Void)?
    var onClose: ((String) -> Void)?
    var onMessage: ((String, String) -> Void)?

    init(uuid: String, connection: NWConnection) {
        self.uuid = uuid
        self.connection = connection
    }

    func receiveHandshake() {
        receiveMore { [weak self] in
            self?.tryHandshake()
        }
    }

    func handleHandshake(_ data: Data) {
        buffer.append(data)
        tryHandshake()
    }

    func send(text: String) {
        guard upgraded, let payload = text.data(using: .utf8) else { return }
        connection.send(content: Self.frame(opcode: 0x01, payload: [UInt8](payload)), completion: .contentProcessed { _ in })
    }

    func close() {
        guard !closed else { return }
        closed = true
        connection.cancel()
        onClose?(uuid)
    }

    private func tryHandshake() {
        guard !upgraded else { return }
        guard let range = buffer.range(of: Data("\r\n\r\n".utf8)) else {
            receiveHandshake()
            return
        }
        let header = String(data: buffer.subdata(in: buffer.startIndex..<range.lowerBound), encoding: .utf8) ?? ""
        buffer.removeSubrange(buffer.startIndex..<range.upperBound)
        let fields = Self.headers(from: header)
        guard fields["upgrade"]?.lowercased() == "websocket",
              (fields["connection"] ?? "").lowercased().contains("upgrade"),
              let key = fields["sec-websocket-key"] else {
            sendPlain("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n")
            close()
            return
        }
        var response = "HTTP/1.1 101 Switching Protocols\r\n"
        response += "Upgrade: websocket\r\n"
        response += "Connection: Upgrade\r\n"
        response += "Sec-WebSocket-Accept: \(Self.acceptKey(key))\r\n\r\n"
        connection.send(content: Data(response.utf8), completion: .contentProcessed { [weak self] _ in
            guard let self else { return }
            self.upgraded = true
            self.onOpen?(self.uuid)
            if !self.buffer.isEmpty { self.drainFrames() }
            self.receiveFrames()
        })
    }

    private func receiveFrames() {
        receiveMore { [weak self] in
            self?.drainFrames()
            self?.receiveFrames()
        }
    }

    private func receiveMore(then: @escaping () -> Void) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
            guard let self, !self.closed else { return }
            if let error {
                NSLog("DBK stage sync receive failed: \(error.localizedDescription)")
                self.close()
                return
            }
            if let data { self.buffer.append(data) }
            if isComplete && (data == nil || data?.isEmpty == true) && self.buffer.isEmpty {
                self.close()
                return
            }
            then()
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
                NSLog("DBK stage sync frame \(text.prefix(80))")
                onMessage?(uuid, text)
            } else if opcode == 0x08 {
                close()
                return
            } else if opcode == 0x09 {
                connection.send(content: Self.frame(opcode: 0x0A, payload: payload), completion: .contentProcessed { _ in })
            }
        }
    }

    private func sendPlain(_ text: String) {
        connection.send(content: Data(text.utf8), completion: .contentProcessed { _ in })
    }

    private static func headers(from header: String) -> [String: String] {
        var fields: [String: String] = [:]
        for line in header.split(separator: "\r\n").dropFirst() {
            guard let split = line.firstIndex(of: ":") else { continue }
            let key = line[..<split].trimmingCharacters(in: .whitespaces).lowercased()
            let value = line[line.index(after: split)...].trimmingCharacters(in: .whitespaces)
            fields[key] = value
        }
        return fields
    }

    private static func acceptKey(_ key: String) -> String {
        let combined = key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
        let data = Data(combined.utf8)
        var digest = [UInt8](repeating: 0, count: Int(CC_SHA1_DIGEST_LENGTH))
        data.withUnsafeBytes { raw in
            _ = CC_SHA1(raw.baseAddress, CC_LONG(data.count), &digest)
        }
        return Data(digest).base64EncodedString()
    }

    private static func frame(opcode: UInt8, payload: [UInt8]) -> Data {
        var frame = [UInt8]()
        frame.append(0x80 | opcode)
        if payload.count < 126 {
            frame.append(UInt8(payload.count))
        } else {
            frame.append(126)
            frame.append(UInt8((payload.count >> 8) & 0xFF))
            frame.append(UInt8(payload.count & 0xFF))
        }
        frame.append(contentsOf: payload)
        return Data(frame)
    }
}
