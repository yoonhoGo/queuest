import type {
  ButtonHTMLAttributes,
  ChangeEventHandler,
  HTMLAttributes,
  ReactNode,
} from "react";

// Only the four controls used by this standalone demo. No desktop component dependency.
export function Button({
  variant = "secondary",
  size = "default",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
  size?: "default" | "small";
}) {
  return (
    <button
      {...props}
      type={type}
      className={`ui-button ui-button-${variant} ${size === "small" ? "ui-button-small" : ""} ${className}`}
    />
  );
}

export function Panel({
  className = "",
  ...props
}: HTMLAttributes<HTMLElement>) {
  return <section {...props} className={`ui-panel ${className}`} />;
}

export function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="ui-field">
      <label htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}

export function CheckRow({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: ChangeEventHandler<HTMLInputElement>;
  children: ReactNode;
}) {
  return (
    <label className="ui-check-row">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span>{children}</span>
    </label>
  );
}
