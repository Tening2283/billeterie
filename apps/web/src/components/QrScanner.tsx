import { useEffect, useId, useRef, useState } from 'react';
import type { Html5Qrcode } from 'html5-qrcode';

/**
 * Lecture d'un QR code par la caméra (html5-qrcode, chargé seulement à l'ouverture du scanner).
 * Non couvert par les tests : jsdom n'a pas de caméra. Le contrôle par code collé, lui, est testé.
 */
export function QrScanner({ onScan }: { onScan: (code: string) => void }) {
  const elementId = `scanner-${useId().replace(/:/g, '')}`;
  const [error, setError] = useState<string | null>(
    window.isSecureContext
      ? null
      : 'La caméra n’est disponible qu’en https (ou sur localhost). Collez le code à la place.',
  );
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  });

  useEffect(() => {
    if (!window.isSecureContext) return;
    let stopped = false;
    let scanner: Html5Qrcode | undefined;

    void import('html5-qrcode')
      .then(async ({ Html5Qrcode }) => {
        if (stopped) return;
        scanner = new Html5Qrcode(elementId, { verbose: false });
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          (decoded) => {
            if (stopped) return;
            stopped = true;
            onScanRef.current(decoded);
          },
          () => {}, // pas de QR dans cette image : normal, on continue
        );
      })
      .catch(() =>
        setError('Caméra inaccessible (autorisation refusée ?). Collez le code à la place.'),
      );

    return () => {
      stopped = true;
      if (scanner?.isScanning) void scanner.stop().catch(() => {});
    };
  }, [elementId]);

  return (
    <div className="space-y-2">
      <div id={elementId} className="overflow-hidden rounded-xl bg-black" />
      {error && (
        <p role="alert" className="text-sm text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}
