// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { StudentForm, type TeacherStudent } from './StudentForm';

const sendForm = vi.fn();

vi.mock('../../api', () => {
  class ApiError extends Error {
    constructor(message: string, public status: number, public data: Record<string, unknown> = {}) {
      super(message);
    }
  }
  return {
    ApiError,
    api: vi.fn(),
    sendForm: (...args: unknown[]) => sendForm(...args),
    fetchProtectedBlobUrl: vi.fn().mockResolvedValue('blob:photo'),
  };
});

const withPhoto: TeacherStudent = {
  id: 'stu-1',
  name: 'Aarav Shah',
  gr_number: 'GR1',
  class_name: 'Class 1',
  section: 'A',
  gender: 'MALE',
  photo_url: '/api/students/stu-1/photo/?v=1',
  photo_consent_at: '2026-11-27T08:00:00Z',
};

describe('StudentForm photo removal', () => {
  afterEach(() => {
    cleanup();
    sendForm.mockReset();
  });

  it('asks first, then deletes the saved photo and its agreement', async () => {
    const onSaved = vi.fn();
    sendForm.mockResolvedValue({ ...withPhoto, photo_url: null, photo_consent_at: null });
    render(<StudentForm student={withPhoto} onSaved={onSaved} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove photo' }));
    expect(sendForm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(screen.getByRole('button', { name: 'Remove photo' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Remove photo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete photo' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(sendForm).toHaveBeenCalledWith('/students/stu-1/photo/', null, 'DELETE');
    expect(onSaved.mock.calls[0][0].photo_url).toBeNull();
  });

  it('has no Remove photo button when there is no saved photo', () => {
    render(<StudentForm student={{ ...withPhoto, photo_url: null, photo_consent_at: null }} onSaved={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Remove photo' })).toBeNull();
  });
});
