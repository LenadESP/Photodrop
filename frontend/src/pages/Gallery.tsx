import { useParams } from 'react-router';

export function Gallery() {
  const { uid } = useParams();
  return (
    <main className="min-h-full flex items-center justify-center p-6">
      <p className="text-muted">Gallery {uid} — coming in step 6.</p>
    </main>
  );
}
