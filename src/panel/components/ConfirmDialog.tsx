import { useEffect, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

interface Props {
  open: boolean;
  title: string;
  children: ComponentChildren;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Native <dialog>: focus is trapped and Escape cancels (NFR-15). */
export function ConfirmDialog({ open, title, children, confirmLabel, danger, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal?.();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} class="dialog" aria-labelledby="dialog-title" onCancel={(e) => { e.preventDefault(); onCancel(); }}>
      <h2 id="dialog-title">{title}</h2>
      <div class="dialog-body">{children}</div>
      <div class="row end">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" class={danger ? 'danger' : 'primary'} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
