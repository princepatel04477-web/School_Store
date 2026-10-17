import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStoreState } from '../../store/storeState';
import type { StoreSchool } from '../../data/catalog';

/** Picks a school and goes to the class step. Shared by the home page and the search sheet. */
export function useSelectSchool() {
  const navigate = useNavigate();
  const { setSelection } = useStoreState();
  return useCallback(
    (school: StoreSchool) => {
      setSelection({
        schoolId: school.id,
        schoolName: school.name,
        schoolCode: school.code,
        cityName: school.city,
      });
      navigate(`/flow?school=${encodeURIComponent(school.id)}&step=2`);
    },
    [navigate, setSelection],
  );
}
