import classesJson from '../../../shared/classes.json';

export interface ClassItem {
  id: string;
  name: string;
  group: 'Pre-primary' | 'Primary' | 'Middle' | 'Secondary';
  sort_order: number;
  sortOrder: number;
}

export const CLASSES: ClassItem[] = classesJson as ClassItem[];
export const CLASS_NAMES: string[] = CLASSES.map((c) => c.name);
