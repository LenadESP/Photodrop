import { Link } from 'react-router';
import { useAuth } from '../context/auth';
import { useT } from '../i18n';
import { Button } from './Button';
import { ThemeToggle } from './ThemeToggle';
import { LangToggle } from './LangToggle';

export function TopBar() {
  const { user, logout } = useAuth();
  const t = useT();
  return (
    <header className="flex items-center justify-between px-5 py-4 sm:px-8">
      {/* The wordmark is the product name — a proper noun, never translated. */}
      <Link to="/" className="text-lg font-semibold tracking-tight">
        photodrop
      </Link>
      <nav className="flex items-center gap-2">
        <LangToggle />
        <ThemeToggle />
        {user?.role === 'admin' ? (
          <>
            <Link to="/admin">
              <Button variant="secondary" size="sm">
                {t('nav.adminDashboard')}
              </Button>
            </Link>
            <Button variant="ghost" size="sm" onClick={() => void logout()}>
              {t('nav.logOut')}
            </Button>
          </>
        ) : (
          <Link to="/login">
            <Button variant="secondary" size="sm">
              {t('nav.logIn')}
            </Button>
          </Link>
        )}
      </nav>
    </header>
  );
}
