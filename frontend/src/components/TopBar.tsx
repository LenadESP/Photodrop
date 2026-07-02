import { Link } from 'react-router';
import { useAuth } from '../context/auth';
import { Button } from './Button';

export function TopBar() {
  const { user, logout } = useAuth();
  return (
    <header className="flex items-center justify-between px-5 py-4 sm:px-8">
      <Link to="/" className="text-lg font-semibold tracking-tight">
        photodrop
      </Link>
      <nav className="flex items-center gap-2">
        {user?.role === 'admin' ? (
          <>
            <Link to="/admin">
              <Button variant="secondary" size="sm">
                Admin dashboard
              </Button>
            </Link>
            <Button variant="ghost" size="sm" onClick={() => void logout()}>
              Log out
            </Button>
          </>
        ) : (
          <Link to="/login">
            <Button variant="secondary" size="sm">
              Log in
            </Button>
          </Link>
        )}
      </nav>
    </header>
  );
}
