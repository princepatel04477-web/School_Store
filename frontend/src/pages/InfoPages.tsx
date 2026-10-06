import { Link } from 'react-router-dom';

export function ComingSoonPage({ title = 'Coming Soon' }: { title?: string }) {
  return (
    <div className="container" style={{ padding: 'var(--space-24) var(--space-4)', textAlign: 'center' }}>
      <span className="label">SchoolStore</span>
      <h1 style={{ marginTop: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>{title}</h1>
      <p style={{ margin: '0 auto var(--space-8)', maxWidth: '44ch' }}>
        This page is currently being prepared for the upcoming school academic session.
      </p>
      <Link to="/" className="btn btn-primary">
        Return to Home
      </Link>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className="container" style={{ padding: 'var(--space-24) var(--space-4)', textAlign: 'center' }}>
      <span className="label">404 Error</span>
      <h1 style={{ marginTop: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>Page not found</h1>
      <p style={{ margin: '0 auto var(--space-8)', maxWidth: '44ch' }}>
        The page you are looking for does not exist or has been moved to a new section.
      </p>
      <Link to="/" className="btn btn-primary">
        Back to SchoolStore
      </Link>
    </div>
  );
}
