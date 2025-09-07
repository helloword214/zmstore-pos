// app/types/barcode-detector.d.ts
// Minimal BarcodeDetector typings for browsers that support it.

interface DetectedBarcode {
  rawValue: string;
  format?: string;
  boundingBox?: DOMRectReadOnly;
  cornerPoints?: Array<{ x: number; y: number }>;
}

interface BarcodeDetectorOptions {
  formats?: string[];
}

declare class BarcodeDetector {
  constructor(options?: BarcodeDetectorOptions);
  static getSupportedFormats?(): Promise<string[]>;
  detect(
    source: CanvasImageSource | ImageBitmap | OffscreenCanvas | HTMLVideoElement
  ): Promise<DetectedBarcode[]>;
}

declare global {
  interface Window {
    BarcodeDetector?: typeof BarcodeDetector;
  }
}

export {};
