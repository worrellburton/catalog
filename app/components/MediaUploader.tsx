import { useState, useRef, useCallback } from 'react';

interface MediaUploaderProps {
  onFilesSelected: (files: File[]) => void;
  accept?: string;
  maxFiles?: number;
  label?: string;
  disabled?: boolean;
}

const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ACCEPTED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];
const ALL_ACCEPTED = [...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_VIDEO_TYPES];
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

export default function MediaUploader({ onFilesSelected, accept, maxFiles = 10, label = 'Upload Media', disabled = false }: MediaUploaderProps) {
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateFiles = useCallback((files: File[]): File[] => {
    setError(null);
    const acceptedTypes = accept
      ? accept.split(',').map(t => t.trim())
      : ALL_ACCEPTED;

    const valid: File[] = [];
    for (const file of files) {
      if (!acceptedTypes.some(t => file.type === t || file.type.startsWith(t.replace('/*', '/')))) {
        setError(`${file.name}: unsupported file type`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        setError(`${file.name}: file too large (max 100MB)`);
        continue;
      }
      valid.push(file);
    }

    if (valid.length > maxFiles) {
      setError(`Maximum ${maxFiles} files allowed`);
      return valid.slice(0, maxFiles);
    }

    return valid;
  }, [accept, maxFiles]);

  const handleFiles = useCallback((fileList: FileList) => {
    const files = validateFiles(Array.from(fileList));
    if (files.length > 0) {
      onFilesSelected(files);
    }
  }, [validateFiles, onFilesSelected]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (disabled) return;
    handleFiles(e.dataTransfer.files);
  }, [handleFiles, disabled]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setDragOver(true);
  }, [disabled]);

  const handleDragLeave = useCallback(() => setDragOver(false), []);

  const handleClick = useCallback(() => {
    if (!disabled) inputRef.current?.click();
  }, [disabled]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(e.target.files);
      e.target.value = '';
    }
  }, [handleFiles]);

  return (
    <div className="media-uploader-wrap">
      <div
        className={`media-uploader ${dragOver ? 'drag-over' : ''} ${disabled ? 'disabled' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={handleClick}
        role="button"
        tabIndex={0}
        aria-label={label}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={accept || ALL_ACCEPTED.join(',')}
          onChange={handleInputChange}
          style={{ display: 'none' }}
        />
        <div className="media-uploader-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </div>
        <p className="media-uploader-label">{label}</p>
        <p className="media-uploader-hint">Drag & drop or click to browse</p>
        <p className="media-uploader-hint">Photos (JPG, PNG, WebP) • Videos (MP4, MOV, WebM) • Max 100MB</p>
      </div>
      {error && <p className="media-uploader-error">{error}</p>}
    </div>
  );
}
