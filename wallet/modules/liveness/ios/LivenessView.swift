import ARKit
import CoreImage
import ExpoModulesCore
import SceneKit
import UIKit

// Front-camera ARKit face tracking. It shows the mirrored live preview and
// emits per-frame face signals. The only image it ever produces is a frame
// captured on request from the live session, so the selfie that is uploaded
// is always a frame of the challenge itself.
final class LivenessView: ExpoView, ARSessionDelegate {
  let onFaceUpdate = EventDispatcher()
  let onSessionError = EventDispatcher()

  private let sceneView = ARSCNView(frame: .zero)
  private let ciContext = CIContext()
  private var running = false
  private var lastEmit: TimeInterval = 0
  private var pendingCapture: Promise?

  // Depth relief: nose tip vs. points on both cheeks, in millimetres.
  private var noseIndex: Int?
  private var cheekIndices: (Int, Int)?
  private var lastReliefMm: Double?
  private var lastReliefAt: TimeInterval = 0

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    sceneView.automaticallyUpdatesLighting = false
    sceneView.session.delegate = self
    addSubview(sceneView)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    sceneView.frame = bounds
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil {
      start()
    } else {
      stop()
    }
  }

  deinit {
    sceneView.session.pause()
  }

  private func start() {
    guard !running else { return }
    guard ARFaceTrackingConfiguration.isSupported else {
      onSessionError(["message": "This device has no TrueDepth camera."])
      return
    }
    let config = ARFaceTrackingConfiguration()
    // Track more than one face so a second face can be detected and refused.
    config.maximumNumberOfTrackedFaces = ARFaceTrackingConfiguration.supportedNumberOfTrackedFaces
    config.isLightEstimationEnabled = false
    noseIndex = nil
    cheekIndices = nil
    lastReliefMm = nil
    sceneView.session.run(config, options: [.resetTracking, .removeExistingAnchors])
    running = true
  }

  private func stop() {
    guard running else { return }
    sceneView.session.pause()
    running = false
    if let promise = pendingCapture {
      pendingCapture = nil
      promise.reject("ERR_LIVENESS_STOPPED", "The camera stopped before the frame was captured.")
    }
  }

  func requestCapture(_ promise: Promise) {
    guard running else {
      promise.reject("ERR_LIVENESS_NOT_RUNNING", "The camera is not running.")
      return
    }
    if let previous = pendingCapture {
      previous.reject("ERR_LIVENESS_SUPERSEDED", "A newer capture was requested.")
    }
    pendingCapture = promise
  }

  // MARK: - ARSessionDelegate

  func session(_ session: ARSession, didFailWithError error: Error) {
    running = false
    onSessionError(["message": error.localizedDescription])
  }

  func session(_ session: ARSession, didUpdate frame: ARFrame) {
    let faces = frame.anchors.compactMap { $0 as? ARFaceAnchor }.filter { $0.isTracked }

    if let primary = faces.first, let depthData = frame.capturedDepthData {
      if let relief = depthReliefMm(face: primary, frame: frame, depthData: depthData) {
        lastReliefMm = relief
        lastReliefAt = frame.timestamp
      }
    }

    if let promise = pendingCapture {
      pendingCapture = nil
      capture(frame: frame, faceCount: faces.count, promise: promise)
    }

    // ~15 events per second is plenty for the challenge and keeps the bridge quiet.
    guard frame.timestamp - lastEmit >= 0.066 else { return }
    lastEmit = frame.timestamp

    var payload: [String: Any] = [
      "faceCount": faces.count,
      "timestamp": Date().timeIntervalSince1970 * 1000,
    ]

    if let face = faces.first {
      let relative = simd_mul(simd_inverse(frame.camera.transform), face.transform)
      let forward = simd_normalize(simd_make_float3(relative.columns.2))
      // Angle between the face's forward axis and the camera axis, whatever
      // the direction of the turn. 0 means looking straight at the camera.
      let offAxis = acos(min(1, max(-1, Double(abs(forward.z))))) * 180 / .pi
      let shapes = face.blendShapes
      func value(_ key: ARFaceAnchor.BlendShapeLocation) -> Double {
        shapes[key]?.doubleValue ?? 0
      }
      payload["offAxisDeg"] = offAxis
      payload["blinkLeft"] = value(.eyeBlinkLeft)
      payload["blinkRight"] = value(.eyeBlinkRight)
      payload["smile"] = (value(.mouthSmileLeft) + value(.mouthSmileRight)) / 2
      payload["jawOpen"] = value(.jawOpen)
      payload["browUp"] = value(.browInnerUp)
    }

    let reliefFresh = lastReliefMm != nil && frame.timestamp - lastReliefAt < 1.0
    payload["depthReliefMm"] = reliefFresh ? lastReliefMm! : -1

    onFaceUpdate(payload)
  }

  // MARK: - Depth relief

  private func depthReliefMm(face: ARFaceAnchor, frame: ARFrame, depthData: AVDepthData) -> Double? {
    let vertices = face.geometry.vertices
    guard !vertices.isEmpty else { return nil }

    if noseIndex == nil || cheekIndices == nil {
      // The nose tip is the vertex furthest out of the face; cheek points sit
      // 3.5 cm either side of it at the same height.
      guard let nose = vertices.indices.max(by: { vertices[$0].z < vertices[$1].z }) else { return nil }
      let n = vertices[nose]
      func nearest(to target: SIMD2<Float>) -> Int? {
        vertices.indices.min(by: {
          simd_distance(SIMD2(vertices[$0].x, vertices[$0].y), target)
            < simd_distance(SIMD2(vertices[$1].x, vertices[$1].y), target)
        })
      }
      guard let left = nearest(to: SIMD2(n.x - 0.035, n.y)),
            let right = nearest(to: SIMD2(n.x + 0.035, n.y)) else { return nil }
      noseIndex = nose
      cheekIndices = (left, right)
    }

    guard let nose = noseIndex, let (left, right) = cheekIndices,
          nose < vertices.count, left < vertices.count, right < vertices.count else { return nil }

    let depth = depthData.converting(toDepthDataType: kCVPixelFormatType_DepthFloat32).depthDataMap
    let imageSize = frame.camera.imageResolution

    func sample(_ index: Int) -> Float? {
      let local = vertices[index]
      let world = simd_mul(face.transform, SIMD4<Float>(local.x, local.y, local.z, 1))
      let point = frame.camera.projectPoint(
        SIMD3(world.x, world.y, world.z), orientation: .landscapeRight, viewportSize: imageSize)
      let width = CVPixelBufferGetWidth(depth)
      let height = CVPixelBufferGetHeight(depth)
      let x = Int(point.x / imageSize.width * CGFloat(width))
      let y = Int(point.y / imageSize.height * CGFloat(height))
      return medianDepth(depth, x: x, y: y, radius: 2)
    }

    guard let dn = sample(nose), let dl = sample(left), let dr = sample(right) else { return nil }
    return Double((dl + dr) / 2 - dn) * 1000
  }

  private func medianDepth(_ buffer: CVPixelBuffer, x: Int, y: Int, radius: Int) -> Float? {
    let width = CVPixelBufferGetWidth(buffer)
    let height = CVPixelBufferGetHeight(buffer)
    guard x - radius >= 0, y - radius >= 0, x + radius < width, y + radius < height else { return nil }

    CVPixelBufferLockBaseAddress(buffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
    guard let base = CVPixelBufferGetBaseAddress(buffer) else { return nil }
    let rowBytes = CVPixelBufferGetBytesPerRow(buffer)

    var values: [Float] = []
    for row in (y - radius)...(y + radius) {
      let rowPointer = (base + row * rowBytes).assumingMemoryBound(to: Float32.self)
      for col in (x - radius)...(x + radius) {
        let v = rowPointer[col]
        if v.isFinite && v > 0 { values.append(v) }
      }
    }
    guard values.count >= 5 else { return nil }
    values.sort()
    return values[values.count / 2]
  }

  // MARK: - Capture

  private func capture(frame: ARFrame, faceCount: Int, promise: Promise) {
    guard faceCount == 1 else {
      promise.reject("ERR_LIVENESS_FACE", "Exactly one face must be in view when the selfie is taken.")
      return
    }

    let pixelBuffer = frame.capturedImage
    let imageSize = CGSize(
      width: CVPixelBufferGetWidth(pixelBuffer), height: CVPixelBufferGetHeight(pixelBuffer))
    // Portrait output with the same pixel count, oriented as shown on screen.
    let viewport = CGSize(width: imageSize.height, height: imageSize.width)
    let normalize = CGAffineTransform(scaleX: 1 / imageSize.width, y: 1 / imageSize.height)
    let flip = CGAffineTransform(scaleX: -1, y: -1).translatedBy(x: -1, y: -1)
    let display = frame.displayTransform(for: .portrait, viewportSize: viewport)
    let toViewport = CGAffineTransform(scaleX: viewport.width, y: viewport.height)
    let image = CIImage(cvPixelBuffer: pixelBuffer)
      .transformed(by: normalize.concatenating(flip).concatenating(display).concatenating(toViewport))
      .cropped(to: CGRect(origin: .zero, size: viewport))

    let context = ciContext
    DispatchQueue.global(qos: .userInitiated).async {
      guard let cgImage = context.createCGImage(image, from: image.extent),
            let jpeg = UIImage(cgImage: cgImage).jpegData(compressionQuality: 0.85) else {
        promise.reject("ERR_LIVENESS_ENCODE", "Unable to encode the captured frame.")
        return
      }
      let url = FileManager.default.temporaryDirectory
        .appendingPathComponent("liveness-\(UUID().uuidString).jpg")
      do {
        try jpeg.write(to: url, options: .atomic)
        promise.resolve([
          "uri": url.absoluteString,
          "width": cgImage.width,
          "height": cgImage.height,
        ])
      } catch {
        promise.reject("ERR_LIVENESS_WRITE", "Unable to save the captured frame.")
      }
    }
  }
}
