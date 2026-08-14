import { Link } from 'react-router';
import { useAuth } from '../context/auth';
import { useT } from '../i18n';
import { Button } from './Button';
import { ThemeToggle } from './ThemeToggle';
import { LangToggle } from './LangToggle';

export function TopBar() {
  const { user, logout } = useAuth();
  const t = useT();
  // The header wraps rather than crushes. The nav can't fit a phone alongside
  // the wordmark once labels are translated — "Panel de administración" alone
  // is ~180px — and flex items don't shrink below their content, so without
  // flex-wrap the nav simply rams the logo. Wrapping keeps every control
  // reachable at any width, in any language.
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-5 py-4 sm:px-8">
      {/* The wordmark is the product name — a proper noun, never translated. */}
      <Link to="/" className="shrink-0 text-lg font-semibold tracking-tight">
        photodrop
      </Link>
      <nav className="flex flex-wrap items-center justify-end gap-2">
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
