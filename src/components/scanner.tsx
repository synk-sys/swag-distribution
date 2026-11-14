"use client";
import * as React from "react";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { CameraOff, RefreshCw, SwitchCamera } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  /** While paused the camera stays warm but detections are ignored. */
  paused: boolean;
  onDetect: (text: string) => void;
}

const DEDUPE_MS = 5000;

/** Camera barcode scanner (QR, Code 128, PDF417, Data Matrix, Aztec, Code 39) via ZXing. */
export function Scanner({ paused, onDetect }: Props) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const controlsRef = React.useRef<IScannerControls | null>(null);
  const pausedRef = React.useRef(paused);
  const lastRef = React.useRef<{ text: string; at: number } | null>(null);
  const onDetectRef = React.useRef(onDetect);
  const [error, setError] = React.useState<string | null>(null);
  const [facing, setFacing] = React.useState<"environment" | "user">("environment");
  const [attempt, setAttempt] = React.useState(0);

  pausedRef.current = paused;
  onDetectRef.current = onDetect;

  React.useEffect(() => {
    let cancelled = false;
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.QR_CODE,
      BarcodeFormat.CODE_128,
      BarcodeFormat.PDF_417,
      BarcodeFormat.DATA_MATRIX,
      BarcodeFormat.AZTEC,
      BarcodeFormat.CODE_39,
    ]);
    const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 80, delayBetweenScanSuccess: 300 });
    setError(null);
    reader
      .decodeFromConstraints(
        { video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
        videoRef.current!,
        (result) => {
          if (!result || pausedRef.current) return;
          const text = result.getText();
          const now = Date.now();
          // Ignore repeated detections of the same code (attendee still holding it up).
          if (lastRef.current && lastRef.current.text === text && now - lastRef.current.at < DEDUPE_MS) return;
          lastRef.current = { text, at: now };
          onDetectRef.current(text);
        },
      )
      .then((c) => {
        if (cancelled) c.stop();
        else controlsRef.current = c;
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(
          e?.name === "NotAllowedError"
            ? "Camera permission denied. Allow camera access in browser settings, or type the code below."
            : e?.name === "NotFoundError"
              ? "No camera found. Use a USB scanner or type the code below."
              : "Camera could not start. " + (e?.message ?? ""),
        );
      });
    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [facing, attempt]);

  // Allow the same code to be scanned again once the operator returns to scanning.
  React.useEffect(() => {
    if (!paused && lastRef.current) lastRef.current.at = Date.now() - DEDUPE_MS + 1500;
  }, [paused]);

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-black sm:aspect-[4/3]">
      <video ref={videoRef} className="h-full w-full object-cover" muted playsInline autoPlay aria-label="Camera preview for barcode scanning" />
      {!error && (
        <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-3/5 w-4/5 rounded-xl border-4 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-white">
          <CameraOff className="h-10 w-10" />
          <p className="text-sm">{error}</p>
          <Button variant="secondary" size="sm" onClick={() => setAttempt((a) => a + 1)}>
            <RefreshCw /> Retry camera
          </Button>
        </div>
      )}
      <Button
        variant="secondary"
        size="icon"
        className="absolute bottom-3 right-3 rounded-full opacity-90"
        onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}
        aria-label="Switch camera"
      >
        <SwitchCamera />
      </Button>
    </div>
  );
}
