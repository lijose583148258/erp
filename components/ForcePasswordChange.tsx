import React, { useMemo, useState } from 'react';
import { Lock, LogOut, ShieldCheck } from 'lucide-react';
import type { Language } from '../types';

type Props = {
  language: Language;
  username: string;
  onSubmit: (oldPassword: string, newPassword: string) => Promise<void>;
  onLogout: () => void;
};

const copy = {
  zh: {
    title: '首次登录需要修改密码',
    subtitle: '管理员创建账号后，必须先设置个人密码才能进入业务系统。',
    oldPassword: '当前临时密码',
    newPassword: '新密码',
    confirmPassword: '确认新密码',
    submit: '更新密码并进入系统',
    submitting: '正在更新...',
    logout: '退出登录',
    mismatch: '两次输入的新密码不一致',
    tooShort: '新密码至少需要 6 个字符',
    same: '新密码不能和临时密码相同',
    failed: '密码修改失败，请检查临时密码后重试',
  },
  en: {
    title: 'Change Password Required',
    subtitle: 'Your account was created by an administrator. Set a personal password before entering the system.',
    oldPassword: 'Current temporary password',
    newPassword: 'New password',
    confirmPassword: 'Confirm new password',
    submit: 'Update Password and Continue',
    submitting: 'Updating...',
    logout: 'Sign Out',
    mismatch: 'The new passwords do not match',
    tooShort: 'The new password must be at least 6 characters',
    same: 'The new password cannot match the temporary password',
    failed: 'Password update failed. Check the temporary password and try again.',
  },
  vi: {
    title: 'Cần đổi mật khẩu',
    subtitle: 'Tài khoản được tạo bởi quản trị viên. Hãy đặt mật khẩu cá nhân trước khi vào hệ thống.',
    oldPassword: 'Mật khẩu tạm thời hiện tại',
    newPassword: 'Mật khẩu mới',
    confirmPassword: 'Xác nhận mật khẩu mới',
    submit: 'Cập nhật mật khẩu và tiếp tục',
    submitting: 'Đang cập nhật...',
    logout: 'Đăng xuất',
    mismatch: 'Mật khẩu mới không khớp',
    tooShort: 'Mật khẩu mới cần ít nhất 6 ký tự',
    same: 'Mật khẩu mới không được trùng mật khẩu tạm thời',
    failed: 'Không thể cập nhật mật khẩu. Hãy kiểm tra mật khẩu tạm thời và thử lại.',
  },
} as const;

const ForcePasswordChange: React.FC<Props> = ({ language, username, onSubmit, onLogout }) => {
  const text = useMemo(() => copy[language], [language]);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (newPassword.length < 6) {
      setError(text.tooShort);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(text.mismatch);
      return;
    }
    if (oldPassword === newPassword) {
      setError(text.same);
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit(oldPassword, newPassword);
    } catch {
      setError(text.failed);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-8 text-slate-900 dark:bg-slate-950 dark:text-white">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md items-center justify-center">
        <section data-testid="force-password-change" className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-6 flex items-start gap-3">
            <div className="rounded-xl bg-blue-600 p-3 text-white">
              <ShieldCheck size={22} />
            </div>
            <div>
              <h1 className="text-lg font-black">{text.title}</h1>
              <p className="mt-1 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">{text.subtitle}</p>
              <p className="mt-2 text-xs font-black uppercase text-slate-500">{username}</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <PasswordField label={text.oldPassword} value={oldPassword} onChange={setOldPassword} autoComplete="current-password" />
            <PasswordField label={text.newPassword} value={newPassword} onChange={setNewPassword} autoComplete="new-password" />
            <PasswordField label={text.confirmPassword} value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />

            {error ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              data-testid="force-password-change-submit"
              disabled={isSubmitting}
              className="flex min-h-11 w-full items-center justify-center rounded-xl bg-blue-600 px-4 py-3 text-sm font-black text-white disabled:opacity-60"
            >
              <Lock size={16} className="mr-2" />
              {isSubmitting ? text.submitting : text.submit}
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="flex min-h-11 w-full items-center justify-center rounded-xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-700 dark:border-slate-700 dark:text-slate-200"
            >
              <LogOut size={16} className="mr-2" />
              {text.logout}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
};

const PasswordField: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
}> = ({ label, value, onChange, autoComplete }) => (
  <label className="block">
    <span className="mb-2 block text-sm font-black text-slate-700 dark:text-slate-200">{label}</span>
    <input
      type="password"
      value={value}
      autoComplete={autoComplete}
      onChange={(event) => onChange(event.target.value)}
      className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:focus:ring-blue-950"
    />
  </label>
);

export default ForcePasswordChange;
