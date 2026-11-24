import { Link } from 'react-router-dom';
import { EmeraldBand } from '../components/ui/EmeraldBand';

export function ComingSoonPage({ title = 'Coming Soon' }: { title?: string }) {
  return (
    <EmeraldBand eyebrow="SchoolStore" title={title} withKids>
      <div className="em-note">
        <p>This page is being prepared for the upcoming school session.</p>
        <Link to="/" className="btn btn-primary btn-lg">
          Return to Home
        </Link>
      </div>
    </EmeraldBand>
  );
}

export function NotFoundPage() {
  return (
    <EmeraldBand eyebrow="404" title="Page not found">
      <div className="em-note">
        <p>The page you are looking for does not exist or has moved.</p>
        <Link to="/" className="btn btn-primary btn-lg">
          Back to SchoolStore
        </Link>
      </div>
    </EmeraldBand>
  );
}
