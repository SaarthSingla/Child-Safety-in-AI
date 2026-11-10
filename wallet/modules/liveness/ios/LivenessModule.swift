import ARKit
import ExpoModulesCore

public final class LivenessModule: Module {
  public func definition() -> ModuleDefinition {
    Name("Liveness")

    // Face tracking with depth needs the TrueDepth (Face ID) camera.
    Property("isSupported") {
      ARFaceTrackingConfiguration.isSupported
    }

    View(LivenessView.self) {
      Events("onFaceUpdate", "onSessionError")

      AsyncFunction("captureFrame") { (view: LivenessView, promise: Promise) in
        view.requestCapture(promise)
      }
    }
  }
}
