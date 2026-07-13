import React, { useMemo, useState } from 'react';
import { Building2, Globe, Lock, Mail, Eye, EyeOff, LogIn, Sparkles } from 'lucide-react';
import type { Language } from '../types';

interface LoginProps {
  onLogin: (username: string, password: string, mfaCode?: string) => Promise<void>;
  language: Language;
  onLanguageChange: (lang: Language) => void;
}

const copy = {
  zh: {
    title: '爱劳达 ERP+CRM',
    subtitle: '化工贸易管理平台',
    welcome: '欢迎回来',
    description: '请输入账号信息登录系统',
    accountGuideTitle: '正式使用请登录员工个人账号',
    accountGuide: '管理员在“用户、角色与权限”中为员工创建账号。默认演示账号仅用于初始化与验收，发布安全模式下不会直接进入业务区。',
    username: '用户名 / 邮箱',
    password: '密码',
    mfaCode: 'MFA 验证码',
    usernamePlaceholder: '请输入用户名',
    passwordPlaceholder: '请输入密码',
    mfaPlaceholder: '如已启用请输入 6 位验证码',
    login: '登录系统',
    loggingIn: '登录中...',
    features: {
      crm: '客户关系',
      risk: '风控回款',
      ai: 'AI助手',
    },
    language: '语言',
    loginError: '用户名或密码错误',
    mfaRequired: '请输入 MFA 验证码后重试',
    mfaInvalid: 'MFA 验证码无效',
    serverUnavailable: '无法连接到服务器，请确认系统服务已启动后重试',
    accountDisabled: '账号已停用，请联系管理员',
    roleDisabled: '账号角色不可用，请联系管理员',
  },
  en: {
    title: 'AiLaoDa ERP+CRM',
    subtitle: 'Chemical Trade Management Platform',
    welcome: 'Welcome Back',
    description: 'Sign in to continue',
    accountGuideTitle: 'Use an employee account for daily work',
    accountGuide: 'Admins create employee accounts in Users, Roles, and Permissions. Default demo credentials are only for setup and checks, and cannot enter business pages in release security mode.',
    username: 'Username / Email',
    password: 'Password',
    mfaCode: 'MFA code',
    usernamePlaceholder: 'Enter username',
    passwordPlaceholder: 'Enter password',
    mfaPlaceholder: 'Enter 6-digit code if enabled',
    login: 'Sign In',
    loggingIn: 'Signing In...',
    features: {
      crm: 'CRM',
      risk: 'Risk Control',
      ai: 'AI Assistant',
    },
    language: 'Language',
    loginError: 'Invalid credentials',
    mfaRequired: 'Enter your MFA code and try again',
    mfaInvalid: 'Invalid MFA code',
    serverUnavailable: 'Cannot reach the server. Confirm the system service is running and try again.',
    accountDisabled: 'This account is disabled. Contact an administrator.',
    roleDisabled: 'This account role is unavailable. Contact an administrator.',
  },
  vi: {
    title: 'AiLaoDa ERP+CRM',
    subtitle: 'Nền tảng quản lý thương mại hóa chất',
    welcome: 'Chào mừng trở lại',
    description: 'Đăng nhập để tiếp tục',
    accountGuideTitle: 'Dung tai khoan nhan vien de lam viec',
    accountGuide: 'Quan tri tao tai khoan nhan vien trong Nguoi dung, vai tro va quyen. Tai khoan demo mac dinh chi dung de khoi tao va kiem tra, khong vao khu nghiep vu o che do phat hanh.',
    username: 'Tên đăng nhập / Email',
    password: 'Mật khẩu',
    mfaCode: 'Ma MFA',
    usernamePlaceholder: 'Nhập tên đăng nhập',
    passwordPlaceholder: 'Nhập mật khẩu',
    mfaPlaceholder: 'Nhap ma 6 so neu da bat',
    login: 'Đăng nhập',
    loggingIn: 'Đang đăng nhập...',
    features: {
      crm: 'CRM',
      risk: 'Kiểm soát rủi ro',
      ai: 'Trợ lý AI',
    },
    language: 'Ngôn ngữ',
    loginError: 'Thông tin đăng nhập không hợp lệ',
    mfaRequired: 'Nhap ma MFA roi thu lai',
    mfaInvalid: 'Ma MFA khong hop le',
    serverUnavailable: 'Không thể kết nối máy chủ. Hãy kiểm tra dịch vụ hệ thống rồi thử lại.',
    accountDisabled: 'Tài khoản đã bị vô hiệu hóa. Vui lòng liên hệ quản trị viên.',
    roleDisabled: 'Vai trò của tài khoản không khả dụng. Vui lòng liên hệ quản trị viên.',
  },
} as const;

