import { useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'safetour-disclaimer-dismissed';

export default function DisclaimerModal() {
  const dialogRef = useRef(null);
  const [isOpen, setIsOpen] = useState(() => {
    try {
      return !(window.localStorage.getItem(STORAGE_KEY) === 'true');
    } catch {
      return true;
    }
  });

  useEffect(() => {
    if (isOpen && dialogRef.current) {
      dialogRef.current.focus();
    }
  }, [isOpen]);

  const dismiss = () => {
    setIsOpen(false);
    try {
      window.localStorage.setItem(STORAGE_KEY, 'true');
    } catch {
      // Storage may be unavailable; keep the modal dismissible without crashing.
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="disclaimer-title" ref={dialogRef} tabIndex={-1}>
        <h2 id="disclaimer-title">Safety estimate disclaimer</h2>
        <p>
          SafeTour scores are estimates based on historical/demo data and limited context, not guarantees of personal safety.
          Use the map as a decision aid, not a guarantee.
        </p>
        <button type="button" className="primary-button" onClick={dismiss}>
          Continue
        </button>
      </div>
    </div>
  );
}
