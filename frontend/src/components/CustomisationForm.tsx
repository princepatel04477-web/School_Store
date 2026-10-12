import React, { useState } from 'react';
import { CustomisationField, getUploadPresignedUrl, uploadDirectToObjectStorage } from '../api';
import { compressImage } from '../utils/imageCompression';

interface CustomisationFormProps {
  schema: CustomisationField[];
  values: Record<string, any>;
  onChange: (values: Record<string, any>) => void;
  disabled?: boolean;
}

export function CustomisationForm({
  schema,
  values,
  onChange,
  disabled = false,
}: CustomisationFormProps) {
  const [uploadingField, setUploadingField] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<Record<string, string>>({});
  const [previews, setPreviews] = useState<Record<string, string>>({});

  const handleTextChange = (key: string, val: string) => {
    onChange({
      ...values,
      [key]: val,
    });
  };

  const handleImageSelect = async (
    field: CustomisationField,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingField(field.key);
    setUploadError((prev) => ({ ...prev, [field.key]: '' }));

    try {
      // 1. Client-side compression and resizing (target < 1 MB)
      const maxBytes = field.limits?.max_bytes || 1_000_000;
      const { blob } = await compressImage(file, 1600, maxBytes, 0.85);

      // Create instant local blob preview for UI responsiveness
      const localPreviewUrl = URL.createObjectURL(blob);
      setPreviews((prev) => ({ ...prev, [field.key]: localPreviewUrl }));

      // 2. Obtain short-lived presigned upload URL from backend
      const presigned = await getUploadPresignedUrl({
        content_type: 'image/jpeg',
        file_size: blob.size,
        filename: file.name,
      });

      // 3. Upload directly to object storage (bypasses Django workers completely)
      await uploadDirectToObjectStorage(presigned, blob, 'image/jpeg');

      // 4. Save ONLY the lightweight file_key into customisation_data
      onChange({
        ...values,
        [field.key]: presigned.file_key,
      });
    } catch (err: any) {
      console.error('Image upload failed:', err);
      setUploadError((prev) => ({
        ...prev,
        [field.key]: err.message || 'Direct upload failed. Please try again.',
      }));
    } finally {
      setUploadingField(null);
    }
  };

  if (!schema || schema.length === 0) return null;

  return (
    <div
      style={{
        background: '#f8faf8',
        border: '1px solid #dfe5dd',
        borderRadius: '6px',
        padding: '16px',
        margin: '14px 0',
        display: 'grid',
        gap: '12px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <b style={{ fontSize: '13px', color: '#17221f' }}>Customisation Details</b>
      </div>

      {schema.map((field) => {
        const isRequired = field.required ?? false;
        const currentVal = values[field.key] || '';
        const fieldError = uploadError[field.key];
        const isUploading = uploadingField === field.key;
        const previewUrl = previews[field.key];

        if (field.type === 'text') {
          return (
            <label key={field.key} style={{ display: 'grid', gap: '4px', fontSize: '12px', color: '#5c6b61' }}>
              <span>
                {field.label} {isRequired && <span style={{ color: '#a34235' }}>*</span>}
              </span>
              <input
                type="text"
                value={currentVal}
                maxLength={field.max_length || 100}
                placeholder={`Enter ${field.label.toLowerCase()}`}
                disabled={disabled}
                onChange={(e) => handleTextChange(field.key, e.target.value)}
                style={{
                  border: '1px solid #c9d4c9',
                  borderRadius: '6px',
                  padding: '8px 10px',
                  fontSize: '13px',
                  background: '#fff',
                }}
              />
            </label>
          );
        }

        if (field.type === 'select') {
          const options = field.options || [];
          return (
            <label key={field.key} style={{ display: 'grid', gap: '4px', fontSize: '12px', color: '#5c6b61' }}>
              <span>
                {field.label} {isRequired && <span style={{ color: '#a34235' }}>*</span>}
              </span>
              <select
                value={currentVal}
                disabled={disabled}
                onChange={(e) => handleTextChange(field.key, e.target.value)}
                style={{
                  border: '1px solid #c9d4c9',
                  borderRadius: '6px',
                  padding: '8px 10px',
                  fontSize: '13px',
                  background: '#fff',
                }}
              >
                <option value="">Select an option</option>
                {options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </label>
          );
        }

        if (field.type === 'image' || field.type === 'image_url') {
          return (
            <div key={field.key} style={{ display: 'grid', gap: '6px', fontSize: '12px', color: '#5c6b61' }}>
              <span>
                {field.label} {isRequired && <span style={{ color: '#a34235' }}>*</span>}
              </span>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                {previewUrl ? (
                  <div
                    style={{
                      width: '64px',
                      height: '64px',
                      borderRadius: '4px',
                      overflow: 'hidden',
                      border: '1px solid #c9d4c9',
                      background: '#eee',
                      flexShrink: 0,
                    }}
                  >
                    <img
                      src={previewUrl}
                      alt="Preview"
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  </div>
                ) : null}

                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 14px',
                    background: isUploading ? '#eef2ee' : '#2a6a4e',
                    color: '#fff',
                    borderRadius: '4px',
                    cursor: isUploading || disabled ? 'not-allowed' : 'pointer',
                    fontSize: '12px',
                    fontWeight: 600,
                  }}
                >
                  <span>{isUploading ? 'Compressing & Uploading…' : currentVal ? 'Change photo' : 'Upload photo'}</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={isUploading || disabled}
                    onChange={(e) => handleImageSelect(field, e)}
                    style={{ display: 'none' }}
                  />
                </label>

                {currentVal && !isUploading && (
                  <span style={{ fontSize: '11px', color: '#347052', fontWeight: 600 }}>
                    Uploaded straight to storage
                  </span>
                )}
              </div>

              {fieldError && (
                <div style={{ color: '#a34235', fontSize: '11px' }}>{fieldError}</div>
              )}
              <small style={{ color: '#7a8a7e', fontSize: '10px' }}>
                Photos are compressed client-side (&lt; 1 MB) and stored in encrypted private storage.
              </small>
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}
