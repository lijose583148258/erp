import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Mic, MicOff, X, Check, AlertCircle } from 'lucide-react';
import { useAppContext } from '../app/AppContext';

type SpeechRecognitionEventLike = {
    results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
    resultIndex: number;
};

type VoiceInputProps = {
    onResult: (text: string) => void;
    onCancel?: () => void;
    placeholder?: string;
    className?: string;
    autoSubmit?: boolean;
    compact?: boolean;
};

const VoiceInput: React.FC<VoiceInputProps> = ({
    onResult,
    onCancel,
    placeholder,
    className = '',
    autoSubmit = false,
    compact = false,
}) => {
    const { t, language } = useAppContext();
    const recognitionRef = useRef<any>(null);
    const [isOpen, setIsOpen] = useState(!compact);
    const [isListening, setIsListening] = useState(false);
    const [text, setText] = useState('');
    const [interimText, setInterimText] = useState('');
    const [error, setError] = useState<string | null>(null);

    const langCode = useMemo(() => {
        if (language === 'en') return 'en-US';
        if (language === 'vi') return 'vi-VN';
        return 'zh-CN';
    }, [language]);

    useEffect(() => {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
            setError(t.voiceNotSupported);
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = langCode;

        recognition.onresult = (event: SpeechRecognitionEventLike) => {
            let finalText = '';
            let tempText = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i];
                const transcript = result[0]?.transcript || '';
                if (result.isFinal) finalText += transcript;
                else tempText += transcript;
            }
            if (finalText) {
                const nextText = `${text}${finalText}`.trim();
                setText(nextText);
                setInterimText('');
                if (autoSubmit) onResult(nextText);
            } else {
                setInterimText(tempText);
            }
        };

        recognition.onerror = (event: any) => {
            const map: Record<string, string> = {
                'not-allowed': t.micPermissionDenied,
                'no-speech': t.noSpeechDetected,
                network: t.networkError,
                'audio-capture': t.audioCaptureFailed,
            };
            setError(map[event?.error] || t.voiceError);
            setIsListening(false);
        };

        recognition.onend = () => setIsListening(false);
        recognitionRef.current = recognition;

        return () => {
            recognition.stop?.();
        };
    }, [autoSubmit, langCode, onResult, t, text]);

    const start = useCallback(async () => {
        setError(null);
        try {
            await navigator.mediaDevices.getUserMedia({ audio: true });
            recognitionRef.current?.start?.();
            setIsListening(true);
        } catch {
            setError(t.micPermissionDenied);
        }
    }, [t]);

    const stop = useCallback(() => {
        recognitionRef.current?.stop?.();
        setIsListening(false);
    }, []);

    const confirm = useCallback(() => {
        const finalText = `${text}${interimText}`.trim();
        if (finalText) onResult(finalText);
        setText('');
        setInterimText('');
        stop();
    }, [interimText, onResult, stop, text]);

    const cancel = useCallback(() => {
        setText('');
        setInterimText('');
        stop();
        onCancel?.();
        if (compact) setIsOpen(false);
    }, [compact, onCancel, stop]);

    if (compact) {
        return (
            <>
                <button
                    type="button"
                    onClick={() => setIsOpen(true)}
                    className={`inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 px-4 py-2 text-xs font-bold text-white shadow-lg ${className}`}
                >
                    <Mic size={16} />
                    {placeholder || t.startRecording}
                </button>
                {isOpen && (
                    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-900/60 p-4">
                        <div className="w-full max-w-lg rounded-[28px] bg-white p-5 shadow-2xl dark:bg-slate-900">
                            <div className="mb-4 flex items-center justify-between">
                                <div>
                                    <p className="text-lg font-black text-slate-900 dark:text-white">{placeholder || t.voiceInput}</p>
                                    <p className="text-sm font-bold text-slate-400">{isListening ? t.listening : t.voiceStatusWaiting}</p>
                                </div>
                                <button type="button" onClick={cancel} className="rounded-full bg-slate-100 p-2 dark:bg-slate-800">
                                    <X size={18} />
                                </button>
                            </div>
                            <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/70">
                                <p className="min-h-[96px] whitespace-pre-wrap text-sm font-medium text-slate-700 dark:text-slate-200">
                                    {text || interimText || t.voicePromptCompact}
                                </p>
                                {error && (
                                    <p className="mt-3 flex items-center gap-2 text-xs font-bold text-rose-600">
                                        <AlertCircle size={14} />
                                        {error}
                                    </p>
                                )}
                            </div>
                            <div className="mt-4 flex gap-3">
                                <button type="button" onClick={isListening ? stop : start} className="flex-1 rounded-xl bg-slate-100 py-3 text-sm font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-200">
                                    {isListening ? <MicOff size={16} className="mr-2 inline" /> : <Mic size={16} className="mr-2 inline" />}
                                    {isListening ? t.stopRecording : t.startRecording}
                                </button>
                                <button type="button" onClick={confirm} disabled={!text.trim() && !interimText.trim()} className="flex-1 rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white disabled:opacity-50">
                                    <Check size={16} className="mr-2 inline" />
                                    {t.confirmFill}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </>
        );
    }

    return (
        <div className={`rounded-[24px] border border-slate-100 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}>
            <div className="mb-3 flex items-center justify-between">
                <div>
                    <p className="text-sm font-black text-slate-900 dark:text-white">{placeholder || t.voiceInput}</p>
                    <p className="text-xs font-bold text-slate-400">{isListening ? t.listening : t.voiceStatusFullIdle}</p>
                </div>
                <div className="flex gap-2">
                    <button type="button" onClick={isListening ? stop : start} className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white">
                        {isListening ? <MicOff size={14} className="mr-1 inline" /> : <Mic size={14} className="mr-1 inline" />}
                        {isListening ? t.stopRecording : t.startRecording}
                    </button>
                    {onCancel && (
                        <button type="button" onClick={cancel} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-200">
                            {t.cancel}
                        </button>
                    )}
                </div>
            </div>

            <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/70">
                <p className="min-h-[90px] whitespace-pre-wrap text-sm font-medium text-slate-700 dark:text-slate-200">
                    {text || interimText || t.voicePromptFull}
                </p>
                {error && (
                    <p className="mt-3 flex items-center gap-2 text-xs font-bold text-rose-600">
                        <AlertCircle size={14} />
                        {error}
                    </p>
                )}
            </div>

            <div className="mt-4 flex gap-2">
                <button type="button" onClick={confirm} disabled={!text.trim() && !interimText.trim()} className="flex-1 rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white disabled:opacity-50">
                    <Check size={16} className="mr-2 inline" />
                    {t.confirmFill}
                </button>
                <button type="button" onClick={cancel} className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-200">
                    <X size={16} className="mr-2 inline" />
                    {t.cancel}
                </button>
            </div>
        </div>
    );
};

export default VoiceInput;
