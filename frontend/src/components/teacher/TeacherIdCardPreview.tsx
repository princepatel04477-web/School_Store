import { useEffect, useState } from 'react';
import { fetchProtectedBlobUrl } from '../../api';
import { getSchoolColor } from '../../theme/schoolTheme';
import { StudentIdCard } from '../idcard/StudentIdCard';
import { standardLabel, type TeacherStudent } from './StudentForm';

/** Academic year in India runs April to March, e.g. "2026–27". */
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

/** The student's ID card as it will print, from what is saved on their form. */
export function TeacherIdCardPreview({ student }: { student: TeacherStudent }) {
  const [photo, setPhoto] = useState<string | undefined>();

  useEffect(() => {
    let alive = true;
    let url = '';
    setPhoto(undefined);
    if (student.photo_url) {
      fetchProtectedBlobUrl(student.photo_url)
        .then((u) => {
          url = u;
          if (alive) setPhoto(u);
        })
        .catch(() => undefined);
    }
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [student.photo_url]);

  const school = {
    id: student.school || student.id,
    name: student.branch_name || student.school_name || 'School',
    code: (student as TeacherStudent & { school_code?: string }).school_code || undefined,
    city: (student as TeacherStudent & { city_name?: string | null }).city_name || undefined,
    color: getSchoolColor({ id: student.school || student.id }),
  };
  const gender = student.gender?.toUpperCase() === 'FEMALE' ? 'Girl' : student.gender ? 'Boy' : undefined;

  return (
    <details className="tp-card-preview">
      <summary>See the ID card</summary>
      <div className="tp-card-preview-body">
        <StudentIdCard
          school={school}
          session={currentSession()}
          student={{
            name: student.name,
            className: standardLabel(student.grade_name || student.class_name),
            section: student.section,
            grNumber: student.gr_number,
            dateOfBirth: formatDob(student.date_of_birth),
            gender,
            parentName: student.father_or_guardian_name || undefined,
            parentPhone: student.roster_phone || undefined,
            photoUrl: photo,
          }}
        />
        <p className="tp-note">Tap the card to see the back. "Not added" means that box on the form is still empty.</p>
      </div>
    </details>
  );
}
