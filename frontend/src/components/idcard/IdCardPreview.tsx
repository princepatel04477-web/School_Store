import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api';
import { useAuth } from '../../auth';
import type { SeedSchool } from '../../data/seedData';
import { getSchoolColor } from '../../theme/schoolTheme';
import { StudentIdCard, type IdCardStudent } from './StudentIdCard';

interface ApiStudent {
  id: string;
  name: string;
  gr_number?: string;
  class_name?: string;
  grade_name?: string;
  section?: string;
  gender?: string;
  date_of_birth?: string | null;
  school_name?: string;
  parent_name?: string;
  parent_phone?: string;
  photo_url?: string;
}

export interface IdCardPreviewProps {
  school: SeedSchool;
  className?: string;
  gender?: 'boy' | 'girl' | null;
}

/** Academic year in India runs April to March, e.g. "2026–27" */
function currentSession(now = new Date()) {
  const start = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${start}–${String((start + 1) % 100).padStart(2, '0')}`;
}

function formatDob(value?: string | null) {
  if (!value) return undefined;
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatGender(value?: string | null) {
  if (!value) return undefined;
  const v = value.toUpperCase();
  if (v === 'MALE' || v === 'BOY') return 'Boy';
  if (v === 'FEMALE' || v === 'GIRL') return 'Girl';
  return value;
}

/**
 * The ID card preview on the ID Cards tab. Signed-in parents see their own
 * child's details for this school; everyone else sees marked example details
 * that follow the class and boy/girl they picked.
 */
export function IdCardPreview({ school, className, gender }: IdCardPreviewProps) {
  const { user } = useAuth();
  const isParent = user?.role === 'PARENT';

  const { data } = useQuery({
    queryKey: ['parent-students'],
    queryFn: () => api<{ results: ApiStudent[] }>('/students/').catch(() => null),
    enabled: isParent,
  });

  const ownChild = useMemo(() => {
    const kids = data?.results ?? [];
    return kids.find((k) => k.school_name?.trim().toLowerCase() === school.name.trim().toLowerCase());
  }, [data, school.name]);

  const student: IdCardStudent = ownChild
    ? {
        name: ownChild.name,
        className: ownChild.grade_name || ownChild.class_name || className,
        section: ownChild.section,
        grNumber: ownChild.gr_number,
        dateOfBirth: formatDob(ownChild.date_of_birth),
        gender: formatGender(ownChild.gender),
        parentName: ownChild.parent_name || [user?.first_name, user?.last_name].filter(Boolean).join(' ') || undefined,
        parentPhone: ownChild.parent_phone || user?.phone,
        photoUrl: ownChild.photo_url,
      }
    : {
        name: gender === 'girl' ? 'Ananya Sharma' : 'Aarav Sharma',
        className: className || 'Class 4',
        section: 'B',
        grNumber: 'GR 2026/0147',
        dateOfBirth: '14 Aug 2016',
        gender: gender === 'girl' ? 'Girl' : 'Boy',
        parentName: 'Rohit Sharma',
        parentPhone: '+91 98XXX XX210',
      };

  const isExample = !ownChild;

  return (
    <section className="idc-preview" aria-labelledby="idc-preview-heading">
      <div className="idc-preview-copy">
        <span className="label">Printed for {school.name}</span>
        <h2 id="idc-preview-heading">{isExample ? 'How the ID card will look' : `${student.name}'s ID card`}</h2>
        <p>
          {isExample
            ? 'The card is printed in your school’s colours with your child’s photo and details from the school record.'
            : 'These details come from your school record. Check them before you order; the card is printed exactly as shown.'}
        </p>
        <p className="idc-preview-hint">
          <span className="idc-hint-mouse">Point at the card to see the back.</span>
          <span className="idc-hint-touch">Tap the card to see the back.</span>
        </p>
        {isExample && (
          <p className="idc-preview-signin">
            {user ? (
              'We couldn’t find a child at this school on your account, so these are example details.'
            ) : (
              <>
                <Link to="/login">Sign in</Link> and we’ll fill in your child’s card.
              </>
            )}
          </p>
        )}
      </div>

      <StudentIdCard
        school={{
          id: school.id,
          name: school.name,
          code: school.code,
          city: school.city,
          board: school.board,
          color: getSchoolColor(school),
        }}
        student={student}
        session={currentSession()}
        isExample={isExample}
      />
    </section>
  );
}