const Login: React.FC<LoginProps> = ({ onLogin, language, onLanguageChange }) => {
  const text = useMemo(() => copy[language], [language]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setIsLoading(true);
    const formData = new FormData(event.currentTarget);
    const submittedUsername = String(formData.get('username') ?? username).trim();
    const submittedPassword = String(formData.get('password') ?? password);
    const submittedMfaCode = String(formData.get('mfaCode') ?? mfaCode).trim();
    try {
      await onLogin(submittedUsername, submittedPassword, submittedMfaCode || undefined);
    } catch (loginError) {
      const candidate = loginError as Error & { status?: number; errorCode?: string; isTimeout?: boolean };
      const message = String(candidate?.message || '');
      if (
        candidate?.status === 0
        || candidate?.isTimeout
        || /无法连接|network error|failed to fetch|timeout|cannot reach/i.test(message)
      ) {
        setError(text.serverUnavailable);
      } else if (candidate?.errorCode === 'MFA_REQUIRED') {
        setError(text.mfaRequired);
      } else if (candidate?.errorCode === 'MFA_INVALID') {
        setError(text.mfaInvalid);
      } else if (candidate?.status === 403 && /停用|disabled|vô hiệu/i.test(message)) {
        setError(text.accountDisabled);
      } else if (candidate?.status === 403 && /角色|role|vai trò/i.test(message)) {
        setError(text.roleDisabled);
      } else {
        setError(text.loginError);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-blue-400/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-purple-400/20 rounded-full blur-3xl animate-pulse [animation-delay:1s]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-indigo-400/10 rounded-full blur-3xl animate-pulse [animation-delay:2s]" />
      </div>

      <div className="absolute top-6 right-6 z-10">
        <div className="flex items-center gap-2 bg-white/80 dark:bg-slate-800/80 backdrop-blur-lg rounded-full p-1 shadow-lg">
          {(['zh', 'en', 'vi'] as Language[]).map((lang) => (
            <button
              key={lang}
              onClick={() => onLanguageChange(lang)}
              className={`px-4 py-2 rounded-full text-sm font-bold transition-all ${language === lang
                ? 'bg-blue-600 text-white shadow-lg'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
            >
              {lang.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="w-full max-w-6xl grid lg:grid-cols-2 gap-8 relative z-10">
        <div className="hidden lg:flex flex-col justify-center space-y-8 text-white p-12">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-white/20 backdrop-blur-lg rounded-2xl">
              <Building2 size={32} className="text-white" />
            </div>
            <div>
              <h1 className="text-4xl font-black tracking-tight">{text.title}</h1>
              <p className="text-blue-100 font-semibold">{text.subtitle}</p>
            </div>
          </div>

          <div className="space-y-4">
            <h2 className="text-2xl font-bold text-white/90">{text.welcome}</h2>
            <p className="text-lg text-white/70 leading-relaxed">{text.description}</p>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-4 text-center">
              <Sparkles className="mx-auto mb-2 text-yellow-300" size={24} />
              <p className="text-sm font-bold">{text.features.ai}</p>
            </div>
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-4 text-center">
              <Globe className="mx-auto mb-2 text-green-300" size={24} />
              <p className="text-sm font-bold">{text.features.crm}</p>
            </div>
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-4 text-center">
              <Lock className="mx-auto mb-2 text-red-300" size={24} />
              <p className="text-sm font-bold">{text.features.risk}</p>
            </div>
          </div>

          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 text-sm font-semibold leading-relaxed text-white/75">
            {text.description}
          </div>
        </div>

        <div className="flex items-center justify-center">
          <div className="w-full max-w-md">
            <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-xl rounded-3xl shadow-2xl p-8 space-y-6">
              <div className="lg:hidden text-center space-y-2 mb-6">
                <div className="flex items-center justify-center gap-2 mb-4">
                  <div className="p-2 bg-blue-600 rounded-xl">
                    <Building2 size={24} className="text-white" />
                  </div>
                  <h1 className="text-2xl font-black text-slate-800 dark:text-white">{text.title}</h1>
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-400">{text.subtitle}</p>
              </div>

              <div className="text-center space-y-2">
                <h2 className="text-2xl font-black text-slate-800 dark:text-white">{text.welcome}</h2>
                <p className="text-sm text-slate-600 dark:text-slate-400">{text.description}</p>
              </div>

              <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-left dark:border-blue-900 dark:bg-blue-950/30">
                <div className="text-sm font-black text-blue-900 dark:text-blue-100">{text.accountGuideTitle}</div>
                <p className="mt-1 text-xs font-bold leading-5 text-blue-800 dark:text-blue-200">{text.accountGuide}</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">{text.username}</label>
                  <div className="relative">
                    <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      id="login-username"
                      name="username"
                      autoComplete="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-11 py-3 text-sm font-semibold outline-none"
                      placeholder={text.usernamePlaceholder}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">{text.password}</label>
                  <div className="relative">
                    <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      id="login-password"
                      name="password"
                      autoComplete="current-password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-11 py-3 pr-12 text-sm font-semibold outline-none"
                      placeholder={text.passwordPlaceholder}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(prev => !prev)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400"
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">{text.mfaCode}</label>
                  <div className="relative">
                    <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      id="login-mfa-code"
                      name="mfaCode"
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-11 py-3 text-sm font-semibold outline-none"
                      placeholder={text.mfaPlaceholder}
                    />
                  </div>
                </div>

                {error && (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full rounded-2xl bg-blue-600 px-4 py-3.5 text-sm font-black text-white shadow-lg shadow-blue-200 disabled:opacity-60"
                >
                  <span className="inline-flex items-center justify-center gap-2">
                    <LogIn size={16} />
                    {isLoading ? text.loggingIn : text.login}
                  </span>
                </button>
              </form>

              <div className="text-[11px] font-bold text-slate-400 dark:text-slate-500">
                {text.language}: {language.toUpperCase()}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
