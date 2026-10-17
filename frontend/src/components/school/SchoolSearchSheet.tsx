import { useEffect } from 'react';
import { X } from '../ui/icons';
import { Button } from '../ui/Button';
import { SchoolSearch } from './SchoolSearch';
import { useSelectSchool } from './useSelectSchool';
import { useStoreSchools } from '../../data/catalog';
import { useLang } from '../../i18n';

/** Full-screen school search, opened from the header search icon on phones. */
export function SchoolSearchSheet({ onClose }: { onClose: () => void }) {
  const { t } = useLang();
  const { data: schools = [] } = useStoreSchools();
  const selectSchool = useSelectSchool();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="ss-sheet" role="dialog" aria-modal="true" aria-label={t('nav.search')}>
      <div className="ss-sheet-top">
        <Button variant="icon" aria-label={t('search.close')} onClick={onClose}>
          <X width={22} height={22} />
        </Button>
      </div>
      <SchoolSearch
        variant="sheet"
        autoFocus
        schools={schools}
        onSelect={(school) => {
          onClose();
          selectSchool(school);
        }}
      />
    </div>
  );
}
