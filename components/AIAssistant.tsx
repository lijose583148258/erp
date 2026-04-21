import { useEffect, useRef, useState } from 'react';
import { BarChart2, Bot, PlusCircle, Send, Sparkles, Upload, X } from 'lucide-react';
import { processAICmd } from '../services/geminiService';
import { customerService } from '../services/customer.service';
import { orderService } from '../services/order.service';
import { sampleService } from '../services/sample.service';
import { shipmentService } from '../services/shipping.service';
import TableImport from './TableImport';
import { useAppContext } from '../app/AppContext';
import { buildSafeAIContext, isHiddenDataRequest, unauthorizedDataRefusal } from '../services/aiSecurity';

const AIAssistant = ({ context }: { context: any }) => {
  const { t, currentUser } = useAppContext();
  const [isOpen, setIsOpen] = useState(false);
  const [showTableImport, setShowTableImport] = useState(false);
  const [messages, setMessages] = useState<{ role: 'user' | 'ai', text: string }[]>([
    {
      role: 'ai',
      text:
        t.aiAssistantGreeting,
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = async (message: string) => {
    if (!message.trim() || isLoading) return;

    const userMsg = message.trim();
    const msg = userMsg.toLowerCase();
    setInput('');

    if (isHiddenDataRequest(userMsg)) {
      setMessages((prev) => [
        ...prev,
        { role: 'user', text: userMsg },
        { role: 'ai', text: unauthorizedDataRefusal },
      ]);
      setIsLoading(false);
      return;
    }

    setMessages((prev) => [...prev, { role: 'user', text: userMsg }]);
    setIsLoading(true);

    if (msg.includes('上传') || msg.includes('导入') || msg.includes('表格') || msg.includes('excel') || msg.includes('批量')) {
      setIsLoading(false);
      setMessages((prev) => [
        ...prev,
        {
          role: 'ai',
          text: `${t.aiImportOpen}\n\n${t.aiImportSupport}`,
        },
      ]);

      // 延迟打开上传窗口，让用户先看到提示
      setTimeout(() => {
        setShowTableImport(true);
      }, 500);
      return;
    }

    const aiResponse = await processAICmd(userMsg, buildSafeAIContext({ ...context, currentUser, t }));
    setMessages((prev) => [...prev, { role: 'ai', text: aiResponse }]);
    setIsLoading(false);
  };

  const handleSend = async () => {
    await sendMessage(input);
  };

  const handleSendWithText = (text: string) => {
    void sendMessage(text);
  };

  const handleDataConfirmed = async (data: any[], type: string) => {
    setShowTableImport(false);

    // 添加成功提示消息
    const typeNames: Record<string, string> = {
      customer: t.aiTypeCustomer,
      order: t.aiTypeOrder,
      sample: t.aiTypeSample,
      shipment: t.aiTypeShipment,
    };

    setMessages((prev) => [
      ...prev,
      {
        role: 'ai',
        text: `${t.aiImportSuccess}\n\n${t.aiImportType}：${typeNames[type] || type}\n${t.aiImportCount}：${data.length}\n\n${t.aiImportHint}`,
      },
    ]);

    // 真实数据入库
    try {
      if (type === 'customer') {
        await customerService.import(data);
      } else if (type === 'order') {
        for (const item of data) {
          await orderService.create(item);
        }
      } else if (type === 'sample') {
        for (const item of data) {
          await sampleService.create(item);
        }
      } else if (type === 'shipment') {
        for (const item of data) {
          await shipmentService.create(item);
        }
      }
    } catch (err) {
      console.error('AI Import Persistence Failed:', err);
    }
  };

  return (
    <>
      {/* FAB 按钮：移动端上移，避免与底部 Dock 重叠 */}
      <button
        onClick={() => setIsOpen(true)}
        aria-label={t.aiAssistantTitle || 'AI Assistant'}
        className="fixed bottom-28 right-4 lg:bottom-6 lg:right-6 w-14 h-14 bg-gradient-to-tr from-blue-500 to-indigo-500 rounded-[24px] shadow-2xl shadow-blue-500/40 flex items-center justify-center text-white z-40 hover:scale-110 transition-all active:scale-95 duration-300 bouncy"
      >
        <Bot size={28} />
        <span className="absolute -top-1 -right-1 flex h-4 w-4">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-200 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-4 w-4 bg-white"></span>
        </span>
      </button>

      {/* 聊天抽屉 */}
      {isOpen && (
        <div className="fixed inset-0 z-[60] flex flex-col justify-end sm:justify-center sm:items-end sm:p-6 bg-slate-900/30 backdrop-blur-md animate-in fade-in duration-300">
          <div className="w-full sm:w-[400px] h-[85vh] sm:h-[600px] bg-white dark:bg-slate-900 rounded-t-[32px] sm:rounded-[32px] shadow-2xl flex flex-col overflow-hidden border border-white/20 animate-in slide-in-from-bottom duration-500">
            {/* 头部 */}
            <div className="bg-slate-50 dark:bg-slate-950 p-6 flex items-center justify-between border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 bg-blue-500 rounded-xl shadow-lg shadow-blue-500/30">
                  <Sparkles size={20} className="text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-black tracking-wide text-slate-800 dark:text-white">{t.aiAssistantTitle}</h3>
                  <div className="flex items-center mt-1">
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse mr-2"></span>
                    <span className="text-xs font-bold text-slate-400">{t.aiAssistantOnline}</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                aria-label={t.close || 'Close'}
                className="p-2 bg-slate-200 dark:bg-slate-800 text-slate-500 rounded-full hover:rotate-90 transition-all active:scale-90"
              >
                <X size={20} />
              </button>
            </div>

            {/* 聊天区 */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar bg-white dark:bg-slate-900">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2`}>
                  <div
                    className={`max-w-[85%] p-4 rounded-[24px] text-sm font-bold leading-relaxed shadow-sm whitespace-pre-line ${
                      m.role === 'user'
                        ? 'bg-blue-600 text-white rounded-br-none'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-bl-none'
                    }`}
                  >
                    {m.text}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-[24px] rounded-bl-none flex space-x-1.5 items-center">
                    <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce [animation-delay:0.2s]"></div>
                    <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce [animation-delay:0.4s]"></div>
                  </div>
                </div>
              )}
            </div>

            {/* 快捷操作 */}
            <div className="px-6 py-4 flex gap-3 overflow-x-auto no-scrollbar border-t border-slate-50 dark:border-slate-800 bg-white dark:bg-slate-900">
              <button
                onClick={() => setShowTableImport(true)}
                className="shrink-0 flex items-center px-4 py-2 bg-green-50 dark:bg-green-900/20 rounded-full text-xs font-black text-green-600 dark:text-green-300 hover:scale-105 transition-all active:scale-95"
              >
                <Upload size={14} className="mr-2" /> {t.import}
              </button>
              <button
                onClick={() => handleSendWithText('分析一下本月销售和风险情况')}
                className="shrink-0 flex items-center px-4 py-2 bg-blue-50 dark:bg-blue-900/20 rounded-full text-xs font-black text-blue-600 dark:text-blue-300 hover:scale-105 transition-all active:scale-95"
              >
                <BarChart2 size={14} className="mr-2" /> {t.aiHelpAnalysis}
              </button>
              <button
                onClick={() => handleSendWithText('帮我申请样品')}
                className="shrink-0 flex items-center px-4 py-2 bg-indigo-50 dark:bg-indigo-900/20 rounded-full text-xs font-black text-indigo-600 dark:text-indigo-300 hover:scale-105 transition-all active:scale-95"
              >
                <PlusCircle size={14} className="mr-2" /> {t.quickOrder}
              </button>
            </div>

            {/* 输入区 */}
            <div className="p-6 bg-white dark:bg-slate-900 border-t border-slate-50 dark:border-slate-800 pb-8 sm:pb-6">
              <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded-[24px] p-1.5 focus-within:ring-2 focus-within:ring-blue-200 dark:focus-within:ring-blue-900 transition-all">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                  placeholder={t.aiPlaceholder}
                  className="flex-1 bg-transparent border-none focus:ring-0 text-sm px-4 py-2 font-bold text-slate-800 dark:text-white placeholder:text-slate-400"
                />
                <button
                  onClick={handleSend}
                  aria-label={t.send || 'Send'}
                  className="p-3 bg-blue-600 text-white rounded-[20px] shadow-lg shadow-blue-200 dark:shadow-none hover:bg-blue-700 transition-colors active:scale-90"
                >
                  <Send size={18} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 表格导入弹窗 */}
      {showTableImport && <TableImport onDataConfirmed={handleDataConfirmed} onCancel={() => setShowTableImport(false)} />}
    </>
  );
};

export default AIAssistant;
