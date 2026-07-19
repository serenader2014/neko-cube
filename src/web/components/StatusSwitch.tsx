type StatusSwitchProps = {
  checked: boolean;
  disabled?: boolean;
  offLabel?: string;
  onChange: (nextChecked: boolean) => void | Promise<unknown>;
  onLabel?: string;
  title?: string;
};

export function StatusSwitch({
  checked,
  disabled = false,
  offLabel = "停用",
  onChange,
  onLabel = "启用",
  title,
}: StatusSwitchProps) {
  return (
    <button
      aria-checked={checked}
      className={`status-switch ${checked ? "is-on" : "is-off"}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      role="switch"
      title={title ?? `点击切换为${checked ? offLabel : onLabel}`}
      type="button"
    >
      <span aria-hidden="true" className="status-switch-track">
        <span className="status-switch-thumb" />
      </span>
      <span className="status-switch-text">{checked ? onLabel : offLabel}</span>
    </button>
  );
}
