'use client';

import { useEffect } from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('App Error Boundary caught:', error);
  }, [error]);

  return (
    <main className="min-h-screen bg-[#F5F5F7] flex flex-col items-center justify-center p-6 text-center font-sans">
      <div className="max-w-sm w-full bg-white rounded-[28px] p-7 shadow-xl border border-slate-200/80 flex flex-col items-center">
        <div className="w-14 h-14 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mb-4">
          <AlertCircle className="w-7 h-7" />
        </div>
        <h2 className="text-lg font-bold text-slate-900 mb-1">Si è verificato un errore</h2>
        <p className="text-xs text-slate-500 mb-6 leading-relaxed">
          {error?.message || "Impossibile caricare l'applicazione."}
        </p>
        <button
          onClick={() => reset()}
          className="w-full py-3.5 px-4 bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white font-semibold text-xs rounded-2xl transition-all flex items-center justify-center gap-2 shadow-md shadow-blue-500/20"
        >
          <RotateCcw className="w-4 h-4" />
          <span>Riprova a caricare</span>
        </button>
      </div>
    </main>
  );
}
