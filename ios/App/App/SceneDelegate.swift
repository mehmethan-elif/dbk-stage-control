import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = StageBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    private var audioHandoff: UIBackgroundTaskIdentifier = .invalid

    func sceneDidBecomeActive(_ scene: UIScene) {
        UIApplication.shared.isIdleTimerDisabled = true
    }

    /// Queue the rest of the song while JavaScript can still run. After this, scheduled
    /// audio keeps playing with the app in the background.
    func sceneWillResignActive(_ scene: UIScene) {
        guard audioHandoff == .invalid else { return }
        audioHandoff = UIApplication.shared.beginBackgroundTask(withName: "dbk-audio") { [weak self] in
            self?.endAudioHandoff()
        }
        let webView = (window?.rootViewController as? StageBridgeViewController)?.webView
        webView?.evaluateJavaScript("window.__dbkContinueAudio&&window.__dbkContinueAudio()", completionHandler: nil)
        DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in
            self?.endAudioHandoff()
        }
    }

    private func endAudioHandoff() {
        guard audioHandoff != .invalid else { return }
        UIApplication.shared.endBackgroundTask(audioHandoff)
        audioHandoff = .invalid
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
