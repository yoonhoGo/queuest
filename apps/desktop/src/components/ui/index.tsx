import { forwardRef, useEffect, useRef } from "react";
import type {
  ButtonHTMLAttributes,
  ChangeEventHandler,
  HTMLAttributes,
  ReactNode,
  RefObject,
} from "react";
import { PixelIcon } from "../PixelIcon";
import type { PixelIconName } from "../PixelIcon";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
export type ButtonSize = "default" | "small";

export type StatusKind = "todo" | "doing" | "review" | "done" | "pending";
export type ProgressTone = "gold" | "mint" | "teal";

function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(" ");
}

function legacyButtonClass(variant: ButtonVariant, size: ButtonSize): string {
  if (variant === "primary") {
    return size === "small" ? "small-button accent" : "primary-button";
  }
  if (variant === "danger") {
    return "danger-button";
  }
  if (variant === "quiet") {
    return "row-action";
  }
  return size === "small" ? "small-button" : "secondary-button";
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  variant = "secondary",
  size = "default",
  loading = false,
  className,
  disabled,
  children,
  type,
  ...props
}, ref) {
  return (
    <button
      {...props}
      ref={ref}
      type={type ?? "button"}
      className={cx(
        "ui-button",
        `ui-button-${variant}`,
        size === "small" && "ui-button-small",
        legacyButtonClass(variant, size),
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {children}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonProps, "children" | "variant" | "size"> {
  readonly label: string;
  readonly children: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({
  label,
  children,
  className,
  ...props
}, ref) {
  return (
    <Button
      {...props}
      ref={ref}
      variant="quiet"
      size="small"
      className={cx("ui-icon-button", "icon-button", className)}
      aria-label={label}
    >
      {children}
    </Button>
  );
});

export function StatusBadge({
  status,
  children,
  className,
  ...props
}: {
  readonly status: StatusKind;
  readonly children: ReactNode;
  readonly className?: string;
} & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span {...props} className={cx("ui-status-badge", "status-badge", `status-${status}`, className)}>
      {children}
    </span>
  );
}

export function ProgressBar({
  value,
  max = 100,
  label,
  tone = "gold",
  className,
  ...props
}: {
  readonly value: number;
  readonly max?: number;
  readonly label: string;
  readonly tone?: ProgressTone;
  readonly className?: string;
} & Omit<HTMLAttributes<HTMLDivElement>, "role">) {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 1;
  const safeValue = Number.isFinite(value) ? Math.min(safeMax, Math.max(0, value)) : 0;
  const percentage = (safeValue / safeMax) * 100;

  return (
    <div
      {...props}
      className={cx("ui-progress", `ui-progress-${tone}`, className)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={safeValue}
    >
      <span aria-hidden="true" style={{ width: `${percentage}%` }} />
    </div>
  );
}

export function Panel({ className, children, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section {...props} className={cx("ui-panel", className)}>
      {children}
    </section>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  titleId,
  note,
  icon,
  level = 2,
  className,
}: {
  readonly eyebrow?: ReactNode;
  readonly title: ReactNode;
  readonly titleId?: string;
  readonly note?: ReactNode;
  readonly icon?: PixelIconName;
  readonly level?: 2 | 3;
  readonly className?: string;
}) {
  const Heading = level === 3 ? "h3" : "h2";
  return (
    <div className={cx("ui-section-heading", "section-heading", className)}>
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <Heading id={titleId}>
          {icon && <PixelIcon name={icon} />}
          {title}
        </Heading>
      </div>
      {note && <span className="section-note">{note}</span>}
    </div>
  );
}

export function PanelHeading({
  eyebrow,
  title,
  titleId,
  note,
  icon,
  className,
}: {
  readonly eyebrow?: ReactNode;
  readonly title: ReactNode;
  readonly titleId?: string;
  readonly note?: ReactNode;
  readonly icon?: PixelIconName;
  readonly className?: string;
}) {
  return (
    <div className={cx("ui-panel-heading", "panel-heading", className)}>
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h3 id={titleId}>
          {icon && <PixelIcon name={icon} />}
          {title}
        </h3>
      </div>
      {note && <span>{note}</span>}
    </div>
  );
}

export function Field({
  id,
  label,
  hint,
  error,
  required,
  labelHidden = false,
  children,
  className,
}: {
  readonly id: string;
  readonly label: ReactNode;
  readonly hint?: ReactNode;
  readonly error?: ReactNode;
  readonly required?: boolean;
  readonly labelHidden?: boolean;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div className={cx("ui-field", className)}>
      <label className={labelHidden ? "sr-only" : undefined} htmlFor={id}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
      {error && <span className="validation-note" role="alert">{error}</span>}
    </div>
  );
}

export function CheckRow({
  checked,
  onChange,
  children,
  disabled = false,
  inputId,
  className,
}: {
  readonly checked: boolean;
  readonly onChange: ChangeEventHandler<HTMLInputElement>;
  readonly children: ReactNode;
  readonly disabled?: boolean;
  readonly inputId?: string;
  readonly className?: string;
}) {
  return (
    <label className={cx("ui-check-row", "check-row", className)} htmlFor={inputId}>
      <input id={inputId} type="checkbox" checked={checked} disabled={disabled} onChange={onChange} />
      <span>{children}</span>
    </label>
  );
}

export function Dialog({
  title,
  busy,
  onClose,
  children,
  className,
  closeLabel = "← 돌아가기",
  restoreFocusRef,
}: {
  readonly title: string;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly className?: string;
  readonly closeLabel?: string;
  readonly restoreFocusRef?: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }

    return () => {
      if (dialog?.open) {
        dialog.close();
      }
      queueMicrotask(() => {
        if (document.querySelector("dialog[open]")) {
          return;
        }
        const target = restoreFocusRef?.current ?? previous;
        if (target?.isConnected) {
          target.focus();
        } else {
          document.querySelector<HTMLElement>(".quest-home-heading h2, #project-title")?.focus();
        }
      });
    };
  }, [restoreFocusRef]);

  return (
    <dialog
      ref={ref}
      className={cx("ui-dialog", "quest-dialog", className)}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) {
          onClose();
        }
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) {
          onClose();
        }
      }}
    >
      <div className="ui-dialog-content quest-dialog-content">
        <Button variant="quiet" className="back-link" disabled={busy} onClick={onClose}>
          {closeLabel}
        </Button>
        {children}
      </div>
    </dialog>
  );
}

