import { useEffect } from 'react';

const BookingRecoveryResolutionBridge = () => {
  useEffect(() => {
    const handleResolved = (event) => {
      const detail = event?.detail || {};
      if (!detail.confirmed) return;

      // Close the active Radix dialog so stale local state cannot expose another
      // payment action after the backend has confirmed the booking.
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        bubbles: true,
      }));

      // Refresh the ride snapshot after the dialog closes. This deliberately uses
      // a full refresh because the recovery event is emitted outside the modal's
      // React tree and must also update every ride/passenger consumer on the page.
      window.setTimeout(() => {
        window.location.reload();
      }, 250);
    };

    window.addEventListener('shareway:booking-recovery-resolved', handleResolved);
    return () => window.removeEventListener('shareway:booking-recovery-resolved', handleResolved);
  }, []);

  return null;
};

export default BookingRecoveryResolutionBridge;
