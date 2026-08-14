import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { api, isApiError } from '../lib/api';
import { useAuth, type User } from '../context/auth';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { TopBar } from '../components/TopBar';
import { useT, tr } from '../i18n';

type Phase = 'password' | 'enroll' | 'mfa';

function errMsg(err: unknown): string {
  // A server-side message is already in the request's language (the API
  // negotiates Accept-Language); only the no-response fallback is ours.
  return isApiError(err) ? err.message : tr('common.somethingWentWrong');
}

export function Login() {
  const t = useT();
  const { setUser } = useAuth();
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>('password');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [enroll, setEnroll] = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const finish = (user: User) => {
    setUser(user);
    navigate(user.role === 'admin' ? '/admin' : '/', { replace: true });
  };

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ step: 'enroll' | 'mfa' }>('/api/auth/login', {
        method: 'POST',
        body: { username, password },
      });
      if (res.step === 'enroll') {
        const data = await api<{ qrDataUrl: string; secret: string }>('/api/auth/totp/enroll', {
          method: 'POST',
        });
        setEnroll(data);
        setPhase('enroll');
      } else {
        setPhase('mfa');
      }
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const submitCode = (path: string) => async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ user: User }>(path, { method: 'POST', body: { code } });
      finish(res.user);
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <TopBar />
      <main className="flex flex-1 items-center justify-center px-6 pb-24">
        <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-7 shadow-soft">
          {phase === 'password' && (
            <form onSubmit={submitPassword} className="space-y-4">
              <div>
                <h1 className="text-xl font-semibold tracking-tight">{t('login.title')}</h1>
                <p className="mt-1 text-sm text-muted">{t('login.subtitle')}</p>
              </div>
              <Input
                label={t('login.username')}
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                required
              />
              <Input
                label={t('login.password')}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              {error && <p className="text-sm text-danger">{error}</p>}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? t('login.checking') : t('login.continue')}
              </Button>
            </form>
          )}

          {phase === 'enroll' && enroll && (
            <form onSubmit={submitCode('/api/auth/totp/activate')} className="space-y-4">
              <div>
                <h1 className="text-xl font-semibold tracking-tight">{t('login.enrollTitle')}</h1>
                <p className="mt-1 text-sm text-muted">
                  {t('login.enrollSubtitle')}
                </p>
              </div>
              <div className="flex justify-center">
                <img
                  src={enroll.qrDataUrl}
                  alt={t('login.qrAlt')}
                  className="h-44 w-44 rounded-lg border border-line"
                />
              </div>
              <p className="break-all text-center text-xs text-muted">
                {t('login.orEnterManually')} <span className="font-mono">{enroll.secret}</span>
              </p>
              <Input
                label={t('login.code')}
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoFocus
                required
              />
              {error && <p className="text-sm text-danger">{error}</p>}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? t('login.verifying') : t('login.activateContinue')}
              </Button>
            </form>
          )}

          {phase === 'mfa' && (
            <form onSubmit={submitCode('/api/auth/totp/verify')} className="space-y-4">
              <div>
                <h1 className="text-xl font-semibold tracking-tight">{t('login.mfaTitle')}</h1>
                <p className="mt-1 text-sm text-muted">
                  {t('login.mfaSubtitle')}
                </p>
              </div>
              <Input
                label={t('login.code')}
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoFocus
                required
              />
              {error && <p className="text-sm text-danger">{error}</p>}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? t('login.verifying') : t('login.verify')}
              </Button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
