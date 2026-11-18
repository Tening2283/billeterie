import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { api, queryKeys } from '../lib/endpoints';
import { Skeleton } from './States';

/** Le code signé devient un QR en SVG (pas de canvas, pas de HTML injecté : une simple image). */
async function loadTicketQr(ticketId: string) {
  const { code } = await api.ticketCode(ticketId);
  const svg = await QRCode.toString(code, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return { code, src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` };
}

export function TicketQr({ ticketId, seatNumber }: { ticketId: string; seatNumber: number }) {
  const [copied, setCopied] = useState(false);
  const qr = useQuery({
    queryKey: queryKeys.ticketCode(ticketId),
    queryFn: () => loadTicketQr(ticketId),
    staleTime: Infinity, // un code signé ne change jamais
  });

  if (qr.isPending) return <Skeleton className="mx-auto h-48 w-48" />;
  if (qr.isError) {
    return (
      <div className="flex h-48 flex-col items-center justify-center gap-2 text-center text-sm text-red-800">
        <p>QR code indisponible.</p>
        <button type="button" className="btn-secondary" onClick={() => void qr.refetch()}>
          Réessayer
        </button>
      </div>
    );
  }

  const canCopy = typeof navigator.clipboard?.writeText === 'function';
  return (
    <div className="flex flex-col items-center gap-2">
      <img
        src={qr.data.src}
        alt={`QR code du billet, place ${seatNumber}`}
        className="h-48 w-48 rounded bg-white p-1"
      />
      <details className="w-full text-xs text-slate-600">
        <summary className="cursor-pointer text-center">Code du billet (sans caméra)</summary>
        <p className="mt-2 break-all rounded bg-slate-100 p-2 font-mono select-all">
          {qr.data.code}
        </p>
        {canCopy && (
          <button
            type="button"
            className="btn-secondary mt-2 w-full"
            onClick={() =>
              void navigator.clipboard.writeText(qr.data.code).then(() => setCopied(true))
            }
          >
            {copied ? 'Copié ✓' : 'Copier le code'}
          </button>
        )}
      </details>
    </div>
  );
}
