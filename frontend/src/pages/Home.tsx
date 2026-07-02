import { Link } from 'react-router';
import { TopBar } from '../components/TopBar';
import { Button } from '../components/Button';
import { useAuth } from '../context/auth';

export function Home() {
  const { user } = useAuth();
  return (
    <div className="flex min-h-full flex-col">
      <TopBar />
      <main className="flex flex-1 items-center justify-center px-6 pb-24">
        <div className="max-w-lg text-center">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">photodrop</h1>
          <p className="mt-4 text-lg leading-relaxed text-muted">
            Ask the web manager for a link, or log in to see your assigned albums.
          </p>
          <div className="mt-8 flex justify-center">
            {user?.role === 'admin' ? (
              <Link to="/admin">
                <Button size="md">Go to dashboard</Button>
              </Link>
            ) : (
              !user && (
                <Link to="/login">
                  <Button size="md">Log in</Button>
                </Link>
              )
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
