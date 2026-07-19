import type { ButtonHTMLAttributes, RefCallback } from "react";

type SortHandleProps = {
  title: string;
  disabled?: boolean;
  buttonProps?: ButtonHTMLAttributes<HTMLButtonElement>;
  handleRef?: RefCallback<HTMLButtonElement>;
};

export function SortHandle({ title, disabled = false, buttonProps, handleRef }: SortHandleProps) {
  return (
    <button
      aria-label={title}
      className="sort-handle"
      disabled={disabled}
      ref={handleRef}
      title={title}
      type="button"
      {...buttonProps}
    >
      <span aria-hidden="true" className="sort-handle-icon">
        ≡
      </span>
      <span className="sort-handle-text">排序</span>
    </button>
  );
}
