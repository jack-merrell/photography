import Foundation
import ImageIO

struct Payload: Decodable {
  let captureExifTimestamp: String
  let lens: String?
  let focalLength: Double?
  let focalLength35mm: Int?
  let iso: Int?
  let exposureTimeSeconds: Double?
  let aperture: Double?
  let flashOn: Int?
  let meteringMode: Int?
  let whiteBalance: Int?
  let latitude: Double?
  let longitude: Double?
  let altitude: Double?
  let imageDirection: Double?
  let aiDescription: String?
}

func cfDictionary(_ value: Any?) -> [CFString: Any] {
  value as? [CFString: Any] ?? [:]
}

func setOrRemove(_ dictionary: inout [CFString: Any], key: CFString, value: Any?) {
  if let value {
    dictionary[key] = value
  } else {
    dictionary.removeValue(forKey: key)
  }
}

func updateGPS(
  _ dictionary: inout [CFString: Any],
  latitude: Double?,
  longitude: Double?,
  altitude: Double?,
  imageDirection: Double?
) {
  if let latitude, let longitude {
    dictionary[kCGImagePropertyGPSLatitude] = abs(latitude)
    dictionary[kCGImagePropertyGPSLatitudeRef] = latitude >= 0 ? "N" : "S"
    dictionary[kCGImagePropertyGPSLongitude] = abs(longitude)
    dictionary[kCGImagePropertyGPSLongitudeRef] = longitude >= 0 ? "E" : "W"

    if let altitude {
      dictionary[kCGImagePropertyGPSAltitude] = abs(altitude)
      dictionary[kCGImagePropertyGPSAltitudeRef] = altitude >= 0 ? 0 : 1
    } else {
      dictionary.removeValue(forKey: kCGImagePropertyGPSAltitude)
      dictionary.removeValue(forKey: kCGImagePropertyGPSAltitudeRef)
    }

    if let imageDirection {
      dictionary[kCGImagePropertyGPSImgDirection] = imageDirection
      dictionary[kCGImagePropertyGPSImgDirectionRef] = "T"
    } else {
      dictionary.removeValue(forKey: kCGImagePropertyGPSImgDirection)
      dictionary.removeValue(forKey: kCGImagePropertyGPSImgDirectionRef)
    }
  } else {
    dictionary.removeValue(forKey: kCGImagePropertyGPSLatitude)
    dictionary.removeValue(forKey: kCGImagePropertyGPSLatitudeRef)
    dictionary.removeValue(forKey: kCGImagePropertyGPSLongitude)
    dictionary.removeValue(forKey: kCGImagePropertyGPSLongitudeRef)
    dictionary.removeValue(forKey: kCGImagePropertyGPSAltitude)
    dictionary.removeValue(forKey: kCGImagePropertyGPSAltitudeRef)
    dictionary.removeValue(forKey: kCGImagePropertyGPSImgDirection)
    dictionary.removeValue(forKey: kCGImagePropertyGPSImgDirectionRef)
  }
}

guard CommandLine.arguments.count >= 3 else {
  fputs("Usage: swift write_photo_metadata.swift <image-path> <payload-json>\n", stderr)
  exit(1)
}

let imagePath = CommandLine.arguments[1]
let payloadJson = CommandLine.arguments[2]

let decoder = JSONDecoder()
let payload = try decoder.decode(Payload.self, from: Data(payloadJson.utf8))

let inputURL = URL(fileURLWithPath: imagePath)
let temporaryURL = URL(fileURLWithPath: "\(imagePath).codex-meta-tmp")

guard let source = CGImageSourceCreateWithURL(inputURL as CFURL, nil) else {
  throw NSError(domain: "write_photo_metadata", code: 1, userInfo: [
    NSLocalizedDescriptionKey: "Unable to open image source."
  ])
}

guard let imageType = CGImageSourceGetType(source) else {
  throw NSError(domain: "write_photo_metadata", code: 2, userInfo: [
    NSLocalizedDescriptionKey: "Unable to determine image type."
  ])
}

var properties =
  (CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]) ?? [:]

var exif = cfDictionary(properties[kCGImagePropertyExifDictionary])
setOrRemove(&exif, key: kCGImagePropertyExifDateTimeOriginal, value: payload.captureExifTimestamp)
setOrRemove(&exif, key: kCGImagePropertyExifDateTimeDigitized, value: payload.captureExifTimestamp)
setOrRemove(&exif, key: kCGImagePropertyExifLensModel, value: payload.lens)
setOrRemove(&exif, key: kCGImagePropertyExifFocalLength, value: payload.focalLength)
setOrRemove(&exif, key: kCGImagePropertyExifFocalLenIn35mmFilm, value: payload.focalLength35mm)
setOrRemove(
  &exif,
  key: kCGImagePropertyExifISOSpeedRatings,
  value: payload.iso.map { [$0] }
)
setOrRemove(&exif, key: kCGImagePropertyExifExposureTime, value: payload.exposureTimeSeconds)
setOrRemove(&exif, key: kCGImagePropertyExifFNumber, value: payload.aperture)
setOrRemove(&exif, key: kCGImagePropertyExifFlash, value: payload.flashOn)
setOrRemove(&exif, key: kCGImagePropertyExifMeteringMode, value: payload.meteringMode)
setOrRemove(&exif, key: kCGImagePropertyExifWhiteBalance, value: payload.whiteBalance)
setOrRemove(&exif, key: kCGImagePropertyExifUserComment, value: payload.aiDescription)
properties[kCGImagePropertyExifDictionary] = exif

var gps = cfDictionary(properties[kCGImagePropertyGPSDictionary])
updateGPS(
  &gps,
  latitude: payload.latitude,
  longitude: payload.longitude,
  altitude: payload.altitude,
  imageDirection: payload.imageDirection
)
if gps.isEmpty {
  properties.removeValue(forKey: kCGImagePropertyGPSDictionary)
} else {
  properties[kCGImagePropertyGPSDictionary] = gps
}

var tiff = cfDictionary(properties[kCGImagePropertyTIFFDictionary])
setOrRemove(&tiff, key: kCGImagePropertyTIFFDateTime, value: payload.captureExifTimestamp)
properties[kCGImagePropertyTIFFDictionary] = tiff

try? FileManager.default.removeItem(at: temporaryURL)

guard let destination = CGImageDestinationCreateWithURL(temporaryURL as CFURL, imageType, 1, nil)
else {
  throw NSError(domain: "write_photo_metadata", code: 3, userInfo: [
    NSLocalizedDescriptionKey: "Unable to create metadata destination."
  ])
}

CGImageDestinationAddImageFromSource(destination, source, 0, properties as CFDictionary)
guard CGImageDestinationFinalize(destination) else {
  throw NSError(domain: "write_photo_metadata", code: 4, userInfo: [
    NSLocalizedDescriptionKey: "Unable to finalize metadata destination."
  ])
}

let fileManager = FileManager.default
try fileManager.removeItem(at: inputURL)
try fileManager.moveItem(at: temporaryURL, to: inputURL)

print("{\"ok\":true}")
