import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { DocumentType, OcrDocumentData } from '../../services/smartFormService';

type UseSalesOrderCommandShortcutsOptions = {
    openCreateModal: () => void;
    setOcrDocType: Dispatch<SetStateAction<DocumentType>>;
    setOcrText: Dispatch<SetStateAction<string>>;
    setOcrResult: Dispatch<SetStateAction<OcrDocumentData | null>>;
};

export const useSalesOrderCommandShortcuts = ({
    openCreateModal,
    setOcrDocType,
    setOcrText,
    setOcrResult,
}: UseSalesOrderCommandShortcutsOptions) => {
    useEffect(() => {
        const handleCreate = () => openCreateModal();
        const handleOcrInvoice = () => {
            openCreateModal();
            setOcrDocType('invoice');
            setOcrText('');
            setOcrResult(null);
        };
        window.addEventListener('command:create-order', handleCreate as EventListener);
        window.addEventListener('command:ocr-invoice', handleOcrInvoice as EventListener);
        return () => {
            window.removeEventListener('command:create-order', handleCreate as EventListener);
            window.removeEventListener('command:ocr-invoice', handleOcrInvoice as EventListener);
        };
    }, [openCreateModal, setOcrDocType, setOcrResult, setOcrText]);
};