export interface NavigationTab<T extends string> {
  readonly id: T;
  readonly label: string;
  readonly icon?: PixelIconName;
  readonly disabled?: boolean;
}

export function NavigationTabs<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  readonly items: readonly NavigationTab<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly ariaLabel: string;
  readonly className?: string;
}) {
  return (
    <nav className={cx("ui-navigation", "app-navigation", className)} aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          type="button"
          className="ui-tab"
          key={item.id}
          aria-current={value === item.id ? "page" : undefined}
          disabled={item.disabled}
          onClick={() => onChange(item.id)}
        >
          {item.icon && <PixelIcon name={item.icon} />}
          <span>{item.label}</span>
          <svg className="nav-tip" viewBox="0 0 100 45" aria-hidden="true" preserveAspectRatio="none">
            <path d="M11 .5H89C94.8 .5 99.5 5.2 99.5 11V25C99.5 30.8 94.8 35.5 89 35.5H57C55 35.5 54.5 36.4 53.5 38L51 42C50.6 43 50.3 43.5 50 43.5C49.7 43.5 49.4 43 49 42L46.5 38C45.5 36.4 45 35.5 43 35.5H11C5.2 35.5 .5 30.8 .5 25V11C.5 5.2 5.2 .5 11 .5Z" />
          </svg>
        </button>
      ))}
    </nav>
  );
}

export function StatCard({
  icon,
  label,
  value,
  className,
}: {
  readonly icon: PixelIconName;
  readonly label: ReactNode;
  readonly value: ReactNode;
  readonly className?: string;
}) {
  return (
    <div className={cx("ui-stat-card", "character-completion-stat", className)}>
      <PixelIcon name={icon} />
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
      </div>
    </div>
  );
}
