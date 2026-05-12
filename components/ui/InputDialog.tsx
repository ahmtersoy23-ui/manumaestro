'use client';

/**
 * Promise-tabanlı input dialog. window.prompt() native dialog'unu değiştirir.
 *
 * Pattern: ConfirmDialog ile aynı (Provider + hook).
 * <InputProvider> root layout'ta. useInputDialog() her component'te.
 * await inputDialog({ title, message, defaultValue, inputType, min })
 *   → Promise<string | null>  (null = iptal)
 *
 * Avantajları (prompt() yerine):
 *   - Stilize + tema uyumlu
 *   - Klavye (Escape iptal, Enter onay), input'a auto-focus
 *   - Mobil/PWA'da çalışır (native prompt bazı tarayıcılarda yok)
 *   - Tip + min + step + placeholder kontrolü
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';

export interface InputOptions {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  inputType?: 'text' | 'number';
  min?: number;
  max?: number;
  step?: number;
}

interface InputState extends InputOptions {
  resolve: (value: string | null) => void;
}

interface InputContextValue {
  inputDialog: (options: InputOptions) => Promise<string | null>;
}

const InputContext = createContext<InputContextValue | null>(null);

export function useInputDialog(): (options: InputOptions) => Promise<string | null> {
  const ctx = useContext(InputContext);
  if (!ctx) {
    throw new Error('useInputDialog() requires <InputProvider> in tree');
  }
  return ctx.inputDialog;
}

export function InputProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<InputState | null>(null);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const inputDialog = useCallback((options: InputOptions): Promise<string | null> => {
    return new Promise((resolve) => {
      setValue(options.defaultValue ?? '');
      setState({ ...options, resolve });
    });
  }, []);

  const close = useCallback((submitted: boolean) => {
    setState((s) => {
      if (s) s.resolve(submitted ? value : null);
      return null;
    });
  }, [value]);

  // Açılınca input'a focus + select + Escape iptal + Enter onay
  useEffect(() => {
    if (!state) return;
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.select();
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
      else if (e.key === 'Enter') close(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, close]);

  return (
    <InputContext.Provider value={{ inputDialog }}>
      {children}
      {state && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4"
          onClick={() => close(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="input-title"
        >
          <div
            className="bg-white rounded-xl shadow-2xl max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 flex items-start gap-3">
              <div className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center bg-blue-100 text-blue-600">
                <Pencil className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 id="input-title" className="text-base font-semibold text-gray-900">
                  {state.title}
                </h3>
                {state.message && (
                  <p className="mt-1 text-sm text-gray-600 whitespace-pre-line">{state.message}</p>
                )}
                <input
                  ref={inputRef}
                  type={state.inputType ?? 'text'}
                  value={value}
                  min={state.min}
                  max={state.max}
                  step={state.step}
                  placeholder={state.placeholder}
                  onChange={(e) => setValue(e.target.value)}
                  className="mt-3 w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
            </div>
            <div className="px-5 pb-5 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => close(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
              >
                {state.cancelLabel ?? 'İptal'}
              </button>
              <button
                type="button"
                onClick={() => close(true)}
                className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
              >
                {state.confirmLabel ?? 'Tamam'}
              </button>
            </div>
          </div>
        </div>
      )}
    </InputContext.Provider>
  );
}
